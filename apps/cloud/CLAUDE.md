# CLAUDE.md — Cloud Engineer (`apps/cloud`)

## What this product is
Cloud Engineer (working title, shipped as "Preview") teaches **Azure infrastructure and cloud
architecture** — management groups, subscriptions, resource groups, networking, compute,
storage, then governance (RBAC, Policy, locks), private endpoints and DNS — through missions in
customers' tenants and a visual builder that follows the real Azure portal workflow. The player
is someone moving from an on-prem mindset to Azure who wants to know it before meeting it on
the job. One of two products in this repo (root `CLAUDE.md`); on-prem networking lives in NetSim.

**Azure only for now.** Accuracy is the product, exactly as in NetSim.

## ⛔ HARD RULES (non-negotiable)
1. **`docs/cloud/AZURE_ACCURACY.md` is a hard spec.** Implement only VERIFIED rules. A rule
   marked TO-VERIFY or SOURCED is never implemented — stop and flag. A case the spec doesn't
   cover is refused as `not_modelled`, never guessed.
2. **Accuracy outranks convenience.** Nothing a learner would have to unlearn for AZ-104 /
   AZ-700 or a real job. Unavoidable simplifications are labelled in-game or in a comment.
3. **Follow the real portal workflow**: every create is Review + create (validate, then deploy;
   nothing deployed on failure); wizards create what the portal creates with them.
4. **State changes only through `src/azure/operations.js`** — the UI calls
   `apply(operation, args)`; it never edits tenant state or re-implements a rule.
5. **Refusals cite a rule ID** (`OUTCOME.*` + the spec rule, with its Learn page in
   `ruleSources.js`); a real ARM error code only where the spec sources it.
6. **Never connect to real Azure or handle real credentials.** IDs and GUIDs are made up.
7. **Microsoft Azure icons**: unmodified, the full service name always next to the icon, only for
   the service they represent (`src/assets/azure-icons/NOTICE.md`).
8. **JavaScript only.** `src/azure/` is headless — no React/DOM (`tests/boundaries.test.js` B5).

## Stack
Vite 5 · React 18 · React Context (`CloudContext` via `useCloud()`) · plain CSS (`src/cloud.css` on
top of `@sim/ui/base.css`) · Vitest 4.
- `npm run dev:cloud` (repo root) → port 5180, `http://localhost:5180/network-engineer-sim/cloud/`
- `npm test` (root) · `npm run build` (root; this app builds into `dist/cloud/`)

### Code layout (paths relative to `apps/cloud/`)
| Folder | Holds |
|---|---|
| `src/azure/` | The Azure model: `model`, `operations`, `outcomes`, `naming`, `cidr` (on `@sim/kernel/ipUtils`), `regions`, `catalog`, `ruleSources`, `persistence`, `missions/` |
| `src/state/CloudContext.jsx` | The slice `{ sandbox, mission, completedMissions }`, `apply`, missions, save |
| `src/components/` | Workspace tabs, management tree, network view + Review + create forms, mission UI |

## The brain — read before working
Cloud Engineer's knowledge lives in `.claude/brain/cloud/` (repo root):
- **STATUS** and **DECISIONS** are included below.
- `.claude/brain/cloud/GLOSSARY.md` — tenant model, operations, outcome codes, missions, UI names.
- `.claude/brain/cloud/LESSONS.md` — gotchas.

Skills: `/azure-gate` before finishing any cloud change · `/verify-in-browser` to confirm it in
the running app · `/brain-update` at the end of substantial work.

## Working discipline
- Every rule is locked in by a test that asserts the exact outcome and rule ID; missions have
  end-to-end tests that check partial progress doesn't count.
- Finish with `npm test` + `npm run build` clean, `/azure-gate`, then `/brain-update` if
  project facts changed.

---
@../../.claude/brain/cloud/STATUS.md
@../../.claude/brain/cloud/DECISIONS.md
@../../docs/cloud/AZURE_ACCURACY.md
