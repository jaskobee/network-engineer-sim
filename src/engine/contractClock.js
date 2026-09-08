/**
 * Contract SLA clock — pure functions, no React, no I/O. Time is real wall-clock
 * (Date.now()-based), not a turn/day counter, so a ticket's deadline survives
 * the browser tab being closed and reopened — it's just timestamp math.
 *
 * Tuned for a single browser session (~20-60 min), not literal real-world days.
 * Treat these as a first guess to be retuned via the dev "fast-forward
 * contracts" tool during playtesting, not a final answer.
 */

export const NEW_TICKET_INTERVAL_MS = 5 * 60 * 1000   // gap after a ticket resolves before the next one can fire
export const SLA_DURATION_MS        = 8 * 60 * 1000   // time from issuance to deadline
export const SLA_WARNING_RATIO      = 0.6              // urgency turns 'warning' once this fraction of SLA_DURATION_MS has elapsed
export const TICKET_GRACE_MS        = 6 * 60 * 1000   // extra time past the deadline before a ticket is force-expired
export const DORMANCY_THRESHOLD     = 2                // consecutive expired tickets before a client goes dormant

/**
 * Effective elapsed time on a ticket's SLA clock — excludes any time the clock
 * was paused (see `ticket.pausedMs`, accumulated by CareerContext.tickContracts
 * whenever a job-board mission is active, so a ticket can never expire through
 * no fault of the player).
 */
function effectiveElapsedMs(ticket, now) {
  return Math.max(0, (now - ticket.issuedAt) - (ticket.pausedMs ?? 0))
}

export function msRemaining(ticket, now) {
  return SLA_DURATION_MS - effectiveElapsedMs(ticket, now)
}

/**
 * 'safe'    — plenty of time left
 * 'warning' — past SLA_WARNING_RATIO of the SLA window
 * 'overdue' — past the deadline, still inside the grace window (completable, but late)
 * 'expired' — past the deadline AND past the grace window — force-closed as neglected
 */
export function ticketUrgency(ticket, now) {
  const elapsed = effectiveElapsedMs(ticket, now)
  if (elapsed > SLA_DURATION_MS + TICKET_GRACE_MS) return 'expired'
  if (elapsed > SLA_DURATION_MS) return 'overdue'
  if (elapsed >= SLA_DURATION_MS * SLA_WARNING_RATIO) return 'warning'
  return 'safe'
}

export function isTicketExpired(ticket, now) {
  return ticketUrgency(ticket, now) === 'expired'
}

/**
 * A contract is due a new ticket when: it has no open ticket, its client isn't
 * dormant, and enough real time has passed since the last one resolved (or
 * since the contract started, if none has fired yet).
 */
export function shouldIssueNewTicket(contract, client, now) {
  if (!contract?.active || client?.dormant) return false
  if (contract.openTicketId) return false
  const since = contract.lastTicketAt ?? contract.startedAtMs ?? 0
  return (now - since) >= NEW_TICKET_INTERVAL_MS
}

// ── Future extension point (explicitly out of scope for this phase) ─────────
// A later "hire staff" system could call the same acceptTicket()/completeTicket()
// actions a human player uses, on the player's behalf, before a ticket's SLA
// expires — nothing about this module needs to change to support that later.
