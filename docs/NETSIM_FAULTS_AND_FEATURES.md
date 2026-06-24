# NetSim — Fault Injection System + Feature Brainstorm

Two parts:
- **Part 1** — a pluggable, networking-accurate fault-injection system for
  troubleshooting missions.
- **Part 2** — a point-form summary of every "make it addictive" idea, for quick
  reference later.

---

# PART 1 — Fault Injection System

## Design principle (read this first)

**A fault is real misconfigured/broken state, not a special case in the ping
logic.** Apply a fault by mutating the actual Device / interface / Topology
fields — the same fields a user edits via the CLI. Then your existing (accurate)
engine evaluates reachability with no fault-specific branches.

Why this matters:
- `show` commands reveal the fault automatically, exactly like real gear.
- The player fixes it with the *same* real commands that caused it.
- You can't accidentally teach a fake symptom — the symptom emerges from correct
  modeling.

The only engine upgrade required: `checkPing` must return a **result object**, not
a boolean, so it can express *degraded* links and *why* a ping failed.

## 1. Upgrade checkPing → PingResult

```js
// Topology.checkPing(srcIp, dstIp) now returns:
{
  reachable: false,        // did at least some packets get a reply?
  degraded: true,          // up but lossy/slow (e.g. duplex mismatch)
  sent: 5,
  received: 2,
  lossPct: 60,
  rttMs: 9,                // avg of successful replies
  failureReason: 'duplex_mismatch',  // enum below, null if fully reachable
  failurePoint: 'dev-2:GigabitEthernet0/1' // where the path broke, for hints
}
```

`failureReason` enum → map each to a **realistic** CLI symptom:

| failureReason        | IOS ping output      | Linux ping output                  | What it means                         |
|----------------------|----------------------|------------------------------------|---------------------------------------|
| `no_route`           | `U.U.U` (unreachable)| `Destination Net Unreachable`      | Router has no matching route          |
| `host_no_gateway`    | n/a (host)           | `connect: Network is unreachable`  | Host has no default route             |
| `gateway_unreachable`| n/a (host)           | `Destination Host Unreachable`     | Gateway set but ARP fails / off-subnet|
| `subnet_mismatch`    | `.....` timeout      | `Destination Host Unreachable`     | Wrong mask → host mis-decides L2 vs L3|
| `admin_down`         | `.....`              | timeout / no reply                 | Interface `shutdown`                  |
| `link_down`          | `.....`              | timeout                            | Cable/peer down (down/down)           |
| `no_return_path`     | `.....` timeout      | timeout                            | Request left, no route back           |
| `vlan_isolated`      | `.....` timeout      | timeout                            | Host in wrong VLAN / VLAN not carried |
| `ip_conflict`        | erratic `!.!.!`      | erratic / dup replies              | Duplicate IP in subnet                |
| `duplex_mismatch`    | partial `!.!..`      | partial loss + high latency        | Link up/up but errors → loss          |

Keep the IOS success/timeout/unreachable characters accurate (`!` reply,
`.` timeout, `U` unreachable). That detail alone teaches packet-level reading.

## 2. Fault model schema

```js
// One reusable shape for every fault.
const Fault = {
  id: 'f_mask_pc',
  type: 'wrong_subnet_mask',     // see library below
  target: { deviceId: 'dev-3', ifaceId: 'dev-3:eth0' },
  params: { wrongPrefix: 24, correctPrefix: 25 },

  // Applied at mission load: MUTATE REAL STATE (no engine hacks).
  apply(topology) { /* set the wrong mask on the interface */ },

  // What the player should observe (drives mission narrative + grading).
  symptom: 'Reception PC cannot reach the server, but can reach the printer.',
  rootCause: 'Subnet mask is /24 instead of /25; PC treats the server as local.',

  // Which command(s) reveal it — used for the hint ladder + scoring.
  revealedBy: ['show running-config', 'show ip interface', 'ip addr'],

  // Mission is fixed when this is true (evaluated on every tick).
  isFixed(topology) { /* iface prefix === correctPrefix */ }
};
```

Store active faults in mission data: `mission.faults = [Fault, ...]`. On mission
load, call `fault.apply(topology)` for each. On every tick, the mission is
solved when **all** `fault.isFixed()` are true **and** the objective ping passes.

## 3. Fault library (accurate behavior per fault)

Each entry: how to MODEL it (state to mutate) → how it MANIFESTS (ping + show) →
how it's FIXED. All behavior must match CCNA/Network+ reality.

**A. Wrong subnet mask**
- Model: set interface `prefix` to an incorrect value.
- Manifests: the host computes local-vs-remote using *its own* mask. If it wrongly
  thinks a remote host is local, it ARPs on-segment and times out
  (`subnet_mismatch`); if it wrongly thinks a local host is remote, it forwards to
  the gateway unnecessarily. checkPing already produces this if it decides routing
  from the source's mask — do NOT shortcut it.
- Reveal: `show ip interface`, `show running-config`, `ip addr`.
- Fix: correct the mask/prefix.

**B. Missing / wrong default gateway (host)**
- Model: clear or wrong `host.defaultGateway`.
- Manifests: same-subnet pings succeed; off-subnet → `host_no_gateway` (none set)
  or `gateway_unreachable` (set but not in the host's subnet).
- Reveal: `ip route`, `route`, `show running-config`.
- Fix: set a default gateway that is inside the host's subnet.

**C. Interface administratively down**
- Model: interface `status = 'admin_down'` (you already have this state).
- Manifests: `admin_down`; line shows `administratively down / down`.
- Reveal: `show ip interface brief`.
- Fix: `no shutdown`.

**D. Missing / wrong static route (router)**
- Model: remove a needed route or set a next-hop on a non-connected subnet.
- Manifests: `no_route` (`U` in IOS). A next-hop that isn't reachable via a
  connected network must NOT install — model that, don't accept it.
- Reveal: `show ip route`, traceroute.
- Fix: add correct `ip route` / default route with a reachable next-hop.

**E. One-way routing (no return path)**
- Model: configure forward route only, omit reverse.
- Manifests: `no_return_path` → timeout (request left, reply can't get home). This
  is the #1 teaching moment — checkPing must verify BOTH directions.
- Reveal: traceroute from each end; compare `show ip route` on both routers.
- Fix: add the return route.

**F. Wrong VLAN on access port**
- Model: access port `accessVlan` set to the wrong VLAN.
- Manifests: host isolated from its intended subnet/gateway → `vlan_isolated`.
- Reveal: `show vlan brief`, `show interfaces status` (VLAN column).
- Fix: `switchport access vlan <correct>`.

**G. Access port that should be a trunk**
- Model: link to router/another switch left as `mode access`.
- Manifests: only the access VLAN passes; other VLANs' frames dropped → those
  hosts `vlan_isolated`. Breaks router-on-a-stick entirely.
- Reveal: `show interfaces trunk` (port absent), `show interfaces switchport`.
- Fix: `switchport mode trunk` (+ allowed VLANs).

**H. Native VLAN mismatch on a trunk**
- Model: two trunk ends with different `nativeVlan`.
- Manifests: untagged/native traffic lands in the wrong VLAN → unintended
  cross-VLAN reachability (a security bug) or broken native-VLAN traffic. Emit the
  real syslog: `%CDP-4-NATIVE_VLAN_MISMATCH`.
- Reveal: `show interfaces trunk` (Native vlan column differs), syslog.
- Fix: match native VLANs on both ends.

**I. Duplex mismatch**
- Model: one side `full`, other `half`/`auto`-resolved-to-half on a link.
- Manifests: link stays **up/up** but `degraded` — partial loss + latency. Half
  side records late collisions; full side records FCS/CRC + runts. Set lossPct
  ~40–60%.
- Reveal: `show interfaces` (late collisions / runts / input errors rising),
  `show interfaces status` (a-half vs a-full).
- Fix: match duplex on both ends (or both `auto`).

**J. Speed mismatch / hard-coded incompatibility**
- Model: incompatible hard-set speeds.
- Manifests: link won't establish → `link_down` (down/down), `notconnect`.
- Reveal: `show interfaces status`.
- Fix: matching/auto speed.

**K. Duplicate IP address (conflict)**
- Model: two interfaces, same IP, same subnet.
- Manifests: erratic replies / ARP flapping → `ip_conflict`. Emit
  `%IP-4-DUPADDR`. Ping loss is intermittent, not clean.
- Reveal: syslog, `show arp` (flapping), `arping`.
- Fix: give one host a unique IP.

**L. Wrong cable / wrong port (and crossover vs straight-through)**
- Model: cable connected to an unintended interface; or, if auto-MDIX is OFF,
  a like-to-like link with the wrong cable type.
- Manifests: wrong segment connected (unexpected reachability) or `link_down` if
  cable type is wrong with auto-MDIX off.
- Reveal: the map, `show cdp neighbors` (unexpected/absent neighbor).
- Fix: move the cable / use the correct cable type.

**M. Wrong interface on a multi-port device (right device, wrong port)**

Model: a cable connects to the correct peer DEVICE but the wrong INTERFACE on it
— e.g. a switch uplinked to a router's WAN/point-to-point port (10.0.0.2/30)
instead of its LAN port (192.168.2.1/24). Distinct from fault L: the cable type
is fine and the right two devices are joined; only the chosen port is wrong.
Manifests: this is the nastiest "everything looks right" failure. IP addressing,
default gateways, and static routes can ALL be correct, and the route even shows
as active in show ip route — yet end-to-end pings fail, because the LAN segment
has no physical path through the intended gateway interface. The misconnected
interface is in the wrong subnet (or has no IP), so traffic for the LAN never
egresses where it should. Surfaces as no_route / host_no_gateway at the host
even though the config reads as complete.
Reveal: the map (trace which port each cable lands on), and crucially the
interface inspector / show ip interface brief — compare each interface's SUBNET
against what its cable actually connects to. The tell: the device reachable over a
cable is in a different subnet than the interface that cable is plugged into.
Fix: move the cable to the correct interface (or move the IP to the cabled
interface) so the WAN IP+cable and the LAN IP+cable each live on the SAME port.
Teaching value: reinforces "check Layer 1 before you doubt Layer 3" — perfect
routing config cannot save a cable going to the wrong port. Strong candidate for
an intermediate troubleshooting mission once Mission 003-style topologies exist.

## 4. Mission integration

- A troubleshooting mission ships a **pre-built, mostly-working** topology +
  `faults[]`. Player gets a client complaint ("Sales can't reach the file server,
  but printing works"), not a checklist.
- Tick loop: `allFixed = faults.every(f => f.isFixed(topology))` AND the objective
  `checkPing` passes → complete.
- **Scoring (ties into accuracy, see Part 2):** track commands used, time, and
  whether the player changed only what was broken. Penalize "shotgun" fixes
  (reconfiguring things that weren't faulted). Award more stars for diagnosing
  with `show` before editing.
- **Hint ladder** reuses `revealedBy` + `failurePoint`: nudge ("check Layer 1
  first") → suggest the exact `show` command → reveal the faulted interface.

## 5. Build order suggestion
1. Upgrade `checkPing` → `PingResult` with `failureReason`/`degraded`.
2. Implement the `Fault` shape + `apply`/`isFixed` and a mission `faults[]` loader.
3. Ship faults **A, B, C, D, E** first (pure L3, reuse existing engine, huge
   teaching value).
4. Add VLAN faults **F, G, H** once the L2/L3 switch split (from
   NETWORKING_ACCURACY.md Prompt 1) is settled.
5. Add **I, J, K, L** (degraded/physical) last — they need counters and the
   richer `PingResult`.

---

# PART 2 — "Make It Addictive" Ideas (quick reference)

### The success moment
- Juice the working-ping payload: rising audio tones as replies come back, cable
  pulses green, `5/5, 0% loss` flourish, subtle mission-complete celebration.
- Make `Request timed out` vs `Reply from...` feel like night and day — this is
  the core dopamine hit players chase.

### Troubleshooting missions (highest-value feature — see Part 1)
- Hand the player a broken network; they diagnose with `show` commands.
- Most job-realistic skill and intrinsically a puzzle.
- Powered by the fault-injection system above.

### Live-network / SLA mode (reuses tower-defense DNA)
- Once a network is live it must STAY up.
- Uptime/SLA meter + random events: cable cut, port failure, rogue device, DHCP
  scope exhaustion, spanning-tree disruption.
- Race to diagnose + fix before client satisfaction drains. "One more wave" loop.

### Mastery scoring (protects accuracy)
- Star-rate 1–3 on real best practice, not just "does it ping":
  right-sized subnets (no wasted IPs), no VLAN 1 for management, default route vs
  many statics, route summarization, only-fix-what's-broken.
- Show the "optimal" solution after each run so failure teaches.

### Career progression
- Reputation/level system: home LAN → bigger clients → better suppliers (cheaper
  gear = more margin) → expanding catalog (L3 switch, firewall, wireless AP, ISP
  router).
- Skill tree mapped to **actual CCNA blueprint domains** (fundamentals →
  switching → routing → IP services → security) — doubles as a study map.
- In-game "certifications": mock CCNA-style quizzes as milestone gates + badges.

### Replayability & sharing
- Procedural mission seeds: same concept, different addressing/topology, so
  missions aren't memorized after one run.
- Sandbox / free-build mode for tinkering.
- Challenge codes: design a broken network, share a seed, others race to fix;
  leaderboards on time / efficiency / IPs wasted.

### In-context learning (stops bounce)
- Built-in man-page / knowledge base reachable mid-mission; hover a command for
  real syntax + one-line "why".
- Hint ladder: nudge → suggest `show` command → reveal. Keeps beginners unstuck
  instead of quitting.

### Caution — avoid the manipulative end of "addictive"
- Skip loot-box randomness, energy timers, and FOMO daily-login pressure. With
  brand-new learners these add friction and can sour them on the subject.
- Lean on intrinsic stickiness (the green-ping hit, troubleshooting puzzles,
  visible mastery) — stickier AND keeps the teaching honest.

### Recommended first build
- **Troubleshooting + live-SLA combo** — highest engagement-per-effort, reuses the
  existing ping engine and tower-defense framing.
