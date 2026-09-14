# GLOSSARY — names, codes and vocabulary

## Device types (`src/data/deviceCatalog.js`)
| type | CLI engine | Interfaces | Notes |
|---|---|---|---|
| `router` | `CLIEngine` (IOS) | `GigabitEthernet0/0`… (4) | $1200. Subinterfaces `Gig0/0.10` for ROAS. |
| `switch` | `CLIEngine` (IOS) | `FastEthernet0/1`… (8) | $800. Strictly L2. SVI = `interface vlan <id>`. |
| `pc` | `PCCLIEngine` (Linux) | `Ethernet0/0` → shown as `eth0` | $200. |
| `server` | `PCCLIEngine` (Linux) | 2 ports | $600. DHCP server role. |
| `firewall` | `CLIEngine` (IOS/ASA-ish) | Gig ports | Zones via `nameif`; also routes. |
| `phone` | — | — | VoIP phone device. |
| `isp` | — | 1 port | Pre-placed, free. `ISP_ENTRY` constant in devMode. |
| `laptop` | `WindowsCLIEngine` or `PCCLIEngine` by `os_type` | `Ethernet0/0` ↔ Windows `Ethernet0` | Admin laptop; pre-placed, free, excluded from refunds. |

## Interface IDs
Composite string `"<deviceId>:<ifaceName>"`, e.g. `"dev-1:GigabitEthernet0/0"`.
Split on the **first** `:` only. `normalizeIfName()` in `Device.js` expands
abbreviations (`gi0/0`, `fa0/1`). Linux shell maps `eth0` ↔ `Ethernet0/0`.

## `checkPing` result (`Topology.checkPing(srcIp, dstIp, service?)`)
```js
{ reachable, failureReason, failurePoint /* device id or iface id */ }
```
`service` defaults to `{ protocol: 'icmp', port: null }`; named services resolve
through the well-known port table (HTTP 80, HTTPS 443, SSH 22, DNS udp/53, FTP 21,
TELNET 23, RDP 3389, SMTP 25).

### `failureReason` codes
| Code | Meaning | Status |
|---|---|---|
| `no_route` | No matching route on a router (or generic fallthrough) | implemented |
| `admin_down` | Interface `shutdown` | implemented |
| `link_down` | Cable/peer down (down/down) | implemented |
| `no_return_path` | Request left, no route back | implemented |
| `host_no_gateway` | Host has no default route | implemented |
| `vlan_isolated` | Wrong VLAN / VLAN not carried on trunk / access-mode ROAS uplink | implemented |
| `nat_required` | RFC 1918 source egressing to ISP without translation | implemented |
| `blocked_by_firewall` | Dropped by zone policy (`failurePoint` = firewall id) | implemented |
| `subnet_mismatch` | Wrong mask → host mis-decides L2 vs L3 | **falls through to `no_route`** |
| `gateway_unreachable` | Gateway set but off-subnet / unreachable | **falls through** |
| `ip_conflict` | Duplicate IP | **falls through** |
| `duplex_mismatch` | Up/up but lossy | **falls through** |

## Mission DSL (`src/engine/missionEngine.js`)
A `MissionDefinition` has `deviceRoles` and `objectives`.

- **deviceRoles**: `{ roleName: { type, match: 'first'|'second'|'third'|<number>, label } }`
  — resolved by device type + insertion index. Roles are how objectives say "the router".
- **objective**: `{ id, label, hint, optional?, condition }`. `hint` is a string or an
  array mixing strings and `{ role, cmd }` objects (rendered as per-device command
  checklists in the UI).
- **condition types**:
  - `deviceExists { deviceType, count }`
  - `devicesPlaced { roles: [] }`
  - `cabled { roleA, roleB }` — direct physical link, either direction
  - `interfaceConfigured { role, ifaceName?, requires: ['ip','subnetMask','notAdminDown', …] }`
    — pass `ifaceName` whenever the device has more than one candidate interface
  - `sameSubnet { roleA, roleB }`
  - `pingSucceeded { roleA, roleB }` — reads `topology.pingLog` (a ping the player
    actually typed; tests simulate with `topology.logPing(src, dst)`)
  - `and | or | not { conditions }` / `{ condition }`
  - `custom { fn }` — escape hatch; prefer adding a new typed condition
- **runtime**: `getMissionRuntime(id)` → `{ tasks, optionalTasks, checkFn, diagnoseFn }`.
  `checkFn(devices, placements, topology)` → `{ [taskId]: boolean }`.

## Mission metadata fields
`id, clientId, title, client, avatar, description, difficulty, reward,
optionalObjectiveBonus, requiredReputation, requiredKnowledge[], estimatedDuration,
financialModel ('keep' | 'refund'), followUpMissionIds[], contractOutcome { type },
hardware[], blueprint { segments, links, svgViewBox, notes }, layout[], deviceRoles,
objectives`.

## Career layer
- **Client** — persistent entity (`CLIENT_TEMPLATES` → `createClientInstance()`), owns a
  topology across missions (`clientTopologies` in GameContext), can hold a contract.
- **Contract** — recurring income (`CONTRACT_TYPES['monthly-support']`, $500/mo).
- **Service ticket** — small point-fault job on a contracted client's existing gear
  (`fault: { type: 'disconnect' | …, role }`), resolved through the same DSL.
- **Reputation tiers** — Junior 0 / Freelance 100 / Established 300 / Senior 700 /
  Enterprise 1500. Missions gate on the number, not the label.
- **SLA clock** — `NEW_TICKET_INTERVAL_MS 5m`, `SLA_DURATION_MS 8m`, warning at 60 %,
  `TICKET_GRACE_MS 6m`, dormant after 2 consecutive expiries.

## Dev mode
- **Preset** — `PRESETS[]` metadata (`id, label, category: 'working'|'broken',
  expectedFailure?, description, pingCheck { src, dst, service?, kind? }`) plus a builder
  in `buildPreset()`'s `builders` map. Builder ctx: `{ addSandboxDevice, sbTopology,
  sbEngine, sbPcEngine, sbConnectInterfaces, setMode, clearSandbox }`.
- **Smoke test** — `src/devMode/smokeTests.js`, programmatic twin of
  `docs/foundation-smoke-test.md`.

## Realistic CLI output strings (use these, not invented ones)
IOS: `% Invalid input detected at '^' marker.`, `% Incomplete command.`,
ping chars `!` reply / `.` timeout / `U` unreachable.
Linux: `Destination Host Unreachable`, `Destination Net Unreachable`,
`connect: Network is unreachable`, `Request timed out`.
