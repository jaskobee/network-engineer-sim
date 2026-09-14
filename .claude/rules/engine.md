---
paths:
  - "src/models/**"
  - "src/engine/**"
---

# Rules: engine & models (`src/models`, `src/engine`)

You are editing the headless core — the asset of this project. Read
`.claude/brain/LESSONS.md` §Engine before starting.

1. **Zero React/DOM imports in `src/models/` or `src/engine/`.** Pure JS, testable in
   Node. If you need UI state, expose data and let a component read it.
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
   over accepting something fake. Consult `docs/NETWORKING_ACCURACY.md`.
6. **Interface IDs** are `"<devId>:<ifaceName>"` — split on the first `:` only.
7. **New reason codes** go into the table in `.claude/brain/GLOSSARY.md` and, if they
   replace a fallthrough, into `STATUS.md` "Next up".
8. **Before finishing**: run `/accuracy-gate` (Prompt 8 checklist + `npm test` +
   `npx vite build`).
