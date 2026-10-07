# NetSim — NAT / PAT Sandbox Lab (Beginner-Friendly)

A follow-along lab to make a **private** inside PC reach a **public** internet
destination through the router — by translating its address (NAT). Written so a
beginner can execute it. Run in the **Sandbox** tab.

> Needs the **ISP node in the Sandbox palette** and **NAT support in the engine**
> (the NAT sprint). If either isn't in yet, build those first, then run this lab.

> Cabling reminder: select a device, use its panel's two port dropdowns to pick
> *this device's port* and *the other device + its port*, then click **Cable**. A
> line appears on the map. Keep each port's **cable and IP address on the same
> port** (run `show ip interface brief` — a healthy port reads `up  up`).

---

## The idea in plain words

Your home/office devices use **private** addresses — ranges like `192.168.x.x`,
`10.x.x.x`, `172.16–31.x.x`. These are reused by everyone and are **not allowed on
the public internet** — the internet has no idea which `192.168.1.10` you mean, so
replies can never find their way back.

**NAT** (Network Address Translation) fixes this. On the way out, the router swaps
the PC's private source address for the router's own **public** address, remembers
the swap, and reverses it when the reply returns. The common form, **PAT** (a.k.a.
"NAT overload"), lets *many* inside devices share one public address. This is how
every home router on the planet connects you to the internet.

---

## The topology

```
   [ PC1 ]                 [ R1 ]                  [ ISP ]  ──→  (internet: 8.8.8.8)
 192.168.1.10/24    Gig0/0: 192.168.1.1/24     WAN0/0: 203.0.113.1/30
 (PRIVATE, inside)  Gig0/1: 203.0.113.2/30
                    INSIDE = Gig0/0             (PUBLIC handoff)
                    OUTSIDE = Gig0/1
```

- **Inside** (private): PC1 ↔ R1's LAN port (Gig0/0).
- **Outside** (public): R1's WAN port (Gig0/1) ↔ the ISP.
- Beyond the ISP sits a single simulated internet host, **8.8.8.8**, used to prove
  reachability.

## Addressing plan

| Device | Port              | IP / mask                    | Side             |
|--------|-------------------|------------------------------|------------------|
| PC1    | eth0              | 192.168.1.10 /24             | inside (private) |
| R1     | Gig0/0 (to PC1)   | 192.168.1.1  255.255.255.0   | inside           |
| R1     | Gig0/1 (to ISP)   | 203.0.113.2  255.255.255.252 | outside (public) |
| ISP    | WAN0/0            | 203.0.113.1  /30 (preset)    | provider edge    |

---

## Step 1 — Place and cable
1. Place **1 Router (R1)**, **1 PC (PC1)**, and the **ISP** node.
2. Cable **PC1 → R1 port `GigabitEthernet0/0`** (the inside/LAN link).
3. Cable **R1 port `GigabitEthernet0/1` → ISP port `WAN0/0`** (the outside/WAN link).

## Step 2 — Give R1 its two interfaces
```
enable
configure terminal
interface GigabitEthernet0/0
ip address 192.168.1.1 255.255.255.0
no shutdown
exit
interface GigabitEthernet0/1
ip address 203.0.113.2 255.255.255.252
no shutdown
end
show ip interface brief         # both ports should read up / up
```

## Step 3 — Add the default route to the ISP
NAT still needs normal routing underneath it. Point "everything else" at the ISP:
```
configure terminal
ip route 0.0.0.0 0.0.0.0 203.0.113.1
end
show ip route                   # look for S* 0.0.0.0/0 via 203.0.113.1
```

## Step 4 — Configure PC1
```
ip addr add 192.168.1.10/24 dev eth0
ip link set eth0 up
ip route add default via 192.168.1.1
```

## Step 5 — The break: try the internet WITHOUT NAT
From **PC1**:
```
ping 8.8.8.8
```
**Expected: FAILS.** Routing is perfect and the default route is in place — but
PC1's source address is private (192.168.1.10). It leaves toward the internet
unchanged, and the reply has no way back to a non-unique private address. **This is
the whole reason NAT exists.**

## Step 6 — Mark which side is inside and which is outside
NAT needs to know the direction of translation:
```
configure terminal
interface GigabitEthernet0/0
ip nat inside
exit
interface GigabitEthernet0/1
ip nat outside
exit
```
- `ip nat inside` = the LAN side (private hosts live here).
- `ip nat outside` = the WAN side (the public internet is out here).

## Step 7 — Turn on PAT (overload)
First name which inside addresses are allowed to be translated, then enable
translation onto the public WAN port:
```
access-list 1 permit 192.168.1.0 0.0.0.255
ip nat inside source list 1 interface GigabitEthernet0/1 overload
end
```
- `access-list 1 permit 192.168.1.0 0.0.0.255` = "these inside addresses (the whole
  192.168.1.0/24 network) may be translated." (The `0.0.0.255` is a wildcard — the
  inverse of a 255.255.255.0 mask.)
- `ip nat inside source list 1 interface GigabitEthernet0/1 overload` = "translate
  those inside sources to the address of my outside port (Gig0/1 = 203.0.113.2), and
  `overload` so many hosts can share that one public address."

## Step 8 — The fix: try the internet again
From **PC1**:
```
ping 8.8.8.8
```
**Expected: SUCCESS.** Now R1 rewrites PC1's source from `192.168.1.10` to its own
public `203.0.113.2` on the way out, and reverses it on the reply. The reply has a
real, unique public address to come home to.

## Step 9 — See the translation
On **R1**:
```
show ip nat translations
```
**Expected:** an entry mapping the inside private address (inside-local
192.168.1.10) to the public address (inside-global 203.0.113.2). That row *is* the
translation NAT created — proof the router did the work, not magic.
```
show ip nat statistics          # counts of translations / hits
```

---

## Extra proofs

### A — Many hosts, one public address (overload)
Add **PC2** (192.168.1.11/24, gateway 192.168.1.1) on the inside (via a switch, or
a second LAN port if available). `ping 8.8.8.8` from PC2 too. Both succeed, and
`show ip nat translations` shows **both** inside hosts mapped to the **same** public
203.0.113.2 — distinguished internally by port. That's "overload"/PAT: one public IP
shared by many devices.

### B — Internal traffic is NOT translated
With PC1 and PC2 both inside, `ping` PC2 **from** PC1 (private→private, staying
inside). It works, and it creates **no** new NAT translation (check
`show ip nat translations`). NAT only applies to traffic going inside→outside — local
LAN traffic is never translated. (If internal pings start creating translations,
that's a bug.)

### C — Remove NAT, lose the internet again
```
configure terminal
no ip nat inside source list 1 interface GigabitEthernet0/1 overload
end
```
`ping 8.8.8.8` from PC1 now **fails** again — confirming NAT (not the routing) was
what made the internet reachable. Re-add it to restore.

---

## ⚠️ A note on scope (so the lesson stays honest)
"The internet" here is a single simulated host (8.8.8.8) reachable past the ISP —
just enough to demonstrate translation. It is not a real routing cloud. The point of
this lab is the **translation** (private→public and back), not internet-scale
routing. Don't read more into "reached 8.8.8.8" than "a translated packet got a
reply; an untranslated private one did not."

---

## Scorecard
- [ ] Step 5: private PC canNOT reach 8.8.8.8 before NAT (routing alone isn't enough)
- [ ] Step 8: after `ip nat inside/outside` + overload, PC reaches 8.8.8.8
- [ ] Step 9: `show ip nat translations` shows the inside-local ↔ inside-global map
- [ ] Extra A: two inside hosts share one public IP (overload)
- [ ] Extra B: private→private internal traffic is NOT translated and still works
- [ ] Extra C: removing NAT breaks internet reachability again

When every box checks out, NAT/PAT is verified — and you understand the mechanism
that connects every private network to the public internet. This is the last engine
piece Mission 004's ISP handoff sits on.