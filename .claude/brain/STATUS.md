# STATUS — where NetSim is right now

_Last refreshed: 2026-09-22 (sandbox subnet planner). Keep this describing **now**; remove finished items._

## Health
- `npm test` → **833 tests / 34 files passing** (Vitest 4).
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
- **Host "Configure GUI"** (right-click a powered PC / server / IP phone / laptop →
  `HostConfigPanel.jsx`): a form over the machine's own shell. `engine/hostConfig.js` (pure)
  turns it into real commands — `ip` / `dhclient` on Linux, `netsh` / `ipconfig` on a Windows
  laptop — runs them through the same engine as the terminal (`executeDeviceCommands`), and
  shows them before and after Apply. Routers and switches are CLI-only on purpose; firewalls
  keep their own console.
- **Inspector quick IP edit** goes through the same engines (`engine/interfaceAddress.js`):
  hosts via the planner above, routers/firewalls/switch SVIs via real IOS (so overlap /
  duplicate / network-address checks apply, and the terminal's CLI mode is left as it was).
  The ISP is not editable.
- **Endless, pannable floorplan** (drag empty background; `panOffset` in `GameContext`).
- **UI design system** — tokens in `index.css` `:root`, LED-as-signal colour language, two
  self-hosted fonts, SVG icon set; rules in `.claude/rules/ui.md`.
- **Dev/QA mode** (`src/devMode/`): 16 presets (working + broken), foundation smoke tests,
  live state inspector. Presets drive the real engine — no state writes.
- Auto-save to localStorage + Export/Import JSON (`utils/saveLoad.js`), reset guard,
  client-side login gate for beta (`AuthContext`, bcryptjs).
- **CI** (`.github/`): vitest on PR, GitHub Pages deploy, AI accuracy review
  (`ai-review.js`), mission QA, failure explainer, full accuracy audit.

- **Paced service tickets + alerts** (`engine/ticketScheduler|alertSchedule|ticketEngine|ticketFaults.js`):
  randomized 10–20 min gaps after a fix, ×2.5 while another job is active, ≤2 open, reminder ladder
  5/10/20 min, four fault types (loose cable, IP reset, adapter off, router port shut). Fixing one
  shows a "Service restored" toast + inbox message with reputation and money.
- **Job board + offers** (`engine/jobBoard.js`, `NotificationLayer`): Career lists only available
  jobs; new ones pop an accept / decline-for-now card; the Career rail icon carries a badge (open
  tickets + pending offers). Rail buttons are large with labels.
- **View job → Brief / Topology tabs** (also from the active job panel). Client jobs draw the real
  devices (`blueprint.topology`); legacy 003–005 diagrams fixed and covered by a layout test.
- **Host Configure GUI** (right-click → Configure GUI on PC/server/laptop) writes through the CLI
  engines; inspector quick IP edit uses the same path.
- **DNS phase 1** (`models/dns.js`): names resolve only through a configured name server the host can
  really reach (UDP/53 through routing, NAT, firewall) — no built-in table. Name-server *lists*
  (`dns_servers` by hand over `dhcp_dns_servers` from the lease), `resolvectl` / `nslookup` / `cat resolv.conf`
  on Linux, `netsh … dns` / `nslookup` on Windows, `ip name-server` / `ip domain-lookup` on routers and
  switches, GUI fields in the host window, UDP/53 in the capture, two dev presets (16 total). Only the public
  resolvers answer; see `docs/NETWORKING_ACCURACY.md` §DNS rules.
- **Sandbox subnet planner** (`engine/subnetPlanner.js`, `components/SubnetPlanner.jsx`, button in
  `SandboxPalette`): davidc.net-style divide/join table (binary tree, pre-order `0/1` code), per-row
  range / broadcast / hosts / optional wildcard, a label per subnet, Join cells = summary routes, and an
  address-space note (RFC 1918 / 5737 / 6598 / special blocks). A paper tool — writes no device state;
  kept in localStorage `netsim_subnet_planner`.

## In flight / recently touched
- UX/UI + gameplay cleanup on floorplan and mission view (last few commits: "clean up
  UX UI and gameplay", "fix mission view and visual floor plan", "floor clean up").
- New mission + narrative type ("full new playstyle") — the client/career layer above.

## Next up (in priority order)
0. **DNS phase 2** (`docs/DNS_DESIGN.md`): DNS service on servers (Services → DNS record table, Packet-Tracer
   style) and routers (`ip dns server`, `ip host`, `show hosts`), a LAN-server preset, `resolves` mission condition.
   Phase 3: forwarders, CNAME, TTL cache (`ipconfig /displaydns|/flushdns`).
1. **Act 2 — fault-injection / troubleshooting missions**: pre-broken topologies, no
   step-by-step hints, diagnose with `show` commands. Design in
   `docs/NETSIM_FAULTS_AND_FEATURES.md`. Use `/fault-scenario`.
2. Refine generic reason codes: `subnet_mismatch` first, then `gateway_unreachable`,
   `ip_conflict`, `duplex_mismatch` (all currently fall through to `no_route`).
3. More clients/missions on the declarative DSL (`/new-mission`); more service tickets.
4. Admin-laptop tool family from `docs/ADMIN_LAPTOP_AND_TOOLS.md` — port scanner and
   WireFish are still spec-only; the Phase 3 packet-engine refactor needs an owner decision.
5. Backlog: live-network/SLA mode polish, mastery scoring, shop margins,
   click-to-connect cabling.

## Known rough edges
- **Host-shell simplifications still open** (documented, not bugs): every interface boots
  `admin_down` (real Linux/Windows hosts boot with the adapter up) — fixing it properly means
  deriving link state from power (a never-powered switch already forwards) *and* rewriting the
  "bring it up" step in every mission, so it needs its own change and the owner's go-ahead;
  `ip link set down/up` keeps static routes (real Linux flushes them on down); one address per
  interface (a second `ip addr add` replaces, real Linux adds a secondary); one default route
  per host. DNS is per host, not per adapter (hosts have one NIC); `ping -c N` still sends a fixed 4 echoes
  in the animated terminal ping.
- The main game shell is desktop-only (drag-and-drop map, terminals); login and the tour are
  responsive down to phone width.
- `docs/` filenames are inconsistent in case (`Roas-Sandbox-LAB.md`, `dhcp-sandbox-lab.md`,
  `NETWORKING_AUDIT.md`); older docs reference names that no longer match exactly.
- `docs/ADMIN_LAPTOP_AND_TOOLS.md` still says "nothing here is implemented yet" — the
  laptop + firewall web UI *are* implemented; the doc's status line is stale.
