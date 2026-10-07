# Phase 1a — Cloud section + resource model (plan for approval)

> **Platform split (2026-10-07).** The cloud "section" is now its own product, Cloud Engineer (`apps/cloud`).
> Paths in this plan are as they were written: `src/cloud/` → `apps/cloud/src/azure/`, `src/components/cloud/` →
> `apps/cloud/src/components/`, `src/state/CloudContext.jsx` → `apps/cloud/src/state/`, docs → `docs/cloud/`; the
> save key `netsim_cloud_v1` became `cloudeng_save_v1`. Step 7 still stands (`/azure-gate`).

**Status:** draft for the owner's approval, 2026-10-06. No code until approved.
**Read with:** `docs/HYBRID_PLATFORM_ROADMAP.md` (§1, §3, §4), `docs/AZURE_ACCURACY.md`
(the rules listed in §2 below), `CLAUDE.md`.

## 1. Goal

A new **Cloud** section beside Missions and Sandbox where the player builds Azure
infrastructure on a canvas with portal-style forms, sees it in two views, and completes
build missions — with every create/update/move checked by a validator that follows the
verified spec. **No traffic yet** (that's Phase 2), no RBAC/Policy/locks (Phase 1b), no
private endpoints or private DNS (Phase 4), no `az` CLI (later).

The on-prem game must behave exactly as before: same tests, same saves, same UI.

## 2. Rules this phase relies on (all VERIFIED in `AZURE_ACCURACY.md`)

| Area | Rules |
|---|---|
| Hierarchy | I1–I8 (root, one parent, depth 6, names, root can't move/delete, new subs under root) |
| Resource groups | J1, J2, J3, J5, J6, J7, J8; J9 for moves (instant — documented simplification) |
| Naming | K table, K1 (VM host name), K2 (global storage names, fictional "taken" list) |
| Network | A1, A2, A3, A3a, A4, A5, A7, B1 (private subnets by default), C1–C2 (NSG rules and default rules — stored and shown, **not evaluated** until Phase 2) |
| Compute | L1–L4, L7, L8, L9 (shown as a property, not simulated) |
| Storage | M1–M4 (settings only; nothing connects yet), M6 |
| Public IP | N1–N5 |

**Not used** (TO-VERIFY): J4 "can't nest" wording (the model simply has no RG-in-RG),
P5 error code, O8 limits, F-section items.

## 3. Architecture

```
src/cloud/                 headless, imports only src/core (architecture test A1–A3)
  model.js                 resource shapes + ARM-style IDs (/subscriptions/{id}/resourceGroups/…)
  regions.js               small fixed region list (see §6 Q2)
  naming.js                K-table validators
  cidr.js                  address-space checks on top of core/ipUtils (A1–A3a)
  validator.js             validate(state, operation) → { ok } | { ok:false, outcome, ruleId, message }
  operations.js            create / update / delete / move — the ONLY way state changes
  outcomes.js              management-plane outcome registry (spec table), like core/failureReasons
  missions/                cloud mission definitions + condition evaluator
  __tests__/               one test per rule ID; broken cases assert the exact outcome + ruleId
src/state/CloudContext.jsx own provider + persistence (localStorage `netsim_cloud_v1`,
                           schemaVersion, every node `domain: 'cloud'`)
src/components/cloud/      CloudWorkspace, ManagementView, NetworkView, CreateForms,
                           ResourceInspector, CloudMissionPanel, cloud icons
```

- **One write path.** Every form calls `operations.js`; nothing in React assigns resource
  fields (same rule as the on-prem GUI → CLI path). The future `az` CLI will call the same
  operations.
- **Declarative state.** The cloud state is a plain object (tenant → MGs → subscriptions →
  RGs → resources), serialisable as-is, so save/load and missions are simple.
- **Outcomes, not invented error text.** A refusal returns an outcome from the spec table
  (`name_invalid`, `region_mismatch`, `subnet_overlap`, `hierarchy_too_deep`,
  `root_immutable`, `nic_last_on_vm`, …) with the rule ID and a plain-language explanation
  labelled as the sim's. A real ARM error code appears only where the spec sources it.
- **`src/core/saveFormat.js`** gains `'cloud'` in `DOMAINS`. Nothing else in core changes.
- **App shell:** the mode switch gains a third value, `cloud`. When it's active, `App.jsx`
  renders `CloudWorkspace` instead of the floorplan, rails and inspector; the on-prem
  components stay mounted but hidden (as Sandbox already does), so switching back loses
  nothing. `GameContext` changes only to accept the new mode value.

## 4. What the player can do in 1a

**Management view** — tree: Tenant root group → management groups → subscriptions →
resource groups → resources. Create / rename / move management groups (depth and root
rules), move subscriptions between MGs, create/delete resource groups, move resources
between RGs (dependents rule from J9).

**Network view** — region → VNet (address space) → subnets; NICs inside subnets, VMs
attached to NICs, NSGs drawn on the subnet or NIC they're associated with, public IPs on
NICs; storage accounts drawn *outside* the VNet (no connection until Phase 4).

**Create forms (portal-style, our own look)** for: management group, subscription
(sandbox only — see Q3), resource group, VNet (+ subnets), NSG (+ custom rules, default
rules shown read-only), public IP (Standard only), NIC, VM (name rule by OS, size from a
short list, OS disk type limited to Premium SSD / Standard SSD / Standard HDD, at least one
NIC), managed disk, storage account (type, redundancy, public network access).

**Inspector** — properties, the resource ID, region, resource group, and "why" links to the
spec rule when something was refused.

## 5. First cloud missions

1. **Landing zone basics** — build `Platform` and `Landing zones` under the tenant root,
   move the given subscription under `Landing zones`. Teaches I1–I5.
2. **First workload** — RG + VNet/subnet (/24, with the 251-usable lesson) + NSG + VM with
   NIC in the same region; a pre-made VNet in another region is the trap (L2).
3. **Storage for the app** — storage account with a valid globally-unique name (K2),
   GZRS or ZRS per the brief, public network access set to *selected networks* or
   *disabled* as the brief requires (M4). Sets up the Phase 4 private-endpoint mission.

Each mission has an end-to-end test that drives `operations.js` only, asserts the partial
state is still incomplete before the last step (LESSONS rule), and asserts the exact outcome
for each trap.

## 6. Decisions (owner, 2026-10-06) — plan approved

1. **Icons — Microsoft's Azure architecture icons.** Terms
   (https://learn.microsoft.com/en-us/azure/architecture/icons/, updated 2026-07-09):
   "Microsoft permits the use of these icons in architectural diagrams, training materials,
   or documentation. You can copy, distribute, and display the icons only for the permitted
   use unless granted explicit permission by Microsoft. Microsoft reserves all other
   rights." Guidelines: don't crop, flip, rotate, distort or change their shape; put the
   product name near the icon; "Use the icons as they would appear within Azure"; don't use
   them to represent our own product. **Owner actions before the UI steps (4–5):** download
   the SVG set yourself (the page requires clicking "I agree to the above terms"), and
   confirm NetSim's use counts as "training materials / architectural diagrams" — the
   terms don't mention software or apps explicitly, so ask Microsoft if NetSim goes
   commercial. Engineering rules: icons are bundled unmodified under
   `src/assets/azure-icons/` with a NOTICE pointing to the terms; never recoloured (our
   "colour is signal" LEDs sit *next to* them, not on them); always shown with the product
   name; never used for NetSim's own branding.
2. **Regions** — short fixed list of real region names (West Europe, North Europe, Sweden
   Central, East US, West US 2); availability zones not modelled in 1a.
3. **Subscriptions — missions provide them.** The cloud sandbox has a "create subscription"
   button labelled as a simulated shortcut (real subscriptions come from a billing
   agreement).
4. **Release — visible in the public build, labelled "Preview"**, from step 3 on. Each
   step must leave the section working (no dead buttons) because it ships.

## 6a. Gaps found while designing (not in the verified spec)

These came up during step-1 design. Until they're researched and verified, the validator
refuses them with the outcome `not_modelled` ("the sim doesn't model this yet") rather than
inventing an Azure rule:
- whether a public IP / NSG must be in the same region (and subscription) as the NIC or
  subnet it's associated with;
- whether a NIC can be attached to only one VM at a time;
- whether a management group must be empty before it can be deleted;
- whether deleting a VNet or subnet that still has NICs is refused;
- whether resource-group and other resource names are compared case-insensitively
  (uniqueness checks compare exactly for now).

## 7. Work plan (checkpoint after each step: `npm test`, `npx vite build`)

1. `src/cloud` model, naming, CIDR, validator, operations, outcomes + tests for every rule in §2.
   **Done 2026-10-06** — validation lives inside `operations.js` (one pure function per operation)
   rather than a separate `validator.js`; option lists are in `catalog.js`. 85 tests.
2. `CloudContext` (own save slice, schemaVersion, domain `cloud`) + save/load tests;
   `DOMAINS` gains `'cloud'`; architecture test still green.
   **Done 2026-10-06** — persistence is headless (`src/cloud/persistence.js`, storage injected) and
   tested there; the architecture test now also keeps `src/cloud` free of React/DOM.
3. Mode `cloud` in the header (shipped visible with a Preview label, decision 4) + `CloudWorkspace`; on-prem untouched.
   **Done 2026-10-06** — the workspace shows the tenant and has its own Start over; New game resets on-prem only.
4. Management view + forms for MG / subscription / RG.
   **Done 2026-10-06** — refusals link to the Microsoft Learn page behind each rule (`src/cloud/ruleSources.js`).
5. Network view + forms for VNet / subnet / NSG / public IP / NIC / VM / disk / storage.
   **Done 2026-10-06** — shared form parts in `components/cloud/formParts.jsx`.
6. Cloud mission runtime + the three missions + their tests; cloud mission panel.
   **Done 2026-10-07** — owner asked to follow the real Azure workflow: every create is now Review + create, the VM
   wizard creates its own NIC/public IP (portal behaviour), the standalone NIC form has no public IP (N4). Each mission
   runs in its own customer tenant (made-up GUIDs, allowed by the owner); the sandbox is kept.
7. Cloud accuracy gate (spec §"Cloud accuracy gate"), browser check, brain update
   (STATUS, DECISIONS, GLOSSARY: cloud terms and outcomes).

## 7a. Done when

- Every rule in §2 has a passing test; every refusal asserts its exact outcome + rule ID.
- On-prem: the existing 861 tests pass unchanged; Missions and Sandbox behave as before.
- The three missions are completable in the browser, and each trap shows the right reason.
- Build clean (xterm chunk warning only); architecture test green with `src/cloud` present.
