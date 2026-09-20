---
tags: [ui, components]
---

# UI Component Map

`src/components/` — all presentational. See [[Architecture Overview]] for the
governing rule: components read `GameContext`/`CareerContext` state and call engine
methods; they never reimplement networking logic themselves.

## The floorplan — the main play surface

`Floorplan.jsx` renders every placed device (`DeviceNode`), cable (`CableLayer`
SVG), floorplan label (`FloorLabel`), the wire-mode connection-preview overlay, and a
ping-animation layer, all inside one endless, pannable canvas:

- **Panning**: click-and-drag anywhere on empty background pans the whole canvas
  (no modifier key needed). Implemented as a single shared `panOffset: {x, y}` in
  `GameContext` — a pure CSS `transform: translate()` on one wrapper div, so every
  existing device/cable/label coordinate stays in the same absolute pixel space it
  always was; panning is a camera move, not a data change. `panOffset` lives in
  `GameContext` (not component-local state) specifically because `App.jsx`'s
  top-level `DndContext.onDragEnd` handler — which spans both the Inventory panel and
  the floorplan — also needs to convert screen coordinates to world coordinates using
  it.
  - The wrapper is `pointer-events: none` with `auto` re-enabled on each device/label
    root (the standard "transparent pass-through, interactive children" CSS pattern)
    so the pan layer doesn't swallow clicks meant for devices.
  - A movement-threshold flag distinguishes an actual pan-drag from a plain click, so
    releasing a pan doesn't also fire background-click-to-deselect.
  - The canvas is genuinely endless: negative world coordinates are valid (no origin
    clamping), and the view recenters to `{0,0}` on every mission/ticket/client
    switch so a player is never dropped into an already-panned-away view of a
    topology they've never seen.
- **Cabling**: right-click a device → "Connect Cable" → click the target device (a
  port picker appears when the source device has multiple free ports) — a visual,
  click-to-connect flow, not manual coordinate entry.
- Every device's terminal is an `@xterm/xterm` instance in `TerminalPane.jsx`. Tabs
  for inactive devices stay **mounted** and hidden with `display: none` — never
  unmounted — because unmounting an xterm instance loses its scrollback, which would
  be a real regression for a player switching between devices mid-task.

## Career and mission surfaces

- `MissionPanel.jsx` — the job board / client list, including a `clientCards` view
  sourced from `availableFutureMissionIds` (see
  [[Career Layer]]).
- `MissionBriefModal.jsx` — "View job": **Brief** and **Topology** tabs (the Topology tab is also opened
  from the active job panel, view-only). `MissionBlueprint.jsx` draws either the real device topology
  (`blueprint.topology`, `engine/topologyGraph.js`) or the older segment diagram (`engine/blueprintLayout.js`).
- `NotificationLayer.jsx` — top-centre toasts ("Service restored…") and the new-job offer card
  (accept / decline for now / view details / hide).
- `ActiveJobPanel.jsx` / `MissionTaskList.jsx` — the in-progress objective checklist,
  driven directly by `getMissionRuntime(id).tasks` + live `checkFn()` results (see
  [[Mission DSL]]).
- `ActiveContractsPanel.jsx` — open service tickets, their SLA countdown, and
  per-client `SatisfactionMeter` bars (now a shared component, also used on the
  [[Admin Laptop and Tools|Admin Laptop dashboard]]).
- `CompanyDashboard.jsx` — the persistent top-strip business summary (balance,
  reputation tier, etc.) visible outside the laptop.
- `ContractClockDriver.jsx` — a headless component whose only job is ticking the ticket engine
  (SLA clock, pacing, reminders — see [[Career Layer]]).
- **Layering:** floorplan ≤ 50 · job panel 1500 · windows 1600 · toasts 2400 · dialogs 2500+ · laptop 3000 · menus 5000.

## The Admin Laptop

`AdminLaptop.jsx` (tab shell) + `AdminLaptopShared.jsx` (shared `Section`/
`relativeTime` helpers, extracted specifically to avoid a circular import between
`AdminLaptop.jsx` and `AdminDashboardTab.jsx`) + `AdminDashboardTab.jsx` (the
dashboard tab) + `FirewallWebUI.jsx` + `BrowserPanel.jsx` + `WiresharkPanel.jsx`. Full
detail in [[Admin Laptop and Tools]].

## The design system (2026-09-20)

One idea runs through the whole UI: **colour is signal.** Surfaces and text are a quiet
cool graphite; the only saturated colours are what a port LED would say — green = up or
done, amber = attention or down, red = fault — plus one blue for whatever you can act on.
Tokens live in `src/index.css` `:root` (`--surface-*`, `--ink*`, `--signal*`, `--led-*`,
`--font-ui`, `--font-mono`); the rules are in `.claude/rules/ui.md`.

- **Type**: Barlow Semi Condensed for the UI, Atkinson Hyperlegible Mono for data and the
  terminal (chosen because IPs, interface names and commands must keep `0/O` and `1/l/I`
  apart). Both are self-hosted in `src/assets/fonts` (SIL OFL). Sentence-case labels, no
  tracked-caps eyebrows.
- **The LED** (`.led`) is the signature: header wordmark, "Saved", interface status in the
  inspector (up / down / administratively down each look different, per the accuracy
  spec), incident urgency, inbox item kind, tour progress.
- **Mission progress is a patch cable** (`.step`, `MissionTaskList.jsx`): one LED per task,
  the cable lit up to the current step, a single breathing blue LED on what's next.
- **Difficulty is signal-strength bars** (`DifficultyBars`), not stars.
- **Login hero** is an 8-port switch faceplate (`Faceplate.jsx`), reused on the tour's first step.
- Icons are SVG from `icons.jsx`; emoji appear only as player content (avatars).
- Shared primitives: `.btn` (`.primary .ghost .danger .icon .on`), `.seg`, `.utab`,
  `.lap-tab`, `CatalogCard` (Shop and Sandbox), `DeviceIcons` (floorplan and catalogs).

See also [[Decisions Log]] §UI design system.

## Other notable components

- `Shop.jsx` / `Inventory.jsx` — buy hardware from `deviceCatalog.js`, then drag from
  inventory onto the floorplan (or use the "Place" button, which is pan-aware — it
  lands new devices in the currently-visible area, anchored to `-panOffset`, not a
  fixed world coordinate that could be scrolled off-screen).
- `DeviceInspector.jsx` — a live state panel per device (interfaces, routing table, VLANs,
  etc.) — a GUI window onto the exact same `Device` fields `show running-config` reads, never a
  second source of truth. Its click-to-edit IP goes through the CLI engines, not a field write.
- `ContextMenu.jsx` — the shared right-click menu (Connect Cable, Power On/Off, Open
  Terminal, Configure GUI on hosts, Disconnect, Add Label Here on the background, etc.).
- `HostConfigPanel.jsx` — the "Configure GUI" window for a powered PC / server / IP phone /
  laptop. A form over the machine's own shell: `engine/hostConfig.js` (pure) reads an adapter,
  plans the real commands (`ip` / `dhclient`, or `netsh` / `ipconfig` on a Windows laptop) and
  runs them through `executeDeviceCommands`, so the GUI can never reach a state the CLI can't.
  The inspector's click-to-edit IP uses the same path (`engine/interfaceAddress.js`; IOS for
  routers / firewalls / SVIs). It shows a "Terminal equivalent" before
  Apply and the transcript after, and the three link states (up / down / disabled).
  Routers, switches and firewalls deliberately have no such window — they are CLI
  devices (the firewall has its own console).
- `ConfigSummary.jsx`, `MissionBlueprint.jsx` — supporting mission-brief rendering.
- `DevPanel.jsx` — the dev-mode preset/smoke-test control panel, `import.meta.env.DEV`
  gated (see [[Dev Mode and QA]]).
- `SandboxPalette.jsx` — free-build sandbox mode device palette.
- `WelcomeModal.jsx`, `LoginPage.jsx` — onboarding and the beta login gate
  (`AuthContext`, bcryptjs-hashed, client-side only).

## Related

[[Architecture Overview]] · [[Career Layer]] ·
[[Admin Laptop and Tools]]
