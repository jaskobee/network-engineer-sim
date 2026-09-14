---
tags: [networking, ip, subnetting]
---

# IP Addressing and Subnetting

All IP/subnet validation in NetSim is strict and CCNA-accurate everywhere a player
can enter an address: the three CLI engines and every mission's `sameSubnet` /
`interfaceConfigured` condition checks (see [[Mission DSL]]) share the same
`src/models/ipUtils.js` primitives — there is exactly one implementation of this
math in the whole project.

## The rules enforced

- **The network address and directed broadcast address are rejected as host IPs** —
  *except* on a **/31 point-to-point link** (RFC 3021), where both addresses are
  usable and there is no broadcast concept at all. `/31` is supported correctly, not
  rejected as an edge case.
- **A `/32` is a single host** (loopback / host route) and is allowed where
  appropriate.
- **Subnet masks must be contiguous** — `255.255.255.0` is valid, `255.0.255.0` is
  not. Both dotted-decimal and prefix-length (`/24`) input are supported.
  `isValidMask()` checks this by inverting the mask and confirming the result is a
  contiguous run of 1 bits.
- **Two interfaces on the same link must share a subnet** to communicate directly. A
  correct IP with a mismatched mask is a real, common beginner error and is detected
  and explained rather than silently allowed to "just work."
- **A host's default gateway must be inside the host's own subnet**, or it's invalid
  — a gateway set outside the subnet yields `failureReason: 'gateway_unreachable'`
  once that reason code is fully wired (currently falls through to `no_route`; see
  [[Failure Reason Codes]]).
- **Octets over 255, wrong field counts, and non-numeric input are rejected.**

## Key functions (`src/models/ipUtils.js`)

| Function | Purpose |
|---|---|
| `isValidIp(ip)` | strict 4-octet, 0–255, no leading-zero-ambiguity validation |
| `ipToNum(ip)` | IP → 32-bit unsigned integer, for arithmetic |
| `networkAddress(ip, mask)` | the subnet's network address |
| `broadcastAddress(ip, mask)` | the subnet's directed broadcast address |
| `maskToPrefixLen(mask)` | dotted mask → CIDR prefix length |
| `isValidMask(mask)` | rejects discontiguous masks |
| `isHostAddress(ip, mask)` | true for a usable host IP; `/31` and `/32` are the two exceptions to the network/broadcast exclusion |
| `resolveHostname(name)` | a small static DNS map (`google.com` → `8.8.8.8`, etc.) for simulated internet destinations |

## Teaching surface

Wherever addressing is shown to the player, the network address, usable host range,
and broadcast should be made visible so the subnet math is legible, not just
implicitly correct under the hood.

## Related

[[Routing and Static Routes]] · [[Router-on-a-Stick (Inter-VLAN Routing)]] ·
[[DHCP]] · [[Failure Reason Codes]]
