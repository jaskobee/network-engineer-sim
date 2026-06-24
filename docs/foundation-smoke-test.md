# NetSim — Foundation Smoke Test (Beginner-Friendly)

A step-by-step check that everything built so far works. Written so someone with
**zero networking knowledge** can follow it. Six tests, each touching a different
part of the system. Run everything in the **Sandbox** tab.

If all the checkboxes at the end pass, the foundation is solid.

---

## First: how to use the Sandbox (read this once)

You'll repeat these four actions throughout. Learn them here.

**1. Place a device on the map**
In the Sandbox, find the device palette (the list of devices: Router, Switch, PC,
Server, ISP). Click or drag one onto the empty map area. It appears as an icon with
a name like `router-1`, `pc-1`, etc. Repeat to add more. You can drag placed icons
around to tidy them up.

**2. Connect two devices with a cable**
A "cable" links a specific **port** on one device to a specific **port** on another.
- Click a device to select it. A panel appears (usually bottom-left) showing that
  device's **ports** (also called interfaces) in a list, with columns like
  IP / Status / Connected to.
- At the bottom of that panel there are two dropdowns and a **Cable** button:
  the first dropdown = *this device's port*, the second = *the other device and its
  port* (the "remote port").
- Pick a port on this device, pick the port on the other device, then click
  **Cable**. A line appears on the map between them — that's your cable.

> **Ports have names.** Routers and switches use names like `GigabitEthernet0/0`,
> `GigabitEthernet0/1`, etc. (think of them as "port 0", "port 1"…). A PC has a
> single port, shown in its Linux terminal as `eth0`. When a test says "connect
> router port Gig0/0 to the PC," pick `GigabitEthernet0/0` in the router's dropdown
> and the PC's single port as the remote end.

**3. Open a device's terminal (to type commands)**
Right-click a device → **Open Terminal** (or click its tab along the bottom). A black
command window opens. Click inside it and type. Press **Enter** after each line.

**4. Know the difference between the two terminal styles**
- **Routers and Switches** use Cisco commands (`enable`, `configure terminal`, …).
- **PCs and Servers** use Linux commands (`ip addr`, `ping`, …).
Just type the lines exactly as written in each test.

> **Golden rule (this catches 90% of mistakes):** the cable and the IP address must
> be on the **same port**. If you plug the cable into port Gig0/0, put the IP on
> Gig0/0 — not Gig0/1. After configuring, run `show ip interface brief` on a
> router; the port should say **up / up**. If it says **up / down**, the cable and
> the IP are on different ports.

> **Tip:** use the "Clear Sandbox" button between tests so old devices don't get in
> the way. Or build each test in a different empty corner of the map.

---

## Test 1 — Two devices talk on the same network
**What it proves:** basic addressing and a direct connection work.

**Build it:**
1. Place **1 Router** and **1 PC**.
2. Cable the **Router's port `GigabitEthernet0/0`** to the **PC's port**.

**Configure the Router** (open its terminal, type these):
```
enable
configure terminal
interface GigabitEthernet0/0
ip address 192.168.1.1 255.255.255.0
no shutdown
end
show ip interface brief
```
- `enable` / `configure terminal` = enter setup mode.
- `interface GigabitEthernet0/0` = "I want to configure the port the cable is on."
- `ip address …` = give that port an address (192.168.1.1) and a network size (the
  255.255.255.0 part).
- `no shutdown` = turn the port on (router ports start off).
- `show ip interface brief` = list the ports. **Gig0/0 should say `up  up`.**

**Configure the PC** (open its terminal):
```
ip addr add 192.168.1.10/24 dev eth0
ip link set eth0 up
ping 192.168.1.1
```
- First line = give the PC the address 192.168.1.10 on the same network.
- Second line = turn the PC's port on.
- `ping 192.168.1.1` = "are you there?" sent to the router.

✅ **PASS:** the ping gets replies, and the router's Gig0/0 shows `up up`.

---

## Test 2 — A switch connects many devices (and is NOT a router)
**What it proves:** the switch works at "Layer 2" — it connects devices on the same
network with no setup, and it correctly refuses router-style configuration.

**Build it:**
1. Place **1 Switch**, **2 PCs** (pc-1, pc-2).
2. Cable **pc-1 → Switch port `GigabitEthernet0/1`**.
3. Cable **pc-2 → Switch port `GigabitEthernet0/2`**.
4. **Do not configure the switch** — that's the point.

**Configure the PCs:**
```
# On pc-1's terminal:
ip addr add 192.168.1.10/24 dev eth0
ip link set eth0 up

# On pc-2's terminal:
ip addr add 192.168.1.11/24 dev eth0
ip link set eth0 up

# Back on pc-1:
ping 192.168.1.11
```
✅ The two PCs reach each other **even though the switch has zero configuration.**
That's how a real switch behaves.

**Now prove the switch refuses router config.** Open the **Switch** terminal:
```
enable
configure terminal
interface GigabitEthernet0/1
ip address 10.0.0.1 255.255.255.0
```
✅ The last line must be **rejected** (an error like `% Invalid input…`). A switch
port cannot have an IP address — only a router port can.

**And confirm the switch's one allowed address (for managing it):**
```
interface vlan 1
ip address 192.168.1.2 255.255.255.0
no shutdown
end
```
Then from **pc-1**: `ping 192.168.1.2` → ✅ replies.

✔ **PASS** if: the two PCs talk with the switch unconfigured, the port `ip address`
is rejected, and the switch's `vlan 1` address answers a ping.

---

## Test 3 — Two networks joined by routers (the most important test)
**What it proves:** routers only know networks plugged directly into them; to reach a
*far* network you must add a "route" — and you must add it on **BOTH** routers, or
traffic gets there but can't get back.

**Build it** (5 cables — follow carefully):
1. Place **2 Routers** (router-1, router-2) and **2 PCs** (pc-1, pc-2).
2. Cable **pc-1 → router-1 port `GigabitEthernet0/0`**  (router-1's LAN side).
3. Cable **router-1 port `GigabitEthernet0/1` → router-2 port `GigabitEthernet0/1`**
   (the link between the two routers).
4. Cable **pc-2 → router-2 port `GigabitEthernet0/0`**  (router-2's LAN side).

**Addresses to use** (notice each IP is on the port you just cabled):
| Device   | Port (Gig0/0 = LAN)         | Port (Gig0/1 = router link)  |
|----------|-----------------------------|------------------------------|
| router-1 | 192.168.1.1  /24            | 10.0.0.1  /30                |
| router-2 | 192.168.2.1  /24            | 10.0.0.2  /30                |

**Configure router-1:**
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
end
show ip interface brief        # BOTH ports should say up / up
```
**Configure router-2:**
```
enable
configure terminal
interface GigabitEthernet0/0
ip address 192.168.2.1 255.255.255.0
no shutdown
exit
interface GigabitEthernet0/1
ip address 10.0.0.2 255.255.255.252
no shutdown
end
show ip interface brief        # BOTH ports should say up / up
```
**Configure the PCs:**
```
# pc-1:
ip addr add 192.168.1.10/24 dev eth0
ip link set eth0 up
ip route add default via 192.168.1.1     # "send far-away traffic to my router"

# pc-2:
ip addr add 192.168.2.10/24 dev eth0
ip link set eth0 up
ip route add default via 192.168.2.1
```

**Now the lesson.** Add a route on **router-1 only**:
```
# router-1:
configure terminal
ip route 192.168.2.0 255.255.255.0 10.0.0.2
end
```
From **pc-1**: `ping 192.168.2.10` → ❌ **FAILS.** (The message can leave, but
router-2 doesn't know how to send the reply back yet.)

Add the matching route on **router-2**:
```
# router-2:
configure terminal
ip route 192.168.1.0 255.255.255.0 10.0.0.1
end
```
From **pc-1**: `ping 192.168.2.10` → ✅ **now works.**

✔ **PASS** if the ping fails with one route and only succeeds after **both** routes
exist. (This "both directions" rule is the single most important behavior in the
whole engine.)

---

## Test 4 — One router serving two VLANs (router-on-a-stick)
**What it proves:** the hardest mechanic — splitting one router port into two
"sub-ports," one per VLAN, so two separate networks share a single router link.

**Build it:**
1. Place **1 Router**, **1 Switch**, **2 PCs** (pc-1, pc-2).
2. Cable **pc-1 → Switch `GigabitEthernet0/1`**.
3. Cable **pc-2 → Switch `GigabitEthernet0/2`**.
4. Cable **Switch `GigabitEthernet0/3` → Router `GigabitEthernet0/0`**.

**Configure the Switch** (put each PC in a different VLAN, make the router link a
"trunk" that carries both):
```
enable
configure terminal
vlan 10
exit
vlan 20
exit
interface GigabitEthernet0/1
switchport mode access
switchport access vlan 10
exit
interface GigabitEthernet0/2
switchport mode access
switchport access vlan 20
exit
interface GigabitEthernet0/3
switchport mode trunk
end
```

**Configure the Router** (the physical port has NO address but must be ON; the two
sub-ports `.10` and `.20` hold the addresses):
```
enable
configure terminal
interface GigabitEthernet0/0
no shutdown
exit
interface GigabitEthernet0/0.10
encapsulation dot1Q 10
ip address 192.168.10.1 255.255.255.0
exit
interface GigabitEthernet0/0.20
encapsulation dot1Q 20
ip address 192.168.20.1 255.255.255.0
end
show ip route
```
- `interface GigabitEthernet0/0.10` = a sub-port for VLAN 10.
- `encapsulation dot1Q 10` = "this sub-port handles VLAN 10's traffic." (This line is
  what actually ties it to VLAN 10 — not the `.10` in the name.)

**Configure the PCs:**
```
# pc-1 (VLAN 10):
ip addr add 192.168.10.10/24 dev eth0
ip link set eth0 up
ip route add default via 192.168.10.1

# pc-2 (VLAN 20):
ip addr add 192.168.20.10/24 dev eth0
ip link set eth0 up
ip route add default via 192.168.20.1
```
From **pc-1**: `ping 192.168.20.10` → ✅ works (two VLANs talking through one router).

**Quick break test:** on the Switch, change the router link to access mode:
```
configure terminal
interface GigabitEthernet0/3
switchport mode access
end
```
Now `ping 192.168.20.10` from pc-1 → ❌ fails. Set it back to `switchport mode trunk`
→ ✅ works again. (A single-VLAN "access" link can't carry both VLANs.)

✔ **PASS** if cross-VLAN ping works as a trunk and fails as access.

---

## Test 5 — Connecting a router to the internet (ISP)
**What it proves:** the "default route" — one catch-all rule for reaching anything
not on your own networks.

> Needs the **ISP** node in the Sandbox palette. If it isn't there yet, skip this
> test for now and come back after it's added.

**Build it:**
1. Place **1 Router** and the **ISP** node.
2. Cable **Router `GigabitEthernet0/1` → ISP port `WAN0/0`**.

**Configure the Router** (the ISP's side is fixed at `203.0.113.1`; you take
`203.0.113.2`):
```
enable
configure terminal
interface GigabitEthernet0/1
ip address 203.0.113.2 255.255.255.252
no shutdown
exit
ip route 0.0.0.0 0.0.0.0 203.0.113.1
end
show ip route
ping 203.0.113.1
```
- `ip route 0.0.0.0 0.0.0.0 203.0.113.1` = "for ANY destination I don't otherwise
  know, send it to the ISP." This is the **default route**.
- In `show ip route` you should see a line starting with **`S*`** — the star means
  "gateway of last resort," i.e. the default route is active.

✅ **PASS** if the router's Gig0/1 is `up up`, the `S*` line appears, and the router
can ping `203.0.113.1`.

---

## Test 6 — Automatic addressing (DHCP) and the relay rule
**What it proves:** a router can hand out IP addresses automatically, AND that these
requests don't cross a router unless you set up a "helper."

### Part 6a — DHCP on the same network
**Build it:**
1. Place **1 Router**, **1 Switch**, **1 PC**.
2. Cable **Router `GigabitEthernet0/0` → Switch `GigabitEthernet0/1`**.
3. Cable **PC → Switch `GigabitEthernet0/2`**.

**Configure the Router** (give it an address, then set up the address pool):
```
enable
configure terminal
interface GigabitEthernet0/0
ip address 192.168.1.1 255.255.255.0
no shutdown
exit
ip dhcp excluded-address 192.168.1.1 192.168.1.10
ip dhcp pool LAN1
network 192.168.1.0 255.255.255.0
default-router 192.168.1.1
end
```
- `excluded-address …1 …10` = "never hand out .1 through .10" (so the router's own
  .1 stays safe).
- `ip dhcp pool LAN1` + `network` + `default-router` = the batch of addresses to give
  out, and the gateway to tell each PC about.

**On the PC:**
```
ip link set eth0 up
dhclient eth0
ip addr show eth0
```
- `dhclient eth0` = "ask the network for an address automatically."

✅ **PASS (6a):** the PC receives an address of **192.168.1.11 or higher** (never the
excluded ones), and it automatically got a gateway too — all from one command.

### Part 6b — DHCP across a router needs a "helper"
**Build it:** use the **Test 3 two-router setup** again (both routers, the link
between them, and the static routes in BOTH directions so they can reach each other).
Put the PC on **router-2's** side.

**On router-1, add an address pool for router-2's network:**
```
configure terminal
ip dhcp excluded-address 192.168.2.1
ip dhcp pool LAN2
network 192.168.2.0 255.255.255.0
default-router 192.168.2.1
end
```
**On the PC (router-2's side):**
```
ip link set eth0 up
dhclient eth0
```
❌ **It fails** — no address. The request can't cross router-2 to reach the DHCP
server on router-1. (Address requests are "broadcasts," which routers block.)

**The fix — add a helper on router-2's port facing the PC:**
```
# router-2:
configure terminal
interface GigabitEthernet0/0
ip helper-address 10.0.0.1
end
```
- `ip helper-address 10.0.0.1` = "forward address requests to the DHCP server at
  10.0.0.1 (router-1)."

**On the PC, try again:**
```
dhclient eth0
```
✅ **Now it gets an address** from router-1's LAN2 pool.

✔ **PASS (6b)** if the PC gets nothing **without** the helper and an address **with**
it.

---

## Scorecard — is the foundation healthy?
- [ ] **T1** — Router and PC ping each other on the same network
- [ ] **T2** — Two PCs talk through an unconfigured switch · switch rejects a port IP
      · switch's `vlan 1` address answers a ping
- [ ] **T3** — Ping fails with one route, works only after BOTH routes are added
- [ ] **T4** — Two VLANs talk through one router (trunk) · fails when set to access
- [ ] **T5** — Default route shows `S*` · router can ping the ISP
- [ ] **T6a** — PC gets an address (and gateway) automatically; excluded range respected
- [ ] **T6b** — DHCP fails across a router until a helper is added

**All boxes checked = the foundation is solid and ready for bigger missions.**

If any test misbehaves, write down the test number and exactly what you saw on
screen — that's the precise clue needed to find whether it's a setup mistake or a
real bug.
