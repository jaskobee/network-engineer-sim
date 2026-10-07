---
paths:
  - "apps/cloud/**"
---

# Rules: Cloud Engineer (`apps/cloud`)

Read `apps/cloud/CLAUDE.md` (hard rules) and `.claude/brain/cloud/LESSONS.md` before starting.

1. **Only VERIFIED rules** from `docs/cloud/AZURE_ACCURACY.md`. TO-VERIFY / SOURCED → stop and flag to the
   owner. An uncovered case is refused as `OUTCOME.NOT_MODELLED`, never guessed.
2. **State changes only through `src/azure/operations.js`.** Each operation is pure: `(state, args)` →
   `{ ok, state, … }` or `refuse(OUTCOME.X, ruleId, message)`. Components call `apply(operation, args)` from
   `useCloud()`; they never edit tenant objects or re-implement a rule (no CIDR math in JSX — read it from
   `src/azure/cidr.js`).
3. **Every rule an operation cites** has an entry in `src/azure/ruleSources.js` and a test asserting the
   exact outcome and rule ID. A real ARM error code (`armCode`) only where the spec sources it.
4. **Portal workflow**: a create goes through Review + create (`CreatePanel`), which dry-runs the same
   operation; a wizard that creates several resources is one operation that refuses all-or-nothing.
5. **Player-facing text**: portal names for things (region display names via `regionDisplayName`,
   "Tenant root group", Microsoft's default NSG rule names); the simulator's own explanations are labelled
   as such; made-up values (GUIDs, `198.51.100.x`) are said to be made up.
6. **Missions**: objectives are pure checks over the mission tenant; `setup()` builds the tenant through
   real operations; an end-to-end test drives the operations and asserts partial progress stays false and
   each trap is refused for its rule.
7. **Headless model**: `src/azure/` imports no React, `.jsx` or CSS (`tests/boundaries.test.js` B5).
8. **Styles** go in `src/cloud.css` with the existing prefixes (`cloud-`, `mv-`, `nv-`, `op-`, `az-`, `cm-`);
   shared primitives (`.btn`, `.seg`, `.led`, tokens) come from `@sim/ui/base.css` — reuse, don't fork.
9. **Before finishing**: `/azure-gate`, then `/verify-in-browser` for UI changes.
