# NetSim — Networking Accuracy Audit

**Phase 1 — Read-Only Audit**  
Files inspected: `ipUtils.js`, `Device.js`, `Topology.js`, `CLIEngine.js`,
`PCCLIEngine.js`, `GameContext.jsx`.  
Reference: `docs/NETWORKING_ACCURACY.md`, `docs/SANDBOX_TEST_PLAN.md`.

---

## Summary of findings

| Severity | Count |
|----------|-------|
| CORRECT  | 34    |
| BUGGY    | 2     |
| MISSING  | 8     |
| RISKY    | 4     |

**The two BUGGY items must be fixed before Phase 3 tests are written:**
1. `shutdown` / `ip link set down` do not propagate carrier-loss to the peer
   interface → peer stays `up` after local shutdown (display bug + BFS safety risk).
2. BFS does not verify the **remote** interface is `up` before traversing a cable;
   combined with bug #1 this can produce a false-success ping across a shutdown link
   in multi-hop topologies.

All SANDBOX_TEST_PLAN.md scenarios (T1–T8) pass correctly at the behavioural level
despite bug #1, but T8 produces wrong `show ip interface brief` / `ip link show`
output for the peer interface, and bug #2 would produce a false positive in a
topology where a shutdown transit link is not the only route.

---

## A — IP addressing & subnetting (`ipUtils.js`)

### A1 — `isValidIp` rejects octets >255, wrong count, non-numeric, empty
**CORRECT** — `ipUtils.js:1–9`

`parseInt(p, 10)` with `!isNaN`, `n >= 0 && n <= 255`, and `String(n) === p`
together handle: octet > 255, leading zeros (`'01'` → parseInt=1 → String≠'01'
→ false), non-numeric (`'abc'` → NaN → false), empty string (`''` → NaN → false).

### A2 — Subnet masks must be CONTIGUOUS
**CORRECT** — `ipUtils.js:34–38`

`const inv = (~ipToNum(mask)) >>> 0; return (inv & (inv + 1)) === 0`
Checks that the inverted mask is `2^n - 1` (contiguous 1-run).
- `255.0.255.0` → inv=`0x00FF00FF` → inv+1=`0x00FF0100` → AND≠0 → **rejected** ✓
- `0.0.0.0` (/0) → inv=`0xFFFFFFFF` → inv+1=0 (overflow) → AND=0 → **accepted** ✓

### A3 — Prefix ↔ mask conversion correct for /0–/32
**CORRECT** — `ipUtils.js:21–30` (`maskToPrefixLen`) and `PCCLIEngine.js:616–621`
(`_prefixToMask`)

Manual checks:
- `/0` → mask `0.0.0.0` → `ipToNum=0`, loop never enters → 0 ✓
- `/24` → mask `255.255.255.0` → counts 24 set bits ✓
- `/32` → mask `255.255.255.255` → counts 32 ✓
- `_prefixToMask(0)` → `n===0 ? 0 : …` → `'0.0.0.0'` ✓
- `_prefixToMask(32)` → `(0xffffffff << 0) >>> 0` = `0xffffffff` → `'255.255.255.255'` ✓

### A4 — networkAddress and broadcastAddress math
**CORRECT** — `ipUtils.js:15–19, 41–45`

Hand-checked with `192.168.1.10/24`:
- network: `0xC0A8010A & 0xFFFFFF00 = 0xC0A80100` = `192.168.1.0` ✓
- broadcast: `0xC0A8010A | 0x000000FF = 0xC0A801FF` = `192.168.1.255` ✓

### A5 — "Same subnet?" uses EACH host's OWN mask
**CORRECT** — `Topology.js:278–283`

`_findExitInterfaces` computes both `networkAddress(iface.ip, iface.subnet_mask)`
and `networkAddress(dstIp, iface.subnet_mask)` using the device's own mask. A host
never borrows another device's mask.

### A6 — Network/broadcast address not assignable; /31 and /32 are exceptions
**CORRECT** — `ipUtils.js:50–54`

`isHostAddress` returns `true` unconditionally for `/31` and `/32` (RFC 3021),
and otherwise rejects the network and broadcast address via `networkAddress` /
`broadcastAddress` comparison. Used in both engines' `ip address` / `ip addr add`
handlers.

### A7 — No off-by-one in usable host range
**CORRECT** — implied by A6

- `/30` (255.255.255.252): usable .1 and .2; .0 is network, .3 is broadcast —
  all correctly handled.
- `/31`: both addresses usable — allowed.
- `/32`: single host — allowed.

---

## B — Interfaces & physical layer (`Device.js`, `Topology.js`)

### B1 — Three distinct states: up / down / admin_down
**CORRECT** — `Device.js:27–31`, `CLIEngine.js:1118–1124`

Values `'up'`, `'down'`, `'admin_down'` are defined and never conflated.
`_statusProto` maps them to the correct IOS strings (`up/up`, `down/down`,
`administratively down/down`). Display is accurate.

### B2 — Router interfaces default admin_down; switch ports default down
**CORRECT** — `Device.js:107–118`

`createInterface` sets `status: 'admin_down'` for all types. The switch
constructor then overrides to `'down'` (no cable / no carrier), leaving routers
and PCs at `'admin_down'` until explicitly enabled. This matches Cisco IOS:
router physical interfaces require `no shutdown`; switch ports come up when a
cable is connected.

### B3 — Shutdown propagates carrier-loss to peer interface  ⚠️
**BUGGY** — `CLIEngine.js:261–271`, `PCCLIEngine.js:247–253`, `Topology.js:64–83`

`no shutdown` (CLIEngine line 629–636) correctly checks the peer and wakes it up.
`shutdown` (line 265–266) sets only the local interface to `admin_down` and never
updates the peer. After `shutdown GigabitEthernet0/0` on a router, the directly
connected PC's `eth0` remains `'up'` instead of dropping to `'down'` (no carrier).

Same bug in `PCCLIEngine._linkSet` (line 249: `iface.status = 'admin_down'`) and
`_cmdIfconfig` (line 333: `iface.status = 'admin_down'`) — neither updates the peer.

**Concrete failing example:**
```
R1(config-if)# shutdown   ← shuts Gig0/0 (192.168.1.1)
R1# show ip interface brief
  GigabitEthernet0/0  unassigned  NO  unset  administratively down  down  ← correct
PC1> ip link show eth0
  eth0: UP …  ← BUG: should be DOWN (carrier lost)
```

**BFS safety risk:** Because the PC's interface stays `'up'`, `_bfsReach` can
traverse the dead cable and arrive at the router. For multi-hop topologies where
the router has another up exit interface toward the destination, checkPing may
return `reachable: true` across a physically dead link. (In single-router T8
scenarios this doesn't surface because the destination IP is also on the
admin_down interface and the `iface.status === 'up'` check at the destination
catch it.)

### B4 — One interface carries at most one cable
**CORRECT** — `Topology.js:40`

`if (iface1.connected_to || iface2.connected_to) return false` prevents
double-cabling.

---

## C — Layer 2 switching (`CLIEngine.js`, `Topology.js`)

### C1 — Physical switch ports reject `ip address`
**CORRECT** — `CLIEngine.js:553–558`

```js
if (device.type === 'switch') {
  const iface = device.getInterface(device.active_interface)
  if (!iface?.svi) return ['% Invalid input detected…']
}
```
Only SVIs (`iface.svi === true`) are allowed; physical ports are rejected.

### C2 — Switch management IP only on an SVI
**CORRECT** — `CLIEngine.js:191–207`

`interface vlan <id>` creates an SVI with `svi: true`. Physical switchports never
get IPs. The VLAN is auto-created in `vlan_db` when entering SVI config (matches
real IOS behavior).

### C3 — Switch has no routing table; `ip route` is rejected
**CORRECT** — `CLIEngine.js:583–587`, `Topology.js:258–273`

`ip route` on a switch returns `% IP routing is not enabled on this switch.`.
`_findExitInterfaces` for a switch only floods within the ingress VLAN — no
longest-prefix match, no routing.

### C4 — VLAN isolation: frames stay within their VLAN
**CORRECT** — `Topology.js:258–273`, `_bfsReach:169–178`

When a packet enters a switch, `nextVlan` is set from the access port's VLAN.
`_findExitInterfaces` for a switch filters exit ports by `(i.vlan ?? 1) ===
effectiveVlan` for access ports and `_vlanAllowed(i.trunk_vlans, effectiveVlan)`
for trunk ports. PCs in VLAN 1 cannot reach PCs in VLAN 2 through the switch —
BFS is blocked at the VLAN boundary.

Unconfigured switch: all ports default VLAN 1, so all same-subnet PCs reach each
other with zero configuration (T2).

### C5 — Access / trunk VLAN semantics
**CORRECT** — `CLIEngine.js:839–874`

`switchport mode access`, `switchport access vlan <id>`, `switchport mode trunk`,
`switchport trunk allowed vlan <list>`, `switchport trunk native vlan <id>` are
all implemented and used by the BFS VLAN filter correctly.

---

## D — Layer 3 routing (`CLIEngine.js`, `Topology.js`)

### D1 — Connected network only reachable when interface is up/up with an IP
**CORRECT** — `Topology.js:276–283`

`if (iface.status !== 'up' || !iface.ip || !iface.subnet_mask) continue`
gates every connected-route check. Same gate in `_showIpRoute` (line 524–526).

### D2 — Route selection: longest-prefix match
**RISKY** — `Topology.js:286–296`

For static-vs-static comparison, LPM is correct (tracks `bestLen`). However,
connected routes are checked first with an **early return** (`if (exits.length >
0) return exits`). This means a static route more specific than a connected route
(e.g., a /25 static inside a /24 connected subnet) would never win. Real IOS
uses true LPM across all sources.

In practice this edge case is unreachable in the current missions (you would
never add a static route for a subnet you are already directly connected to), but
it is technically incorrect and could confuse an advanced lab.

### D3 — Static route usable only when next-hop is reachable
**CORRECT** — `Topology.js:305–312`, `CLIEngine.js:511–513`

`_findExitInterfaces` resolves the next-hop via connected-route lookup; if no
interface is in the same subnet as the next-hop, no exit is returned and BFS
fails. `_showIpRoute` uses the same `isRouteActive` predicate, so inactive routes
are hidden from `show ip route` (matches real IOS behaviour).

### D4 — Default route `0.0.0.0/0` is least-specific
**CORRECT** — `Topology.js:291–294`

LPM tracking starts at `bestLen = -1`; a `/0` route gets `len = 0`, which is
beaten by any more-specific match. Static default route correctly defers to
connected and more-specific static routes.

### D5 — Administrative distance (implicit)
**CORRECT (implicit)** — `Topology.js:276–296`

Connected routes are tried before static routes. AD is not a named field but
the effective ordering is correct (connected = highest priority, static below).
Only two source types exist; if OSPF/EIGRP are added later, an explicit AD field
will be required.

### D6 — Router must not have two interfaces in same/overlapping subnet
**MISSING** — `CLIEngine.js:571–579`

`_cmdIp` checks for duplicate IPs across **different devices** but never checks
whether the IP being assigned creates a subnet overlap with another interface on
the **same** router. Real IOS rejects this with `% overlaps with <iface>`.

**Concrete failing example:**
```
R1(config-if)# ip address 192.168.1.1 255.255.255.0   ← Gig0/0, accepted
R1(config-if)# ip address 192.168.1.254 255.255.255.0 ← Gig0/1, also accepted ← BUG
```
Real IOS would reject: `% 192.168.1.254 overlaps with GigabitEthernet0/0`.

This can confuse beginners who accidentally address two router interfaces in the
same subnet and get unexpected routing behaviour.

### D7 — BIDIRECTIONAL: both forward and return paths must succeed
**CORRECT** — `Topology.js:123–133`

`checkPing` runs `_bfsReach` for the forward path, then a second `_bfsReach` in
reverse from `dstDevice` to `srcIp`. A working forward with no return returns
`no_return_path`. This is the critical T5 invariant and is correctly implemented.

### D8 — BFS loop protection
**CORRECT** — `Topology.js:139–145`

`const visited = new Set()` with `if (visited.has(device.id)) continue; visited.add(device.id)` ensures each device is visited at most once. No infinite loop is possible regardless of topology cycles.

---

## E — Host behavior (`PCCLIEngine.js`)

### E1 — Host uses its OWN mask for local vs remote decision
**CORRECT** — `Topology.js:278–283` (called from BFS for all device types)

`_findExitInterfaces` uses `iface.subnet_mask` of the SOURCE device for the
subnet comparison. A `/25` host correctly sees a `.200` address as off-subnet
when its own mask is `255.255.255.128` (T7).

### E2 — Default gateway must be in the host's subnet
**CORRECT (at BFS level)** — `Topology.js:305–312`

`ip route add default via <gw>` is accepted without upfront subnet validation
(matching real Linux — the kernel accepts any gateway at configuration time). The
BFS resolves the next-hop at ping time: if the gateway is not in any connected
subnet of the host, no exit is found and the ping fails. No silent success is
possible.

### E3 — Off-subnet target with no/invalid gateway fails; own subnet still works
**CORRECT (behaviour) / MISSING (reason code)**

Behaviour is correct: `_findExitInterfaces` returns nothing when the host has no
route to the destination → BFS → `no_route` → PCCLIEngine shows
`Network is unreachable`. The `host_no_gateway` failureReason defined in the
enum comment (`Topology.js:401`) is **never emitted** — see F1 below.

### E4 — Pinging own IP and loopback succeeds locally
**CORRECT** — `Topology.js:92, 94–100`

`srcIp === dstIp` → immediate `true`. Loopback `127.x.x.x` is intercepted and
returns `true` iff the source interface is `'up'`.

### E5 — Linux iproute2 semantics; no IOS idioms leak
**CORRECT** — `PCCLIEngine.js` throughout

`ip addr`, `ip link`, `ip route`, `ping -c`, `ifconfig`, `route` all use real
Linux command syntax and output format. No IOS config modes, no `enable`, no
`shutdown` keyword (uses `ip link set down` / `admin_down` state). CLIEngine has
no `ip link` or CIDR notation.

---

## F — checkPing result object & CLI output fidelity

### F1 — failureReason enum is set correctly per scenario
**MISSING (six of ten reasons)** — `Topology.js:401–403`

The comment lists the full enum. Audit of where each is actually emitted:

| failureReason      | Emitted?    | Where                                                    |
|--------------------|-------------|----------------------------------------------------------|
| `no_route`         | ✅ Yes      | `_bfsReach`, `checkPing` fallback                        |
| `admin_down`       | ✅ Yes      | `checkPing` source-iface check                           |
| `link_down`        | ✅ Yes      | `checkPing` source-iface check                           |
| `no_return_path`   | ✅ Yes      | `checkPing` reverse BFS                                  |
| `host_no_gateway`  | ✅ Yes      | `checkPing` post-BFS, PC/server, no usable gateway       |
| `gateway_unreachable` | ❌ Never | Indistinguishable from `no_route`                        |
| `subnet_mismatch`  | ✅ Yes      | `checkPing` post-BFS, mask mismatch between src and dst  |
| `vlan_isolated`    | ✅ Yes      | `_bfsReach` (ROAS: tagged frame rejected at router) and `_checkVlanIsolation` (same-switch VLAN boundary, including access-port-to-router ROAS misconfiguration) |
| `ip_conflict`      | ❌ Never    | Conflict rejected at config time                         |
| `duplex_mismatch`  | ❌ Never    | Duplex not simulated                                     |

**Impact:** All missing reasons collapse to `no_route`. PCCLIEngine's
`_isNetworkUnreachable` maps both `no_route` and `host_no_gateway` to
`Network is unreachable`, so the player message is the same. However, any future
mission task-check or troubleshooting-mode that tests `result.failureReason ===
'subnet_mismatch'` (or any other missing code) will always be false.

For the SANDBOX_TEST_PLAN.md tests: T6 and T7 both fail with `no_route` instead
of the documented `host_no_gateway` / `subnet_mismatch`, but the ping behaviour
(fails with "Network is unreachable") is correct.

### F2 — CLI text matches real IOS / Linux output
**RISKY (minor inconsistency)**

- **Async ping (`executePingAsync`)**: RTT is calculated dynamically from router
  hops (`CLIEngine.js:90–96`). **CORRECT**.
- **Synchronous ping (`_cmdPing`)**: Uses hardcoded `round-trip min/avg/max =
  1/2/10 ms` (`CLIEngine.js:352`). Inconsistent with async. A student comparing
  CLI output may notice the RTT never changes.
- **`no_return_path` message**: Shows `% Request timed out (no return path
  configured)` — the added clarification is helpful but not IOS-standard text
  (real IOS shows `U....` or just `.....` with no extra explanation). Classified
  as acceptable simplification; a code comment should call it out.

---

## G — CLI engine integrity (both engines)

### G1 — State machine transitions correct
**CORRECT** — `CLIEngine.js:111–165, 296–326`

`user_exec → priv_exec` (enable), `→ global_config` (configure terminal),
`→ interface_config` (interface X), `→ vlan_config` (vlan X). `exit` walks one
level back; `end` jumps to `priv_exec`. `do <cmd>` temporarily enters
`priv_exec` via try/finally. All transitions verified.

### G2 — Invalid input produces realistic errors
**CORRECT** — `CLIEngine.js:912–914`

`% Invalid input detected at '^' marker.` and `% Incomplete command.` are used
correctly. Both engines return command-not-found style errors for unknown commands.

### G3 — `no` forms undo their counterparts
**CORRECT (core set) / MISSING (optional forms)** — `CLIEngine.js:606–673`

Implemented:
- `no shutdown` / `no ip address` / `no ip route` / `no switchport` (all work) ✅
- `no interface vlan <id>` — removes an SVI ✅ (added ROAS sprint)
- `no vlan <id>` — removes a VLAN from the database ✅ (added ROAS sprint)
- `no switchport access vlan` — resets port to VLAN 1 ✅ (added ROAS sprint)
- `no encapsulation dot1q` — clears VLAN binding on a subinterface ✅ (added ROAS sprint)
- `no interface <subif>` — deletes a subinterface ✅ (added ROAS sprint)

Not yet implemented (low impact):
- `no hostname` — resets to default hostname

### G4 — show commands reflect actual device state
**CORRECT** — `CLIEngine.js:362–419`

- `show ip interface brief` — reflects real interface state and IPs ✓
- `show ip route` — only shows active routes (next-hop reachable check) ✓
- `show running-config` — reflects actual config; physical switchports show `no ip
  address` correctly ✓
- `show vlan brief` — only lists access ports under their VLAN; trunk ports
  correctly omitted ✓
- `show mac-address-table` — returns stub with explicit "(in simulation)" note;
  MAC learning not simulated, noted transparently ✓

---

## BFS safety gap (cross-cutting B3 + new)

### BFS does not verify the remote interface is `up` before traversing a cable
**BUGGY** — `Topology.js:166–179`

`_bfsReach` checks `exitIface.status !== 'up'` (the **local** outgoing interface)
but never checks the status of the **remote** interface it connects to:

```js
for (const exitIface of this._findExitInterfaces(device, dstIp, ingressVlan)) {
  if (exitIface.status !== 'up' || !exitIface.connected_to) continue
  const remoteDevice = this._getDeviceByIfaceId(exitIface.connected_to)
  // ← no check: is exitIface.connected_to's interface status === 'up'?
  queue.push({ device: remoteDevice, ingressVlan: nextVlan })
}
```

**Combined effect with B3:** After `shutdown GigabitEthernet0/0`:
- Router Gig0/0 → `admin_down` (correct)
- PC eth0 → stays `'up'` (bug B3)
- BFS from PC uses eth0 (up) as an exit, traverses the cable, arrives at router
  without checking that Gig0/0 is admin_down
- If router has another up interface leading to the destination, checkPing returns
  `reachable: true` across a physically broken link — **false success**

**Fix required:** add `remoteIface.status !== 'up'` check in `_bfsReach`
(see Phase 2).

---

## Phase 2 — Fix plan

Fix in this order (most foundational first):

| # | File | Change | Reason |
|---|------|--------|--------|
| 1 | `CLIEngine.js` — `shutdown` | After setting admin_down, set peer to `'down'` if peer is `'up'`; call `_refreshSvis` on both ends if switch | B3 |
| 2 | `PCCLIEngine.js` — `_linkSet` `state==='down'` | After setting admin_down, set peer to `'down'` | B3 |
| 3 | `PCCLIEngine.js` — `_cmdIfconfig` `tokens[2]==='down'` | Same peer update | B3 |
| 4 | `Topology.js` — `_bfsReach` | Before enqueuing remote device, resolve and check remote interface status | BFS gap |
| 5 | `CLIEngine.js` — `_cmdIp address` | Add overlapping-subnet check vs other interfaces on same device | D6 |

Items deliberately deferred (acceptable simplifications for now):
- Emitting `host_no_gateway` / `subnet_mismatch` (F1) — behaviour correct, only
  reason code differs; needs design decision on granularity before implementing
- Missing `no` forms for vlan/SVI commands (G3) — needed before mission 004
- Synchronous ping static RTT (F2) — cosmetic; log as known simplification
- Full LPM across connected+static routes (D2) — unreachable in current mission
  scope; flag with a code comment

---

## Phase 3 — Test plan

Set up **Vitest** (fits Vite without ejecting, zero config).

### ipUtils unit tests
- `isValidIp`: boundary octets (0, 255, 256, -1), wrong count, leading zeros,
  non-numeric, empty string, non-string input
- `isValidMask`: contiguous masks /0–/32, discontiguous masks (255.0.255.0,
  128.255.255.0), all-zeros, all-ones
- `maskToPrefixLen`: round-trip /0–/32
- `networkAddress` / `broadcastAddress`: four hand-verified examples including /31
- `isHostAddress`: network addr, broadcast addr, valid host, /31 both usable, /32
  usable, discontiguous mask rejected

### Topology integration tests (encode T1–T8)
Build small in-memory topologies (no React), then assert `checkPing` result:
- T1 — same-subnet ping succeeds
- T2 — switch unconfigured, same-subnet PCs reach each other
- T3 — SVI ping succeeds; SVI unreachable before `no shutdown`
- T4 — two-router static routing, both routes required
- **T5** — one-way route: `failureReason === 'no_return_path'`, not success
- T6 — host no default gateway: off-subnet fails, own subnet succeeds
- **T7** — wrong mask: ping fails even though cable and peer are fine
- T8 — shutdown interface: ping fails, peer interface is `'down'` after fix

Additional negative cases:
- Missing return path for multi-hop (T5 variant with R3)
- Admin-down source interface → `failureReason === 'admin_down'`
- VLAN isolation: PC in VLAN 1 cannot ping PC in VLAN 2
- Trunk port carries traffic between router-on-a-stick subinterfaces (when added)

### CLIEngine unit tests
- `ip address` on physical switch port → rejected
- `ip address` on SVI → accepted
- `ip route` on switch → rejected
- `no shutdown` wake-up: peer goes from 'down' to 'up'
- `shutdown` carrier-loss: peer goes from 'up' to 'down' (after Phase 2 fix)
- Overlapping subnet on same router → rejected (after Phase 2 fix)
- `enable` / `configure terminal` / `interface` / `exit` / `end` state machine
- `no ip route` removes exactly the matching route

---

## Phase 4 — Status

- [x] All BUGGY items fixed (B3 shutdown peer propagation; BFS remote-interface check)
- [x] All MISSING items fixed that were in scope (D6 overlapping-subnet; F2 static RTT)
- [x] `npm test` passes — 174/174 tests (4 files, includes 37 new ROAS tests)
- [x] `npx vite build` passes — only the expected xterm chunk-size warning
- [ ] Mission 001 confirmed playable end-to-end (manual verification pending)

### Phase 5 — Router-on-a-Stick (ROAS) sprint (2026-06-17)

| File | Change |
|------|--------|
| `Device.js` | Added `getParentIfName()`, `createSubinterface()`, `refreshSubifs()` |
| `CLIEngine.js` | `interface <name>.<num>` creates subinterface + enters `subif_config` mode |
| `CLIEngine.js` | `encapsulation dot1Q <vlan> [native]` sets vlanTag on subinterface |
| `CLIEngine.js` | `subif_config` mode: `shutdown`/`no shutdown` operate on `sub_shutdown` flag |
| `CLIEngine.js` | `show ip interface brief` lists subinterfaces; `show interfaces trunk` added |
| `CLIEngine.js` | `show running-config` renders subinterface blocks |
| `CLIEngine.js` | `no encapsulation dot1q`, `no interface <subif>`, `no interface vlan <id>`, `no vlan <id>`, `no switchport access vlan` implemented |
| `Topology.js` | BFS composite visited key `sw.id:ingressVlan` — allows re-entry with different VLAN context |
| `Topology.js` | ROAS router check: tagged frame discarded if no matching `encap dot1Q` subinterface is `up` |
| `Topology.js` | `_checkVlanIsolation` updated to see through subinterfaces via parent `connected_to` |
| `Topology.js` | `connect`/`disconnect`/`shutdownPeer` call `refreshSubifs` for router devices |
| `roas.test.js` | 37 new tests covering all 9 ROAS invariants |

### What was fixed
| File | Change |
|------|--------|
| `Topology.js` | Added `shutdownPeer()` method — propagates carrier-loss to peer on shutdown |
| `Topology.js` | `_bfsReach` now verifies remote interface is `'up'` before traversing a cable |
| `Topology.js` | `findPath` same remote-interface check for consistency |
| `CLIEngine.js` | `shutdown` calls `topology.shutdownPeer()` — peer now drops to `'down'` |
| `CLIEngine.js` | `_cmdIp address` rejects overlapping subnets on same router |
| `CLIEngine.js` | Synchronous `_cmdPing` now calculates RTT dynamically (matches async version) |
| `PCCLIEngine.js` | `_linkSet state==='down'` calls `topology.shutdownPeer()` |
| `PCCLIEngine.js` | `_cmdIfconfig 'down'` calls `topology.shutdownPeer()` |
| `vite.config.js` | Added `test: { environment: 'node' }` for Vitest |
| `package.json` | Added `"test": "vitest run"` script |

### What was deliberately NOT fixed (open questions for you)
- `subnet_mismatch` / `vlan_isolated` failure reasons — collapse to `no_route`; behaviour is correct, diagnostic codes aren't. Needs design decision before fault-injection missions. (`host_no_gateway` is now emitted — see Q1 below.)
- Missing `no vlan`, `no interface vlan`, `no switchport access vlan` commands — needed before mission 004.
- Full LPM across connected+static in the same router (very unlikely to matter in current mission scope).

---

## Open questions for you to decide

1. **`host_no_gateway` vs `no_route`**: ✅ **Resolved.** `host_no_gateway` is now
   emitted as a pre-BFS check in `checkPing()` when: source is PC/server, dstIp
   is off all connected subnets, and no default route exists with a next-hop
   reachable via a connected subnet. Routers with no matching route still emit
   `no_route`. PCCLIEngine display ("Network is unreachable") is unchanged.

2. **`subnet_mismatch` reason**: ✅ **Resolved.** Emitted post-BFS in `checkPing()`
   when: BFS returned `no_route`, source is PC/server, source considers dstIp
   off-subnet (guard against VLAN-isolation false positives), dst IP exists in the
   topology with an up interface, and from dst's perspective (dst's own mask) the
   source falls inside dst's subnet. Priority: fires before `host_no_gateway`.
   PCCLIEngine maps it to "Network is unreachable"; IOS maps it to "Destination
   host unreachable (subnet mismatch)".

3. **Synchronous `_cmdPing` RTT**: Should the static `1/2/10 ms` be replaced with
   the same dynamic calculation used in `executePingAsync`? Low effort fix, mostly
   cosmetic. **Recommend: yes.**

4. **Router-on-a-stick subinterfaces**: ✅ **Resolved (2026-06-17).** Full ROAS
   model implemented: subinterface creation (`interface GigabitEthernet0/0.10`),
   `encapsulation dot1Q <vlan>`, parent-state propagation via `refreshSubifs`,
   BFS VLAN-context propagation through trunk links, `vlan_isolated` emitted
   on ROAS misconfiguration. 37 invariant tests green. See Phase 5 above.
