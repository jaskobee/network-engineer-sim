# NetSim — Networking Accuracy Prompts for Claude Code

These prompts enforce that NetSim teaches networking the way real gear behaves
(CCNA / CCNP / CompTIA Network+). Paste the relevant one into Claude Code, or
keep this whole file in the repo and tell Claude Code to treat it as a hard
constraint. **Accuracy outranks convenience: if a simplification would teach a
beginner something they'd have to unlearn for a cert exam or a real job, don't
ship it.**

---

## PROMPT 1 — Fix the Layer 2 switch model (the priority issue)

```
Audit how the Switch device is modeled across deviceCatalog.js, Device.js,
Topology.js, CLIEngine.js, and the mission logic. Right now the switch may be
treated like a router (per-port IPs, routing between subnets). That is wrong on
real gear and will teach beginners incorrectly. Fix it to match real Cisco
behavior:

1. PHYSICAL SWITCHPORTS ARE LAYER 2 ONLY.
   - A physical switchport on a Layer 2 switch has NO IP address. It forwards
     Ethernet frames based on a MAC address table (CAM table), not IP.
   - In the CLI engine, entering `ip address ...` under a physical interface
     (e.g. `interface GigabitEthernet0/1`) on an L2 switch must be REJECTED,
     exactly as IOS does. The correct config under a switchport is L2 stuff:
     `switchport mode access`, `switchport access vlan <id>`,
     `switchport mode trunk`, `switchport trunk allowed vlan ...`.

2. MANAGEMENT IP LIVES ON AN SVI, NOT A PORT.
   - A switch gets ONE management IP via a Switched Virtual Interface:
     `interface vlan <id>` → `ip address <ip> <mask>` → `no shutdown`.
   - The default SVI is `interface vlan 1`, but flag in any tutorial text that
     using VLAN 1 for management is a known bad practice; a dedicated mgmt VLAN
     is preferred.
   - The SVI only comes up if at least one access port in that VLAN is up, or a
     trunk carries it. Model that dependency if feasible.

3. AN L2 SWITCH DOES NOT ROUTE.
   - It will not move traffic between two different subnets/VLANs. Do not let a
     ping cross VLANs just because the switch has an SVI in each. A pure L2
     switch has no `ip routing` and no routing table.

4. DECIDE EXPLICITLY: IS NETSIM'S SWITCH L2 OR L3?
   - If it's a Layer 2 access switch (most realistic for an 8-port $800 box),
     then inter-VLAN routing in mission 004 MUST be done by either:
       (a) Router-on-a-stick: a router physical interface with subinterfaces,
           each `encapsulation dot1Q <vlan>` + an IP that is the VLAN's default
           gateway, and the switch port to the router configured as a TRUNK; or
       (b) A separate Layer 3 switch / multilayer switch with `ip routing`
           enabled and one SVI per VLAN acting as that VLAN's gateway.
   - If you want the switch itself to route, introduce a SEPARATE device type
     ("Layer 3 Switch" / "Multilayer Switch") with `ip routing`, routed ports
     (`no switchport`), and SVIs — and keep the plain switch strictly L2.

Update the CLI engine's accepted/rejected commands, show outputs
(`show ip interface brief`, `show vlan brief`, `show mac address-table`,
`show running-config`), the Topology checkPing/BFS logic, and any mission task
checks to reflect this. The ping should only succeed along a path that real
hardware would actually forward. Add a short comment block at the top of
CLIEngine.js summarizing the L2-vs-L3 contract so it doesn't drift later.
```

---

## PROMPT 2 — Inter-VLAN routing & router-on-a-stick correctness

```
Implement/verify inter-VLAN routing the way CCNA teaches it. Enforce these facts
in the CLI engine, topology, and mission 002/004 checks:

- Each VLAN is its own broadcast domain and normally maps to its own subnet.
  Hosts in different VLANs CANNOT talk without a Layer 3 device routing between
  them.
- Router-on-a-stick: the router's PHYSICAL interface stays unaddressed; IPs go on
  SUBINTERFACES (e.g. Gig0/0.10). Each subinterface needs
  `encapsulation dot1Q <vlan-id>` before `ip address`. One subinterface per VLAN.
- The single physical link between the router and switch must be a TRUNK
  (`switchport mode trunk`) carrying all routed VLANs. An access port cannot do
  router-on-a-stick.
- The router subinterface IP is the DEFAULT GATEWAY for that VLAN's hosts. Hosts
  must have a default gateway set, in-subnet, or off-subnet pings fail — model
  that (a PC with no/ wrong gateway can ping its own subnet but not others).
- The native VLAN on a trunk is untagged. Flag a native-VLAN mismatch between two
  trunk ends as a misconfig if you simulate trunks on both sides.
- For an L3 switch alternative: `ip routing` must be ON, SVIs act as gateways,
  and inter-VLAN traffic is routed in hardware. Without `ip routing`, even an L3
  switch behaves as L2.
```

---

## PROMPT 3 — IP addressing & subnetting validation

```
Make all IP/subnet validation strict and CCNA-accurate everywhere a user can
enter an address (CLI engines, mission checks, ipUtils.js):

- Reject the network address (all host bits 0) and the directed broadcast
  address (all host bits 1) as host IPs — EXCEPT on a /31 point-to-point link
  (RFC 3021), where both addresses are usable and there is no broadcast. Support
  /31 correctly rather than rejecting it.
- A /32 is a single host (loopback/host route); allow it where appropriate.
- Subnet masks must be CONTIGUOUS (e.g. 255.255.255.0 ok; 255.0.255.0 invalid).
  Validate both dotted-decimal and prefix-length (/24) input.
- Two interfaces that must communicate directly (same link, no router) must be in
  the SAME subnet. If a mission expects a host–gateway pair, verify they share a
  subnet given the mask; a correct IP with a mismatched mask is a real and common
  beginner error — detect and explain it, don't silently let the ping pass.
- A host's default gateway must be inside the host's own subnet, or it's invalid.
- Reject IPs with octets >255, wrong field counts, and leading-zero ambiguity.
- When teaching, show the network address, usable range, and broadcast for the
  subnet so the math is visible and correct.
```

---

## PROMPT 4 — Routing table & static route realism

```
Verify the router routing logic matches real IOS behavior:

- A directly connected network appears in the routing table ONLY when its
  interface has an IP and is up/up (line protocol up). `show ip route` should mark
  these as connected (C) and local (L /32) entries.
- A router will NOT forward to a destination it has no route for. No default
  route + no matching route = dropped, and ping should fail with the correct
  reason.
- Forwarding uses LONGEST-PREFIX MATCH, not first-match or anything else. A more
  specific route always wins regardless of how it was learned.
- Static route syntax: `ip route <dest-net> <mask> <next-hop-or-exit-int>`.
  Default route: `ip route 0.0.0.0 0.0.0.0 <next-hop>`.
- A next-hop must be reachable via a connected network, or the static route is
  not installed/usable — model that, don't accept a next hop on a foreign subnet.
- RETURN PATH MATTERS: a ping succeeds only if BOTH source→dest AND dest→source
  have valid forwarding. The classic beginner bug is configuring one direction;
  make sure BFS/checkPing requires a working return path and that the failure
  message reflects "reply never came back" vs "no route to host" accurately.
- If you ever add administrative distance, use the real defaults
  (connected 0, static 1, EIGRP 90, OSPF 110, RIP 120).
```

---

## PROMPT 5 — Interface & physical-layer states

```
Make interface state transitions match Cisco semantics exactly:

- An interface is up/up only when Layer 1 is good (a cable to a powered, enabled
  peer) AND it is not administratively shut. `shutdown` = administratively down;
  `no shutdown` is required to enable it (router/switch interfaces default to
  shutdown on real routers).
- Show three distinct states where real gear does: administratively down (admin
  shut), down/down (no/ bad cable or peer down), and up/up (working). Don't
  collapse "admin down" and "cable down" into one state — they're different and
  beginners must learn the difference from `show ip interface brief`.
- A PC/host link is up only if the other end is up; pulling the cable or powering
  off the peer drops the local interface to down.
- Linux (PCCLIEngine) semantics differ from IOS: `ip link set <if> up/down`,
  interfaces are not "shutdown by default", and `ip addr` output format must look
  like real iproute2. Keep the two engines faithful to their own OS — don't leak
  IOS idioms into the Linux shell or vice versa.
```

---

## PROMPT 6 — Switching/L2 forwarding & MAC table

```
If/when you simulate frame forwarding, keep the L2 details honest:

- A switch learns source MACs per port into a MAC address table and floods
  unknown-unicast/broadcast/multicast out all ports in the VLAN except the
  ingress port. Model flooding-then-learning if you visualize traffic.
- Frames stay within their VLAN. Access ports belong to one VLAN (untagged);
  trunk ports carry multiple VLANs with 802.1Q tags (native VLAN untagged).
- `show mac address-table` and `show vlan brief` outputs must be consistent with
  the actual port/VLAN config.
- Don't invent IPs on switches for forwarding decisions — L2 forwarding is purely
  MAC/VLAN based. (See Prompt 1.)
```

---

## PROMPT 7 — Cabling & media correctness (CCNA still tests this)

```
If cabling type matters in the sim, enforce the real rules (auto-MDIX aside, the
exam-correct answers are):

- Straight-through cable: UNLIKE devices — PC↔switch, router↔switch, PC↔hub.
- Crossover cable: LIKE devices — switch↔switch, router↔router, PC↔PC,
  PC↔router (both are "DTE"-ish endpoints at L3).
- Rollover/console cable is for out-of-band management to a console port, not for
  data links — don't let it carry pings.
- If you model speed/duplex, a duplex mismatch causes errors/poor performance,
  not a clean down state — represent that distinctly if you go there.
- If auto-MDIX is "on" in your model, say so explicitly so the cable-type lesson
  isn't silently bypassed; otherwise teach the straight/crossover rule.
```

---

## PROMPT 8 — Standing "accuracy gate" (use on every networking change)

```
Before finalizing any change that touches networking behavior, CLI commands, show
outputs, or mission validation, self-check against this gate and fix anything that
fails:

1. Would this exact command, syntax, and output appear on real Cisco IOS (for
   router/switch) or real Linux iproute2 (for PC/server)? If not, correct it.
2. Does any packet/ping succeed along a path that real hardware would drop? If so,
   that's a bug — fix the topology/routing logic, not the test.
3. Are L2 (switch/MAC/VLAN) and L3 (router/IP/routing) responsibilities kept on
   the correct device type? No per-port IPs on L2 switches; no routing without a
   routing table.
4. Does the subnet math (network, usable range, broadcast, gateway-in-subnet)
   hold for every address involved?
5. Would a beginner learn something here they'd have to UNLEARN for CCNA /
   Network+? If yes, change it.
6. Are error messages realistic ("% Incomplete command", "Destination host
   unreachable", "Request timed out", "no route to host") and mapped to the
   correct failure cause?

If a realistic simplification is unavoidable for gameplay, add an in-game note or
code comment that flags it as a simplification rather than presenting it as truth.
```

---

## DHCP rules (added sprint: router-as-server + relay)

The following invariants are implemented in `src/models/DHCPEngine.js` and enforced by
the test suite in `src/models/__tests__/dhcp.test.js`:

1. **DORA exchange** modeled logically (not packet-level broadcast through BFS).
2. **Broadcasts don't cross routers.** A client's DISCOVER is confined to its L2
   broadcast domain. A server on a different subnet is NOT reachable without relay.
3. **Relay via `ip helper-address <server-ip>`**, configured on the router interface
   *facing the clients*. The relay stamps giaddr so the server knows which pool to
   use.
4. **Relay honors routing.** The relayed unicast is checked via the existing
   `checkPing`/BFS logic — if relay→server OR server→giaddr routing is broken, DHCP
   fails. The server must have a return route to the giaddr subnet.
5. **Pool selection**: pool whose network matches giaddr subnet (relay) or the router
   interface's subnet (local). No match → no offer.
6. **Address selection**: skips excluded ranges, the relay/gateway IP, router's own
   interface IPs, and already-bound IPs.
7. **Assigned config is complete**: IP, mask, default-router, dns-server all applied.
   Default-router installs a default route in the client's routing table.
8. **Bindings tracked**: `show ip dhcp binding` reflects live state.
9. **Failure = no address, not a fake one.** No server / exhausted pool / routing broken
   → client stays unaddressed.
10. **Lease expiry**: `lease_expires` stored as `"Infinite"` for now — no live timer.
    Documented simplification.
11. **Client-ID**: uses `"devId:ifaceName"` as a stand-in for a real MAC/DUID.
    Documented simplification.

---

## NAT/PAT rules (added sprint: source NAT overload)

The following invariants are implemented across `src/models/Topology.js` (BFS
enforcement), `src/models/CLIEngine.js` (IOS CLI), and
`src/models/__tests__/nat.test.js`.

1. **RFC 1918 addresses are not internet-routable.** `10.0.0.0/8`,
   `172.16.0.0/12`, and `192.168.0.0/16` are private. A packet with a private
   source egressing toward the ISP WITHOUT translation returns
   `failureReason: 'nat_required'` from `checkPing`. The lesson: without NAT
   the reply can never arrive — the source isn't globally unique.

2. **Inside / outside interfaces.** The router must designate:
   - `ip nat inside` on the LAN-facing interface(s)
   - `ip nat outside` on the WAN/ISP-facing interface

3. **PAT / overload.** Config form:
   ```
   access-list <1-99> permit <network> <wildcard>
   ip nat inside source list <n> interface <wan-if> overload
   ```
   Many inside hosts share the single public WAN IP; translations are tracked in
   `device.nat_translations` as `{ inside_local, inside_global }` entries.

4. **Only matching traffic is translated.** The NAT ACL selects which inside
   addresses are eligible. Sources not matched by the ACL still fail with
   `nat_required` even when `ip nat outside` is set on the WAN interface.

5. **Private→private (LAN-to-LAN) traffic is never NAT-checked.** The BFS check
   only fires when the egress interface leads to the ISP device. Internal pings
   are unaffected.

6. **Translation table.** `device.nat_translations` is populated by `checkPing`
   as a side effect (same pattern as `topology.pingLog`). `show ip nat
   translations` and `show ip nat statistics` read from it.

7. **Default route still required.** NAT rewrites the source address but does
   not replace routing. The router must have a default route (or matching static
   route) pointing toward the ISP for the packet to reach it.

### Simplifications (documented, not bugs)

- **Port tracking is conceptual, not literal.** Real PAT uses (IP, port) tuples
  to demultiplex return traffic. The sim tracks only `inside_local →
  inside_global` (no port), which is sufficient for reachability checks. Teach
  this honestly if the topic comes up.
- **No return-path NAT.** `checkPing` skips the return path for internet
  destinations (no local device at 8.8.8.8). Un-translation on the return
  is implied by the translation table existing, not independently simulated.
  This is not a correctness hole: if the WAN link goes down the forward-path
  BFS fails before reaching the NAT gate, so the translation table cannot
  produce a false-positive success (enforced by test N12).

---

## Stateful Firewall rules (Sprint 1: zone-based firewall engine)

Implemented in `src/models/Topology.js` (BFS hook) and `src/models/CLIEngine.js` (CLI).
Enforced by `src/models/__tests__/firewall.test.js`.

### Core invariants (all enforced by engine + tests)

1. **ZONES.** Each firewall interface is assigned to exactly one security zone via
   `nameif <ZONE>` (e.g. INSIDE, OUTSIDE, DMZ). Zone membership is stored in
   `device.fw_zones = { ifaceName: zoneName }`. Traffic is filtered only when
   crossing zone boundaries; intra-zone traffic is never inter-zone filtered.

2. **ORDERED RULES, FIRST-MATCH WINS.** The rule list (`device.fw_rules[]`) is
   evaluated top to bottom. The first rule whose `fromZone`, `toZone`, `src`, and
   `dst` all match applies its `action` (permit/deny) and stops. Later rules are
   not evaluated. Rule IDs are auto-assigned and used for deletion (`no firewall-rule <id>`).

3. **IMPLICIT DEFAULT-DENY.** If no rule matches, traffic is **blocked**. A brand-new
   firewall with no rules blocks all inter-zone traffic — this is the teachable moment:
   *"I installed it and now nothing works until I add permit rules."*
   `failureReason: 'blocked_by_firewall'` (distinct from `no_route`, `admin_down`, etc.).

4. **STATEFUL INSPECTION (the key teaching point).** When an inside host initiates a
   connection toward a less-trusted zone and a permit rule matches:
   - The firewall records a session `{ srcIp, dstIp }` in `device.fw_sessions`.
   - The return path BFS (which runs for every `checkPing`) checks for an existing
     session using a **directional** lookup (`s.srcIp === original_srcIp && s.dstIp === original_dstIp`)
     and, if found, allows the return traffic **without requiring an explicit inbound rule**.
   - A new ping initiated from the outside (`checkPing('outside_ip', 'inside_ip')`) uses
     a **non-directional** session lookup — it only matches a session where the outside host
     itself was the originator, which it never was. It must match a rule or be denied.
   - This asymmetry is the whole point: inside-out flows work; outside-in flows are blocked
     unless an explicit rule exists. **It is NOT a bidirectional ACL.**

5. **THE FIREWALL IS ALSO A ROUTER.** It has `ip address`, `ip route`, and routes between
   zones just like a router. Filtering is applied in addition to routing, not instead of it.
   Traffic must be routable AND pass policy to succeed.

6. **MANAGEMENT TRAFFIC (firewall-originated pings).** When the firewall itself is the
   source of a ping, `ingressIfaceId` is `null` for the firewall's first BFS visit, and
   the zone check is skipped. This matches real appliance behavior where self-generated
   traffic is not subject to data-plane policy (a documented simplification; real ASA has
   a separate `management-access` concept).

7. **`blocked_by_firewall` failure reason.** Emitted when a packet is dropped by zone
   policy. Distinct from `no_route` (no routing path), `vlan_isolated` (L2 boundary), and
   `nat_required` (RFC 1918 without NAT). `failurePoint` is set to the firewall's device id.

### CLI reference (simplified ASA-inspired syntax)

```
# Interface config (firewall device)
interface GigabitEthernet0/0
  nameif INSIDE                                         ← assign to zone
  security-level 100                                    ← 100=most trusted (informational)
  ip address 10.1.0.1 255.255.255.0                    ← works same as router
  no shutdown

# Policy rules (global config, firewall only)
firewall-rule permit from-zone INSIDE to-zone OUTSIDE src any dst any [service any]
firewall-rule deny   from-zone OUTSIDE to-zone INSIDE  src any dst any
no firewall-rule <id>                                   ← remove rule by ID; clears sessions

# Show commands
show nameif                                             ← zone/security-level per interface
show firewall-rules                                     ← ordered rule list with IDs
show conn                                               ← active stateful sessions
show running-config                                     ← includes all of the above
show ip interface brief                                 ← works same as router
```

### Simplifications (documented, not bugs)

- **CLI syntax is ASA-inspired, not exact ASA.** Real Cisco ASA uses `access-list <name>
  extended permit ...` + `access-group <name> in interface <if>`. This sim uses a
  simplified `firewall-rule` command that is more directly readable and teaches the
  concept (zones, ordered rules, permit/deny) without the indirection. Teach this
  honestly if the topic comes up.
- **Session table stores (srcIp, dstIp, protocol, port) — no ephemeral source port.**
  Real PAT/stateful inspection tracks 5-tuples (srcIp, srcPort, dstIp, dstPort, proto)
  to demultiplex concurrent sessions from the same host. The sim omits the ephemeral
  source port: different connections from the same host to the same server+port are
  tracked as one session. For reachability checks this is sufficient; for teaching
  say "real firewalls also track source ports to multiplex concurrent sessions."
- **No session timeout.** Real firewalls age out idle sessions (TCP: 3600s, ICMP: 30s).
  The sim holds sessions until a rule is removed (`no firewall-rule`) or the device is
  cleared. Documented simplification.
- **Security-level is stored but not enforced by the engine.** Real ASA uses security
  levels to determine default inter-zone policy (higher can initiate to lower without
  explicit rule, lower cannot). This sim requires explicit rules in both directions.
  The `security-level` command is supported for educational display only.

---

## Service / Port matching rules (implemented in Topology.js + CLIEngine.js)

Implemented in `src/models/Topology.js` (`_evaluateFirewallRules`, `_bfsReach`) and
`src/models/CLIEngine.js` (CLI command, `_showConn`).
Enforced by `src/models/__tests__/firewall.test.js` (SVC1–SVC6 blocks, 21 tests).

### Invariants

1. **A firewall rule has a SERVICE match** — `{ protocol, port }` resolved at engine time.
   Omitting the `service` keyword stores `'any'`, which matches all protocols and ports
   (backward-compatible: all Sprint 1 rules continue to work unchanged).

2. **Well-known port table** (real IANA values — teach these to students):

   | Name    | Protocol | Port |
   |---------|----------|------|
   | HTTP    | TCP      | 80   |
   | HTTPS   | TCP      | 443  |
   | SSH     | TCP      | 22   |
   | DNS     | UDP      | 53   |
   | FTP     | TCP      | 21   |
   | TELNET  | TCP      | 23   |
   | RDP     | TCP      | 3389 |
   | SMTP    | TCP      | 25   |

3. **Match semantics (first-match wins, unchanged from Sprint 1):**
   - `service any` → matches any protocol and port.
   - `service icmp` → matches only ICMP (protocol = 'icmp', no port).
   - `service HTTPS` / `service tcp/443` → matches only TCP to port 443.
   - A rule for `tcp/443` does NOT permit a ping (ICMP) to the same host.
   - A rule for `icmp` does NOT permit a TCP/443 flow to the same host.

4. **Stateful session records protocol + port.**
   `{ srcIp, dstIp, protocol, port }` — a tcp/443 session does NOT open tcp/22 on the
   same host pair. A fresh unsolicited inbound on a different port is always checked
   against the rule list, not the session table.

5. **`checkPing(srcIp, dstIp, service)` signature** — `service` defaults to
   `{ protocol: 'icmp', port: null }` so all existing callers (CLI `ping`, mission
   validators) are unchanged and still test ICMP reachability.

### CLI service syntax

```
# Named service
firewall-rule permit from-zone INSIDE to-zone OUTSIDE src any dst any service HTTPS

# Raw proto/port
firewall-rule permit from-zone INSIDE to-zone OUTSIDE src any dst any service tcp/443

# ICMP only
firewall-rule permit from-zone INSIDE to-zone OUTSIDE src any dst any service icmp

# Any traffic (default when keyword omitted)
firewall-rule permit from-zone INSIDE to-zone OUTSIDE src any dst any
```

### Remaining simplification

- **Source port not tracked in sessions.** Real stateful inspection uses 5-tuples.
  The sim uses 4-tuples (srcIp, dstIp, protocol, dstPort) — sufficient for teaching
  inbound vs outbound policy; not sufficient for simulating concurrent sessions from
  the same host to the same server.

### How to use this file
- Drop it in the repo root (or `docs/`) and add a line to your `CLAUDE.md`:
  *"Treat NETWORKING_ACCURACY.md as a hard spec. Networking behavior must comply
  with it; flag any conflict instead of silently simplifying."*
- Run **Prompt 1** first — it's the highest-impact correctness fix.
- Use **Prompt 8** as a recurring checklist on every networking-related PR/change.
