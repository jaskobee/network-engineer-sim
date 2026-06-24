/**
 * Integration tests for Topology.checkPing.
 * Each test builds an in-memory topology, configures it via CLIEngine /
 * PCCLIEngine (the same path the player uses), then asserts on the result
 * object — no React, no GameContext.
 *
 * T1–T8 match docs/SANDBOX_TEST_PLAN.md exactly.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { Device } from '../Device.js'
import { Topology } from '../Topology.js'
import { CLIEngine } from '../CLIEngine.js'
import { PCCLIEngine } from '../PCCLIEngine.js'

// ── Shared helpers ─────────────────────────────────────────────────────────────

function makeRouter(portCount = 4) {
  const d = new Device({ type: 'router', model: 'R-test', portCount, portPrefix: 'GigabitEthernet0/', portStart: 0 })
  d.powered = true
  return d
}

function makePc() {
  const d = new Device({ type: 'pc', model: 'PC-test', portCount: 1, portPrefix: 'Ethernet0/', portStart: 0 })
  d.powered = true
  return d
}

function makeSwitch(portCount = 4) {
  const d = new Device({ type: 'switch', model: 'SW-test', portCount, portPrefix: 'GigabitEthernet0/', portStart: 1 })
  d.powered = true
  return d
}

// Run IOS commands on a device and return the last output for assertion
function ios(engine, device, ...cmds) {
  let out = []
  for (const cmd of cmds) out = engine.execute(device, cmd)
  return out
}

// Run Linux commands on a PC/server
function lx(engine, device, ...cmds) {
  let out = []
  for (const cmd of cmds) out = engine.execute(device, cmd)
  return out
}

// Wire two devices together
function wire(topo, d1, if1, d2, if2) {
  return topo.connect(`${d1.id}:${if1}`, `${d2.id}:${if2}`)
}

// ── T1: Same-subnet baseline (Router + PC) ────────────────────────────────────

describe('T1 — same-subnet ping through one router port', () => {
  let topo, ios1, pc1

  beforeEach(() => {
    topo = new Topology()
    const eng   = new CLIEngine(topo)
    const pcEng = new PCCLIEngine(topo)
    const r1  = makeRouter()
    pc1 = makePc()
    topo.addDevice(r1)
    topo.addDevice(pc1)
    wire(topo, r1, 'GigabitEthernet0/0', pc1, 'Ethernet0/0')
    ios(eng, r1, 'enable', 'configure terminal',
      'interface GigabitEthernet0/0', 'ip address 192.168.1.1 255.255.255.0', 'no shutdown', 'end')
    lx(pcEng, pc1, 'ip addr add 192.168.1.10/24 dev eth0', 'ip link set eth0 up')
  })

  it('ping from PC to router succeeds', () => {
    expect(topo.checkPing('192.168.1.10', '192.168.1.1').reachable).toBe(true)
  })

  it('ping from router to PC succeeds', () => {
    expect(topo.checkPing('192.168.1.1', '192.168.1.10').reachable).toBe(true)
  })
})

// ── T2: L2 switch — flat LAN (unconfigured switch) ────────────────────────────

describe('T2 — flat LAN via unconfigured switch', () => {
  let topo, sw1, pc1, pc2, pc3, pcEng

  beforeEach(() => {
    topo  = new Topology()
    pcEng = new PCCLIEngine(topo)
    sw1   = makeSwitch(4)
    pc1   = makePc()
    pc2   = makePc()
    pc3   = makePc()
    topo.addDevice(sw1)
    topo.addDevice(pc1)
    topo.addDevice(pc2)
    topo.addDevice(pc3)
    wire(topo, sw1, 'GigabitEthernet0/1', pc1, 'Ethernet0/0')
    wire(topo, sw1, 'GigabitEthernet0/2', pc2, 'Ethernet0/0')
    wire(topo, sw1, 'GigabitEthernet0/3', pc3, 'Ethernet0/0')
    lx(pcEng, pc1, 'ip addr add 192.168.1.10/24 dev eth0', 'ip link set eth0 up')
    lx(pcEng, pc2, 'ip addr add 192.168.1.11/24 dev eth0', 'ip link set eth0 up')
    lx(pcEng, pc3, 'ip addr add 192.168.1.12/24 dev eth0', 'ip link set eth0 up')
  })

  it('PC1 reaches PC2 through unconfigured switch', () => {
    expect(topo.checkPing('192.168.1.10', '192.168.1.11').reachable).toBe(true)
  })

  it('PC1 reaches PC3 through unconfigured switch', () => {
    expect(topo.checkPing('192.168.1.10', '192.168.1.12').reachable).toBe(true)
  })

  it('switch CLIEngine rejects ip address on a physical port', () => {
    const eng = new CLIEngine(topo)
    ios(eng, sw1, 'enable', 'configure terminal', 'interface GigabitEthernet0/1')
    const out = eng.execute(sw1, 'ip address 10.0.0.1 255.255.255.0')
    expect(out.join(' ')).toMatch(/invalid input/i)
  })
})

// ── T3: Switch management IP via SVI ──────────────────────────────────────────

describe('T3 — switch reachable via SVI on VLAN 1', () => {
  let topo, sw1, pc1, pcEng

  beforeEach(() => {
    topo  = new Topology()
    const eng = new CLIEngine(topo)
    pcEng = new PCCLIEngine(topo)
    sw1 = makeSwitch()
    pc1 = makePc()
    topo.addDevice(sw1)
    topo.addDevice(pc1)
    wire(topo, sw1, 'GigabitEthernet0/1', pc1, 'Ethernet0/0')
    lx(pcEng, pc1, 'ip addr add 192.168.1.10/24 dev eth0', 'ip link set eth0 up')
    ios(eng, sw1,
      'enable', 'configure terminal',
      'interface vlan 1', 'ip address 192.168.1.2 255.255.255.0', 'no shutdown', 'end')
  })

  it('PC can ping switch management IP', () => {
    expect(topo.checkPing('192.168.1.10', '192.168.1.2').reachable).toBe(true)
  })

  it('switch management IP is on an SVI, not a physical port', () => {
    const svi = sw1.interfaces.find(i => i.svi && i.ip === '192.168.1.2')
    expect(svi).toBeTruthy()
    expect(svi.name).toBe('Vlan1')
    const phys = sw1.interfaces.filter(i => !i.svi)
    phys.forEach(i => expect(i.ip).toBeFalsy())
  })
})

// ── T4: Two routers, static routing both directions ───────────────────────────

describe('T4 — two routers, symmetric static routes', () => {
  let topo, r1, r2, pc1, pc2

  beforeEach(() => {
    topo = new Topology()
    const eng   = new CLIEngine(topo)
    const pcEng = new PCCLIEngine(topo)
    r1  = makeRouter()
    r2  = makeRouter()
    pc1 = makePc()
    pc2 = makePc()
    topo.addDevice(r1); topo.addDevice(r2)
    topo.addDevice(pc1); topo.addDevice(pc2)

    wire(topo, pc1, 'Ethernet0/0', r1, 'GigabitEthernet0/0')
    wire(topo, r1,  'GigabitEthernet0/1', r2, 'GigabitEthernet0/1')
    wire(topo, r2,  'GigabitEthernet0/0', pc2, 'Ethernet0/0')

    ios(eng, r1,
      'enable', 'configure terminal',
      'interface GigabitEthernet0/0', 'ip address 192.168.1.1 255.255.255.0', 'no shutdown', 'exit',
      'interface GigabitEthernet0/1', 'ip address 10.0.0.1 255.255.255.252', 'no shutdown', 'exit',
      'ip route 192.168.2.0 255.255.255.0 10.0.0.2', 'end')

    ios(eng, r2,
      'enable', 'configure terminal',
      'interface GigabitEthernet0/1', 'ip address 10.0.0.2 255.255.255.252', 'no shutdown', 'exit',
      'interface GigabitEthernet0/0', 'ip address 192.168.2.1 255.255.255.0', 'no shutdown', 'exit',
      'ip route 192.168.1.0 255.255.255.0 10.0.0.1', 'end')

    lx(pcEng, pc1,
      'ip addr add 192.168.1.10/24 dev eth0', 'ip link set eth0 up',
      'ip route add default via 192.168.1.1')
    lx(pcEng, pc2,
      'ip addr add 192.168.2.10/24 dev eth0', 'ip link set eth0 up',
      'ip route add default via 192.168.2.1')
  })

  it('PC1 reaches PC2 through both routers', () => {
    const r = topo.checkPing('192.168.1.10', '192.168.2.10')
    expect(r.reachable).toBe(true)
  })

  it('PC2 reaches PC1 (return direction)', () => {
    expect(topo.checkPing('192.168.2.10', '192.168.1.10').reachable).toBe(true)
  })
})

// ── T5: One-way route (THE critical invariant) ────────────────────────────────

describe('T5 — one-way route must fail as no_return_path', () => {
  let topo, r1, r2, pc1, pc2, eng, pcEng

  beforeEach(() => {
    topo  = new Topology()
    eng   = new CLIEngine(topo)
    pcEng = new PCCLIEngine(topo)
    r1  = makeRouter()
    r2  = makeRouter()
    pc1 = makePc()
    pc2 = makePc()
    topo.addDevice(r1); topo.addDevice(r2)
    topo.addDevice(pc1); topo.addDevice(pc2)

    wire(topo, pc1, 'Ethernet0/0', r1, 'GigabitEthernet0/0')
    wire(topo, r1,  'GigabitEthernet0/1', r2, 'GigabitEthernet0/1')
    wire(topo, r2,  'GigabitEthernet0/0', pc2, 'Ethernet0/0')

    ios(eng, r1,
      'enable', 'configure terminal',
      'interface GigabitEthernet0/0', 'ip address 192.168.1.1 255.255.255.0', 'no shutdown', 'exit',
      'interface GigabitEthernet0/1', 'ip address 10.0.0.1 255.255.255.252', 'no shutdown', 'exit',
      'ip route 192.168.2.0 255.255.255.0 10.0.0.2', 'end')

    ios(eng, r2,
      'enable', 'configure terminal',
      'interface GigabitEthernet0/1', 'ip address 10.0.0.2 255.255.255.252', 'no shutdown', 'exit',
      'interface GigabitEthernet0/0', 'ip address 192.168.2.1 255.255.255.0', 'no shutdown', 'exit',
      // intentionally NO return route: ip route 192.168.1.0 ...
      'end')

    lx(pcEng, pc1,
      'ip addr add 192.168.1.10/24 dev eth0', 'ip link set eth0 up',
      'ip route add default via 192.168.1.1')
    lx(pcEng, pc2,
      'ip addr add 192.168.2.10/24 dev eth0', 'ip link set eth0 up',
      'ip route add default via 192.168.2.1')
  })

  it('fails with no_return_path (not a silent success)', () => {
    const r = topo.checkPing('192.168.1.10', '192.168.2.10')
    expect(r.reachable).toBe(false)
    expect(r.failureReason).toBe('no_return_path')
  })

  it('succeeds once the return route is added to R2', () => {
    ios(eng, r2,
      'enable', 'configure terminal',
      'ip route 192.168.1.0 255.255.255.0 10.0.0.1', 'end')
    expect(topo.checkPing('192.168.1.10', '192.168.2.10').reachable).toBe(true)
  })
})

// ── T6: Missing default gateway on host ───────────────────────────────────────

describe('T6 — host without default gateway', () => {
  let topo, pc2, pcEng

  beforeEach(() => {
    topo  = new Topology()
    const eng   = new CLIEngine(topo)
    pcEng = new PCCLIEngine(topo)
    const r1  = makeRouter()
    const r2  = makeRouter()
    pc2 = makePc()
    topo.addDevice(r1); topo.addDevice(r2); topo.addDevice(pc2)

    wire(topo, r1, 'GigabitEthernet0/1', r2, 'GigabitEthernet0/1')
    wire(topo, r2, 'GigabitEthernet0/0', pc2, 'Ethernet0/0')

    ios(eng, r1,
      'enable', 'configure terminal',
      'interface GigabitEthernet0/1', 'ip address 10.0.0.1 255.255.255.252', 'no shutdown', 'exit',
      'ip route 192.168.2.0 255.255.255.0 10.0.0.2', 'end')
    ios(eng, r2,
      'enable', 'configure terminal',
      'interface GigabitEthernet0/1', 'ip address 10.0.0.2 255.255.255.252', 'no shutdown', 'exit',
      'interface GigabitEthernet0/0', 'ip address 192.168.2.1 255.255.255.0', 'no shutdown', 'end')

    // PC2 has IP but NO default route
    lx(pcEng, pc2,
      'ip addr add 192.168.2.10/24 dev eth0', 'ip link set eth0 up')
  })

  it('PC2 can reach its gateway (same subnet)', () => {
    expect(topo.checkPing('192.168.2.10', '192.168.2.1').reachable).toBe(true)
  })

  it('PC2 cannot reach off-subnet host without default route → host_no_gateway', () => {
    const r = topo.checkPing('192.168.2.10', '10.0.0.1')
    expect(r.reachable).toBe(false)
    expect(r.failureReason).toBe('host_no_gateway')
  })

  it('PC2 succeeds off-subnet once default route is added', () => {
    lx(pcEng, pc2, 'ip route add default via 192.168.2.1')
    expect(topo.checkPing('192.168.2.10', '10.0.0.1').reachable).toBe(true)
  })
})

// ── T7: Wrong subnet mask breaks an otherwise-fine ping ───────────────────────

describe('T7 — wrong mask silently breaks connectivity', () => {
  let topo, sw1, pc1, pc2, pcEng

  beforeEach(() => {
    topo  = new Topology()
    pcEng = new PCCLIEngine(topo)
    sw1 = makeSwitch()
    pc1 = makePc()
    pc2 = makePc()
    topo.addDevice(sw1); topo.addDevice(pc1); topo.addDevice(pc2)
    wire(topo, sw1, 'GigabitEthernet0/1', pc1, 'Ethernet0/0')
    wire(topo, sw1, 'GigabitEthernet0/2', pc2, 'Ethernet0/0')
    // Both on /24 initially
    lx(pcEng, pc1, 'ip addr add 192.168.1.10/24 dev eth0', 'ip link set eth0 up')
    lx(pcEng, pc2, 'ip addr add 192.168.1.200/24 dev eth0', 'ip link set eth0 up')
  })

  it('correct /24 mask — ping succeeds', () => {
    expect(topo.checkPing('192.168.1.10', '192.168.1.200').reachable).toBe(true)
  })

  it('/25 mask on PC1 puts .200 into the other half — ping fails (subnet_mismatch)', () => {
    // Change PC1 to /25 (first half: .0–.127)
    lx(pcEng, pc1, 'ip addr del 192.168.1.10/24 dev eth0')
    lx(pcEng, pc1, 'ip addr add 192.168.1.10/25 dev eth0')
    const r = topo.checkPing('192.168.1.10', '192.168.1.200')
    expect(r.reachable).toBe(false)
    expect(r.failureReason).toBe('subnet_mismatch')
  })

  it('restoring /24 fixes it', () => {
    lx(pcEng, pc1, 'ip addr del 192.168.1.10/24 dev eth0')
    lx(pcEng, pc1, 'ip addr add 192.168.1.10/25 dev eth0')
    lx(pcEng, pc1, 'ip addr del 192.168.1.10/25 dev eth0')
    lx(pcEng, pc1, 'ip addr add 192.168.1.10/24 dev eth0')
    expect(topo.checkPing('192.168.1.10', '192.168.1.200').reachable).toBe(true)
  })
})

// ── T8: Shutdown interface ────────────────────────────────────────────────────

describe('T8 — shutdown interface blocks traffic and propagates carrier-loss', () => {
  let topo, eng, pcEng, r1, pc1

  beforeEach(() => {
    topo  = new Topology()
    eng   = new CLIEngine(topo)
    pcEng = new PCCLIEngine(topo)
    r1  = makeRouter()
    pc1 = makePc()
    topo.addDevice(r1)
    topo.addDevice(pc1)
    wire(topo, r1, 'GigabitEthernet0/0', pc1, 'Ethernet0/0')
    ios(eng, r1,
      'enable', 'configure terminal',
      'interface GigabitEthernet0/0', 'ip address 192.168.1.1 255.255.255.0', 'no shutdown', 'end')
    lx(pcEng, pc1, 'ip addr add 192.168.1.10/24 dev eth0', 'ip link set eth0 up')
  })

  it('ping succeeds before shutdown', () => {
    expect(topo.checkPing('192.168.1.10', '192.168.1.1').reachable).toBe(true)
  })

  it('shutdown makes the router interface administratively down', () => {
    ios(eng, r1, 'enable', 'configure terminal', 'interface GigabitEthernet0/0', 'shutdown')
    const iface = r1.getInterface('GigabitEthernet0/0')
    expect(iface.status).toBe('admin_down')
  })

  it('shutdown propagates carrier-loss: peer interface drops to down', () => {
    ios(eng, r1, 'enable', 'configure terminal', 'interface GigabitEthernet0/0', 'shutdown')
    const pcIface = pc1.getInterface('Ethernet0/0')
    expect(pcIface.status).toBe('down')  // carrier lost — NOT still 'up'
  })

  it('ping fails after shutdown (admin_down source)', () => {
    ios(eng, r1, 'enable', 'configure terminal', 'interface GigabitEthernet0/0', 'shutdown')
    const r = topo.checkPing('192.168.1.1', '192.168.1.10')
    expect(r.reachable).toBe(false)
  })

  it('no shutdown restores the link and ping succeeds again', () => {
    ios(eng, r1, 'enable', 'configure terminal', 'interface GigabitEthernet0/0', 'shutdown')
    ios(eng, r1, 'interface GigabitEthernet0/0', 'no shutdown')
    expect(topo.checkPing('192.168.1.10', '192.168.1.1').reachable).toBe(true)
  })
})

// ── Additional: VLAN isolation ────────────────────────────────────────────────

describe('VLAN isolation — L2 switch cannot forward across VLAN boundaries', () => {
  let topo, sw1, pc1, pc2, pcEng

  beforeEach(() => {
    topo  = new Topology()
    const swEng = new CLIEngine(topo)
    pcEng = new PCCLIEngine(topo)
    sw1 = makeSwitch(4)
    pc1 = makePc()
    pc2 = makePc()
    topo.addDevice(sw1); topo.addDevice(pc1); topo.addDevice(pc2)
    wire(topo, sw1, 'GigabitEthernet0/1', pc1, 'Ethernet0/0')
    wire(topo, sw1, 'GigabitEthernet0/2', pc2, 'Ethernet0/0')

    // PC1 → VLAN 10, PC2 → VLAN 20
    ios(swEng, sw1,
      'enable', 'configure terminal',
      'interface GigabitEthernet0/1', 'switchport mode access', 'switchport access vlan 10', 'exit',
      'interface GigabitEthernet0/2', 'switchport mode access', 'switchport access vlan 20', 'exit',
      'end')

    lx(pcEng, pc1, 'ip addr add 192.168.10.1/24 dev eth0', 'ip link set eth0 up')
    lx(pcEng, pc2, 'ip addr add 192.168.10.2/24 dev eth0', 'ip link set eth0 up')
  })

  it('same subnet but different VLANs — ping fails with vlan_isolated', () => {
    const r = topo.checkPing('192.168.10.1', '192.168.10.2')
    expect(r.reachable).toBe(false)
    expect(r.failureReason).toBe('vlan_isolated')
  })
})

// ── Additional: BFS cannot traverse shutdown link ─────────────────────────────

describe('BFS safety — shutdown transit link stops multi-hop traffic', () => {
  it('ping fails via a multi-hop path when the transit link is admin_down', () => {
    const topo  = new Topology()
    const eng   = new CLIEngine(topo)
    const pcEng = new PCCLIEngine(topo)
    const r1  = makeRouter()
    const r2  = makeRouter()
    const pc1 = makePc()
    const pc2 = makePc()
    topo.addDevice(r1); topo.addDevice(r2)
    topo.addDevice(pc1); topo.addDevice(pc2)

    wire(topo, pc1, 'Ethernet0/0', r1, 'GigabitEthernet0/0')
    wire(topo, r1,  'GigabitEthernet0/1', r2, 'GigabitEthernet0/1')
    wire(topo, r2,  'GigabitEthernet0/0', pc2, 'Ethernet0/0')

    ios(eng, r1,
      'enable', 'configure terminal',
      'interface GigabitEthernet0/0', 'ip address 192.168.1.1 255.255.255.0', 'no shutdown', 'exit',
      'interface GigabitEthernet0/1', 'ip address 10.0.0.1 255.255.255.252', 'no shutdown', 'exit',
      'ip route 192.168.2.0 255.255.255.0 10.0.0.2', 'end')
    ios(eng, r2,
      'enable', 'configure terminal',
      'interface GigabitEthernet0/1', 'ip address 10.0.0.2 255.255.255.252', 'no shutdown', 'exit',
      'interface GigabitEthernet0/0', 'ip address 192.168.2.1 255.255.255.0', 'no shutdown', 'exit',
      'ip route 192.168.1.0 255.255.255.0 10.0.0.1', 'end')
    lx(pcEng, pc1,
      'ip addr add 192.168.1.10/24 dev eth0', 'ip link set eth0 up',
      'ip route add default via 192.168.1.1')
    lx(pcEng, pc2,
      'ip addr add 192.168.2.10/24 dev eth0', 'ip link set eth0 up',
      'ip route add default via 192.168.2.1')

    // Confirm it works before shutdown
    expect(topo.checkPing('192.168.1.10', '192.168.2.10').reachable).toBe(true)

    // Shutdown the R1↔R2 transit link on R1's side
    ios(eng, r1, 'enable', 'configure terminal', 'interface GigabitEthernet0/1', 'shutdown')

    // Peer (R2's Gig0/1) must have lost carrier
    expect(r2.getInterface('GigabitEthernet0/1').status).toBe('down')

    // Ping must now fail — BFS cannot traverse the dead link
    const r = topo.checkPing('192.168.1.10', '192.168.2.10')
    expect(r.reachable).toBe(false)
  })
})

// ── Additional: admin_down source interface ───────────────────────────────────

describe('admin_down source interface', () => {
  it('reports admin_down failureReason when source interface is shut', () => {
    const topo  = new Topology()
    const eng   = new CLIEngine(topo)
    const r1    = makeRouter()
    const r2    = makeRouter()
    topo.addDevice(r1); topo.addDevice(r2)
    wire(topo, r1, 'GigabitEthernet0/0', r2, 'GigabitEthernet0/0')
    ios(eng, r1,
      'enable', 'configure terminal',
      'interface GigabitEthernet0/0', 'ip address 192.168.1.1 255.255.255.0', 'no shutdown', 'end')
    ios(eng, r2,
      'enable', 'configure terminal',
      'interface GigabitEthernet0/0', 'ip address 192.168.1.2 255.255.255.0', 'no shutdown', 'end')

    // Shut the source interface
    ios(eng, r1, 'enable', 'configure terminal', 'interface GigabitEthernet0/0', 'shutdown')

    const r = topo.checkPing('192.168.1.1', '192.168.1.2')
    expect(r.reachable).toBe(false)
    expect(r.failureReason).toBe('admin_down')
  })
})

// ── host_no_gateway reason code ───────────────────────────────────────────────

describe('host_no_gateway — emitted only for PC/server with no usable gateway', () => {
  // Minimal topology: one PC wired to one router.  Used by several sub-tests;
  // the router's IP is the "natural" default gateway for the PC.
  function makeGatewayTopo() {
    const topo  = new Topology()
    const eng   = new CLIEngine(topo)
    const pcEng = new PCCLIEngine(topo)
    const r1 = makeRouter()
    const pc = makePc()
    topo.addDevice(r1); topo.addDevice(pc)
    wire(topo, r1, 'GigabitEthernet0/0', pc, 'Ethernet0/0')
    // Router: configure IP and bring up — PC's eth0 still admin_down at this point
    ios(eng, r1,
      'enable', 'configure terminal',
      'interface GigabitEthernet0/0', 'ip address 192.168.1.1 255.255.255.0', 'no shutdown', 'end')
    // PC: assign address then bring up (link goes up, peer port wakes up too)
    lx(pcEng, pc, 'ip addr add 192.168.1.10/24 dev eth0', 'ip link set eth0 up')
    return { topo, eng, pcEng, r1, pc }
  }

  it('PC with no default route pinging off-subnet → host_no_gateway', () => {
    const { topo } = makeGatewayTopo()
    const r = topo.checkPing('192.168.1.10', '10.0.0.5')
    expect(r.reachable).toBe(false)
    expect(r.failureReason).toBe('host_no_gateway')
  })

  it('PC with no default route pinging OWN subnet → succeeds (host_no_gateway must NOT fire)', () => {
    const { topo } = makeGatewayTopo()
    // 192.168.1.1 is in PC's own /24 subnet — should succeed
    expect(topo.checkPing('192.168.1.10', '192.168.1.1').reachable).toBe(true)
  })

  it('PC with valid in-subnet default gateway but router has no onward route → no_route, NOT host_no_gateway', () => {
    const { topo, pcEng, pc } = makeGatewayTopo()
    // Gateway 192.168.1.1 IS in PC's /24 — gateway is usable
    lx(pcEng, pc, 'ip route add default via 192.168.1.1')
    // 10.0.0.5 is not in the router's routing table
    const r = topo.checkPing('192.168.1.10', '10.0.0.5')
    expect(r.reachable).toBe(false)
    expect(r.failureReason).toBe('no_route')
  })

  it('PC with default route whose gateway is NOT in any connected subnet → host_no_gateway', () => {
    const { topo, pcEng, pc } = makeGatewayTopo()
    // 10.0.0.1 is not in PC's 192.168.1.0/24 — gateway unreachable from connected subnet
    lx(pcEng, pc, 'ip route add default via 10.0.0.1')
    const r = topo.checkPing('192.168.1.10', '10.0.0.5')
    expect(r.reachable).toBe(false)
    expect(r.failureReason).toBe('host_no_gateway')
  })

  it('router with no matching route → no_route, NOT host_no_gateway', () => {
    const topo  = new Topology()
    const eng   = new CLIEngine(topo)
    const r1    = makeRouter()
    const r2    = makeRouter()
    topo.addDevice(r1); topo.addDevice(r2)
    wire(topo, r1, 'GigabitEthernet0/0', r2, 'GigabitEthernet0/0')
    ios(eng, r1,
      'enable', 'configure terminal',
      'interface GigabitEthernet0/0', 'ip address 192.168.1.1 255.255.255.0', 'no shutdown', 'end')
    ios(eng, r2,
      'enable', 'configure terminal',
      'interface GigabitEthernet0/0', 'ip address 192.168.1.2 255.255.255.0', 'no shutdown', 'end')
    // R1 has no route to 10.0.0.5
    const r = topo.checkPing('192.168.1.1', '10.0.0.5')
    expect(r.reachable).toBe(false)
    expect(r.failureReason).toBe('no_route')
  })

  it('host_no_gateway maps to "Network is unreachable" in PCCLIEngine output (display unchanged)', () => {
    const { topo, pcEng, pc } = makeGatewayTopo()
    // No default route on PC — should emit host_no_gateway internally
    const out = pcEng.execute(pc, 'ping 10.0.0.5').join('\n')
    expect(out).toMatch(/Network is unreachable/i)
  })
})

// ── subnet_mismatch reason code ───────────────────────────────────────────────

describe('subnet_mismatch — post-BFS refinement for inconsistent masks', () => {
  // Helper: two PCs wired to a switch, masks assigned by caller
  function makeL2Topo() {
    const topo  = new Topology()
    const swEng = new CLIEngine(topo)
    const pcEng = new PCCLIEngine(topo)
    const sw1 = makeSwitch(4)
    const pc1 = makePc()
    const pc2 = makePc()
    topo.addDevice(sw1); topo.addDevice(pc1); topo.addDevice(pc2)
    wire(topo, sw1, 'GigabitEthernet0/1', pc1, 'Ethernet0/0')
    wire(topo, sw1, 'GigabitEthernet0/2', pc2, 'Ethernet0/0')
    return { topo, swEng, pcEng, sw1, pc1, pc2 }
  }

  it('PC1/25 considers PC2/24 off-subnet but PC2 sees PC1 as neighbor → subnet_mismatch', () => {
    const { topo, pcEng, pc1, pc2 } = makeL2Topo()
    lx(pcEng, pc1, 'ip addr add 192.168.1.10/25 dev eth0', 'ip link set eth0 up')
    lx(pcEng, pc2, 'ip addr add 192.168.1.200/24 dev eth0', 'ip link set eth0 up')
    const r = topo.checkPing('192.168.1.10', '192.168.1.200')
    expect(r.reachable).toBe(false)
    expect(r.failureReason).toBe('subnet_mismatch')
  })

  it('same IP subnet but different VLANs → vlan_isolated, NOT subnet_mismatch (src sees dst as local)', () => {
    const { topo, swEng, pcEng, sw1, pc1, pc2 } = makeL2Topo()
    ios(swEng, sw1,
      'enable', 'configure terminal',
      'interface GigabitEthernet0/1', 'switchport mode access', 'switchport access vlan 10', 'exit',
      'interface GigabitEthernet0/2', 'switchport mode access', 'switchport access vlan 20', 'end')
    lx(pcEng, pc1, 'ip addr add 192.168.1.10/24 dev eth0', 'ip link set eth0 up')
    lx(pcEng, pc2, 'ip addr add 192.168.1.200/24 dev eth0', 'ip link set eth0 up')
    const r = topo.checkPing('192.168.1.10', '192.168.1.200')
    expect(r.reachable).toBe(false)
    // src sees dst as local → VLAN isolation, now correctly reported as vlan_isolated
    expect(r.failureReason).toBe('vlan_isolated')
  })

  it('genuinely different subnets (same /24 family) → host_no_gateway, NOT subnet_mismatch', () => {
    const { topo, pcEng, pc1, pc2 } = makeL2Topo()
    lx(pcEng, pc1, 'ip addr add 10.0.0.1/24 dev eth0', 'ip link set eth0 up')
    lx(pcEng, pc2, 'ip addr add 192.168.1.1/24 dev eth0', 'ip link set eth0 up')
    // 192.168.1.1/24 doesn't consider 10.0.0.1 a neighbor → NOT subnet_mismatch
    const r = topo.checkPing('10.0.0.1', '192.168.1.1')
    expect(r.reachable).toBe(false)
    expect(r.failureReason).toBe('host_no_gateway')
  })

  it('destination interface admin_down → dst iface not up, subnet_mismatch does NOT fire', () => {
    const { topo, pcEng, pc1, pc2 } = makeL2Topo()
    lx(pcEng, pc1, 'ip addr add 192.168.1.10/25 dev eth0', 'ip link set eth0 up')
    lx(pcEng, pc2, 'ip addr add 192.168.1.200/24 dev eth0', 'ip link set eth0 up')
    lx(pcEng, pc2, 'ip link set eth0 down')  // take PC2 offline
    const r = topo.checkPing('192.168.1.10', '192.168.1.200')
    expect(r.reachable).toBe(false)
    expect(r.failureReason).toBe('host_no_gateway')  // dst iface admin_down → mismatch undetectable
  })

  it('subnet_mismatch maps to "Network is unreachable" in PCCLIEngine output', () => {
    const { topo, pcEng, pc1, pc2 } = makeL2Topo()
    lx(pcEng, pc1, 'ip addr add 192.168.1.10/25 dev eth0', 'ip link set eth0 up')
    lx(pcEng, pc2, 'ip addr add 192.168.1.200/24 dev eth0', 'ip link set eth0 up')
    const out = pcEng.execute(pc1, 'ping 192.168.1.200').join('\n')
    expect(out).toMatch(/Network is unreachable/i)
  })
})

// ── Additional: loopback always replies ──────────────────────────────────────

describe('loopback', () => {
  it('127.0.0.1 always replies if source interface is up', () => {
    const topo  = new Topology()
    const eng   = new CLIEngine(topo)
    const r1    = makeRouter()
    // Use a switch as the peer: switch ports start 'down' (not admin_down), so
    // the router's no shutdown will bring the link up immediately.
    const sw1   = makeSwitch()
    topo.addDevice(r1); topo.addDevice(sw1)
    wire(topo, r1, 'GigabitEthernet0/0', sw1, 'GigabitEthernet0/1')
    ios(eng, r1,
      'enable', 'configure terminal',
      'interface GigabitEthernet0/0', 'ip address 192.168.1.1 255.255.255.0', 'no shutdown', 'end')
    expect(r1.getInterface('GigabitEthernet0/0').status).toBe('up')
    expect(topo.checkPing('192.168.1.1', '127.0.0.1').reachable).toBe(true)
  })
})
