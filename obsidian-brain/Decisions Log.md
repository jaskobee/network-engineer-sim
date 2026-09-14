---
tags: [decisions, reference]
---

# Decisions Log

Locked design choices and their *why*. Canonical source: `.claude/brain/DECISIONS.md`
— if you believe one of these is wrong, say so explicitly and get a go-ahead before
changing it; never silently work around one. Grouped here the same way as the source.

## Product

- **Accuracy outranks convenience** (project founding principle). See
  [[Vision and Product]].
- **Stay on the web — no game engine.** The UI surface is terminals, tables, forms —
  DOM territory, and a game engine would be miserable at it. A WebGL build would also
  destroy the install-free advantage NetSim has over Packet Tracer/GNS3. No
  physics/3D/sprite needs exist that would justify one.
- **Dev mode is a faster way to drive the real engine, never a way around it.** See
  [[Dev Mode and QA]].

## Networking model

- **The switch is strictly Layer 2** (Catalyst 2960 model). No per-port IPs, no
  `ip route`, no `no switchport`. Management via one SVI. Never routes between
  VLANs. Inter-VLAN routing = router-on-a-stick. A separate "Layer 3 Switch" device
  type *may* be added later; the plain switch stays L2 forever regardless. See
  [[Layer 2 Switching and VLANs]].
- **A ping succeeds only if both forward AND return paths forward.** See
  [[Ping Reachability Engine (checkPing)|checkPing]].
- **Each OS keeps its own idioms** — IOS / iproute2 / Windows CMD, no cross-leakage.
  See [[The Three CLI Engines]].
- **Firewall CLI is ASA-*inspired*, not exact ASA** — chosen for readability, always
  documented as a simplification. Stateful sessions are 4-tuples (no ephemeral source
  port), no session timeout, `security-level` stored but not enforced. See
  [[Stateful Firewall]].
- **NAT tracks `inside_local → inside_global` only** (no ports) and skips return-path
  NAT for internet destinations. See [[NAT and PAT]].
- **DHCP is modeled logically (DORA), not as packet-level broadcast through BFS.**
  Broadcasts don't cross routers; relay via `ip helper-address` honors real routing.
  `lease_expires` is always `"Infinite"`; client-id is `"devId:ifaceName"`. See
  [[DHCP]].
- **A fault is real misconfigured state, not a branch in ping logic.** Faults mutate
  the same fields the CLI mutates; symptoms emerge from the accurate engine. Basis of
  the (not-yet-built) Act 2 system and of the (built) service tickets. See
  [[Fault Injection System (Act 2)]] and
  [[Career Layer]].

## Architecture

- **JavaScript only, no TypeScript.**
- **`src/models/` is a pure headless core** — zero React/DOM imports. The UI is
  disposable; the engine is the asset. See [[Architecture Overview]].
- **Mutation + tick**: engines mutate `Device`/`Topology` in place, then `refresh()`
  bumps a tick in `GameContext`. No immutable-state rewrite pattern.
- **No giant GameManager.** `GameContext` owns topology/engine/CLI plumbing and can
  start/complete any mission; `CareerContext` (mounted *inside* `GameProvider`) owns
  company/reputation/clients/contracts and persists its own slice. See
  [[Architecture Overview]].
- **Two mission registries behind one door.** Legacy `mission_001`–`005` stay on
  `MISSION_TASKS` verbatim; new missions are declarative `MissionDefinition`s.
  `getMissionRuntime(id)` / `findMissionById(id)` are the only lookups callers use.
  See [[Mission DSL]].
- **Missions gate on numeric `requiredReputation`, never on tier names**, so tiers
  can be renamed/rebalanced without touching mission data. See
  [[Career Layer]].
- **The admin laptop is a real topology node**, and GUI tools share device state with
  the CLI — no parallel config store; `show running-config` is the arbiter. No
  synthesized packets in captures — if the engine can't emit it truthfully, don't
  display it. See [[Admin Laptop and Tools]].
- **Contract SLA time is real wall-clock** (`Date.now()`), tuned for a 20–60 minute
  session; paused while a job-board mission is active. See
  [[Career Layer]].

## Tooling

- **Vitest is the test runner**; networking behavior is locked in by tests. Broken
  scenarios assert the exact `failureReason`, not just `reachable === false`.
- **The accuracy gate runs before finalizing any networking change** — locally via
  `/accuracy-gate`, again in CI via `.github/scripts/ai-review.js`.
- **The brain lives in `.claude/` and is versioned** (committed to git). Only
  `settings.local.json` is git-ignored (personal, per-machine permission overrides).

## Related

[[Home]] · [[Working with Claude Code]] · [[Status and Roadmap]]
