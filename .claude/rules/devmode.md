---
paths:
  - "src/devMode/**"
  - "src/components/DevPanel.jsx"
---

# Rules: dev / QA mode (`src/devMode`, `DevPanel.jsx`)

1. **Drive the engine, never write state.** Presets and smoke tests reach their state
   only through `addSandboxDevice`, `sbConnectInterfaces`, and `engine.execute(device,
   cmd)`. Writing `iface.ip = …`, `device.routes.push(…)` or similar is a bug — it
   hides real engine defects from QA.
2. **Broken presets are genuinely broken** and declare `expectedFailure` so DevPanel
   can show ✓/✗ against the engine's actual `failureReason`.
3. **Register in two places**: `PRESETS[]` metadata *and* the `builders` map in
   `buildPreset()`. Add a test in `src/devMode/__tests__/presets.test.js` that builds the
   preset and asserts the expected `reachable` / `failureReason`.
4. **Do not call `ctx.refresh()` inside a builder** — the caller batches it.
5. **Gating**: everything here is behind `import.meta.env.DEV`. Never leak a preset,
   unlock or force-complete into a production path.
6. Source scenarios from `docs/foundation-smoke-test.md` and the `docs/*-lab.md` files
   so dev presets stay in sync with the documented labs.
