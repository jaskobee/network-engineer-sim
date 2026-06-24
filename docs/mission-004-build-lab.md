# NetSim — Mission 004 Capstone Build Walkthrough (Beginner-Friendly)

Build the entire TechNova small-office network by hand, end to end: four VLANs,
router-on-a-stick, DHCP for clients, a static server, the ISP link, and NAT to the
internet. This is the full capstone — everything you've learned in one network.
Do it in the **Sandbox** tab to verify the design before (or alongside) playing the
real mission.

> Takes ~20–30 min. Go phase by phase and run the check at the end of each phase
> before moving on — that way if something breaks you know exactly which piece.

> Cabling reminder: click a device, use its panel's two dropdowns to pick *this
> device's port* and *the other device + port*, click **Cable**. Keep each port's
> **cable and IP on the same port** (`show ip interface brief` → healthy = `up up`).

---

## The network you're building

```
        Internet (8.8.8.8)
              |
          [ ISP ]  203.0.113.1/30
              |   (public WAN link)
        R1 Gig0/1  203.0.113.2/30   ← NAT outside
              |
        R1 Gig0/0  (no IP, trunk, NAT inside) ── one cable ── Switch Gig0/8 (trunk)
              |
          [ Switch ]  ── access ports to all hosts ──
        ┌─────────────┬─────────────┬─────────────┬─────────────┐
      VLAN 10        VLAN 20       VLAN 30       VLAN 40
      Users          Guest         Servers/DMZ   Voice
      2 PCs (DHCP)   1 PC (DHCP)   1 Server      1 IP Phone (DHCP)
                                   (static .10)
```

## Addressing plan (your "client requirements")

| VLAN | Purpose   | Subnet           | Gateway (on R1)   | Hosts get IP via |
|------|-----------|------------------|-------------------|------------------|
| 10   | Users     | 192.168.10.0/24  | 192.168.10.1      | DHCP             |
| 20   | Guest     | 192.168.20.0/24  | 192.168.20.1      | DHCP             |
| 30   | Servers   | 192.168.30.0/24  | 192.168.30.1      | STATIC (server = .30.10) |
| 40   | Voice     | 192.168.40.0/24  | 192.168.40.1      | DHCP             |
| WAN  | To ISP    | 203.0.113.0/30   | ISP = .1, R1 = .2 | static           |

> Why DHCP for clients but static for the server? Real offices do exactly this:
> users/phones come and go (DHCP hands out addresses automatically), but servers must
> stay at a fixed, predictable address so everything else can find them.

---

## PHASE 1 — Place and cable everything

**Place:** 1 Router (R1), 1 Switch, 2 PCs (users), 1 PC (guest), 1 Server,
1 IP Phone, and the ISP node.

**Cable (host → switch access ports):**
- user-PC-1  → Switch `GigabitEthernet0/1`
- user-PC-2  → Switch `GigabitEthernet0/2`
- guest-PC   → Switch `GigabitEthernet0/3`
- Server     → Switch `GigabitEthernet0/4`
- IP Phone   → Switch `GigabitEthernet0/5`

**Cable (the backbone):**
- Switch `GigabitEthernet0/8` → R1 `GigabitEthernet0/0`   (this becomes the trunk)
- R1 `GigabitEthernet0/1` → ISP `WAN0/0`                  (the public WAN link)

✅ **Phase check:** every device has a line on the map. Nothing is configured yet.

---

## PHASE 2 — Create the VLANs and ports on the switch

Open the **Switch** terminal:
```
enable
configure terminal
vlan 10
exit
vlan 20
exit
vlan 30
exit
vlan 40
exit
```
Assign each host port to its VLAN (access ports):
```
interface GigabitEthernet0/1
switchport mode access
switchport access vlan 10
exit
interface GigabitEthernet0/2
switchport mode access
switchport access vlan 10
exit
interface GigabitEthernet0/3
switchport mode access
switchport access vlan 20
exit
interface GigabitEthernet0/4
switchport mode access
switchport access vlan 30
exit
interface GigabitEthernet0/5
switchport mode access
switchport access vlan 40
exit
```
Make the link to the router a trunk (carries all VLANs):
```
interface GigabitEthernet0/8
switchport mode trunk
end
show vlan brief
```
✅ **Phase check:** `show vlan brief` shows ports 1–2 in VLAN 10, port 3 in 20,
port 4 in 30, port 5 in 40. (Port 8, the trunk, won't be listed under a single VLAN.)

---

## PHASE 3 — Router-on-a-stick (one gateway per VLAN)

Open the **R1** terminal. Turn the physical port on (no IP), then one subinterface
per VLAN:
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
exit
interface GigabitEthernet0/0.30
encapsulation dot1Q 30
ip address 192.168.30.1 255.255.255.0
exit
interface GigabitEthernet0/0.40
encapsulation dot1Q 40
ip address 192.168.40.1 255.255.255.0
end
show ip route
```
✅ **Phase check:** `show ip route` shows four connected (C) routes, one per VLAN
subnet, via the four subinterfaces.

---

## PHASE 4 — Static-address the server (VLAN 30)

Open the **Server** terminal:
```
ip addr add 192.168.30.10/24 dev eth0
ip link set eth0 up
ip route add default via 192.168.30.1
ping 192.168.30.1            # ✅ reaches its gateway
```
✅ **Phase check:** the server pings its gateway (192.168.30.1).

---

## PHASE 5 — DHCP for the client VLANs (10, 20, 40)

Back on **R1**, create one pool per client VLAN. Exclude each gateway so it's never
handed out:
```
configure terminal
ip dhcp excluded-address 192.168.10.1
ip dhcp excluded-address 192.168.20.1
ip dhcp excluded-address 192.168.40.1
ip dhcp pool USERS
network 192.168.10.0 255.255.255.0
default-router 192.168.10.1
exit
ip dhcp pool GUEST
network 192.168.20.0 255.255.255.0
default-router 192.168.20.1
exit
ip dhcp pool VOICE
network 192.168.40.0 255.255.255.0
default-router 192.168.40.1
exit
end
```
> No `ip helper-address` needed here! The router sits directly on each VLAN (via its
> subinterfaces), so it hears the DHCP broadcasts itself — no relay required. (Relay
> is only for when the server is across a router from the clients.)

Now get addresses on each client. On **user-PC-1**, **user-PC-2**, **guest-PC**, and
the **IP Phone**:
```
ip link set eth0 up
dhclient eth0
ip addr show eth0            # ✅ got an address in the right subnet
```
✅ **Phase check:** user PCs get 192.168.10.x, guest gets 192.168.20.x, phone gets
192.168.40.x — each with its gateway. Confirm on R1 with `show ip dhcp binding`.

**Inter-VLAN test:** from **user-PC-1**, `ping 192.168.30.10` (the server) → ✅ works.
Different VLANs talking through the router. (No firewall yet, so all VLANs reach each
other — that's expected here; the server VLAN becomes a real protected DMZ in the
next mission.)

---

## PHASE 6 — Connect to the ISP (WAN + default route)

On **R1**:
```
configure terminal
interface GigabitEthernet0/1
ip address 203.0.113.2 255.255.255.252
no shutdown
exit
ip route 0.0.0.0 0.0.0.0 203.0.113.1
end
show ip route                # look for S* 0.0.0.0/0 via 203.0.113.1
ping 203.0.113.1             # ✅ the ISP edge answers
```
✅ **Phase check:** WAN interface up/up, `S*` default route present, R1 pings the ISP.

**Try the internet from a client now** (before NAT): from **user-PC-1**,
`ping 8.8.8.8` → ❌ **fails.** The client's private address can't traverse the public
internet yet. That's the cue for NAT.

---

## PHASE 7 — NAT (let the private network reach the internet)

On **R1**. Mark inside/outside, name the private subnets, enable overload:
```
configure terminal
interface GigabitEthernet0/0
ip nat inside
exit
interface GigabitEthernet0/1
ip nat outside
exit
access-list 1 permit 192.168.0.0 0.0.255.255
ip nat inside source list 1 interface GigabitEthernet0/1 overload
end
```
> `access-list 1 permit 192.168.0.0 0.0.255.255` covers all your 192.168.x.x VLANs in
> one line (the `0.0.255.255` wildcard matches any 192.168.*.* address). `ip nat
> inside` is on the trunk/LAN side, `ip nat outside` on the WAN side.

**The payoff:** from **user-PC-1**, `ping 8.8.8.8` → ✅ **works!** And from the
**IP Phone**, `ping 8.8.8.8` → ✅ also works (overload — many devices share the one
public IP). Check the translations on R1:
```
show ip nat translations
```
✅ **Phase check:** clients reach 8.8.8.8; `show ip nat translations` lists the
inside→public mappings.

---

## Final verification — the whole stack at once
- [ ] Four VLANs exist; hosts are in the right ones (`show vlan brief`)
- [ ] Four ROAS subinterfaces, four connected routes (`show ip route`)
- [ ] Server static at 192.168.30.10, reachable from a user PC (inter-VLAN)
- [ ] User/guest/voice clients got DHCP addresses in the correct subnets
- [ ] WAN up, `S*` default route, ISP reachable
- [ ] Before NAT: client can't reach 8.8.8.8 · After NAT: it can
- [ ] `show ip nat translations` shows the mappings; two devices share one public IP

**If a client can ping 8.8.8.8, you've proven the entire capstone works** — VLANs,
inter-VLAN routing, DHCP, static addressing, the default route, and NAT all
functioning together. That single ping is the whole mission in one packet.

---

## A note for the next mission (Mission 005)
Right now every VLAN can reach every other VLAN, including the servers in VLAN 30.
That's correct for *this* mission — but it's not how a real office stays safe. In the
next job you'll add a **firewall** to turn VLAN 30 into a true **DMZ**: let inside
users reach out, let the right traffic reach the servers, and block the rest. This
network is the foundation that firewall will protect.