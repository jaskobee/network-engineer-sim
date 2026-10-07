---
paths:
  - "packages/**"
  - "tests/**"
---

# Rules: shared packages (`packages/kernel`, `packages/ui`) and repo tests

A change here ships in **both** products.

1. **Domain-free.** `@sim/kernel` imports nothing; `@sim/ui` imports only React, bcryptjs and itself. No
   device, topology, Azure resource or mission concept belongs here (`tests/boundaries.test.js` B2).
2. **Move code here only when both products need it** — not in anticipation. Product rules stay in the
   product even if they look similar (Azure's five reserved addresses live in `apps/cloud`, not in kernel).
3. **Imported by name** (`@sim/kernel/ipUtils.js`); each consumer declares the package in its
   `package.json` (B3, B4). Plain source, no build step.
4. **Changing a token or primitive in `base.css` restyles both products** — check both in the browser.
5. **Kernel behaviour is locked in by its tests** (`packages/kernel/__tests__`); NetSim's subnet lessons and
   Cloud Engineer's CIDR rules both depend on it.
6. **Boundary tests are design decisions**: loosen `tests/boundaries.test.js` only with the owner's go-ahead
   (e.g. when `packages/hybrid` arrives).
