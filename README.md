# Network Engineer Simulator — MVP

NetSim — Project Summary (as of 2026-06-14)
What It Is
A browser-based networking education game inspired by Cisco Packet Tracer and tower-defense shop loops. You play as a network engineer: accept client jobs, buy hardware from your supplier, configure devices via real CLI commands, and collect payment when the network works. Built entirely in the browser — no Docker, no Linux required.

Running at: http://localhost:5174 (dev server) | Project path: C:\Users\jaskoX\Claude\Projects\ProjectPing\network-engineer-sim\

Tech Stack
Layer	Choice
Build	Vite 5
UI	React 18 (JavaScript, no TypeScript)
Drag & Drop	@dnd-kit/core + @dnd-kit/utilities
Terminal	@xterm/xterm@5.5 + @xterm/addon-fit
State	Plain React Context (GameContext)
Styling	Plain CSS (index.css)
File Structure

src/
  data/
    deviceCatalog.js     — 4 buyable devices (Router, Switch, PC, Server)
    missions.js          — MISSIONS array (4 jobs with rewards, prerequisites)
  models/
    ipUtils.js           — isValidIp, ipToNum, networkAddress, maskToPrefixLen
    Device.js            — Device class, createInterface(), normalizeIfName()
    Topology.js          — devices Map, connect/disconnect, checkPing() BFS
    CLIEngine.js         — IOS-style CLI (router/switch), executePingAsync()
    PCCLIEngine.js       — Linux-style CLI (pc/server), executePingAsync()
  state/
    GameContext.jsx      — all game state + actions exposed via useGame()
  components/
    Shop.jsx             — buy devices, deducts budget
    Inventory.jsx        — purchased devices not yet placed (draggable)
    Floorplan.jsx        — map canvas, cables, ping dots, hover tooltip
    ContextMenu.jsx      — right-click: Open Terminal, Power On/Off, Remove
    DeviceInspector.jsx  — cable connect/disconnect controls for selected device
    TerminalPane.jsx     — multi-tab terminal, pop-out float mode, async ping
    MissionPanel.jsx     — job board, active mission checklist, completion modal
  App.jsx                — layout, DnD wiring, resizable bottom panels
  index.css              — dark theme, layout CSS
Architecture Decisions
Mutation + tick pattern: Device/Topology objects are mutated in place by CLI engines. After any mutation, call refresh() which increments a tick counter in GameContext, causing consumers to re-render.

Interface ID format: "dev-1:GigabitEthernet0/0" — composite string, split on first :.

Two CLI engines:

CLIEngine — IOS state machine (user_exec → priv_exec → global_config → interface_config). Used by router and switch.
PCCLIEngine — Linux shell (ip addr, ip link, ip route, ifconfig, ping). Used by pc and server.
xterm persistence: All TermSession components stay mounted (never unmount). Inactive tabs use display: none. This preserves xterm instances across tab switches.

Async ping: executePingAsync(device, ip, {onStart, onPacket, onDone}) fires callbacks per packet (~1100ms apart), returns a cancel() function. Both engines implement this. Terminal blocks all input during ping; Ctrl-C calls cancel.

Features Built
Core Topology Engine
Devices: Router (4 ports, $1200), Switch (8 ports, $800), PC (1 port, $200), Server (2 ports, $600)
connect(ifaceId1, ifaceId2) / disconnect(ifaceId) — physical cable management
checkPing(srcIp, dstIp) — BFS reachability: checks direct subnet match then longest-prefix static route match
IOS CLI (Router/Switch)
Full command set: enable, disable, configure terminal, hostname, interface <name>, ip address <ip> <mask>, no shutdown, shutdown, exit, end, show running-config, show ip interface brief, show ip route, ip route, ping, no ip address, no ip route

Linux CLI (PC/Server)
ping [-c N] <ip>, ip addr [show|add|del], ip link set <if> up|down, ip route [show|add|del], ifconfig, route, hostname, whoami, uname, clear, echo, help

Tab Completion
Both engines implement complete(device, input) → { newInput, completions }. Tab key in terminal: single match auto-completes + space; multiple matches prints all options on new line; no match plays bell.

Floorplan Map
Drag devices from Inventory onto map; drag placed devices to reposition
Cable layer: blue solid (up), dashed dark (down/admin_down)
SVG icons per type: RouterIcon, SwitchIcon, PCIcon, ServerIcon
Port dots color: green=up, orange=down, grey=admin_down
Hover tooltip (position:fixed, escapes overflow): interface table with IP/prefix and color-coded status
Ping Visualization
5 animated dots (IOS) / 4 dots (Linux), each fired 1100ms apart in sync with terminal output. Green = reachable, red = unreachable. Each dot animates: travel to destination (40%), return (40%), fade out (20%) over 1800ms.

Terminal Panel
Multi-tab: one tab per device, closeable with ×
Pop-out mode: ⊞ button detaches terminal to floating window; drag header to move; drag bottom-right corner to resize; ⊟ to dock back
When floating: DeviceInspector expands to full width below the map
Resizable divider between DeviceInspector and docked terminal (drag left/right)
Right-Click Context Menu
Open Terminal, Power On (admin_down → up/down), Power Off (all → admin_down), Remove from Floorplan

Mission System
Active mission (001 — Mrs. Chen's Home Network): 6 tasks with live progress checking on every tick:

Buy Router + PC
Place both on map
Cable them together
Assign IP to Router LAN + no shutdown
Assign IP to PC + bring up
Ping from Router to PC succeeds
When all 6 pass → Completion modal appears: client avatar, skills learned checklist, +$800 payout, "COLLECT REWARD" button adds money to budget.

Job Board (right sidebar): shows all 4 missions with difficulty stars, payout, description, and required hardware. Missions 2–4 are locked (🔒) until the prerequisite is completed.

Mission	Client	Reward	Teaches
001	Mrs. Chen	$800	Basic LAN, IP assignment, ping
002	Brew & Code Café	$1,500	Switch LAN, multi-host
003	Dr. Patel's Clinic	$2,800	Static routing, subnet segmentation
004	TechNova Startup	$5,500	Inter-VLAN, DMZ, ISP handoff
Current State
Build: Clean (npx vite build passes, only the expected xterm chunk-size warning)
Dev server: npm run dev → http://localhost:5174

