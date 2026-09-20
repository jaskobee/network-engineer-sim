---
paths:
  - "src/components/**"
  - "src/state/**"
  - "src/App.jsx"
  - "src/index.css"
---

# Rules: UI & state (`src/components`, `src/state`, `App.jsx`, `index.css`)

1. **The UI is disposable; the engine is not.** Components read engine state and call
   engine methods — they never reimplement networking logic (no subnet math, no
   reachability guesses in JSX). If a component needs a fact the engine doesn't
   expose, add a read-only accessor to the model.
2. **Mutation + tick**: after any engine mutation call `refresh()` from `useGame()`;
   consumers re-render off the tick. Don't introduce parallel copies of device state
   in React state.
3. **GUI tools share state with the CLI** (Firewall Web UI, laptop tools). A rule added
   in the GUI must appear in `show running-config`, and vice versa. `show running-config`
   is the arbiter.
4. **xterm tabs stay mounted**; hide with `display:none`. Never unmount a terminal to
   "switch" devices.
5. **Two contexts, clear ownership**: `GameContext` = topology/engine/missions;
   `CareerContext` = company/reputation/clients/contracts, mounted inside
   `GameProvider`, persists its own slice. Don't cross-import state the wrong way.
6. **Plain CSS in `index.css`**, JavaScript only, match existing style. No CSS-in-JS,
   no TypeScript, no new UI framework.
7. **Dev-only UI** (`DevPanel`, DEV banner) stays behind `import.meta.env.DEV`.
8. When a UI change alters how a player *learns* something (hint text, error wording,
   status labels like up/up vs administratively down), it is a networking change:
   check it against `docs/NETWORKING_ACCURACY.md` Prompt 5/8.

## Design system (since 2026-09-20)

9. **Tokens, not new hex.** `index.css` `:root` defines surfaces (`--surface-*`), text
   (`--ink`, `--ink-2`, `--ink-3`), `--signal*`, `--led-*`, radii, `--font-ui`,
   `--font-mono`. New/edited UI uses `var(--…)`; don't introduce fresh hex for
   surfaces or text. (Older inline hex is the remapped palette — fine to leave.)
10. **Colour is signal.** Surfaces and text stay graphite. Saturated colour means
    *state* only: green = up/done, amber = attention or down, red = fault/failure,
    blue = actionable/selected. Never colour by category (a firewall is not red, a PC
    is not green). Interface state keeps three distinct looks — up / down /
    administratively down — per `docs/NETWORKING_ACCURACY.md` Prompt 5, and
    `admin_down` must stay legible.
11. **Type.** `--font-ui` (Barlow Semi Condensed) for everything; `--font-mono`
    (Atkinson Hyperlegible Mono) only for data — IPs, hostnames, interface names,
    commands. Sentence-case labels; no tracked all-caps eyebrows. Text ≥ 13px (mono
    chips ≥ 12.5px) and ≥ 4.5:1 on its surface (`--ink-3` is the dimmest allowed).
12. **Icons** come from `components/icons.jsx` (SVG, `currentColor`). No emoji as UI
    controls — emoji only as *content* (client and company avatars).
13. **Reuse the primitives** before inventing one-offs: `.btn` (`.primary .ghost
    .danger .icon .on`), `.led` (`.green .amber .red .blue .breathe`), `.step`
    (mission progress as a patch cable), `.seg`, `.utab`, `.lap-tab`, `CatalogCard`,
    `DifficultyBars`, `DeviceIcons`.
14. **Terminal**: xterm uses Atkinson Mono 13px and loads it *before* re-measuring
    (see `TerminalPane.jsx`). Keep the default window wide enough (~85 columns) that IOS
    `show` output never wraps — wrapped output misrepresents real gear.

