# CLAUDE.md — NetSim (`apps/netsim`)

## What this product is
NetSim is a **browser-based networking education game**: Cisco Packet Tracer meets a
tower-defense shop loop. The player is a network engineer who takes client jobs, buys
hardware, configures devices through **real CLI commands**, and gets paid when the
network works. Runs entirely in the browser. One of two products in this repo (root
`CLAUDE.md`); Azure lives in Cloud Engineer (`apps/cloud`), not here.

**The mission: teach networking fundamentals CORRECTLY** — to CCNA / CCNP / CompTIA
Network+ standard. Accuracy is the product.

## ⛔ HARD RULES (non-negotiable)
1. **Networking accuracy outranks convenience.** If a simplification would teach a
   beginner something they'd have to unlearn for a cert or a real job, do not ship it.
   When in doubt, flag the conflict instead of silently simplifying.
2. **`docs/netsim/NETWORKING_ACCURACY.md` is a hard spec.** All networking behaviour, CLI
   commands, `show` output, hints, and mission validation must comply with it.
3. **A Layer 2 switch has no per-port IPs**, one management SVI, and never routes
   between VLANs. Inter-VLAN routing = router-on-a-stick (or a future L3 switch device).
4. **A ping succeeds only along a path real hardware would forward — both directions.**
5. **Each OS keeps its idioms**: IOS (router/switch/firewall), Linux iproute2
   (pc/server), Windows CMD (admin laptop). No leakage.
6. **Dev mode drives the real engine, never bypasses it.** No direct state writes in
   presets/tests; dev UI is compiled out of production (`import.meta.env.DEV`).
7. **JavaScript only, no TypeScript.** `src/core/`, `src/guest/`, `src/onprem/` and
   `src/engine/` stay free of React/DOM imports (enforced by
   `src/core/__tests__/architecture.test.js`).

## Stack
Vite 5 · React 18 · @dnd-kit · @xterm/xterm 5.5 · React Context (`GameContext` via
`useGame()`, `CareerContext`) · plain CSS (`src/index.css` on top of `@sim/ui/base.css`) · Vitest 4.

- `npm run dev` (repo root) → Vite dev server, port 5173, `/network-engineer-sim/`
- `npm test` (root) → every project · `npm run build` (root) → only the xterm chunk-size warning is OK

### Code layout (paths relative to `apps/netsim/`)
| Folder | Holds |
|---|---|
| `src/core/` | NetSim's kernel, imports nothing else: `failureReasons` (registry + `REASON.*`), `pathResult` (the `checkPing` contract). IPv4 math and the save format come from `@sim/kernel` |
| `src/guest/` | Host OS shells: `PCCLIEngine` (Linux iproute2), `WindowsCLIEngine` (CMD). Known couplings to `onprem` (DHCP client, DNS resolver) are listed in the architecture test |
| `src/onprem/` | On-prem plane: `Device`, `Topology` (`checkPing`/BFS), `CLIEngine` (IOS), `DHCPEngine`, `dns` (resolver) |
| `src/engine/` | Game logic on top of the planes: mission DSL, career, tickets, GUI→CLI planners |
| `src/components/`, `src/state/` | React UI and contexts. Sign-in, fonts, tokens, `.btn/.seg/.led` and the product switcher come from `@sim/ui` |

## The brain — read before working
NetSim's knowledge lives in `.claude/brain/netsim/` (repo root; layout in `.claude/brain/README.md`):
- **STATUS** and **DECISIONS** are included below and always in context here.
- `.claude/brain/netsim/GLOSSARY.md` — device types, interface IDs, `failureReason` codes,
  mission DSL, career-layer terms. Read when a term is unfamiliar.
- `.claude/brain/netsim/LESSONS.md` — gotchas. Read before touching missions, engine, or
  React state.

Path-scoped rules in `.claude/rules/` attach automatically when you edit
`src/core|guest|onprem|engine`, missions/data, `src/devMode`, UI/state, or `.github`.

### Skills (invoke them; the user can too with `/name`)
| Skill | Use when |
|---|---|
| `/accuracy-gate` | Before finalizing **any** networking/CLI/hint/mission change |
| `/new-mission` | Authoring a mission on the declarative DSL |
| `/new-preset` | Adding a dev-mode working/broken topology preset |
| `/cli-command` | Adding/fixing a terminal command or `show` output |
| `/fault-scenario` | Act 2 troubleshooting scenarios, ticket faults, new reason codes |
| `/verify-in-browser` | Confirming a change in the running app |
| `/brain-update` | End of substantial work — keep the brain true |

### Subagents
- `accuracy-reviewer` — independent review of a diff against the spec (local twin of CI).
- `mission-qa` — plays a mission on paper + runs its test; reports blockers/mis-teaching.

## Working discipline
- Networking behaviour is locked in by tests. Broken scenarios assert the exact
  `failureReason`, never just "failed". Never loosen a test to make code pass without
  justifying it against the spec.
- Big changes: plan first, list files, work in phases with a checkpoint each, keep
  every existing mission playable.
- Finish with `npm test` + `npm run build` clean, then `/accuracy-gate` if networking
  was touched, then `/brain-update` if project facts changed.

---
@../../.claude/brain/netsim/STATUS.md
@../../.claude/brain/netsim/DECISIONS.md
@../../docs/netsim/NETWORKING_ACCURACY.md
