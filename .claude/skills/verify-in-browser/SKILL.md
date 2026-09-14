---
name: verify-in-browser
description: Start the NetSim dev server, get past the beta login gate, enable DEV mode, and drive or screenshot the real UI to confirm a change works end-to-end (presets, missions, terminals, admin laptop). Use when a change touches UI, hints, layout, or when tests pass but the user wants it confirmed in the running app.
---

# Verify in the browser

Unit tests prove the engine; this proves the player experience.

## 1. Start the dev server (background)
```bash
npm run dev            # Vite; prints the port — 5173, or 5174 if 5173 is busy
```
Wait for the `Local:` line, then confirm:
```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:<port> --max-time 2
```
Stop it afterwards with `pkill -f vite` (allowed in project settings).

## 2. Get past the login gate
The beta gate is client-side (`src/state/AuthContext.jsx`). Use the `test` account —
its password is documented in a comment next to its hash in that file. The session
persists in `sessionStorage` under `netsim_session`.

## 3. Enable DEV mode
`import.meta.env.DEV` is true under `npm run dev`. Toggle the panel with
**Ctrl+Shift+D** or the `DEV` button; a "⚠ DEV MODE" banner confirms it. From the
DevPanel you can load presets, jump missions, set balance, run smoke tests, and open
the live state inspector — use these instead of hand-building topologies.

## 4. Drive it
Preferred order:
1. **`claude-in-chrome` skill** if the Chrome extension is available — navigate,
   click, read console, screenshot.
2. Otherwise a Playwright script in the scratchpad using the system browser:
   ```js
   // scratchpad/verify.mjs  — run with: npx --yes playwright-core@1.55.0 node verify.mjs
   import { chromium } from 'playwright-core'
   const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', headless: true })
   const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
   page.on('console', m => console.log('[console]', m.type(), m.text()))
   page.on('pageerror', e => console.log('[pageerror]', e.message))
   await page.goto('http://localhost:5173')
   // login → Ctrl+Shift+D → load preset → screenshot
   await page.screenshot({ path: 'shot.png', fullPage: true })
   await browser.close()
   ```
   Read the screenshot with the Read tool and describe what you actually see.

## 5. What to check
- No `[pageerror]` / red console output on load or on the action under test.
- The specific change is visible and behaves as intended (state, text, layout).
- Terminals: type the real commands, confirm prompt transitions and output text.
- Mission flow: task checkboxes flip only when the real prerequisite is met.
- Nothing dev-only leaks into a production build: `npx vite build && npx vite preview`
  and confirm the DEV button/banner are absent.

## 6. Report
State plainly what was verified and what wasn't. A screenshot you looked at counts;
"the server started" does not.
