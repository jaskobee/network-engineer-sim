---
paths:
  - "src/data/missionDefinitions/**"
  - "src/data/missions.js"
  - "src/data/missionTasks.js"
  - "src/data/clients.js"
  - "src/data/contracts.js"
  - "src/data/serviceTickets.js"
  - "src/data/mission005scaffold.js"
---

# Rules: missions, clients, tickets (`src/data/*`)

1. **New missions are declarative.** Author a `MissionDefinition` in
   `src/data/missionDefinitions/` using the DSL in `src/engine/missionEngine.js`
   (vocabulary in `.claude/brain/GLOSSARY.md`). Do **not** add new hand-written
   `checkNNN()` functions to `missionTasks.js` — that file is frozen for
   `mission_001–005`. Use `/new-mission`.
2. **Register** the definition in `src/data/missionDefinitions/index.js` and, for a
   client mission, reference it from the client's `initialMissionIds` or a prior
   mission's `followUpMissionIds`.
3. **Every mission gets an end-to-end test** in `missionDefinitions/__tests__/` that
   drives the real engine (`Device`, `Topology`, `CLIEngine`, `PCCLIEngine`) task by
   task, asserting each task is `false` until its real prerequisite is met (partial
   states included). Model on `mission_local_shop_1.test.js`.
4. **Hints must be real commands** a player can type verbatim, in the correct OS
   idiom for the device, and must match what the condition actually checks.
5. **Networking in the brief must be correct**: subnet math, gateway-in-subnet, trunk
   for ROAS, helper-address for DHCP relay, etc. The mission is a lesson.
6. **Gate on `requiredReputation` (number)**, never on a tier label.
7. `financialModel: 'keep'` for persistent clients (hardware stays, no refund);
   `'refund'` only for legacy-style one-off jobs.
8. **Service ticket faults must be real state changes** the engine reflects (e.g.
   `Topology.disconnect()`), never a flag the ping logic special-cases.
