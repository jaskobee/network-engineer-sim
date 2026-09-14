---
tags: [networking, dhcp]
---

# DHCP

Implemented in `src/models/DHCPEngine.js`, enforced by
`src/models/__tests__/dhcp.test.js`. Modeled **logically** (the DORA exchange as a
function call), not as literal packet-level broadcasts walked through BFS — see
[[Ping Reachability Engine (checkPing)]] for why that distinction matters and what a
future packet-engine refactor would change about it.

## Invariants

1. **DORA exchange** (Discover/Offer/Request/Ack) modeled as `performDHCP(topology,
   clientDevice, clientIface)` → `{ success: true, ip, mask, gateway, dns }` or
   `{ success: false, reason, message }`. No fake address is ever returned — failure
   means the client stays unaddressed, exactly like real hardware with no server.
2. **Broadcasts don't cross routers.** A client's DISCOVER is confined to its own L2
   broadcast domain — the engine walks that broadcast domain (`_l2RouterIfaces`) and
   a server on a different subnet is unreachable without relay.
3. **Relay via `ip helper-address <server-ip>`**, configured on the router interface
   *facing the clients*. The relay stamps `giaddr` (the relay's own interface IP) so
   the server can pick the right pool.
4. **Relay honors real routing.** The relayed unicast is checked with the exact same
   `checkPing`/BFS logic as everything else — if relay→server OR server→giaddr
   routing is broken, DHCP fails. The server needs a real return route to the giaddr
   subnet, just like actual DHCP relay.
5. **Pool selection**: the pool whose network matches the giaddr subnet (relay) or the
   router interface's own subnet (local, no relay needed) — no match, no offer.
6. **Address selection** skips excluded ranges, the relay/gateway IP itself, the
   router's own interface IPs, and already-bound addresses.
7. **A successful lease is complete**: IP, mask, default-router, and DNS server are
   all applied to the client. The default-router value installs a real default route
   in the client's routing table — DHCP isn't just "you now have an IP," it
   configures the whole host.
8. **Bindings are tracked live** — `show ip dhcp binding` on the serving router
   reflects real, current state.

## Documented simplifications (not bugs)

- **`lease_expires` is always `"Infinite"`.** No live lease timer (T1/T2/expiry) is
  simulated. The `lease` command stores a duration for display only.
- **Client-ID is `"devId:ifaceName"`**, a stand-in for a real MAC address or RFC 4361
  DUID.
- **A single DNS server** is applied to `device.dns_server`; real DHCP option 6 can
  carry multiple.

## The teaching moment this unlocks

The classic "DHCP client never gets an address across a router" beginner confusion is
reproduced faithfully: the fix is *not* magic, it's adding
`ip helper-address <server>` on the client-facing router interface, and making sure
the server can route back to the giaddr subnet. This is exactly how it works on real
Cisco gear.

## Where it's taught

`mission_004` ("TechNova Startup HQ") — per-VLAN DHCP pools served directly from the
router (no relay needed, since the router itself is on every VLAN segment via ROAS
subinterfaces). See [[Mission Catalog]].

## Related

[[Router-on-a-Stick (Inter-VLAN Routing)]] · [[IP Addressing and Subnetting]] ·
[[Ping Reachability Engine (checkPing)]]
