# NetSim — Admin Laptop, Firewall Web UI, Port Scanner & WireFish

**Status:** Design spec. Nothing here is implemented yet.
**Owner decision needed on:** the Phase 3 packet-engine refactor (see "Open questions").
**Read first:** `CLAUDE.md` (hard rules), `docs/NETWORKING_ACCURACY.md` (hard spec),
`docs/NETSIM_FAULTS_AND_FEATURES.md` (fault system this feeds into).

This document describes a feature family: an **Admin Laptop** device that acts as the
player's own workstation, and the **tools that run on it** — a firewall web admin GUI,
a port scanner, and a packet analyzer ("WireFish"). It also records the platform
decision (stay on the web) and the one architectural fork this feature exposes.

---

## 0. Decision summary (settled — do not relitigate without asking)

| Decision | Verdict | Why |
|---|---|---|
| Web platform vs. game engine (Unity/Godot) | **Stay on the web** | The UI surface is terminals, tables, forms, and web-page mockups — DOM excels at these, game-engine UI is miserable at them. A WebGL build also destroys the install-free advantage over Packet Tracer/GNS3. No physics/3D/sprite needs. |
| Is the laptop a real topology node? | **Yes — always** | It has a NIC, IP, gateway, MAC, and a switch port. If it is a floating panel that always works, the lesson is deleted. |
| Does the GUI have its own config store? | **No** | Firewall GUI and CLI mutate the **same** device state. A rule added in the GUI appears in `show running-config` and vice versa. |
| Visual juice (packet animation) | Canvas/WebGL layer (e.g. PixiJS) **for the map only**, if/when needed | Everything else stays DOM. Not part of this spec. |
| Portability hedge | Keep `src/models/` a **pure headless JS core** with zero React/DOM imports | The UI is disposable; the engine is the asset. Enforce as a package boundary. |

---

## 1. Hard rules for this feature

These are additive to `CLAUDE.md`'s hard rules and are non-negotiable.

1. **The laptop is a device, not a UI panel.** Every tool it runs is subject to the
   real engine. If `checkPing(laptopIp, targetIp, service)` fails, the tool must fail —
   with a realistic error, not a silent success or a fallback.
2. **No parallel state.** GUI-driven config writes to the same `Device` fields the CLI
   writes to. One source of truth. `show running-config` is the arbiter.
3. **No synthesized packets.** (Phase 3 rule, stated here so it isn't forgotten.) A
   packet capture is the single most inspectable artifact in the product. If WireFish
   shows a frame, a real capture on real gear must plausibly show that frame, in that
   order, with those fields. Do **not** post-hoc invent an ARP/ICMP sequence from a BFS
   path result to ship faster. If the engine can't emit it truthfully, don't display it.
4. **Realistic failure text.** A blocked TCP connect shows a browser-accurate
   `ERR_CONNECTION_TIMED_OUT` (silent drop) vs. `ERR_CONNECTION_REFUSED` (reached the
   host, nothing listening). These are different causes and beginners must learn the
   difference.
5. **Names must be trademark-clean.** "WireFish" for the analyzer. The scanner must NOT
   be called `nmap` (trademarked) — pick an original name (e.g. `netscan`, `porthound`).
   Reproduce the *concepts* (open/closed/filtered, scan syntax shape), not the branding.
6. **Test discipline unchanged.** Any change to networking behavior gets Vitest coverage
   asserting the correct `failureReason`, not just pass/fail. Run `npm test` and
   `npx vite build` at every checkpoint.

---

## 2. The Admin Laptop device

### Concept
A new device type representing the engineer's own workstation — labelled with the
player's name (e.g. `jasko's laptop`). It is what a real network engineer actually
sits at: it has a Linux shell, it runs GUI tools, and **it can only reach what the
network lets it reach.**

### Model
- New device type `laptop` (or `admin_laptop`) in `data/deviceCatalog.js` and
  `models/Device.js`. One NIC (`eth0`), same interface model as `pc`.
- Uses the existing **`PCCLIEngine`** (Linux shell) for its terminal — no new CLI engine.
  `ip addr`, `ip route`, `dhclient`, `ping` all work as they do on a PC.
- Adds a **tools layer** on top: a windowed UI surface (browser, scanner, analyzer)
  that the plain PC does not have.
- Player is likely given exactly one, free, present from the start (it's *their* laptop,
  not purchased hardware). Confirm with owner — see Open questions.

### Why this is the right container
It gives every future GUI-ish capability a diegetic home *and a network position*.
Concrete lessons it unlocks for free, using engine behavior that already exists:

- Laptop plugged into the wrong VLAN → cannot reach the firewall (`vlan_isolated`).
- No default gateway → reaches the local SVI, not the firewall on another subnet
  (`host_no_gateway`).
- Firewall has no rule permitting `tcp/443` from the management subnet → the admin page
  is unreachable (`blocked_by_firewall`). **The player locks themselves out of their own
  firewall.** This is a universal rite of passage and a superb mission beat.

### In-band vs. out-of-band management (deliberate, phased)
Today, right-click → Open Terminal is magic access to any device. The laptop is the
opportunity to model the real distinction:

- **SSH / web admin** requires actual reachability from the laptop.
- **Console cable** always works (out-of-band), even when the network is broken.

Do **not** remove magic access globally. Gate it:
- Sandbox and early missions: magic access stays (beginners must not be punished for not
  knowing what a console cable is).
- Later missions / a mode flag: in-band access requires reachability, and the console
  cable becomes the documented recovery path.

Implement the *capability* in this feature; keep it off by default behind a per-mission
or per-mode flag.

### Security note (do not skip)
`Username's laptop` is a **user-supplied string** rendered into device labels, tooltips,
map nodes, and any exported/shared topology JSON. Escape at render, validate and length-cap
at input, and never `dangerouslySetInnerHTML` it. This becomes an XSS vector the day
topology sharing ships.

---

## 3. Tool 1 — Firewall Web Admin UI (Phase 1, cheapest, ship first)

### What it is
A tab on the laptop that behaves like a browser. The player types an IP
(e.g. `https://10.1.0.1`). If the flow is permitted, a simulated firewall admin page
renders. If not, a browser error page renders.

### Why it's cheap
It needs **zero new networking logic**. The engine already has:
- `checkPing(srcIp, dstIp, service)` with a `service` param defaulting to ICMP
- The well-known port table (HTTPS = tcp/443)
- Zone-based rules, first-match-wins, implicit default-deny
- `blocked_by_firewall` as a distinct `failureReason`

Opening the admin page is literally a `tcp/443` flow evaluated by the existing BFS +
zone policy. The tab's job is to **call the engine and refuse to open when the engine
says no.**

### Behavior contract
```
navigate(ip) →
  result = topology.checkPing(laptopIp, ip, { protocol: 'tcp', port: 443 })
  reachable          → render admin page for that device
  blocked_by_firewall→ ERR_CONNECTION_TIMED_OUT  (silent drop — teach: a drop looks like nothing)
  no_route / host_no_gateway / vlan_isolated / admin_down / link_down
                     → ERR_CONNECTION_TIMED_OUT, and the underlying reason is available
                       to the hint system (not shown outright — the player must diagnose)
  reached host, no listener on 443
                     → ERR_CONNECTION_REFUSED
```

### The admin page itself
- **Schema-driven, not hand-built.** Render forms/tables from the device model so a
  future wireless AP page, printer page, or consumer home-router page at `192.168.1.1`
  reuses the same framework. Hardcoding one bespoke firewall page is the wrong shape.
- Surfaces the existing firewall state: `fw_zones`, `fw_rules[]` (ordered, with IDs),
  `fw_sessions` (the `show conn` equivalent), interfaces.
- **Editing writes to the same fields the CLI writes to.** Adding a rule in the GUI must
  appear in `show firewall-rules` and `show running-config` immediately (mutation + tick,
  same as everywhere else).
- GUI-first is *more* realistic for firewalls specifically (ASDM, FortiGate, pfSense are
  all browser-driven), so don't fight it. But mastery scoring should reward CLI config,
  and some missions may specify the method.

### Acceptance criteria
- [ ] Laptop with correct IP/gateway and a permitting rule → admin page opens
- [ ] Remove the permit rule → page fails with `ERR_CONNECTION_TIMED_OUT`
- [ ] Move laptop to the wrong VLAN → fails (engine reports `vlan_isolated` internally)
- [ ] Rule added in GUI appears in `show running-config`; rule added in CLI appears in GUI
- [ ] Vitest: at least one test per failure path asserting the correct `failureReason`

---

## 4. Tool 2 — Port scanner (Phase 2, small model addition, big payoff)

### The missing model piece
Hosts currently have no concept of **what is listening**. Add a `services[]` to devices:

```js
device.services = [
  { protocol: 'tcp', port: 443, name: 'HTTPS' },
  { protocol: 'tcp', port: 22,  name: 'SSH'   },
]
```

This is small, and it pays for itself immediately: it makes firewall rules **honest**.
Permitting `tcp/443` to a host that isn't listening on 443 must still fail — today it
would spuriously succeed.

### Why the scanner is worth building
It produces the **open / closed / filtered** trichotomy, which is the most elegant
firewall-teaching artifact available:

| Result | Meaning | Engine condition |
|---|---|---|
| `open` | Reached the host, something is listening | flow permitted **and** service exists |
| `closed` | Reached the host, nothing listening | flow permitted, no matching service |
| `filtered` | Never reached the host — something dropped it silently | `blocked_by_firewall` (or other drop) |

A scan result becomes a **diagnostic map of the player's own policy.** That is a genuinely
strong mission mechanic: "scan from the DMZ and prove only 443 is exposed."

### Notes
- Syntax should evoke the real tool's shape (target + port range + flags) without using
  the trademarked name.
- Scanning should feel like work: per-port latency, a progress line, cancellable.
- Naturally pairs with the fault-injection system — `filtered` vs `closed` is exactly
  the distinction a troubleshooting mission wants the player to reason about.

### Acceptance criteria
- [ ] `services[]` exists on devices; firewall rules permitting a port to a host with no
      listener correctly fail
- [ ] Scan of a permitted host with a listener → `open`
- [ ] Scan of a permitted host without a listener → `closed`
- [ ] Scan through a denying firewall → `filtered`
- [ ] Vitest coverage for all three outcomes

---

## 5. Tool 3 — WireFish packet analyzer (Phase 3 — the real architectural decision)

### The fork in the road
This is **not** a UI feature. The engine today is a **reachability oracle**: BFS answers
"is this reachable, and if not, why." It does not produce packets. A packet analyzer needs
a frame-by-frame trace with timestamps, layers, and fields.

Two paths:

**Path A — synthesize the trace post-hoc.** BFS already knows the path; generate a
plausible ARP/ICMP sequence along it. Fast. **Rejected** — see Hard Rule 3. It means
inventing packets, and any mismatch violates the project's core accuracy rule in the most
visible place possible.

**Path B — make the engine event-emitting.** A packet object walks the topology hop by
hop; each device *processes* it (L2 MAC lookup + learning, ARP resolution, L3 route
lookup, NAT rewrite, firewall policy) and emits events. Then:
- `checkPing` becomes a **consumer**: send five echo requests, count replies, derive the
  existing result object (`reachable`, `failureReason`, `failurePoint`, loss, RTT).
- WireFish becomes another consumer: subscribe to events at a chosen capture point and
  render frames.

**Recommendation: Path B.**

### Why Path B is tractable *now* and harder later
The ~220 existing Vitest tests encode expected reachability outcomes. **Those tests are
the refactor spec** — rebuild the core underneath and the suite reports any behavioral
drift. That is an unusually safe position from which to attempt a foundational refactor,
and it degrades with every mission added on top of the current core.

### What Path B unlocks beyond WireFish (the compounding payoff)
- **DHCP DORA on the wire.** Currently modeled logically, not packet-level. With a packet
  engine, the player *watches* the Discover die at the router, adds `ip helper-address`,
  and *watches* it get relayed as a unicast. A described lesson becomes a visible one.
- **ARP** and **MAC address table learning** become real instead of stubbed
  (`show mac-address-table` currently returns a documented stub).
- **Duplex mismatch** (fault I) needs real per-packet loss, not a boolean.
- **STP**, and roughly half the fault library in `NETSIM_FAULTS_AND_FEATURES.md`,
  become modelable.
- `degraded` / `lossPct` in the `PingResult` spec become genuinely produced rather than
  asserted.

### Non-issue
Performance. Dozens of devices and hundreds of packets in JS is nothing. Do not
prematurely optimize this.

### Sequencing within Phase 3
1. Introduce the packet/event model alongside the existing BFS (do not delete BFS yet).
2. Reimplement `checkPing` on top of it; run the full suite; reconcile every diff
   deliberately (a diff is either a bug in the new core or a latent bug the old core hid —
   decide which, in writing).
3. Only then build WireFish as the first visualization consumer.
4. DHCP DORA visualization as the second consumer, proving the model generalizes.

### Capture point semantics (get this right)
A capture is taken **at an interface**, not globally. WireFish on the laptop sees what
the laptop's NIC sees — which on a switched network is *not everything*. This is itself a
teaching moment (why you need a SPAN/mirror port to capture other hosts' traffic).
Consider modeling SPAN later; at minimum, do not silently give the laptop omniscient
visibility.

---

## 6. Cross-cutting concerns

### Tool sprawl → make tools purchasable software
The laptop will want to become a junk drawer. Sell tools through the **existing shop** as
software licenses (buy WireFish, buy the scanner). This:
- paces complexity for beginners
- gives the money loop something new to spend on
- provides a natural gate: "you're not ready for packet analysis yet"

### Engine purity boundary
Formalize `src/models/` as a headless core: no React, no DOM, no browser globals. It must
run in Node for tests, and could later run server-side for authoritative multiplayer state.
Add a lint rule or an explicit note if enforcement is cheap.

### Mastery scoring interaction
GUI config is realistic for firewalls, but scoring should reward CLI fluency. Some missions
may legitimately require one method or the other. Keep the scoring hook in mind when
designing the GUI's write path.

---

## 7. Build order (each phase is a checkpoint)

| Phase | Scope | Engine risk | Ship criteria |
|---|---|---|---|
| **1** | Admin Laptop device + browser tab + firewall web UI | None — pure consumer of existing engine | Admin page opens/fails correctly per policy; GUI↔CLI config parity |
| **2** | `services[]` model + port scanner | Small, additive | open/closed/filtered all correct and tested |
| **3a** | Packet/event engine; `checkPing` reimplemented on it | **High — foundational refactor** | Full existing Vitest suite green, every diff reconciled in writing |
| **3b** | WireFish as first consumer | Low once 3a lands | Captures are engine-emitted, never synthesized |
| **3c** | DHCP DORA visualization as second consumer | Low | Discover visibly dies at the router; helper-address visibly fixes it |

Do not start 3a until Phases 1 and 2 are shipped and stable — they're valuable on their
own and they validate the laptop concept before betting on a refactor.

---

## 8. Open questions for the owner (answer before implementing)

1. **Is the packet-engine refactor (Phase 3a) approved?** Phases 1–2 do not depend on it.
   Phase 3 is meaningless without it. This is the only genuinely expensive decision here.
2. **Is the laptop free and always present, or purchased/unlocked?** Leaning free and
   present from the start — it's the player's own gear, not client hardware.
3. **When does in-band-only management turn on?** Suggested: off in Sandbox and missions
   001–003, available as a mission flag afterward, with the console cable as the documented
   recovery path.
4. **Scanner name?** Must not be `nmap`. Candidates: `netscan`, `porthound`.
5. **Do tools cost money in the shop?** Recommended yes, for pacing and progression.
6. **Does the laptop get magic terminal access like other devices, or must it be reached?**
   It's the player's own machine — its terminal should always be available.

---

## 9. What NOT to do

- Do **not** build WireFish on synthesized traces to ship it faster. This is the one
  shortcut that would be visible to exactly the audience the project promises not to
  mislead.
- Do **not** give the firewall GUI its own config store.
- Do **not** let the laptop reach things the engine says it can't, "just for now."
- Do **not** port to a game engine for this feature set.
- Do **not** hardcode a single bespoke firewall admin page — make it schema-driven.
- Do **not** use the trademarked tool names.
