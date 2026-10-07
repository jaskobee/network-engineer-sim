# LESSONS — Cloud Engineer, things that cost time once

Add an entry only when the code/tests don't already make it obvious. Format: **symptom → cause → rule**.
Shared lessons (React, Playwright, shell) are in `../netsim/LESSONS.md`.

## Model / spec
- **A refusal message shows `northeurope`** → messages used the internal region name → always format with
  `regionDisplayName()` (players see "North Europe", as in the portal).
- **A new rule ID has no Learn link** (M2, N4 were missing once) → `ruleSources.test.js` fails → add every rule an
  operation cites to `ruleSources.js` in the same change.

## UI
- **A table inside a scroll wrapper vanished from a flex-column panel** → a flex item whose `overflow` isn't
  `visible` gets `min-height: 0` and can shrink to nothing → give such wrappers `flex-shrink: 0` (`.nv-table-wrap`).
- **The refusal scrolled out of view under a long form** → make `.mv-right > .op-result` sticky.
- **A picker showed one value and submitted another** (NIC/RG selects) → derive a fallback from the current options
  instead of keeping stale state (`pickOrFirst`).
- **Playwright: "Public IP" matched both a field label and a select option** → `getByText(text, { exact: true })`
  inside the form; the company-name/onboarding modal only exists in NetSim, not here.
