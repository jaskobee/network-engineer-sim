---
tags: [status, roadmap]
---

# Status and Roadmap

Snapshot as of 2026-09-14 (commit `9e7bf1e`, "Latest updates"). **This note goes
stale fast** — treat every number as approximate and prefer `.claude/brain/STATUS.md`
(refreshed via the `/brain-update` skill — see [[Working with Claude Code]]) or the
live repo for anything you're about to act on.

## Health at last check

- `npm test` → ~440 tests / 21 files passing (Vitest).
- `npx vite build` → clean apart from the expected xterm chunk-size warning.
- Dev server: `npm run dev`, port 5173 (5174 if busy).

## Shipped and stable

- Legacy missions `mission_001`–`005` and the declarative Mission DSL (both behind
  `getMissionRuntime()`) — see [[Mission DSL]] and
  [[Mission Catalog]].
- The career layer: persistent clients, monthly-support contracts, reputation tiers,
  wall-clock SLA service tickets — see [[Career Layer]].
- The full networking model: bidirectional `checkPing` with `failureReason`/
  `failurePoint`, strict L2 switch, ROAS, DHCP (DORA/pools/relay/`dhclient`),
  NAT/PAT overload, zone-based stateful firewall with service/port matching, a
  recording-only packet capture. See every note under
  [[Home]] §Networking Model.
- Three CLI engines (IOS/Linux/Windows) — see
  [[The Three CLI Engines]].
- Admin Laptop: Firewall Web UI, Browser panel, Wireshark panel, and (most recently
  shipped) the mission-control Dashboard tab — see [[Admin Laptop and Tools]].
- Dev/QA mode: ~13+ presets (working + broken), foundation smoke tests, live state
  inspector — see [[Dev Mode and QA]].
- An endless, pannable floorplan (click-drag anywhere to pan, Figma-style) — see
  [[UI Component Map]].
- Autosave to localStorage + Export/Import JSON, reset guard, client-side beta login
  gate (`AuthContext`, bcryptjs).
- CI: Vitest on PR, GitHub Pages deploy, AI accuracy review (`ai-review.js`), mission
  QA, failure explainer, full accuracy audit.

## Next up, in priority order (per `.claude/brain/STATUS.md`)

1. **Act 2 — fault-injection/troubleshooting missions.** Pre-broken topologies, no
   step-by-step hints, diagnose with `show` commands. The single highest-value
   planned feature. See [[Fault Injection System (Act 2)]].
2. **Refine the generic reason codes that currently fall through to `no_route`**:
   `subnet_mismatch` first, then `gateway_unreachable`, `ip_conflict`,
   `duplex_mismatch`. See
   [[Failure Reason Codes]].
3. More clients/missions on the declarative DSL; more service tickets. See
   [[Mission Catalog]].
4. The admin-laptop tool family from `docs/ADMIN_LAPTOP_AND_TOOLS.md`: the port
   scanner and "WireFish" packet analyzer are still spec-only, and the Phase 3
   packet-engine refactor still needs an explicit owner decision before it can start.
   See [[Admin Laptop and Tools]].
5. Backlog: live-network/SLA "one more wave" mode polish, mastery scoring (star
   rating on best practice, not just "does it ping"), shop margins, blueprint
   diagrams in briefings — see `docs/NETSIM_FAULTS_AND_FEATURES.md` Part 2 for the
   full "make it addictive, honestly" idea list, including an explicit list of what
   *not* to do (no loot-box randomness, no energy timers, no FOMO daily-login
   pressure — intrinsic stickiness only).

## Known rough edges

- `docs/` filenames are inconsistent in case (`Roas-Sandbox-LAB.md`,
  `dhcp-sandbox-lab.md`, `NETWORKING_AUDIT.md`) — older docs may reference names that
  no longer match exactly.
- `docs/ADMIN_LAPTOP_AND_TOOLS.md` still opens with "nothing here is implemented
  yet" — stale; the laptop and Firewall Web UI *are* implemented. Fix the doc's
  status line next time that file is touched.

## Related

[[Home]] · [[Decisions Log]] · [[Fault Injection System (Act 2)]]
