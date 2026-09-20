# LESSONS — things that cost time once

Add an entry only when the code/tests don't already make it obvious. Format:
**symptom → cause → rule**.

## Mission DSL
- **`interfaceConfigured` on a multi-port device silently checks the wrong port** →
  `findRoleInterface()` picks "the one interface with an IP" when `ifaceName` is
  omitted; it deliberately does *not* walk cabling adjacency (a switch between router
  and PC breaks that) → always pass `ifaceName` when a role's device has a LAN and a
  WAN port.
- **`pingSucceeded` never turns true in a test** → it reads `topology.pingLog`, which
  only the terminal populates → call `topology.logPing(srcIp, dstIp)` in tests, exactly
  as `TerminalPane.jsx` does after a real ping.
- **A task with `and` over three PCs passes with two configured** → the test asserted
  only the happy path → mission tests must assert the *partial* state is still `false`
  before flipping the last piece (see `mission_local_shop_1.test.js` t5/t6).

## Engine
- **Ping succeeds one way in the UI but the mission says otherwise** → `checkPing` is
  bidirectional; a one-directional static route yields `no_return_path` → when a
  scenario "should work", configure the return route too, and when it "should fail",
  assert the exact reason code.
- **Cross-VLAN ping works with an access-mode uplink** (it must not) → ROAS requires the
  switch↔router port in `switchport mode trunk`; the engine returns `vlan_isolated`
  otherwise → this is the canonical broken preset `roas-access-broken`.
- **DHCP client never gets an address across a router** → broadcasts don't cross
  routers; the *client-facing* router interface needs `ip helper-address <server>` and
  the server needs a return route to the giaddr subnet.
- **Firewall blocks everything after install** → implicit default-deny is intentional
  (teachable moment). Add explicit `firewall-rule permit …`. Inside→outside sessions
  allow returns; outside→inside needs its own rule.
- **A `firewall-rule … service tcp/443` doesn't let a ping through** → correct; ICMP is
  a different service. Don't "fix" this.
- **The host shells used to accept what real ones refuse — and a GUI on top hid it** → a
  second `dhclient` took a second address and leaked the old binding, `ip route add default`
  silently replaced, an off-link gateway was accepted, `ip addr del` left routes behind, and a
  Windows laptop could never enable its adapter (no command) or return a static IP to DHCP.
  Fixed at the root (server re-offers a client's existing binding; real `RTNETLINK` /
  `Nexthop` errors; shared `Device.nextHopReachable/flushRoutesVia`; `netsh interface set
  interface`) → when a GUI plans commands, keep the order real tools need (route delete
  *before* the last address goes; del + add, never a second `add default`) and assert the exact
  command lists in tests — don't "simplify" to whatever an engine tolerates.
- **A shell with no tests hid a dead feature** (`WindowsCLIEngine` had none: the laptop's Windows
  adapter could never come up) → every shell gets a test file that plays the real setup flow
  end to end (`winshell.test.js`, `pcshell.test.js`).
- **Fixing a "lenient" command can expose a missing prerequisite step, not a bug** → hosts boot
  `admin_down`, so `ip route add default` before `ip link set eth0 up` now fails with the real
  `Nexthop has invalid gateway` (plus a hint). That is why missions teach addr → up → route.

## React / state
- **A `setInterval` in a component acts on old state forever** (the ticket spam: a new ticket + email
  every 15 s) → the interval was created once and kept calling the *first render's* function, whose
  `contracts`/`activeTickets` never updated → put the logic in a pure function that takes state as an
  argument (`engine/ticketEngine.tickTickets`), and have the timer call it through a ref to the latest state.
- **IDs repeat after a reload** → module-level counters restart at 1 → restore counters from saved
  data on load (`_restoreIdCounters`) and never let a setter move a counter backwards.
- **Preset builds render half-applied** → `buildPreset()` deliberately does *not* call
  `ctx.refresh()` so `clearSandbox` + `addSandboxDevice` batch → the caller (DevPanel)
  calls `refresh()` once after.
- **Career state not re-rendering** → `clients`/`contracts` are plain objects keyed by
  id (not Maps) precisely so `setState` gets a new reference → keep them plain objects.
- **`CareerContext` can't read GameContext's save blob** → it is mounted *inside*
  `GameProvider`; each context persists its own slice → don't try to fold career data
  into the GameContext save.
- **xterm instances lose scrollback when switching devices** → tabs must stay mounted;
  inactive tabs use `display:none`, never unmount.

## UI
- **xterm text overlaps or wraps after changing its font** → xterm measures cell width
  when the terminal is created; a web font that hasn't loaded yet gives wrong metrics →
  create on the system stack, `document.fonts.load()` the app font, then set
  `term.options.fontFamily` (changing the string forces a re-measure) and `fit()`.
- **`show ip interface brief` wraps ("down do / wn")** → the row is 81 columns and a
  wider mono font shrinks the window below that → keep the default terminal ≥ ~85
  columns. Wrapped `show` output teaches the wrong picture of real gear.
- **A restyle script that rewrites `color:` misses hover handlers** → they assign
  `e.currentTarget.style.color = '#…'`, so text snaps back to an old dim colour on
  mouse-leave → grep `style\.color *=` after any palette change. Likewise string
  sizes (`fontSize: '11px'`) are invisible to numeric-literal transforms — grep both.
- **`.device-node` looks like a hook but was never applied in the DOM** → tests and
  scripts can't find devices by it → locate a placed device by its hostname text
  (`getByText('R1', { exact: true })`). The dead CSS rule was removed.
- **`admin_down` rendered near-invisible** (`#30414d` on graphite) in the tooltip,
  inspector and firewall console → it is a *required* teaching state (Prompt 5), so it
  must stay readable; use `--ink-3` and an unlit LED, not a low-contrast colour.
- **A floating window slides off the bottom of the screen after it grows** (the transcript
  appears after Apply) → clamping only at mount isn't enough → re-clamp from a
  `ResizeObserver` plus window `resize` (`HostConfigPanel`).

## Tooling / environment
- **`find` and `grep` in this shell are functions wrapping the Claude binary** and can
  print `error: unknown option '-S'` / `'-G'` → use `command find` / `command grep`
  (or the Grep/Glob tools) when a plain shell call misbehaves.
- **`npx vite build` warns about chunk size for xterm** → expected, not a failure.
- **Driving the app from Playwright** → typing into xterm needs a click on `.xterm` first;
  a terminal opens *over* the device you right-clicked, so close it (title "Close
  terminal") before the next right-click; IOS `ping` takes ~5.5 s, so poll for its result
  line instead of a fixed wait; `getByText('Disabled', { exact: true })` misses an element
  that also holds a child `<span>` — read the container's `innerText`.
- **Two GitHub Actions call the Anthropic API** (`ai-review.js`, `mission-qa.js`, …) →
  they skip cleanly when `ANTHROPIC_API_KEY` is unset; don't remove that guard.
