/**
 * Unit tests for CLIEngine (IOS) and PCCLIEngine (Linux).
 * Tests focus on correctness-critical commands — acceptance/rejection,
 * `no` reversals, state machine transitions, and the L2/L3 device contract.
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
function makeSwitch(portCount = 4) {
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

const INVALID = /invalid input/i

// ── IOS CLIEngine — L2 switch invariants ─────────────────────────────────────

describe('CLIEngine — L2 switch: ip address rejected on physical port', () => {
  let sw, eng, topo

  beforeEach(() => {
    topo = new Topology()
    eng  = new CLIEngine(topo)
    sw   = makeSwitch()
    topo.addDevice(sw)
    run(eng, sw, 'enable', 'configure terminal', 'interface GigabitEthernet0/1')
  })

  it('rejects ip address on a physical switchport', () => {
    const out = eng.execute(sw, 'ip address 192.168.1.1 255.255.255.0')
    expect(out.join('\n')).toMatch(INVALID)
  })

  it('does NOT reject ip address on an SVI', () => {
    run(eng, sw, 'exit', 'interface vlan 1')
    const out = eng.execute(sw, 'ip address 192.168.1.1 255.255.255.0')
    expect(out.join('\n')).not.toMatch(INVALID)
    const svi = sw.interfaces.find(i => i.svi && i.name === 'Vlan1')
    expect(svi?.ip).toBe('192.168.1.1')
  })
})

describe('CLIEngine — L2 switch: ip route rejected', () => {
  it('rejects ip route on a switch', () => {
    const topo = new Topology()
    const eng  = new CLIEngine(topo)
    const sw   = makeSwitch()
    topo.addDevice(sw)
    run(eng, sw, 'enable', 'configure terminal')
    const out = eng.execute(sw, 'ip route 0.0.0.0 0.0.0.0 192.168.1.1')
    expect(out.join('\n')).toMatch(INVALID)
  })
})

// ── IOS CLIEngine — router interface default state ────────────────────────────

describe('CLIEngine — router interface defaults to admin_down', () => {
  it('router Gig0/0 starts admin_down', () => {
    const r = makeRouter()
    expect(r.getInterface('GigabitEthernet0/0').status).toBe('admin_down')
  })

  it('no shutdown with no cable keeps interface down (no carrier)', () => {
    const topo = new Topology()
    const eng  = new CLIEngine(topo)
    const r    = makeRouter()
    topo.addDevice(r)
    run(eng, r, 'enable', 'configure terminal',
      'interface GigabitEthernet0/0', 'ip address 192.168.1.1 255.255.255.0', 'no shutdown')
    expect(r.getInterface('GigabitEthernet0/0').status).toBe('down')
  })

  it('no shutdown with cable + up peer brings interface up', () => {
    const topo = new Topology()
    const eng  = new CLIEngine(topo)
    const r1   = makeRouter()
    const r2   = makeRouter()
    topo.addDevice(r1); topo.addDevice(r2)
    topo.connect(`${r1.id}:GigabitEthernet0/0`, `${r2.id}:GigabitEthernet0/0`)
    // Bring R2 up first so peer is not admin_down
    run(eng, r2,
      'enable', 'configure terminal',
      'interface GigabitEthernet0/0', 'ip address 192.168.1.2 255.255.255.0', 'no shutdown', 'end')
    run(eng, r1,
      'enable', 'configure terminal',
      'interface GigabitEthernet0/0', 'ip address 192.168.1.1 255.255.255.0', 'no shutdown', 'end')
    expect(r1.getInterface('GigabitEthernet0/0').status).toBe('up')
    expect(r2.getInterface('GigabitEthernet0/0').status).toBe('up')
  })
})

// ── IOS CLIEngine — shutdown propagates carrier-loss (bug fix guard) ──────────

describe('CLIEngine — shutdown propagates carrier-loss to peer', () => {
  let topo, eng, r1, r2

  beforeEach(() => {
    topo = new Topology()
    eng  = new CLIEngine(topo)
    r1   = makeRouter()
    r2   = makeRouter()
    topo.addDevice(r1); topo.addDevice(r2)
    topo.connect(`${r1.id}:GigabitEthernet0/0`, `${r2.id}:GigabitEthernet0/0`)
    run(eng, r1,
      'enable', 'configure terminal',
      'interface GigabitEthernet0/0', 'ip address 192.168.1.1 255.255.255.0', 'no shutdown', 'end')
    run(eng, r2,
      'enable', 'configure terminal',
      'interface GigabitEthernet0/0', 'ip address 192.168.1.2 255.255.255.0', 'no shutdown', 'end')
  })

  it('both interfaces up before shutdown', () => {
    expect(r1.getInterface('GigabitEthernet0/0').status).toBe('up')
    expect(r2.getInterface('GigabitEthernet0/0').status).toBe('up')
  })

  it('R1 shutdown brings R2 interface to down', () => {
    run(eng, r1, 'enable', 'configure terminal', 'interface GigabitEthernet0/0', 'shutdown')
    expect(r1.getInterface('GigabitEthernet0/0').status).toBe('admin_down')
    expect(r2.getInterface('GigabitEthernet0/0').status).toBe('down')
  })

  it('no shutdown restores both interfaces to up', () => {
    run(eng, r1, 'enable', 'configure terminal', 'interface GigabitEthernet0/0', 'shutdown')
    run(eng, r1, 'interface GigabitEthernet0/0', 'no shutdown')
    expect(r1.getInterface('GigabitEthernet0/0').status).toBe('up')
    expect(r2.getInterface('GigabitEthernet0/0').status).toBe('up')
  })
})

// ── IOS CLIEngine — overlapping subnet rejection (bug fix guard) ──────────────

describe('CLIEngine — overlapping subnet rejected on same router', () => {
  let topo, eng, r

  beforeEach(() => {
    topo = new Topology()
    eng  = new CLIEngine(topo)
    r    = makeRouter()
    topo.addDevice(r)
    run(eng, r,
      'enable', 'configure terminal',
      'interface GigabitEthernet0/0', 'ip address 192.168.1.1 255.255.255.0', 'no shutdown', 'exit')
  })

  it('rejects same subnet on a second interface', () => {
    run(eng, r, 'interface GigabitEthernet0/1')
    const out = eng.execute(r, 'ip address 192.168.1.254 255.255.255.0')
    expect(out.join('\n')).toMatch(/overlaps/i)
  })

  it('rejects a subnet that contains the existing interface', () => {
    // /24 would contain the existing /24 — same network
    run(eng, r, 'interface GigabitEthernet0/2')
    const out = eng.execute(r, 'ip address 192.168.1.2 255.255.255.0')
    expect(out.join('\n')).toMatch(/overlaps/i)
  })

  it('accepts a non-overlapping subnet on a second interface', () => {
    run(eng, r, 'interface GigabitEthernet0/1')
    const out = eng.execute(r, 'ip address 10.0.0.1 255.255.255.252')
    expect(out.join('\n')).not.toMatch(/overlaps/i)
    expect(r.getInterface('GigabitEthernet0/1').ip).toBe('10.0.0.1')
  })
})

// ── IOS CLIEngine — ip address validation ────────────────────────────────────

describe('CLIEngine — ip address rejects network and broadcast', () => {
  let topo, eng, r

  beforeEach(() => {
    topo = new Topology()
    eng  = new CLIEngine(topo)
    r    = makeRouter()
    topo.addDevice(r)
    run(eng, r, 'enable', 'configure terminal', 'interface GigabitEthernet0/0')
  })

  it('rejects the network address (all host bits 0)', () => {
    const out = eng.execute(r, 'ip address 192.168.1.0 255.255.255.0')
    expect(out.join('\n')).toMatch(/network address/i)
  })

  it('rejects the broadcast address (all host bits 1)', () => {
    const out = eng.execute(r, 'ip address 192.168.1.255 255.255.255.0')
    expect(out.join('\n')).toMatch(/broadcast address/i)
  })

  it('rejects a discontiguous mask', () => {
    const out = eng.execute(r, 'ip address 192.168.1.1 255.0.255.0')
    expect(out.join('\n')).toMatch(/invalid mask/i)
  })

  it('accepts a /31 point-to-point address (RFC 3021)', () => {
    const out = eng.execute(r, 'ip address 10.0.0.0 255.255.255.254')
    expect(out.join('\n')).not.toMatch(INVALID)
    expect(r.getInterface('GigabitEthernet0/0').ip).toBe('10.0.0.0')
  })

  it('accepts a /32 host route', () => {
    const out = eng.execute(r, 'ip address 10.0.0.1 255.255.255.255')
    expect(out.join('\n')).not.toMatch(INVALID)
    expect(r.getInterface('GigabitEthernet0/0').ip).toBe('10.0.0.1')
  })
})

// ── IOS CLIEngine — no ip address reversal ───────────────────────────────────

describe('CLIEngine — no ip address removes the IP', () => {
  it('clears ip and mask', () => {
    const topo = new Topology()
    const eng  = new CLIEngine(topo)
    const r    = makeRouter()
    topo.addDevice(r)
    run(eng, r,
      'enable', 'configure terminal',
      'interface GigabitEthernet0/0', 'ip address 192.168.1.1 255.255.255.0')
    expect(r.getInterface('GigabitEthernet0/0').ip).toBe('192.168.1.1')
    run(eng, r, 'no ip address')
    expect(r.getInterface('GigabitEthernet0/0').ip).toBeNull()
    expect(r.getInterface('GigabitEthernet0/0').subnet_mask).toBeNull()
  })
})

// ── IOS CLIEngine — no ip route removal ──────────────────────────────────────

describe('CLIEngine — no ip route removes matching route', () => {
  it('removes the correct route and leaves others', () => {
    const topo = new Topology()
    const eng  = new CLIEngine(topo)
    const r    = makeRouter()
    topo.addDevice(r)
    run(eng, r,
      'enable', 'configure terminal',
      'ip route 192.168.1.0 255.255.255.0 10.0.0.1',
      'ip route 192.168.2.0 255.255.255.0 10.0.0.1')
    expect(r.routing_table).toHaveLength(2)
    run(eng, r, 'no ip route 192.168.1.0 255.255.255.0 10.0.0.1')
    expect(r.routing_table).toHaveLength(1)
    expect(r.routing_table[0].network).toBe('192.168.2.0')
  })
})

// ── IOS CLIEngine — state machine ────────────────────────────────────────────

describe('CLIEngine — IOS mode state machine', () => {
  let topo, eng, r

  beforeEach(() => {
    topo = new Topology()
    eng  = new CLIEngine(topo)
    r    = makeRouter()
    topo.addDevice(r)
  })

  it('starts in user_exec', () => expect(r.config_mode).toBe('user_exec'))

  it('enable → priv_exec', () => {
    eng.execute(r, 'enable')
    expect(r.config_mode).toBe('priv_exec')
  })

  it('configure terminal → global_config', () => {
    run(eng, r, 'enable', 'configure terminal')
    expect(r.config_mode).toBe('global_config')
  })

  it('interface X → interface_config', () => {
    run(eng, r, 'enable', 'configure terminal', 'interface GigabitEthernet0/0')
    expect(r.config_mode).toBe('interface_config')
    expect(r.active_interface).toBe('GigabitEthernet0/0')
  })

  it('exit from interface_config → global_config', () => {
    run(eng, r, 'enable', 'configure terminal', 'interface GigabitEthernet0/0', 'exit')
    expect(r.config_mode).toBe('global_config')
  })

  it('end from interface_config → priv_exec', () => {
    run(eng, r, 'enable', 'configure terminal', 'interface GigabitEthernet0/0', 'end')
    expect(r.config_mode).toBe('priv_exec')
  })

  it('interface requires global_config mode', () => {
    eng.execute(r, 'enable')
    const out = eng.execute(r, 'interface GigabitEthernet0/0')
    expect(out.join('\n')).toMatch(INVALID)
  })
})

// ── IOS CLIEngine — duplicate IP rejected across devices ─────────────────────

describe('CLIEngine — duplicate IP across devices is rejected', () => {
  it('second device cannot use an IP already assigned to another', () => {
    const topo = new Topology()
    const eng  = new CLIEngine(topo)
    const r1   = makeRouter()
    const r2   = makeRouter()
    topo.addDevice(r1); topo.addDevice(r2)
    run(eng, r1,
      'enable', 'configure terminal',
      'interface GigabitEthernet0/0', 'ip address 192.168.1.1 255.255.255.0')
    run(eng, r2, 'enable', 'configure terminal', 'interface GigabitEthernet0/0')
    const out = eng.execute(r2, 'ip address 192.168.1.1 255.255.255.0')
    expect(out.join('\n')).toMatch(/already assigned/i)
  })
})

// ── PCCLIEngine — ip link set down propagates carrier-loss ──────────────────

describe('PCCLIEngine — ip link set down propagates carrier-loss to peer', () => {
  it('peer interface drops to down after ip link set eth0 down', () => {
    const topo  = new Topology()
    const eng   = new CLIEngine(topo)
    const pcEng = new PCCLIEngine(topo)
    const r     = makeRouter()
    const pc    = makePc()
    topo.addDevice(r); topo.addDevice(pc)
    topo.connect(`${r.id}:GigabitEthernet0/0`, `${pc.id}:Ethernet0/0`)
    run(eng, r,
      'enable', 'configure terminal',
      'interface GigabitEthernet0/0', 'ip address 192.168.1.1 255.255.255.0', 'no shutdown', 'end')
    run(pcEng, pc, 'ip addr add 192.168.1.10/24 dev eth0', 'ip link set eth0 up')
    expect(r.getInterface('GigabitEthernet0/0').status).toBe('up')
    run(pcEng, pc, 'ip link set eth0 down')
    expect(pc.getInterface('Ethernet0/0').status).toBe('admin_down')
    expect(r.getInterface('GigabitEthernet0/0').status).toBe('down')
  })
})

// ── PCCLIEngine — ip addr add rejects network/broadcast ─────────────────────

describe('PCCLIEngine — ip addr add rejects network and broadcast', () => {
  it('rejects the network address', () => {
    const topo  = new Topology()
    const pcEng = new PCCLIEngine(topo)
    const pc    = makePc()
    topo.addDevice(pc)
    const out = pcEng.execute(pc, 'ip addr add 192.168.1.0/24 dev eth0')
    expect(out.join('\n')).toMatch(/network address/i)
  })

  it('rejects the broadcast address', () => {
    const topo  = new Topology()
    const pcEng = new PCCLIEngine(topo)
    const pc    = makePc()
    topo.addDevice(pc)
    const out = pcEng.execute(pc, 'ip addr add 192.168.1.255/24 dev eth0')
    expect(out.join('\n')).toMatch(/broadcast address/i)
  })
})

// ── PCCLIEngine — ip route add default / del ─────────────────────────────────

describe('PCCLIEngine — ip route add default / del', () => {
  let topo, pcEng, pc

  beforeEach(() => {
    topo  = new Topology()
    pcEng = new PCCLIEngine(topo)
    pc    = makePc()
    topo.addDevice(pc)
  })

  it('adds a default route and shows it in routing table', () => {
    pcEng.execute(pc, 'ip route add default via 192.168.1.1')
    const entry = pc.routing_table.find(r => r.network === '0.0.0.0')
    expect(entry).toBeTruthy()
    expect(entry.next_hop).toBe('192.168.1.1')
  })

  it('deletes the default route', () => {
    pcEng.execute(pc, 'ip route add default via 192.168.1.1')
    pcEng.execute(pc, 'ip route del default')
    expect(pc.routing_table.find(r => r.network === '0.0.0.0')).toBeUndefined()
  })
})

// ── Switch — switchport defaults ──────────────────────────────────────────────

describe('Switch — physical port defaults', () => {
  it('starts down (no cable), not admin_down', () => {
    const sw = makeSwitch()
    const p  = sw.getInterface('GigabitEthernet0/1')
    expect(p.status).toBe('down')
    expect(p.switchport_mode).toBe('access')
    expect(p.vlan).toBe(1)
  })
})

// ── show vlan brief — membership is config, not link-state ───────────────────

describe('show vlan brief — access port listed by VLAN assignment, not link state', () => {
  let sw, eng, topo

  beforeEach(() => {
    topo = new Topology()
    eng  = new CLIEngine(topo)
    sw   = makeSwitch(4)
    topo.devices.set(sw.id, sw)
    run(eng, sw, 'enable', 'configure terminal')
  })

  it('lists a down access port under its assigned VLAN (core fix)', () => {
    run(eng, sw, 'interface GigabitEthernet0/1', 'switchport mode access', 'switchport access vlan 10', 'exit')
    const p = sw.getInterface('GigabitEthernet0/1')
    expect(p.status).toBe('down')   // no cable — confirms port is down
    const out = run(eng, sw, 'do show vlan brief').join('\n')
    expect(out).toMatch(/10/)
    expect(out).toMatch(/Gi0\/1/)
  })

  it('still lists the port under its VLAN after the link comes up (no regression)', () => {
    const sw2 = makeSwitch(4)
    topo.devices.set(sw2.id, sw2)
    const eng2 = new CLIEngine(topo)
    // Connect the ports so the link can come up
    topo.connect(`${sw.id}:GigabitEthernet0/1`, `${sw2.id}:GigabitEthernet0/1`)
    run(eng, sw, 'interface GigabitEthernet0/1', 'switchport mode access', 'switchport access vlan 10', 'exit')
    expect(sw.getInterface('GigabitEthernet0/1').status).toBe('up')
    const out = run(eng, sw, 'do show vlan brief').join('\n')
    expect(out).toMatch(/10/)
    expect(out).toMatch(/Gi0\/1/)
  })

  it('trunk port is NOT listed under any VLAN', () => {
    run(eng, sw, 'interface GigabitEthernet0/2', 'switchport mode trunk', 'exit')
    const out = run(eng, sw, 'do show vlan brief').join('\n')
    expect(out).not.toMatch(/Gi0\/2/)
  })

  it('moving a port from VLAN 10 to VLAN 20 updates the listing', () => {
    // Create both VLANs in vlan_db first so they appear in show vlan brief
    // even when a VLAN has zero ports assigned (matches real IOS behaviour)
    run(eng, sw, 'vlan 10', 'exit', 'vlan 20', 'exit')
    run(eng, sw, 'interface GigabitEthernet0/3', 'switchport mode access', 'switchport access vlan 10', 'exit')
    let out = run(eng, sw, 'do show vlan brief').join('\n')
    expect(out).toMatch(/Gi0\/3/)  // port appears somewhere in output
    expect(out.split('\n').find(l => l.match(/^10\s/))).toMatch(/Gi0\/3/)  // specifically under VLAN 10

    run(eng, sw, 'interface GigabitEthernet0/3', 'switchport access vlan 20', 'exit')
    out = run(eng, sw, 'do show vlan brief').join('\n')
    const lines = out.split('\n')
    const vlan10Line = lines.find(l => l.match(/^10\s/))
    const vlan20Line = lines.find(l => l.match(/^20\s/))
    expect(vlan10Line).toBeDefined()
    expect(vlan10Line).not.toMatch(/Gi0\/3/)
    expect(vlan20Line).toBeDefined()
    expect(vlan20Line).toMatch(/Gi0\/3/)
  })
})
