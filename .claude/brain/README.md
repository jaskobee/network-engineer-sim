# NetSim Brain

This directory is the project's long-term memory for the coding agent. It is
versioned in git so every session — and every teammate's session — starts with
the same knowledge instead of re-deriving it from the code.

## What lives where

| File | Purpose | Loaded when |
|---|---|---|
| `STATUS.md` | What is done, in flight, and next. Dated. | Every session (via `CLAUDE.md` `@`-include) |
| `DECISIONS.md` | Locked design decisions and *why*. Do not relitigate silently. | Every session (via `CLAUDE.md` `@`-include) |
| `GLOSSARY.md` | Codes, names, DSL vocabulary, interface naming. | On demand — read when a term is unfamiliar |
| `LESSONS.md` | Gotchas that cost time once. | On demand — read before touching a listed area |

Companion mechanisms outside this folder:

- `CLAUDE.md` (repo root) — the constitution: identity + hard rules + pointers. Kept short.
- `.claude/rules/*.md` — path-scoped rules, auto-attached when the agent edits matching files.
- `.claude/skills/*/SKILL.md` — step-by-step procedures (`/accuracy-gate`, `/new-mission`, …).
- `.claude/agents/*.md` — specialist subagents (`accuracy-reviewer`, `mission-qa`).
- `docs/NETWORKING_ACCURACY.md` — the hard networking spec. The brain points at it; it does not duplicate it.
- Claude Code auto-memory (`~/.claude/projects/-home-jsk-Documents-Projects-network-engineer-sim/memory/`) —
  personal, per-machine, not versioned. Use it for user preferences and session-local
  observations. Anything a teammate should also know goes **here**, not there.

## Maintenance rules

1. **Update, don't append forever.** `STATUS.md` describes *now*; delete finished items
   rather than leaving a changelog (git history is the changelog).
2. **Every decision gets a date and a why.** A decision without a rationale will be
   re-argued in six months.
3. **Lessons are for non-obvious things.** If the code or a test already explains it,
   it does not belong in `LESSONS.md`.
4. **Numbers go stale fastest.** Test counts, mission counts, and reason-code lists in
   `STATUS.md`/`GLOSSARY.md` must be refreshed whenever they change — run `/brain-update`
   at the end of any substantial piece of work.
5. **Never put secrets, API keys, or personal data in the brain.**
