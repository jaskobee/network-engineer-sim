# NetSim — ISP Handoff & Default Route Sandbox Lab

A follow-along lab to connect a router to the simulated **ISP / Internet** node and
configure the default route that lets your network reach "everything else." Run it
in the **Sandbox** tab.

> **PREREQUISITE** — the ISP node is available in the Sandbox device palette
> alongside Router, Switch, PC, and Server. No setup needed — just open the Sandbox
> tab and click ADD next to ISP / Internet.

---

## The concept in one breath

Your inside networks use **private** addresses (192.168.x.x) and you write specific
static routes to reach each known internal subnet. But you can't write a route for
every network on the internet — there are too many and you don't know them. So you
point a single **default route** ("anything I don't recognize, send to the ISP") at
your provider. That default route is how nearly every edge router on earth reaches
the internet.

A real accuracy note baked into the sim: the ISP uses `203.0.113.1`, from the
`203.0.113.0/24` block (TEST-NET-3, reserved by RFC 5737 for documentation). It's a
**public** address on purpose — the WAN side of your router faces the public
internet, unlike your private LANs.

---

## The topology

```
        [ ISP / Internet ]   WAN0/0 = 203.0.113.1/30   (the provider's edge)
                |
          (point-to-point WAN handoff, 203.0.113.0/30)
                |
            [ R1 ]   WAN-facing interface = 203.0.113.2/30
                |
          (LAN side)  Gig = 192.168.1.1/24
                |
            [ PC1 ]   192.168.1.10/24, gateway 192.168.1.1
```

## Addressing plan

| Device | Interface            | IP / mask                     | Role                       |
|--------|----------------------|-------------------------------|----------------------------|
| ISP    | WAN0/0               | 203.0.113.1  /30 (preset)     | provider edge (fixed)      |
| R1     | (WAN port to ISP)    | 203.0.113.2  255.255.255.252  | your public handoff IP     |
| R1     | (LAN port to PC1)    | 192.168.1.1  255.255.255.0    | LAN gateway                |
| PC1    | eth0                 | 192.168.1.10 /24              | gateway 192.168.1.1        |

> The ISP is `203.0.113.1/30`; the only other usable address in that /30 is
> `203.0.113.2`, which is your router's WAN IP. (Network .0, usable .1 and .2,
> broadcast .3.)

---

## Step 1 — Place and cable
Place **1 Router (R1)**, **1 PC (PC1)**, and the **ISP** node.
Cable: R1's chosen WAN port → ISP; R1's LAN port → PC1.
(Either physical router port can be the WAN — just keep the cable and the WAN IP on
the same interface. Verify with `show ip interface brief` after.)

## Step 2 — Configure R1's LAN side
```
enable
configure terminal
interface GigabitEthernet0/0
ip address 192.168.1.1 255.255.255.0
no shutdown
exit
```

## Step 3 — Configure R1's WAN handoff to the ISP
Use whichever interface you cabled to the ISP:
```
interface GigabitEthernet0/1
ip address 203.0.113.2 255.255.255.252
no shutdown
exit
end
show ip interface brief
```
**Check:** the WAN interface reads **up / up** with 203.0.113.2. If it's `up/down`,
the cable and the IP are on different ports — fix that first.

## Step 4 — Prove the handoff link works (before any routing)
```
ping 203.0.113.1
```
**Expected: success.** You're now in the same subnet as the ISP edge. This proves
Layer 1–3 connectivity to the provider before you add routing on top.

## Step 5 — Add the default route (the whole point)
```
configure terminal
ip route 0.0.0.0 0.0.0.0 203.0.113.1
end
show ip route
```
**Check:** you should see a line like
`S*  0.0.0.0/0 [1/0] via 203.0.113.1`.
The `*` marks it as the **gateway of last resort** — the catch-all used when no more
specific route matches. `0.0.0.0 0.0.0.0` matches every destination, and because
it's the least-specific route possible, longest-prefix match always prefers a real
route over it; it only fires for "everything else."

## Step 6 — Configure PC1
```
ip addr add 192.168.1.10/24 dev eth0
ip link set eth0 up
ip route add default via 192.168.1.1
```

## Step 7 — Test reaching "the internet"
```
ping 203.0.113.1
```
from PC1.
**Expected behaviour depends on whether the engine models NAT (see note below).**
- If the sim treats the ISP edge as a reachable destination and either models NAT
  or doesn't enforce private-address dropping: PC1 → 203.0.113.1 succeeds, and the
  default route on R1 is what carried it.
- The router itself (Step 4) reaching 203.0.113.1 is the unambiguous success
  criterion for this lab; the PC→ISP result is the NAT-dependent part.

---

## Break test — remove the default route
```
configure terminal
no ip route 0.0.0.0 0.0.0.0 203.0.113.1
end
```
From R1, `ping 203.0.113.1` still works (it's directly connected). But R1 now has
**no gateway of last resort**, so any destination outside its known subnets is
unreachable — `show ip route` no longer shows the `S*` line. Re-add it to restore.
**Lesson:** directly-connected links work without a default route; reaching
*anything beyond them* is what the default route enables.

---

## ⚠️ Accuracy gap to verify in the engine: private → public needs NAT

This is the one thing that may not be modeled yet, and it matters for teaching the
ISP handoff honestly:

- Inside hosts use **private** addresses (192.168.x.x). Private addresses are
  **not routable on the public internet** — a real ISP drops them.
- Real edge routers perform **NAT (PAT/overload)**: they rewrite the inside private
  source address to the router's single public WAN address on the way out, and
  reverse it on replies. Without NAT, a private host can reach the ISP edge but
  replies can never find their way back to a private source.
- **Check what NetSim does today:** does a PC with a 192.168.x.x address actually
  reach a destination beyond the WAN, or does the engine just treat the ISP edge as
  one more reachable hop? If Mission 004 will teach "ISP handoff," NAT is the
  concept that makes private→public correct, and it's commonly skipped in sims.

If NAT isn't modeled, that's fine for now — but it should be a conscious decision,
and the lab/mission text shouldn't imply a private host is "really" on the internet
without it. Flag it for the Mission 004 / NAT design.

---

## Scorecard
- [ ] R1's WAN interface is up/up with 203.0.113.2
- [ ] R1 can ping the ISP edge (203.0.113.1) — handoff link proven
- [ ] `show ip route` shows `S* 0.0.0.0/0 via 203.0.113.1` (gateway of last resort)
- [ ] Removing the default route removes the `S*` line (break test)
- [ ] Decision recorded on whether the engine models NAT for private→public

---

## (Build first) Claude Code prompt — add the ISP node to the Sandbox palette

```
Add the ISP / Internet node to the Sandbox device palette so it can be placed and
cabled in free-build mode (it currently only exists in mission maps). Follow
CLAUDE.md's hard rules. Plan first and show files to be touched. Do NOT change
mission behavior or the networking engine's routing logic. Run npm test and
npx vite build at the end.

- Expose the existing ISP node type in the Sandbox palette alongside Router/Switch/
  PC/Server, so clicking/dragging adds a fresh ISP instance to the sandbox map (free,
  consistent with how the other sandbox devices are added).
- The ISP node should keep its existing definition: a single WAN interface preset to
  203.0.113.1/30 (TEST-NET-3, RFC 5737), shown as up. Reuse the existing ISP icon.
- It must be cable-able to a router interface like any other device, and reachable
  via the normal checkPing/BFS path so a router in the 203.0.113.0/30 subnet can ping
  203.0.113.1.
- Do not invent NAT or internet-reachability behavior in this change — this is only
  about making the node placeable/cable-able in Sandbox. (NAT is a separate, later
  decision.)
- Confirm: ISP node appears in Sandbox palette, can be placed and cabled, a router
  with 203.0.113.2/30 can ping 203.0.113.1, and missions are unaffected.
```