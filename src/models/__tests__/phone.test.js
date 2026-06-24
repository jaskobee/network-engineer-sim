/**
 * IP Phone device tests.
 *
 * P1 — Phone has type 'phone', one Ethernet interface, no router DHCP-server state
 * P2 — Phone on switch access VLAN gets an address via dhclient from a local DHCP pool
 * P3 — DHCP-assigned phone can ping another DHCP-assigned host in the same VLAN
 * P4 — Regression: PC and server device construction still works correctly
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { Device } from '../Device.js'
import { Topology } from '../Topology.js'
import { CLIEngine } from '../CLIEngine.js'
import { PCCLIEngine } from '../PCCLIEngine.js'

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeRouter() {
  const d = new Device({ type: 'router', model: 'R-test', portCount: 4, portPrefix: 'GigabitEthernet0/', portStart: 0 })
  d.powered = true
  return d
}

function makeSwitch() {
  const d = new Device({ type: 'switch', model: 'SW-test', portCount: 8, portPrefix: 'FastEthernet0/', portStart: 1 })
  d.powered = true
  return d
}

function makePc() {
  const d = new Device({ type: 'pc', model: 'PC-test', portCount: 1, portPrefix: 'Ethernet0/', portStart: 0 })
  d.powered = true
  return d
}

function makePhone() {
  const d = new Device({ type: 'phone', model: 'GENERIC-PHONE', portCount: 1, portPrefix: 'Ethernet0/', portStart: 0 })
  d.powered = true
  return d
}

function wire(topo, d1, if1, d2, if2) {
  return topo.connect(`${d1.id}:${if1}`, `${d2.id}:${if2}`)
}

function ios(engine, device, ...cmds) {
  let out = []
  for (const cmd of cmds) out = engine.execute(device, cmd)
  return out
}

function lx(engine, device, ...cmds) {
  let out = []
  for (const cmd of cmds) out = engine.execute(device, cmd)
  return out
}

// ── P1: Phone construction ────────────────────────────────────────────────────

describe('P1 — IP Phone device construction', () => {
  it('has type phone and one Ethernet interface', () => {
    const phone = makePhone()
    expect(phone.type).toBe('phone')
    expect(phone.interfaces).toHaveLength(1)
    expect(phone.interfaces[0].name).toBe('Ethernet0/0')
  })

  it('does not have router DHCP server state', () => {
    const phone = makePhone()
    expect(phone.dhcp_pools).toBeUndefined()
    expect(phone.dhcp_excluded).toBeUndefined()
    expect(phone.dhcp_bindings).toBeUndefined()
    expect(phone.nat_rules).toBeUndefined()
  })

  it('interface starts in admin_down state', () => {
    const phone = makePhone()
    expect(phone.interfaces[0].status).toBe('admin_down')
  })
})

// ── P2: DHCP via switch access VLAN ──────────────────────────────────────────
//
//  Router Gi0/0 (192.168.10.1/24, DHCP pool) ── SW Fa0/1 (access VLAN 1)
//  Phone Ethernet0/0 ── SW Fa0/2 (access VLAN 1)

describe('P2 — IP Phone on switch access VLAN gets DHCP address', () => {
  let topo, cliEng, pcEng, router, sw, phone

  beforeEach(() => {
    topo   = new Topology()
    cliEng = new CLIEngine(topo)
    pcEng  = new PCCLIEngine(topo)

    router = makeRouter()
    sw     = makeSwitch()
    phone  = makePhone()
    topo.addDevice(router)
    topo.addDevice(sw)
    topo.addDevice(phone)

    wire(topo, router, 'GigabitEthernet0/0', sw, 'FastEthernet0/1')
    wire(topo, phone,  'Ethernet0/0',         sw, 'FastEthernet0/2')

    ios(cliEng, router,
      'enable', 'configure terminal',
      'interface GigabitEthernet0/0',
      'ip address 192.168.10.1 255.255.255.0',
      'no shutdown',
      'exit',
      'ip dhcp pool VOICE',
      'network 192.168.10.0 255.255.255.0',
      'default-router 192.168.10.1',
      'dns-server 8.8.8.8',
      'exit',
    )

    lx(pcEng, phone, 'ip link set eth0 up')
  })

  it('dhclient succeeds and returns bound output', () => {
    const out = lx(pcEng, phone, 'dhclient eth0')
    expect(out.join('\n')).toMatch(/bound to/)
  })

  it('phone gets an IP in the pool subnet', () => {
    lx(pcEng, phone, 'dhclient eth0')
    const iface = phone.getInterface('Ethernet0/0')
    expect(iface.ip).toMatch(/^192\.168\.10\./)
    expect(iface.ip).not.toBe('192.168.10.1')
    expect(iface.subnet_mask).toBe('255.255.255.0')
    expect(iface.dhcp_assigned).toBe(true)
  })

  it('phone gets a default gateway pointing to the router', () => {
    lx(pcEng, phone, 'dhclient eth0')
    const defRoute = phone.routing_table.find(r => r.network === '0.0.0.0' && r.mask === '0.0.0.0')
    expect(defRoute).toBeDefined()
    expect(defRoute.next_hop).toBe('192.168.10.1')
  })

  it('router records a binding for the phone', () => {
    lx(pcEng, phone, 'dhclient eth0')
    expect(router.dhcp_bindings).toHaveLength(1)
    expect(router.dhcp_bindings[0].ip).toMatch(/^192\.168\.10\./)
    expect(router.dhcp_bindings[0].pool_name).toBe('VOICE')
  })
})

// ── P3: DHCP-assigned phone can ping another host in the same VLAN ────────────
//
//  Router Gi0/0 (192.168.10.1/24, DHCP) ── SW Fa0/1
//  Phone Ethernet0/0 ── SW Fa0/2
//  PC    Ethernet0/0 ── SW Fa0/3

describe('P3 — phone can ping another DHCP host in the same VLAN', () => {
  let topo, cliEng, pcEng, router, sw, phone, pc

  beforeEach(() => {
    topo   = new Topology()
    cliEng = new CLIEngine(topo)
    pcEng  = new PCCLIEngine(topo)

    router = makeRouter()
    sw     = makeSwitch()
    phone  = makePhone()
    pc     = makePc()
    topo.addDevice(router)
    topo.addDevice(sw)
    topo.addDevice(phone)
    topo.addDevice(pc)

    wire(topo, router, 'GigabitEthernet0/0', sw, 'FastEthernet0/1')
    wire(topo, phone,  'Ethernet0/0',         sw, 'FastEthernet0/2')
    wire(topo, pc,     'Ethernet0/0',         sw, 'FastEthernet0/3')

    ios(cliEng, router,
      'enable', 'configure terminal',
      'interface GigabitEthernet0/0',
      'ip address 192.168.10.1 255.255.255.0',
      'no shutdown',
      'exit',
      'ip dhcp pool VOICE',
      'network 192.168.10.0 255.255.255.0',
      'default-router 192.168.10.1',
      'exit',
    )

    lx(pcEng, phone, 'ip link set eth0 up')
    lx(pcEng, phone, 'dhclient eth0')
    lx(pcEng, pc,    'ip link set eth0 up')
    lx(pcEng, pc,    'dhclient eth0')
  })

  it('both phone and PC received DHCP addresses', () => {
    expect(phone.getInterface('Ethernet0/0').ip).toMatch(/^192\.168\.10\./)
    expect(pc.getInterface('Ethernet0/0').ip).toMatch(/^192\.168\.10\./)
  })

  it('phone can ping the PC in the same VLAN', () => {
    const phoneIp = phone.getInterface('Ethernet0/0').ip
    const pcIp    = pc.getInterface('Ethernet0/0').ip
    const result  = topo.checkPing(phoneIp, pcIp)
    expect(result.reachable).toBe(true)
  })

  it('PC can ping the phone in the same VLAN', () => {
    const phoneIp = phone.getInterface('Ethernet0/0').ip
    const pcIp    = pc.getInterface('Ethernet0/0').ip
    const result  = topo.checkPing(pcIp, phoneIp)
    expect(result.reachable).toBe(true)
  })
})

// ── P4: Regression — PC and server still construct correctly ──────────────────

describe('P4 — regression: existing device types unaffected', () => {
  it('PC has type pc and one Ethernet interface', () => {
    const pc = makePc()
    expect(pc.type).toBe('pc')
    expect(pc.interfaces).toHaveLength(1)
    expect(pc.interfaces[0].name).toBe('Ethernet0/0')
    expect(pc.dhcp_pools).toBeUndefined()
  })

  it('server has type server and two Ethernet interfaces', () => {
    const srv = new Device({ type: 'server', model: 'SRV-test', portCount: 2, portPrefix: 'Ethernet0/', portStart: 0 })
    expect(srv.type).toBe('server')
    expect(srv.interfaces).toHaveLength(2)
    expect(srv.dhcp_pools).toBeUndefined()
  })
})
