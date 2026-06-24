# NetSim — Sandbox Verification Lab

A step-by-step lab to confirm the engine obeys real networking rules. Run these in
the **Sandbox** tab. Each test says exactly what to place, what to type, what you
should see, and **why** it's true on real gear. Do them in order — they build up.

> Convention: router CLI is Cisco IOS style; PC/Server CLI is Linux style.
> Router interfaces start **shut down**, so every router interface needs
> `no shutdown`. PC interfaces are brought up with `ip link set ... up`.
> Find a PC's interface name with `ip addr` (it's usually `eth0`).

---

## Test 1 — Same subnet, one router + one PC (baseline)
**Proves:** basic IP addressing and a same-subnet ping work.

**Place:** 1 Router (R1), 1 PC (PC1). Cable PC1 to a router port.

**On R1** (open its terminal):
```
enable
configure terminal
interface GigabitEthernet0/0
ip address 192.168.1.1 255.255.255.0
no shutdown
exit
end
show ip interface brief
```
You should see Gig0/0 with IP 192.168.1.1, status **up / up**.

**On PC1:**
```
ip addr add 192.168.1.10/24 dev eth0
ip link set eth0 up
ping 192.168.1.1
```
**Expected:** replies come back (success). PC1 and R1 are in the same subnet
(192.168.1.0/24), so no routing is involved at all — they talk directly.

---

## Test 2 — Layer 2 switch, flat LAN (the big L2 lesson)
**Proves:** a switch needs NO IP config for same-subnet hosts to talk, AND that
you cannot put an IP on a physical switch port.

**Place:** 1 Switch (SW1), 3 PCs (PC1, PC2, PC3). Cable each PC to SW1. **Do not
configure the switch at all.**

**On each PC** (unique IP, same subnet):
```
# PC1
ip addr add 192.168.1.10/24 dev eth0
ip link set eth0 up
# PC2
ip addr add 192.168.1.11/24 dev eth0
ip link set eth0 up
# PC3
ip addr add 192.168.1.12/24 dev eth0
ip link set eth0 up
```
**From PC1:**
```
ping 192.168.1.11
ping 192.168.1.12
```
**Expected:** both succeed — with the switch completely unconfigured. A Layer 2
switch forwards frames by MAC address; same-subnet hosts don't need it to have an
IP. This is the single most surprising idea for beginners, and it should "just
work" here.

**Now confirm the switch refuses Layer 3 config.** On SW1:
```
enable
configure terminal
interface GigabitEthernet0/1
ip address 10.0.0.1 255.255.255.0
```
**Expected:** the `ip address` line is **rejected** with an IOS-style error
(`% Invalid input detected`). A physical switch port is Layer 2 only — it has no IP.
If this is accepted, the L2 model is wrong and must be fixed before going further.

---

## Test 3 — Switch management IP (the SVI)
**Proves:** a switch's one management IP lives on an SVI, not a port.

**Reuse Test 2's topology.** On SW1:
```
enable
configure terminal
interface vlan 1
ip address 192.168.1.2 255.255.255.0
no shutdown
end
show ip interface brief
```
**On PC1:** `ping 192.168.1.2`
**Expected:** success — you're pinging the switch's management interface. Note this
IP is for *managing the switch*, not for routing host traffic. (Best practice in
the real world: use a dedicated management VLAN, not VLAN 1 — but VLAN 1 is the
default and fine for this test.)

---

## Test 4 — Two routers, static routing done RIGHT
**Proves:** routers only know their directly-connected networks; reaching a remote
network needs a static route — on BOTH routers.

**Place:** PC1 — R1 — R2 — PC2 (cable: PC1↔R1 Gig0/0, R1 Gig0/1↔R2 Gig0/1,
R2 Gig0/0↔PC2).

**Addressing plan** (write this down — half of networking is keeping addresses
straight):

| Device | Interface | IP address      | Mask / prefix        | Notes                    |
|--------|-----------|-----------------|----------------------|--------------------------|
| PC1    | eth0      | 192.168.1.10    | /24 (255.255.255.0)  | gateway = 192.168.1.1    |
| R1     | Gig0/0    | 192.168.1.1     | 255.255.255.0        | PC1's gateway            |
| R1     | Gig0/1    | 10.0.0.1        | 255.255.255.252 (/30)| link to R2               |
| R2     | Gig0/1    | 10.0.0.2        | 255.255.255.252 (/30)| link to R1               |
| R2     | Gig0/0    | 192.168.2.1     | 255.255.255.0        | PC2's gateway            |
| PC2    | eth0      | 192.168.2.10    | /24 (255.255.255.0)  | gateway = 192.168.2.1    |

> Why /30 on the router-to-router link? A /30 (mask 255.255.255.252) gives exactly
> two usable addresses (.1 and .2) — perfect for a point-to-point link with no
> wasted IPs. Network = 10.0.0.0, usable = .1 and .2, broadcast = 10.0.0.3.

**On R1:**
```
enable
configure terminal
interface GigabitEthernet0/0
ip address 192.168.1.1 255.255.255.0
no shutdown
exit
interface GigabitEthernet0/1
ip address 10.0.0.1 255.255.255.252
no shutdown
exit
ip route 192.168.2.0 255.255.255.0 10.0.0.2
end
show ip route
```
**On R2:**
```
enable
configure terminal
interface GigabitEthernet0/1
ip address 10.0.0.2 255.255.255.252
no shutdown
exit
interface GigabitEthernet0/0
ip address 192.168.2.1 255.255.255.0
no shutdown
exit
ip route 192.168.1.0 255.255.255.0 10.0.0.1
end
show ip route
```
**On PC1:**
```
ip addr add 192.168.1.10/24 dev eth0
ip link set eth0 up
ip route add default via 192.168.1.1
```
**On PC2:**
```
ip addr add 192.168.2.10/24 dev eth0
ip link set eth0 up
ip route add default via 192.168.2.1
```
**From PC1:** `ping 192.168.2.10`
**Expected:** success. Each router knows its two connected networks automatically;
the static routes teach each one how to reach the *far* LAN. With both routes in
place, the request gets there AND the reply gets home.

---

## Test 5 — One-way route (THE most important test)
**Proves:** a ping needs BOTH a forward path and a return path. This is the bug
that fools every new engineer.

**Reuse Test 4's working topology**, but on **R2 only**, remove the return route:
```
enable
configure terminal
no ip route 192.168.1.0 255.255.255.0 10.0.0.1
end
show ip route
```
Now R1 still knows how to reach 192.168.2.0, but R2 no longer knows how to reach
192.168.1.0.

**From PC1:** `ping 192.168.2.10`
**Expected:** **FAILS** (times out). Internally the engine should classify this as
`no_return_path` — not a silent success.

What's happening, step by step:
- The echo **request** travels PC1 → R1 → R2 → PC2 just fine (R1 has its route). ✅
- PC2 sends its **reply** toward 192.168.1.10. It reaches R2.
- R2 checks its routing table for 192.168.1.0/24 — **no route** — so it drops the
  reply. ❌
- PC1 never hears back → timeout.

The forward path was perfect and the ping still failed. **Fix it** by re-adding the
route on R2:
```
configure terminal
ip route 192.168.1.0 255.255.255.0 10.0.0.1
end
```
Ping again from PC1 → now it succeeds. That "ohh, *both* sides needed a route"
moment is the whole lesson. If Test 5 shows a success when R2's route is missing,
the return-path logic is broken and must be fixed before building anything else.

---

## Test 6 — Missing default gateway on a host
**Proves:** a host can reach its own subnet without a gateway, but needs one to
reach anything off-subnet.

**Reuse Test 4's fully-working topology.** On **PC2**, remove its default route:
```
ip route del default
```
**From PC2:**
```
ping 192.168.2.1
ping 192.168.1.10
```
**Expected:** the first succeeds (192.168.2.1 is in PC2's own subnet, no gateway
needed); the second **fails** (`Network is unreachable` / `host_no_gateway`) —
PC2 has no idea how to leave its own subnet. Restore with
`ip route add default via 192.168.2.1` and it works again.

---

## Test 7 — Wrong subnet mask
**Proves:** the mask decides what a host thinks is "local," and a wrong one
silently breaks reachability.

**Place:** SW1 + PC1 + PC2. Addresses far apart in the /24:
```
# PC1
ip addr add 192.168.1.10/24 dev eth0
ip link set eth0 up
# PC2
ip addr add 192.168.1.200/24 dev eth0
ip link set eth0 up
```
**From PC1:** `ping 192.168.1.200` → succeeds (same /24 subnet).

Now break PC1's mask — change it to /25:
```
ip addr del 192.168.1.10/24 dev eth0
ip addr add 192.168.1.10/25 dev eth0
```
A /25 (255.255.255.128) splits the range: PC1 now believes its subnet is only
192.168.1.0–192.168.1.127. So it sees 192.168.1.200 as a *different* subnet and
tries to route to a gateway it doesn't have.

**From PC1:** `ping 192.168.1.200`
**Expected:** **fails** (`subnet_mismatch` / unreachable), even though the cable
and the other host are perfectly fine. The mask alone broke it. Restore /24 to fix.

---

## Test 8 — Shutdown interface (quick check)
**Proves:** the three interface states are distinct, and `shutdown` really stops
traffic.

**Reuse any working router link.** On the router:
```
configure terminal
interface GigabitEthernet0/0
shutdown
end
show ip interface brief
```
**Expected:** that interface shows **administratively down**, and pings across it
fail. `no shutdown` brings it back to up/up and pings work again. (Note the
difference from a cable being unplugged, which shows **down/down** — a different
state with a different cause.)

---

## Scorecard
If all of these behave as described, the foundation is accurate and safe to build
missions on:

- [ ] T1 same-subnet ping works
- [ ] T2 flat LAN works with switch unconfigured **and** switch rejects port IP
- [ ] T3 switch reachable via SVI
- [ ] T4 two-router static routing works with both routes
- [ ] T5 one-way route FAILS (no_return_path), then works once both routes exist
- [ ] T6 host can't leave its subnet without a default gateway
- [ ] T7 wrong mask breaks an otherwise-fine ping
- [ ] T8 admin-down interface blocks traffic and shows the right state

Any test that doesn't match is a bug to fix before moving on — that's the whole
point of having the sandbox.