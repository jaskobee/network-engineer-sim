/**
 * When a contract's next service ticket ("troubleshoot") may appear — pure functions, no
 * React, no I/O. Randomness is injected (`rng`) so tests are deterministic.
 *
 * The rules, and why:
 *  - The gap is ROLLED once, when the previous ticket is resolved (fixed or expired), and stored on
 *    the contract — so it survives a reload and is not re-rolled on every 15 s check.
 *  - It is random within a range, not a fixed interval, so problems don't arrive on a beat.
 *  - It is long enough (10–20 min) that a player who has just fixed something is left alone to do
 *    other work; the first ticket after a contract starts comes a little sooner (5–9 min).
 *  - While the player is busy on another job the gap is stretched (×2.5): a job in progress is a
 *    reason to trouble them LESS, not the same amount.
 *  - Two problems are never opened back to back, even across different clients: a minimum spacing
 *    between any two new tickets, and a cap on how many can be open at once.
 *
 * Tuned for a 20–60 minute session; retune with the dev "fast-forward contracts" tool.
 */

const MIN = 60 * 1000

export const FIRST_TICKET_DELAY_MS = [5 * MIN, 9 * MIN]    // after a contract starts
export const TICKET_GAP_MS         = [10 * MIN, 20 * MIN]  // after a ticket is fixed or expires
export const BUSY_GAP_FACTOR       = 2.5                    // gap multiplier while another job is in progress
export const GLOBAL_MIN_SPACING_MS = 4 * MIN                // between any two new tickets, across clients
export const MAX_OPEN_TICKETS      = 2

/** A whole-millisecond value between min and max (inclusive-ish) drawn from `rng`. */
export function rollBetween([min, max], rng = Math.random) {
  return Math.round(min + rng() * (max - min))
}

/**
 * The gap fields to store on a contract when a wait starts at `now`:
 * { ticketGapStartedAt, ticketGapMs }. `first` uses the shorter opening delay.
 */
export function scheduleGap(now, { first = false, rng = Math.random } = {}) {
  return { ticketGapStartedAt: now, ticketGapMs: rollBetween(first ? FIRST_TICKET_DELAY_MS : TICKET_GAP_MS, rng) }
}

/** Contracts from before this scheduler (or brand new ones) have no gap yet. */
export function needsSchedule(contract) {
  return contract.ticketGapMs == null || contract.ticketGapStartedAt == null
}

/** When the next ticket becomes due — later while the player is busy. */
export function ticketDueAt(contract, busy) {
  return contract.ticketGapStartedAt + contract.ticketGapMs * (busy ? BUSY_GAP_FACTOR : 1)
}

/**
 * A contract may issue a ticket when it is active, its client isn't dormant, it has no open
 * ticket, it has a schedule, the global caps allow it, and its (busy-adjusted) due time has come.
 * ctx: { now, busy, openCount, lastIssuedAt }
 */
export function shouldIssueTicket(contract, client, { now, busy = false, openCount = 0, lastIssuedAt = null }) {
  if (!contract?.active || client?.dormant) return false
  if (contract.openTicketId) return false
  if (needsSchedule(contract)) return false
  if (openCount >= MAX_OPEN_TICKETS) return false
  if (lastIssuedAt != null && now - lastIssuedAt < GLOBAL_MIN_SPACING_MS) return false
  return now >= ticketDueAt(contract, busy)
}
