---
tags: [career, clients, contracts, reputation]
---

# Career Layer

The business/progression system sitting on top of the mission engine — owned by
`CareerContext` (`useCareer()`), mounted *inside* `GameProvider` (see
[[Architecture Overview]]). Plain-JS logic lives in
`src/engine/reputation.js` and `src/engine/contractClock.js`; static content in
`src/data/clients.js`, `src/data/contracts.js`, `src/data/serviceTickets.js`.

## Clients — persistent entities, not mission metadata

`CLIENT_TEMPLATES` (`src/data/clients.js`) is static data (like `deviceCatalog.js`);
`createClientInstance(templateId)` produces the mutable per-save record. Today there
is exactly one: `client_local_shop` — "Sam's Corner Store" — whose first mission,
`mission_local_shop_1`, is offered via `initialMissionIds`. A client instance tracks:

```js
{
  id, companyName, industry, avatar,
  reputationRelationship: 0,
  topologyId,                       // this client's persistent Topology, held in GameContext
  currentContractId: null,
  completedMissionIds: [],
  availableFutureMissionIds: [...], // unlocked via each mission's followUpMissionIds
  satisfaction: 100,
  revenueTotal: 0,
  growthStage: 0,
  dormant: false,                   // stops issuing new tickets — see SLA below
  consecutiveMissedTickets: 0,
}
```

Later missions unlock through each completed mission's own `followUpMissionIds`, not
through a separate unlock table.

## Contracts — recurring income, distinct from a one-time mission reward

`CONTRACT_TYPES['monthly-support']` (`src/data/contracts.js`) — $500/month,
established by a mission's `contractOutcome: { type: 'monthly-support' }` field (see
[[Mission Catalog]] — `mission_local_shop_1` is the current example). A contract
instance tracks its own SLA bookkeeping: `startedAtMs`, `lastTicketAt`,
`openTicketId`.

## Service tickets — small, real, wall-clock-timed background jobs

A **service ticket** is not a full `MissionDefinition` — it has no hardware to buy,
reuses the client's *existing* persistent devices, and completes through the exact
same objective DSL (see [[Mission DSL]]), just with a much smaller `objectives[]`.
See [[Mission Catalog]] §Service Tickets for the two that exist today.

### The SLA clock (`src/engine/contractClock.js`) — real wall-clock time

Deliberately `Date.now()`-based, not a turn/day counter, tuned for a single ~20–60
minute browser session (documented as "a first guess to retune via playtesting," not
a final answer):

| Constant | Value | Meaning |
|---|---|---|
| `SLA_DURATION_MS` | 8 min | time from issuance to deadline |
| `SLA_WARNING_RATIO` | 0.6 | urgency turns `'warning'` at 60% of the SLA window elapsed |
| `TICKET_GRACE_MS` | 6 min | extra time past the deadline before force-expiry |
| `DORMANCY_THRESHOLD` | 2 | consecutive expired tickets before a client goes dormant |

`ticketUrgency(ticket, now)` → `'safe'` / `'warning'` / `'overdue'` (past deadline,
still completable) / `'expired'` (past deadline **and** past the grace window —
force-closed as neglected).

**Pause-aware, not naive.** `effectiveElapsedMs = (now - issuedAt) - (pausedMs ?? 0)`
— `pausedMs` accumulates whenever a job-board mission is active, so a player working
a real mission can never lose a background ticket to the clock through no fault of
their own. **Any UI or logic touching ticket time must use this formula, never raw
`now - issuedAt`** — this exact formula is reused for the SLA Gantt-timeline widget
on the [[Admin Laptop and Tools|Admin Laptop dashboard]].

### Ticket pacing (`engine/ticketScheduler.js`, `alertSchedule.js`, `ticketEngine.js`)

The old fixed 5-minute timer is gone — it spammed tickets and emails, because its interval kept
calling the first render's stale state. `tickTickets(state, ctx)` is now a pure function; the driver
calls it through a ref to the latest state.

- First ticket 5–9 min after a contract starts; after each fix **or** expiry a gap of 10–20 min is
  rolled once and stored on the contract (`ticketGapStartedAt`, `ticketGapMs`).
- While a job-board mission is active the gap stretches ×2.5 (`BUSY_GAP_FACTOR`) and the SLA clock pauses.
- At most 2 open tickets; at least 4 min between any two new ones; never the same template twice in a row.
- **Alerts:** one at issue, reminders 5 → 10 → 20 min after the previous alert, then silence; none while
  busy, while the ticket is being worked (`status: 'active'`) or once expired.
- **Fixing one** pushes a "Service restored" toast and inbox message (fast / on time / late wording) with
  the reputation change and the money earned. The Career rail icon shows a badge for open tickets and
  pending job offers.

### The job board (`engine/jobBoard.js`)

Only *available* jobs are listed (prerequisite done / reputation met / not completed / not active). A job
that becomes available after the game started is offered: accept, decline for now (it stays listed, marked),
or view details. The first look at the board is silent, so a new player's starting jobs are not announced.

### Reputation and satisfaction deltas — distinct from mission rewards

`scoreAfterMission()` is a one-time milestone reward scaled by mission difficulty
(`difficulty * 20`, with an `outcome.qualityMultiplier` hook reserved for a future
performance-scoring system — currently always 1.0, full credit). Ticket outcomes are
a **separate**, smaller, more frequent reputation mechanic that never touches
`scoreAfterMission`/`tierForScore`/`canAccessClient`:

| Outcome | Reputation | Satisfaction |
|---|---|---|
| Fast (≥50% of SLA window still remaining) | +15 | +5 |
| On-time (<50% remaining but before deadline) | +5 | 0 |
| Late (past deadline, inside grace) | −5 | −10 |
| Expired (force-closed, never addressed) | −25 | −20 |

Reputation is clamped at 0 (`Math.max(0, ...)`) — it never goes negative.

### Reputation tiers — gate by number, never by label

```js
REPUTATION_TIERS = [
  { min: 0,    label: 'Junior Network Engineer' },
  { min: 100,  label: 'Freelance Network Engineer' },
  { min: 300,  label: 'Established Network Engineer' },
  { min: 700,  label: 'Senior Network Engineer' },
  { min: 1500, label: 'Enterprise Network Engineer' },
]
```

`tierForScore(score)` derives the label for display. **Missions gate on the raw
number (`requiredReputation`) — never on a tier label** — so tiers can be renamed or
rebalanced without touching a single mission definition. This is a locked decision;
see [[Decisions Log]].

## Related

[[Mission DSL]] · [[Mission Catalog]] ·
[[Admin Laptop and Tools]] (the dashboard surfaces all of
this state) · [[Architecture Overview]]
