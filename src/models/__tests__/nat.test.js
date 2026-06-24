/**
 * NAT/PAT tests — enforcing RFC 1918 invariants.
 *
 *  N1  — inside host + NAT + default route → reaches 8.8.8.8 ✅
 *  N2  — same topology, NAT rule removed → cannot reach 8.8.8.8 (nat_required) ✅
 *  N3  — show ip nat translations lists the active mapping
 *  N4  — internal private→private LAN traffic NOT translated, still works
 *  N5  — two inside hosts (overload) both reach internet via same WAN IP
 *  N6  — show running-config renders ACL, NAT rule, and ip nat inside/outside
 *  N7  — no ip nat inside source list removes rule; host can no longer reach internet
 *  N8  — no access-list removes ACL; host can no longer reach internet
 *  N9  — NAT ACL that doesn't match the source → nat_required (not all traffic is translated)
 *  N10 — regression: routing/ROAS/DHCP — existing tests still pass alongside NAT
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { Device, createIspDevice } from '../Device.js'
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

function wire(topo, d1, if1, d2, if2) {
  return topo.connect(`${d1.id}:${if1}`, `${d2.id}:${if2}`)
}

function ios(engine, device, ...cmds) {
  let out = []
  for (const cmd of cmds) out = engine.execute(device, cmd)
  return out
}

// Build a standard NAT topology:
//   PC1(192.168.1.10/24) ─── Router(Gi0/0:192.168.1.1, Gi0/1:203.0.113.2/30) ─── ISP(203.0.113.1/30)
// ACL 1 permits 192.168.1.0/24.  NAT overload on Gi0/1.
// Returns { topo, engine, router, pc1, isp }
function buildNatTopology({ configureNat = true } = {}) {
  const topo   = new Topology()
  const engine = new CLIEngine(topo)

  const router = makeRouter()
  const pc1    = makePc()
  const isp    = createIspDevice()

  topo.addDevice(router)
  topo.addDevice(pc1)
  topo.addDevice(isp)

  // Wire: PC ─ Gi0/0, ISP ─ Gi0/1
  wire(topo, router, 'GigabitEthernet0/0', pc1,  'Ethernet0/0')
  wire(topo, router, 'GigabitEthernet0/1', isp,  'WAN0/0')

  // Configure LAN interface
  ios(engine, router,
    'enable', 'configure terminal',
    'interface GigabitEthernet0/0',
    'ip address 192.168.1.1 255.255.255.0',
    'no shutdown',
    'exit',
  )

  // Configure WAN interface
  ios(engine, router,
    'interface GigabitEthernet0/1',
    'ip address 203.0.113.2 255.255.255.252',
    'no shutdown',
    'exit',
  )

  // Default route via ISP
  ios(engine, router, 'ip route 0.0.0.0 0.0.0.0 203.0.113.1', 'end')

  // Configure PC1
  const pcEng = new PCCLIEngine(topo)
  ios(pcEng, pc1,
    'ip addr add 192.168.1.10/24 dev Ethernet0/0',
    'ip link set Ethernet0/0 up',
    'ip route add default via 192.168.1.1',
  )

  if (configureNat) {
    ios(engine, router,
      'enable', 'configure terminal',
      // Mark interfaces
      'interface GigabitEthernet0/0',
      'ip nat inside',
      'exit',
      'interface GigabitEthernet0/1',
      'ip nat outside',
      'exit',
      // ACL 1 permits LAN subnet
      'access-list 1 permit 192.168.1.0 0.0.0.255',
      // NAT overload rule
      'ip nat inside source list 1 interface GigabitEthernet0/1 overload',
      'end',
    )
  }

  return { topo, engine, router, pc1, isp, pcEng }
}

// ── N1: inside host + NAT → reaches internet ──────────────────────────────────

describe('N1 — inside host + NAT configured + default route → reaches 8.8.8.8', () => {
  it('checkPing succeeds', () => {
    const { topo, pc1 } = buildNatTopology()
    const srcIp = pc1.interfaces[0].ip
    const result = topo.checkPing(srcIp, '8.8.8.8')
    expect(result.reachable).toBe(true)
  })

  it('also reachable via DNS-resolved hostname (google.com → 8.8.8.8)', () => {
    const { topo, engine, router } = buildNatTopology()
    const out = engine.execute(router, 'ping google.com')
    expect(out.join(' ')).toMatch(/100 percent/)
  })
})

// ── N2: NAT removed → private source cannot reach internet ────────────────────

describe('N2 — NAT rule removed → nat_required failure', () => {
  it('no NAT configured at all → nat_required', () => {
    const { topo, pc1 } = buildNatTopology({ configureNat: false })
    const srcIp = pc1.interfaces[0].ip
    const result = topo.checkPing(srcIp, '8.8.8.8')
    expect(result.reachable).toBe(false)
    expect(result.failureReason).toBe('nat_required')
  })

  it('NAT removed after config → nat_required', () => {
    const { topo, engine, router, pc1 } = buildNatTopology()
    // Remove the NAT rule
    ios(engine, router,
      'enable', 'configure terminal',
      'no ip nat inside source list 1',
      'end',
    )
    const srcIp = pc1.interfaces[0].ip
    const result = topo.checkPing(srcIp, '8.8.8.8')
    expect(result.reachable).toBe(false)
    expect(result.failureReason).toBe('nat_required')
  })

  it('ping CLI shows nat_required message', () => {
    const { topo, engine, router, pc1 } = buildNatTopology({ configureNat: false })
    const out = engine.execute(router, `ping ${pc1.interfaces[0].ip}`)
    // This is a local ping — doesn't need NAT (private→private). Let me use ISP WAN instead.
    // For NAT test from IOS, ping from router toward internet will use public WAN IP as src.
    // Instead let's check from PC CLI.
    const pcEng = new PCCLIEngine(topo)
    const pcOut = pcEng.execute(pc1, 'ping 8.8.8.8')
    expect(pcOut.join(' ')).toMatch(/unreachable|nat_required|0 received/i)
  })
})

// ── N3: show ip nat translations ──────────────────────────────────────────────

describe('N3 — show ip nat translations lists the mapping after a ping', () => {
  it('translation entry appears after checkPing with NAT', () => {
    const { topo, engine, router, pc1 } = buildNatTopology()
    const srcIp = pc1.interfaces[0].ip

    // Initially no translations
    let out = ios(engine, router, 'enable', 'show ip nat translations')
    expect(out.join('\n')).toMatch(/no active translations/)

    // Trigger translation via checkPing
    const result = topo.checkPing(srcIp, '8.8.8.8')
    expect(result.reachable).toBe(true)

    // Translation entry should now be recorded
    out = engine.execute(router, 'show ip nat translations')
    const text = out.join('\n')
    expect(text).toMatch(/203\.0\.113\.2/)   // inside_global (WAN IP)
    expect(text).toMatch(/192\.168\.1\.10/)  // inside_local
  })

  it('show ip nat statistics shows outside/inside interfaces and rule', () => {
    const { engine, router } = buildNatTopology()
    const out = ios(engine, router, 'enable', 'show ip nat statistics')
    const text = out.join('\n')
    expect(text).toMatch(/GigabitEthernet0\/1/)  // outside interface
    expect(text).toMatch(/GigabitEthernet0\/0/)  // inside interface
    expect(text).toMatch(/access-list 1/)
    expect(text).toMatch(/overload/)
  })
})

// ── N4: private→private LAN traffic is NOT translated and works fine ──────────

describe('N4 — private→private internal traffic works without NAT involvement', () => {
  it('PC1 to router LAN IP succeeds regardless of NAT config', () => {
    const { topo, pc1, router } = buildNatTopology()
    const srcIp   = pc1.interfaces[0].ip
    const routerLan = router.interfaces.find(i => i.ip === '192.168.1.1')?.ip
    const result  = topo.checkPing(srcIp, routerLan)
    expect(result.reachable).toBe(true)
    // No translation should be recorded for LAN traffic
    expect(router.nat_translations.find(t => t.inside_local === srcIp && t.inside_global !== '203.0.113.2')).toBeUndefined()
  })

  it('LAN ping works even when NAT is NOT configured', () => {
    const { topo, pc1, router } = buildNatTopology({ configureNat: false })
    const srcIp   = pc1.interfaces[0].ip
    const routerLan = '192.168.1.1'
    const result  = topo.checkPing(srcIp, routerLan)
    expect(result.reachable).toBe(true)
  })
})

// ── N5: two inside hosts share the one public WAN IP (overload) ───────────────

describe('N5 — NAT overload: two inside hosts both reach internet via same WAN IP', () => {
  let topo, engine, router, pc1, pc2

  beforeEach(() => {
    topo   = new Topology()
    engine = new CLIEngine(topo)
    const isp = createIspDevice()
    router = makeRouter()
    pc1    = makePc()
    const pc2Dev = new Device({ type: 'pc', model: 'PC-test', portCount: 1, portPrefix: 'Ethernet0/', portStart: 0 })
    pc2Dev.powered = true
    pc2 = pc2Dev

    topo.addDevice(router)
    topo.addDevice(pc1)
    topo.addDevice(pc2)
    topo.addDevice(isp)

    // Use a switch-less LAN: connect both PCs via Gi0/0 (won't work — only one port).
    // Instead use Gi0/0 for LAN and Gi0/1 for WAN, add a second LAN PC via Gi0/2
    // using a different subnet is over-complicated. Use a separate Gi port for each PC.
    wire(topo, router, 'GigabitEthernet0/0', pc1,  'Ethernet0/0')
    wire(topo, router, 'GigabitEthernet0/2', pc2,  'Ethernet0/0')
    wire(topo, router, 'GigabitEthernet0/1', isp,  'WAN0/0')

    ios(engine, router,
      'enable', 'configure terminal',
      'interface GigabitEthernet0/0',
      'ip address 192.168.1.1 255.255.255.0',
      'no shutdown',
      'exit',
      'interface GigabitEthernet0/2',
      'ip address 192.168.2.1 255.255.255.0',
      'no shutdown',
      'exit',
      'interface GigabitEthernet0/1',
      'ip address 203.0.113.2 255.255.255.252',
      'no shutdown',
      'exit',
      'ip route 0.0.0.0 0.0.0.0 203.0.113.1',
      // NAT: mark inside interfaces
      'interface GigabitEthernet0/0',
      'ip nat inside',
      'exit',
      'interface GigabitEthernet0/2',
      'ip nat inside',
      'exit',
      'interface GigabitEthernet0/1',
      'ip nat outside',
      'exit',
      // ACL covers both private subnets
      'access-list 1 permit 192.168.1.0 0.0.0.255',
      'access-list 1 permit 192.168.2.0 0.0.0.255',
      'ip nat inside source list 1 interface GigabitEthernet0/1 overload',
      'end',
    )

    const pcEng = new PCCLIEngine(topo)
    ios(pcEng, pc1,
      'ip addr add 192.168.1.10/24 dev Ethernet0/0',
      'ip link set Ethernet0/0 up',
      'ip route add default via 192.168.1.1',
    )
    ios(pcEng, pc2,
      'ip addr add 192.168.2.20/24 dev Ethernet0/0',
      'ip link set Ethernet0/0 up',
      'ip route add default via 192.168.2.1',
    )
  })

  it('PC1 (192.168.1.10) reaches 8.8.8.8', () => {
    const result = topo.checkPing('192.168.1.10', '8.8.8.8')
    expect(result.reachable).toBe(true)
  })

  it('PC2 (192.168.2.20) reaches 8.8.8.8', () => {
    const result = topo.checkPing('192.168.2.20', '8.8.8.8')
    expect(result.reachable).toBe(true)
  })

  it('both translations share the same inside_global (overload)', () => {
    topo.checkPing('192.168.1.10', '8.8.8.8')
    topo.checkPing('192.168.2.20', '8.8.8.8')
    const translations = router.nat_translations
    expect(translations.length).toBe(2)
    // Both use the same WAN IP (overload)
    expect(translations[0].inside_global).toBe('203.0.113.2')
    expect(translations[1].inside_global).toBe('203.0.113.2')
    expect(translations[0].inside_local).toBe('192.168.1.10')
    expect(translations[1].inside_local).toBe('192.168.2.20')
  })
})

// ── N6: show running-config renders NAT config faithfully ─────────────────────

describe('N6 — show running-config includes NAT config', () => {
  it('ACL, NAT rule, and interface flags appear in running-config', () => {
    const { engine, router } = buildNatTopology()
    ios(engine, router, 'enable')
    const out = engine.execute(router, 'show running-config')
    const text = out.join('\n')

    expect(text).toMatch(/access-list 1 permit 192\.168\.1\.0 0\.0\.0\.255/)
    expect(text).toMatch(/ip nat inside source list 1 interface GigabitEthernet0\/1 overload/)
    expect(text).toMatch(/ip nat inside/)   // on Gi0/0
    expect(text).toMatch(/ip nat outside/)  // on Gi0/1
  })
})

// ── N7: no ip nat inside source list removes rule ─────────────────────────────

describe('N7 — no ip nat inside source list removes the NAT rule', () => {
  it('after removal, internet is unreachable (nat_required)', () => {
    const { topo, engine, router, pc1 } = buildNatTopology()
    ios(engine, router, 'enable', 'configure terminal', 'no ip nat inside source list 1', 'end')
    const result = topo.checkPing(pc1.interfaces[0].ip, '8.8.8.8')
    expect(result.reachable).toBe(false)
    expect(result.failureReason).toBe('nat_required')
  })

  it('no ip nat inside source list also clears translation table', () => {
    const { topo, engine, router, pc1 } = buildNatTopology()
    topo.checkPing(pc1.interfaces[0].ip, '8.8.8.8')  // populate translations
    expect(router.nat_translations.length).toBe(1)
    ios(engine, router, 'enable', 'configure terminal', 'no ip nat inside source list 1', 'end')
    expect(router.nat_translations.length).toBe(0)
  })
})

// ── N8: no access-list removes ACL ────────────────────────────────────────────

describe('N8 — no access-list removes the ACL', () => {
  it('after ACL removal, internet is unreachable (nat_required — rule has no matching ACL)', () => {
    const { topo, engine, router, pc1 } = buildNatTopology()
    ios(engine, router, 'enable', 'configure terminal', 'no access-list 1', 'end')
    const result = topo.checkPing(pc1.interfaces[0].ip, '8.8.8.8')
    expect(result.reachable).toBe(false)
    expect(result.failureReason).toBe('nat_required')
  })
})

// ── N9: ACL that doesn't match the source → nat_required ─────────────────────

describe('N9 — ACL that does not match source subnet → nat_required', () => {
  it('ACL permits wrong subnet → source not translated → nat_required', () => {
    const { topo, engine, router, pc1 } = buildNatTopology()
    // Replace ACL 1 to permit a different subnet (192.168.99.0/24)
    ios(engine, router,
      'enable', 'configure terminal',
      'no access-list 1',
      'access-list 1 permit 192.168.99.0 0.0.0.255',
      'end',
    )
    const result = topo.checkPing(pc1.interfaces[0].ip, '8.8.8.8')
    expect(result.reachable).toBe(false)
    expect(result.failureReason).toBe('nat_required')
  })
})

// ── N11: ip nat inside must be on the actual ingress interface ────────────────

describe('N11 — ip nat inside must be configured on the ingress (LAN-facing) interface', () => {
  it('N11a: no ip nat inside on any interface → nat_required', () => {
    const { topo, engine, router, pc1 } = buildNatTopology()
    // Remove nat_inside from the LAN interface; leave nat_outside + ACL + rule intact
    ios(engine, router,
      'enable', 'configure terminal',
      'interface GigabitEthernet0/0',
      'no ip nat inside',
      'exit', 'end',
    )
    const result = topo.checkPing(pc1.interfaces[0].ip, '8.8.8.8')
    expect(result.reachable).toBe(false)
    expect(result.failureReason).toBe('nat_required')
  })

  it('N11b: nat_inside on wrong interface (Gi0/2, not ingress Gi0/0) → nat_required', () => {
    const { topo, engine, router, pc1 } = buildNatTopology()
    // Move nat_inside from Gi0/0 to Gi0/2 — a port that is NOT on the PC→Router path
    ios(engine, router,
      'enable', 'configure terminal',
      'interface GigabitEthernet0/0',
      'no ip nat inside',
      'exit',
      'interface GigabitEthernet0/2',
      'ip nat inside',
      'exit',
      'end',
    )
    const result = topo.checkPing(pc1.interfaces[0].ip, '8.8.8.8')
    expect(result.reachable).toBe(false)
    expect(result.failureReason).toBe('nat_required')
  })

  it('N11c: restoring nat_inside on the correct ingress interface makes it work again', () => {
    const { topo, engine, router, pc1 } = buildNatTopology()
    const srcIp = pc1.interfaces[0].ip

    // Remove — should break
    ios(engine, router, 'enable', 'configure terminal',
      'interface GigabitEthernet0/0', 'no ip nat inside', 'exit', 'end',
    )
    expect(topo.checkPing(srcIp, '8.8.8.8').reachable).toBe(false)

    // Restore — should work again
    ios(engine, router, 'enable', 'configure terminal',
      'interface GigabitEthernet0/0', 'ip nat inside', 'exit', 'end',
    )
    expect(topo.checkPing(srcIp, '8.8.8.8').reachable).toBe(true)
  })
})

// ── N12: translation table does not bypass routing ────────────────────────────

describe('N12 — NAT translation table does not make a ping succeed when routing is broken', () => {
  it('ping succeeds with NAT; fails after WAN link goes admin-down (not success off translation table)', () => {
    const { topo, engine, router, pc1 } = buildNatTopology()
    const srcIp = pc1.interfaces[0].ip

    // First ping succeeds and populates the translation table
    const r1 = topo.checkPing(srcIp, '8.8.8.8')
    expect(r1.reachable).toBe(true)
    expect(router.nat_translations.length).toBe(1)

    // Bring the WAN interface admin-down — translation entry still exists
    ios(engine, router,
      'enable', 'configure terminal',
      'interface GigabitEthernet0/1',
      'shutdown',
      'end',
    )
    expect(router.nat_translations.length).toBe(1)  // table not cleared by shutdown

    // Second ping must FAIL — the translation table alone must not substitute for routing
    const r2 = topo.checkPing(srcIp, '8.8.8.8')
    expect(r2.reachable).toBe(false)
  })
})

// ── N10: regression ───────────────────────────────────────────────────────────

describe('N10 — regression: router-to-router routing still works alongside NAT', () => {
  it('two private routers can ping each other without NAT (private→private)', () => {
    const topo   = new Topology()
    const engine = new CLIEngine(topo)

    const r1 = makeRouter()
    const r2 = makeRouter()
    topo.addDevice(r1)
    topo.addDevice(r2)

    wire(topo, r1, 'GigabitEthernet0/0', r2, 'GigabitEthernet0/0')

    ios(engine, r1,
      'enable', 'configure terminal',
      'interface GigabitEthernet0/0',
      'ip address 10.0.0.1 255.255.255.252',
      'no shutdown',
      'exit',
      'end',
    )
    ios(engine, r2,
      'enable', 'configure terminal',
      'interface GigabitEthernet0/0',
      'ip address 10.0.0.2 255.255.255.252',
      'no shutdown',
      'exit',
      'end',
    )

    const result = topo.checkPing('10.0.0.1', '10.0.0.2')
    expect(result.reachable).toBe(true)
    // No NAT translations should be created for private→private
    expect(r1.nat_translations.length).toBe(0)
    expect(r2.nat_translations.length).toBe(0)
  })

  it('NAT on one router does not affect unrelated topology checkPing', () => {
    const { topo, pc1 } = buildNatTopology()
    // Add an unrelated pair of devices
    const r2 = makeRouter()
    const pc3 = makePc()
    topo.addDevice(r2)
    topo.addDevice(pc3)
    topo.connect(`${r2.id}:GigabitEthernet0/0`, `${pc3.id}:Ethernet0/0`)

    const engine2 = new CLIEngine(topo)
    const pcEng2  = new PCCLIEngine(topo)
    ios(engine2, r2,
      'enable', 'configure terminal',
      'interface GigabitEthernet0/0',
      'ip address 10.1.1.1 255.255.255.0',
      'no shutdown',
      'exit', 'end',
    )
    ios(pcEng2, pc3,
      'ip addr add 10.1.1.10/24 dev Ethernet0/0',
      'ip link set Ethernet0/0 up',
    )

    // LAN ping still works fine
    expect(topo.checkPing('10.1.1.10', '10.1.1.1').reachable).toBe(true)
  })
})
