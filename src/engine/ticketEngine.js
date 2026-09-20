/**
 * One pass of the service-ticket clock — pure, no React, no I/O.
 *
 * CareerContext used to do this inline, from a `setInterval` that captured the FIRST render's
 * `contracts` / `activeTickets`. That copy never saw the ticket it had just issued, so once the
 * gap elapsed it raised a new ticket (and an email) on every 15 s tick. State is now passed in
 * explicitly on every call, so a stale closure cannot happen, and the whole policy can be run
 * for simulated hours in a test.
 *
 * state: { reputation, clients, contracts, tickets }    ctx: { now, prevTickAt, busy, rng }
 * returns the new state plus { notifications (oldest first), issued, changed }.
 *
 * What a pass does, per contract:
 *  - gives it a schedule if it has none (new contract / older save);
 *  - open ticket, player busy on another job → the SLA clock is paused for the real time since the
 *    last pass (no fixed step, so a throttled background tab can't leak time), and nothing nags;
 *  - open ticket past its grace window → force-close it (penalties, maybe dormancy) and start the
 *    next randomized wait;
 *  - open ticket otherwise → send a reminder if the back-off ladder says one is due;
 *  - no open ticket → issue one if engine/ticketScheduler.js allows.
 */
import { scoreAfterExpiredTicket, satisfactionDelta } from './reputation.js'
import { isTicketExpired, ticketUrgency, SLA_DURATION_MS, DORMANCY_THRESHOLD } from './contractClock.js'
import { needsSchedule, scheduleGap, shouldIssueTicket } from './ticketScheduler.js'
import { shouldSendReminder, alertsSent } from './alertSchedule.js'
import { pickTicketTemplate, createTicketInstance } from '../data/serviceTickets.js'
import {
  ticketIssuedNotification, ticketReminderNotification, slaExpiredNotification, clientDormantNotification,
} from '../data/notifications.js'

// A background tab may only run its timer about once a minute; never credit more than this per pass.
const MAX_PAUSE_STEP_MS = 2 * 60 * 1000

export function tickTickets(state, { now, prevTickAt = null, busy = false, rng = Math.random }) {
  const clients   = { ...state.clients }
  const contracts = { ...state.contracts }
  const tickets   = { ...state.tickets }
  let reputation  = state.reputation
  const notifications = []
  const issued = []
  const changed = { reputation: false, clients: false, contracts: false, tickets: false }

  let lastIssuedAt = null
  for (const c of Object.values(contracts)) {
    if (c.lastTicketIssuedAt != null && (lastIssuedAt == null || c.lastTicketIssuedAt > lastIssuedAt)) lastIssuedAt = c.lastTicketIssuedAt
  }

  for (const original of Object.values(state.contracts)) {
    let contract = contracts[original.id]
    const client = clients[contract.clientId]
    if (!client) continue

    const open = contract.openTicketId ? tickets[contract.openTicketId] : null

    // 1. A schedule for contracts that have none (a new contract, or a save from before this
    //    existed): the wait starts NOW, so nobody is hit with a ticket the moment a save loads.
    if (!open && needsSchedule(contract)) {
      contract = { ...contract, ...scheduleGap(now, { first: contract.lastTicketAt == null, rng }) }
      contracts[contract.id] = contract
      changed.contracts = true
    }

    if (open) {
      // 2. Busy on another job: pause the SLA clock for the real time that passed; no nagging.
      if (busy) {
        const step = prevTickAt == null ? 0 : Math.min(Math.max(0, now - prevTickAt), MAX_PAUSE_STEP_MS)
        if (step > 0) {
          tickets[open.id] = { ...open, pausedMs: (open.pausedMs ?? 0) + step }
          changed.tickets = true
        }
        continue
      }

      // 3. Never addressed: force-close, penalise, start the next wait.
      if (isTicketExpired(open, now)) {
        reputation = scoreAfterExpiredTicket(reputation).newScore
        changed.reputation = true
        const missed = (client.consecutiveMissedTickets ?? 0) + 1
        const goingDormant = missed >= DORMANCY_THRESHOLD
        clients[contract.clientId] = {
          ...client,
          satisfaction: Math.max(0, client.satisfaction + satisfactionDelta('expired')),
          consecutiveMissedTickets: missed,
          dormant: goingDormant,
        }
        changed.clients = true
        contracts[contract.id] = {
          ...contract, openTicketId: null, lastTicketAt: now, lastTemplateId: open.templateId,
          ...scheduleGap(now, { rng }),
        }
        changed.contracts = true
        delete tickets[open.id]
        changed.tickets = true
        notifications.push(slaExpiredNotification(client, open, now))
        if (goingDormant) notifications.push(clientDormantNotification(client, now))
        continue
      }

      // 4. Still open: a back-off reminder if one is due.
      if (shouldSendReminder(open, now, { busy })) {
        const number = alertsSent(open)          // 1st reminder when only the issue alert has gone out
        tickets[open.id] = { ...open, alertsSent: number + 1, lastAlertAt: now }
        changed.tickets = true
        notifications.push(ticketReminderNotification(client, open, now, { urgency: ticketUrgency(open, now), number }))
      }
      continue
    }

    // 5. No open ticket: issue one if the schedule and the global caps allow it.
    const openCount = Object.keys(tickets).length
    if (shouldIssueTicket(contract, client, { now, busy, openCount, lastIssuedAt })) {
      const template = pickTicketTemplate(contract.clientId, { lastTemplateId: contract.lastTemplateId, rng })
      if (!template) continue
      const ticket = createTicketInstance(contract.clientId, contract.id, template, now, SLA_DURATION_MS)
      tickets[ticket.id] = ticket
      contracts[contract.id] = {
        ...contract, openTicketId: ticket.id, lastTicketAt: now, lastTicketIssuedAt: now, lastTemplateId: template.id,
      }
      lastIssuedAt = now
      changed.tickets = changed.contracts = true
      notifications.push(ticketIssuedNotification(client, ticket, now))
      issued.push(ticket)
    }
  }

  return { reputation, clients, contracts, tickets, notifications, issued, changed }
}

/** The contract fields to set when a ticket is FIXED: the next wait starts now, and this template is remembered. */
export function afterTicketFixed(contract, ticket, completedAtMs, rng = Math.random) {
  return {
    ...contract, openTicketId: null, lastTicketAt: completedAtMs, lastTemplateId: ticket.templateId,
    ...scheduleGap(completedAtMs, { rng }),
  }
}
