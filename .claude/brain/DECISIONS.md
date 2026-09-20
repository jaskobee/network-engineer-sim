# DECISIONS — locked design choices

Each entry: **what**, **why**, **date**. If you believe one is wrong, say so to the user
and get an explicit go-ahead before changing it. Never silently work around one.

## Product

- **Accuracy outranks convenience** (project founding). If a simplification would teach
  something a learner must unlearn for CCNA / Network+ / a real job, it doesn't ship.
  Unavoidable simplifications are labelled as such in-game or in a code comment.
  `docs/NETWORKING_ACCURACY.md` is the hard spec.
- **Stay on the web, no game engine** (see `docs/ADMIN_LAPTOP_AND_TOOLS.md` §0).
  The UI is terminals, tables, forms — DOM territory. Install-free is a core advantage
  over Packet Tracer / GNS3.
- **Dev mode is a faster way to drive the real engine, never a way around it.**
  Presets/smoke tests reach state through the same devices, cabling and CLI paths a
  player uses. A preset that "looks solved" must *be* solved by the engine, or QA hides
  real bugs. Dev mode is gated (`import.meta.env.DEV`), never reachable in production.

## Networking model

- **The Switch is strictly Layer 2** (Catalyst 2960 model). No per-port IPs, no
  `ip route`, no `no switchport`. Management via one SVI. It never routes between VLANs.
  Inter-VLAN routing = router-on-a-stick. A separate "Layer 3 Switch" device type may
  be added later; the plain switch stays L2. Contract comment lives at the top of
  `src/models/CLIEngine.js`.
- **A ping succeeds only if both forward AND return paths forward** (`checkPing` runs
  the BFS both ways; one-way routing yields `no_return_path`).
- **Each OS keeps its own idioms**: IOS on router/switch/firewall, iproute2 on
  pc/server, Windows CMD on the admin laptop. No cross-leakage of syntax or output.
- **Firewall CLI is ASA-*inspired*, not exact ASA** (`nameif`, `firewall-rule permit
  from-zone … to-zone … service …`). Chosen for readability; documented as a
  simplification. Stateful sessions are 4-tuples (no ephemeral source port), no session
  timeout, `security-level` stored but not enforced.
- **NAT tracks `inside_local → inside_global` only** (no ports) and skips return-path
  NAT for internet destinations. Sufficient for reachability; documented simplification.
- **DHCP is modelled logically (DORA), not as packet-level broadcast through BFS.**
  Broadcasts don't cross routers; relay via `ip helper-address` honours routing.
  `lease_expires` is `"Infinite"`; client-id is `"devId:ifaceName"`.
- **A fault is real misconfigured state, not a branch in ping logic.** Faults mutate the
  same fields the CLI mutates; symptoms emerge from the accurate engine. (Basis of Act 2
  and of service tickets.)

## Architecture

- **JavaScript only, no TypeScript.**
- **`src/models/` is a pure headless core** — zero React/DOM imports. The UI is
  disposable; the engine is the asset.
- **Mutation + tick**: engines mutate `Device`/`Topology` in place, then `refresh()`
  bumps a tick in `GameContext`. No immutable-state rewrite.
- **No giant GameManager.** `GameContext` owns topology/engine/CLI plumbing and knows
  how to start/complete *any* mission. `CareerContext` (wraps *inside* `GameProvider`)
  owns company/reputation/clients/contracts and persists its own slice.
- **Two mission registries behind one door.** Legacy `mission_001–005` stay on
  `MISSION_TASKS` verbatim; new missions are declarative `MissionDefinition`s.
  `getMissionRuntime(id)` / `findMissionById(id)` are the only lookups callers use.
- **Missions gate on numeric `requiredReputation`, never on tier names**, so tiers can
  be renamed/rebalanced without touching mission data.
- **The admin laptop is a real topology node, and GUI tools share device state with the
  CLI.** No parallel config store; `show running-config` is the arbiter. No synthesized
  packets in captures — if the engine can't emit it truthfully, don't display it.
- **Contract SLA time is real wall-clock** (`Date.now()`), tuned for a 20–60 min
  session; paused while a job-board mission is active.

## UI design system (2026-09-20)

- **Colour is signal.** A quiet cool-graphite UI where the only saturated colours are
  what a port LED would say (green up/done, amber attention/down, red fault) plus one
  blue for what you can act on. *Why:* it keeps the LED metaphor meaningful — colouring
  a firewall red or a PC green by category makes "green = up" unreadable.
- **Two self-hosted typefaces** (`src/assets/fonts`, SIL OFL): Barlow Semi Condensed for
  UI, Atkinson Hyperlegible Mono for data and the terminal. *Why:* the mono was chosen
  because IPs, interface names and commands must keep `0/O` and `1/l/I` apart; both are
  bundled so the app stays install-free/offline and makes no third-party requests.
- **Mission progress is drawn as a patch cable** (`.step`): one LED per task, cable lit
  up to the current step. Difficulty is drawn as signal-strength bars, not stars.
- **Sentence case, no tracked-caps eyebrows, no emoji as controls.** Emoji stay only
  where they are player content (client/company avatars).

## Tooling

- **Vitest is the test runner**; networking behaviour is locked in by tests. Broken
  scenarios assert the exact `failureReason`, not just `reachable === false`.
- **The accuracy gate (`docs/NETWORKING_ACCURACY.md` Prompt 8) runs before finalizing
  any networking change** — locally via `/accuracy-gate`, and again in CI via
  `.github/scripts/ai-review.js`.
- **The brain lives in `.claude/` and is versioned** (2026-09-11). Only
  `settings.local.json` is git-ignored.
