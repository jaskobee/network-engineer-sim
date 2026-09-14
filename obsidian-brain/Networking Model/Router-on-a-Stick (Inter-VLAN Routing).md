---
tags: [networking, vlan, roas, routing]
---

# Router-on-a-Stick (Inter-VLAN Routing)

Each VLAN is its own broadcast domain and normally maps to its own subnet. Hosts in
different VLANs **cannot** talk without a Layer 3 device routing between them — see
[[Layer 2 Switching and VLANs]] for why the switch itself will never be that device
in NetSim's current model.

## The router-on-a-stick (ROAS) pattern, exactly as CCNA teaches it

- The router's **physical** interface stays unaddressed. IPs go on **subinterfaces**
  (e.g. `Gig0/0.10`) — one subinterface per VLAN.
- Each subinterface needs `encapsulation dot1Q <vlan-id>` configured **before**
  `ip address` — the engine models this ordering dependency.
- The subinterface IP is the **default gateway** for that VLAN's hosts.
- The single physical link between the router and switch **must be a trunk**
  (`switchport mode trunk` on the switch side, carrying all routed VLANs). An access
  port cannot do router-on-a-stick — if it's access-mode, only that one VLAN's
  untagged traffic reaches the router and every other VLAN gets `vlan_isolated`. This
  exact scenario is the canonical broken dev-mode preset, `roas-access-broken` (see
  [[Dev Mode and QA]]).
- Hosts must have a default gateway set and **in their own subnet**, or off-subnet
  pings fail (`host_no_gateway` if unset, `gateway_unreachable` if set but wrong —
  see [[Failure Reason Codes]]).
- The native VLAN on a trunk is untagged; a native-VLAN mismatch between the two
  trunk ends is a real, distinct misconfiguration (see
  [[Layer 2 Switching and VLANs]] and [[Fault Injection System (Act 2)]] fault H).

## Where this is taught in-game

[[Mission Catalog]] — `mission_004` ("TechNova Startup HQ") is the canonical ROAS
mission: four VLANs (Engineering 10, Guest 20, Servers 30, VoIP 40) on one switch,
one router doing ROAS + per-VLAN DHCP pools + NAT out to the ISP. `mission_005`
("Secure the Office") builds directly on top of it, inserting a firewall between the
router and the ISP without disturbing the ROAS config underneath.

## Subinterface model in code

`src/models/Device.js` — `createSubinterface(name, parentName)` — each subinterface
tracks its own `vlanTag` (set by `encapsulation dot1Q`), `native` flag, `ip`,
`subnet_mask`, and an individually-shuttable `sub_shutdown`. Its **effective**
`status` is derived, not set directly — `refreshSubifs()` recomputes it from the
parent physical interface's real link state (a subinterface can never be up if its
parent physical port is down). Subinterfaces share the parent's physical cable —
`connected_to` is always `null` on a subinterface itself.

`getParentIfName(name)` extracts `"GigabitEthernet0/0"` from `"GigabitEthernet0/0.10"`
(or the abbreviated `"Gi0/0.20"`).

## Alternative not currently built

An L3/multilayer switch (`ip routing` + SVIs as gateways) is a documented future
option in [[Decisions Log]], but does not exist yet — the plain switch stays strictly
L2 until that device type is deliberately added as a *new*, separate type.

## Related

[[Layer 2 Switching and VLANs]] · [[Routing and Static Routes]] ·
[[IP Addressing and Subnetting]] · [[Failure Reason Codes]]
