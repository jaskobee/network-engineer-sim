---
name: fault-scenario
description: Design and implement an Act 2 troubleshooting scenario — a pre-broken topology with a realistic fault, correct symptoms via `show` commands, the failureReason the engine must emit, and tests. Use for fault injection, troubleshooting missions, service-ticket faults, or refining a generic failureReason code.
---

# Fault scenario (Act 2 / troubleshooting)

Governing principle (`docs/NETSIM_FAULTS_AND_FEATURES.md` Part 1): **a fault is real
misconfigured state, not a special case in the ping logic.** Apply it by mutating the
same fields the CLI mutates; the symptom emerges from the accurate engine and is
visible through `show` commands.

## 1. Choose the fault from real life
Pick one a junior engineer actually meets. Write the scenario card:

| Field | Example |
|---|---|
| Fault | Wrong subnet mask on PC-2 (`/16` instead of `/24`) |
| Real-world cause | Typo during manual addressing |
| Expected `failureReason` | `subnet_mismatch` |
| `failurePoint` | `pc2` device id / its interface id |
| Symptom in IOS ping | `.....` timeouts |
| Symptom in Linux ping | `Destination Host Unreachable` |
| Diagnostic `show`s that reveal it | `ip addr` on PC-2 vs `show ip interface brief` on router |
| Fix commands | `ip addr del …`, `ip addr add …/24 dev eth0` |
| Lesson | A correct IP with a wrong mask is still broken |

Cross-check symptom strings against the table in `NETSIM_FAULTS_AND_FEATURES.md`.

## 2. Check whether the engine can express it
- If the `failureReason` already exists (see `.Codex/brain/GLOSSARY.md`), skip to §3.
- If it currently **falls through to `no_route`** (`subnet_mismatch`,
  `gateway_unreachable`, `ip_conflict`, `duplex_mismatch`), implement the code first:
  - In `Topology._bfsReach` / `_findExitInterfaces`, detect the condition from state
    (mask math, ARP-reachability of gateway, duplicate IPs, duplex fields) and return
    the specific reason + `failurePoint`. No fault flags.
  - Map the reason to the correct ping output in each CLI engine's `ping`.
  - Tests in `src/models/__tests__/topology.test.js` (and the CLI test for output).
  - Update `GLOSSARY.md` table and `STATUS.md` "Next up" via `/brain-update`.

## 3. Build the broken state through the engine
- **Mission/ticket**: a scaffold that runs real CLI commands to build the working
  network, then one more real command (or `Topology.disconnect()`) that introduces the
  fault. Pattern: `src/data/mission005scaffold.js`, `serviceTickets.js` `fault`.
- **Dev preset**: `/new-preset` with `category: 'broken'` and `expectedFailure`.

## 4. Author the mission (if it's a mission)
Use `/new-mission`, with these Act 2 differences:
- Objectives verify the *fix* (`pingSucceeded`, `sameSubnet`, `interfaceConfigured`),
  not the steps — no step-by-step hints. A hint may name the *tool* (`show ip interface
  brief`, `ip addr`) but not the answer.
- Include an objective that the player *diagnosed* where possible (e.g. ran the
  relevant `show` — if a `commandExecuted` condition doesn't exist yet, add it to the
  DSL with a test rather than using `custom`).
- Brief text describes the *complaint* ("Office PC can't reach the internet"), not the
  fault.

## 5. Tests must prove the symptom, not just the failure
- Broken state → `checkPing` returns `reachable:false` **and** the exact
  `failureReason` and `failurePoint`.
- `show` output in the broken state contains the tell-tale line a learner should spot.
- Applying the fix commands → reachable, mission objectives flip true.

## 6. Finish
`npm test`, `npx vite build`, `/accuracy-gate`, `/brain-update`.
