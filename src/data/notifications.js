/**
 * Notification/email factories — plain data, no state. Rendered in the Admin
 * Laptop's INBOX tab (see AdminLaptop.jsx) and stored in CareerContext's
 * `notifications` array. Every factory returns the same shape:
 *   { id, clientId, kind, subject, body, createdAt, read: false }
 */

import { clientContactName } from './clients.js'

let _idCounter = 0
function makeId() { return `note-${++_idCounter}` }
export function setNotificationIdCounter(n) { if (n > _idCounter) _idCounter = n }   // never move backwards

function base(clientId, kind, subject, body, createdAt) {
  return { id: makeId(), clientId, kind, subject, body, createdAt, read: false }
}

export function ticketIssuedNotification(client, ticket, now) {
  return base(client.id, 'ticket-issued',
    `${client.companyName}: ${ticket.title}`,
    `${client.companyName} has a new request: "${ticket.title}". ${ticket.description ?? ''}`.trim(),
    now)
}

/**
 * A reminder for a ticket that is still open. `number` is which reminder this is (1, 2, 3) and
 * `urgency` the ticket's SLA stage — a late ticket says so instead of repeating the first nudge.
 */
export function ticketReminderNotification(client, ticket, now, { urgency = 'safe', number = 1 } = {}) {
  const who = clientContactName(client)
  const late = urgency === 'overdue'
  return base(client.id, 'ticket-reminder',
    late ? `Overdue: ${ticket.title}` : `Reminder: ${ticket.title}`,
    late
      ? `"${ticket.title}" is past the agreed response time and ${who} is still waiting. Fixing it now limits the damage to your reputation.`
      : `${who} is still waiting on "${ticket.title}" (reminder ${number}). The sooner it's fixed, the happier they'll be.`,
    now)
}

export function slaWarningNotification(client, ticket, now) {
  return base(client.id, 'sla-warning',
    `${client.companyName} is waiting on you`,
    `"${ticket.title}" is still open and time is running short. Get to it soon to keep ${client.companyName} happy.`,
    now)
}

export function slaExpiredNotification(client, ticket, now) {
  return base(client.id, 'sla-expired',
    `${client.companyName}: request went unanswered`,
    `"${ticket.title}" was never addressed in time. ${client.companyName}'s satisfaction has taken a hit.`,
    now)
}

/**
 * What the player is told when they fix a ticket — shown as a toast and kept in the inbox.
 * e.g. "Cable is connected again and service is restored. Sam is happy with your service.
 * You gained 5 reputation and earned $60."
 */
export function ticketResolutionMessage(client, ticket, kind, gained = 0, reward = 0) {
  const who = clientContactName(client)
  const fixed = ticket.resolution ?? 'The problem is fixed and service is restored.'
  const mood = kind === 'fast'
    ? `${who} is delighted with how quickly you responded.`
    : kind === 'late'
      ? `It took longer than agreed, so ${who} isn't thrilled.`
      : `${who} is happy with your service.`
  const rep = gained >= 0 ? `You gained ${gained} reputation` : `You lost ${-gained} reputation`
  const pay = reward > 0 ? (gained >= 0 ? ` and earned $${reward}` : `, but earned $${reward}`) : ''
  return { title: 'Service restored', body: `${fixed} ${mood} ${rep}${pay}.` }
}

export function ticketCompletedNotification(client, ticket, kind, now, { gained = 0, reward = 0 } = {}) {
  const { body } = ticketResolutionMessage(client, ticket, kind, gained, reward)
  return base(client.id, 'ticket-completed', `${client.companyName}: service restored`, `"${ticket.title}" — ${body}`, now)
}

/** A job the player can take on has become available. */
export function newJobNotification(mission, now) {
  return base(mission.clientId ?? null, 'new-job',
    `New job: ${mission.title}`,
    `${mission.client ?? 'A client'} has a job for you — "${mission.title}". Open Career to review it, then accept or decline for now.`,
    now)
}

export function clientDormantNotification(client, now) {
  return base(client.id, 'client-dormant',
    `${client.companyName} has gone quiet`,
    `After repeated unanswered requests, ${client.companyName} has stopped reaching out. Their contract is paused — rebuilding the relationship may bring them back.`,
    now)
}
