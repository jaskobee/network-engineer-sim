---
tags: [networking, interfaces, cabling, physical-layer]
---

# Interface States and Cabling

## Three distinct interface states — never collapsed into two

Real Cisco gear distinguishes three states, and NetSim keeps them distinct
everywhere (`show ip interface brief`, the device inspector UI, hint text):

1. **Administratively down** — the interface has been `shutdown`. Router and switch
   interfaces default to `shutdown` on real hardware, and NetSim matches that: you
   must explicitly `no shutdown` a freshly configured interface. `interfaces.status`
   value: `'admin_down'`.
2. **Down/down** — administratively enabled but Layer 1 isn't there: no cable, or the
   cable exists but the peer is unpowered/uncabled/down. `'down'`.
3. **Up/up** — administratively enabled and Layer 1 is good (a cable to a powered,
   enabled peer). `'up'`.

An interface is up/up **only** when both conditions hold. Pulling a cable or powering
off the peer immediately drops the local interface back to down — this is live,
reactive state, not a one-time check.

## Linux vs. IOS interface idioms — kept strictly separate

- **IOS** (router/switch/firewall): interfaces are shutdown by default; explicit
  `no shutdown` required. `show ip interface brief` output format.
- **Linux (`PCCLIEngine`, for PC/server/laptop)**: `ip link set <if> up` / `down`;
  interfaces are **not** shutdown-by-default the way IOS is; `ip addr` output format
  matches real iproute2. See [[The Three CLI Engines]] — idioms never leak between
  engines.

## Cabling rules (still exam-relevant even with auto-MDIX)

- **Straight-through**: unlike devices — PC↔switch, router↔switch, PC↔hub.
- **Crossover**: like devices — switch↔switch, router↔router, PC↔PC, PC↔router.
- **Rollover/console**: out-of-band management only, never carries data-plane pings.
- If the sim ever models auto-MDIX as universally "on," that must be stated
  explicitly rather than silently making the straight/crossover distinction
  irrelevant — otherwise the lesson is quietly deleted.
- **Duplex mismatch** causes errors/packet loss on an otherwise up/up link, not a
  clean down state — represented distinctly if/when modeled (see
  [[Fault Injection System (Act 2)]] fault I, not yet implemented as of this
  writing — `duplex_mismatch` currently falls through to a generic failure).

## Where this lives in code

`src/models/Device.js` — `createInterface()` (default `status: 'admin_down'`),
`normalizeIfName()` (expands `gi0/0` → `GigabitEthernet0/0`, `fa0/1` →
`FastEthernet0/1`, etc.). Interface IDs are the composite string
`"<deviceId>:<ifaceName>"`, split on the **first** `:` only (a hostname could
theoretically contain a colon in edge cases; the split logic never assumes
otherwise). `src/models/Topology.js` — `connect()` / `disconnect()` wire two
interfaces' `connected_to` fields to each other, and the up/up derivation reacts to
both ends live.

## Related

[[Layer 2 Switching and VLANs]] · [[Failure Reason Codes]] ·
[[Ping Reachability Engine (checkPing)]]
