---
tags: [missions, catalog]
---

# Mission Catalog

Everything a player can currently do, mission by mission. See
[[Mission DSL]] for the underlying system and [[Career Layer]] for how the
client-based missions fit into the persistent business layer.

## The legacy five (`src/data/missions.js` + `src/data/missionTasks.js`)

One linear track, gated by `prerequisite`, no persistent client entity, hardware
always refunded on completion (`financialModel` doesn't exist on these — they behave
as `'refund'`). Each teaches a specific, escalating lesson:

| ID | Client | Reward | Teaches |
|---|---|---|---|
| `mission_001` | Mrs. Chen (home) | $800 | router+PC cabling, LAN IPs, `no shutdown`, `ping` |
| `mission_002` | Brew & Code Café | $1500 | switch LAN expansion, multi-host IP planning |
| `mission_003` | Dr. Patel's Clinic | $2800 | two isolated subnets over a /30 WAN link, static routes **on both routers** (the return-path lesson — see [[Routing and Static Routes]]) |
| `mission_004` | TechNova Startup HQ | $5500 | 4 VLANs on one switch, router-on-a-stick, per-VLAN DHCP, static server addressing, ISP handoff + default route, NAT/PAT overload — see [[Router-on-a-Stick (Inter-VLAN Routing)|ROAS]], [[DHCP]], [[NAT and PAT|NAT/PAT]] |
| `mission_005` | TechNova Inc. (follow-up) | $8000 | perimeter firewall insertion, 3-zone policy (INSIDE/OUTSIDE/DMZ), stateful inspection, default-deny, service-specific rules, first-match rule ordering, DMZ redesign, NAT moved to the firewall — see [[Stateful Firewall]] |

`mission_004`'s brief explicitly notes VLAN 30 (Servers) is *not yet* isolated —
without a firewall, all VLANs route freely through the router. `mission_005` is the
payoff: it doesn't just add a firewall, it re-teaches the player that a "DMZ" isn't
real until something actually enforces the boundary.

## The declarative client track (`src/data/missionDefinitions/`)

Distinct from the legacy five: these missions belong to a **persistent `Client`**
entity (see [[Career Layer]]) whose topology survives between jobs — hardware bought
in job 1 is still standing, still working, in job 2.

- **`mission_local_shop_1`** — "Sam's Corner Store: Getting Online." First job for
  `client_local_shop`. One router, one switch, three PCs, one flat `10.0.10.0/24`
  LAN. `financialModel: 'keep'` (hardware persists — no refund on completion).
  `contractOutcome: { type: 'monthly-support' }` — completing it starts the client's
  ongoing $500/mo contract (see [[Career Layer]]). Unlocks `mission_local_shop_2` via
  `followUpMissionIds`. Reward $750 + $150 optional bonus for proving switch
  forwarding (PC-1 pings PC-2 directly, no router involved).
- **`mission_local_shop_2`** — "Sam's Corner Store: Hiring Help." Follow-up job on
  the *same* topology — adds a 4th PC and a statically-addressed POS server onto the
  existing switch. Nothing about the router/switch/first-3-PCs changes; this is the
  concrete, playable proof that persistent-client infrastructure actually persists.
  Reward $400 + $100 optional bonus.

## Service tickets — not full missions, but use the same DSL

Small, recurring point-fault jobs on an *already-contracted* client's *existing*
gear — see [[Career Layer]] §Service Tickets for the full SLA/reputation mechanics.
Two exist today for `client_local_shop`
(`src/data/serviceTickets.js`):

- **`ticket_loose_cable_pc2`** — PC-2's cable is really disconnected
  (`Topology.disconnect()`, not a flag) at issuance; fixed by reconnecting it.
- **`ticket_ip_reset_pc3`** — PC-3's IP is really cleared at issuance; fixed by
  re-addressing it in `10.0.10.0/24`.

A ticket's `fault` is a genuine, minimal state mutation applied to the client's real
topology — the exact same design principle as the (larger, not-yet-built) Act 2
fault-injection system; see [[Fault Injection System (Act 2)]].

## Related

[[Mission DSL]] · [[Career Layer]] ·
[[Router-on-a-Stick (Inter-VLAN Routing)|Router-on-a-Stick]] ·
[[Stateful Firewall]]
