# NetSim — DHCP & Relay Sandbox Lab

A follow-along lab to set up a router as a DHCP server, watch a PC get its full
config automatically, then learn the single most important DHCP rule by breaking it:
**DHCP broadcasts don't cross routers — you need `ip helper-address` to relay them.**
Run it in the **Sandbox** tab.

> Router CLI is Cisco IOS style; PC CLI is Linux style. Bring a PC interface UP
> (`ip link set eth0 up`) before running `dhclient` on it, just like real Linux.

---

## Why DHCP (the one-breath version)

Hand-configuring an IP, mask, gateway, and DNS on every host doesn't scale — real
networks have a **DHCP server** hand out that config automatically. The exchange is
**DORA**: the client broadcasts a **D**iscover, the server sends an **O**ffer, the
client sends a **R**equest, the server sends an **A**cknowledge. The catch you'll
prove in Part 2: Discover is a *broadcast*, and broadcasts stop at a router — so a
server on another subnet can't hear the client unless a router *relays* for it.

---

# PART 1 — DHCP on the same subnet (the happy path)

## Topology
```
   [ R1 ]  Gig0/0 = 192.168.1.1/24   ← DHCP server + gateway for this LAN
      |
   [ SW1 ]
      |
   [ PC1 ]  (no IP yet — will get one from DHCP)
```

## Step 1 — Place and cable
Place **1 Router (R1)**, **1 Switch (SW1)**, **1 PC (PC1)**.
Cable: R1 Gig0/0 → SW1, PC1 → SW1.

## Step 2 — Give R1 its LAN interface (the gateway)
```
enable
configure terminal
interface GigabitEthernet0/0
ip address 192.168.1.1 255.255.255.0
no shutdown
exit
```

## Step 3 — Configure the DHCP server on R1
```
ip dhcp excluded-address 192.168.1.1 192.168.1.10
ip dhcp pool LAN1
network 192.168.1.0 255.255.255.0
default-router 192.168.1.1
dns-server 8.8.8.8
exit
end
```
What each line does:
- `excluded-address 192.168.1.1 192.168.1.10` — reserve .1–.10 so the server never
  hands out the router's own IP (.1) or any address you want kept for static use.
  **Forgetting this is a classic real-world bug** — without it the pool can lease out
  the gateway's address and cause a conflict.
- `network` — the subnet to assign from.
- `default-router` — the gateway the clients will receive (this is why DHCP clients
  can reach other subnets with zero manual config).
- `dns-server` — handed to clients too.

## Step 4 — Ask for an address from PC1
```
ip link set eth0 up
dhclient eth0
ip addr show eth0
```
**Expected:** PC1 receives an address in 192.168.1.0/24 but **not** in the excluded
.1–.10 range (so .11 or higher). `ip addr` shows it marked as a dynamic/global
address. Crucially, PC1 now also has a **default gateway (192.168.1.1) and DNS** —
all from one command, no manual `ip addr add` / `ip route add`.

## Step 5 — Verify on the server
```
(on R1)
show ip dhcp binding
show ip dhcp pool
```
**Check:** `show ip dhcp binding` lists PC1's leased address; `show ip dhcp pool`
shows leased/available counts. The server is tracking the lease.

## Step 6 — Prove the assigned gateway actually works
Add a second PC (PC2) to SW1, `dhclient` it, then from PC1:
```
ping <PC2's assigned address>
```
**Expected:** success — two hosts addressed entirely by DHCP, talking to each other,
with zero manual IP config. That's the friction relief DHCP buys you.

---

# PART 2 — DHCP across a router (the relay lesson)

This is the part that makes DHCP a real networking topic. We put the server and the
client on **different subnets**, separated by a router, and watch it fail — then fix
it the correct way.

## Topology
```
  [ PC-A ]                                   [ PC-B ]
     |                                          |
  [ SW-A ]                                   [ SW-B ]
     |                                          |
  R1 Gig0/0                                  R2 Gig0/0
  192.168.10.1/24                            192.168.20.1/24
     |                                          |
     +----- R1 Gig0/1 ===(WAN)=== R2 Gig0/1 ----+
              10.0.0.1/30        10.0.0.2/30

  DHCP server lives on R1 (pools for BOTH LANs).
  PC-B is across R2 — a different subnet from the server.
```

## Step 7 — Build it and get routing working FIRST
Configure both routers' interfaces, the WAN link (10.0.0.0/30), and **static routes
both directions** so R1 and R2 can reach each other's LAN subnets — exactly like
Sandbox Test 4 / Mission 003. Confirm with `show ip route` and a router-to-router
`ping 10.0.0.2`. (DHCP relay rides on top of working routing, so prove routing
first.)

## Step 8 — Put BOTH pools on R1
```
(on R1)
configure terminal
ip dhcp excluded-address 192.168.10.1
ip dhcp excluded-address 192.168.20.1
ip dhcp pool LAN10
network 192.168.10.0 255.255.255.0
default-router 192.168.10.1
exit
ip dhcp pool LAN20
network 192.168.20.0 255.255.255.0
default-router 192.168.20.1
exit
end
```
Note R1 holds a pool for the *remote* LAN (192.168.20.0/24) too — its `default-router`
is R2's interface (.20.1), because that's the gateway PC-B should use.

## Step 9 — Local client works immediately
On **PC-A** (same subnet as the server): `ip link set eth0 up` then `dhclient eth0`.
**Expected:** PC-A gets a 192.168.10.x address. (The server is on its own segment —
no relay needed.)

## Step 10 — The break: remote client gets NOTHING
On **PC-B** (across R2 from the server):
```
ip link set eth0 up
dhclient eth0
```
**Expected: FAILS** — no address, a realistic "no DHCPOFFERS"/timeout, interface
stays unaddressed. **Why:** PC-B's Discover is a *broadcast*. It reaches R2's
Gig0/0 and **stops there** — routers don't forward broadcasts. The DHCP server on R1
never even hears the request. This is the core lesson: *DHCP does not cross a router
on its own.*

## Step 11 — The fix: relay with ip helper-address
On **R2**, on the interface FACING THE CLIENTS (Gig0/0, the 192.168.20.0/24 side):
```
configure terminal
interface GigabitEthernet0/0
ip helper-address 10.0.0.1
exit
end
```
(Point the helper at an address of the server R2 can route to — here R1's WAN IP.)

Now retry on **PC-B**:
```
dhclient eth0
ip addr show eth0
```
**Expected: SUCCESS** — PC-B gets a 192.168.20.x address with R2 as its gateway.
**Why:** the helper turns PC-B's broadcast into a *unicast* the router forwards to
the server, stamped with the relay (giaddr) info so R1 knows to assign from the
**LAN20** pool. The relay rides on your working routing from Step 7.

---

# Break tests — prove each requirement is load-bearing

## Break A — relay needs working routing
With the helper configured and PC-B working, remove R2's return route to the server's
subnet (or R1's route to LAN20). `dhclient` on PC-B now **fails again** — the relay's
unicast (or the server's reply) can't be routed. Restore the route → works.
**Lesson:** `ip helper-address` doesn't bypass routing; if the relay and server can't
reach each other, DHCP fails.

## Break B — pool exhaustion
Make a tiny pool (e.g. exclude all but one or two host addresses), lease them with a
couple of PCs, then `dhclient` one more PC. **Expected:** the extra client gets no
address — the pool is exhausted. Real and honest failure, not a fake address.

## Break C — release and re-lease
On a working DHCP client: `dhclient -r eth0` → its address is cleared and the
server's binding for it disappears (`show ip dhcp binding`). `dhclient eth0` again →
it gets an address back. **Lesson:** leases are tracked state, and releasing frees
the address.

---

## Scorecard
- [ ] Part 1: PC gets IP + gateway + DNS from one `dhclient` command
- [ ] Excluded range respected — gateway/.1 never handed out
- [ ] `show ip dhcp binding` lists the lease
- [ ] Two DHCP-only hosts can ping each other (assigned gateway works)
- [ ] Part 2 Step 10: remote client across a router gets NO address (broadcast stops)
- [ ] Part 2 Step 11: `ip helper-address` fixes it; correct remote pool used
- [ ] Break A: relay fails without working routing between relay and server
- [ ] Break B: exhausted pool → no address (honest failure)
- [ ] Break C: `dhclient -r` frees the address and removes the binding

When every box checks out, your DHCP + relay model is verified — and you understand
the broadcast-boundary lesson that makes DHCP a real networking skill. This is the
mechanism the bigger missions will use so players configure pools instead of
hand-addressing every host.
```