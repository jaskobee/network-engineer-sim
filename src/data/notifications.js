/**
 * Notification/email factories — plain data, no state. Rendered in the Admin
 * Laptop's INBOX tab (see AdminLaptop.jsx) and stored in CareerContext's
 * `notifications` array. Every factory returns the same shape:
 *   { id, clientId, kind, subject, body, createdAt, read: false }
 */

let _idCounter = 0
function makeId() { return `note-${++_idCounter}` }
export function setNotificationIdCounter(n) { _idCounter = n }

function base(clientId, kind, subject, body, createdAt) {
  return { id: makeId(), clientId, kind, subject, body, createdAt, read: false }
}

export function ticketIssuedNotification(client, ticket, now) {
  return base(client.id, 'ticket-issued',
    `${client.companyName}: ${ticket.title}`,
    `${client.companyName} has a new request: "${ticket.title}". ${ticket.description ?? ''}`.trim(),
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

export function ticketCompletedNotification(client, ticket, kind, now) {
  const line = kind === 'fast'
    ? 'Fast work — they really appreciate the quick turnaround!'
    : kind === 'late'
      ? 'It took a while, but they\'re glad it\'s sorted.'
      : 'Thanks for taking care of it.'
  return base(client.id, 'ticket-completed',
    `${client.companyName}: thank you`,
    `"${ticket.title}" is resolved. ${line}`,
    now)
}

export function clientDormantNotification(client, now) {
  return base(client.id, 'client-dormant',
    `${client.companyName} has gone quiet`,
    `After repeated unanswered requests, ${client.companyName} has stopped reaching out. Their contract is paused — rebuilding the relationship may bring them back.`,
    now)
}
