---
tags: [architecture]
---

# Architecture Overview

## Stack

Vite 5 · React 18 · `@dnd-kit` (drag-and-drop cabling/placement) · `@xterm/xterm` 5.5
(real terminal emulator per device) · plain CSS (`src/index.css`, no CSS-in-JS, no
Tailwind) · Vitest 4 for tests. **JavaScript only — no TypeScript, anywhere.**

- `npm run dev` → Vite dev server, port 5173 (5174 if busy)
- `npm test` → Vitest, headless, ~440 tests as of this writing
- `npx vite build` → production build; only the xterm chunk-size warning is expected

## The one architectural rule that matters most

**`src/models/` and `src/engine/` are a pure, headless JS core with zero React/DOM
imports.** Every networking behavior — device state, cabling, reachability, DHCP,
NAT, firewall policy, CLI parsing — lives there and is directly testable in Node with
no browser. React components read this state and call its methods; they never
reimplement networking logic (no subnet math in JSX, no reachability guesses in a
component). The UI is disposable; the engine is the asset — it could be rebuilt with
a totally different frontend, or even run server-side for a future multiplayer mode,
without touching a single networking rule.

```
src/
  models/     ← headless core: Device, Topology, CLIEngine, PCCLIEngine,
                WindowsCLIEngine, DHCPEngine, ipUtils. NEVER imports React/DOM.
  engine/     ← headless business logic: missionEngine (DSL interpreter),
                reputation, contractClock, economy. Same purity rule.
  data/       ← static + semi-static content: deviceCatalog, missions, mission
                DSL definitions, clients, contracts, service tickets, notifications.
  state/      ← React Context glue: GameContext, CareerContext, AuthContext.
  components/ ← all UI. Reads context, calls engine methods, never owns logic.
  devMode/    ← QA presets + smoke tests, dev-only (import.meta.env.DEV gated).
  utils/      ← save/load, sounds, reset guard.
```

## State ownership — two contexts, deliberately not one

- **`GameContext`** (`useGame()`) — owns the `Topology`, the three `CLIEngine`
  instances, device placement/inventory, active mission/ticket state, and the
  floorplan "camera" (`panOffset` — see [[UI Component Map]]). Knows how to
  start/complete *any* mission, legacy or declarative, via `acceptMission` /
  `completeMission`.
- **`CareerContext`** (`useCareer()`) — wraps *inside* `GameProvider`. Owns company
  identity, reputation, the client roster, contracts, and service tickets: the
  business layer sitting on top of the engine GameContext drives. See
  [[Career Layer]].

Each context persists its **own** localStorage slice
(`netsim_v1_save` for GameContext's topology/mission state; `netsim_v1_company` /
`netsim_v1_career` for CareerContext). `CareerContext` cannot read GameContext's save
blob and doesn't try to — because `CareerProvider` mounts *inside* `GameProvider`,
data can't be threaded backward across that boundary, so each context owning its own
slice is simpler than fighting the mount order. `clientTopologies` (actual
devices/interfaces per persistent client) live in `GameContext`; `CareerContext` only
ever holds business records (satisfaction, growth stage, contract terms), never
`Topology` objects.

**No giant GameManager.** This split is deliberate and documented in
[[Decisions Log]] — don't collapse it into one context "for simplicity."

## Mutation + tick, not immutable rewrites

Engine objects (`Device`, `Topology`) are mutated in place by CLI commands and GUI
actions; after any mutation, `refresh()` (from `useGame()`) bumps a tick counter in
`GameContext`, and consuming components re-render off that tick. This is intentional
and different from typical React state management — do not introduce parallel copies
of device state in React `useState`; read live off the engine.

## Two mission registries behind one door

Missions 001–005 predate the declarative DSL and are hand-written check functions in
`src/data/missionTasks.js` (frozen — never edit for new missions). Every mission
since is a declarative `MissionDefinition` interpreted by
`src/engine/missionEngine.js`. Callers never need to know which kind they're looking
at: `getMissionRuntime(id)` and `findMissionById(id)` are the only lookups used
anywhere in the UI. See [[Mission DSL]].

## Persistence model

Autosave to `localStorage` on every meaningful state change (JSON serialization via
`src/utils/saveLoad.js`), plus manual Export/Import to a JSON file. A reset guard
(`src/utils/resetGuard.js`) coordinates a full wipe across all three `netsim_*` keys
when the player starts a new game. There is no backend — the entire game state lives
in the browser.

## Never touch these files without explicit sign-off

`src/models/{CLIEngine,PCCLIEngine,WindowsCLIEngine,Topology,Device,DHCPEngine,
ipUtils}.js` and `src/data/deviceCatalog.js` are the networking-accuracy-critical
core. Changes here are exactly the changes most likely to silently break the
project's central promise — see [[Vision and Product]] and
[[Working with Claude Code]] for the review discipline around them.
