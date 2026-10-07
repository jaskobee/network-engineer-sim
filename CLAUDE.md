# CLAUDE.md — the simulator platform (network-engineer-sim)

## What this repo is
Two browser-based education products that share a design language and nothing they don't need to:

| Product | App | Teaches | Hard spec | Read first |
|---|---|---|---|---|
| **NetSim** | `apps/netsim` | On-prem networking: Cisco IOS, Linux/Windows hosts — CCNA / Network+ | `docs/netsim/NETWORKING_ACCURACY.md` | `apps/netsim/CLAUDE.md` |
| **Cloud Engineer** (working title, Preview) | `apps/cloud` | Azure infrastructure and architecture | `docs/cloud/AZURE_ACCURACY.md` | `apps/cloud/CLAUDE.md` |

**Accuracy is the product in both.** Each product's `CLAUDE.md` holds its hard rules; read it before
changing anything in that app.

## ⛔ HARD RULES (both products)
1. **Accuracy outranks convenience.** Never teach something a learner must unlearn for a cert or a job.
   When in doubt, flag the conflict instead of silently simplifying.
2. **The products stay separate.** An app never imports another app; shared code lives in `packages/`,
   is domain-free and is imported by name (`@sim/kernel/…`, `@sim/ui/…`). Enforced by
   `tests/boundaries.test.js`. Hybrid (roadmap Phase 5) will be the only package allowed to import both
   products' engines.
3. **Storage keys carry the product's prefix** (`netsim_*`, `cloudeng_*`) — the products share one origin.
4. **JavaScript only, no TypeScript.** Engines are headless (no React/DOM).
5. **Never connect to real cloud services or handle real credentials.**

## Layout and commands
```
apps/netsim/      NetSim                  apps/cloud/       Cloud Engineer (src/azure = Azure model)
packages/kernel/  @sim/kernel: ipUtils, saveFormat (imports nothing)
packages/ui/      @sim/ui: base.css (fonts, tokens, primitives), sign-in, product switcher
tests/            repo-wide boundary tests        docs/netsim | cloud | platform
```
- `npm test` → every workspace as a Vitest project (+ `repo`)
- `npm run build` → NetSim into `dist/`, then Cloud Engineer into `dist/cloud/`; only the xterm
  chunk-size warning is OK
- `npm run dev` / `npm run dev:netsim` (5173) · `npm run dev:cloud` (5180)
- Architecture and roadmap: `docs/platform/PLATFORM_ARCHITECTURE.md`, `docs/platform/HYBRID_PLATFORM_ROADMAP.md`

## The brain
`.claude/brain/` (see its README): `PLATFORM.md` (included below) plus one folder per product
(`netsim/`, `cloud/`), each with STATUS, DECISIONS, GLOSSARY, LESSONS — loaded by that product's
`CLAUDE.md`. Changing `packages/` affects both products: run both products' checks.

## Working discipline
- Big changes: plan first, list files, work in phases with a checkpoint each, keep every mission in
  both products playable.
- Finish with `npm test` + `npm run build` clean, the product's accuracy gate (`/accuracy-gate` for
  NetSim, `/azure-gate` for Cloud Engineer), then `/brain-update` if project facts changed.

---
@.claude/brain/PLATFORM.md
