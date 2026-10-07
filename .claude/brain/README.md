# The brain

This directory is the project's long-term memory for the coding agent. It is versioned in git so
every session — and every teammate's session — starts with the same knowledge instead of
re-deriving it from the code. The repo holds two products, so the brain has one part per product
plus one for what they share.

## What lives where

| File | Purpose | Loaded when |
|---|---|---|
| `PLATFORM.md` | The products, repo layout, shared packages, build/deploy, platform decisions, shared design system | Every session (root `CLAUDE.md`) |
| `netsim/STATUS.md`, `netsim/DECISIONS.md` | NetSim: done / in flight / next; locked decisions and *why* | Working in `apps/netsim` (its `CLAUDE.md`) |
| `netsim/GLOSSARY.md`, `netsim/LESSONS.md` | NetSim codes, DSL vocabulary; gotchas | On demand |
| `cloud/STATUS.md`, `cloud/DECISIONS.md` | Cloud Engineer: the same, for Azure | Working in `apps/cloud` (its `CLAUDE.md`) |
| `cloud/GLOSSARY.md`, `cloud/LESSONS.md` | Azure model, operations, outcome codes, missions; gotchas | On demand |

Companion mechanisms outside this folder:

- `CLAUDE.md` (repo root) — platform constitution; `apps/netsim/CLAUDE.md` and `apps/cloud/CLAUDE.md` —
  each product's hard rules. Kept short.
- `.claude/rules/*.md` — path-scoped rules, auto-attached when the agent edits matching files.
- `.claude/skills/*/SKILL.md` — procedures (`/accuracy-gate` for NetSim, `/azure-gate` for Cloud Engineer, …).
- `.claude/agents/*.md` — specialist subagents (`accuracy-reviewer`, `mission-qa` — NetSim).
- Hard specs: `docs/netsim/NETWORKING_ACCURACY.md`, `docs/cloud/AZURE_ACCURACY.md`. The brain points at them;
  it does not duplicate them.
- Claude Code auto-memory — personal, per-machine, not versioned. Anything a teammate should also know goes
  **here**, not there.

## Maintenance rules

1. **Update, don't append forever.** STATUS files describe *now*; delete finished items rather than leaving a
   changelog (git history is the changelog).
2. **Every decision gets a date and a why.** A decision without a rationale will be re-argued in six months.
3. **Put a fact in exactly one place**: the product's file if only that product needs it, `PLATFORM.md` if
   both do.
4. **Lessons are for non-obvious things.** If the code or a test already explains it, it does not belong in
   LESSONS.
5. **Numbers go stale fastest.** Test counts, mission counts and code lists must be refreshed whenever they
   change — run `/brain-update` at the end of any substantial piece of work.
6. **Never put secrets, API keys, or personal data in the brain.**
