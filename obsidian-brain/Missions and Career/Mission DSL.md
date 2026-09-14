---
tags: [missions, dsl, engine]
---

# Mission DSL

`src/engine/missionEngine.js` is the declarative interpreter every mission since the
original five has been authored against — the replacement for hand-written
`checkNNN()`/`diagnoseNNN()` functions. It never touches `CLIEngine`/`PCCLIEngine`/
`WindowsCLIEngine`/`Topology`/`Device` state directly; it only **reads** what's
already there (interfaces, placements, `topology.pingLog`), exactly like the legacy
check functions did.

## Two registries, one door

`mission_001`–`mission_005` are frozen on hand-written `MISSION_TASKS` entries in
`src/data/missionTasks.js` — **never** add new hand-written check functions there.
Every mission since is a declarative `MissionDefinition` object in
`src/data/missionDefinitions/`. Every caller in the codebase uses the same two entry
points regardless of which kind a mission actually is:

- `getMissionRuntime(missionId)` → `{ tasks, optionalTasks, checkFn, diagnoseFn }`
- `getMissionMeta(missionId)` → `{ clientId, financialModel }`

## A `MissionDefinition`'s shape

```
id, clientId, title, client, avatar, description, difficulty, reward,
optionalObjectiveBonus, requiredReputation, requiredKnowledge[], estimatedDuration,
financialModel ('keep' | 'refund'), followUpMissionIds[], contractOutcome { type },
hardware[], blueprint { segments, links, svgViewBox, notes }, layout[],
deviceRoles, objectives
```

### `deviceRoles`

```js
{ roleName: { type, match: 'first'|'second'|'third'|<number>, label } }
```
Resolved once per evaluation by device **type** + insertion index — this is how an
objective can say "the router" instead of re-deriving which device that is every
time. `resolveMissionRoles(mission, devices)` is the public wrapper UI components use
(e.g. to build a per-device executed-commands checklist) without duplicating the
matching logic.

### `objectives[]`

Each: `{ id, label, hint, optional?, condition }`. `hint` is a string, or an array
mixing plain strings and `{ role, cmd }` objects — the UI renders the latter as a
concrete, per-device, copy-pasteable command checklist.

### Condition types

| Type | Checks |
|---|---|
| `deviceExists { deviceType, count }` | at least `count` devices of that type exist |
| `devicesPlaced { roles: [] }` | every named role's device has a floorplan placement |
| `cabled { roleA, roleB }` | **direct physical adjacency**, either direction — deliberately not a graph walk; see below |
| `interfaceConfigured { role, ifaceName?, requires: [...] }` | `'ip'`, `'subnetMask'`, `'notAdminDown'`, `'up'` on the resolved interface |
| `sameSubnet { roleA, roleB }` | both interfaces have IP+mask and share a network address |
| `pingSucceeded { roleA, roleB }` | reads `topology.pingLog` — a ping the player **actually typed** in a terminal, never a live `checkPing()` call |
| `and` / `or` / `not` | boolean composition over nested conditions |
| `custom { fn }` | escape hatch registered via `registerCustomPredicate(name, fn)` — prefer adding a new typed condition instead |

### Why `cabled` and `interfaceConfigured` don't walk the graph

`findRoleInterface()` picks "the interface with an IP" when `ifaceName` is omitted —
it deliberately does **not** walk cabling adjacency to find "the interface serving
this role's L3 path." The dominant topology shape in this game is Router–Switch–PC:
the router's LAN interface is cabled to the *switch*, not the PC, so a naive
adjacency lookup for a `cabled { roleA: router, roleB: pc }` condition would silently
return `false` forever. **Always pass `ifaceName` explicitly** whenever a role's
device has more than one candidate interface (e.g. a router with both a LAN and a WAN
port) — this is documented in `.claude/brain/LESSONS.md` as a real, previously-hit
bug, not a hypothetical.

## Auto-generated hints for declarative missions

`diagnoseObjectives()` derives a beginner-mode hint straight from a failing
condition's own shape (`autoHintFor()`) — no per-mission hand-written diagnose
function is required. This is less precise than the legacy missions' hand-tuned
`diagnoseNNN` text, but scales to any number of new missions with zero extra
authoring cost.

## Authoring a new mission

Use the `/new-mission` skill (see [[Working with Claude Code]]).
Every new mission gets an end-to-end Vitest test that drives the **real** engine
(`Device`, `Topology`, `CLIEngine`, `PCCLIEngine`) task by task, asserting each task
is still `false` under every partial state before the final piece flips it true —
modeled on `mission_local_shop_1.test.js`. See [[Mission Catalog]] for what exists
today.

## Related

[[Mission Catalog]] · [[Career Layer]] ·
[[Device and Topology Model]]
