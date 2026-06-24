# CLAUDE.md — NetSim (network-engineer-sim)

## What this project is
NetSim is a **browser-based networking education game** inspired by Cisco Packet
Tracer + a tower-defense shop loop. The player acts as a network engineer: accept
client jobs, buy hardware, configure devices via **real CLI commands**, and get
paid when the network works. Runs entirely in the browser.

**The mission: teach networking fundamentals CORRECTLY.** Accuracy to CCNA / CCNP /
CompTIA Network+ standards is the whole point of this project.

- Dev server: http://localhost:5174  (`npm run dev`)
- Build check: `npx vite build` (only the expected xterm chunk-size warning is OK)

## Stack
Vite 5 · React 18 (JavaScript, **no TypeScript**) · @dnd-kit/core +
@dnd-kit/utilities · @xterm/xterm@5.5 + @xterm/addon-fit · React Context
(`GameContext`, via `useGame()`) · plain CSS (`index.css`).

## ⛔ HARD RULES (non-negotiable)
1. **Networking accuracy outranks convenience.** If a simplification would teach a
   beginner something they'd have to unlearn for a cert or a real job, do not ship
   it. When in doubt, flag the conflict instead of silently simplifying.
2. Treat **@docs/NETWORKING_ACCURACY.md as a hard spec.** All networking behavior,
   CLI commands, `show` output, and mission validation must comply with it.
3. A Layer 2 switch has **no per-port IPs** — management is one IP on an SVI
   (`interface vlan <id>`), and it does **not** route between subnets/VLANs.
   Inter-VLAN routing requires router-on-a-stick or a Layer 3 switch.
4. A ping only succeeds along a path **real hardware would actually forward**, and
   only if **both** the forward and **return** paths work.
5. Keep IOS idioms (router/switch) and Linux iproute2 idioms (PC/server) faithful
   to their own OS — don't leak one into the other.

## Architecture (quick reference)
- **Mutation + tick:** CLI engines mutate `Device`/`Topology` objects in place,
  then call `refresh()` to bump a tick counter in `GameContext` → consumers
  re-render.
- **Interface IDs** are composite strings: `"dev-1:GigabitEthernet0/0"` (split on
  first `:`).
- **Two CLI engines:** `CLIEngine` = IOS state machine
  (user_exec→priv_exec→global_config→interface_config), used by router + switch.
  `PCCLIEngine` = Linux shell (`ip addr`/`ip link`/`ip route`/`ifconfig`/`ping`),
  used by pc + server.
- **xterm persistence:** all terminal tabs stay mounted; inactive tabs use
  `display:none` to preserve xterm instances.
- **Async ping:** `executePingAsync(device, ip, {onStart,onPacket,onDone})` fires
  per-packet callbacks (~1100ms apart) and returns a `cancel()`.

## File map (src/)
- `data/deviceCatalog.js` — Router (4 ports $1200), Switch (8 ports $800),
  PC (1 port $200), Server (2 ports $600)
- `data/missions.js` — MISSIONS array (rewards, prerequisites)
- `models/ipUtils.js` — isValidIp, ipToNum, networkAddress, maskToPrefixLen
- `models/Device.js` — Device class, createInterface(), normalizeIfName()
- `models/Topology.js` — devices Map, connect/disconnect, checkPing() BFS
- `models/CLIEngine.js` — IOS CLI
- `models/PCCLIEngine.js` — Linux CLI
- `state/GameContext.jsx` — all game state + actions via useGame()
- `components/` — Shop, Inventory, Floorplan, ContextMenu, DeviceInspector,
  TerminalPane, MissionPanel
- `App.jsx` — layout, DnD wiring, resizable panels

## Current state
- **Missions 001, 002, 003 are fully playable and tested.** Mission 004 (TechNova:
  inter-VLAN / DMZ / ISP) is the remaining capstone — not yet built.
- **Switch is strictly Layer 2** (locked design decision). Inter-VLAN routing is
  done via router-on-a-stick; a separate Layer 3 Switch device may come later.
- **Engine foundation is hardened and tested** (~220 Vitest tests): bidirectional
  `checkPing` (returns a result object with a `failureReason`, not a boolean),
  L2/L3 split, overlapping-subnet rejection, shutdown-peer propagation, static +
  default routes, router-on-a-stick (subinterfaces + `encapsulation dot1Q` + trunk
  enforcement), and DHCP (DORA, pools, `ip helper-address` relay, host `dhclient`).
- `failureReason` codes emitted so far: `no_route`, `admin_down`, `link_down`,
  `no_return_path`, `host_no_gateway`, `vlan_isolated`. Still generic (fall through
  to `no_route`): `subnet_mismatch` (deferred), `gateway_unreachable`, `ip_conflict`,
  `duplex_mismatch`.
- ISP node exists; verify whether **NAT (private→public)** is modeled before
  Mission 004 claims to teach ISP handoff.
- **No persistence yet** — state resets on refresh (save/load planned).

## Roadmap / what we're working toward
- **Sandbox mode** exists for free practice. Verification labs live in `docs/`:
  `FOUNDATION_SMOKE_TEST.md`, `SANDBOX_TEST_PLAN.md`, `ROAS_SANDBOX_LAB.md`,
  `ISP_DEFAULT_ROUTE_LAB.md`, `DHCP_SANDBOX_LAB.md`.
- Add the **ISP node to the Sandbox palette**; settle the **NAT** decision.
- Build **Mission 004** (sits on ROAS + default routes + DHCP).
- **Troubleshooting missions** via a fault-injection system — see
  `docs/NETSIM_FAULTS_AND_FEATURES.md` (Part 1). Key idea: faults are real broken
  state evaluated by the real engine; `checkPing` already returns a result object.
- Remaining reason-code refinements (`subnet_mismatch` first), live-network / SLA
  mode, mastery scoring, save/load, shop margins, click-to-connect cabling, network
  blueprint diagrams in mission briefings — see `docs/NETSIM_FAULTS_AND_FEATURES.md`.

## Dev / QA Mode
A developer/QA mode exists (or is planned) for fast testing without manual setup.
**Core principle: dev mode is a faster way to DRIVE the real engine, never a way
around it.** Presets must reach their state by running the same devices, cabling,
and CLI/engine paths a player would — never by writing IPs/routes/statuses/ping
results directly into the data model. A preset that "looks solved" must actually be
solved by the engine, or QA would hide real bugs.
- **Gated** behind a dev-only flag (`import.meta.env.DEV`) and/or a key combo; off by
  default; never reachable in a production build (a teaching tool must not let real
  learners skip missions). Shows an unmistakable "DEV MODE" banner when active.
- Capabilities: mission jump / unlock-all / set-balance / force-complete; one-click
  topology presets (WORKING *and* BROKEN — e.g. one-way route → `no_return_path`,
  access-mode ROAS uplink → `vlan_isolated`, DHCP without helper → no offer); a live
  state inspector (interfaces, routes, DHCP bindings, last `checkPing` result with
  `failureReason`/`failurePoint`); a "run smoke test" button (drives the real engine
  per `docs/FOUNDATION_SMOKE_TEST.md`); topology export/import JSON (doubles as the
  basis for save/load).
- **When testing, prefer dev-mode presets over hand-typing topologies.** Source
  preset scenarios from `docs/FOUNDATION_SMOKE_TEST.md` and the sandbox labs.

## Conventions
- JavaScript only, no TypeScript. Match existing code style.
- **Test runner is Vitest** (`npm test`). Networking behavior is locked in by tests;
  when changing engine logic, update/extend tests so rules can't regress silently.
  "Broken" scenarios must assert the correct `failureReason`, not just failure.
- After any change touching networking behavior, run the accuracy gate in
  @docs/NETWORKING_ACCURACY.md (Prompt 8) before finalizing, and confirm
  `npm test` + `npx vite build` are clean.
- Build/test discipline for big changes: plan first and list files to touch; work in
  phases with a checkpoint each; keep existing missions playable.

---
@docs/NETWORKING_ACCURACY.md