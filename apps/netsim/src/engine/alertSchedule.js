/**
 * How often an OPEN ticket may nag the inbox — pure functions, no React, no I/O.
 *
 * One alert when the ticket is raised, then reminders that back off:
 *   alert → wait 5 min → reminder → wait 10 min → reminder → wait 20 min → reminder → stop.
 * The wait is measured from the previous alert, so one problem can never flood the mailbox.
 * Reminders are also held back while the player is busy on another job (the SLA clock is paused
 * then, and a nag would only distract) and while they have already picked the ticket up.
 * The ticket expiring and a client going quiet are separate one-off events, not reminders.
 */
import { ticketUrgency } from './contractClock.js'

const MIN = 60 * 1000

/** Waits between one alert and the next; after the last, no more reminders. */
export const REMINDER_GAPS_MS = [5 * MIN, 10 * MIN, 20 * MIN]

/**
 * How many alerts this ticket has sent so far. The alert raised with the ticket is #1. A ticket
 * saved by an older version may only have the old "warning" stage recorded.
 */
export function alertsSent(ticket) {
  return ticket.alertsSent ?? (1 + (ticket.notifiedStages?.includes('warning') ? 1 : 0))
}

/** When the next reminder is due, or null once the ladder is used up. */
export function nextReminderAt(ticket) {
  const gap = REMINDER_GAPS_MS[alertsSent(ticket) - 1]
  if (gap == null) return null
  return (ticket.lastAlertAt ?? ticket.issuedAt) + gap
}

export function shouldSendReminder(ticket, now, { busy = false } = {}) {
  if (busy) return false
  if (ticket.status === 'active') return false                 // the player is already on it
  if (ticketUrgency(ticket, now) === 'expired') return false   // expiry has its own notice
  const due = nextReminderAt(ticket)
  return due != null && now >= due
}
