---
tags: [networking, l3, routing]
---

# Routing and Static Routes

## Directly connected networks

A directly connected network appears in the routing table **only** when its
interface has an IP **and** is up/up (line protocol up). `show ip route` marks these
`C` (connected) with an `L` (/32 local) entry per interface — exactly like real IOS.

## No route, no forwarding

A router will not forward to a destination it has no route for. No default route +
no matching specific route = the packet is dropped, and the resulting ping failure
carries `failureReason: 'no_route'` (IOS shows `U.U.U`, Linux shows
`Destination Net Unreachable`). See [[Failure Reason Codes]].

## Longest-prefix match

Forwarding always uses longest-prefix match — a more specific route wins regardless
of how it was learned (this project has no dynamic routing protocols yet, but the
principle is enforced for the static routes that do exist).

## Static route syntax (IOS)

```
ip route <dest-net> <mask> <next-hop-or-exit-int>
ip route 0.0.0.0 0.0.0.0 <next-hop>        ← default route
```

A next-hop must be reachable via a connected network, or the static route does not
install/isn't usable at all — the engine does not accept a next-hop on a foreign
subnet. (If administrative distance is ever modeled, real defaults apply: connected
0, static 1, EIGRP 90, OSPF 110, RIP 120 — not implemented yet, listed here so a
future addition matches reality.)

## The return path is the whole lesson

**A ping succeeds only if BOTH the source→destination AND destination→source paths
forward correctly.** [[Ping Reachability Engine (checkPing)]] runs its BFS walk in
both directions. The single most common beginner bug — configuring a route in one
direction and forgetting the other — is deliberately preserved as a failure mode:
`failureReason: 'no_return_path'` ("the request left, the reply never came back").
This is not a bug to "fix" by loosening the check; it is the point.

[[Mission Catalog]] — `mission_003` ("Dr. Patel's Clinic") is built specifically to
teach this: two routers, a point-to-point WAN link, and the requirement that *both*
routers carry a static route back to each other's LAN, or return traffic dies.

## Where this lives in code

`src/models/Topology.js` — the BFS-based `checkPing(srcIp, dstIp, service?)` walk,
run once forward and once in reverse; `src/models/CLIEngine.js` — `ip route` parsing,
validation, and `show ip route` rendering.

## Related

[[Router-on-a-Stick (Inter-VLAN Routing)]] · [[Ping Reachability Engine (checkPing)]] ·
[[Failure Reason Codes]] · [[NAT and PAT]] (a default route toward the ISP is a
NAT prerequisite, not a substitute for it)
