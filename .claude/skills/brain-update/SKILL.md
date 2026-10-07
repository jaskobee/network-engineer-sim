---
name: brain-update
description: Refresh the project brain (.claude/brain/PLATFORM.md and each product's STATUS, DECISIONS, GLOSSARY, LESSONS under .claude/brain/netsim and .claude/brain/cloud) after substantial work so the next session starts with accurate knowledge. Use at the end of a feature, after a design decision, after a gotcha, or when the user says "remember this for the project".
---

# Brain update

The brain is versioned, shared memory. Keep it **true now**, short, and dated.

Layout (`.claude/brain/README.md`): `PLATFORM.md` for what both products share (layout, packages,
build/deploy, platform decisions, design system); `netsim/` and `cloud/` for each product. Put each
fact in exactly one place — the product's files if only that product needs it.

## 1. Gather what changed
```bash
git status --short
git log --oneline -10
npm test 2>&1 | tail -4
```

## 2. Update each file only where something actually changed

**`<product>/STATUS.md`** (and `PLATFORM.md` → Health for repo-wide counts)
- Bump `_Last refreshed_` to today.
- Test/file counts from the `npm test` output, per Vitest project (netsim, cloud-engineer,
  @sim/kernel, @sim/ui, repo) and the total.
- Move finished "Next up" / "In flight" items into "Shipped and stable" (one line
  each) — or delete them if they're now obvious from the code.
- Add newly discovered rough edges; remove fixed ones.

**`<product>/DECISIONS.md`** (or `PLATFORM.md` for a repo-wide one) — only for a choice that constrains future work and was
confirmed by the user. Format: what, why, date. If a listed decision was
deliberately reversed, edit it in place and note the date of reversal.

**`<product>/GLOSSARY.md`** — NetSim: reason codes, condition types, device types, mission fields,
preset ctx keys, CLI output strings. Cloud Engineer: operations, outcome codes, resource types, mission
conditions, UI names. Keep tables sorted the way they already are.

**`<product>/LESSONS.md`** — a gotcha that cost real time and isn't obvious from code/tests.
Format: symptom → cause → rule. Delete a lesson if the underlying cause was fixed.

## 3. Check the `CLAUDE.md` files still tell the truth
Root `CLAUDE.md` (platform), `apps/netsim/CLAUDE.md`, `apps/cloud/CLAUDE.md`. Short by design — only touch
one if a hard rule changed or a pointer broke.

## 4. Personal vs shared
Anything about *this user's* preferences or *this machine* goes to Claude Code
auto-memory (`~/.claude/projects/-home-jsk-Documents-Projects-network-engineer-sim/memory/`),
not the brain. Anything a teammate should know goes in the brain.

## 5. Don't
- Don't write changelogs into the brain — git history is the changelog.
- Don't record secrets, credentials, or personal data.
- Don't duplicate the specs (`docs/netsim/NETWORKING_ACCURACY.md`, `docs/cloud/AZURE_ACCURACY.md`); link to
  their sections instead.
