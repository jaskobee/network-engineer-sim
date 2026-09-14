---
tags: [networking, engine, ping, bfs]
---

# Ping Reachability Engine (checkPing)

`Topology.checkPing(srcIp, dstIp, service?)` is the single source of truth for "can
this traffic actually get there" across the entire game — every mission objective,
every CLI `ping`, every GUI tool (Firewall Web UI, future port scanner) that needs to
know whether a flow succeeds, calls this one function. There is no second
implementation anywhere.

## Shape of the result

```js
{ reachable, failureReason, failurePoint /* device id or iface id */ }
```

`service` defaults to `{ protocol: 'icmp', port: null }`; named services resolve
through the well-known port table (see [[Stateful Firewall]]).

The `docs/NETSIM_FAULTS_AND_FEATURES.md` design doc specifies a richer future shape
(`degraded`, `sent`, `received`, `lossPct`, `rttMs`) for physical-layer faults like
duplex mismatch — not fully implemented yet; see
[[Fault Injection System (Act 2)]].

## How it works today: bidirectional BFS, not a packet trace

`checkPing` walks the topology graph via breadth-first search **twice** — once
forward (source→destination) and once in reverse (destination→source) — and only
reports success if **both** directions actually forward. This single design choice
is what makes the project's #1 beginner lesson ("configuring only one direction of a
route") a real, reproducible failure instead of something that has to be faked. See
[[Routing and Static Routes]].

At each hop the BFS respects, in the correct order for that device type:

- Interface up/up state ([[Interface States and Cabling]])
- L2 VLAN/trunk boundaries on switches ([[Layer 2 Switching and VLANs]])
- Router-on-a-stick subinterface encapsulation/routing ([[Router-on-a-Stick (Inter-VLAN Routing)]])
- The routing table, longest-prefix match ([[Routing and Static Routes]])
- RFC 1918 + NAT translation requirements toward the ISP ([[NAT and PAT]])
- Firewall zone policy, first-match-wins, stateful session lookup
  ([[Stateful Firewall]])

If any hop breaks it, the walk stops there and that hop's identity becomes
`failurePoint`. See [[Failure Reason Codes]] for the complete enum and what each one
actually means.

## Logical vs. packet-level: a deliberate current limitation

DHCP ([[DHCP]]) is modeled logically (a DORA function call), not as literal
packet-level broadcasts walked through this BFS — broadcasts genuinely don't cross
routers in the model, but that's enforced by explicit broadcast-domain logic in
`DHCPEngine.js`, not by BFS packet simulation. Similarly, no ARP is simulated, and
`show mac address-table` currently returns a documented stub rather than a live,
learned table.

`docs/ADMIN_LAPTOP_AND_TOOLS.md` §5 records the actual architectural fork this
implies for a future packet-analyzer tool ("WireFish"): **Path A** (synthesize a
plausible packet trace after the fact from the BFS result) is explicitly **rejected**
— it means inventing packets, which violates the project's core accuracy rule in the
most visible way possible. **Path B** (make the engine itself event-emitting — a
packet object walks hop by hop, each device really processes it, `checkPing` becomes
a *consumer* of that event stream rather than the source of truth) is the recommended
direction, gated on an explicit owner decision because it's a foundational refactor.
The ~440 existing Vitest tests that encode expected reachability outcomes are
explicitly called out as *the safety net* for attempting that refactor — "rebuild the
core underneath and the suite reports any behavioral drift," a position that only
gets harder to reach the more missions accumulate on top of the current core.

## Recording, not deciding

`Topology.recordCapture(srcIp, dstIp, result, service)` runs *after* `checkPing`
returns, and only records what already happened — walking `findPath()` for a
successful ping, or a single drop entry at `result.failurePoint` for a failed one. It
never influences the reachability decision itself; it is a read-only trace of it, and
it's what any future packet-capture UI must keep being true to (see
[[Admin Laptop and Tools]]).

## Related

[[Failure Reason Codes]] · [[Fault Injection System (Act 2)]] ·
[[Routing and Static Routes]] · [[Stateful Firewall]]
