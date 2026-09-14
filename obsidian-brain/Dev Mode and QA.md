---
tags: [devmode, qa, testing]
---

# Dev Mode and QA

`src/devMode/` — a developer/QA-only layer, compiled entirely out of production
(`import.meta.env.DEV`-gated, never reachable in a shipped build). Its one job: drive
the **real** engine faster than manual clicking, never bypass it.

## The rule that makes dev mode trustworthy

> "Dev mode is a faster way to drive the real engine, never a way around it."

A preset builder reaches all of its state through `addSandboxDevice`,
`sbConnectInterfaces`, and `engine.execute(device, cmd)` — real CLI commands against
real `Device`/`Topology` objects. Writing `iface.ip = '...'` or
`device.routes.push(...)` directly inside a preset builder is a bug: it would make a
preset *look* solved without the engine agreeing it's solved, which would hide real
engine defects from every QA pass run against it. See `.claude/rules/devmode.md`.

## Presets (`src/devMode/presets.js`)

Each preset has metadata in `PRESETS[]` —
`{ id, label, category: 'working'|'broken', expectedFailure?, description,
pingCheck: { src, dst, service?, kind? } }` — plus a builder function in the
`builders` map inside `buildPreset()`. A **broken** preset declares its
`expectedFailure` up front so `DevPanel` can show a live ✓/✗ against the engine's
*actual* `failureReason` — the preset is only "correctly broken" if the real engine
agrees on *why*.

Presets as of this writing span the accuracy-critical scenarios documented
elsewhere in this vault:

- `basic-lan-solved` / `two-router-routing-solved` / `two-router-one-way-broken` —
  see [[Routing and Static Routes]]
- `roas-solved` / `roas-access-broken` — the canonical access-vs-trunk ROAS failure,
  see [[Router-on-a-Stick (Inter-VLAN Routing)|Router-on-a-Stick]]
- `dhcp-local-solved` / `dhcp-relay-solved` / `dhcp-relay-no-helper-broken` — see
  [[DHCP]]
- `firewall-zone-solved` / `firewall-default-deny-broken` /
  `firewall-asymmetric-outside-broken` — see
  [[Stateful Firewall]]
- `admin-laptop-firewall-ui-solved` / `admin-laptop-crosszone-router-ui-solved` /
  `admin-laptop-crosszone-router-ui-broken` — see [[Admin Laptop and Tools]]

(Exact count drifts as new scenarios are added — check `src/devMode/presets.js`
directly rather than trusting a number here.)

**Builder ctx**: `{ addSandboxDevice, sbTopology, sbEngine, sbPcEngine,
sbConnectInterfaces, setMode, clearSandbox }`. A builder never calls `ctx.refresh()`
itself — the caller (`DevPanel`) batches multiple builder calls and refreshes once
at the end, so a preset build doesn't render half-applied mid-construction.

## Smoke tests

`src/devMode/smokeTests.js` — a programmatic twin of `docs/foundation-smoke-test.md`,
covering the same ground as a fast, scripted pass.

## Adding a new preset

Register in **both** places (`PRESETS[]` metadata and the `builders` map), and add a
test in `src/devMode/__tests__/presets.test.js` asserting the expected
`reachable`/`failureReason` after the build. Use the `/new-preset` skill (see
[[Working with Claude Code]]). Source real-world scenarios from
`docs/foundation-smoke-test.md` and the `docs/*-lab.md` files so presets stay in sync
with the documented labs rather than drifting into their own parallel scenario set.

## Related

[[Failure Reason Codes]] ·
[[Working with Claude Code]] · [[Fault Injection System (Act 2)]]
