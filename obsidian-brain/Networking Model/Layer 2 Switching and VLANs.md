---
tags: [networking, l2, switching, vlan]
---

# Layer 2 Switching and VLANs

The single highest-priority correctness rule in the whole project (see
`docs/NETWORKING_ACCURACY.md` Prompt 1). Modeled on a Cisco Catalyst 2960: a **strictly
Layer 2** access switch.

## The contract (verbatim from the top of `src/models/CLIEngine.js`)

```
SWITCH (type: 'switch') — strictly Layer 2 (Catalyst 2960 model)
  Physical switchports (FastEthernet0/x) are Layer 2 ONLY.
  • `ip address` on a physical port → rejected (% Invalid input detected)
  • `no switchport` → rejected (not a routed-port switch)
  • `ip route` → rejected (no routing table on L2 switch)
  Management IP lives on an SVI: `interface vlan <id>` → `ip address ...`
  The SVI IP is for managing the switch only; it does NOT route host traffic.
  L2 forwarding floods frames out all up ports in the same VLAN.
```

## What this means concretely

- **No per-port IPs.** A physical switchport carries no IP address, ever. Only
  `switchport mode access`, `switchport access vlan <id>`, `switchport mode trunk`,
  `switchport trunk allowed vlan …` are valid config for a physical port.
- **One management IP, on an SVI.** `interface vlan <id>` → `ip address <ip> <mask>`
  → `no shutdown`. The default SVI is VLAN 1, but VLAN 1 for management is flagged as
  a known bad practice in tutorial text — a dedicated management VLAN is preferred.
- **A switch never routes.** No `ip routing`, no routing table. A ping cannot cross
  VLANs just because the switch happens to have an SVI in each — that's not how real
  L2 hardware works and the engine never allows it. Inter-VLAN routing requires a
  separate L3 device: see [[Router-on-a-Stick (Inter-VLAN Routing)]].
- **Frames stay within their VLAN.** Access ports belong to exactly one VLAN,
  untagged. Trunk ports carry multiple VLANs, 802.1Q-tagged, with one untagged
  *native* VLAN. `show mac address-table` and `show vlan brief` output stays
  consistent with actual port/VLAN config.
- **A native VLAN mismatch between two trunk ends** is a real, modelable misconfig
  (see [[Fault Injection System (Act 2)]] fault H) — traffic lands in the wrong VLAN,
  and real IOS emits `%CDP-4-NATIVE_VLAN_MISMATCH`.

## If a future "Layer 3 Switch" device type is ever added

It must be a **separate device type** with `ip routing` enabled, routed ports
(`no switchport`), and SVIs that act as VLAN gateways — the plain `switch` stays
strictly L2 forever. This is a locked decision (see [[Decisions Log]]), not an
open question.

## Where this lives in code

- Device type: `switch` in `src/data/deviceCatalog.js` — Catalyst 2960, 8 ports,
  `FastEthernet0/1`–`0/8` (1-indexed, no `Fa0/0` — a real 2960 quirk).
- Enforcement: `src/models/CLIEngine.js` (command dispatch — rejects `ip address` /
  `no switchport` / `ip route` on switch physical ports) and `src/models/Topology.js`
  (the BFS reachability walk, which enforces VLAN boundaries when forwarding).
- `failureReason: 'vlan_isolated'` is what a ping returns when it's blocked by a VLAN
  boundary — see [[Failure Reason Codes]].

## Related

[[Router-on-a-Stick (Inter-VLAN Routing)]] · [[Ping Reachability Engine (checkPing)]] ·
[[Interface States and Cabling]] · [[Failure Reason Codes]]
