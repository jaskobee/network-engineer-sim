---
name: new-preset
description: Add a dev-mode topology preset (working or deliberately broken) to src/devMode/presets.js that drives the real engine via CLI commands, plus its test. Use when asked for a QA preset, a reproducible sandbox scenario, or a one-click broken topology.
---

# New dev-mode preset

A preset is a **scripted player**, not a state fixture. It must reach its end state
only through `addSandboxDevice`, `sbConnectInterfaces`, and `engine.execute(device,
cmd)`.

## 1. Pick the scenario
Source from `docs/foundation-smoke-test.md`, the `docs/*-lab.md` files, or a mission's
topology. Decide:
- `category: 'working'` with a `pingCheck { src, dst }` that must be `reachable`, or
- `category: 'broken'` with `expectedFailure: '<failureReason>'` (exact code from
  `.Codex/brain/GLOSSARY.md`).
- Optional `pingCheck.service` (e.g. `{ protocol:'tcp', port:443 }`) and
  `pingCheck.kind: 'webui'` for admin-laptop GUI scenarios.

## 2. Add metadata to `PRESETS[]` in `src/devMode/presets.js`
```js
{
  id: 'kebab-id-solved' | 'kebab-id-broken',
  label: 'Human label (solved|broken)',
  category: 'working' | 'broken',
  expectedFailure: 'no_return_path',          // broken only
  description: 'One line: what it builds and what the check should show.',
  pingCheck: { src: '…', dst: '…' },
}
```

## 3. Write the builder and map it
- `function _camelName(ctx) { … }` below the existing builders. Reuse a `_build*Base`
  helper when a working/broken pair shares a topology (pattern: `_buildROASBase(ctx,
  uplinkMode)`).
- Use `exec(sbEngine, dev, 'enable', 'configure terminal', …, 'end')` and
  `exec(sbPcEngine, pc, 'ip addr add …/24 dev eth0', 'ip link set eth0 up',
  'ip route add default via …')`.
- Comment the *one* thing that makes a broken preset broken.
- **Never** call `ctx.refresh()`; never assign to device/interface fields.
- Add `'kebab-id': _camelName,` to the `builders` map in `buildPreset()`.

## 4. Test in `src/devMode/__tests__/presets.test.js`
Build the preset with the same ctx shape the existing tests use and assert:
- working → `result.reachable === true`
- broken → `result.reachable === false && result.failureReason === expectedFailure`
Also assert the preset's id is present in `PRESETS` and has a builder (there is
likely already a table-driven test doing this — extend it rather than duplicating).

## 5. Verify
`npm test`, then open the dev server, toggle DEV mode, click the preset and confirm
DevPanel shows ✓ against the expected result. Update `STATUS.md` preset count via
`/brain-update` if you care about the number staying accurate.
