# Phase 0 — Kernel Extraction (Claude Code prompt)

**Goal:** prepare the codebase for cloud and hybrid tracks with **zero behavior
change**. This is a pure refactor. No cloud features, no new networking behavior.

Read first: `CLAUDE.md`, `docs/HYBRID_PLATFORM_ROADMAP.md` (§3, §4),
`docs/NETWORKING_ACCURACY.md`.

---

## Prompt

```
Implement Phase 0 of docs/HYBRID_PLATFORM_ROADMAP.md: kernel extraction.
Follow CLAUDE.md's hard rules. This is a refactor with ZERO behavior change.

PLAN FIRST: list every file you will move/create/modify and the order you'll do it
in. Wait for my approval before changing code.

Before touching anything, run `npm test` and record the exact number of passing
tests. That number is the baseline.

1. FOLDER BOUNDARIES
   Reorganize src/models into:
     src/core/    ipUtils, failure-reason registry, PathResult contract (typedef/JSDoc),
                  save-format helpers
     src/guest/   the Linux shell engine (currently PCCLIEngine) — it will later be
                  shared by on-prem PCs/servers and cloud VMs
     src/onprem/  Device, Topology, CLIEngine (IOS), DHCPEngine
   Update all imports, including tests. Keep file contents identical apart from
   import paths unless a step below says otherwise.

2. ARCHITECTURE TEST
   Add a Vitest test that scans the import statements in src/ and fails if:
     - anything in src/core imports from src/onprem, src/cloud, src/hybrid or src/guest
     - src/onprem imports from src/cloud (and vice versa, once it exists)
     - only src/hybrid may import from both onprem and cloud
   (Plain file scan + regex is fine — no new dependencies.)

3. FAILURE-REASON REGISTRY
   Create src/core/failureReasons.js: one frozen object listing every failureReason
   string the engine emits today (no_route, admin_down, link_down, no_return_path,
   host_no_gateway, subnet_mismatch, vlan_isolated, nat_required,
   blocked_by_firewall — verify the full list by searching the code; do not trust
   this list blindly). Each entry: { code, domain: 'onprem', description }.
   Replace string literals in the engine with registry references. The emitted
   VALUES must stay byte-identical — tests assert on them.
   Add a test: every failureReason any existing test expects exists in the registry.

4. PATHRESULT CONTRACT
   Document the existing checkPing result object as the PathResult contract in
   src/core (JSDoc typedef). Do NOT add a hops[] field or any new data yet — that is a
   Phase 2 decision. Only document what exists today.

5. SAVE FORMAT / DOMAIN FIELD
   Add `domain: 'onprem'` to every device and `schemaVersion: 1` to whatever
   serializes topology state (export/import JSON or dev-mode export, if present).
   Import must accept files without these fields (default domain 'onprem',
   schemaVersion 1) so nothing existing breaks. Add tests for both cases.

6. DOCS
   Apply the "Proposed CLAUDE.md addition" from HYBRID_PLATFORM_ROADMAP.md §7, update
   the file map in CLAUDE.md to the new folders, and fix the known drift: NAT is
   implemented, subnet_mismatch is emitted, add nat_required and blocked_by_firewall
   to the failureReason list.

CONSTRAINTS
- No networking behavior changes. If you find a bug, STOP and report it — do not fix
  it in this phase.
- No new runtime dependencies.
- Missions 001–003 and Sandbox must behave exactly as before.

DONE WHEN
- npm test passes with baseline count + the new tests, and zero previously-passing
  tests changed their assertions (only import paths)
- npx vite build is clean (only the known xterm chunk warning)
- Architecture test passes
- You've listed which files moved where, for my review
```

---

## Manual checks after Claude Code finishes

- [ ] Test count = baseline + new tests; no assertion edits in old tests (`git diff` on test files shows only import lines)
- [ ] Mission 001 playable end to end
- [ ] Foundation Smoke Test T3 (one-way route fails, then works) and T4 (ROAS) still behave identically
- [ ] Export a topology, re-import it → identical
- [ ] Import an old-format topology (no `domain`/`schemaVersion`) → loads fine
