---
tags: [reference, glossary]
---

# Glossary

Every code, id format, and vocabulary term used across the codebase and this vault,
in one place. Canonical source: `.claude/brain/GLOSSARY.md` (kept in sync with this
note as a manual duplication — if they ever disagree, the `.claude/brain` copy is the
one Claude Code actually loads every session).

## Device types (`src/data/deviceCatalog.js`)

| Type | CLI engine | Interfaces | Notes |
|---|---|---|---|
| `router` | `CLIEngine` (IOS) | `GigabitEthernet0/0`… (4) | $1200. Subinterfaces `Gig0/0.10` for ROAS. |
| `switch` | `CLIEngine` (IOS) | `FastEthernet0/1`… (8) | $800. Strictly L2. SVI = `interface vlan <id>`. |
| `pc` | `PCCLIEngine` (Linux) | `Ethernet0/0` → shown as `eth0` | $200. |
| `server` | `PCCLIEngine` (Linux) | 2 ports | $600. DHCP server role. |
| `firewall` | `CLIEngine` (IOS/ASA-inspired) | Gig ports | Zones via `nameif`; also routes. $1500. |
| `phone` | `PCCLIEngine` (Linux) | 1 port | VoIP endpoint, DHCP host. Modeled as a plain single-port access-VLAN host — real IP phones have a built-in 2-port switch and a tagged voice VLAN; documented simplification. |
| `isp` | — | 1 port | Pre-placed, free, excluded from refunds. |
| `laptop` | `WindowsCLIEngine` or `PCCLIEngine` by `os_type` | `Ethernet0/0` ↔ Windows `Ethernet0` | Admin laptop; pre-placed, free, excluded from refunds. See [[Admin Laptop and Tools]]. |

## Interface IDs

Composite string `"<deviceId>:<ifaceName>"`, e.g. `"dev-1:GigabitEthernet0/0"`. Split
on the **first** `:` only. `normalizeIfName()` in `Device.js` expands abbreviations
(`gi0/0`, `fa0/1`). The Linux shell maps `eth0` ↔ `Ethernet0/0`.

## `checkPing` result

```js
{ reachable, failureReason, failurePoint /* device id or iface id */ }
```

`service` param defaults to `{ protocol: 'icmp', port: null }`; named services
resolve through the well-known port table (HTTP 80, HTTPS 443, SSH 22, DNS udp/53,
FTP 21, TELNET 23, RDP 3389, SMTP 25). Full detail:
[[Ping Reachability Engine (checkPing)|checkPing]].

## `failureReason` codes

See [[Failure Reason Codes]] for the complete,
annotated table (implemented vs. specified-but-falling-through).

## Mission DSL vocabulary

See [[Mission DSL]] for the full breakdown of
`deviceRoles`, `objectives`, condition types, and `getMissionRuntime(id)`.

## Mission metadata fields

`id, clientId, title, client, avatar, description, difficulty, reward,
optionalObjectiveBonus, requiredReputation, requiredKnowledge[], estimatedDuration,
financialModel ('keep' | 'refund'), followUpMissionIds[], contractOutcome { type },
hardware[], blueprint { segments, links, svgViewBox, notes }, layout[], deviceRoles,
objectives`.

## Career layer terms

- **Client** — persistent entity (`CLIENT_TEMPLATES` → `createClientInstance()`),
  owns a topology across missions (`clientTopologies` in `GameContext`), can hold a
  contract.
- **Contract** — recurring income (`CONTRACT_TYPES['monthly-support']`, $500/mo).
- **Service ticket** — a small point-fault job on a contracted client's existing
  gear (`fault: { type: 'disconnect' | 'clearIp' | …, role }`), resolved through the
  same objective DSL as a mission.
- **Reputation tiers** — Junior 0 / Freelance 100 / Established 300 / Senior 700 /
  Enterprise 1500. Missions gate on the number, not the label.
- **SLA clock** — `NEW_TICKET_INTERVAL_MS` 5 min, `SLA_DURATION_MS` 8 min, warning at
  60%, `TICKET_GRACE_MS` 6 min, dormant after 2 consecutive expiries.

Full detail: [[Career Layer]].

## Dev mode terms

- **Preset** — `PRESETS[]` metadata (`id, label, category: 'working'|'broken',
  expectedFailure?, description, pingCheck { src, dst, service?, kind? }`) plus a
  builder in `buildPreset()`'s `builders` map. Builder ctx: `{ addSandboxDevice,
  sbTopology, sbEngine, sbPcEngine, sbConnectInterfaces, setMode, clearSandbox }`.
- **Smoke test** — `src/devMode/smokeTests.js`, the programmatic twin of
  `docs/foundation-smoke-test.md`.

Full detail: [[Dev Mode and QA]].

## Realistic CLI output strings (reuse verbatim, never invent new ones)

- IOS: `% Invalid input detected at '^' marker.`, `% Incomplete command.`; ping
  characters `!` reply / `.` timeout / `U` unreachable.
- Linux: `Destination Host Unreachable`, `Destination Net Unreachable`,
  `connect: Network is unreachable`, `Request timed out`.

## Related

[[Home]] · [[Failure Reason Codes]] ·
[[Mission DSL]]
