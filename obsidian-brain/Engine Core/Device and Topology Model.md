---
tags: [engine, model]
---

# Device and Topology Model

The two foundational classes in `src/models/` that every CLI engine, every mission
condition, and every UI component ultimately reads or mutates.

## `Device` (`src/models/Device.js`)

A plain-data class (no framework dependency) representing one piece of hardware.
Key fields:

- `id`, `type` (`router`/`switch`/`pc`/`server`/`firewall`/`phone`/`isp`/`laptop`),
  `model`, `hostname`, `powered`
- `config_mode` — drives the CLI prompt shape (`user_exec` → `priv_exec` →
  `global_config` → `interface_config` / `subif_config` / `vlan_config` /
  `dhcp_pool_config`). See [[The Three CLI Engines]].
- `interfaces[]` — see below
- `routing_table[]`, `vlan_db`, `active_vlan`, `dns_server`
- Router-only: `dhcp_pools`, `dhcp_excluded`, `dhcp_bindings` (see [[DHCP]])
- Router/firewall: `nat_acls`, `nat_rules`, `nat_translations` (see [[NAT and PAT]])
- Firewall-only: `fw_zones`, `fw_rules`, `fw_sessions`, `fw_security_levels`, `fw_log`
  (see [[Stateful Firewall]])

### Interfaces

`createInterface(name)` →
```js
{
  name, description: null,
  ip: null, subnet_mask: null,
  status: 'admin_down',          // 'up' | 'down' | 'admin_down' — see Interface States note
  connected_to: null,             // composite "devId:ifName" of the remote end, or null
  vlan: null,
  helper_addresses: [],           // ip helper-address list, router interfaces only
  dhcp_assigned: false,
  nat_inside: false, nat_outside: false,
}
```

**Interface IDs** are the composite string `"<deviceId>:<ifaceName>"`, split on the
**first** `:` only, everywhere in the codebase.

### Subinterfaces (router-on-a-stick)

`createSubinterface(name, parentName)` — see
[[Router-on-a-Stick (Inter-VLAN Routing)|Router-on-a-Stick]] for
the full model: `vlanTag`, `native`, individually-shuttable `sub_shutdown`, and a
derived (never directly set) `status` recomputed by `refreshSubifs()` from the parent
physical interface's real link state.

### Interface name normalization

`normalizeIfName(name)` expands Cisco abbreviations to canonical form:
`gi0/0`/`gig0/0`/`g0/0` → `GigabitEthernet0/0`; `fa0/1`/`f0/1` → `FastEthernet0/1`;
`eth0`/`e0` → `Ethernet0`; `lo0` → `Loopback0`; `vlan1`/`vlan 1` → `Vlan1`. Longest
prefix match first, so `gi` doesn't get shadowed by a naive `g` match.

## `Topology` (`src/models/Topology.js`)

Owns the whole device graph for one game session (or one client's persistent
network — see [[Career Layer]]).

- `devices` — `Map<deviceId, Device>`
- `pingLog` — `Set<"srcIp:dstIp">` of pings the player **actually typed** in a
  terminal (mission conditions like `pingSucceeded` read this, never call
  `checkPing` themselves — see [[Mission DSL]])
- `packetCapture[]` — a rolling (max 2000-entry) trace of recorded ping outcomes;
  see [[Ping Reachability Engine (checkPing)|checkPing]] for how
  this is populated and its "never synthesize, only record what happened" rule
- Key methods: `addDevice`/`removeDevice`, `connect`/`disconnect` (wire two
  interfaces' `connected_to` to each other), `checkPing(srcIp, dstIp, service?)`
  (see [[Ping Reachability Engine (checkPing)|checkPing]]),
  `findPath()`, `recordCapture()`, `clearDevices()`

## Save/load reconstruction

`deviceFromSave(raw)` rebuilds a `Device` from a JSON snapshot **without** calling
the constructor (`Object.create(Device.prototype)` + `Object.assign`) — necessary
because the constructor has side effects (id counter allocation) that a restore must
not repeat. Notice it back-fills fields that may be missing from an older save
(`helper_addresses: []`, `dhcp_assigned: false` defaults spread first, then the raw
data overrides) — this is the established pattern for adding a new field to `Device`
without a save-format version bump: give it a safe default in the reconstruction
spread, and old saves silently gain the new field's default on next load. The
[[Admin Laptop and Tools|Admin Laptop dashboard]]'s `completedAt` timestamp and the
[[Career Layer]]'s `ticketHistory` array were both added this exact way.

## Related

[[The Three CLI Engines]] · [[Ping Reachability Engine (checkPing)|checkPing]] ·
[[Mission DSL]]
