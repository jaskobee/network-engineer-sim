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

## React / state
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

## Tooling / environment
- **`find` and `grep` in this shell are functions wrapping the Claude binary** and can
  print `error: unknown option '-S'` / `'-G'` → use `command find` / `command grep`
  (or the Grep/Glob tools) when a plain shell call misbehaves.
- **`npx vite build` warns about chunk size for xterm** → expected, not a failure.
- **Two GitHub Actions call the Anthropic API** (`ai-review.js`, `mission-qa.js`, …) →
  they skip cleanly when `ANTHROPIC_API_KEY` is unset; don't remove that guard.
