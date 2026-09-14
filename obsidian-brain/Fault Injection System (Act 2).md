---
tags: [roadmap, faults, troubleshooting]
---

# Fault Injection System (Act 2)

**Design spec only — not yet implemented.** Full spec:
`docs/NETSIM_FAULTS_AND_FEATURES.md` Part 1. Listed as the #1 "next up" item in
[[Status and Roadmap]]. This is the highest-value planned feature: hand the player a
pre-broken, mostly-working topology and a client complaint ("Sales can't reach the
file server, but printing works") instead of a checklist — pure diagnostic
troubleshooting, the most job-realistic skill in the whole curriculum.

## The design principle that makes this safe to build

> **A fault is real misconfigured/broken state, not a special case in the ping
> logic.**

Apply a fault by mutating the actual `Device`/interface/`Topology` fields — the same
fields a player edits via the CLI. The existing, already-accurate engine then
evaluates reachability with **zero fault-specific branches**. This is the same
principle already proven at small scale by service tickets (see
[[Career Layer]] §Service Tickets) — this system is
the same idea at the scale of a full pre-built broken topology, not a different
mechanism. Consequences of doing it this way:

- `show` commands reveal the fault automatically, exactly like on real gear.
- The player fixes it with the *same* real commands that caused it.
- It's structurally impossible to accidentally teach a fake symptom — the symptom
  can only ever be what correct modeling actually produces.

## The one required engine upgrade

`checkPing` needs to return a richer result to express *degraded* (up but lossy) as
well as binary reachable/unreachable — see
[[Ping Reachability Engine (checkPing)|checkPing]] for the exact
proposed shape (`degraded`, `sent`, `received`, `lossPct`, `rttMs`) and why this
hasn't been needed yet (every implemented fault today is a clean binary
reachable/unreachable case).

## The `Fault` shape

```js
const Fault = {
  id, type,                          // e.g. 'wrong_subnet_mask'
  target: { deviceId, ifaceId },
  params: { ... },
  apply(topology) { /* mutate real state */ },
  symptom: '...',                     // what the player should observe
  rootCause: '...',
  revealedBy: ['show running-config', ...],  // which commands reveal it
  isFixed(topology) { /* real-state check */ },
}
```

A mission carries `faults[]`; on load each `fault.apply(topology)` runs. On every
tick, the mission solves when **every** `fault.isFixed()` is true **and** the
objective ping passes.

## The fault library (13 faults, A–M, fully specified in the doc)

Grouped by what's needed to build them:

- **Pure L3, buildable now with the current engine** (A–E): wrong subnet mask,
  missing/wrong default gateway, interface administratively down, missing/wrong
  static route, one-way routing (no return path). See
  [[Routing and Static Routes]] and
  [[IP Addressing and Subnetting]].
- **VLAN faults, need the L2/L3 split already settled** (F–H): wrong VLAN on an
  access port, an access port that should be a trunk, native VLAN mismatch on a
  trunk. See [[Layer 2 Switching and VLANs]].
- **Degraded/physical, need the richer `PingResult` + counters** (I–L): duplex
  mismatch, speed mismatch, duplicate IP address, wrong cable/wrong port. See
  [[Interface States and Cabling]].
- **M — wrong interface on a multi-port device.** The nastiest one: the cable joins
  the correct two *devices* but lands on the wrong *port* of one of them (e.g. a
  switch uplinked to a router's WAN /30 port instead of its LAN port). IP addressing,
  gateways, and static routes can all read as completely correct — the route even
  shows active in `show ip route` — yet end-to-end pings fail, because the LAN
  segment has no physical path through the intended gateway interface. Reinforces
  "check Layer 1 before you doubt Layer 3." Flagged as a strong candidate for an
  intermediate mission once 003-style multi-router topologies exist for it to sit on.

## Suggested build order

1. Upgrade `checkPing` → the richer `PingResult` shape.
2. Implement the `Fault` shape + a mission `faults[]` loader.
3. Ship faults A–E first (pure L3, huge teaching value, no new engine surface).
4. Add F–H once VLAN-fault support is settled.
5. Add I–L last (need counters and the richer result).

## Scoring hook this unlocks (not built)

Track commands used, time taken, and whether the player changed *only* what was
actually faulted — penalize "shotgun" fixes (reconfiguring things that weren't
broken), reward diagnosing with `show` commands before editing blindly. Reuses
`revealedBy` + `failurePoint` for a hint ladder: nudge → suggest the exact `show`
command → reveal the faulted interface.

## Related

[[Failure Reason Codes]] ·
[[Ping Reachability Engine (checkPing)|checkPing]] ·
[[Career Layer]] · [[Status and Roadmap]]
