---
tags: [networking, firewall, security]
---

# Stateful Firewall

Zone-based firewall engine implemented in `src/models/Topology.js` (BFS hook) and
`src/models/CLIEngine.js` (CLI); enforced by `src/models/__tests__/firewall.test.js`
(includes a dedicated service/port-matching block, 21 tests).

## Core invariants

1. **Zones.** Each firewall interface is assigned to exactly one security zone via
   `nameif <ZONE>` (e.g. `INSIDE`, `OUTSIDE`, `DMZ`). Zone membership lives in
   `device.fw_zones = { ifaceName: zoneName }`. Filtering applies only when traffic
   *crosses* a zone boundary — intra-zone traffic is never inter-zone-filtered.
2. **Ordered rules, first-match wins.** `device.fw_rules[]` is evaluated top to
   bottom; the first rule whose `fromZone`/`toZone`/`src`/`dst`/`service` all match
   applies its `permit`/`deny` action and stops — later rules never run. Rule IDs are
   auto-assigned and used for deletion (`no firewall-rule <id>`).
3. **Implicit default-deny.** No matching rule = blocked. A brand-new firewall with
   zero rules blocks **all** inter-zone traffic — this is the intended teachable
   moment: "I installed it and now nothing works until I add permit rules."
   `failureReason: 'blocked_by_firewall'`, distinct from `no_route`/`admin_down`.
4. **Stateful inspection — the key teaching point.** When an inside host initiates a
   connection toward a less-trusted zone and a permit rule matches, the firewall
   records a session `{ srcIp, dstIp }` in `device.fw_sessions`. The return-path BFS
   (which runs for *every* `checkPing`) does a **directional** session lookup and
   allows the return without needing an explicit inbound rule. A ping *initiated from
   the outside* uses a **non-directional** lookup that can only match a session the
   outside host itself started — which it never did — so it must match an explicit
   rule or be denied. This asymmetry is the entire point: **it is not a bidirectional
   ACL.**
5. **The firewall is also a router.** It has `ip address`, `ip route`, and routes
   between zones exactly like a router — filtering is applied *in addition to*
   routing, not instead of it. Traffic must be both routable and policy-permitted.
6. **Firewall-originated traffic skips zone policy.** When the firewall itself is the
   source of a ping, `ingressIfaceId` is `null` on its first BFS visit and the zone
   check is skipped — matches real appliance behavior (self-generated traffic isn't
   subject to data-plane policy). Documented simplification; real ASA has a separate
   `management-access` concept for this.
7. **`blocked_by_firewall`** is distinct from `no_route` (no routing path),
   `vlan_isolated` (an L2 boundary), and `nat_required` (private source, no
   translation). `failurePoint` is set to the firewall's own device id.

## Service/port matching

- A rule can carry a `service` match: `{ protocol, port }`. Omitting it stores
  `'any'` (matches everything — every Sprint-1-era rule keeps working unmodified).
- Well-known port table (real IANA values, taught to the player):

  | Name | Protocol | Port |
  |---|---|---|
  | HTTP | TCP | 80 |
  | HTTPS | TCP | 443 |
  | SSH | TCP | 22 |
  | DNS | UDP | 53 |
  | FTP | TCP | 21 |
  | TELNET | TCP | 23 |
  | RDP | TCP | 3389 |
  | SMTP | TCP | 25 |
- A rule for `tcp/443` does **not** permit an ICMP ping to the same host, and vice
  versa — different services, never conflated. (This trips up players and is
  correct; see [[Working with Claude Code]] LESSONS.)
- Sessions are recorded with `{ srcIp, dstIp, protocol, port }` — a tcp/443 session
  does not implicitly open tcp/22 on the same host pair.
- `checkPing(srcIp, dstIp, service)` — `service` defaults to
  `{ protocol: 'icmp', port: null }`, so every existing caller (CLI `ping`, mission
  validators) is unaffected and still tests plain ICMP reachability.

## CLI syntax (ASA-*inspired*, not exact ASA — documented simplification)

```
interface GigabitEthernet0/0
  nameif INSIDE
  security-level 100
  ip address 10.1.0.1 255.255.255.0
  no shutdown

firewall-rule permit from-zone INSIDE to-zone OUTSIDE src any dst any [service any|HTTPS|tcp/443|icmp]
no firewall-rule <id>

show nameif            ← zone/security-level per interface
show firewall-rules     ← ordered rule list with IDs
show conn                ← active stateful sessions
show running-config      ← includes all of the above
```

Real ASA uses `access-list <name> extended permit ... ` + `access-group <name> in
interface <if>`. This project's `firewall-rule` command is a simplified, more
directly readable stand-in that still teaches zones, ordering, and permit/deny — not
a claim of exact ASA CLI fidelity.

## Other documented simplifications

- **No ephemeral source port in sessions** — 4-tuple (`srcIp, dstIp, protocol,
  dstPort`), not a real 5-tuple. Sufficient for inbound-vs-outbound policy teaching;
  insufficient for simulating truly concurrent sessions from one host to one server.
- **No session timeout.** Sessions persist until a rule is removed or the device is
  cleared (real firewalls age out idle sessions: TCP ~3600s, ICMP ~30s).
- **`security-level` is stored but not enforced.** Real ASA uses it to determine
  default inter-zone policy (higher can initiate to lower without an explicit rule).
  This sim requires explicit rules in both directions regardless of level; the
  command is supported for educational display only.

## Where it's taught

`mission_005` ("Secure the Office") — three zones (INSIDE/DMZ/OUTSIDE), stateful
inside→outside access, a DMZ server published on HTTPS only, and a specific rule-
ordering lesson: a narrow `deny` for the Guest VLAN above a broad `permit` INSIDE→DMZ
rule, proving first-match-wins actually matters, not just default-deny. See
[[Mission Catalog]].

## Related

[[NAT and PAT]] (NAT moves from router to firewall in `mission_005`) ·
[[Failure Reason Codes]] · [[Admin Laptop and Tools]] (the Firewall Web UI is a GUI
that reads/writes these exact same fields, never a parallel store)
