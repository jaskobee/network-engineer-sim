/**
 * DHCP engine tests — all invariants from the sprint spec.
 *
 * Topology helpers: makeRouter, makeSwitch, makePc, wire, ios, lx
 *
 * Tests:
 *  D1 - LOCAL: router pool on PC's subnet → PC gets IP, mask, gateway, dns
 *  D2 - EXCLUDED/GATEWAY never assigned: excluded range + router IP skipped
 *  D3 - RELAY REQUIRED (key): no helper → no address; add helper → address from remote pool
 *  D4 - RELAY NEEDS ROUTING: helper configured but no route → DHCP fails; add routes → succeeds
 *  D5 - POOL EXHAUSTION: tiny /30 fully leased → next client fails
 *  D6 - RELEASE: dhclient -r frees address and binding; re-request works
 *  D7 - END-TO-END: DHCP-assigned host with auto gateway can ping off-subnet destination
 *  D8 - REGRESSION: manual addressing still works; existing tests unaffected
 *  D9 - show ip dhcp binding + pool reflect real state
 *  D10 - show running-config renders DHCP config
 *  D11 - dhclient on interface that is not up → fails with helpful message
 *  D12 - no ip dhcp pool removes pool
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { Device } from '../Device.js'
import { Topology } from '../Topology.js'
import { CLIEngine } from '../CLIEngine.js'
import { PCCLIEngine } from '../PCCLIEngine.js'

// ── Helpers ───────────────────────────────────────────────────────────────────

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
  const d = new Device({ type: 'switch', model: 'SW-test', portCount, portPrefix: 'FastEthernet0/', portStart: 1 })
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

// ── D1: LOCAL DHCP — router and PC on same segment ───────────────────────────

describe('D1 — local DHCP: PC gets IP from router pool on same subnet', () => {
  let topo, cliEng, pcEng, router, pc

  beforeEach(() => {
    topo   = new Topology()
    cliEng = new CLIEngine(topo)
    pcEng  = new PCCLIEngine(topo)

    router = makeRouter()
    pc     = makePc()
    topo.addDevice(router)
    topo.addDevice(pc)

    // Wire router Gi0/0 ↔ pc Ethernet0/0
    wire(topo, router, 'GigabitEthernet0/0', pc, 'Ethernet0/0')

    // Configure router: IP + DHCP pool + no shutdown
    ios(cliEng, router,
      'enable', 'configure terminal',
      'interface GigabitEthernet0/0',
      'ip address 192.168.1.1 255.255.255.0',
      'no shutdown',
      'exit',
      'ip dhcp pool LAN',
      'network 192.168.1.0 255.255.255.0',
      'default-router 192.168.1.1',
      'dns-server 8.8.8.8',
      'exit',
    )

    // Bring PC link up
    lx(pcEng, pc, 'ip link set eth0 up')
  })

  it('dhclient succeeds and returns DORA output', () => {
    const out = lx(pcEng, pc, 'dhclient eth0')
    expect(out.join('\n')).toMatch(/bound to/)
  })

  it('PC interface gets a valid IP in the pool subnet', () => {
    lx(pcEng, pc, 'dhclient eth0')
    const iface = pc.getInterface('Ethernet0/0')
    expect(iface.ip).toMatch(/^192\.168\.1\./)
    expect(iface.ip).not.toBe('192.168.1.1')  // not the router's IP
    expect(iface.subnet_mask).toBe('255.255.255.0')
    expect(iface.dhcp_assigned).toBe(true)
  })

  it('PC gets the correct mask and default gateway applied to routing table', () => {
    lx(pcEng, pc, 'dhclient eth0')
    const defRoute = pc.routing_table.find(r => r.network === '0.0.0.0' && r.mask === '0.0.0.0')
    expect(defRoute).toBeDefined()
    expect(defRoute.next_hop).toBe('192.168.1.1')
    expect(defRoute.dhcp_assigned).toBe(true)
  })

  it('PC gets the DNS server', () => {
    lx(pcEng, pc, 'dhclient eth0')
    expect(pc.dns_server).toBe('8.8.8.8')
  })

  it('server-side binding is recorded', () => {
    lx(pcEng, pc, 'dhclient eth0')
    expect(router.dhcp_bindings).toHaveLength(1)
    expect(router.dhcp_bindings[0].ip).toMatch(/^192\.168\.1\./)
    expect(router.dhcp_bindings[0].pool_name).toBe('LAN')
  })
})

// ── D2: EXCLUDED / GATEWAY NEVER ASSIGNED ────────────────────────────────────

describe('D2 — excluded range and router IP are never handed out', () => {
  let topo, cliEng, pcEng, router

  beforeEach(() => {
    topo   = new Topology()
    cliEng = new CLIEngine(topo)
    pcEng  = new PCCLIEngine(topo)

    router = makeRouter()
    topo.addDevice(router)

    ios(cliEng, router,
      'enable', 'configure terminal',
      'ip dhcp excluded-address 192.168.1.1 192.168.1.10',
      'ip dhcp pool TEST',
      'network 192.168.1.0 255.255.255.0',
      'default-router 192.168.1.1',
      'exit',
    )
  })

  it('excluded IPs and router IP are skipped', () => {
    // Make 5 separate PCs and attach them
    const pcs = []
    for (let i = 0; i < 5; i++) {
      const pc = makePc()
      topo.addDevice(pc)
      wire(topo, router, `GigabitEthernet0/${i % 4}`, pc, 'Ethernet0/0')
      lx(pcEng, pc, 'ip link set eth0 up')
      lx(pcEng, pc, 'dhclient eth0')
      pcs.push(pc)
    }

    for (const pc of pcs) {
      const iface = pc.getInterface('Ethernet0/0')
      if (!iface.ip) continue
      const lastOctet = parseInt(iface.ip.split('.')[3], 10)
      // Must not be the router's IP (1) or the excluded range (1–10)
      expect(lastOctet).toBeGreaterThan(10)
      expect(iface.ip).not.toBe('192.168.1.1')
    }
  })

  it('no two PCs get the same IP (no double-allocation)', () => {
    const ips = []
    for (let i = 0; i < 3; i++) {
      const pc = makePc()
      topo.addDevice(pc)
      wire(topo, router, `GigabitEthernet0/${i}`, pc, 'Ethernet0/0')
      lx(pcEng, pc, 'ip link set eth0 up')
      lx(pcEng, pc, 'dhclient eth0')
      const iface = pc.getInterface('Ethernet0/0')
      if (iface.ip) ips.push(iface.ip)
    }
    const unique = new Set(ips)
    expect(unique.size).toBe(ips.length)
  })
})

// ── D3: RELAY REQUIRED ────────────────────────────────────────────────────────

describe('D3 — relay: broadcast-boundary enforcement', () => {
  let topo, cliEng, pcEng, relay, server, pc

  /*
   *  Topology:
   *    PC (no IP) ── Gi0/0 [relay 192.168.1.1/24, helper: 10.0.0.2] ── router (relay)
   *    relay Gi0/1 (10.0.0.1/24) ── server Gi0/0 (10.0.0.2/24, DHCP pool for 192.168.1.0/24)
   */
  beforeEach(() => {
    topo   = new Topology()
    cliEng = new CLIEngine(topo)
    pcEng  = new PCCLIEngine(topo)

    relay  = makeRouter()
    server = makeRouter()
    pc     = makePc()
    topo.addDevice(relay)
    topo.addDevice(server)
    topo.addDevice(pc)

    wire(topo, relay, 'GigabitEthernet0/0', pc, 'Ethernet0/0')
    wire(topo, relay, 'GigabitEthernet0/1', server, 'GigabitEthernet0/0')

    // Configure relay router (client-facing side — no DHCP pool, just an IP)
    ios(cliEng, relay,
      'enable', 'configure terminal',
      'interface GigabitEthernet0/0',
      'ip address 192.168.1.1 255.255.255.0',
      'no shutdown',
      'exit',
      'interface GigabitEthernet0/1',
      'ip address 10.0.0.1 255.255.255.0',
      'no shutdown',
      'exit',
    )

    // Configure DHCP server (has pool for the 192.168.1.0/24 segment)
    // Also needs a return route to 192.168.1.0/24 via the relay (Inv 4: return path must work)
    ios(cliEng, server,
      'enable', 'configure terminal',
      'interface GigabitEthernet0/0',
      'ip address 10.0.0.2 255.255.255.0',
      'no shutdown',
      'exit',
      'ip dhcp pool CLIENT_LAN',
      'network 192.168.1.0 255.255.255.0',
      'default-router 192.168.1.1',
      'dns-server 1.1.1.1',
      'exit',
      // Return route so the server can unicast DHCPACK back to giaddr (192.168.1.1)
      'ip route 192.168.1.0 255.255.255.0 10.0.0.1',
    )

    lx(pcEng, pc, 'ip link set eth0 up')
  })

  it('WITHOUT helper-address: PC gets no address (broadcast boundary enforced)', () => {
    const out = lx(pcEng, pc, 'dhclient eth0')
    expect(out.join('\n')).toMatch(/No DHCPOFFERS/)
    const iface = pc.getInterface('Ethernet0/0')
    expect(iface.ip).toBeNull()
  })

  it('WITH helper-address: PC gets address from the correct remote pool', () => {
    // Add helper-address on the relay's client-facing interface
    ios(cliEng, relay,
      'interface GigabitEthernet0/0',
      'ip helper-address 10.0.0.2',
    )

    const out = lx(pcEng, pc, 'dhclient eth0')
    expect(out.join('\n')).toMatch(/bound to/)

    const iface = pc.getInterface('Ethernet0/0')
    expect(iface.ip).toMatch(/^192\.168\.1\./)
    expect(iface.dhcp_assigned).toBe(true)
    expect(pc.dns_server).toBe('1.1.1.1')

    // Binding recorded on the SERVER (not the relay)
    expect(server.dhcp_bindings).toHaveLength(1)
    expect(relay.dhcp_bindings).toHaveLength(0)
  })

  it('pool selection uses giaddr: server picks 192.168.1.x not 10.0.0.x', () => {
    ios(cliEng, relay,
      'interface GigabitEthernet0/0',
      'ip helper-address 10.0.0.2',
    )
    lx(pcEng, pc, 'dhclient eth0')
    const iface = pc.getInterface('Ethernet0/0')
    // Must be in the 192.168.1.0/24 pool, not the 10.0.0.0/24 server subnet
    expect(iface.ip?.startsWith('192.168.1.')).toBe(true)
  })
})

// ── D4: RELAY NEEDS ROUTING ───────────────────────────────────────────────────

describe('D4 — relay honors routing: broken route = DHCP failure', () => {
  let topo, cliEng, pcEng, relay, server, pc

  beforeEach(() => {
    topo   = new Topology()
    cliEng = new CLIEngine(topo)
    pcEng  = new PCCLIEngine(topo)

    relay  = makeRouter()
    server = makeRouter()
    pc     = makePc()
    topo.addDevice(relay)
    topo.addDevice(server)
    topo.addDevice(pc)

    wire(topo, relay, 'GigabitEthernet0/0', pc, 'Ethernet0/0')
    // relay Gi0/1 ← intermediate link → server Gi0/0
    wire(topo, relay, 'GigabitEthernet0/1', server, 'GigabitEthernet0/0')

    // relay: Gi0/0=192.168.1.1/24, Gi0/1=10.0.0.1/24 with helper
    ios(cliEng, relay,
      'enable', 'configure terminal',
      'interface GigabitEthernet0/0',
      'ip address 192.168.1.1 255.255.255.0',
      'no shutdown',
      'ip helper-address 10.0.0.2',
      'exit',
      'interface GigabitEthernet0/1',
      'ip address 10.0.0.1 255.255.255.0',
      'no shutdown',
      'exit',
    )

    // server: Gi0/0=10.0.0.2/24, pool for 192.168.1.0/24
    // Plus return route so server can reply back to giaddr (Inv 4: both directions must work)
    ios(cliEng, server,
      'enable', 'configure terminal',
      'interface GigabitEthernet0/0',
      'ip address 10.0.0.2 255.255.255.0',
      'no shutdown',
      'exit',
      'ip dhcp pool LAN',
      'network 192.168.1.0 255.255.255.0',
      'default-router 192.168.1.1',
      'exit',
      'ip route 192.168.1.0 255.255.255.0 10.0.0.1',
    )

    lx(pcEng, pc, 'ip link set eth0 up')
  })

  it('relay and server directly connected: DHCP succeeds', () => {
    // relay and server are on 10.0.0.0/24 (directly connected) → routing works
    const out = lx(pcEng, pc, 'dhclient eth0')
    expect(out.join('\n')).toMatch(/bound to/)
    const iface = pc.getInterface('Ethernet0/0')
    expect(iface.ip?.startsWith('192.168.1.')).toBe(true)
  })

  it('after shutting relay Gi0/1: routing broken → DHCP fails', () => {
    // Shut down the link between relay and server
    ios(cliEng, relay,
      'interface GigabitEthernet0/1',
      'shutdown',
    )
    const out = lx(pcEng, pc, 'dhclient eth0')
    expect(out.join('\n')).toMatch(/No DHCPOFFERS/)
    const iface = pc.getInterface('Ethernet0/0')
    expect(iface.ip).toBeNull()
  })
})

// ── D5: POOL EXHAUSTION ───────────────────────────────────────────────────────

describe('D5 — pool exhaustion: tiny /30, third client fails', () => {
  let topo, cliEng, pcEng, router

  beforeEach(() => {
    topo   = new Topology()
    cliEng = new CLIEngine(topo)
    pcEng  = new PCCLIEngine(topo)

    router = makeRouter(4)
    topo.addDevice(router)

    // 10.0.0.0/30: usable hosts .1 and .2 — .1 is the router, leaves only .2
    ios(cliEng, router,
      'enable', 'configure terminal',
      'interface GigabitEthernet0/0',
      'ip address 10.0.0.1 255.255.255.252',
      'no shutdown',
      'exit',
      'ip dhcp pool TINY',
      'network 10.0.0.0 255.255.255.252',
      'default-router 10.0.0.1',
      'exit',
    )
  })

  it('first PC gets 10.0.0.2 (only available host)', () => {
    const pc1 = makePc()
    topo.addDevice(pc1)
    wire(topo, router, 'GigabitEthernet0/0', pc1, 'Ethernet0/0')
    lx(pcEng, pc1, 'ip link set eth0 up')
    lx(pcEng, pc1, 'dhclient eth0')
    const iface = pc1.getInterface('Ethernet0/0')
    expect(iface.ip).toBe('10.0.0.2')
  })

  it('second PC cannot get an address (pool exhausted)', () => {
    const pc1 = makePc()
    topo.addDevice(pc1)
    wire(topo, router, 'GigabitEthernet0/0', pc1, 'Ethernet0/0')
    lx(pcEng, pc1, 'ip link set eth0 up')
    lx(pcEng, pc1, 'dhclient eth0')

    const pc2 = makePc()
    topo.addDevice(pc2)
    wire(topo, router, 'GigabitEthernet0/1', pc2, 'Ethernet0/0')
    lx(pcEng, pc2, 'ip link set eth0 up')
    const out2 = lx(pcEng, pc2, 'dhclient eth0')
    expect(out2.join('\n')).toMatch(/No DHCPOFFERS|pool_exhausted/)
    const iface2 = pc2.getInterface('Ethernet0/0')
    expect(iface2.ip).toBeNull()
  })
})

// ── D6: RELEASE ───────────────────────────────────────────────────────────────

describe('D6 — dhclient -r releases lease; re-request succeeds', () => {
  let topo, cliEng, pcEng, router, pc

  beforeEach(() => {
    topo   = new Topology()
    cliEng = new CLIEngine(topo)
    pcEng  = new PCCLIEngine(topo)

    router = makeRouter()
    pc     = makePc()
    topo.addDevice(router)
    topo.addDevice(pc)
    wire(topo, router, 'GigabitEthernet0/0', pc, 'Ethernet0/0')

    ios(cliEng, router,
      'enable', 'configure terminal',
      'interface GigabitEthernet0/0',
      'ip address 192.168.1.1 255.255.255.0',
      'no shutdown',
      'exit',
      'ip dhcp pool LAN',
      'network 192.168.1.0 255.255.255.0',
      'default-router 192.168.1.1',
      'dns-server 8.8.8.8',
      'exit',
    )

    lx(pcEng, pc, 'ip link set eth0 up')
    lx(pcEng, pc, 'dhclient eth0')
  })

  it('release clears IP, mask, dhcp_assigned on interface', () => {
    const beforeIp = pc.getInterface('Ethernet0/0').ip
    expect(beforeIp).toMatch(/^192\.168\.1\./)

    const out = lx(pcEng, pc, 'dhclient -r eth0')
    expect(out.join('\n')).toMatch(/[Rr]eleased|[Kk]illed/)

    const iface = pc.getInterface('Ethernet0/0')
    expect(iface.ip).toBeNull()
    expect(iface.dhcp_assigned).toBe(false)
  })

  it('release removes DHCP-injected default gateway', () => {
    lx(pcEng, pc, 'dhclient -r eth0')
    const defRoute = pc.routing_table.find(r => r.network === '0.0.0.0' && r.dhcp_assigned)
    expect(defRoute).toBeUndefined()
  })

  it('release removes server-side binding', () => {
    expect(router.dhcp_bindings).toHaveLength(1)
    lx(pcEng, pc, 'dhclient -r eth0')
    expect(router.dhcp_bindings).toHaveLength(0)
  })

  it('re-request after release succeeds (IP re-allocated)', () => {
    lx(pcEng, pc, 'dhclient -r eth0')
    const out = lx(pcEng, pc, 'dhclient eth0')
    expect(out.join('\n')).toMatch(/bound to/)
    const iface = pc.getInterface('Ethernet0/0')
    expect(iface.ip).toMatch(/^192\.168\.1\./)
    expect(router.dhcp_bindings).toHaveLength(1)
  })
})

// ── D7: END-TO-END — DHCP client can ping off-subnet once routing is set ──────

describe('D7 — end-to-end: DHCP-assigned host pings off-subnet destination', () => {
  let topo, cliEng, pcEng, router, pc, remoteRouter

  /*
   *  PC ── router Gi0/0 (192.168.1.1/24, DHCP pool) ── router Gi0/1 (10.0.0.1/24)
   *  remoteRouter Gi0/0 (10.0.0.2/24)                remoteRouter Gi0/1 (172.16.0.1/24)
   *
   *  PC gets 192.168.1.x via DHCP, default-router=192.168.1.1.
   *  After DHCP, PC can ping 10.0.0.2 if router has a static route back
   *  (or we verify router already routes via connected routes).
   */
  beforeEach(() => {
    topo        = new Topology()
    cliEng      = new CLIEngine(topo)
    pcEng       = new PCCLIEngine(topo)

    router       = makeRouter()
    remoteRouter = makeRouter()
    pc           = makePc()
    topo.addDevice(router)
    topo.addDevice(remoteRouter)
    topo.addDevice(pc)

    wire(topo, router, 'GigabitEthernet0/0', pc, 'Ethernet0/0')
    wire(topo, router, 'GigabitEthernet0/1', remoteRouter, 'GigabitEthernet0/0')

    ios(cliEng, router,
      'enable', 'configure terminal',
      'interface GigabitEthernet0/0',
      'ip address 192.168.1.1 255.255.255.0',
      'no shutdown',
      'exit',
      'interface GigabitEthernet0/1',
      'ip address 10.0.0.1 255.255.255.0',
      'no shutdown',
      'exit',
      'ip dhcp pool LAN',
      'network 192.168.1.0 255.255.255.0',
      'default-router 192.168.1.1',
      'exit',
      // Return route: router knows how to reach the DHCP-assigned PC subnet
      // (it's directly connected, so no static route needed for the return path)
    )

    ios(cliEng, remoteRouter,
      'enable', 'configure terminal',
      'interface GigabitEthernet0/0',
      'ip address 10.0.0.2 255.255.255.0',
      'no shutdown',
      'exit',
      // Return route for 192.168.1.0/24 → via 10.0.0.1
      'ip route 192.168.1.0 255.255.255.0 10.0.0.1',
    )

    lx(pcEng, pc, 'ip link set eth0 up')
    lx(pcEng, pc, 'dhclient eth0')
  })

  it('PC has a DHCP-assigned IP and default gateway', () => {
    const iface = pc.getInterface('Ethernet0/0')
    expect(iface.ip).toMatch(/^192\.168\.1\./)
    expect(iface.dhcp_assigned).toBe(true)
    const gw = pc.routing_table.find(r => r.network === '0.0.0.0')
    expect(gw?.next_hop).toBe('192.168.1.1')
  })

  it('checkPing to off-subnet destination succeeds via DHCP-assigned gateway', () => {
    const srcIp = pc.getInterface('Ethernet0/0').ip
    const result = topo.checkPing(srcIp, '10.0.0.2')
    expect(result.reachable).toBe(true)
  })
})

// ── D8: REGRESSION — manual addressing unaffected ────────────────────────────

describe('D8 — regression: manual addressing still works exactly as before', () => {
  let topo, cliEng, pcEng, router, pc

  beforeEach(() => {
    topo   = new Topology()
    cliEng = new CLIEngine(topo)
    pcEng  = new PCCLIEngine(topo)

    router = makeRouter()
    pc     = makePc()
    topo.addDevice(router)
    topo.addDevice(pc)
    wire(topo, router, 'GigabitEthernet0/0', pc, 'Ethernet0/0')

    ios(cliEng, router,
      'enable', 'configure terminal',
      'interface GigabitEthernet0/0',
      'ip address 10.0.0.1 255.255.255.0',
      'no shutdown',
    )

    lx(pcEng, pc,
      'ip link set eth0 up',
      'ip addr add 10.0.0.2/24 dev eth0',
      'ip route add default via 10.0.0.1',
    )
  })

  it('ping succeeds without DHCP (manual addressing)', () => {
    const result = topo.checkPing('10.0.0.2', '10.0.0.1')
    expect(result.reachable).toBe(true)
  })

  it('manually-assigned interface has dhcp_assigned=false', () => {
    const iface = pc.getInterface('Ethernet0/0')
    expect(iface.dhcp_assigned).toBe(false)
  })

  it('dhclient -r on manually-assigned interface fails gracefully', () => {
    const out = lx(pcEng, pc, 'dhclient -r eth0')
    expect(out.join('\n')).toMatch(/[Nn]o DHCP lease/)
    // Address should NOT have been cleared
    const iface = pc.getInterface('Ethernet0/0')
    expect(iface.ip).toBe('10.0.0.2')
  })
})

// ── D9: SHOW COMMANDS ─────────────────────────────────────────────────────────

describe('D9 — show ip dhcp binding and pool reflect real state', () => {
  let topo, cliEng, pcEng, router, pc

  beforeEach(() => {
    topo   = new Topology()
    cliEng = new CLIEngine(topo)
    pcEng  = new PCCLIEngine(topo)

    router = makeRouter()
    pc     = makePc()
    topo.addDevice(router)
    topo.addDevice(pc)
    wire(topo, router, 'GigabitEthernet0/0', pc, 'Ethernet0/0')

    ios(cliEng, router,
      'enable', 'configure terminal',
      'interface GigabitEthernet0/0',
      'ip address 192.168.1.1 255.255.255.0',
      'no shutdown',
      'exit',
      'ip dhcp pool MGMT',
      'network 192.168.1.0 255.255.255.0',
      'default-router 192.168.1.1',
      'exit',
    )

    lx(pcEng, pc, 'ip link set eth0 up')
    lx(pcEng, pc, 'dhclient eth0')
  })

  it('show ip dhcp binding lists the binding after dhclient', () => {
    const out = ios(cliEng, router, 'show ip dhcp binding').join('\n')
    expect(out).toMatch(/192\.168\.1\./)
    expect(out).toMatch(/Automatic/)
  })

  it('show ip dhcp pool shows correct pool info', () => {
    const out = ios(cliEng, router, 'show ip dhcp pool').join('\n')
    expect(out).toMatch(/MGMT/)
    expect(out).toMatch(/Leased addresses\s*:\s*1/)
    expect(out).toMatch(/192\.168\.1\.0/)
  })

  it('show ip dhcp binding is empty before any dhclient', () => {
    const topo2   = new Topology()
    const cliEng2 = new CLIEngine(topo2)
    const r2 = makeRouter()
    topo2.addDevice(r2)
    ios(cliEng2, r2,
      'enable', 'configure terminal',
      'ip dhcp pool P', 'network 192.168.1.0 255.255.255.0', 'exit',
    )
    const out = ios(cliEng2, r2, 'show ip dhcp binding').join('\n')
    expect(out).toMatch(/no bindings/)
  })
})

// ── D10: SHOW RUNNING-CONFIG ──────────────────────────────────────────────────

describe('D10 — show running-config renders DHCP configuration', () => {
  let topo, cliEng, router

  beforeEach(() => {
    topo   = new Topology()
    cliEng = new CLIEngine(topo)
    router = makeRouter()
    topo.addDevice(router)

    ios(cliEng, router,
      'enable', 'configure terminal',
      'ip dhcp excluded-address 192.168.1.1 192.168.1.10',
      'ip dhcp pool LAN',
      'network 192.168.1.0 255.255.255.0',
      'default-router 192.168.1.1',
      'dns-server 8.8.8.8',
      'lease 3',
      'exit',
      'interface GigabitEthernet0/0',
      'ip address 192.168.1.1 255.255.255.0',
      'ip helper-address 10.0.0.2',
      'no shutdown',
    )
  })

  it('includes excluded-address line', () => {
    const run = ios(cliEng, router, 'show running-config').join('\n')
    expect(run).toMatch(/ip dhcp excluded-address 192\.168\.1\.1 192\.168\.1\.10/)
  })

  it('includes pool definition with network / default-router / dns-server', () => {
    const run = ios(cliEng, router, 'show running-config').join('\n')
    expect(run).toMatch(/ip dhcp pool LAN/)
    expect(run).toMatch(/network 192\.168\.1\.0 255\.255\.255\.0/)
    expect(run).toMatch(/default-router 192\.168\.1\.1/)
    expect(run).toMatch(/dns-server 8\.8\.8\.8/)
  })

  it('includes helper-address on interface', () => {
    const run = ios(cliEng, router, 'show running-config').join('\n')
    expect(run).toMatch(/ip helper-address 10\.0\.0\.2/)
  })
})

// ── D11: INTERFACE NOT UP ─────────────────────────────────────────────────────

describe('D11 — dhclient on down interface fails with clear message', () => {
  it('returns error when interface is not up', () => {
    const topo   = new Topology()
    const cliEng = new CLIEngine(topo)
    const pcEng  = new PCCLIEngine(topo)
    const router = makeRouter()
    const pc     = makePc()
    topo.addDevice(router)
    topo.addDevice(pc)
    wire(topo, router, 'GigabitEthernet0/0', pc, 'Ethernet0/0')

    ios(cliEng, router,
      'enable', 'configure terminal',
      'interface GigabitEthernet0/0',
      'ip address 192.168.1.1 255.255.255.0',
      'no shutdown',
      'exit',
      'ip dhcp pool LAN',
      'network 192.168.1.0 255.255.255.0',
      'default-router 192.168.1.1',
      'exit',
    )

    // PC eth0 stays admin_down (not brought up)
    const out = lx(pcEng, pc, 'dhclient eth0')
    expect(out.join('\n')).toMatch(/No DHCPOFFERS|not up/)
    const iface = pc.getInterface('Ethernet0/0')
    expect(iface.ip).toBeNull()
  })
})

// ── D12: NO IP DHCP POOL ──────────────────────────────────────────────────────

describe('D12 — no ip dhcp pool removes pool and its bindings', () => {
  it('pool and bindings are removed', () => {
    const topo   = new Topology()
    const cliEng = new CLIEngine(topo)
    const pcEng  = new PCCLIEngine(topo)
    const router = makeRouter()
    const pc     = makePc()
    topo.addDevice(router)
    topo.addDevice(pc)
    wire(topo, router, 'GigabitEthernet0/0', pc, 'Ethernet0/0')

    ios(cliEng, router,
      'enable', 'configure terminal',
      'interface GigabitEthernet0/0',
      'ip address 192.168.1.1 255.255.255.0',
      'no shutdown',
      'exit',
      'ip dhcp pool LAN',
      'network 192.168.1.0 255.255.255.0',
      'default-router 192.168.1.1',
      'exit',
    )

    lx(pcEng, pc, 'ip link set eth0 up')
    lx(pcEng, pc, 'dhclient eth0')
    expect(router.dhcp_bindings).toHaveLength(1)
    expect(router.dhcp_pools).toHaveLength(1)

    ios(cliEng, router, 'no ip dhcp pool LAN')

    expect(router.dhcp_pools).toHaveLength(0)
    expect(router.dhcp_bindings).toHaveLength(0)
  })
})
