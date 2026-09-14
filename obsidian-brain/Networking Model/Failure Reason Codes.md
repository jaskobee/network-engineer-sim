---
tags: [networking, engine, reference]
---

# Failure Reason Codes

Every failed `checkPing` (see
[[Ping Reachability Engine (checkPing)]]) carries a specific `failureReason` — never
just a bare `reachable: false`. This is enforced by test discipline: broken
scenarios in Vitest assert the **exact** reason code, and loosening a test to accept
"any failure" instead of the correct one is treated as a red flag, not a convenience
(see [[Working with Claude Code]]).

## Implemented codes

| Code | Meaning | IOS ping shows | Linux ping shows |
|---|---|---|---|
| `no_route` | No matching route on a router (or generic fallthrough — see below) | `U.U.U` | `Destination Net Unreachable` |
| `admin_down` | Interface `shutdown` | `.....` | timeout / no reply |
| `link_down` | Cable/peer down (down/down) | `.....` | timeout |
| `no_return_path` | Request left, no route back | `.....` timeout | timeout |
| `host_no_gateway` | Host has no default route configured | n/a (host) | `connect: Network is unreachable` |
| `vlan_isolated` | Wrong VLAN, VLAN not carried on a trunk, or access-mode ROAS uplink | `.....` timeout | timeout |
| `nat_required` | RFC 1918 source egressing to the ISP without translation | — | — |
| `blocked_by_firewall` | Dropped by zone policy (`failurePoint` = the firewall's device id) | — | — |

## Specified but not yet distinguished — currently fall through to `no_route`

These are fully specified in `docs/NETSIM_FAULTS_AND_FEATURES.md` (with exact
manifestation + IOS/Linux ping output + fix) but the engine does not yet emit them as
their own code — implementing each is explicit, named work in
[[Status and Roadmap]] and [[Fault Injection System (Act 2)]]:

| Code | Meaning | IOS ping | Linux ping |
|---|---|---|---|
| `subnet_mismatch` | Wrong mask → host mis-decides local vs. remote | `.....` timeout | `Destination Host Unreachable` |
| `gateway_unreachable` | Gateway set but off-subnet / unresolvable | n/a (host) | `Destination Host Unreachable` |
| `ip_conflict` | Duplicate IP in the same subnet | erratic `!.!.!` | erratic / duplicate replies |
| `duplex_mismatch` | Link up/up but lossy (needs the richer `degraded`/`lossPct` `PingResult` shape) | partial `!.!..` | partial loss + high latency |

**If you're asked to implement one of these**, the priority order given in
[[Status and Roadmap]] is `subnet_mismatch` first, then `gateway_unreachable`, then
`ip_conflict`, then `duplex_mismatch` (the last one needs the richer result shape
first — see [[Ping Reachability Engine (checkPing)]]).

## Realistic CLI strings to reuse verbatim (never invent new ones)

- IOS: `% Invalid input detected at '^' marker.`, `% Incomplete command.` Ping
  characters: `!` = reply, `.` = timeout, `U` = unreachable.
- Linux: `Destination Host Unreachable`, `Destination Net Unreachable`,
  `connect: Network is unreachable`, `Request timed out`.

## Where new codes get registered (a checklist)

1. Implement the detection in `src/models/Topology.js` (the BFS walk) — see
   `.claude/rules/engine.md`: never add a fault-specific branch; the symptom must
   emerge from real state, exactly the design principle in
   [[Fault Injection System (Act 2)]].
2. Add or update Vitest coverage asserting the exact new code, not just
   `reachable === false`.
3. Add the row to this note **and** to the equivalent table in `.claude/brain/
   GLOSSARY.md` (the two should stay in sync — GLOSSARY.md is what Claude Code reads
   automatically every session).
4. If it replaces a fallthrough, remove it from the "Next up" list in
   `.claude/brain/STATUS.md`.

## Related

[[Ping Reachability Engine (checkPing)]] · [[Fault Injection System (Act 2)]] ·
[[Status and Roadmap]]
