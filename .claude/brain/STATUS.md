# STATUS — where NetSim is right now

_Last refreshed: 2026-09-20. Keep this describing **now**; remove finished items._

## Health
- `npm test` → **440 tests / 21 files passing** (Vitest 4).
- `npx vite build` → clean apart from the expected xterm chunk-size warning.
- Dev server: `npm run dev` (Vite; port 5173 by default, 5174 if 5173 is busy).

## Shipped and stable
- **Legacy missions mission_001–005** (`src/data/missions.js` + hand-written checks in
  `src/data/missionTasks.js`): basic LAN → switch + multi-PC → two-router static routing →
  TechNova (VLAN + ROAS + DHCP + NAT) → Secure the Office (zone firewall, scaffolded on M004).
- **Declarative mission DSL** (`src/engine/missionEngine.js`) — `deviceRoles` + `objectives`
  with `condition` trees. `getMissionRuntime(id)` is the single entry point and also adapts
  the 5 legacy missions, so UI never knows there are two registries.
- **Career layer** (`src/state/CareerContext.jsx`): persistent clients (`data/clients.js`),
  contracts (`data/contracts.js`, `monthly-support`), reputation tiers (`engine/reputation.js`),
  service tickets with real point-faults (`data/serviceTickets.js`), wall-clock SLA
  (`engine/contractClock.js`). First client: `client_local_shop` with
  `mission_local_shop_1` → `mission_local_shop_2` (`financialModel: 'keep'`).
- **Engine**: bidirectional `checkPing` with `failureReason`/`failurePoint`, strict L2
  switch, ROAS, DHCP (DORA/pools/relay/`dhclient`), NAT/PAT overload, zone-based stateful
  firewall with service/port matching, packet capture (`recordCapture`, WiresharkPanel).
- **Three CLI engines**: `CLIEngine` (IOS: router/switch/firewall), `PCCLIEngine`
  (Linux iproute2: pc/server), `WindowsCLIEngine` (CMD: admin laptop when
  `os_type === 'windows'`).
- **Admin Laptop** (`components/AdminLaptop*.jsx`) with a real-data Dashboard tab (balance,
  incidents on an SLA timeline, client happiness, earnings), Firewall Web UI, Browser panel,
  Wireshark panel — GUI writes the *same* device state the CLI does.
- **Endless, pannable floorplan** (drag empty background; `panOffset` in `GameContext`).
- **UI design system** — tokens in `index.css` `:root`, LED-as-signal colour language, two
  self-hosted fonts, SVG icon set; rules in `.claude/rules/ui.md`.
- **Dev/QA mode** (`src/devMode/`): 14 presets (working + broken), foundation smoke tests,
  live state inspector. Presets drive the real engine — no state writes.
- Auto-save to localStorage + Export/Import JSON (`utils/saveLoad.js`), reset guard,
  client-side login gate for beta (`AuthContext`, bcryptjs).
- **CI** (`.github/`): vitest on PR, GitHub Pages deploy, AI accuracy review
  (`ai-review.js`), mission QA, failure explainer, full accuracy audit.

## In flight / recently touched
- UX/UI + gameplay cleanup on floorplan and mission view (last few commits: "clean up
  UX UI and gameplay", "fix mission view and visual floor plan", "floor clean up").
- New mission + narrative type ("full new playstyle") — the client/career layer above.

## Next up (in priority order)
1. **Act 2 — fault-injection / troubleshooting missions**: pre-broken topologies, no
   step-by-step hints, diagnose with `show` commands. Design in
   `docs/NETSIM_FAULTS_AND_FEATURES.md`. Use `/fault-scenario`.
2. Refine generic reason codes: `subnet_mismatch` first, then `gateway_unreachable`,
   `ip_conflict`, `duplex_mismatch` (all currently fall through to `no_route`).
3. More clients/missions on the declarative DSL (`/new-mission`); more service tickets.
4. Admin-laptop tool family from `docs/ADMIN_LAPTOP_AND_TOOLS.md` — port scanner and
   WireFish are still spec-only; the Phase 3 packet-engine refactor needs an owner decision.
5. Backlog: live-network/SLA mode polish, mastery scoring, shop margins,
   click-to-connect cabling, blueprint diagrams in briefings.

## Known rough edges
- **Mission blueprint diagrams have layout bugs in their data** (`src/data/missions.js`):
  `mission_005` places three 155-wide segments at x = 8/150/280 in a 400-wide viewBox, so
  boxes overlap and the ISP box is clipped (and the firewall's long subnet string
  overflows); `mission_004`'s two link labels overlap. Fix the segment coordinates/viewBox.
- The main game shell is desktop-only (drag-and-drop map, terminals); login and the tour are
  responsive down to phone width.
- `docs/` filenames are inconsistent in case (`Roas-Sandbox-LAB.md`, `dhcp-sandbox-lab.md`,
  `NETWORKING_AUDIT.md`); older docs reference names that no longer match exactly.
- `docs/ADMIN_LAPTOP_AND_TOOLS.md` still says "nothing here is implemented yet" — the
  laptop + firewall web UI *are* implemented; the doc's status line is stale.
