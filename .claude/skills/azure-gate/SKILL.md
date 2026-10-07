---
name: azure-gate
description: Run Cloud Engineer's Azure accuracy gate (docs/cloud/AZURE_ACCURACY.md "Cloud accuracy gate") plus tests and build on the current changes in apps/cloud. Use before finalizing ANY change to the Azure model, operations, refusal messages, forms, missions or hints in Cloud Engineer.
---

# Azure accuracy gate

Run this before declaring any Cloud Engineer change done. The NetSim twin is `/accuracy-gate`.

## 1. Collect the change
```bash
git -C "$(git rev-parse --show-toplevel)" diff -- apps/cloud/ packages/ docs/cloud/
git -C "$(git rev-parse --show-toplevel)" diff --cached -- apps/cloud/ packages/ docs/cloud/
```
If both are empty (and no commit range was given), report "nothing to gate" and stop.

## 2. Answer the spec's six questions for every changed behaviour
Write the answers out — don't just say "checked". The questions are the spec's own
(`docs/cloud/AZURE_ACCURACY.md`, "Cloud accuracy gate"):

1. **Is every rule this change relies on VERIFIED in the spec?** List the rule IDs. A TO-VERIFY or SOURCED
   rule is a stop: refuse the case as `not_modelled` and flag it to the owner.
2. **Would real Azure allow/deny this exact configuration**, and would real portal / `az` wording look like
   this? (Region display names, "Tenant root group", Microsoft's NSG default rule names, field names in the
   portal's order.)
3. **Does any flow succeed that real Azure would drop** (NSG, routes, peering, DNS)? Until Phase 2 nothing
   evaluates flows — make sure no text implies otherwise.
4. **Is the reserved-IP and CIDR math correct** for every subnet involved (five reserved addresses, /29–/2,
   network address required, blocked ranges)?
5. **Would a learner have to unlearn this** for AZ-104 / AZ-700 or a real job?
6. **Is every simplification labelled as one** (made-up GUIDs and IPs, fictional RBAC principals, the
   simulator's explanations vs Azure's wording, missing wizard steps)?

## 3. Check the wiring the rules depend on
- Every refusal is `refuse(OUTCOME.X, ruleId, message)`; every cited `ruleId` exists in
  `apps/cloud/src/azure/ruleSources.js` (its test fails otherwise).
- An ARM error code (`armCode`) appears only where the spec sources it.
- Each changed rule has a test asserting the exact `outcome` and `ruleId`; mission changes keep their
  end-to-end test (partial progress stays false, each trap refused for its rule).
- UI changes go through `apply(operation, args)` and Review + create — no rule logic in components.

## 4. Mechanical checks
```bash
npm test
npm run build
```
Only NetSim's xterm chunk-size warning is acceptable from the build.

## 5. Report
A short table: each question → PASS / FIXED (what) / FLAGGED (needs the owner's decision). A FLAGGED
row is the correct outcome when realism and gameplay conflict — never simplify silently. If a fact in
`.claude/brain/cloud/` changed (an outcome code, an operation, a count), run `/brain-update`. For UI
changes, follow with `/verify-in-browser` (`npm run dev:cloud`).
