/**
 * Router-on-a-Stick (ROAS) integration tests.
 * Validates all ROAS invariants from the sprint spec.
 * Topology: PC1 (VLAN10) ── SW ── R1 (subinterfaces) ── SW ── PC2 (VLAN20)
 * or simpler single-switch variants.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { Device } from '../Device.js'
import { Topology } from '../Topology.js'
import { CLIEngine } from '../CLIEngine.js'
import { PCCLIEngine } from '../PCCLIEngine.js'

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeRouter(portCount = 4) {
  const d = new Device({ type: 'router', model: 'R', portCount, portPrefix: 'GigabitEthernet0/', portStart: 0 })
  d.powered = true
  return d
}
function makeSwitch(portCount = 8) {
  const d = new Device({ type: 'switch', model: 'SW', portCount, portPrefix: 'GigabitEthernet0/', portStart: 1 })
  d.powered = true
  return d
}
function makePc() {
  const d = new Device({ type: 'pc', model: 'PC', portCount: 1, portPrefix: 'Ethernet0/', portStart: 0 })
  d.powered = true
  return d
}
function run(engine, device, ...cmds) {
  let out = []
  for (const cmd of cmds) out = engine.execute(device, cmd)
  return out
}
function wire(topo, d1, if1, d2, if2) {
  return topo.connect(`${d1.id}:${if1}`, `${d2.id}:${if2}`)
}

// Build the canonical ROAS topology:
//   PC1 (VLAN10, 192.168.10.10/24, gw .10.1)
//   PC2 (VLAN20, 192.168.20.10/24, gw .20.1)
//   SW:  port1 access VLAN10 → PC1
//        port2 access VLAN20 → PC2
//        port3 trunk → R1 Gig0/0
//   R1:  Gig0/0 (parent, no ip, no shutdown)
//        Gig0/0.10 (dot1Q 10, 192.168.10.1/24)
//        Gig0/0.20 (dot1Q 20, 192.168.20.1/24)
function buildRoasTopo({ trunkOnSwitch = true, physShutdown = false, missingEncap20 = false } = {}) {
  const topo  = new Topology()
  const eng   = new CLIEngine(topo)
  const pcEng = new PCCLIEngine(topo)
  const r1  = makeRouter()
  const sw1 = makeSwitch()
  const pc1 = makePc()
  const pc2 = makePc()
  topo.addDevice(r1); topo.addDevice(sw1)
  topo.addDevice(pc1); topo.addDevice(pc2)

  // Cables
  wire(topo, sw1, 'GigabitEthernet0/1', pc1, 'Ethernet0/0')  // access VLAN10
  wire(topo, sw1, 'GigabitEthernet0/2', pc2, 'Ethernet0/0')  // access VLAN20
  wire(topo, sw1, 'GigabitEthernet0/3', r1,  'GigabitEthernet0/0')  // trunk to router

  // Switch config
  run(eng, sw1,
    'enable', 'configure terminal',
    'interface GigabitEthernet0/1', 'switchport mode access', 'switchport access vlan 10', 'exit',
    'interface GigabitEthernet0/2', 'switchport mode access', 'switchport access vlan 20', 'exit',
    'interface GigabitEthernet0/3',
    trunkOnSwitch ? 'switchport mode trunk' : 'switchport mode access',
    'end')

  // Router: always enter global_config first; conditionally no shutdown the parent
  run(eng, r1, 'enable', 'configure terminal')
  if (!physShutdown) {
    run(eng, r1, 'interface GigabitEthernet0/0', 'no shutdown', 'exit')
  }

  // Subinterface for VLAN10 (device is already in global_config)
  run(eng, r1,
    'interface GigabitEthernet0/0.10',
    'encapsulation dot1Q 10',
    'ip address 192.168.10.1 255.255.255.0',
    'exit')

  // Subinterface for VLAN20 (optionally skip encapsulation to test that invariant)
  if (!missingEncap20) {
    run(eng, r1,
      'interface GigabitEthernet0/0.20',
      'encapsulation dot1Q 20',
      'ip address 192.168.20.1 255.255.255.0',
      'exit')
  } else {
    run(eng, r1,
      'interface GigabitEthernet0/0.20',
      // no encapsulation — deliberate omission
      'ip address 192.168.20.1 255.255.255.0',
      'exit')
  }

  run(eng, r1, 'end')

  // PC configs
  run(pcEng, pc1, 'ip addr add 192.168.10.10/24 dev eth0', 'ip link set eth0 up',
    'ip route add default via 192.168.10.1')
  run(pcEng, pc2, 'ip addr add 192.168.20.10/24 dev eth0', 'ip link set eth0 up',
    'ip route add default via 192.168.20.1')

  return { topo, eng, pcEng, r1, sw1, pc1, pc2 }
}

// ── HAPPY PATH ────────────────────────────────────────────────────────────────

describe('ROAS happy path — PC1(VLAN10) ↔ PC2(VLAN20) via router subinterfaces', () => {
  let topo, r1

  beforeEach(() => {
    ;({ topo, r1 } = buildRoasTopo())
  })

  it('PC1 can ping PC2 (inter-VLAN via ROAS)', () => {
    const r = topo.checkPing('192.168.10.10', '192.168.20.10')
    expect(r.reachable).toBe(true)
  })

  it('PC2 can ping PC1 (return direction)', () => {
    expect(topo.checkPing('192.168.20.10', '192.168.10.10').reachable).toBe(true)
  })

  it('PC1 can ping its own gateway (Gig0/0.10)', () => {
    expect(topo.checkPing('192.168.10.10', '192.168.10.1').reachable).toBe(true)
  })

  it('PC2 can ping its own gateway (Gig0/0.20)', () => {
    expect(topo.checkPing('192.168.20.10', '192.168.20.1').reachable).toBe(true)
  })

  it('Gig0/0.10 subinterface is up with correct IP', () => {
    const subif = r1.getInterface('GigabitEthernet0/0.10')
    expect(subif).toBeTruthy()
    expect(subif.vlanTag).toBe(10)
    expect(subif.ip).toBe('192.168.10.1')
    expect(subif.status).toBe('up')
  })

  it('Gig0/0.20 subinterface is up with correct IP', () => {
    const subif = r1.getInterface('GigabitEthernet0/0.20')
    expect(subif).toBeTruthy()
    expect(subif.vlanTag).toBe(20)
    expect(subif.ip).toBe('192.168.20.1')
    expect(subif.status).toBe('up')
  })
})

// ── INVARIANT 1: parent physical interface must be `no shutdown` ──────────────

describe('ROAS invariant 1 — parent Gig0/0 must be no shutdown', () => {
  it('subinterfaces are down when parent is left shut (physShutdown=true)', () => {
    const { topo, r1 } = buildRoasTopo({ physShutdown: true })
    const sub10 = r1.getInterface('GigabitEthernet0/0.10')
    const sub20 = r1.getInterface('GigabitEthernet0/0.20')
    expect(sub10.status).toBe('down')
    expect(sub20.status).toBe('down')
  })

  it('inter-VLAN ping fails when physical parent is shut', () => {
    const { topo } = buildRoasTopo({ physShutdown: true })
    const r = topo.checkPing('192.168.10.10', '192.168.20.10')
    expect(r.reachable).toBe(false)
  })

  it('ping succeeds once parent is no-shutdown', () => {
    const { topo, eng, r1 } = buildRoasTopo({ physShutdown: true })
    run(eng, r1,
      'enable', 'configure terminal',
      'interface GigabitEthernet0/0', 'no shutdown', 'end')
    expect(topo.checkPing('192.168.10.10', '192.168.20.10').reachable).toBe(true)
  })

  it('shutting down parent drops all subinterfaces to down', () => {
    const { topo, eng, r1 } = buildRoasTopo()
    // Confirm they start up
    expect(r1.getInterface('GigabitEthernet0/0.10').status).toBe('up')
    expect(r1.getInterface('GigabitEthernet0/0.20').status).toBe('up')
    run(eng, r1,
      'enable', 'configure terminal',
      'interface GigabitEthernet0/0', 'shutdown', 'end')
    expect(r1.getInterface('GigabitEthernet0/0.10').status).toBe('down')
    expect(r1.getInterface('GigabitEthernet0/0.20').status).toBe('down')
  })
})

// ── INVARIANT 3: VLAN from encapsulation, not subif number ───────────────────

describe('ROAS invariant 3 — VLAN from encapsulation dot1Q, not subif number', () => {
  it('subif .99 with encapsulation dot1Q 20 correctly routes VLAN 20', () => {
    const topo  = new Topology()
    const eng   = new CLIEngine(topo)
    const pcEng = new PCCLIEngine(topo)
    const r1  = makeRouter()
    const sw1 = makeSwitch()
    const pc1 = makePc()
    const pc2 = makePc()
    topo.addDevice(r1); topo.addDevice(sw1)
    topo.addDevice(pc1); topo.addDevice(pc2)

    wire(topo, sw1, 'GigabitEthernet0/1', pc1, 'Ethernet0/0')
    wire(topo, sw1, 'GigabitEthernet0/2', pc2, 'Ethernet0/0')
    wire(topo, sw1, 'GigabitEthernet0/3', r1,  'GigabitEthernet0/0')

    run(eng, sw1,
      'enable', 'configure terminal',
      'interface GigabitEthernet0/1', 'switchport mode access', 'switchport access vlan 10', 'exit',
      'interface GigabitEthernet0/2', 'switchport mode access', 'switchport access vlan 20', 'exit',
      'interface GigabitEthernet0/3', 'switchport mode trunk', 'end')

    run(eng, r1,
      'enable', 'configure terminal',
      'interface GigabitEthernet0/0', 'no shutdown', 'exit',
      // Subinterface NUMBER 10 → VLAN 10
      'interface GigabitEthernet0/0.10',
      'encapsulation dot1Q 10',
      'ip address 192.168.10.1 255.255.255.0', 'exit',
      // Subinterface NUMBER 99 → VLAN 20 (number ≠ VLAN)
      'interface GigabitEthernet0/0.99',
      'encapsulation dot1Q 20',
      'ip address 192.168.20.1 255.255.255.0', 'exit',
      'end')

    run(pcEng, pc1, 'ip addr add 192.168.10.10/24 dev eth0', 'ip link set eth0 up',
      'ip route add default via 192.168.10.1')
    run(pcEng, pc2, 'ip addr add 192.168.20.10/24 dev eth0', 'ip link set eth0 up',
      'ip route add default via 192.168.20.1')

    // VLAN 20 gateway is reachable via Gig0/0.99 (encap 20), not Gig0/0.20
    expect(topo.checkPing('192.168.20.10', '192.168.20.1').reachable).toBe(true)
    // Inter-VLAN routing works
    expect(topo.checkPing('192.168.10.10', '192.168.20.10').reachable).toBe(true)
  })
})

// ── INVARIANT 3: no encapsulation → subif not usable ─────────────────────────

describe('ROAS invariant 3 — subif without encapsulation cannot route', () => {
  it('subif without encapsulation stays down', () => {
    const { r1 } = buildRoasTopo({ missingEncap20: true })
    const sub20 = r1.getInterface('GigabitEthernet0/0.20')
    // No encapsulation set → status must be down
    expect(sub20.vlanTag).toBeNull()
    expect(sub20.status).toBe('down')
  })

  it('PC2 (VLAN20) cannot ping when Gig0/0.20 has no encapsulation', () => {
    const { topo } = buildRoasTopo({ missingEncap20: true })
    const r = topo.checkPing('192.168.10.10', '192.168.20.10')
    expect(r.reachable).toBe(false)
  })

  it('PC1 (VLAN10) can still ping its own gateway when only VLAN20 subif is broken', () => {
    const { topo } = buildRoasTopo({ missingEncap20: true })
    // VLAN 10 is fine
    expect(topo.checkPing('192.168.10.10', '192.168.10.1').reachable).toBe(true)
  })

  it('ping succeeds after adding encapsulation', () => {
    const { topo, eng, r1 } = buildRoasTopo({ missingEncap20: true })
    run(eng, r1,
      'enable', 'configure terminal',
      'interface GigabitEthernet0/0.20',
      'encapsulation dot1Q 20',
      'end')
    expect(topo.checkPing('192.168.10.10', '192.168.20.10').reachable).toBe(true)
  })
})

// ── INVARIANT 4: switch–router link must be trunk ────────────────────────────

describe('ROAS invariant 4 — switch–router link must be trunk', () => {
  it('inter-VLAN ping fails when switch port to router is access (not trunk)', () => {
    const { topo } = buildRoasTopo({ trunkOnSwitch: false })
    const r = topo.checkPing('192.168.10.10', '192.168.20.10')
    expect(r.reachable).toBe(false)
  })

  it('vlan_isolated when access link blocks tagged VLAN traffic', () => {
    const { topo } = buildRoasTopo({ trunkOnSwitch: false })
    // PC1 is in VLAN10 but the switch port to the router is access (default VLAN1)
    // Tagged VLAN10 frames can't exit via an access port carrying VLAN1
    const r = topo.checkPing('192.168.10.10', '192.168.10.1')
    expect(r.reachable).toBe(false)
  })

  it('changing to trunk fixes it', () => {
    const { topo, eng, sw1 } = buildRoasTopo({ trunkOnSwitch: false })
    run(eng, sw1,
      'enable', 'configure terminal',
      'interface GigabitEthernet0/3', 'switchport mode trunk', 'end')
    expect(topo.checkPing('192.168.10.10', '192.168.20.10').reachable).toBe(true)
  })
})

// ── INVARIANT 7: vlan_isolated — switch-only VLAN isolation ──────────────────

describe('vlan_isolated — switch-only, no router', () => {
  it('two hosts in different VLANs on same L2 switch → vlan_isolated', () => {
    const topo  = new Topology()
    const eng   = new CLIEngine(topo)
    const pcEng = new PCCLIEngine(topo)
    const sw1 = makeSwitch()
    const pc1 = makePc()
    const pc2 = makePc()
    topo.addDevice(sw1); topo.addDevice(pc1); topo.addDevice(pc2)
    wire(topo, sw1, 'GigabitEthernet0/1', pc1, 'Ethernet0/0')
    wire(topo, sw1, 'GigabitEthernet0/2', pc2, 'Ethernet0/0')
    run(eng, sw1,
      'enable', 'configure terminal',
      'interface GigabitEthernet0/1', 'switchport mode access', 'switchport access vlan 10', 'exit',
      'interface GigabitEthernet0/2', 'switchport mode access', 'switchport access vlan 20', 'end')
    run(pcEng, pc1, 'ip addr add 192.168.1.10/24 dev eth0', 'ip link set eth0 up')
    run(pcEng, pc2, 'ip addr add 192.168.1.20/24 dev eth0', 'ip link set eth0 up')

    const r = topo.checkPing('192.168.1.10', '192.168.1.20')
    expect(r.reachable).toBe(false)
    expect(r.failureReason).toBe('vlan_isolated')
  })

  it('same VLAN on same L2 switch → succeeds (vlan_isolated must NOT fire)', () => {
    const topo  = new Topology()
    const pcEng = new PCCLIEngine(topo)
    const sw1 = makeSwitch()
    const pc1 = makePc()
    const pc2 = makePc()
    topo.addDevice(sw1); topo.addDevice(pc1); topo.addDevice(pc2)
    wire(topo, sw1, 'GigabitEthernet0/1', pc1, 'Ethernet0/0')
    wire(topo, sw1, 'GigabitEthernet0/2', pc2, 'Ethernet0/0')
    // Both on default VLAN 1 (unconfigured)
    run(pcEng, pc1, 'ip addr add 192.168.1.10/24 dev eth0', 'ip link set eth0 up')
    run(pcEng, pc2, 'ip addr add 192.168.1.20/24 dev eth0', 'ip link set eth0 up')
    expect(topo.checkPing('192.168.1.10', '192.168.1.20').reachable).toBe(true)
  })
})

// ── INVARIANT 9: bidirectional rule still applies ────────────────────────────

describe('ROAS bidirectional — no_return_path when return gateway is missing', () => {
  it('fails when PC2 has no default route (return path broken)', () => {
    const topo  = new Topology()
    const eng   = new CLIEngine(topo)
    const pcEng = new PCCLIEngine(topo)
    const r1 = makeRouter()
    const sw1 = makeSwitch()
    const pc1 = makePc()
    const pc2 = makePc()
    topo.addDevice(r1); topo.addDevice(sw1)
    topo.addDevice(pc1); topo.addDevice(pc2)

    wire(topo, sw1, 'GigabitEthernet0/1', pc1, 'Ethernet0/0')
    wire(topo, sw1, 'GigabitEthernet0/2', pc2, 'Ethernet0/0')
    wire(topo, sw1, 'GigabitEthernet0/3', r1,  'GigabitEthernet0/0')

    run(eng, sw1,
      'enable', 'configure terminal',
      'interface GigabitEthernet0/1', 'switchport mode access', 'switchport access vlan 10', 'exit',
      'interface GigabitEthernet0/2', 'switchport mode access', 'switchport access vlan 20', 'exit',
      'interface GigabitEthernet0/3', 'switchport mode trunk', 'end')

    run(eng, r1,
      'enable', 'configure terminal',
      'interface GigabitEthernet0/0', 'no shutdown', 'exit',
      'interface GigabitEthernet0/0.10', 'encapsulation dot1Q 10',
      'ip address 192.168.10.1 255.255.255.0', 'exit',
      'interface GigabitEthernet0/0.20', 'encapsulation dot1Q 20',
      'ip address 192.168.20.1 255.255.255.0', 'exit',
      'end')

    // PC1 has default route; PC2 does NOT
    run(pcEng, pc1, 'ip addr add 192.168.10.10/24 dev eth0', 'ip link set eth0 up',
      'ip route add default via 192.168.10.1')
    run(pcEng, pc2, 'ip addr add 192.168.20.10/24 dev eth0', 'ip link set eth0 up')
    // no default route on pc2

    const r = topo.checkPing('192.168.10.10', '192.168.20.10')
    expect(r.reachable).toBe(false)
    // Forward path succeeds, but return (PC2 → PC1) has no gateway → no_return_path
    expect(r.failureReason).toBe('no_return_path')
  })
})

// ── CLI: subinterface creation, encapsulation, show commands ─────────────────

describe('CLIEngine — subinterface creation and show commands', () => {
  let topo, eng, r1

  beforeEach(() => {
    topo = new Topology()
    eng  = new CLIEngine(topo)
    r1   = makeRouter()
    topo.addDevice(r1)
  })

  it('interface GigabitEthernet0/0.10 creates subinterface in subif_config mode', () => {
    run(eng, r1, 'enable', 'configure terminal', 'interface GigabitEthernet0/0.10')
    expect(r1.config_mode).toBe('subif_config')
    expect(r1.active_interface).toBe('GigabitEthernet0/0.10')
    const subif = r1.getInterface('GigabitEthernet0/0.10')
    expect(subif).toBeTruthy()
    expect(subif.parent).toBe('GigabitEthernet0/0')
  })

  it('abbreviated: gi0/0.10 normalizes to GigabitEthernet0/0.10', () => {
    run(eng, r1, 'enable', 'configure terminal', 'interface gi0/0.10')
    expect(r1.active_interface).toBe('GigabitEthernet0/0.10')
  })

  it('encapsulation dot1Q sets vlanTag', () => {
    run(eng, r1, 'enable', 'configure terminal',
      'interface GigabitEthernet0/0.10',
      'encapsulation dot1Q 10')
    const subif = r1.getInterface('GigabitEthernet0/0.10')
    expect(subif.vlanTag).toBe(10)
    expect(subif.native).toBe(false)
  })

  it('encapsulation dot1Q 10 native sets native flag', () => {
    run(eng, r1, 'enable', 'configure terminal',
      'interface GigabitEthernet0/0.10',
      'encapsulation dot1Q 10 native')
    expect(r1.getInterface('GigabitEthernet0/0.10').native).toBe(true)
  })

  it('no encapsulation dot1q clears vlanTag', () => {
    run(eng, r1, 'enable', 'configure terminal',
      'interface GigabitEthernet0/0.10',
      'encapsulation dot1Q 10',
      'no encapsulation dot1q')
    expect(r1.getInterface('GigabitEthernet0/0.10').vlanTag).toBeNull()
  })

  it('ip address on subinterface is accepted', () => {
    run(eng, r1, 'enable', 'configure terminal',
      'interface GigabitEthernet0/0.10',
      'encapsulation dot1Q 10',
      'ip address 192.168.10.1 255.255.255.0')
    const subif = r1.getInterface('GigabitEthernet0/0.10')
    expect(subif.ip).toBe('192.168.10.1')
    expect(subif.subnet_mask).toBe('255.255.255.0')
  })

  it('subif rejected on a switch (switches do not have subinterfaces)', () => {
    const sw = new Device({ type: 'switch', model: 'SW', portCount: 4, portPrefix: 'GigabitEthernet0/', portStart: 1 })
    sw.powered = true
    topo.addDevice(sw)
    run(eng, sw, 'enable', 'configure terminal')
    const out = eng.execute(sw, 'interface GigabitEthernet0/1.10')
    expect(out.join(' ')).toMatch(/not supported/i)
  })

  it('no interface GigabitEthernet0/0.10 deletes the subinterface', () => {
    run(eng, r1, 'enable', 'configure terminal',
      'interface GigabitEthernet0/0.10', 'encapsulation dot1Q 10', 'exit',
      'no interface GigabitEthernet0/0.10')
    expect(r1.getInterface('GigabitEthernet0/0.10')).toBeNull()
  })

  it('show running-config includes subinterface encapsulation block', () => {
    run(eng, r1, 'enable', 'configure terminal',
      'interface GigabitEthernet0/0.10',
      'encapsulation dot1Q 10',
      'ip address 192.168.10.1 255.255.255.0', 'end')
    run(eng, r1, 'enable')
    const out = eng.execute(r1, 'show running-config').join('\n')
    expect(out).toMatch(/interface GigabitEthernet0\/0\.10/)
    expect(out).toMatch(/encapsulation dot1Q 10/)
    expect(out).toMatch(/ip address 192\.168\.10\.1/)
  })

  it('show ip interface brief lists subinterfaces', () => {
    run(eng, r1, 'enable', 'configure terminal',
      'interface GigabitEthernet0/0.10',
      'encapsulation dot1Q 10',
      'ip address 192.168.10.1 255.255.255.0', 'end')
    run(eng, r1, 'enable')
    const out = eng.execute(r1, 'show ip interface brief').join('\n')
    expect(out).toMatch(/GigabitEthernet0\/0\.10/)
    expect(out).toMatch(/192\.168\.10\.1/)
  })
})

// ── CLI: no-forms added in this sprint ────────────────────────────────────────

describe('CLIEngine — new no-forms', () => {
  let topo, eng

  beforeEach(() => {
    topo = new Topology()
    eng  = new CLIEngine(topo)
  })

  it('no vlan <id> removes VLAN from switch database', () => {
    const sw = makeSwitch()
    topo.addDevice(sw)
    run(eng, sw, 'enable', 'configure terminal', 'vlan 10')
    expect(sw.vlan_db[10]).toBeTruthy()
    run(eng, sw, 'end', 'enable', 'configure terminal', 'no vlan 10')
    expect(sw.vlan_db[10]).toBeUndefined()
  })

  it('no interface vlan <id> deletes SVI', () => {
    const sw = makeSwitch()
    topo.addDevice(sw)
    run(eng, sw, 'enable', 'configure terminal',
      'interface vlan 10', 'ip address 10.0.0.1 255.255.255.0', 'end')
    expect(sw.interfaces.find(i => i.name === 'Vlan10')).toBeTruthy()
    run(eng, sw, 'enable', 'configure terminal', 'no interface vlan 10')
    expect(sw.interfaces.find(i => i.name === 'Vlan10')).toBeUndefined()
  })

  it('no switchport access vlan resets port to VLAN 1', () => {
    const sw = makeSwitch()
    topo.addDevice(sw)
    run(eng, sw, 'enable', 'configure terminal',
      'interface GigabitEthernet0/1', 'switchport mode access', 'switchport access vlan 10')
    expect(sw.getInterface('GigabitEthernet0/1').vlan).toBe(10)
    run(eng, sw, 'no switchport access vlan')
    expect(sw.getInterface('GigabitEthernet0/1').vlan).toBe(1)
  })
})

// ── show interfaces trunk ─────────────────────────────────────────────────────

describe('CLIEngine — show interfaces trunk', () => {
  it('shows active trunk ports on switch', () => {
    const sw = makeSwitch()
    const topo = new Topology()
    const eng  = new CLIEngine(topo)
    topo.addDevice(sw)
    const r1 = makeRouter()
    topo.addDevice(r1)
    wire(topo, sw, 'GigabitEthernet0/3', r1, 'GigabitEthernet0/0')
    run(eng, sw, 'enable', 'configure terminal',
      'interface GigabitEthernet0/3', 'switchport mode trunk', 'end')
    run(eng, r1, 'enable', 'configure terminal',
      'interface GigabitEthernet0/0', 'no shutdown', 'end')
    run(eng, sw, 'enable')
    const out = eng.execute(sw, 'show interfaces trunk').join('\n')
    expect(out).toMatch(/trunking/)
    expect(out).toMatch(/Gi0\/3/)
  })
})

// ── REGRESSION: existing tests should not be affected ────────────────────────

describe('ROAS regression — Mission 001-style topology still works', () => {
  it('same-subnet ping through unconfigured switch is unaffected', () => {
    const topo  = new Topology()
    const pcEng = new PCCLIEngine(topo)
    const sw1 = makeSwitch(4)
    const pc1 = makePc()
    const pc2 = makePc()
    topo.addDevice(sw1); topo.addDevice(pc1); topo.addDevice(pc2)
    wire(topo, sw1, 'GigabitEthernet0/1', pc1, 'Ethernet0/0')
    wire(topo, sw1, 'GigabitEthernet0/2', pc2, 'Ethernet0/0')
    run(pcEng, pc1, 'ip addr add 192.168.1.10/24 dev eth0', 'ip link set eth0 up')
    run(pcEng, pc2, 'ip addr add 192.168.1.11/24 dev eth0', 'ip link set eth0 up')
    expect(topo.checkPing('192.168.1.10', '192.168.1.11').reachable).toBe(true)
  })

  it('two-router static routing still works', () => {
    const topo  = new Topology()
    const eng   = new CLIEngine(topo)
    const pcEng = new PCCLIEngine(topo)
    const r1 = makeRouter(); const r2 = makeRouter()
    const pc1 = makePc();    const pc2 = makePc()
    topo.addDevice(r1); topo.addDevice(r2); topo.addDevice(pc1); topo.addDevice(pc2)
    wire(topo, pc1, 'Ethernet0/0', r1, 'GigabitEthernet0/0')
    wire(topo, r1,  'GigabitEthernet0/1', r2, 'GigabitEthernet0/1')
    wire(topo, r2,  'GigabitEthernet0/0', pc2, 'Ethernet0/0')
    run(eng, r1,
      'enable', 'configure terminal',
      'interface GigabitEthernet0/0', 'ip address 192.168.1.1 255.255.255.0', 'no shutdown', 'exit',
      'interface GigabitEthernet0/1', 'ip address 10.0.0.1 255.255.255.252', 'no shutdown', 'exit',
      'ip route 192.168.2.0 255.255.255.0 10.0.0.2', 'end')
    run(eng, r2,
      'enable', 'configure terminal',
      'interface GigabitEthernet0/1', 'ip address 10.0.0.2 255.255.255.252', 'no shutdown', 'exit',
      'interface GigabitEthernet0/0', 'ip address 192.168.2.1 255.255.255.0', 'no shutdown', 'exit',
      'ip route 192.168.1.0 255.255.255.0 10.0.0.1', 'end')
    run(pcEng, pc1, 'ip addr add 192.168.1.10/24 dev eth0', 'ip link set eth0 up',
      'ip route add default via 192.168.1.1')
    run(pcEng, pc2, 'ip addr add 192.168.2.10/24 dev eth0', 'ip link set eth0 up',
      'ip route add default via 192.168.2.1')
    expect(topo.checkPing('192.168.1.10', '192.168.2.10').reachable).toBe(true)
  })
})
