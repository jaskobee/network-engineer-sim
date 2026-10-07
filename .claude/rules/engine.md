---
paths:
  - "apps/netsim/src/core/**"
  - "apps/netsim/src/guest/**"
  - "apps/netsim/src/onprem/**"
  - "apps/netsim/src/engine/**"
---

# Rules: NetSim engine & planes (`apps/netsim/src/core`, `guest`, `onprem`, `engine`)

You are editing NetSim's headless core — the asset of this product. Read
`.claude/brain/netsim/LESSONS.md` §Engine before starting.

1. **Zero React/DOM imports in `apps/netsim/src/core/`, `guest/`, `onprem/` or `engine/`.**
   Pure JS, testable in Node. If you need UI state, expose data and let a component read it.
   **Import boundaries** (`apps/netsim/src/core/__tests__/architecture.test.js`): `core` imports only
   `core`; `onprem` never imports `guest`; shared IPv4 math and the save format come from
   `@sim/kernel`, never from Cloud Engineer's code (`tests/boundaries.test.js`); a new `guest` → `onprem` import is a
   design decision (add it to the test's known-couplings list with a reason), never a test fix.
2. **Every behaviour change ships with a test** in the sibling `__tests__/` dir.
   Broken scenarios assert the exact `failureReason` (and `failurePoint` where
   meaningful), never just `reachable === false`.
3. **Do not add fault-specific branches to `checkPing`/`_bfsReach`.** A fault is real
   misconfigured state; the symptom must emerge from correct modelling.
4. **L2/L3 contract is fixed** (top-of-file comment in `CLIEngine.js`): switch has no
   per-port IPs, no `ip route`, no `no switchport`; SVI is management only.
5. **CLI fidelity**: any new command, argument form, error string or `show` output must
   be something real IOS / iproute2 / Windows CMD would produce. When unsure, prefer
   rejecting the command with the real error (`% Invalid input detected at '^' marker.`)
   over accepting something fake. Consult `docs/netsim/NETWORKING_ACCURACY.md`.
6. **Interface IDs** are `"<devId>:<ifaceName>"` — split on the first `:` only.
7. **New reason codes** are registered in `apps/netsim/src/core/failureReasons.js` (emit them as
   `REASON.X`, never a string literal), go into the table in `.claude/brain/netsim/GLOSSARY.md`
   and, if they replace a fallthrough, into `STATUS.md` "Next up". Never rename an emitted code.
8. **Before finishing**: run `/accuracy-gate` (Prompt 8 checklist + `npm test` +
   `npm run build`).
