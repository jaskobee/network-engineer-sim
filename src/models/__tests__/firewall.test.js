/**
 * Firewall engine tests — zone-based stateful filtering invariants.
 *
 * FW1  DEFAULT-DENY      no rules → inside cannot reach outside (blocked_by_firewall)
 * FW2  STATEFUL OUTBOUND inside→outside permit → ping succeeds; session recorded;
 *                        return path uses session (not an explicit inbound rule)
 * FW3  UNSOLICITED INBOUND BLOCKED  with only inside→outside permit, outside-initiated
 *                        traffic toward inside is DENIED (proves statefulness ≠ ACL)
 * FW4  EXPLICIT INBOUND ALLOW  outside→dmz rule permits that specific flow;
 *                        other inbound (outside→inside) still denied
 * FW5  ORDER MATTERS     deny above permit → denied; remove deny → allowed (first-match)
 * FW6  DMZ ZONES         inside→dmz and outside→dmz governed independently by rules
 * FW7  REGRESSION        non-firewall topologies unaffected; fw-originated pings
 *                        not subject to inter-zone policy (ingressIfaceId null bypass)
 */
import { describe, it, expect } from 'vitest'
import { Device } from '../Device.js'
import { Topology } from '../Topology.js'
import { CLIEngine } from '../CLIEngine.js'
import { PCCLIEngine } from '../PCCLIEngine.js'

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeFirewall() {
  const d = new Device({ type: 'firewall', model: 'ASA-5506-X', portCount: 4, portPrefix: 'GigabitEthernet0/', portStart: 0 })
  d.powered = true
  return d
}

function makeRouter() {
  const d = new Device({ type: 'router', model: 'R-test', portCount: 2, portPrefix: 'GigabitEthernet0/', portStart: 0 })
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

/**
 * Standard topology:
 *   pcInside(10.1.0.10/24)  ── FW ──  pcOutside(10.2.0.10/24)
 *                    Gi0/0:INSIDE:10.1.0.1   Gi0/1:OUTSIDE:10.2.0.1
 *
 * With configureDmz=true also adds:
 *                    Gi0/2:DMZ:10.3.0.1  ── pcDmz(10.3.0.10/24)
 */
function buildFwTopology({ configureDmz = false } = {}) {
  const topo    = new Topology()
  const fwEng   = new CLIEngine(topo)
  const pcEng   = new PCCLIEngine(topo)

  const fw        = makeFirewall()
  const pcInside  = makePc()
  const pcOutside = makePc()

  topo.addDevice(fw)
  topo.addDevice(pcInside)
  topo.addDevice(pcOutside)

  wire(topo, fw, 'GigabitEthernet0/0', pcInside,  'Ethernet0/0')
  wire(topo, fw, 'GigabitEthernet0/1', pcOutside, 'Ethernet0/0')

  ios(fwEng, fw,
    'enable', 'configure terminal',
    'interface GigabitEthernet0/0',
    'nameif INSIDE',
    'security-level 100',
    'ip address 10.1.0.1 255.255.255.0',
    'no shutdown',
    'exit',
    'interface GigabitEthernet0/1',
    'nameif OUTSIDE',
    'security-level 0',
    'ip address 10.2.0.1 255.255.255.0',
    'no shutdown',
    'exit',
    'end',
  )

  ios(pcEng, pcInside,
    'ip addr add 10.1.0.10/24 dev Ethernet0/0',
    'ip link set Ethernet0/0 up',
    'ip route add default via 10.1.0.1',
  )

  ios(pcEng, pcOutside,
    'ip addr add 10.2.0.10/24 dev Ethernet0/0',
    'ip link set Ethernet0/0 up',
    'ip route add default via 10.2.0.1',
  )

  let pcDmz = null
  if (configureDmz) {
    pcDmz = makePc()
    topo.addDevice(pcDmz)
    wire(topo, fw, 'GigabitEthernet0/2', pcDmz, 'Ethernet0/0')

    ios(fwEng, fw,
      'enable', 'configure terminal',
      'interface GigabitEthernet0/2',
      'nameif DMZ',
      'security-level 50',
      'ip address 10.3.0.1 255.255.255.0',
      'no shutdown',
      'exit',
      'end',
    )
    ios(pcEng, pcDmz,
      'ip addr add 10.3.0.10/24 dev Ethernet0/0',
      'ip link set Ethernet0/0 up',
      'ip route add default via 10.3.0.1',
    )
  }

  return { topo, fwEng, fw, pcInside, pcOutside, pcDmz }
}

// ── FW1: Default-deny ─────────────────────────────────────────────────────────

describe('FW1 — default-deny: firewall with no rules blocks all inter-zone traffic', () => {
  it('inside→outside blocked with blocked_by_firewall when no rules exist', () => {
    const { topo } = buildFwTopology()
    const result = topo.checkPing('10.1.0.10', '10.2.0.10')
    expect(result.reachable).toBe(false)
    expect(result.failureReason).toBe('blocked_by_firewall')
  })

  it('outside→inside also blocked by default', () => {
    const { topo } = buildFwTopology()
    const result = topo.checkPing('10.2.0.10', '10.1.0.10')
    expect(result.reachable).toBe(false)
    expect(result.failureReason).toBe('blocked_by_firewall')
  })

  it('failurePoint is the firewall device id', () => {
    const { topo, fw } = buildFwTopology()
    const result = topo.checkPing('10.1.0.10', '10.2.0.10')
    expect(result.failurePoint).toBe(fw.id)
  })
})

// ── FW2: Stateful outbound ────────────────────────────────────────────────────

describe('FW2 — stateful outbound: permit rule allows flow AND records session for return', () => {
  it('inside→outside permit rule makes ping succeed', () => {
    const { topo, fwEng, fw } = buildFwTopology()
    ios(fwEng, fw,
      'enable', 'configure terminal',
      'firewall-rule permit from-zone INSIDE to-zone OUTSIDE src any dst any',
      'end',
    )
    const result = topo.checkPing('10.1.0.10', '10.2.0.10')
    expect(result.reachable).toBe(true)
  })

  it('session is recorded in fw_sessions after a successful outbound ping', () => {
    const { topo, fwEng, fw } = buildFwTopology()
    ios(fwEng, fw,
      'enable', 'configure terminal',
      'firewall-rule permit from-zone INSIDE to-zone OUTSIDE src any dst any',
      'end',
    )
    topo.checkPing('10.1.0.10', '10.2.0.10')
    expect(fw.fw_sessions.length).toBeGreaterThan(0)
    const sess = fw.fw_sessions[0]
    expect(sess.srcIp).toBe('10.1.0.10')
    expect(sess.dstIp).toBe('10.2.0.10')
  })

  it('show conn lists the established session', () => {
    const { topo, fwEng, fw } = buildFwTopology()
    ios(fwEng, fw,
      'enable', 'configure terminal',
      'firewall-rule permit from-zone INSIDE to-zone OUTSIDE src any dst any',
      'end',
    )
    topo.checkPing('10.1.0.10', '10.2.0.10')
    ios(fwEng, fw, 'enable')
    const out = fwEng.execute(fw, 'show conn')
    const text = out.join('\n')
    expect(text).toMatch(/10\.1\.0\.10/)
    expect(text).toMatch(/10\.2\.0\.10/)
  })

  it('session is NOT recorded when traffic is blocked', () => {
    const { topo, fw } = buildFwTopology()
    // No rules — blocked_by_firewall
    topo.checkPing('10.1.0.10', '10.2.0.10')
    expect(fw.fw_sessions.length).toBe(0)
  })

  it('repeated checkPing does not create duplicate session entries', () => {
    const { topo, fwEng, fw } = buildFwTopology()
    ios(fwEng, fw,
      'enable', 'configure terminal',
      'firewall-rule permit from-zone INSIDE to-zone OUTSIDE src any dst any',
      'end',
    )
    topo.checkPing('10.1.0.10', '10.2.0.10')
    topo.checkPing('10.1.0.10', '10.2.0.10')
    topo.checkPing('10.1.0.10', '10.2.0.10')
    const dupes = fw.fw_sessions.filter(s => s.srcIp === '10.1.0.10' && s.dstIp === '10.2.0.10')
    expect(dupes.length).toBe(1)
  })
})

// ── FW3: Unsolicited inbound blocked ──────────────────────────────────────────

describe('FW3 — unsolicited inbound blocked (statefulness, not a symmetric ACL)', () => {
  it('outside-initiated ping to inside is DENIED even when inside→outside is permitted', () => {
    const { topo, fwEng, fw } = buildFwTopology()
    // Only the outbound allow rule
    ios(fwEng, fw,
      'enable', 'configure terminal',
      'firewall-rule permit from-zone INSIDE to-zone OUTSIDE src any dst any',
      'end',
    )
    const result = topo.checkPing('10.2.0.10', '10.1.0.10')
    expect(result.reachable).toBe(false)
    expect(result.failureReason).toBe('blocked_by_firewall')
  })

  it('inside→outside succeeds (FW2 + FW3 together: asymmetric behavior confirmed)', () => {
    const { topo, fwEng, fw } = buildFwTopology()
    ios(fwEng, fw,
      'enable', 'configure terminal',
      'firewall-rule permit from-zone INSIDE to-zone OUTSIDE src any dst any',
      'end',
    )
    expect(topo.checkPing('10.1.0.10', '10.2.0.10').reachable).toBe(true)   // outbound: allowed
    expect(topo.checkPing('10.2.0.10', '10.1.0.10').reachable).toBe(false)  // inbound: blocked
  })

  it('after establishing outbound session, return BFS is permitted by session (no explicit inbound rule)', () => {
    // The full checkPing already tests this implicitly (it runs both forward and return BFS).
    // Here we confirm directly: outbound ping succeeds → both forward AND return path work.
    const { topo, fwEng, fw } = buildFwTopology()
    ios(fwEng, fw,
      'enable', 'configure terminal',
      'firewall-rule permit from-zone INSIDE to-zone OUTSIDE src any dst any',
      'end',
    )
    // This single checkPing runs both forward BFS (INSIDE→OUTSIDE, uses rule) and
    // return BFS (OUTSIDE→INSIDE, uses session recorded by forward BFS).
    const result = topo.checkPing('10.1.0.10', '10.2.0.10')
    expect(result.reachable).toBe(true)
    // Confirm the session was what made the return path work
    expect(fw.fw_sessions.some(s => s.srcIp === '10.1.0.10' && s.dstIp === '10.2.0.10')).toBe(true)
  })
})

// ── FW4: Explicit inbound allow ───────────────────────────────────────────────

describe('FW4 — explicit inbound allow to DMZ', () => {
  it('outside→dmz permit rule allows traffic to reach DMZ server', () => {
    const { topo, fwEng, fw } = buildFwTopology({ configureDmz: true })
    ios(fwEng, fw,
      'enable', 'configure terminal',
      'firewall-rule permit from-zone OUTSIDE to-zone DMZ src any dst any',
      'end',
    )
    const result = topo.checkPing('10.2.0.10', '10.3.0.10')
    expect(result.reachable).toBe(true)
  })

  it('outside→inside still blocked when only outside→dmz is permitted', () => {
    const { topo, fwEng, fw } = buildFwTopology({ configureDmz: true })
    ios(fwEng, fw,
      'enable', 'configure terminal',
      'firewall-rule permit from-zone OUTSIDE to-zone DMZ src any dst any',
      'end',
    )
    const result = topo.checkPing('10.2.0.10', '10.1.0.10')
    expect(result.reachable).toBe(false)
    expect(result.failureReason).toBe('blocked_by_firewall')
  })

  it('inside→dmz still blocked when only outside→dmz is permitted', () => {
    const { topo, fwEng, fw } = buildFwTopology({ configureDmz: true })
    ios(fwEng, fw,
      'enable', 'configure terminal',
      'firewall-rule permit from-zone OUTSIDE to-zone DMZ src any dst any',
      'end',
    )
    const result = topo.checkPing('10.1.0.10', '10.3.0.10')
    expect(result.reachable).toBe(false)
    expect(result.failureReason).toBe('blocked_by_firewall')
  })
})

// ── FW5: Order matters (first-match wins) ─────────────────────────────────────

describe('FW5 — ordered rules: first-match wins', () => {
  it('deny above permit → traffic denied', () => {
    const { topo, fwEng, fw } = buildFwTopology()
    ios(fwEng, fw,
      'enable', 'configure terminal',
      'firewall-rule deny   from-zone INSIDE to-zone OUTSIDE src any dst any',  // rule 1
      'firewall-rule permit from-zone INSIDE to-zone OUTSIDE src any dst any',  // rule 2 (never reached)
      'end',
    )
    const result = topo.checkPing('10.1.0.10', '10.2.0.10')
    expect(result.reachable).toBe(false)
    expect(result.failureReason).toBe('blocked_by_firewall')
  })

  it('removing the deny rule exposes the permit rule below it → allowed', () => {
    const { topo, fwEng, fw } = buildFwTopology()
    ios(fwEng, fw,
      'enable', 'configure terminal',
      'firewall-rule deny   from-zone INSIDE to-zone OUTSIDE src any dst any',  // id=1
      'firewall-rule permit from-zone INSIDE to-zone OUTSIDE src any dst any',  // id=2
      'end',
    )
    expect(topo.checkPing('10.1.0.10', '10.2.0.10').reachable).toBe(false)

    // Remove rule 1 (deny); now only rule 2 (permit) remains
    ios(fwEng, fw, 'enable', 'configure terminal', 'no firewall-rule 1', 'end')
    expect(topo.checkPing('10.1.0.10', '10.2.0.10').reachable).toBe(true)
  })

  it('permit above deny → traffic allowed (deny rule never reached)', () => {
    const { topo, fwEng, fw } = buildFwTopology()
    ios(fwEng, fw,
      'enable', 'configure terminal',
      'firewall-rule permit from-zone INSIDE to-zone OUTSIDE src any dst any',  // rule 1 — wins
      'firewall-rule deny   from-zone INSIDE to-zone OUTSIDE src any dst any',  // rule 2 — never tested
      'end',
    )
    const result = topo.checkPing('10.1.0.10', '10.2.0.10')
    expect(result.reachable).toBe(true)
  })

  it('no firewall-rule clears fw_sessions (stale sessions invalidated)', () => {
    const { topo, fwEng, fw } = buildFwTopology()
    ios(fwEng, fw,
      'enable', 'configure terminal',
      'firewall-rule permit from-zone INSIDE to-zone OUTSIDE src any dst any',  // id=1
      'end',
    )
    topo.checkPing('10.1.0.10', '10.2.0.10')
    expect(fw.fw_sessions.length).toBeGreaterThan(0)

    ios(fwEng, fw, 'enable', 'configure terminal', 'no firewall-rule 1', 'end')
    expect(fw.fw_sessions.length).toBe(0)
  })
})

// ── FW6: DMZ zones ────────────────────────────────────────────────────────────

describe('FW6 — DMZ zone independently governed by separate rules', () => {
  it('inside→dmz blocked with no rule even when inside→outside is permitted', () => {
    const { topo, fwEng, fw } = buildFwTopology({ configureDmz: true })
    ios(fwEng, fw,
      'enable', 'configure terminal',
      'firewall-rule permit from-zone INSIDE to-zone OUTSIDE src any dst any',
      'end',
    )
    const result = topo.checkPing('10.1.0.10', '10.3.0.10')
    expect(result.reachable).toBe(false)
    expect(result.failureReason).toBe('blocked_by_firewall')
  })

  it('inside→dmz with explicit permit rule → allowed', () => {
    const { topo, fwEng, fw } = buildFwTopology({ configureDmz: true })
    ios(fwEng, fw,
      'enable', 'configure terminal',
      'firewall-rule permit from-zone INSIDE to-zone DMZ src any dst any',
      'end',
    )
    const result = topo.checkPing('10.1.0.10', '10.3.0.10')
    expect(result.reachable).toBe(true)
  })

  it('outside→dmz and inside→dmz can each be permitted independently', () => {
    const { topo, fwEng, fw } = buildFwTopology({ configureDmz: true })
    ios(fwEng, fw,
      'enable', 'configure terminal',
      'firewall-rule permit from-zone INSIDE  to-zone DMZ src any dst any',
      'firewall-rule permit from-zone OUTSIDE to-zone DMZ src any dst any',
      'end',
    )
    expect(topo.checkPing('10.1.0.10', '10.3.0.10').reachable).toBe(true)  // inside→dmz
    expect(topo.checkPing('10.2.0.10', '10.3.0.10').reachable).toBe(true)  // outside→dmz
    // outside→inside has no rule — still denied
    expect(topo.checkPing('10.2.0.10', '10.1.0.10').reachable).toBe(false)
  })

  it('dmz→outside with no rule → blocked', () => {
    const { topo, fwEng, fw } = buildFwTopology({ configureDmz: true })
    ios(fwEng, fw,
      'enable', 'configure terminal',
      'firewall-rule permit from-zone INSIDE to-zone DMZ src any dst any',
      'end',
    )
    // DMZ host trying to reach outside — no rule for DMZ→OUTSIDE
    const result = topo.checkPing('10.3.0.10', '10.2.0.10')
    expect(result.reachable).toBe(false)
    expect(result.failureReason).toBe('blocked_by_firewall')
  })
})

// ── CLI show commands ─────────────────────────────────────────────────────────

describe('Firewall CLI — show commands reflect real state', () => {
  it('show nameif lists interfaces with zone assignments and security levels', () => {
    const { fwEng, fw } = buildFwTopology()
    ios(fwEng, fw, 'enable')
    const out = fwEng.execute(fw, 'show nameif')
    const text = out.join('\n')
    expect(text).toMatch(/GigabitEthernet0\/0/)
    expect(text).toMatch(/INSIDE/)
    expect(text).toMatch(/GigabitEthernet0\/1/)
    expect(text).toMatch(/OUTSIDE/)
    expect(text).toMatch(/100/)  // security-level 100
    expect(text).toMatch(/0/)    // security-level 0
  })

  it('show firewall-rules lists rules with ID, action, and zones', () => {
    const { fwEng, fw } = buildFwTopology()
    ios(fwEng, fw,
      'enable', 'configure terminal',
      'firewall-rule permit from-zone INSIDE to-zone OUTSIDE src any dst any',
      'end',
    )
    const out = fwEng.execute(fw, 'show firewall-rules')
    const text = out.join('\n')
    expect(text).toMatch(/permit/)
    expect(text).toMatch(/INSIDE/)
    expect(text).toMatch(/OUTSIDE/)
  })

  it('show firewall-rules (no rules) mentions default-deny', () => {
    const { fwEng, fw } = buildFwTopology()
    ios(fwEng, fw, 'enable')
    const out = fwEng.execute(fw, 'show firewall-rules')
    expect(out.join('\n')).toMatch(/deny/)
  })

  it('show running-config includes nameif, security-level, ip address, and rule', () => {
    const { fwEng, fw } = buildFwTopology()
    ios(fwEng, fw,
      'enable', 'configure terminal',
      'firewall-rule permit from-zone INSIDE to-zone OUTSIDE src any dst any',
      'end',
    )
    const out = fwEng.execute(fw, 'show running-config')
    const text = out.join('\n')
    expect(text).toMatch(/nameif INSIDE/)
    expect(text).toMatch(/nameif OUTSIDE/)
    expect(text).toMatch(/security-level 100/)
    expect(text).toMatch(/ip address 10\.1\.0\.1 255\.255\.255\.0/)
    expect(text).toMatch(/firewall-rule permit/)
    expect(text).toMatch(/from-zone INSIDE/)
    expect(text).toMatch(/to-zone OUTSIDE/)
  })

  it('show ip interface brief works on firewall', () => {
    const { fwEng, fw } = buildFwTopology()
    ios(fwEng, fw, 'enable')
    const out = fwEng.execute(fw, 'show ip interface brief')
    const text = out.join('\n')
    expect(text).toMatch(/GigabitEthernet0\/0/)
    expect(text).toMatch(/10\.1\.0\.1/)
    expect(text).toMatch(/GigabitEthernet0\/1/)
    expect(text).toMatch(/10\.2\.0\.1/)
  })
})

// ── FW7: Regression ───────────────────────────────────────────────────────────

describe('FW7 — regression: existing behavior unaffected', () => {
  it('simple router↔PC ping with no firewall in path still works', () => {
    const topo   = new Topology()
    const engine = new CLIEngine(topo)
    const pcEng  = new PCCLIEngine(topo)

    const router = makeRouter()
    const pc     = makePc()
    topo.addDevice(router)
    topo.addDevice(pc)
    wire(topo, router, 'GigabitEthernet0/0', pc, 'Ethernet0/0')
    ios(engine, router,
      'enable', 'configure terminal',
      'interface GigabitEthernet0/0',
      'ip address 192.168.1.1 255.255.255.0',
      'no shutdown',
      'exit', 'end',
    )
    ios(pcEng, pc,
      'ip addr add 192.168.1.10/24 dev Ethernet0/0',
      'ip link set Ethernet0/0 up',
    )
    expect(topo.checkPing('192.168.1.1', '192.168.1.10').reachable).toBe(true)
  })

  it('firewall-originated ping (ingressIfaceId=null) is NOT subject to inter-zone rules', () => {
    // When the firewall itself is the source, ingressIfaceId is null for the FW
    // in the BFS queue, and the zone check is skipped — management traffic works.
    const { topo, fw } = buildFwTopology()
    // No rules — but FW pinging its own outside IP (self) is always reachable
    expect(topo.checkPing('10.1.0.1', '10.2.0.1').reachable).toBe(true)  // FW self-ping (same device)

    // FW pinging the outside PC (10.1.0.1 → 10.2.0.10) with no rules:
    // forward BFS: FW is source → ingressIfaceId null → zone check skipped → reachable
    // return BFS: outside_pc → FW (ingressIfaceId set) → FW owns target 10.1.0.1 → found before exit loop
    expect(topo.checkPing('10.1.0.1', '10.2.0.10').reachable).toBe(true)
  })

  it('firewall data model initialises correctly', () => {
    const fw = makeFirewall()
    expect(fw.type).toBe('firewall')
    expect(fw.fw_zones).toEqual({})
    expect(fw.fw_rules).toEqual([])
    expect(fw.fw_sessions).toEqual([])
    expect(fw.routing_table).toEqual([])
    expect(fw.interfaces).toHaveLength(4)
    expect(fw.interfaces.every(i => i.status === 'admin_down')).toBe(true)
  })

  it('firewall does not break when traversed without zone assignments', () => {
    // Interface has no nameif → zone is null → zone check skipped (null !== null is false for crossing check)
    const topo   = new Topology()
    const fwEng  = new CLIEngine(topo)
    const pcEng  = new PCCLIEngine(topo)
    const fw     = makeFirewall()
    const pcA    = makePc()
    const pcB    = makePc()
    topo.addDevice(fw); topo.addDevice(pcA); topo.addDevice(pcB)
    wire(topo, fw, 'GigabitEthernet0/0', pcA, 'Ethernet0/0')
    wire(topo, fw, 'GigabitEthernet0/1', pcB, 'Ethernet0/0')
    // Configure IPs but NO nameif (no zones assigned)
    ios(fwEng, fw,
      'enable', 'configure terminal',
      'interface GigabitEthernet0/0',
      'ip address 10.9.0.1 255.255.255.0',
      'no shutdown',
      'exit',
      'interface GigabitEthernet0/1',
      'ip address 10.9.1.1 255.255.255.0',
      'no shutdown',
      'exit',
      'end',
    )
    ios(pcEng, pcA,
      'ip addr add 10.9.0.10/24 dev Ethernet0/0',
      'ip link set Ethernet0/0 up',
      'ip route add default via 10.9.0.1',
    )
    ios(pcEng, pcB,
      'ip addr add 10.9.1.10/24 dev Ethernet0/0',
      'ip link set Ethernet0/0 up',
      'ip route add default via 10.9.1.1',
    )
    // Without zones, the crossing check condition (ingressZone && exitZone && ingressZone !== exitZone)
    // evaluates to false (both are null), so no policy is applied — traffic flows freely.
    const result = topo.checkPing('10.9.0.10', '10.9.1.10')
    expect(result.reachable).toBe(true)
  })
})

// ── Service / Port matching ───────────────────────────────────────────────────
//
// SVC1  ALLOW ONE SERVICE, BLOCK OTHERS   HTTPS rule allows 443, blocks 22 and ICMP
// SVC2  NAMED == RAW                      HTTPS and tcp/443 behave identically
// SVC3  STATEFUL RETURN RESPECTS PORT     session for 443 does NOT open 22 on return
// SVC4  ICMP vs TCP/UDP                   icmp rule vs tcp rule vs any rule
// SVC5  BACKWARD COMPAT                   service=any rules from Sprint 1 unchanged
// SVC6  CLI validation + show conn        bad service rejected; show conn shows proto/port

describe('SVC1 — allow one service, block others', () => {
  it('HTTPS rule allows tcp/443 to DMZ but blocks tcp/22 to the same host', () => {
    const { topo, fwEng, fw } = buildFwTopology({ configureDmz: true })
    ios(fwEng, fw,
      'enable', 'configure terminal',
      'firewall-rule permit from-zone OUTSIDE to-zone DMZ src any dst any service HTTPS',
      'end',
    )
    const allowed = topo.checkPing('10.2.0.10', '10.3.0.10', { protocol: 'tcp', port: 443 })
    expect(allowed.reachable).toBe(true)

    const denied = topo.checkPing('10.2.0.10', '10.3.0.10', { protocol: 'tcp', port: 22 })
    expect(denied.reachable).toBe(false)
    expect(denied.failureReason).toBe('blocked_by_firewall')
  })

  it('ICMP ping to DMZ server is blocked when only an HTTPS rule exists', () => {
    const { topo, fwEng, fw } = buildFwTopology({ configureDmz: true })
    ios(fwEng, fw,
      'enable', 'configure terminal',
      'firewall-rule permit from-zone OUTSIDE to-zone DMZ src any dst any service HTTPS',
      'end',
    )
    // Default checkPing is ICMP — HTTPS rule must NOT permit it
    const result = topo.checkPing('10.2.0.10', '10.3.0.10')
    expect(result.reachable).toBe(false)
    expect(result.failureReason).toBe('blocked_by_firewall')
  })

  it('a deny+permit pair blocks at the deny rule before reaching the permit', () => {
    const { topo, fwEng, fw } = buildFwTopology()
    ios(fwEng, fw,
      'enable', 'configure terminal',
      'firewall-rule deny   from-zone INSIDE to-zone OUTSIDE src any dst any service HTTPS',
      'firewall-rule permit from-zone INSIDE to-zone OUTSIDE src any dst any service any',
      'end',
    )
    // HTTPS is denied by rule 1 (first-match wins) even though rule 2 would permit anything
    const r = topo.checkPing('10.1.0.10', '10.2.0.10', { protocol: 'tcp', port: 443 })
    expect(r.reachable).toBe(false)
    expect(r.failureReason).toBe('blocked_by_firewall')
    // Other services fall through to the permit-any rule
    expect(topo.checkPing('10.1.0.10', '10.2.0.10').reachable).toBe(true)  // ICMP
  })
})

describe('SVC2 — named service equals raw proto/port', () => {
  it('HTTPS rule and tcp/443 rule are identical for tcp/443 flows', () => {
    const t1 = buildFwTopology()
    ios(t1.fwEng, t1.fw,
      'enable', 'configure terminal',
      'firewall-rule permit from-zone INSIDE to-zone OUTSIDE src any dst any service HTTPS',
      'end',
    )
    const r1 = t1.topo.checkPing('10.1.0.10', '10.2.0.10', { protocol: 'tcp', port: 443 })

    const t2 = buildFwTopology()
    ios(t2.fwEng, t2.fw,
      'enable', 'configure terminal',
      'firewall-rule permit from-zone INSIDE to-zone OUTSIDE src any dst any service tcp/443',
      'end',
    )
    const r2 = t2.topo.checkPing('10.1.0.10', '10.2.0.10', { protocol: 'tcp', port: 443 })

    expect(r1.reachable).toBe(true)
    expect(r2.reachable).toBe(true)
  })

  it('SSH (named) and tcp/22 (raw) allow port 22 and block port 443', () => {
    const named = buildFwTopology()
    ios(named.fwEng, named.fw,
      'enable', 'configure terminal',
      'firewall-rule permit from-zone INSIDE to-zone OUTSIDE src any dst any service SSH',
      'end',
    )
    expect(named.topo.checkPing('10.1.0.10', '10.2.0.10', { protocol: 'tcp', port: 22 }).reachable).toBe(true)
    expect(named.topo.checkPing('10.1.0.10', '10.2.0.10', { protocol: 'tcp', port: 443 }).reachable).toBe(false)

    const raw = buildFwTopology()
    ios(raw.fwEng, raw.fw,
      'enable', 'configure terminal',
      'firewall-rule permit from-zone INSIDE to-zone OUTSIDE src any dst any service tcp/22',
      'end',
    )
    expect(raw.topo.checkPing('10.1.0.10', '10.2.0.10', { protocol: 'tcp', port: 22 }).reachable).toBe(true)
    expect(raw.topo.checkPing('10.1.0.10', '10.2.0.10', { protocol: 'tcp', port: 443 }).reachable).toBe(false)
  })

  it('DNS named service resolves to udp/53', () => {
    const { topo, fwEng, fw } = buildFwTopology()
    ios(fwEng, fw,
      'enable', 'configure terminal',
      'firewall-rule permit from-zone INSIDE to-zone OUTSIDE src any dst any service DNS',
      'end',
    )
    expect(topo.checkPing('10.1.0.10', '10.2.0.10', { protocol: 'udp', port: 53 }).reachable).toBe(true)
    expect(topo.checkPing('10.1.0.10', '10.2.0.10', { protocol: 'tcp', port: 53 }).reachable).toBe(false)
  })
})

describe('SVC3 — stateful return respects port', () => {
  it('session records protocol+port; show conn displays them', () => {
    const { topo, fwEng, fw } = buildFwTopology()
    ios(fwEng, fw,
      'enable', 'configure terminal',
      'firewall-rule permit from-zone INSIDE to-zone OUTSIDE src any dst any service HTTPS',
      'end',
    )
    topo.checkPing('10.1.0.10', '10.2.0.10', { protocol: 'tcp', port: 443 })
    const sess = fw.fw_sessions.find(s => s.srcIp === '10.1.0.10' && s.dstIp === '10.2.0.10')
    expect(sess).toBeTruthy()
    expect(sess.protocol).toBe('tcp')
    expect(sess.port).toBe(443)
  })

  it('HTTPS session does NOT open an SSH inbound path on the same host pair', () => {
    const { topo, fwEng, fw } = buildFwTopology()
    ios(fwEng, fw,
      'enable', 'configure terminal',
      'firewall-rule permit from-zone INSIDE to-zone OUTSIDE src any dst any service HTTPS',
      'end',
    )
    // Establish tcp/443 outbound session
    expect(topo.checkPing('10.1.0.10', '10.2.0.10', { protocol: 'tcp', port: 443 }).reachable).toBe(true)
    // tcp/22 inbound must NOT ride on the tcp/443 session
    const ssh = topo.checkPing('10.2.0.10', '10.1.0.10', { protocol: 'tcp', port: 22 })
    expect(ssh.reachable).toBe(false)
    expect(ssh.failureReason).toBe('blocked_by_firewall')
  })

  it('return BFS for the same service IS covered by the session', () => {
    // checkPing runs forward + return BFS; the return BFS must find the tcp/443 session.
    const { topo, fwEng } = buildFwTopology()
    ios(fwEng, buildFwTopology().fw,  // use fresh fw for session isolation
      'enable', 'configure terminal',
      'firewall-rule permit from-zone INSIDE to-zone OUTSIDE src any dst any service HTTPS',
      'end',
    )
    // Re-build clean to avoid session bleed
    const clean = buildFwTopology()
    ios(clean.fwEng, clean.fw,
      'enable', 'configure terminal',
      'firewall-rule permit from-zone INSIDE to-zone OUTSIDE src any dst any service HTTPS',
      'end',
    )
    const result = clean.topo.checkPing('10.1.0.10', '10.2.0.10', { protocol: 'tcp', port: 443 })
    expect(result.reachable).toBe(true)
  })

  it('two different-service sessions between the same hosts coexist independently', () => {
    const { topo, fwEng, fw } = buildFwTopology()
    ios(fwEng, fw,
      'enable', 'configure terminal',
      'firewall-rule permit from-zone INSIDE to-zone OUTSIDE src any dst any service HTTPS',
      'firewall-rule permit from-zone INSIDE to-zone OUTSIDE src any dst any service SSH',
      'end',
    )
    topo.checkPing('10.1.0.10', '10.2.0.10', { protocol: 'tcp', port: 443 })
    topo.checkPing('10.1.0.10', '10.2.0.10', { protocol: 'tcp', port: 22 })
    const sessions = fw.fw_sessions.filter(s => s.srcIp === '10.1.0.10' && s.dstIp === '10.2.0.10')
    expect(sessions).toHaveLength(2)
    expect(sessions.some(s => s.protocol === 'tcp' && s.port === 443)).toBe(true)
    expect(sessions.some(s => s.protocol === 'tcp' && s.port === 22)).toBe(true)
  })

  it('repeated checkPing with same service does not duplicate sessions', () => {
    const { topo, fwEng, fw } = buildFwTopology()
    ios(fwEng, fw,
      'enable', 'configure terminal',
      'firewall-rule permit from-zone INSIDE to-zone OUTSIDE src any dst any service HTTPS',
      'end',
    )
    topo.checkPing('10.1.0.10', '10.2.0.10', { protocol: 'tcp', port: 443 })
    topo.checkPing('10.1.0.10', '10.2.0.10', { protocol: 'tcp', port: 443 })
    const dupes = fw.fw_sessions.filter(s =>
      s.srcIp === '10.1.0.10' && s.dstIp === '10.2.0.10' && s.protocol === 'tcp' && s.port === 443)
    expect(dupes).toHaveLength(1)
  })
})

describe('SVC4 — ICMP vs TCP/UDP service matching', () => {
  it('service=icmp matches a default ICMP ping', () => {
    const { topo, fwEng, fw } = buildFwTopology()
    ios(fwEng, fw,
      'enable', 'configure terminal',
      'firewall-rule permit from-zone INSIDE to-zone OUTSIDE src any dst any service icmp',
      'end',
    )
    expect(topo.checkPing('10.1.0.10', '10.2.0.10').reachable).toBe(true)
  })

  it('service=icmp does NOT match a tcp/443 flow', () => {
    const { topo, fwEng, fw } = buildFwTopology()
    ios(fwEng, fw,
      'enable', 'configure terminal',
      'firewall-rule permit from-zone INSIDE to-zone OUTSIDE src any dst any service icmp',
      'end',
    )
    const result = topo.checkPing('10.1.0.10', '10.2.0.10', { protocol: 'tcp', port: 443 })
    expect(result.reachable).toBe(false)
    expect(result.failureReason).toBe('blocked_by_firewall')
  })

  it('service=tcp/443 does NOT match a default ICMP ping', () => {
    const { topo, fwEng, fw } = buildFwTopology()
    ios(fwEng, fw,
      'enable', 'configure terminal',
      'firewall-rule permit from-zone INSIDE to-zone OUTSIDE src any dst any service tcp/443',
      'end',
    )
    expect(topo.checkPing('10.1.0.10', '10.2.0.10').reachable).toBe(false)
    expect(topo.checkPing('10.1.0.10', '10.2.0.10').failureReason).toBe('blocked_by_firewall')
  })

  it('service=any matches ICMP, TCP, and UDP flows', () => {
    const { topo, fwEng, fw } = buildFwTopology()
    ios(fwEng, fw,
      'enable', 'configure terminal',
      'firewall-rule permit from-zone INSIDE to-zone OUTSIDE src any dst any service any',
      'end',
    )
    expect(topo.checkPing('10.1.0.10', '10.2.0.10').reachable).toBe(true)                                         // ICMP
    expect(topo.checkPing('10.1.0.10', '10.2.0.10', { protocol: 'tcp', port: 443 }).reachable).toBe(true) // TCP
    expect(topo.checkPing('10.1.0.10', '10.2.0.10', { protocol: 'udp', port: 53 }).reachable).toBe(true)  // UDP
  })
})

describe('SVC5 — backward compatibility: service=any rules unchanged', () => {
  it('rule with no service keyword is stored as any and matches ICMP', () => {
    const { topo, fwEng, fw } = buildFwTopology()
    ios(fwEng, fw,
      'enable', 'configure terminal',
      'firewall-rule permit from-zone INSIDE to-zone OUTSIDE src any dst any',
      'end',
    )
    expect(fw.fw_rules[0].service).toBe('any')
    expect(topo.checkPing('10.1.0.10', '10.2.0.10').reachable).toBe(true)
  })

  it('all Sprint 1 flow patterns still work with the new engine', () => {
    const { topo, fwEng, fw } = buildFwTopology({ configureDmz: true })
    ios(fwEng, fw,
      'enable', 'configure terminal',
      'firewall-rule permit from-zone INSIDE  to-zone OUTSIDE src any dst any',
      'firewall-rule permit from-zone OUTSIDE to-zone DMZ    src any dst any',
      'end',
    )
    expect(topo.checkPing('10.1.0.10', '10.2.0.10').reachable).toBe(true)   // inside→outside: allowed
    expect(topo.checkPing('10.2.0.10', '10.3.0.10').reachable).toBe(true)   // outside→dmz:   allowed
    expect(topo.checkPing('10.2.0.10', '10.1.0.10').reachable).toBe(false)  // outside→inside: denied
    expect(topo.checkPing('10.1.0.10', '10.3.0.10').reachable).toBe(false)  // inside→dmz:     denied (no rule)
  })
})

describe('SVC6 — CLI validation and show conn', () => {
  it('invalid service string returns an error and does not add the rule', () => {
    const { fwEng, fw } = buildFwTopology()
    ios(fwEng, fw, 'enable', 'configure terminal')
    const out = fwEng.execute(fw,
      'firewall-rule permit from-zone INSIDE to-zone OUTSIDE src any dst any service not-a-service',
    )
    expect(out.join('\n')).toMatch(/%/)
    expect(fw.fw_rules).toHaveLength(0)
  })

  it('valid named and raw services are accepted without error', () => {
    const { fwEng, fw } = buildFwTopology()
    ios(fwEng, fw, 'enable', 'configure terminal')
    ;['HTTPS', 'SSH', 'DNS', 'tcp/8080', 'udp/123', 'icmp', 'any'].forEach(svc => {
      const out = fwEng.execute(fw,
        `firewall-rule permit from-zone INSIDE to-zone OUTSIDE src any dst any service ${svc}`,
      )
      expect(out.join('\n')).not.toMatch(/%/)
    })
  })

  it('show conn displays protocol and port columns', () => {
    const { topo, fwEng, fw } = buildFwTopology()
    ios(fwEng, fw,
      'enable', 'configure terminal',
      'firewall-rule permit from-zone INSIDE to-zone OUTSIDE src any dst any service HTTPS',
      'end',
    )
    topo.checkPing('10.1.0.10', '10.2.0.10', { protocol: 'tcp', port: 443 })
    ios(fwEng, fw, 'enable')
    const out = fwEng.execute(fw, 'show conn')
    const text = out.join('\n')
    expect(text).toMatch(/TCP/)
    expect(text).toMatch(/443/)
    expect(text).toMatch(/10\.1\.0\.10/)
    expect(text).toMatch(/10\.2\.0\.10/)
  })

  it('show firewall-rules displays the service column for named and raw services', () => {
    const { fwEng, fw } = buildFwTopology()
    ios(fwEng, fw,
      'enable', 'configure terminal',
      'firewall-rule permit from-zone INSIDE to-zone OUTSIDE src any dst any service HTTPS',
      'firewall-rule deny   from-zone OUTSIDE to-zone INSIDE  src any dst any service tcp/22',
      'end',
    )
    const out = fwEng.execute(fw, 'show firewall-rules')
    const text = out.join('\n')
    expect(text).toMatch(/HTTPS/)
    expect(text).toMatch(/tcp\/22/)
  })
})

// ── FW-TOG: Rule enable/disable toggle ───────────────────────────────────────
//
// TOG1  DISABLED PERMIT SKIPPED      a disabled permit rule no longer allows the flow
// TOG2  DISABLED DENY SKIPPED        a disabled deny-above-permit lets the permit match
// TOG3  RE-ENABLE RESTORES EFFECT    re-enabling a permit rule allows the flow again
// TOG4  BACKWARD COMPAT              rules without an `enabled` field are treated as enabled
// TOG5  TOGGLE CLEARS SESSIONS       disabling a rule that built a session clears fw_sessions
// TOG6  CLI TOGGLE COMMAND           `firewall-rule <id> disable/enable` works via CLI
// TOG7  SHOW OUTPUT INCLUDES STATE   `show firewall-rules` displays enabled/disabled per row

describe('FW-TOG1 — disabled permit rule no longer allows the flow', () => {
  it('disabling a permit rule causes the flow to be blocked by default-deny', () => {
    const { topo, fwEng, fw } = buildFwTopology()
    ios(fwEng, fw,
      'enable', 'configure terminal',
      'firewall-rule permit from-zone INSIDE to-zone OUTSIDE src any dst any',
      'end',
    )
    expect(topo.checkPing('10.1.0.10', '10.2.0.10').reachable).toBe(true)
    // Disable rule 1 and clear sessions (same as CLI/UI toggle does)
    fw.fw_rules[0].enabled = false
    fw.fw_sessions = []
    const result = topo.checkPing('10.1.0.10', '10.2.0.10')
    expect(result.reachable).toBe(false)
    expect(result.failureReason).toBe('blocked_by_firewall')
  })
})

describe('FW-TOG2 — disabled deny rule is skipped so a lower permit can match', () => {
  it('disabling a deny-above-permit lets the permit take effect', () => {
    const { topo, fwEng, fw } = buildFwTopology()
    ios(fwEng, fw,
      'enable', 'configure terminal',
      // Rule 1: deny (would block the flow if enabled)
      'firewall-rule deny   from-zone INSIDE to-zone OUTSIDE src any dst any',
      // Rule 2: permit below it
      'firewall-rule permit from-zone INSIDE to-zone OUTSIDE src any dst any',
      'end',
    )
    // Sanity: deny-first means blocked
    expect(topo.checkPing('10.1.0.10', '10.2.0.10').reachable).toBe(false)

    // Disable the deny rule → permit should now be the first enabled match
    fw.fw_rules[0].enabled = false
    fw.fw_sessions = []
    expect(topo.checkPing('10.1.0.10', '10.2.0.10').reachable).toBe(true)
  })
})

describe('FW-TOG3 — re-enabling a rule restores its effect', () => {
  it('re-enabling a disabled permit rule allows the flow again', () => {
    const { topo, fwEng, fw } = buildFwTopology()
    ios(fwEng, fw,
      'enable', 'configure terminal',
      'firewall-rule permit from-zone INSIDE to-zone OUTSIDE src any dst any',
      'end',
    )
    fw.fw_rules[0].enabled = false
    expect(topo.checkPing('10.1.0.10', '10.2.0.10').reachable).toBe(false)
    fw.fw_rules[0].enabled = true
    fw.fw_sessions = []
    expect(topo.checkPing('10.1.0.10', '10.2.0.10').reachable).toBe(true)
  })
})

describe('FW-TOG4 — backward compatibility: rules with no enabled field are treated as enabled', () => {
  it('a rule object without an enabled property still matches traffic', () => {
    const { topo, fwEng, fw } = buildFwTopology()
    ios(fwEng, fw,
      'enable', 'configure terminal',
      'firewall-rule permit from-zone INSIDE to-zone OUTSIDE src any dst any',
      'end',
    )
    // Simulate a saved rule from before the enabled field was added
    delete fw.fw_rules[0].enabled
    expect(topo.checkPing('10.1.0.10', '10.2.0.10').reachable).toBe(true)
  })
})

describe('FW-TOG5 — toggling a rule clears fw_sessions', () => {
  it('disabling the permit rule that built a session clears that session', () => {
    const { topo, fwEng, fw } = buildFwTopology()
    ios(fwEng, fw,
      'enable', 'configure terminal',
      'firewall-rule permit from-zone INSIDE to-zone OUTSIDE src any dst any',
      'end',
    )
    topo.checkPing('10.1.0.10', '10.2.0.10')
    expect(fw.fw_sessions.length).toBeGreaterThan(0)
    // Simulate the UI/CLI toggle (which clears sessions)
    fw.fw_rules[0].enabled = false
    fw.fw_sessions = []
    expect(fw.fw_sessions).toHaveLength(0)
    expect(topo.checkPing('10.1.0.10', '10.2.0.10').reachable).toBe(false)
  })
})

describe('FW-TOG6 — CLI firewall-rule <id> disable/enable', () => {
  it('firewall-rule <id> disable stops the rule from matching', () => {
    const { topo, fwEng, fw } = buildFwTopology()
    ios(fwEng, fw,
      'enable', 'configure terminal',
      'firewall-rule permit from-zone INSIDE to-zone OUTSIDE src any dst any',
    )
    expect(topo.checkPing('10.1.0.10', '10.2.0.10').reachable).toBe(true)
    ios(fwEng, fw, 'firewall-rule 1 disable')
    expect(fw.fw_rules[0].enabled).toBe(false)
    expect(topo.checkPing('10.1.0.10', '10.2.0.10').reachable).toBe(false)
  })

  it('firewall-rule <id> enable re-activates a disabled rule', () => {
    const { topo, fwEng, fw } = buildFwTopology()
    ios(fwEng, fw,
      'enable', 'configure terminal',
      'firewall-rule permit from-zone INSIDE to-zone OUTSIDE src any dst any',
      'firewall-rule 1 disable',
    )
    expect(fw.fw_rules[0].enabled).toBe(false)
    ios(fwEng, fw, 'firewall-rule 1 enable')
    expect(fw.fw_rules[0].enabled).toBe(true)
    expect(topo.checkPing('10.1.0.10', '10.2.0.10').reachable).toBe(true)
  })

  it('firewall-rule <id> disable clears fw_sessions', () => {
    const { topo, fwEng, fw } = buildFwTopology()
    ios(fwEng, fw,
      'enable', 'configure terminal',
      'firewall-rule permit from-zone INSIDE to-zone OUTSIDE src any dst any',
    )
    topo.checkPing('10.1.0.10', '10.2.0.10')
    expect(fw.fw_sessions.length).toBeGreaterThan(0)
    ios(fwEng, fw, 'firewall-rule 1 disable')
    expect(fw.fw_sessions).toHaveLength(0)
  })

  it('firewall-rule <id> disable on non-existent id returns an error', () => {
    const { fwEng, fw } = buildFwTopology()
    ios(fwEng, fw, 'enable', 'configure terminal')
    const out = fwEng.execute(fw, 'firewall-rule 99 disable')
    expect(out.join('\n')).toMatch(/not found/)
  })
})

describe('FW-TOG7 — show firewall-rules displays enabled/disabled state', () => {
  it('enabled rules show "enabled" in State column', () => {
    const { fwEng, fw } = buildFwTopology()
    ios(fwEng, fw,
      'enable', 'configure terminal',
      'firewall-rule permit from-zone INSIDE to-zone OUTSIDE src any dst any',
      'end',
    )
    const out = fwEng.execute(fw, 'show firewall-rules')
    expect(out.join('\n')).toMatch(/enabled/)
  })

  it('disabled rules show "disabled" in State column', () => {
    const { fwEng, fw } = buildFwTopology()
    ios(fwEng, fw,
      'enable', 'configure terminal',
      'firewall-rule permit from-zone INSIDE to-zone OUTSIDE src any dst any',
      'firewall-rule 1 disable',
      'end',
    )
    const out = fwEng.execute(fw, 'show firewall-rules')
    expect(out.join('\n')).toMatch(/disabled/)
  })
})
