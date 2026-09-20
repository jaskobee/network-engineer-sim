---
name: cli-command
description: Add or change a CLI command, argument form, error message, or `show` output in one of NetSim's three CLI engines (IOS CLIEngine, Linux PCCLIEngine, Windows WindowsCLIEngine) with real-gear fidelity and tests. Use whenever a terminal command needs to be added, fixed, or its output adjusted.
---

# CLI command (IOS / Linux / Windows)

Every command is a lesson in muscle memory. The player must be able to take what they
typed here and type it on real gear.

## 1. Identify the engine and the mode
| Device | Engine | Modes |
|---|---|---|
| router, switch, firewall | `src/models/CLIEngine.js` | `user_exec → priv_exec → global_config → interface_config` (+ subinterface, vlan, dhcp-pool contexts as implemented) |
| pc, server, laptop (`os_type` linux) | `src/models/PCCLIEngine.js` | single shell |
| laptop (`os_type === 'windows'`) | `src/models/WindowsCLIEngine.js` | single `C:\Users\…>` prompt |

Find the dispatch point (`execute()` → tokenizer → per-mode handlers) and the nearest
similar command; match its structure.

## 2. Establish ground truth BEFORE writing code
Write down, from real-device knowledge (and `docs/NETWORKING_ACCURACY.md` where it
covers the topic):
- Exact syntax including abbreviations IOS accepts (`sh ip int br`, `conf t`, `int
  gi0/0`) — use `normalizeIfName()` for interface tokens.
- Which mode it is valid in, and what happens in the wrong mode (`% Invalid input
  detected at '^' marker.`) or with missing args (`% Incomplete command.`).
- Device-type restrictions: e.g. `ip address` on a switch physical port is rejected;
  `ip route` on a switch is rejected; firewall-only commands (`nameif`,
  `firewall-rule`) are rejected elsewhere.
- Exact output format for `show` commands — column headers, spacing, state words
  (`up`/`down`/`administratively down`), `C`/`L`/`S`/`S*` route codes, Linux `ip addr`
  layout, Windows `ipconfig` layout. Prefer real captures from memory over invention.
- Linux vs IOS vs Windows idioms must not cross.

If real behaviour can't be modelled faithfully, prefer **rejecting** the command with
the real error over accepting a fake version. If a simplification is unavoidable, add
a code comment starting `// SIMPLIFICATION:` explaining what real gear does.

## 3. Implement
- Mutate `Device`/interface/topology fields in place (mutation + tick pattern).
- Return output as the engine's existing line-array convention.
- If the command affects forwarding (routes, VLANs, trunking, NAT, firewall, DHCP),
  make sure `Topology` reads the new state — don't add special cases to `checkPing`.
- If it's a `show`, it must reflect *live* state including what other engines/GUI set.
- Update `show running-config` if the command creates persistent config.

## 4. Test in the matching `src/models/__tests__/*.test.js`
- Happy path (correct mode, correct args) — assert state and output.
- Wrong mode → exact IOS error.
- Missing/invalid args → exact error.
- Wrong device type → rejected.
- Abbreviated form accepted where IOS accepts it.
- If forwarding changed: a `checkPing` assertion with the exact `failureReason`
  before/after.

## 5. Finish
`npm test`, `npx vite build`, then `/accuracy-gate`. If you added a documented
simplification or a new reason code, `/brain-update` (GLOSSARY / DECISIONS).
