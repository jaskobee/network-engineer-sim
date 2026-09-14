---
name: accuracy-gate
description: Run NetSim's standing networking-accuracy gate (NETWORKING_ACCURACY.md Prompt 8) plus tests and build on the current uncommitted changes. Use before finalizing ANY change touching networking behaviour, CLI commands, show output, hints, or mission validation.
---

# Accuracy gate

Run this before declaring any networking-related change done. It is the local twin of
the CI `ai-review.js` job.

## 1. Collect the change
```bash
git -C "$(git rev-parse --show-toplevel)" diff -- src/ docs/
git -C "$(git rev-parse --show-toplevel)" diff --cached -- src/ docs/
```
If both are empty, report "nothing to gate" and stop.

## 2. Self-check every hunk against the six questions
For each changed behaviour, answer explicitly (write the answers out — don't just say
"checked"):

1. **Real syntax?** Would this exact command, argument order, error string, and `show`
   output appear on real Cisco IOS (router/switch/firewall), real Linux iproute2
   (pc/server), or real Windows CMD (laptop)? IOS idioms must not leak into Linux and
   vice versa.
2. **Real forwarding?** Does any ping/flow now succeed along a path real hardware would
   drop — or fail where hardware would forward? Both forward AND return path count.
3. **L2/L3 kept on the right device?** No IPs on L2 switchports, no routing on the
   switch, SVI is management only, ROAS needs a trunk + `encapsulation dot1Q`.
4. **Subnet math holds?** Network / usable range / broadcast / gateway-in-subnet /
   contiguous mask / /31 and /32 handled for every address touched.
5. **Would a learner have to unlearn this** for CCNA / Network+ / a real job? If yes,
   change it or label it as a documented simplification (in-game note or code comment).
6. **Error messages realistic and mapped to the correct cause?** (`% Incomplete
   command.`, `Destination host unreachable`, `Request timed out`, `no route to host`,
   correct `failureReason`.)

Cross-check specifics against the relevant section of `docs/NETWORKING_ACCURACY.md`
(Prompts 1–7, DHCP, NAT, firewall, service matching) and the reason-code table in
`.claude/brain/GLOSSARY.md`.

## 3. Verify tests cover it
- Every changed behaviour has a Vitest assertion. Broken scenarios assert the exact
  `failureReason`.
- If a test was *changed* to make the code pass, justify why the old expectation was
  wrong per the spec — otherwise the code is wrong, not the test.

## 4. Run the mechanical checks
```bash
npm test
npx vite build
```
Only the xterm chunk-size warning is acceptable from the build.

## 5. Report
Output a short table: each gate question → PASS / FIXED (what) / FLAGGED (needs the
user's decision). Never silently simplify — a FLAGGED row is the correct outcome when
realism and gameplay conflict.

If anything in the change altered a fact recorded in `.claude/brain/` (a reason code,
a decision, a count), run `/brain-update`.
