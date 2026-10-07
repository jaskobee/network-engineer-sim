/**
 * When a service ticket may appear (engine/ticketScheduler.js) and how often an open one may nag
 * (engine/alertSchedule.js) — the owner's rules, as tests:
 *   T1 - the gap is random, rolled once, and never shorter than the minimum
 *   T2 - it is longer while the player is busy on another job
 *   T3 - global caps: minimum spacing between any two tickets, at most 2 open
 *   T4 - eligibility rules (active contract, dormant client, open ticket, schedule)
 *   A1 - reminders back off: 5 min → 10 min → 20 min, then stop
 *   A2 - no reminders while busy, while the player is on it, or once expired
 */
import { describe, it, expect } from 'vitest'
import {
  FIRST_TICKET_DELAY_MS, TICKET_GAP_MS, BUSY_GAP_FACTOR, GLOBAL_MIN_SPACING_MS, MAX_OPEN_TICKETS,
  rollBetween, scheduleGap, needsSchedule, ticketDueAt, shouldIssueTicket,
} from '../ticketScheduler.js'
import { REMINDER_GAPS_MS, alertsSent, nextReminderAt, shouldSendReminder } from '../alertSchedule.js'
import { SLA_DURATION_MS, TICKET_GRACE_MS } from '../contractClock.js'

const MIN = 60_000
const client = { dormant: false }
const contract = (over = {}) => ({ active: true, openTicketId: null, ticketGapStartedAt: 0, ticketGapMs: 10 * MIN, ...over })

describe('T1 — the gap is random, rolled once, and never too short', () => {
  it('rollBetween spans the whole range and honours the injected rng', () => {
    expect(rollBetween([10, 20], () => 0)).toBe(10)
    expect(rollBetween([10, 20], () => 1)).toBe(20)
    expect(rollBetween([10, 20], () => 0.5)).toBe(15)
  })

  it('every rolled gap is within range — first delay and post-fix gap', () => {
    for (const r of [0, 0.13, 0.5, 0.87, 0.9999]) {
      const first = scheduleGap(1000, { first: true, rng: () => r })
      const gap = scheduleGap(1000, { rng: () => r })
      expect(first.ticketGapMs).toBeGreaterThanOrEqual(FIRST_TICKET_DELAY_MS[0])
      expect(first.ticketGapMs).toBeLessThanOrEqual(FIRST_TICKET_DELAY_MS[1])
      expect(gap.ticketGapMs).toBeGreaterThanOrEqual(TICKET_GAP_MS[0])
      expect(gap.ticketGapMs).toBeLessThanOrEqual(TICKET_GAP_MS[1])
      expect(gap.ticketGapStartedAt).toBe(1000)
    }
  })

  it('after a fix the player is left alone for at least ten minutes', () => {
    expect(TICKET_GAP_MS[0]).toBeGreaterThanOrEqual(10 * MIN)
  })

  it('different rolls give different gaps (it is not a fixed beat)', () => {
    const gaps = new Set([0.1, 0.4, 0.7, 0.95].map(r => scheduleGap(0, { rng: () => r }).ticketGapMs))
    expect(gaps.size).toBe(4)
  })
})

describe('T2 — busy on another job means fewer tickets', () => {
  it('the busy due time is the idle gap stretched by the factor', () => {
    const c = contract({ ticketGapMs: 12 * MIN })
    expect(ticketDueAt(c, false)).toBe(12 * MIN)
    expect(ticketDueAt(c, true)).toBe(12 * MIN * BUSY_GAP_FACTOR)
    expect(BUSY_GAP_FACTOR).toBeGreaterThan(1)
  })

  it('a contract that is due when idle is NOT due while busy', () => {
    const c = contract({ ticketGapMs: 12 * MIN })
    expect(shouldIssueTicket(c, client, { now: 12 * MIN, busy: false })).toBe(true)
    expect(shouldIssueTicket(c, client, { now: 12 * MIN, busy: true })).toBe(false)
    expect(shouldIssueTicket(c, client, { now: 12 * MIN * BUSY_GAP_FACTOR, busy: true })).toBe(true)
  })
})

describe('T3 — never two problems back to back', () => {
  it('a minimum spacing applies across contracts', () => {
    const c = contract()
    expect(shouldIssueTicket(c, client, { now: 20 * MIN, lastIssuedAt: 20 * MIN - (GLOBAL_MIN_SPACING_MS - 1) })).toBe(false)
    expect(shouldIssueTicket(c, client, { now: 20 * MIN, lastIssuedAt: 20 * MIN - GLOBAL_MIN_SPACING_MS })).toBe(true)
  })

  it('at most MAX_OPEN_TICKETS can be open at once', () => {
    const c = contract()
    expect(shouldIssueTicket(c, client, { now: 30 * MIN, openCount: MAX_OPEN_TICKETS - 1 })).toBe(true)
    expect(shouldIssueTicket(c, client, { now: 30 * MIN, openCount: MAX_OPEN_TICKETS })).toBe(false)
  })
})

describe('T4 — eligibility', () => {
  const ready = { now: 60 * MIN }
  it('needs an active contract, a live client, no open ticket and a schedule', () => {
    expect(shouldIssueTicket(contract(), client, ready)).toBe(true)
    expect(shouldIssueTicket(contract({ active: false }), client, ready)).toBe(false)
    expect(shouldIssueTicket(contract(), { dormant: true }, ready)).toBe(false)
    expect(shouldIssueTicket(contract({ openTicketId: 't1' }), client, ready)).toBe(false)
    expect(shouldIssueTicket({ active: true, openTicketId: null }, client, ready)).toBe(false)
  })
  it('needsSchedule spots contracts from before the scheduler', () => {
    expect(needsSchedule({ active: true })).toBe(true)
    expect(needsSchedule(contract())).toBe(false)
  })
  it('is not due one millisecond early', () => {
    expect(shouldIssueTicket(contract(), client, { now: 10 * MIN - 1 })).toBe(false)
  })
})

// ── alerts ────────────────────────────────────────────────────────────────────

const ticket = (over = {}) => ({ issuedAt: 0, pausedMs: 0, status: 'open', alertsSent: 1, lastAlertAt: 0, ...over })

describe('A1 — reminders back off, then stop', () => {
  it('the ladder is 5, 10, 20 minutes', () => {
    expect(REMINDER_GAPS_MS).toEqual([5 * MIN, 10 * MIN, 20 * MIN])
  })

  it('the first reminder is 5 minutes after the alert, the second 10 minutes after THAT', () => {
    const t = ticket()
    expect(nextReminderAt(t)).toBe(5 * MIN)
    const afterFirst = ticket({ alertsSent: 2, lastAlertAt: 5 * MIN })
    expect(nextReminderAt(afterFirst)).toBe(15 * MIN)
    const afterSecond = ticket({ alertsSent: 3, lastAlertAt: 15 * MIN })
    expect(nextReminderAt(afterSecond)).toBe(35 * MIN)
  })

  it('after the last rung there are no more reminders', () => {
    expect(nextReminderAt(ticket({ alertsSent: 4, lastAlertAt: 0 }))).toBeNull()
    expect(shouldSendReminder(ticket({ alertsSent: 4 }), 10_000 * MIN)).toBe(false)
  })

  it('is not sent early, and is sent once due', () => {
    expect(shouldSendReminder(ticket(), 5 * MIN - 1)).toBe(false)
    expect(shouldSendReminder(ticket(), 5 * MIN)).toBe(true)
  })

  it('an older saved ticket that only recorded the "warning" stage counts it as an alert', () => {
    expect(alertsSent({ notifiedStages: ['warning'] })).toBe(2)
    expect(alertsSent({ notifiedStages: [] })).toBe(1)
    expect(alertsSent({ alertsSent: 3 })).toBe(3)
  })
})

describe('A2 — no reminders while they would only distract', () => {
  it('none while the player is busy on another job', () => {
    expect(shouldSendReminder(ticket(), 6 * MIN, { busy: true })).toBe(false)
    expect(shouldSendReminder(ticket(), 6 * MIN, { busy: false })).toBe(true)
  })
  it('none once the player has picked the ticket up', () => {
    expect(shouldSendReminder(ticket({ status: 'active' }), 6 * MIN)).toBe(false)
  })
  it('none after the grace window — expiry has its own notice', () => {
    const late = SLA_DURATION_MS + TICKET_GRACE_MS + 1
    expect(shouldSendReminder(ticket({ lastAlertAt: 0 }), late)).toBe(false)
  })
})
