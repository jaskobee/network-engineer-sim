---
paths:
  - ".github/**"
---

# Rules: CI & automation (`.github`)

1. **Keep the `ANTHROPIC_API_KEY` guard** at the top of every script that calls the
   API (`ai-review.js`, `mission-qa.js`, `explain-failures.js`, `full-accuracy-audit.js`)
   so forks and keyless runs skip cleanly instead of failing.
2. **Model ids**: use the current Claude 5 family (`claude-opus-5` / `claude-sonnet-5`)
   — check the `claude-api` skill before changing one.
3. `ci.yml` must keep running `npm test` (Vitest) and `npx vite build` on every PR.
   Never make the accuracy review a replacement for tests.
4. `deploy.yml` publishes `dist/` to GitHub Pages; dev mode must remain compiled out
   of that build (`import.meta.env.DEV`).
5. The AI review reads `docs/NETWORKING_ACCURACY.md` as its spec at runtime — if the
   spec moves or is renamed, update the path in the script.
6. Never commit secrets; scripts read everything from workflow env.
