# DECISIONS — Cloud Engineer, locked design choices

Each entry: **what**, **why**, **date**. If you believe one is wrong, say so to the owner and
get an explicit go-ahead before changing it. Never silently work around one. Repo-wide
decisions (the split, shared packages, design system) are in `../PLATFORM.md`.

## Product
- **Cloud Engineer is its own product, Azure only for now** (owner, 2026-10-07). It teaches the whole Azure
  infrastructure and architecture — not only networking — so that someone coming from on-prem gets familiar with
  Azure before they meet it on the job. Separate app, progress, missions and sandbox; NetSim stays untouched.
  Supersedes "Cloud is a separate section of NetSim" (2026-10-06). Ships labelled **Preview**.
- **Accuracy outranks convenience; `docs/cloud/AZURE_ACCURACY.md` is the hard spec** (2026-10-05). Only VERIFIED
  rules are implemented; a rule marked TO-VERIFY or SOURCED is never implemented — stop and flag. A case the spec
  doesn't cover is refused as `not_modelled`, never guessed. Only the owner flips a rule SOURCED → VERIFIED.
- **Never connect to real Azure or handle real credentials** (2026-10-05).
- **When Microsoft's pages disagree, follow what Azure itself does** (owner, 2026-10-07: "follow the official Azure way,
  make it as realistic as we can"). Precedence: what the platform enforces or returns (API resource names, resource
  provider error text, portal flow on Learn) over a summary table. Examples: default NSG rule names `AllowVnetInBound` /
  `DenyAllInBound` (API), NSG rule names may start with `_` (network RP error), storage access asked as Manage →
  Enable / Disable / Secured by perimeter (portal steps). Such entries are recorded in the spec with their sources.
- **First release = core landing zone + governance** (owner, 2026-10-06): management groups, subscriptions, RGs,
  VNet/NSG, VM, storage (Phase 1a), then RBAC, Azure Policy, locks (Phase 1b). Players build on a visual canvas with
  portal-style forms first; `az` CLI later, on the same operations.
- **The builder follows the real Azure portal workflow** (owner, 2026-10-07): every create is Review + create
  (validation first, nothing deployed on failure), the VM wizard creates the VM's NIC and optional public IP with
  it, a standalone NIC can't get a public IP at create (N4). Names the simulator gives auto-created resources
  (`<vm>-nic`, `<vm>-ip`) and all tenant/subscription GUIDs are made up — allowed by the owner.
- **Missions provide the subscriptions and run in the customer's own tenant** (owner, 2026-10-06/07). The player's
  sandbox is untouched while a mission runs; "Start sandbox over" resets only the sandbox.
- **RBAC principals are fictional users and groups** (owner, 2026-10-06): a small labelled set per mission, no
  Entra ID model, labelled in-game as a simplification. *Why:* RBAC is the lesson; modelling Entra would be a
  project of its own.
- **Microsoft Azure architecture icons** (owner, 2026-10-06), used unmodified, always with the full service name
  next to them, only for the Azure service they represent (`apps/cloud/src/assets/azure-icons/NOTICE.md`). The full
  download stays in git-ignored `vendor/`.

## Architecture
- **The Azure model is headless and pure** (`apps/cloud/src/azure`): plain serialisable tenant state keyed by
  ARM-style IDs; every change is an operation in `operations.js` returning `{ ok, state }` or a refusal with an
  `OUTCOME.*` and its rule ID. The UI changes state only through `CloudContext.apply(operation, args)`. Review +
  create runs the same operation as a dry run. Enforced: `tests/boundaries.test.js` B5.
- **Outcomes, not invented ARM errors**: an ARM error code is attached only where the spec sources it
  (`MissingMoveDependentResources`); otherwise the message is the simulator's explanation and is labelled so.
- **Mission progress is derived, never stored**: objectives are pure checks over the mission's tenant; completion
  is recorded when an `apply` makes the mission complete.
- **The save is the app's own** (`cloudeng_save_v1`): `{ sandbox, mission, completedMissions }`, `schemaVersion`
  from `@sim/kernel`, `domain: 'cloud'` on every node; an unreadable save is parked, never silently destroyed.
