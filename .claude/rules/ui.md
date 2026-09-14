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
