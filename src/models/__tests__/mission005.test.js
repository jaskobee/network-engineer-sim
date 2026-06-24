/**
 * Mission 005 — "Secure the Office" engine tests.
 *
 * M5-TOPO  Topology helper: R1(ROAS-stub) ↔ FW ↔ ISP; FW DMZ ↔ Server; two PCs
 * M5-1     Solved: inside PC can reach ISP (NAT + routing + firewall permit)
 * M5-2     Solved: outside→server:443 reachable (OUTSIDE→DMZ HTTPS permit)
 * M5-3     Solved: outside→server:22 blocked (no SSH permit rule)
 * M5-4     Default-deny: before any rules, inside→outside is blocked
 * M5-5     Stateful: inside-initiated return path works without an explicit inbound rule
 * M5-6     Ordering puzzle — wrong order: broad permit BEFORE deny lets guest through
 * M5-7     Ordering puzzle — correct order: deny BEFORE broad permit blocks guest
 * M5-8     NAT on firewall: private src without NAT → nat_required; with NAT → ok
 * M5-9     FW self-ping not subject to inter-zone policy
 * M5-10    Regression: non-firewall topology unaffected; router→PC ping still works
 * M5-SVC   Service-matching: HTTPS rule does not permit ICMP or SSH to DMZ
 */
import { describe, it, expect } from 'vitest'
import { Device, createIspDevice } from '../Device.js'
import { Topology } from '../Topology.js'
import { CLIEngine } from '../CLIEngine.js'
import { PCCLIEngine } from '../PCCLIEngine.js'

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeDevice(type, portCount = 4) {
  const d = new Device({ type, model: `${type}-test`, portCount, portPrefix: 'GigabitEthernet0/', portStart: 0 })
  d.powered = true
  return d
}

function makePc() {
  const d = new Device({ type: 'pc', model: 'pc-test', portCount: 1, portPrefix: 'Ethernet0/', portStart: 0 })
  d.powered = true
  return d
}

function makeServer() {
  const d = new Device({ type: 'server', model: 'srv-test', portCount: 1, portPrefix: 'Ethernet0/', portStart: 0 })
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

function lin(engine, device, ...cmds) {
  let out = []
  for (const cmd of cmds) out = engine.execute(device, cmd)
  return out
}

/**
 * Build a minimal but complete M005-like topology:
 *
 *   UserPC (192.168.10.50/24)  ─── R1 ─── FW ─── ISP (203.0.113.1)
 *   GuestPC (192.168.20.50/24) ─/    \─── FW DMZ ─── Server (172.16.1.10)
 *
 *   R1:  Gi0/0=192.168.10.1/24  Gi0/1=192.168.20.1/24  Gi0/2=10.0.0.1/30
 *   FW:  Gi0/0=INSIDE:10.0.0.2/30  Gi0/1=DMZ:172.16.1.1/24  Gi0/2=OUTSIDE:203.0.113.2/30
 *
 * @param {{ withPolicy?: boolean, withNat?: boolean }} opts
 *   withPolicy=true  → adds INSIDE→OUTSIDE permit + OUTSIDE→DMZ HTTPS permit
 *   withNat=true     → configures FW NAT (needed for inside→ISP to succeed)
 */
function buildM005Topo({ withPolicy = false, withNat = false } = {}) {
  const topo  = new Topology()
  const eng   = new CLIEngine(topo)
  const pcEng = new PCCLIEngine(topo)

  const r1     = makeDevice('router', 4)
  const fw     = makeDevice('firewall', 4)
  const userPc = makePc()
  const guestPc = makePc()
  const server  = makeServer()
  const isp    = createIspDevice()

  for (const dev of [r1, fw, userPc, guestPc, server, isp]) topo.addDevice(dev)

  // Cable: UserPC→R1 LAN1, GuestPC→R1 LAN2, R1 WAN→FW INSIDE, FW DMZ→Server, FW OUTSIDE→ISP
  wire(topo, r1, 'GigabitEthernet0/0', userPc,  'Ethernet0/0')
  wire(topo, r1, 'GigabitEthernet0/1', guestPc, 'Ethernet0/0')
  wire(topo, r1, 'GigabitEthernet0/2', fw,      'GigabitEthernet0/0')
  wire(topo, fw, 'GigabitEthernet0/1', server,  'Ethernet0/0')
  wire(topo, fw, 'GigabitEthernet0/2', isp,     'WAN0/0')

  // Configure R1
  ios(eng, r1,
    'enable', 'configure terminal',
    'interface GigabitEthernet0/0', 'ip address 192.168.10.1 255.255.255.0', 'no shutdown', 'exit',
    'interface GigabitEthernet0/1', 'ip address 192.168.20.1 255.255.255.0', 'no shutdown', 'exit',
    'interface GigabitEthernet0/2', 'ip address 10.0.0.1 255.255.255.252',   'no shutdown', 'exit',
    'ip route 0.0.0.0 0.0.0.0 10.0.0.2',
  )

  // Configure FW interfaces + zones
  ios(eng, fw,
    'enable', 'configure terminal',
    'interface GigabitEthernet0/0',
    'nameif INSIDE', 'security-level 100',
    'ip address 10.0.0.2 255.255.255.252', 'no shutdown', 'exit',
    'interface GigabitEthernet0/1',
    'nameif DMZ', 'security-level 50',
    'ip address 172.16.1.1 255.255.255.0', 'no shutdown', 'exit',
    'interface GigabitEthernet0/2',
    'nameif OUTSIDE', 'security-level 0',
    'ip address 203.0.113.2 255.255.255.252', 'no shutdown', 'exit',
    // FW routing
    'ip route 0.0.0.0 0.0.0.0 203.0.113.1',
    'ip route 192.168.10.0 255.255.255.0 10.0.0.1',
    'ip route 192.168.20.0 255.255.255.0 10.0.0.1',
  )

  // Configure hosts
  lin(pcEng, userPc,
    'ip addr add 192.168.10.50/24 dev Ethernet0/0',
    'ip link set Ethernet0/0 up',
    'ip route add default via 192.168.10.1',
  )
  lin(pcEng, guestPc,
    'ip addr add 192.168.20.50/24 dev Ethernet0/0',
    'ip link set Ethernet0/0 up',
    'ip route add default via 192.168.20.1',
  )
  lin(pcEng, server,
    'ip addr add 172.16.1.10/24 dev Ethernet0/0',
    'ip link set Ethernet0/0 up',
    'ip route add default via 172.16.1.1',
  )

  if (withNat) {
    ios(eng, fw,
      'enable', 'configure terminal',
      'interface GigabitEthernet0/0', 'ip nat inside', 'exit',
      'interface GigabitEthernet0/2', 'ip nat outside', 'exit',
      'access-list 1 permit 192.168.10.0 0.0.0.255',
      'access-list 1 permit 192.168.20.0 0.0.0.255',
      'ip nat inside source list 1 interface GigabitEthernet0/2 overload',
    )
  }

  if (withPolicy) {
    ios(eng, fw,
      'enable', 'configure terminal',
      'firewall-rule permit from-zone INSIDE to-zone OUTSIDE src any dst any service any',
      'firewall-rule permit from-zone OUTSIDE to-zone DMZ src any dst any service HTTPS',
    )
  }

  return { topo, eng, pcEng, fw, r1, userPc, guestPc, server, isp }
}

// ── M5-4: Default-deny ────────────────────────────────────────────────────────

describe('M5-4 — default-deny: new firewall blocks all inter-zone traffic', () => {
  it('inside→outside blocked when no rules exist', () => {
    const { topo } = buildM005Topo({ withNat: true })
    const r = topo.checkPing('192.168.10.50', '8.8.8.8')
    expect(r.reachable).toBe(false)
    expect(r.failureReason).toBe('blocked_by_firewall')
  })

  it('outside→dmz server blocked when no rules exist', () => {
    const { topo } = buildM005Topo({ withNat: true })
    const r = topo.checkPing('203.0.113.1', '172.16.1.10', { protocol: 'tcp', port: 443 })
    expect(r.reachable).toBe(false)
    expect(r.failureReason).toBe('blocked_by_firewall')
  })
})

// ── M5-1: Solved — inside→ISP works ──────────────────────────────────────────

describe('M5-1 — solved: inside PC can reach ISP through FW with NAT + policy', () => {
  it('inside PC → 8.8.8.8 succeeds with NAT + INSIDE→OUTSIDE permit', () => {
    const { topo } = buildM005Topo({ withNat: true, withPolicy: true })
    const r = topo.checkPing('192.168.10.50', '8.8.8.8')
    expect(r.reachable).toBe(true)
  })

  it('guest PC → 8.8.8.8 also succeeds (INSIDE→OUTSIDE covers all inside hosts)', () => {
    const { topo } = buildM005Topo({ withNat: true, withPolicy: true })
    const r = topo.checkPing('192.168.20.50', '8.8.8.8')
    expect(r.reachable).toBe(true)
  })

  it('inside→ISP fails without NAT even with the permit rule (nat_required)', () => {
    const { topo } = buildM005Topo({ withNat: false, withPolicy: true })
    const r = topo.checkPing('192.168.10.50', '8.8.8.8')
    expect(r.reachable).toBe(false)
    expect(r.failureReason).toBe('nat_required')
  })
})

// ── M5-2: Solved — OUTSIDE→DMZ HTTPS works ───────────────────────────────────

describe('M5-2 — solved: outside→server:443 reachable via OUTSIDE→DMZ HTTPS rule', () => {
  it('ISP IP → server:443 succeeds', () => {
    const { topo } = buildM005Topo({ withNat: true, withPolicy: true })
    const r = topo.checkPing('203.0.113.1', '172.16.1.10', { protocol: 'tcp', port: 443 })
    expect(r.reachable).toBe(true)
  })
})

// ── M5-3: Service-specific blocking ──────────────────────────────────────────

describe('M5-3 — service-specific: HTTPS rule does not permit other protocols to DMZ', () => {
  it('outside→server:22 (SSH) blocked — no rule for SSH', () => {
    const { topo } = buildM005Topo({ withNat: true, withPolicy: true })
    const r = topo.checkPing('203.0.113.1', '172.16.1.10', { protocol: 'tcp', port: 22 })
    expect(r.reachable).toBe(false)
    expect(r.failureReason).toBe('blocked_by_firewall')
  })

  it('outside ICMP ping to server blocked (no ICMP rule to DMZ)', () => {
    const { topo } = buildM005Topo({ withNat: true, withPolicy: true })
    const r = topo.checkPing('203.0.113.1', '172.16.1.10')  // default = ICMP
    expect(r.reachable).toBe(false)
    expect(r.failureReason).toBe('blocked_by_firewall')
  })

  it('outside→server:443 still works alongside the SSH block', () => {
    const { topo } = buildM005Topo({ withNat: true, withPolicy: true })
    const https = topo.checkPing('203.0.113.1', '172.16.1.10', { protocol: 'tcp', port: 443 })
    const ssh   = topo.checkPing('203.0.113.1', '172.16.1.10', { protocol: 'tcp', port: 22 })
    expect(https.reachable).toBe(true)
    expect(ssh.reachable).toBe(false)
  })
})

// ── M5-5: Stateful return path ────────────────────────────────────────────────

describe('M5-5 — stateful: return traffic allowed without explicit inbound rule', () => {
  it('inside-initiated flow succeeds even without an explicit OUTSIDE→INSIDE permit', () => {
    const { topo, eng, fw } = buildM005Topo({ withNat: true })
    // Only add the outbound permit; no explicit inbound return rule
    ios(eng, fw,
      'enable', 'configure terminal',
      'firewall-rule permit from-zone INSIDE to-zone OUTSIDE src any dst any service any',
    )
    // inside→outside must succeed (stateful session allows return)
    const r = topo.checkPing('192.168.10.50', '8.8.8.8')
    expect(r.reachable).toBe(true)
  })

  it('session is recorded after successful outbound ping', () => {
    const { topo, eng, fw } = buildM005Topo({ withNat: true })
    ios(eng, fw,
      'enable', 'configure terminal',
      'firewall-rule permit from-zone INSIDE to-zone OUTSIDE src any dst any service any',
    )
    topo.checkPing('192.168.10.50', '8.8.8.8')
    expect(fw.fw_sessions.length).toBeGreaterThan(0)
  })

  it('unsolicited inbound still blocked even after outbound session (no outbound from that pair)', () => {
    const { topo, eng, fw } = buildM005Topo({ withNat: true })
    ios(eng, fw,
      'enable', 'configure terminal',
      'firewall-rule permit from-zone INSIDE to-zone OUTSIDE src any dst any service any',
    )
    // Try to initiate a new connection FROM outside — no existing session from 203.0.113.1 side
    const r = topo.checkPing('203.0.113.1', '192.168.10.50')
    expect(r.reachable).toBe(false)
    expect(r.failureReason).toBe('blocked_by_firewall')
  })
})

// ── M5-6/7: Ordering puzzle ───────────────────────────────────────────────────

describe('M5-6/7 — ordering puzzle: first-match wins for INSIDE→DMZ guest/user split', () => {
  function addInsideDmzRules(eng, fw, guestDenyFirst) {
    ios(eng, fw, 'enable', 'configure terminal')
    if (guestDenyFirst) {
      // Correct order: deny guest → permit all INSIDE
      ios(eng, fw, 'firewall-rule deny  from-zone INSIDE to-zone DMZ src 192.168.20.0/24 dst any service any')
      ios(eng, fw, 'firewall-rule permit from-zone INSIDE to-zone DMZ src any dst any service HTTPS')
    } else {
      // Wrong order: broad permit ABOVE the deny → guest slips through
      ios(eng, fw, 'firewall-rule permit from-zone INSIDE to-zone DMZ src any dst any service HTTPS')
      ios(eng, fw, 'firewall-rule deny  from-zone INSIDE to-zone DMZ src 192.168.20.0/24 dst any service any')
    }
  }

  it('M5-6 wrong order: broad permit before deny → guest reaches DMZ server:443', () => {
    const { topo, eng, fw } = buildM005Topo({ withNat: true, withPolicy: true })
    addInsideDmzRules(eng, fw, false)
    const r = topo.checkPing('192.168.20.50', '172.16.1.10', { protocol: 'tcp', port: 443 })
    expect(r.reachable).toBe(true)  // broad permit matched first — guest gets through
  })

  it('M5-7 correct order: deny above broad permit → guest blocked from DMZ', () => {
    const { topo, eng, fw } = buildM005Topo({ withNat: true, withPolicy: true })
    addInsideDmzRules(eng, fw, true)
    const r = topo.checkPing('192.168.20.50', '172.16.1.10', { protocol: 'tcp', port: 443 })
    expect(r.reachable).toBe(false)
    expect(r.failureReason).toBe('blocked_by_firewall')
  })

  it('M5-7 correct order: user VLAN still reaches DMZ:443 despite guest deny rule', () => {
    const { topo, eng, fw } = buildM005Topo({ withNat: true, withPolicy: true })
    addInsideDmzRules(eng, fw, true)
    const r = topo.checkPing('192.168.10.50', '172.16.1.10', { protocol: 'tcp', port: 443 })
    expect(r.reachable).toBe(true)  // user (192.168.10.x) not matched by guest deny → falls to permit
  })

  it('deny rule is directional: outside→DMZ:443 still works (deny only covers INSIDE zone)', () => {
    const { topo, eng, fw } = buildM005Topo({ withNat: true, withPolicy: true })
    addInsideDmzRules(eng, fw, true)
    const r = topo.checkPing('203.0.113.1', '172.16.1.10', { protocol: 'tcp', port: 443 })
    expect(r.reachable).toBe(true)  // OUTSIDE→DMZ permit (from withPolicy) still applies
  })
})

// ── M5-8: NAT on firewall ─────────────────────────────────────────────────────

describe('M5-8 — NAT on firewall device: private src requires NAT to reach ISP', () => {
  it('private src → ISP fails with nat_required when FW has no NAT config', () => {
    const { topo } = buildM005Topo({ withNat: false, withPolicy: true })
    const r = topo.checkPing('192.168.10.50', '8.8.8.8')
    expect(r.reachable).toBe(false)
    expect(r.failureReason).toBe('nat_required')
  })

  it('private src → ISP succeeds after NAT is configured on the FW', () => {
    const { topo } = buildM005Topo({ withNat: true, withPolicy: true })
    const r = topo.checkPing('192.168.10.50', '8.8.8.8')
    expect(r.reachable).toBe(true)
  })

  it('FW nat_acls and nat_rules are populated after CLI config', () => {
    const { fw } = buildM005Topo({ withNat: true })
    expect(fw.nat_acls.length).toBeGreaterThan(0)
    expect(fw.nat_rules.length).toBeGreaterThan(0)
  })

  it('translation entry created in fw.nat_translations after successful ping', () => {
    const { topo, fw } = buildM005Topo({ withNat: true, withPolicy: true })
    topo.checkPing('192.168.10.50', '8.8.8.8')
    expect(fw.nat_translations.length).toBeGreaterThan(0)
    const t = fw.nat_translations[0]
    expect(t.inside_local).toBe('192.168.10.50')
    expect(t.inside_global).toBe('203.0.113.2')  // FW OUTSIDE IP
  })
})

// ── M5-9: FW self-ping bypass ─────────────────────────────────────────────────

describe('M5-9 — FW self-ping not subject to inter-zone policy', () => {
  it('FW can ping its own INSIDE interface IP without a rule (management traffic bypass)', () => {
    const { topo, fw } = buildM005Topo()
    // No rules at all — FW-originated pings bypass zone policy
    const r = topo.checkPing('10.0.0.2', '10.0.0.1')
    // R1 is directly connected; this shouldn't require any FW zone rule
    expect(r.failureReason).not.toBe('blocked_by_firewall')
  })
})

// ── M5-10: Regression ─────────────────────────────────────────────────────────

describe('M5-10 — regression: non-firewall topologies still work correctly', () => {
  it('simple router↔PC topology works (firewall engine not involved)', () => {
    const topo    = new Topology()
    const eng     = new CLIEngine(topo)
    const pcEng   = new PCCLIEngine(topo)
    const router  = makeDevice('router', 2)
    const pc      = makePc()
    topo.addDevice(router)
    topo.addDevice(pc)
    topo.connect(`${router.id}:GigabitEthernet0/0`, `${pc.id}:Ethernet0/0`)
    ios(eng, router,
      'enable', 'configure terminal',
      'interface GigabitEthernet0/0', 'ip address 192.168.1.1 255.255.255.0', 'no shutdown',
    )
    lin(pcEng, pc,
      'ip addr add 192.168.1.10/24 dev Ethernet0/0', 'ip link set Ethernet0/0 up',
    )
    const r = topo.checkPing('192.168.1.1', '192.168.1.10')
    expect(r.reachable).toBe(true)
  })

  it('adding NAT fields to firewall device does not break router NAT', () => {
    const { topo } = buildM005Topo({ withNat: true, withPolicy: true })
    // Router in our test topology has no NAT — it should still forward normally
    const r = topo.checkPing('192.168.10.50', '192.168.20.50')
    // This is LAN-to-LAN through R1 (no firewall between them) — should succeed
    expect(r.reachable).toBe(true)
  })
})

// ── M5-SVC: Service matching in detail ────────────────────────────────────────

describe('M5-SVC — service matching with real IANA ports', () => {
  it('tcp/443 rule permits HTTPS but not HTTP (port 80)', () => {
    const { topo } = buildM005Topo({ withNat: true, withPolicy: true })
    const https = topo.checkPing('203.0.113.1', '172.16.1.10', { protocol: 'tcp', port: 443 })
    const http  = topo.checkPing('203.0.113.1', '172.16.1.10', { protocol: 'tcp', port: 80  })
    expect(https.reachable).toBe(true)
    expect(http.reachable).toBe(false)
    expect(http.failureReason).toBe('blocked_by_firewall')
  })

  it('service keyword HTTPS resolves to tcp/443 (same result as explicit tcp/443)', () => {
    const { topo, eng, fw } = buildM005Topo({ withNat: true })
    ios(eng, fw,
      'enable', 'configure terminal',
      'firewall-rule permit from-zone INSIDE to-zone OUTSIDE src any dst any service any',
      // Using keyword form
      'firewall-rule permit from-zone OUTSIDE to-zone DMZ src any dst any service HTTPS',
    )
    const r = topo.checkPing('203.0.113.1', '172.16.1.10', { protocol: 'tcp', port: 443 })
    expect(r.reachable).toBe(true)
  })

  it('HTTPS rule does not match ICMP (different protocol)', () => {
    const { topo } = buildM005Topo({ withNat: true, withPolicy: true })
    // ICMP ping to server from outside — no ICMP rule to DMZ
    const r = topo.checkPing('203.0.113.1', '172.16.1.10', { protocol: 'icmp', port: null })
    expect(r.reachable).toBe(false)
    expect(r.failureReason).toBe('blocked_by_firewall')
  })
})
