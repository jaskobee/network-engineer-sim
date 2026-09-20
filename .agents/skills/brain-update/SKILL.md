---
name: brain-update
description: Refresh the project brain (.Codex/brain/STATUS.md, DECISIONS.md, GLOSSARY.md, LESSONS.md) after substantial work so the next session starts with accurate knowledge. Use at the end of a feature, after a design decision, after a gotcha, or when the user says "remember this for the project".
---

# Brain update

The brain is versioned, shared memory. Keep it **true now**, short, and dated.

## 1. Gather what changed
```bash
git status --short
git log --oneline -10
npm test 2>&1 | tail -4
```

## 2. Update each file only where something actually changed

**`STATUS.md`**
- Bump `_Last refreshed_` to today.
- Test/file counts from the `npm test` output.
- Move finished "Next up" / "In flight" items into "Shipped and stable" (one line
  each) — or delete them if they're now obvious from the code.
- Add newly discovered rough edges; remove fixed ones.

**`DECISIONS.md`** — only for a choice that constrains future work and was
confirmed by the user. Format: what, why, date. If a listed decision was
deliberately reversed, edit it in place and note the date of reversal.

**`GLOSSARY.md`** — new reason codes, condition types, device types, mission fields,
preset ctx keys, CLI output strings. Keep tables sorted the way they already are.

**`LESSONS.md`** — a gotcha that cost real time and isn't obvious from code/tests.
Format: symptom → cause → rule. Delete a lesson if the underlying cause was fixed.

## 3. Check `AGENTS.md` still tells the truth
It is short by design — only touch it if a hard rule changed or a pointer broke.

## 4. Personal vs shared
Anything about *this user's* preferences or *this machine* goes to Codex
auto-memory (`~/.Codex/projects/-home-jsk-Documents-Projects-network-engineer-sim/memory/`),
not the brain. Anything a teammate should know goes in the brain.

## 5. Don't
- Don't write changelogs into the brain — git history is the changelog.
- Don't record secrets, credentials, or personal data.
- Don't duplicate `docs/NETWORKING_ACCURACY.md`; link to its section instead.
