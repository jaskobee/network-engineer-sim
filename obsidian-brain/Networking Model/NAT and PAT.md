---
tags: [networking, nat, pat]
---

# NAT and PAT (Source NAT Overload)

Implemented across `src/models/Topology.js` (BFS enforcement) and
`src/models/CLIEngine.js` (IOS CLI); enforced by `src/models/__tests__/nat.test.js`.

## Invariants

1. **RFC 1918 addresses are not internet-routable.** `10.0.0.0/8`, `172.16.0.0/12`,
   `192.168.0.0/16` are private. A packet with a private source egressing toward the
   ISP **without** translation returns `failureReason: 'nat_required'` from
   `checkPing`. The lesson: without NAT, the reply can never find its way back — the
   source address isn't globally unique.
2. **Inside/outside interfaces are explicit.** `ip nat inside` on the LAN-facing
   interface(s), `ip nat outside` on the WAN/ISP-facing interface.
3. **PAT/overload config**:
   ```
   access-list <1-99> permit <network> <wildcard>
   ip nat inside source list <n> interface <wan-if> overload
   ```
   Many inside hosts share the single public WAN IP; translations are tracked as
   `device.nat_translations`: `{ inside_local, inside_global }` entries.
4. **Only ACL-matched traffic is translated.** Sources not matched by the NAT ACL
   still fail with `nat_required` even when `ip nat outside` is correctly configured
   on the WAN interface — the ACL is doing real gatekeeping, not decoration.
5. **Private→private (LAN-to-LAN) traffic is never NAT-checked.** The BFS check only
   fires when the egress interface's path leads toward the ISP device. Purely
   internal pings are unaffected regardless of NAT config.
6. **The translation table is a real side effect.** `device.nat_translations` is
   populated by `checkPing` itself (the same pattern as `topology.pingLog`).
   `show ip nat translations` and `show ip nat statistics` read straight from it.
7. **A default route toward the ISP is still required.** NAT rewrites the source
   address; it does not replace routing. See [[Routing and Static Routes]].

## Documented simplifications (not bugs)

- **Port tracking is conceptual, not literal.** Real PAT demultiplexes return traffic
  by (IP, port) tuples. The sim tracks only `inside_local → inside_global` (no port)
  — sufficient for reachability, insufficient for literally simulating concurrent
  sessions. State this honestly if a player asks.
- **No return-path NAT.** `checkPing` skips the return path for internet
  destinations (there's no local device sitting at `8.8.8.8`). Un-translation on the
  return trip is implied by the translation table existing, not independently
  simulated. This is not a correctness hole in disguise: if the WAN link is down, the
  forward-path BFS fails *before* reaching the NAT gate, so the translation table can
  never produce a false-positive success (this exact non-interaction is locked in by
  test N12).

## Where it's taught

`mission_004` — NAT/PAT overload translating all four VLANs' private traffic to the
single public WAN IP. See [[Mission Catalog]] and
[[Router-on-a-Stick (Inter-VLAN Routing)]].

## Related

[[Routing and Static Routes]] · [[Stateful Firewall]] (NAT moves from the router to
the firewall in `mission_005`) · [[Failure Reason Codes]]
