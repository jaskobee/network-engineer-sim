# NetSim — Router-on-a-Stick (ROAS) Sandbox Lab

A follow-along lab to build inter-VLAN routing by hand and watch it work, then
break it three ways to understand *why* each piece is required. Run it in the
**Sandbox** tab. Do the steps in order.

> **What ROAS is, in one breath:** A Layer 2 switch can't route between VLANs (it
> has no Layer 3 brain). So we hand a single router *one* physical link to the
> switch, slice that link into logical **subinterfaces** — one per VLAN — and let
> the router route between them. The link between switch and router is a **trunk**
> that carries every VLAN at once, tagged with 802.1Q so the router can tell them
> apart. Each subinterface's IP becomes the **default gateway** for its VLAN.

---

## The topology

```
   PC1 (VLAN 10)                     PC2 (VLAN 20)
 192.168.10.10/24                  192.168.20.10/24
        |                                 |
   (access vlan 10)                 (access vlan 20)
        |                                 |
        +-------------[ SW1 ]-------------+
                         |
                    (TRUNK link)
                         |
                       [ R1 ]
            Gig0/0  (physical: NO IP, no shutdown)
            Gig0/0.10  encapsulation dot1Q 10  -> 192.168.10.1  (VLAN 10 gateway)
            Gig0/0.20  encapsulation dot1Q 20  -> 192.168.20.1  (VLAN 20 gateway)
```

## Addressing plan

| Device | Interface        | IP / prefix        | VLAN | Role                  |
|--------|------------------|--------------------|------|-----------------------|
| PC1    | eth0             | 192.168.10.10 /24  | 10   | gateway = 192.168.10.1|
| PC2    | eth0             | 192.168.20.10 /24  | 20   | gateway = 192.168.20.1|
| R1     | Gig0/0           | (no IP)            | —    | trunk uplink, must be up |
| R1     | Gig0/0.10        | 192.168.10.1 /24   | 10   | VLAN 10 gateway       |
| R1     | Gig0/0.20        | 192.168.20.1 /24   | 20   | VLAN 20 gateway       |
| SW1    | Gig0/1 → PC1     | —                  | 10   | access port           |
| SW1    | Gig0/2 → PC2     | —                  | 20   | access port           |
| SW1    | Gig0/3 → R1      | —                  | all  | trunk port            |

> Two VLANs = two subnets = two broadcast domains. They can only talk through a
> Layer 3 device — here, R1.

---

## Step 1 — Place and cable

Place: **1 Router (R1), 1 Switch (SW1), 2 PCs (PC1, PC2).**
Cable:
- PC1 → SW1 Gig0/1
- PC2 → SW1 Gig0/2
- SW1 Gig0/3 → R1 Gig0/0

(Exact switch port numbers don't matter as long as you configure the ports you
actually used.)

## Step 2 — Configure the switch (VLANs + access ports + trunk)

On **SW1**:
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
exit
end
show vlan brief
show interfaces trunk
```
**Check:** `show vlan brief` lists Gig0/1 under VLAN 10 and Gig0/2 under VLAN 20.
`show interfaces trunk` shows Gig0/3 as a trunk (native VLAN 1, carrying the
VLANs). The trunk is the highway that carries *both* tagged VLANs to the router.

## Step 3 — Configure the router (the heart of ROAS)

On **R1**:
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
end
show ip interface brief
show ip route
```
**Check:**
- `show ip interface brief` shows **Gig0/0 with no IP but up/up**, and **Gig0/0.10
  / Gig0/0.20 each with their IP and up**.
- `show ip route` shows **two connected (C) routes** — 192.168.10.0/24 via
  Gig0/0.10 and 192.168.20.0/24 via Gig0/0.20.

Why each line matters:
- `no shutdown` on the **physical** Gig0/0 — the physical interface has no IP, but
  if it's not up, *every* subinterface is dead. (You'll prove this in Break Test 1.)
- `encapsulation dot1Q 10` is what actually binds the subinterface to VLAN 10. The
  `.10` in the name is just a label — the VLAN comes from this line. (Break Test 2.)
- Each subinterface IP is the **default gateway** the VLAN's hosts will point at.

## Step 4 — Configure the PCs

On **PC1**:
```
ip addr add 192.168.10.10/24 dev eth0
ip link set eth0 up
ip route add default via 192.168.10.1
```
On **PC2**:
```
ip addr add 192.168.20.10/24 dev eth0
ip link set eth0 up
ip route add default via 192.168.20.1
```

## Step 5 — The payoff ping

On **PC1**:
```
ping 192.168.20.10
```
**Expected: success.** Trace what just happened — this *is* inter-VLAN routing:
1. PC1 sees 192.168.20.10 is off its own subnet → sends the frame to its gateway
   192.168.10.1.
2. SW1 tags the frame VLAN 10 and sends it up the trunk to R1.
3. R1's Gig0/0.10 (dot1Q 10) receives it, routes it to the connected
   192.168.20.0/24 network out Gig0/0.20, and re-tags it VLAN 20.
4. SW1 receives the VLAN 20 frame on the trunk and delivers it out Gig0/2 to PC2.
5. PC2's reply makes the mirror-image trip back. (Both directions must work — your
   engine enforces this.)

One physical router link just routed between two VLANs. That's router-on-a-stick.

---

# Break tests — *why* each piece is required

Each one breaks the working setup a single way, shows you the correct failure,
then fixes it. These three failures are the whole lesson.

## Break Test 1 — Forget `no shutdown` on the physical interface
The #1 real-world ROAS mistake: perfect subinterfaces, dead parent.

On **R1**:
```
configure terminal
interface GigabitEthernet0/0
shutdown
end
show ip interface brief
```
**Expected:** Gig0/0 **and both subinterfaces** show down. From PC1,
`ping 192.168.20.10` **fails**. Even though Gig0/0.10 and Gig0/0.20 are configured
flawlessly, a shut physical parent takes them all down with it.

**Fix:**
```
configure terminal
interface GigabitEthernet0/0
no shutdown
end
```
Ping works again. **Lesson:** the physical interface carries every VLAN's traffic —
it must be up even though it has no IP of its own.

## Break Test 2 — Remove the encapsulation from one subinterface
Proves the VLAN binding lives in `encapsulation dot1Q`, not the subinterface number.

On **R1**:
```
configure terminal
interface GigabitEthernet0/0.20
no encapsulation dot1q
end
show ip route
```
**Expected:** the 192.168.20.0/24 connected route is **gone** (the subinterface
can't route without a VLAN binding). From PC1:
- `ping 192.168.10.1` → still **works** (VLAN 10's gateway is fine).
- `ping 192.168.20.10` → **fails** (VLAN 20 has no working gateway anymore).

**Fix:**
```
configure terminal
interface GigabitEthernet0/0.20
encapsulation dot1Q 20
end
```
**Lesson:** a subinterface is just an idle logical port until `encapsulation dot1Q`
tells it which VLAN's tagged frames it owns.

## Break Test 3 — Make the switch–router link an access port
Proves the uplink *must* be a trunk, and shows the `vlan_isolated` failure.

On **SW1**:
```
configure terminal
interface GigabitEthernet0/3
switchport mode access
end
```
Now the link to R1 carries only one untagged VLAN instead of all VLANs tagged.
From PC1, `ping 192.168.20.10` **fails** — internally classified as
`vlan_isolated`, because the tagged VLAN frames can't reach their subinterfaces.

**Fix:**
```
configure terminal
interface GigabitEthernet0/3
switchport mode trunk
end
```
**Lesson:** an access port passes a single untagged VLAN; ROAS needs every VLAN
delivered to the router *tagged*, which is exactly what a trunk does.

---

# Optional — two deeper proofs

## Optional A — The number is a label; encapsulation is the truth
Rebuild VLAN 20's gateway on a deliberately "wrong-numbered" subinterface:
```
configure terminal
no interface GigabitEthernet0/0.20
interface GigabitEthernet0/0.99
encapsulation dot1Q 20
ip address 192.168.20.1 255.255.255.0
end
```
`ping 192.168.20.10` from PC1 **still works** — because VLAN 20 is bound by
`encapsulation dot1Q 20`, regardless of the `.99` in the name. (Convention is to
match them for sanity, but the engine routes by the encapsulation.) Put it back to
`.20` afterward to keep things tidy.

## Optional B — Why you needed the router at all
Delete R1 from the picture in your head: two PCs in different VLANs on just a
switch. Configure PC1 (VLAN 10) and PC2 (VLAN 20) on SW1 with **no router**, then
`ping` across. It **fails** with `vlan_isolated` — a Layer 2 switch keeps VLANs in
separate broadcast domains and has no way to route between them. That isolation is
*why* ROAS (or a Layer 3 switch) exists.

---

## Scorecard
- [ ] Step 5: PC1 pings PC2 across VLANs (ROAS works)
- [ ] `show ip route` on R1 shows two connected routes via the two subinterfaces
- [ ] Break 1: shutting the physical Gig0/0 kills both subinterfaces; ping fails
- [ ] Break 2: removing encapsulation drops that VLAN's route; only that VLAN fails
- [ ] Break 3: access-mode uplink fails with vlan_isolated; trunk fixes it
- [ ] Optional A: encapsulation (not the subif number) determines the VLAN
- [ ] Optional B: switch-only cross-VLAN ping fails with vlan_isolated

When every box is checked, you've verified ROAS end to end — and you understand it,
which matters more. This is the mechanism Mission 004 will sit on top of.