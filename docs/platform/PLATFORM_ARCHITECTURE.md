# Platform architecture — NetSim and Cloud Engineer

**Status:** decided and built 2026-10-07 (owner: "follow the recommendation for the split"; Azure only for now).
Supersedes "Cloud is a section of NetSim" (2026-10-06). Companion: `HYBRID_PLATFORM_ROADMAP.md` (phases).

## 1. The decision
Two products that teach completely different things, built as **separate apps in one monorepo**:

| | NetSim | Cloud Engineer (working title) |
|---|---|---|
| Teaches | On-prem network configuration: Cisco IOS, VLANs, routing, DHCP, NAT, firewalls (CCNA / Network+) | Azure infrastructure and architecture, for people moving from an on-prem mindset to the cloud |
| The player works on | Physical boxes and cables, through each device's CLI | API resources in a hierarchy (tenant → management group → subscription → resource group → resource), through a control plane that validates, then deploys or refuses |
| Truth | Packets forward (`checkPing`, both directions) | Control plane: does it exist, is it allowed. Later the data plane: can X reach Y, and why not |
| Hard spec | `docs/netsim/NETWORKING_ACCURACY.md` | `docs/cloud/AZURE_ACCURACY.md` |

They feel like one family — same design language, one sign-in, links between them — but share no domain code.

### Options considered
| Option | Why not (or why) |
|---|---|
| Two independent repos, shared parts copied | The design system drifts; Hybrid (on-prem ↔ Azure) would need both engines across repos |
| Several repos + a published shared package | A version/publish/bump round-trip for every shared change — a tax a solo developer pays daily |
| Keep one app with a Cloud section | One deploy, one brand, one bundle — the coupling the owner wanted out of |
| **Monorepo: separate apps, separate builds/URLs/saves, small shared packages** ✅ | One clone and one `npm test`; shared changes land in one commit; Hybrid is just another package |

## 2. Layout
```
apps/netsim/        NetSim. Its engine stays inside (src/core, guest, onprem, engine).
apps/cloud/         Cloud Engineer. Its engine: src/azure (headless model, operations, missions).
packages/kernel/    @sim/kernel — ipUtils, saveFormat. Domain-free, imports nothing.
packages/ui/        @sim/ui — base.css (fonts, tokens, .btn/.seg/.led, header), AuthContext,
                    LoginPage (product passes title/tagline/illustration), products.js + ProductSwitcher.
tests/              boundaries.test.js — the rules in §3, enforced.
docs/netsim | cloud | platform
.claude/brain/      PLATFORM.md + netsim/ + cloud/
```
Tooling: npm workspaces (no Turborepo/Nx until builds are slow); shared packages are plain source that Vite
compiles directly (no build step, no publishing); one root Vitest config runs every workspace as a project.

**Why the engines stay inside their apps:** a package earns its keep when a second consumer exists. Today
each engine has one. Hybrid (Phase 5) is the trigger: both engines then move to `packages/` so
`packages/hybrid` can depend on them.

## 3. Boundaries (`tests/boundaries.test.js`)
- **B1** an app never imports another app — by path or by package name.
- **B2** packages never import apps; `kernel` imports nothing; `ui` imports only React and bcryptjs.
- **B3** another workspace is reached only by package name, never by a relative path leaving the workspace.
- **B4** every import is declared in the workspace's `package.json` (no reliance on hoisting).
- **B5** headless code (`apps/cloud/src/azure`, `packages/kernel`) has no React, `.jsx` or CSS.
NetSim's internal layering (core / guest / onprem / engine) keeps its own architecture test.

## 4. Shared vs separate
| Shared now | Shared as a pattern, not code | Separate |
|---|---|---|
| Design tokens, fonts, primitives (`base.css`) | Mission framework (objective = pure check, progress derived) | Engines and domain models |
| Beta sign-in, product switcher | Outcome / failure-reason registries | CLI engines (guest shells could become a package if Cloud Engineer VMs need a shell — after their DHCP/DNS coupling to `onprem` is cut) |
| IPv4 math, save envelope (`schemaVersion`, `domain`) | Accuracy spec + gate process (one per product) | Canvases, missions, economy/career, brains, skills |

Later, as hosted services (only when accounts or payments are needed): identity, profile, progress sync,
entitlements, telemetry. The seam already exists — each app saves through one function.

## 5. Build, deploy, storage
- `npm run build` → NetSim into `dist/` (it empties it), then Cloud Engineer into `dist/cloud/`. GitHub
  Pages serves NetSim at `/network-engineer-sim/` and Cloud Engineer at `/network-engineer-sim/cloud/`.
- **One origin**, so the sign-in (`sessionStorage`) carries over — and `localStorage` is shared, so every key
  carries its product's prefix (`netsim_*`, `cloudeng_*`) and each product resets only its own.
- Dev servers: NetSim 5173, Cloud Engineer 5180 (`products.js` builds the switcher links from these).

## 6. How the cloud product grows
Layers, each usable on its own: control plane (built: model + operations, Review + create = dry run) →
access (RBAC, Policy, locks — Phase 1b) → data plane (a flow evaluator over effective NSG/route/peering/private
DNS config, with Network Watcher-style tools — Phase 2) → operations (deployments, activity log, failures) →
more front ends on the same operations (`az`, then IaC). The canvas is a view of the model, never the model.
AWS or GCP would each get their own model and spec beside `src/azure` — never a cloud-neutral abstraction.

## 7. Traps
1. Building a generic "platform" (mission engine, resource-graph framework, plugin system) before a third product
   needs it.
2. A cloud-neutral model across providers — an Azure VNet is regional, an AWS subnet sits in one availability
   zone, a GCP VPC is global.
3. A shared package that learns about a domain — then the products are coupled again.
4. Breadth over depth: every service needs sourced rules before it ships.
5. Storage collisions on the shared origin; a reset that sweeps another product's data.
6. Breaking NetSim's URL or saves (both unchanged by the split).
