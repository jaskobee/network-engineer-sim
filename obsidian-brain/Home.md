---
tags: [moc, netsim]
---

# NetSim Brain

This vault is a knowledge base for **NetSim** — a browser-based networking-education
game — written for any future agent (AI or human) who needs to understand the project
before changing it. It captures the *why* and the *whole picture*: product vision,
the full networking model, the engine architecture, every mission and client, and the
working discipline this codebase has been built under.

> **This vault is prose, not enforcement.** The actual hard rules live in the repo at
> `CLAUDE.md`, `.claude/brain/`, `.claude/rules/*.md`, and `docs/NETWORKING_ACCURACY.md`
> — those are read by Claude Code every session and are the ground truth. This vault
> explains and cross-references that material for deeper onboarding; if the two ever
> disagree, **the repo wins** and this vault is stale and should be corrected.
>
> Written: 2026-09-14, from a full read of the codebase as of commit `9e7bf1e`.
> Numbers (test counts, preset counts, mission counts) drift — treat them as
> approximate and re-check the source before relying on them.

## Start here

- [[Vision and Product]] — what NetSim is, who it's for, and the one rule that
  outranks everything else
- [[Architecture Overview]] — how the codebase is shaped and why

## The networking model (the actual subject matter)

The heart of the project. Each note states the real-world CCNA/Network+-accurate
behavior *and* exactly where it lives in code.

- [[Layer 2 Switching and VLANs]]
- [[Routing and Static Routes]]
- [[Router-on-a-Stick (Inter-VLAN Routing)]]
- [[IP Addressing and Subnetting]]
- [[Interface States and Cabling]]
- [[DHCP]]
- [[NAT and PAT]]
- [[Stateful Firewall]]
- [[Ping Reachability Engine (checkPing)]]
- [[Failure Reason Codes]]

## Engine and data model

- [[Device and Topology Model]]
- [[The Three CLI Engines]]

## Missions, clients, and the career layer

- [[Mission DSL]]
- [[Mission Catalog]]
- [[Career Layer]]

## Product surfaces

- [[Admin Laptop and Tools]]
- [[Dev Mode and QA]]
- [[UI Component Map]]

## Roadmap and history

- [[Fault Injection System (Act 2)]]
- [[Status and Roadmap]]
- [[Decisions Log]]

## Working on this project

- [[Working with Claude Code]] — skills, subagents, hard rules, working discipline
- [[Glossary]] — every code, id format, and DSL term in one place

## The one thing to internalize before touching anything

**Accuracy outranks convenience.** NetSim's entire value proposition is that it
teaches networking *correctly* — to CCNA/CCNP/Network+ standard. Every shortcut you're
tempted to take (a ping that succeeds along a path real hardware would drop, a
simplification a beginner would have to unlearn later) is a bug, not a feature. See
[[Vision and Product]] and `docs/NETWORKING_ACCURACY.md` in the repo.
