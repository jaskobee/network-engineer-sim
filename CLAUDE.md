# CLAUDE.md — NetSim (network-engineer-sim)

## What this project is
NetSim is a **browser-based networking education game**: Cisco Packet Tracer meets a
tower-defense shop loop. The player is a network engineer who takes client jobs, buys
hardware, configures devices through **real CLI commands**, and gets paid when the
network works. Runs entirely in the browser.

**The mission: teach networking fundamentals CORRECTLY** — to CCNA / CCNP / CompTIA
Network+ standard. Accuracy is the product.

## ⛔ HARD RULES (non-negotiable)
1. **Networking accuracy outranks convenience.** If a simplification would teach a
   beginner something they'd have to unlearn for a cert or a real job, do not ship it.
   When in doubt, flag the conflict instead of silently simplifying.
2. **`docs/NETWORKING_ACCURACY.md` is a hard spec.** All networking behaviour, CLI
   commands, `show` output, hints, and mission validation must comply with it.
3. **A Layer 2 switch has no per-port IPs**, one management SVI, and never routes
   between VLANs. Inter-VLAN routing = router-on-a-stick (or a future L3 switch device).
4. **A ping succeeds only along a path real hardware would forward — both directions.**
5. **Each OS keeps its idioms**: IOS (router/switch/firewall), Linux iproute2
   (pc/server), Windows CMD (admin laptop). No leakage.
6. **Dev mode drives the real engine, never bypasses it.** No direct state writes in
   presets/tests; dev UI is compiled out of production (`import.meta.env.DEV`).
7. **JavaScript only, no TypeScript.** `src/models/` and `src/engine/` stay free of
   React/DOM imports.

## Stack
Vite 5 · React 18 · @dnd-kit · @xterm/xterm 5.5 · React Context (`GameContext` via
`useGame()`, `CareerContext`) · plain CSS (`src/index.css`) · Vitest 4.

- `npm run dev` → Vite dev server (5173, or 5174 if busy)
- `npm test` → Vitest · `npx vite build` → only the xterm chunk-size warning is OK

## The brain — read before working
Project knowledge lives in `.claude/brain/` (versioned; see `.claude/brain/README.md`):
- **STATUS** and **DECISIONS** are included below and always in context.
- `.claude/brain/GLOSSARY.md` — device types, interface IDs, `failureReason` codes,
  mission DSL, career-layer terms. Read when a term is unfamiliar.
- `.claude/brain/LESSONS.md` — gotchas. Read before touching missions, engine, or
  React state.

Path-scoped rules in `.claude/rules/` attach automatically when you edit
`src/models|engine`, missions/data, `src/devMode`, UI/state, or `.github`.

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
- Finish with `npm test` + `npx vite build` clean, then `/accuracy-gate` if networking
  was touched, then `/brain-update` if project facts changed.

---
@.claude/brain/STATUS.md
@.claude/brain/DECISIONS.md
@docs/NETWORKING_ACCURACY.md
