---
tags: [vision, product]
---

# Vision and Product

## What NetSim is

NetSim is a **browser-based networking-education game**: Cisco Packet Tracer meets a
tower-defense shop loop. The player is a network engineer who takes client jobs, buys
real hardware, configures devices through **real CLI commands**, and gets paid when
the network actually works. It runs entirely in the browser — no install, no plugin,
no game engine.

> "your laptop as a network engineer is everything" — the player's own framing of the
> [[Admin Laptop and Tools|Admin Laptop]], which sums up the whole design philosophy:
> everything should feel like the real job, not like a quiz wrapped in a game skin.

## The mission

Teach networking fundamentals **correctly** — to CCNA / CCNP / CompTIA Network+
standard. Accuracy is the product, not a nice-to-have. See
[[Layer 2 Switching and VLANs]] through [[Stateful Firewall]] for the actual model,
and `docs/NETWORKING_ACCURACY.md` in the repo for the standing spec.

## Why this framing works

Ordinary networking tutorials are either too abstract (diagrams, no hands) or too raw
(a real CLI with no feedback loop, no stakes, no story). NetSim's bet is that the
tower-defense/shop loop — buy gear, deploy it, get paid, come back tomorrow to a
client who still exists — supplies the motivation a bare simulator lacks, *without*
faking the substance underneath it. Every dopamine hit (a green ping, a paid invoice,
a reputation tier-up) sits directly on top of a real, correctly-modeled network state.
Nothing is decorative.

## The hard rule that outranks all others

**If a simplification would teach a beginner something they'd have to unlearn for a
cert exam or a real job, it does not ship.** Where a simplification is genuinely
unavoidable for gameplay (see the many "documented simplifications" scattered through
[[NAT and PAT]], [[DHCP]], [[Stateful Firewall]]), it is labeled as such — in-game or
in a code comment — never presented as ground truth.

This is enforced structurally, not just by good intentions:
- `docs/NETWORKING_ACCURACY.md` is a hard spec with 8 standing "accuracy prompts."
- Every behavior change to networking logic ships with a Vitest test asserting the
  *exact* `failureReason` (see [[Failure Reason Codes]]), never just `reachable: false`.
- A dedicated `accuracy-reviewer` subagent and an `/accuracy-gate` skill exist purely
  to catch drift before it ships. See [[Working with Claude Code]].
- CI runs an AI accuracy review (`ai-review.js`) against the same spec on every PR.

## Who the player is

A network engineer building a client base from nothing: a home LAN for a neighbor, a
café, a medical clinic, a startup HQ, and eventually a fully segmented, firewalled
office. Reputation and money gate access to bigger clients and better/cheaper gear.
See [[Career Layer]] and [[Mission Catalog]].

## The "always want to open it" product goal

The most recent major feature (the Admin Laptop dashboard rework) crystallizes the
product ambition directly: the player's laptop should be a place they *want* to check
constantly — missions, stats, client happiness, incidents — the way a real engineer's
laptop is their entire world. Every number shown must be real, derived from live game
state; nothing is invented or decorative. See [[Admin Laptop and Tools]].

## Design principles that follow from the mission

1. **A fault is real misconfigured state, not a branch in ping logic.** Symptoms must
   emerge from the same accurate engine a working network runs on — never a
   special-cased "this scenario should look broken" shortcut. See
   [[Ping Reachability Engine (checkPing)]] and
   [[Fault Injection System (Act 2)]].
2. **Each OS keeps its own idioms.** IOS on router/switch/firewall, Linux iproute2 on
   PC/server, Windows CMD on the admin laptop — no leakage between them. See
   [[The Three CLI Engines]].
3. **No synthesized packets, ever.** If the engine cannot truthfully emit a frame, a
   future packet-capture tool must not display one. See
   [[Admin Laptop and Tools]] §WireFish.
4. **The engine is the asset; the UI is disposable.** `src/models/` and `src/engine/`
   are a pure, headless, framework-free core — the entire product could be rebuilt
   with a different UI without touching the networking logic. See
   [[Architecture Overview]].
5. **Dev mode drives the real engine — it never bypasses it.** Every QA preset is
   built by actually calling CLI commands against real devices, so a "solved" preset
   is only solved because the engine says so. See [[Dev Mode and QA]].
