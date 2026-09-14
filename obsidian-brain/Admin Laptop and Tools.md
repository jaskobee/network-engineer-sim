---
tags: [admin-laptop, ui, product]
---

# Admin Laptop and Tools

The player's own workstation — a real topology node, not a floating always-works UI
panel. Design spec: `docs/ADMIN_LAPTOP_AND_TOOLS.md`. Partially implemented; see
status per tool below.

## Why it's a device, and why that's the whole point

If the laptop were a magic panel, every lesson it could teach would be deleted. Being
a real node with a NIC, an IP, a gateway, a switch port unlocks, for free, using
engine behavior that already exists elsewhere:

- Laptop on the wrong VLAN → cannot reach the firewall (`vlan_isolated`)
- No default gateway → reaches the local SVI, not the firewall on another subnet
  (`host_no_gateway`)
- Firewall has no rule permitting `tcp/443` from the management subnet → the admin
  page is unreachable (`blocked_by_firewall`). **The player can lock themselves out
  of their own firewall.** A deliberate, universal rite-of-passage beat.

See [[Failure Reason Codes]] for what each of
these actually means underneath.

## Model

- Device type `laptop`, one NIC. Uses **either** `PCCLIEngine` (Linux) or
  `WindowsCLIEngine` (Windows CMD) depending on `os_type` — see
  [[The Three CLI Engines]]. No new CLI engine was
  needed for the base terminal.
- Pre-placed, free, and excluded from mission-completion refunds (`type === 'laptop'`
  is explicitly skipped in `computeRefund()`, alongside `isp` — see
  `src/engine/economy.js`).
- A **tools layer** sits on top of the plain terminal: a windowed UI surface (browser
  tab, dashboard, future scanner/analyzer) the plain PC/server doesn't have.

## In-band vs. out-of-band management — a deliberately phased capability

Today, right-click → Open Terminal is "magic" access to any device regardless of
whether the network actually reaches it. The laptop is the intended vehicle for
modeling the real distinction later: SSH/web admin requires actual reachability;
console cable is always out-of-band and always works. **Not built yet** — magic
access stays global for now (beginners shouldn't be punished for not knowing what a
console cable is). Gating this behind a mode flag for later missions is an explicit,
still-open design decision — see `docs/ADMIN_LAPTOP_AND_TOOLS.md` §2 and
[[Status and Roadmap]].

## Tool 1 — Firewall Web Admin UI (shipped)

A browser-style tab (`FirewallWebUI.jsx` / `BrowserPanel.jsx`) where navigating to an
IP is literally a `checkPing(laptopIp, ip, { protocol: 'tcp', port: 443 })` call —
zero new networking logic, just the existing engine refusing to open the page when
policy says no.

```
reachable                        → render the admin page
blocked_by_firewall              → ERR_CONNECTION_TIMED_OUT (silent drop — the lesson: a drop looks like nothing happened)
no_route / host_no_gateway / vlan_isolated / admin_down / link_down
                                  → ERR_CONNECTION_TIMED_OUT (reason available to the hint system, not shown outright)
reached the host, nothing on 443 → ERR_CONNECTION_REFUSED
```

`ERR_CONNECTION_TIMED_OUT` vs `ERR_CONNECTION_REFUSED` is a deliberate, real-browser
distinction — a silent drop and "nothing's listening" are different causes and
beginners must learn to tell them apart. The admin page itself reads/writes the
firewall's real `fw_zones`/`fw_rules`/`fw_sessions` — a rule added in the GUI must
appear in `show firewall-rules` immediately, and vice versa. See
[[Stateful Firewall]].

## Tool 2 — Admin Dashboard (shipped, most recently built)

A dense, dark, fintech-style mission-control view (`AdminDashboardTab.jsx`,
`AdminLaptopShared.jsx`, `SatisfactionMeter.jsx`) — the default tab the laptop opens
to. Product goal, in the requester's own words: *"a place the player always wants to
open up... just like real life, your laptop as a network engineer is everything."*

**Every number is real, derived from live game state — nothing decorative or
invented.** Widgets:

- **Stat cards**: balance, total earned (`completedMissions` rewards/refunds +
  `ticketHistory` rewards), monthly recurring revenue (sum of active contracts'
  `amountPerMonth`), reputation tier + progress bar toward the next tier (uses
  `tierForScore()` from [[Career Layer]]).
- **Active Incidents** — a Gantt-style bar per open service ticket, spanning
  `SLA_DURATION_MS + TICKET_GRACE_MS`, colored by `ticketUrgency()`, positioned using
  the exact same pause-aware `effectiveElapsedMs` formula `contractClock.js` uses
  internally — never naive timestamp subtraction (see
  [[Career Layer]] §SLA clock).
- **Client Happiness** — an SVG donut (average satisfaction across *non-dormant*
  clients only — a dormant client's already-flagged-broken satisfaction would
  silently drag the average down if included) plus a per-client `SatisfactionMeter`
  list.
- **Missions Progress** and **Weekly Earnings** (a day-bucketed bar chart, not a
  smooth sparkline — deliberately, so a 7-point dataset never implies interpolated
  precision it doesn't have).
- **Recent Activity** — merges live notifications with synthesized rows from
  `completedMissions`/`ticketHistory`, newest first.

Two small, additive data-model changes enabled this (see
[[Device and Topology Model]] §save/load
pattern for how): `completedMissions` entries gained a `completedAt` timestamp, and a
new `ticketHistory[]` array was added to `CareerContext` recording every resolved
ticket's clientId/title/reward/completion time. Both follow the established
no-version-bump save-field-addition pattern.

## Tool 3 — Port scanner (spec only, not built)

Would add `device.services[]` (`{ protocol, port, name }`) so firewall rules become
*honest* — permitting `tcp/443` to a host not actually listening on 443 must still
fail, which the engine doesn't yet model. Produces an open/closed/filtered
trichotomy (`open`: reached + listening; `closed`: reached + nothing listening;
`filtered`: never reached at all, i.e. `blocked_by_firewall`). Name must **not** be
`nmap` (trademarked) — candidates: `netscan`, `porthound`.

## Tool 4 — "WireFish" packet analyzer (spec only, the real architectural fork)

See [[Ping Reachability Engine (checkPing)|checkPing]] §"Logical vs.
packet-level" for the full Path A (rejected) vs. Path B (recommended, gated on an
explicit owner decision) analysis. The short version: **never** build this on
synthesized/post-hoc-invented packet traces — that's the one shortcut this project
explicitly refuses to take, because a packet capture is the single most inspectable
artifact in the product and any invented frame is maximally visible to exactly the
audience the project promises not to mislead. A capture is taken *at an interface*,
not globally — the laptop's NIC sees only what a real switched network would show it,
not everything on the map (itself a teaching moment about SPAN/mirror ports).

## Cross-cutting: tools as purchasable software

The intended pacing mechanism for tool sprawl: sell future tools (scanner, WireFish)
through the existing [[UI Component Map|Shop]] as software licenses, not free
unlocks — paces complexity for beginners and gives the money loop something new to
spend on.

## Security note (still relevant if a player-named laptop label ships)

`"Username's laptop"` would be user-supplied text rendered into device labels,
tooltips, and any future exported/shared topology JSON — must be escaped at render,
validated/length-capped at input, never `dangerouslySetInnerHTML`'d. A live XSS
vector the day topology sharing ships, flagged in the spec so it isn't forgotten.

## Related

[[Stateful Firewall]] ·
[[Career Layer]] ·
[[The Three CLI Engines]] ·
[[Status and Roadmap]]
