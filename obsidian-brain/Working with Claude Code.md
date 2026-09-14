---
tags: [meta, workflow, claude-code]
---

# Working with Claude Code

How this project structures instructions, skills, and review discipline for AI
coding agents. The live, authoritative versions of everything summarized here are in
the repo itself — this note is an orientation map, not a replacement for reading
them.

## The layered instruction system

| Layer | Location | Loaded | Purpose |
|---|---|---|---|
| Constitution | `CLAUDE.md` (repo root) | every session | identity, hard rules, pointers to everything else |
| Brain — status/decisions | `.claude/brain/STATUS.md`, `.claude/brain/DECISIONS.md` | every session (via `@`-include in `CLAUDE.md`) | what's done/next; locked design choices and *why* |
| Brain — reference | `.claude/brain/GLOSSARY.md`, `.claude/brain/LESSONS.md` | on demand | vocabulary, codes, DSL terms; gotchas that already cost time once |
| Path-scoped rules | `.claude/rules/*.md` | auto-attached when editing a matching path | `engine.md` (models/engine), `missions.md` (data), `devmode.md`, `ui.md`, `ci.md` |
| Hard spec | `docs/NETWORKING_ACCURACY.md` | referenced whenever networking behavior changes | the 8 standing "accuracy prompts," the actual teaching-correctness contract |
| This vault | `obsidian-brain/` | manual, for deep onboarding | prose orientation — see the caveat on [[Home]] |

## The hard rules (from `CLAUDE.md`, non-negotiable)

1. Networking accuracy outranks convenience — see [[Vision and Product]].
2. `docs/NETWORKING_ACCURACY.md` is a hard spec for all networking behavior, CLI
   commands, `show` output, hints, and mission validation.
3. A Layer 2 switch has no per-port IPs, one management SVI, never routes between
   VLANs — see [[Layer 2 Switching and VLANs]].
4. A ping succeeds only along a path real hardware would forward — both directions —
   see [[Ping Reachability Engine (checkPing)|checkPing]].
5. Each OS keeps its own idioms; no leakage — see
   [[The Three CLI Engines]].
6. Dev mode drives the real engine, never bypasses it — see [[Dev Mode and QA]].
7. JavaScript only, no TypeScript. `src/models/` and `src/engine/` stay free of
   React/DOM imports — see [[Architecture Overview]].

Files that must never be touched without explicit sign-off:
`src/models/{CLIEngine,PCCLIEngine,WindowsCLIEngine,Topology,Device,DHCPEngine,
ipUtils}.js` and `src/data/deviceCatalog.js`.

## Skills (invoked as `/name`, or by Claude proactively when the task matches)

| Skill | When |
|---|---|
| `/accuracy-gate` | before finalizing **any** networking/CLI/hint/mission change — runs the Prompt 8 checklist + `npm test` + `npx vite build` |
| `/new-mission` | authoring a mission on the declarative DSL — see [[Mission DSL]] |
| `/new-preset` | adding a dev-mode working/broken topology preset — see [[Dev Mode and QA]] |
| `/cli-command` | adding/fixing a terminal command or `show` output |
| `/fault-scenario` | Act 2 troubleshooting scenarios, ticket faults, new reason codes — see [[Fault Injection System (Act 2)]] |
| `/verify-in-browser` | confirming a change in the running app (this project has **no component/DOM tests** — all UI verification is live, via playwright-core + system Chromium against the real dev server) |
| `/brain-update` | end of substantial work — keep `.claude/brain/*` true |

## Subagents

- **`accuracy-reviewer`** — read-only, independent review of a diff against
  `docs/NETWORKING_ACCURACY.md` and CCNA/Network+ ground truth. A local twin of the
  CI accuracy-review script.
- **`mission-qa`** — plays a mission on paper + runs its test; reports blockers or
  mis-teaching (subtly wrong hints, gates, or subnet math).

## Working discipline

- Networking behavior is locked in by tests: broken scenarios assert the **exact**
  `failureReason` (see
  [[Failure Reason Codes]]), never just
  "failed." Loosening a test to make code pass requires justifying it against the
  spec, not just doing it.
- Big changes: plan first, list files, work in phases with a checkpoint (tests +
  build) after each, keep every existing mission playable throughout.
- Finish with `npm test` + `npx vite build` clean, then `/accuracy-gate` if
  networking was touched, then `/brain-update` if project facts changed.
- **Never commit unless explicitly asked.** Uncommitted work across a session is
  normal and expected, not a sign something's unfinished.

## Recurring gotchas worth internalizing (full list: `.claude/brain/LESSONS.md`)

- `interfaceConfigured` silently checks the wrong port on a multi-port device if
  `ifaceName` is omitted — always pass it explicitly (see
  [[Mission DSL]]).
- `pingSucceeded` reads `topology.pingLog`, which only a real terminal `ping`
  populates — tests must call `topology.logPing(srcIp, dstIp)` explicitly.
- `checkPing` is bidirectional by design — a one-directional static route yields
  `no_return_path`, not success (see
  [[Routing and Static Routes]]).
- A firewall rule scoped to `tcp/443` does **not** let ICMP through — that's correct
  behavior, not a bug to fix (see [[Stateful Firewall]]).
- `clients`/`contracts` in `CareerContext` are plain objects keyed by id (not `Map`s)
  specifically so `setState` produces a new reference React will re-render on — keep
  them that way.
- xterm tabs must stay mounted when hidden (`display:none`), never unmounted — see
  [[UI Component Map]].
- `find`/`grep` run as shell functions wrapping the Claude binary in this
  environment and can misbehave with certain flags — prefer the dedicated Grep/Glob
  tools or `command find`/`command grep`.

## Related

[[Home]] · [[Vision and Product]] · [[Architecture Overview]]
