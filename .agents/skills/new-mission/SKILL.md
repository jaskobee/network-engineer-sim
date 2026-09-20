---
name: new-mission
description: Author a new NetSim mission on the declarative MissionDefinition DSL — definition file, registration, client wiring, and an end-to-end Vitest that drives the real engine. Use when asked to add, design, or scaffold a mission, job, or client scenario.
---

# New mission

Missions are **lessons**. The topology must be something a CCNA-level engineer would
actually build, and every hint must be a real command.

## 0. Read first
- `.Codex/brain/GLOSSARY.md` → "Mission DSL" and "Mission metadata fields".
- `src/data/missionDefinitions/mission_local_shop_1.js` (template) and its test.
- `src/engine/missionEngine.js` → the `evaluateCondition` switch, to confirm the
  condition types that exist today. If the mission needs a check that doesn't exist,
  **add a typed condition to the engine (+ test in `engine/__tests__/missionEngine.test.js`)**
  rather than reaching for `custom`.

## 1. Design the lesson (write this down before coding)
- Learning objective in one sentence (e.g. "a PC needs an in-subnet default gateway to
  leave its LAN").
- Topology ASCII diagram, every IP/mask/gateway/VLAN listed. Verify the subnet math.
- Which device does what, in which OS idiom.
- Required vs optional objectives. Optional ones prove understanding (e.g. "PC-1 pings
  PC-2 directly — proves switch forwarding").
- Difficulty, reward, `requiredReputation`, `requiredKnowledge`, `estimatedDuration`.

## 2. Create `src/data/missionDefinitions/<mission_id>.js`
- Top-of-file comment: purpose, ASCII topology, financial model, follow-ups.
- Fill every metadata field listed in the glossary. `hardware[]` must match what the
  objectives require the player to buy. `blueprint` + `layout` describe the same
  network as the objectives.
- `deviceRoles`: one role per device the objectives refer to. Use `match:
  'first'|'second'|'third'` by purchase order and give human `label`s.
- `objectives[]`: ids `t1…tn` in play order (buy → place → cable → configure → verify).
  - `interfaceConfigured` on any multi-port device: **pass `ifaceName`**.
  - `pingSucceeded` reflects a ping the player actually typed — hints must tell them
    to ping, with the real target IP.
  - Hints: array of strings and `{ role, cmd }` items, verbatim-typable, correct OS
    (IOS on router/switch/firewall, `ip addr add … dev eth0` / `ip link set eth0 up`
    / `ip route add default via …` on pc/server).

## 3. Register
- `src/data/missionDefinitions/index.js` → import + add to `MISSION_DEFINITIONS`.
- Client wiring: either a new client in `src/data/clients.js` (`initialMissionIds`) or a
  prior mission's `followUpMissionIds`. If the mission establishes a contract, set
  `contractOutcome`.

## 4. Test: `src/data/missionDefinitions/__tests__/<mission_id>.test.js`
Model on `mission_local_shop_1.test.js`:
1. `getMissionRuntime(id)` returns the expected required/optional task ids.
2. Walk the flow against the **real engine** (`new Device(cat('router'))`,
   `topology.addDevice`, `topology.connect`, `engine.execute(...)`), asserting after each
   step that the *next* task is still `false`.
3. For every `and` over N things, assert the N-1 partial state is `false`.
4. Use `topology.logPing(src, dst)` to simulate typed pings.
5. `diagnoseFn` yields a hint for every unmet task with an empty topology.
6. If the mission teaches a failure (wrong gateway, missing trunk…), assert the engine's
   `checkPing(...).failureReason` for the broken intermediate state.

## 5. Finish
- `npm test` and `npx vite build` clean.
- Play it once via the dev server if a UI-facing field changed (blueprint SVG,
  hints rendering). Prefer `/verify-in-browser`.
- Run `/accuracy-gate`.
- `/brain-update`: add the mission to `STATUS.md` "Shipped", note any new condition type
  in `GLOSSARY.md`.
