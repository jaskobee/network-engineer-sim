/**
 * Reputation — pure functions, no React, no I/O.
 *
 * Missions gate access by a plain numeric `requiredReputation` — never by tier
 * name — so tiers can be added/renamed/rebalanced without touching mission data.
 */

export const REPUTATION_TIERS = [
  { min: 0,    label: 'Junior Network Engineer' },
  { min: 100,  label: 'Freelance Network Engineer' },
  { min: 300,  label: 'Established Network Engineer' },
  { min: 700,  label: 'Senior Network Engineer' },
  { min: 1500, label: 'Enterprise Network Engineer' },
]

export function tierForScore(score) {
  let current = REPUTATION_TIERS[0]
  for (const tier of REPUTATION_TIERS) {
    if (score >= tier.min) current = tier
  }
  return current
}

/**
 * Reputation gained for completing a mission. Base gain scales with the
 * mission's difficulty (1-4 stars). `outcome.qualityMultiplier` is a hook for a
 * future performance-based scoring system (e.g. shotgun fixes, unnecessary
 * reconfiguration) — defaults to 1 (full credit) since that scoring doesn't
 * exist yet.
 */
export function scoreAfterMission(currentScore, mission, outcome = {}) {
  const base = (mission.difficulty ?? 1) * 20
  const multiplier = outcome.qualityMultiplier ?? 1
  const gained = Math.round(base * multiplier)
  return { newScore: currentScore + gained, gained }
}

export function canAccessClient(reputationScore, requiredReputation = 0) {
  return reputationScore >= requiredReputation
}

// ── Contract-ticket reputation/satisfaction (background SLA work) ───────────
//
// Distinct from scoreAfterMission (a one-time milestone reward): these are
// small, frequent deltas for routine contract maintenance, scaled by how
// promptly the player responded relative to the ticket's SLA — never touches
// scoreAfterMission/tierForScore/canAccessClient above.

const TICKET_REP_FAST    = 15  // completed with >=50% of the SLA window still remaining
const TICKET_REP_ONTIME  = 5   // completed before the deadline, but with <50% remaining
const TICKET_REP_LATE    = -5  // completed after the deadline, inside the grace window
const TICKET_REP_EXPIRED = -25 // never addressed — force-closed after the grace window

const SATISFACTION_FAST    = 5
const SATISFACTION_ONTIME  = 0
const SATISFACTION_LATE    = -10
const SATISFACTION_EXPIRED = -20

function ticketOutcomeKind(ticket, completedAtMs) {
  const elapsed = completedAtMs - ticket.issuedAt - (ticket.pausedMs ?? 0)
  const slaWindow = ticket.deadlineAt - ticket.issuedAt
  if (elapsed > slaWindow) return 'late'
  if (elapsed <= slaWindow * 0.5) return 'fast'
  return 'ontime'
}

/**
 * Reputation delta for completing a contract ticket. `completedAtMs` is the
 * timestamp the player actually finished it (not `now` at call time, so a
 * caller evaluating this slightly after the fact still scores the real moment
 * of completion).
 */
export function scoreAfterTicket(currentScore, ticket, completedAtMs) {
  const kind = ticketOutcomeKind(ticket, completedAtMs)
  const gained = kind === 'fast' ? TICKET_REP_FAST : kind === 'late' ? TICKET_REP_LATE : TICKET_REP_ONTIME
  return { newScore: Math.max(0, currentScore + gained), gained, kind }
}

/** Fixed penalty applied automatically when a ticket is force-closed unaddressed. */
export function scoreAfterExpiredTicket(currentScore) {
  return { newScore: Math.max(0, currentScore + TICKET_REP_EXPIRED), gained: TICKET_REP_EXPIRED }
}

/** Client-satisfaction delta for the same four outcomes (fast/ontime/late/expired). */
export function satisfactionDelta(kind) {
  switch (kind) {
    case 'fast':    return SATISFACTION_FAST
    case 'ontime':  return SATISFACTION_ONTIME
    case 'late':    return SATISFACTION_LATE
    case 'expired': return SATISFACTION_EXPIRED
    default:        return 0
  }
}
