# STATUS — where Cloud Engineer is right now

_Last refreshed: 2026-10-07 (platform split). Keep this describing **now**; remove finished items.
Repo-wide facts are in `../PLATFORM.md`._

## Health
- App: `apps/cloud` (working title **Cloud Engineer**, shipped as "Preview"). Azure only.
- `npm test` (root) → the cloud project: **118 tests / 8 files** (`apps/cloud/src/azure/__tests__`, incl. missions).
- `npm run dev:cloud` → port 5180, `http://localhost:5180/network-engineer-sim/cloud/`.
- Live on `main` since 2026-10-07 at https://jaskobee.github.io/network-engineer-sim/cloud/ (Preview).

## Built (roadmap Phase 1a, steps 1–6; plan `docs/cloud/PHASE_1A_CLOUD_SECTION.md`)
- **Headless Azure model** (`src/azure/`): plain serialisable tenant keyed by ARM-style IDs; pure operations in
  `operations.js` return `{ ok, state, id, warnings }` or a refusal `{ outcome, ruleId, message }`
  (`outcomes.js`); naming (§K), CIDR (`cidr.js`, on `@sim/kernel/ipUtils`), regions, catalog (disks, VM sizes and
  images, storage kinds, NSG protocols, service tags). Only VERIFIED rules of `docs/cloud/AZURE_ACCURACY.md` are
  enforced; anything unverified is refused as `not_modelled`. `ruleSources.js` maps every rule ID to its Microsoft
  Learn page.
- **Hierarchy**: tenant root group → management groups (create/rename/move/delete, depth limit, cycles) →
  subscriptions (move) → resource groups → resources; resource moves with the sourced ARM error
  `MissingMoveDependentResources`.
- **Network + compute + storage**: VNet, subnets (resize, overlap, reserved addresses, usable count), NSG with the
  exact default rules (stored and shown, **not evaluated yet** — Phase 2), public IP (Standard only), NIC, disk, VM,
  storage account (kind, redundancy, network access).
- **Portal workflow**: every create — resource groups included — is Review + create (`useReview` + `ReviewStep` in
  `formParts.jsx`: dry-run validation first; nothing deployed on failure);
  the VM wizard (Basics / Disks / Networking) creates `<vm>-nic` and optional `<vm>-ip` all-or-nothing
  (`deployVirtualMachine`); a standalone NIC can't take a public IP at create (N4).
- **UI** (`src/components/`): tabs Missions · Management (tree + forms) · Network (region → VNet → subnet → NIC
  diagram, "not inside a virtual network" for NSGs/disks/storage) · Overview (tenant facts, Start sandbox over).
  Refusals show the simulator's explanation, the rule ID and the Learn link. Microsoft Azure architecture icons
  (11 SVGs, `src/assets/azure-icons/NOTICE.md`), always with the service name next to them.
- **Missions** (`src/azure/missions/`): Landing zone basics · First workload · Storage for the app — each in its own
  customer tenant with made-up GUIDs; objectives are pure checks, progress derived; end-to-end tests assert partial
  progress doesn't count and each trap is refused for its exact rule.
- **State + save** (`src/state/CloudContext.jsx`, `src/azure/persistence.js`): slice `{ sandbox, mission,
  completedMissions }` saved under `cloudeng_save_v1` (kind `cloudeng-save`, `schemaVersion`, `domain: 'cloud'` per
  node); an unreadable save is kept under `cloudeng_save_v1_unreadable`.

**Phase 1a is complete** (2026-10-07): accuracy gate over all cloud code (every cited rule VERIFIED), all three
missions played through the UI in the browser.

## Next up
1. **Owner: flip the 2026-10-07 entries to VERIFIED** if they agree — spec C2 (API rule names, rule-name conflict),
   L10 (disk sizes), M4 portal flow. They were implemented on the owner's instruction and are marked SOURCED.
2. **Phase 1b:** RBAC (fictional users and groups), Azure Policy (effects still to choose — suggested Deny, Audit,
   Modify, Disabled), locks.
3. **Phase 2:** NSG/route evaluation as a flow engine (reason codes, Network Watcher-style tools), private
   endpoints + private DNS zones.

## Known gaps (refused as `not_modelled` or flagged in the spec, never guessed)
- TO-VERIFY in the spec: `RequestDisallowedByPolicy` on create (P5), RBAC limits (O8), J4 nesting wording, the
  VNet FAQ DHCP contradiction (A7).
- Plan §6a gaps, e.g. the public IP / NSG same-region rule.
- The VM wizard has no administrator-account step (username, password / SSH key); the form says so.
- Disk billing tiers (a 200 GiB Standard SSD billed as E15) aren't shown yet; sizes themselves follow L10.
