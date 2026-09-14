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
| `NEW_TICKET_INTERVAL_MS` | 5 min | gap after a ticket resolves before the next can fire |
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

A contract is due a new ticket (`shouldIssueNewTicket`) when: it's active, its client
isn't dormant, it has no currently-open ticket, and enough real time has passed since
the last one resolved (or since the contract started, if none has fired yet). Driven
by `ContractClockDriver.jsx` on a tick.

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
