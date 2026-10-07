# PLATFORM — the repo, the products, what they share

_Last refreshed: 2026-10-07 (platform split). Describes **now**; product details live in
`netsim/` and `cloud/` next to this file._

## The products
| Product | App | Teaches | Spec | Brain |
|---|---|---|---|---|
| **NetSim** | `apps/netsim` | On-prem networking: Cisco IOS, Linux/Windows hosts, CCNA / Network+ | `docs/netsim/NETWORKING_ACCURACY.md` | `netsim/` |
| **Cloud Engineer** (working title, "Preview") | `apps/cloud` | Azure infrastructure and architecture, for people moving from on-prem to cloud (AZ-104 / AZ-700 direction) | `docs/cloud/AZURE_ACCURACY.md` | `cloud/` |

Same family (one design language, one sign-in, links between them), technically separate:
own build, URL, saves, missions, docs, brain. Architecture and reasoning:
`docs/platform/PLATFORM_ARCHITECTURE.md`.

## Health
- `npm test` (root) → **993 tests / 49 files**, one Vitest project per workspace plus `repo`:
  netsim 789 · cloud 118 · kernel 73 · ui 4 · repo boundaries 9.
- `npm run build` → NetSim into `dist/`, then Cloud Engineer into `dist/cloud/`. Only the xterm
  chunk-size warning (NetSim) is expected.
- Dev: `npm run dev` / `npm run dev:netsim` (port 5173), `npm run dev:cloud` (port 5180,
  `/network-engineer-sim/cloud/`). Each dev server is its own origin, so you sign in once per product there.
- Deploy: GitHub Pages from `main` — NetSim at `/network-engineer-sim/`, Cloud Engineer at
  `/network-engineer-sim/cloud/` (one origin: sign-in carries over).

## Layout
```
apps/netsim/      NetSim app (its engine stays inside: src/core, guest, onprem, engine)
apps/cloud/       Cloud Engineer app (its engine: src/azure — headless)
packages/kernel/  @sim/kernel — ipUtils, saveFormat. Imports nothing.
packages/ui/      @sim/ui — base.css (fonts, tokens, .btn/.seg/.led/header), AuthContext,
                  LoginPage, products.js + ProductSwitcher. No domain code.
tests/            repo-wide boundary tests (boundaries.test.js)
docs/netsim|cloud|platform/
```

## Platform decisions
- **Two separate products in one monorepo** (owner, 2026-10-07). npm workspaces, no Turborepo/Nx.
  *Why:* they teach completely different things (on-prem configuration vs Azure infrastructure), but
  share a design language; separate repos would cost a solo developer version-sync work and make Hybrid
  hard. Supersedes "Cloud is a section of NetSim" (2026-10-06).
- **Cloud Engineer is Azure only for now** (owner, 2026-10-07). AWS/GCP would each be their own model and
  spec (`src/aws` next to `src/azure`), never a cloud-neutral abstraction — it would teach wrong things.
- **Engines stay inside their apps until a second consumer exists.** Hybrid (roadmap Phase 5) is the
  trigger to move them to `packages/` — then `packages/hybrid` is the only place allowed to import both.
- **Shared packages are domain-free and imported by name** (`@sim/kernel/…`, `@sim/ui/…`); plain source,
  no build step, no publishing. Enforced by `tests/boundaries.test.js` (B1–B5): apps never import each
  other, packages never import apps, no relative path leaves its workspace, every import is declared,
  headless code stays headless.
- **Storage keys carry the product's prefix** (`netsim_*`, `cloudeng_*`) because the products share an
  origin; each product resets only its own (NetSim's New game sweeps `netsim*`). Sign-in session:
  `sessionStorage.netsim_session`, shared on purpose (name kept so beta sessions stayed valid).
- **Saves carry `schemaVersion` (kernel `saveFormat`) and every node a `domain`** — from Phase 0; kept so
  a future Hybrid save can hold both kinds of node.
- **JavaScript only, no TypeScript.** Plain CSS: shared rules in `packages/ui/base.css`, product rules in
  each app's own stylesheet.
- **Never connect to real cloud services or handle real credentials.**

## UI design system (shared, `packages/ui/base.css`; since 2026-09-20)
- **Colour is signal.** Quiet graphite; saturated colour only for state (green up/done, amber attention,
  red fault) plus one blue for what you can act on.
- **Two self-hosted typefaces** (`packages/ui/fonts`, SIL OFL): Barlow Semi Condensed (UI), Atkinson
  Hyperlegible Mono (data). Install-free, no third-party requests.
- **Sentence case, no tracked-caps eyebrows, no emoji as controls.**
- **Menus always come over everything else** (z-index scale in `.claude/rules/ui.md`).

## Open (owner)
- Final product names and the family brand ("Cloud Engineer" is a working title).
- Merging `phase-0-kernel-extraction` to `main` publishes both products.
- Codex mirrors (`AGENTS.md`, `.agents/`, `.codex/`) predate Phase 0 and the split; only their paths
  were updated.
