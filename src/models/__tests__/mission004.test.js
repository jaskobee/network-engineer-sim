/**
 * Mission 004 — TechNova Startup HQ
 *
 * Topology:
 *   pc1, pc2  (VLAN 10, 192.168.10.0/24) ─┐
 *   pc3       (VLAN 20, 192.168.20.0/24) ─┤
 *   srv       (VLAN 30, 192.168.30.0/24) ─┤── Switch Fa0/1-6 ── Router Gi0/0 (trunk)
 *   phone     (VLAN 40, 192.168.40.0/24) ─┘
 *
 *   Router Gi0/0      (physical trunk, no IP)
 *   Router Gi0/0.10   (192.168.10.1/24, dot1Q 10, gateway VLAN 10)
 *   Router Gi0/0.20   (192.168.20.1/24, dot1Q 20, gateway VLAN 20)
 *   Router Gi0/0.30   (192.168.30.1/24, dot1Q 30, gateway VLAN 30)
 *   Router Gi0/0.40   (192.168.40.1/24, dot1Q 40, gateway VLAN 40)
 *   Router Gi0/1      (203.0.113.2/30, NAT outside) ── ISP WAN0/0 (203.0.113.1/30)
 *
 * Test categories:
 *   P0 — DHCP-over-ROAS regression (Phase 0 engine fix)
 *   E  — Engine checks on solved / broken topologies
 *   C  — check004 task-logic (MISSION_TASKS.mission_004.checkFn)
 *   R  — Regressions for missions 001–003
 */
import { describe, it, expect } from 'vitest'
import { Device, createIspDevice } from '../Device.js'
import { Topology } from '../Topology.js'
import { CLIEngine } from '../CLIEngine.js'
import { PCCLIEngine } from '../PCCLIEngine.js'
import { MISSION_TASKS } from '../../data/missionTasks.js'

// ── Device factories ───────────────────────────────────────────────────────────

function makeRouter() {
  const d = new Device({ type: 'router', model: 'R-004', portCount: 4, portPrefix: 'GigabitEthernet0/', portStart: 0 })
  d.powered = true
  return d
}

function makeSwitch() {
  const d = new Device({ type: 'switch', model: 'SW-004', portCount: 8, portPrefix: 'FastEthernet0/', portStart: 1 })
  d.powered = true
  return d
}

function makePc() {
  const d = new Device({ type: 'pc', model: 'PC-004', portCount: 1, portPrefix: 'Ethernet0/', portStart: 0 })
  d.powered = true
  return d
}

function makeServer() {
  const d = new Device({ type: 'server', model: 'SRV-004', portCount: 2, portPrefix: 'Ethernet0/', portStart: 0 })
  d.powered = true
  return d
}

function makePhone() {
  const d = new Device({ type: 'phone', model: 'PH-004', portCount: 1, portPrefix: 'Ethernet0/', portStart: 0 })
  d.powered = true
  return d
}

// ── CLI shorthand helpers ──────────────────────────────────────────────────────

function ios(eng, device, ...cmds) {
  for (const cmd of cmds) eng.execute(device, cmd)
}

function lx(eng, device, ...cmds) {
  let out = []
  for (const cmd of cmds) out = eng.execute(device, cmd)
  return out
}

function wire(topo, d1, if1, d2, if2) {
  return topo.connect(`${d1.id}:${if1}`, `${d2.id}:${if2}`)
}

// ── Full topology builder ──────────────────────────────────────────────────────
//
// Options:
//   omitNat          — skip ip nat inside/outside + ACL + overload rule
//   trunkAsAccess    — configure the switch-router link as access instead of trunk
//   omitEncap30      — skip encapsulation dot1Q on the VLAN-30 subinterface
//   parentShutdown   — don't "no shutdown" the physical trunk port on the router
//   omitDhcpPools    — skip DHCP pool definitions (but still run dhclient on clients)
//   dhcpClientsRun   — whether to run dhclient on PCs and phone (default true)

function buildM004Topo({
  omitNat       = false,
  trunkAsAccess = false,
  omitEncap30   = false,
  parentShutdown = false,
  omitDhcpPools  = false,
  dhcpClientsRun = true,
} = {}) {
  const topo   = new Topology()
  const iosEng = new CLIEngine(topo)
  const lxEng  = new PCCLIEngine(topo)

  const router = makeRouter()
  const sw     = makeSwitch()
  const pc1    = makePc()
  const pc2    = makePc()
  const pc3    = makePc()
  const srv    = makeServer()
  const phone  = makePhone()
  const isp    = createIspDevice()

  ;[router, sw, pc1, pc2, pc3, srv, phone, isp].forEach(d => topo.addDevice(d))

  // Cabling
  wire(topo, sw, 'FastEthernet0/1', pc1,   'Ethernet0/0')  // VLAN 10
  wire(topo, sw, 'FastEthernet0/2', pc2,   'Ethernet0/0')  // VLAN 10
  wire(topo, sw, 'FastEthernet0/3', pc3,   'Ethernet0/0')  // VLAN 20
  wire(topo, sw, 'FastEthernet0/4', srv,   'Ethernet0/0')  // VLAN 30
  wire(topo, sw, 'FastEthernet0/5', phone, 'Ethernet0/0')  // VLAN 40
  wire(topo, sw, 'FastEthernet0/6', router,'GigabitEthernet0/0') // trunk
  wire(topo, router, 'GigabitEthernet0/1', isp, 'WAN0/0')       // WAN

  // Switch — VLANs + port assignments
  ios(iosEng, sw,
    'enable', 'configure terminal',
    'vlan 10', 'exit',
    'vlan 20', 'exit',
    'vlan 30', 'exit',
    'vlan 40', 'exit',
    'interface FastEthernet0/1', 'switchport mode access', 'switchport access vlan 10', 'exit',
    'interface FastEthernet0/2', 'switchport mode access', 'switchport access vlan 10', 'exit',
    'interface FastEthernet0/3', 'switchport mode access', 'switchport access vlan 20', 'exit',
    'interface FastEthernet0/4', 'switchport mode access', 'switchport access vlan 30', 'exit',
    'interface FastEthernet0/5', 'switchport mode access', 'switchport access vlan 40', 'exit',
    'interface FastEthernet0/6',
    trunkAsAccess ? 'switchport mode access' : 'switchport mode trunk',
    'end',
  )

  // Router — ROAS: physical trunk parent
  ios(iosEng, router, 'enable', 'configure terminal')
  if (!parentShutdown) {
    ios(iosEng, router, 'interface GigabitEthernet0/0', 'no shutdown', 'exit')
  }

  // Subinterfaces
  ios(iosEng, router,
    'interface GigabitEthernet0/0.10',
    'encapsulation dot1Q 10',
    'ip address 192.168.10.1 255.255.255.0', 'exit',

    'interface GigabitEthernet0/0.20',
    'encapsulation dot1Q 20',
    'ip address 192.168.20.1 255.255.255.0', 'exit',
  )

  if (!omitEncap30) {
    ios(iosEng, router,
      'interface GigabitEthernet0/0.30',
      'encapsulation dot1Q 30',
      'ip address 192.168.30.1 255.255.255.0', 'exit',
    )
  } else {
    // No encapsulation — VLAN 30 will be isolated
    ios(iosEng, router,
      'interface GigabitEthernet0/0.30',
      'ip address 192.168.30.1 255.255.255.0', 'exit',
    )
  }

  ios(iosEng, router,
    'interface GigabitEthernet0/0.40',
    'encapsulation dot1Q 40',
    'ip address 192.168.40.1 255.255.255.0', 'exit',
  )

  // WAN + default route
  ios(iosEng, router,
    'interface GigabitEthernet0/1',
    'ip address 203.0.113.2 255.255.255.252',
    'no shutdown', 'exit',
    'ip route 0.0.0.0 0.0.0.0 203.0.113.1',
  )

  // DHCP pools (VLANs 10/20/40 — no pool for VLAN 30)
  if (!omitDhcpPools) {
    ios(iosEng, router,
      'ip dhcp pool VLAN10',
      'network 192.168.10.0 255.255.255.0',
      'default-router 192.168.10.1',
      'dns-server 8.8.8.8', 'exit',

      'ip dhcp pool VLAN20',
      'network 192.168.20.0 255.255.255.0',
      'default-router 192.168.20.1',
      'dns-server 8.8.8.8', 'exit',

      'ip dhcp pool VLAN40',
      'network 192.168.40.0 255.255.255.0',
      'default-router 192.168.40.1',
      'dns-server 8.8.8.8', 'exit',
    )
  }

  // NAT/PAT
  if (!omitNat) {
    ios(iosEng, router,
      'interface GigabitEthernet0/0', 'ip nat inside', 'exit',
      'interface GigabitEthernet0/1', 'ip nat outside', 'exit',
      'access-list 1 permit 192.168.10.0 0.0.0.255',
      'access-list 1 permit 192.168.20.0 0.0.0.255',
      'access-list 1 permit 192.168.30.0 0.0.0.255',
      'access-list 1 permit 192.168.40.0 0.0.0.255',
      'ip nat inside source list 1 interface GigabitEthernet0/1 overload',
    )
  }

  ios(iosEng, router, 'end')

  // Server — static addressing (no DHCP)
  lx(lxEng, srv,
    'ip addr add 192.168.30.10/24 dev eth0',
    'ip link set eth0 up',
    'ip route add default via 192.168.30.1',
  )

  // DHCP clients — pc1, pc2, pc3, phone
  if (dhcpClientsRun && !omitDhcpPools) {
    for (const host of [pc1, pc2, pc3, phone]) {
      lx(lxEng, host, 'ip link set eth0 up')
      lx(lxEng, host, 'dhclient eth0')
    }
  } else if (dhcpClientsRun && omitDhcpPools) {
    // Bring links up so checkPing can evaluate connectivity, even if no IP assigned
    for (const host of [pc1, pc2, pc3, phone]) {
      lx(lxEng, host, 'ip link set eth0 up')
    }
  }

  return { topo, iosEng, lxEng, router, sw, pc1, pc2, pc3, srv, phone, isp }
}

// ── P0: DHCP-over-ROAS regression ─────────────────────────────────────────────

describe('P0 — DHCP-over-ROAS: clients behind switch trunk get IPs from router subinterfaces', () => {
  it('VLAN-10 PC gets a 192.168.10.x address via DHCP', () => {
    const { pc1 } = buildM004Topo()
    const iface = pc1.interfaces[0]
    expect(iface.dhcp_assigned).toBe(true)
    expect(iface.ip).toMatch(/^192\.168\.10\./)
  })

  it('VLAN-20 PC gets a 192.168.20.x address via DHCP', () => {
    const { pc3 } = buildM004Topo()
    const iface = pc3.interfaces[0]
    expect(iface.dhcp_assigned).toBe(true)
    expect(iface.ip).toMatch(/^192\.168\.20\./)
  })

  it('VLAN-40 phone gets a 192.168.40.x address via DHCP', () => {
    const { phone } = buildM004Topo()
    const iface = phone.interfaces[0]
    expect(iface.dhcp_assigned).toBe(true)
    expect(iface.ip).toMatch(/^192\.168\.40\./)
  })

  it('DHCP assigns correct default gateway (router subinterface IP)', () => {
    const { pc1 } = buildM004Topo()
    const gw = pc1.routing_table.find(r => r.network === '0.0.0.0')
    expect(gw).toBeDefined()
    expect(gw.next_hop).toBe('192.168.10.1')
  })

  it('server does NOT get a DHCP address (static addressing)', () => {
    const { srv } = buildM004Topo()
    const iface = srv.interfaces[0]
    expect(iface.dhcp_assigned).toBeFalsy()
    expect(iface.ip).toBe('192.168.30.10')
  })
})

// ── E: Engine — solved topology ────────────────────────────────────────────────

describe('E — Solved topology: inter-VLAN + internet reachability', () => {
  it('VLAN-10 PC pings the server in VLAN 30 (inter-VLAN via ROAS)', () => {
    const { topo, pc1 } = buildM004Topo()
    const srcIp = pc1.interfaces[0].ip
    expect(topo.checkPing(srcIp, '192.168.30.10').reachable).toBe(true)
  })

  it('VLAN-20 PC pings the server in VLAN 30', () => {
    const { topo, pc3 } = buildM004Topo()
    const srcIp = pc3.interfaces[0].ip
    expect(topo.checkPing(srcIp, '192.168.30.10').reachable).toBe(true)
  })

  it('VLAN-10 PC pings VLAN-20 PC (inter-VLAN)', () => {
    const { topo, pc1, pc3 } = buildM004Topo()
    expect(topo.checkPing(pc1.interfaces[0].ip, pc3.interfaces[0].ip).reachable).toBe(true)
  })

  it('VLAN-40 phone pings server in VLAN 30', () => {
    const { topo, phone } = buildM004Topo()
    expect(topo.checkPing(phone.interfaces[0].ip, '192.168.30.10').reachable).toBe(true)
  })

  it('ping is symmetric — server pings VLAN-10 PC (return path)', () => {
    const { topo, pc1 } = buildM004Topo()
    expect(topo.checkPing('192.168.30.10', pc1.interfaces[0].ip).reachable).toBe(true)
  })

  it('VLAN-10 PC pings 8.8.8.8 (end-to-end: ROAS + NAT + default route)', () => {
    const { topo, pc1 } = buildM004Topo()
    expect(topo.checkPing(pc1.interfaces[0].ip, '8.8.8.8').reachable).toBe(true)
  })

  it('server (static IP) pings 8.8.8.8 via NAT', () => {
    const { topo } = buildM004Topo()
    expect(topo.checkPing('192.168.30.10', '8.8.8.8').reachable).toBe(true)
  })
})

// ── E: Engine — no NAT → nat_required ─────────────────────────────────────────

describe('E — No NAT: internet unreachable, inter-VLAN still works', () => {
  it('VLAN-10 PC → 8.8.8.8 fails with nat_required', () => {
    const { topo, pc1 } = buildM004Topo({ omitNat: true })
    const result = topo.checkPing(pc1.interfaces[0].ip, '8.8.8.8')
    expect(result.reachable).toBe(false)
    expect(result.failureReason).toBe('nat_required')
  })

  it('Inter-VLAN still works without NAT (ROAS is independent)', () => {
    const { topo, pc1 } = buildM004Topo({ omitNat: true })
    expect(topo.checkPing(pc1.interfaces[0].ip, '192.168.30.10').reachable).toBe(true)
  })
})

// ── E: Engine — trunk as access → all VLANs isolated ─────────────────────────

describe('E — Switch-router link as access (not trunk): VLAN isolation', () => {
  it('inter-VLAN ping fails when trunk configured as access', () => {
    const { topo, pc1 } = buildM004Topo({ trunkAsAccess: true, dhcpClientsRun: false })
    // Manually bring links up; DHCP will fail so we can't use dhclient
    const pc1if = pc1.interfaces[0]
    pc1if.status = 'up'  // direct state set since dhclient would fail
    const result = topo.checkPing('192.168.10.1', '192.168.30.10')
    // Router-switch link is no longer a trunk; VLANs can't cross
    expect(result.reachable).toBe(false)
  })
})

// ── E: Engine — missing encapsulation on VLAN-30 subinterface ─────────────────

describe('E — Missing encapsulation dot1Q on VLAN-30 subinterface → server isolated', () => {
  it('server is unreachable from VLAN-10 PC when encap missing on .30', () => {
    const { topo, pc1 } = buildM004Topo({ omitEncap30: true })
    const srcIp = pc1.interfaces[0].ip
    const result = topo.checkPing(srcIp, '192.168.30.10')
    expect(result.reachable).toBe(false)
    expect(['vlan_isolated', 'no_route'].includes(result.failureReason)).toBe(true)
  })

  it('other VLANs still route normally when only VLAN-30 encap is missing', () => {
    const { topo, pc1, pc3 } = buildM004Topo({ omitEncap30: true })
    // VLAN 10 → VLAN 20 should still work
    expect(topo.checkPing(pc1.interfaces[0].ip, pc3.interfaces[0].ip).reachable).toBe(true)
  })
})

// ── C: check004 — fully solved topology ───────────────────────────────────────

describe('C — check004 all 11 tasks pass on solved topology with pingLog entries', () => {
  it('all tasks t1–t11 return true', () => {
    const { topo, router, sw, pc1, pc2, pc3, srv, phone, isp } = buildM004Topo()

    const pc1Ip  = pc1.interfaces[0].ip
    const srvIp  = srv.interfaces[0].ip

    // Player pings (t10 + t11)
    topo.logPing(pc1Ip, srvIp)          // inter-VLAN verify (t10)
    topo.logPing(pc1Ip, '8.8.8.8')      // internet verify (t11)

    const allDevs    = [router, sw, pc1, pc2, pc3, srv, phone, isp]
    const placements = Object.fromEntries(allDevs.map(d => [d.id, true]))
    const checks = MISSION_TASKS.mission_004.checkFn(allDevs, placements, topo)

    expect(checks).toEqual({
      t1: true, t2: true, t3: true, t4: true, t5: true, t6: true,
      t7: true, t8: true, t9: true, t10: true, t11: true,
    })
  })
})

// ── C: check004 — partial failures ────────────────────────────────────────────

describe('C — check004 partial failures', () => {
  it('t1 fails when hardware is missing', () => {
    const topo = new Topology()
    const checks = MISSION_TASKS.mission_004.checkFn([], {}, topo)
    expect(checks.t1).toBe(false)
  })

  it('t2 fails when devices are bought but not placed', () => {
    const { topo, router, sw, pc1, pc2, pc3, srv, phone, isp } = buildM004Topo()
    const allDevs = [router, sw, pc1, pc2, pc3, srv, phone, isp]
    // empty placements map — nothing placed
    const checks = MISSION_TASKS.mission_004.checkFn(allDevs, {}, topo)
    expect(checks.t1).toBe(true)
    expect(checks.t2).toBe(false)
  })

  it('t4 fails when trunk port is missing (switch-router link is access)', () => {
    const { topo, router, sw, pc1, pc2, pc3, srv, phone, isp } = buildM004Topo({
      trunkAsAccess: true, dhcpClientsRun: false,
    })
    const allDevs    = [router, sw, pc1, pc2, pc3, srv, phone, isp]
    const placements = Object.fromEntries(allDevs.map(d => [d.id, true]))
    const checks = MISSION_TASKS.mission_004.checkFn(allDevs, placements, topo)
    expect(checks.t4).toBe(false)
  })

  it('t5 fails when physical trunk parent is admin_down', () => {
    const { topo, router, sw, pc1, pc2, pc3, srv, phone, isp } = buildM004Topo({
      parentShutdown: true, dhcpClientsRun: false,
    })
    const allDevs    = [router, sw, pc1, pc2, pc3, srv, phone, isp]
    const placements = Object.fromEntries(allDevs.map(d => [d.id, true]))
    const checks = MISSION_TASKS.mission_004.checkFn(allDevs, placements, topo)
    expect(checks.t5).toBe(false)
  })

  it('t7 fails when DHCP pools are missing', () => {
    const { topo, router, sw, pc1, pc2, pc3, srv, phone, isp } = buildM004Topo({
      omitDhcpPools: true,
    })
    const allDevs    = [router, sw, pc1, pc2, pc3, srv, phone, isp]
    const placements = Object.fromEntries(allDevs.map(d => [d.id, true]))
    const checks = MISSION_TASKS.mission_004.checkFn(allDevs, placements, topo)
    expect(checks.t7).toBe(false)
  })

  it('t9 fails when NAT is not configured', () => {
    const { topo, router, sw, pc1, pc2, pc3, srv, phone, isp } = buildM004Topo({ omitNat: true })
    const allDevs    = [router, sw, pc1, pc2, pc3, srv, phone, isp]
    const placements = Object.fromEntries(allDevs.map(d => [d.id, true]))
    const checks = MISSION_TASKS.mission_004.checkFn(allDevs, placements, topo)
    expect(checks.t9).toBe(false)
    // but inter-VLAN tasks should still pass
    expect(checks.t5).toBe(true)
    expect(checks.t7).toBe(true)
  })

  it('t10 fails when inter-VLAN ping was not logged by the player', () => {
    const { topo, router, sw, pc1, pc2, pc3, srv, phone, isp } = buildM004Topo()
    // Only log the internet ping, not the inter-VLAN one
    topo.logPing(pc1.interfaces[0].ip, '8.8.8.8')

    const allDevs    = [router, sw, pc1, pc2, pc3, srv, phone, isp]
    const placements = Object.fromEntries(allDevs.map(d => [d.id, true]))
    const checks = MISSION_TASKS.mission_004.checkFn(allDevs, placements, topo)
    expect(checks.t10).toBe(false)
    expect(checks.t11).toBe(true)
  })

  it('t11 fails when internet ping was not logged by the player', () => {
    const { topo, router, sw, pc1, pc2, pc3, srv, phone, isp } = buildM004Topo()
    // Only log the inter-VLAN ping
    topo.logPing(pc1.interfaces[0].ip, srv.interfaces[0].ip)

    const allDevs    = [router, sw, pc1, pc2, pc3, srv, phone, isp]
    const placements = Object.fromEntries(allDevs.map(d => [d.id, true]))
    const checks = MISSION_TASKS.mission_004.checkFn(allDevs, placements, topo)
    expect(checks.t10).toBe(true)
    expect(checks.t11).toBe(false)
  })

  it('t10 only passes for a VLAN-10 host pinging the server (not VLAN-20)', () => {
    const { topo, router, sw, pc1, pc2, pc3, srv, phone, isp } = buildM004Topo()
    // Log a VLAN-20 host → server ping (should NOT satisfy t10 which requires VLAN-10)
    topo.logPing(pc3.interfaces[0].ip, srv.interfaces[0].ip)
    topo.logPing(pc1.interfaces[0].ip, '8.8.8.8')

    const allDevs    = [router, sw, pc1, pc2, pc3, srv, phone, isp]
    const placements = Object.fromEntries(allDevs.map(d => [d.id, true]))
    const checks = MISSION_TASKS.mission_004.checkFn(allDevs, placements, topo)
    // t10 requires a VLAN-10 client specifically
    expect(checks.t10).toBe(false)
  })

  it('t6 fails when server has a DHCP-assigned IP instead of static', () => {
    const { topo, router, sw, pc1, pc2, pc3, srv, phone, isp, iosEng, lxEng } = buildM004Topo()
    // Override server with a DHCP flag to simulate wrong configuration
    const srvIf = srv.interfaces[0]
    srvIf.dhcp_assigned = true

    const allDevs    = [router, sw, pc1, pc2, pc3, srv, phone, isp]
    const placements = Object.fromEntries(allDevs.map(d => [d.id, true]))
    const checks = MISSION_TASKS.mission_004.checkFn(allDevs, placements, topo)
    expect(checks.t6).toBe(false)
  })
})

// ── R: Regressions for missions 001–003 ───────────────────────────────────────

describe('R — Mission 001–003 checkFn regressions', () => {
  it('MISSION_TASKS has entries for 001 through 004', () => {
    expect(MISSION_TASKS.mission_001).toBeDefined()
    expect(MISSION_TASKS.mission_002).toBeDefined()
    expect(MISSION_TASKS.mission_003).toBeDefined()
    expect(MISSION_TASKS.mission_004).toBeDefined()
  })

  it('mission_004 has checkFn and diagnoseFn', () => {
    expect(typeof MISSION_TASKS.mission_004.checkFn).toBe('function')
    expect(typeof MISSION_TASKS.mission_004.diagnoseFn).toBe('function')
  })

  it('mission_004 has 11 tasks', () => {
    expect(MISSION_TASKS.mission_004.tasks).toHaveLength(11)
    const ids = MISSION_TASKS.mission_004.tasks.map(t => t.id)
    expect(ids).toEqual(['t1','t2','t3','t4','t5','t6','t7','t8','t9','t10','t11'])
  })
})
