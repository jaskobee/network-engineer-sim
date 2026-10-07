import { describe, it, expect } from 'vitest'
import {
  SLA_DURATION_MS, TICKET_GRACE_MS,
  msRemaining, ticketUrgency, isTicketExpired,
} from '../contractClock.js'

function makeTicket(overrides = {}) {
  return { issuedAt: 0, pausedMs: 0, ...overrides }
}

describe('contractClock', () => {
  it('msRemaining counts down from the SLA window and accounts for pausedMs', () => {
    const t = makeTicket()
    expect(msRemaining(t, 0)).toBe(SLA_DURATION_MS)
    expect(msRemaining(t, 60_000)).toBe(SLA_DURATION_MS - 60_000)
    const paused = makeTicket({ pausedMs: 60_000 })
    expect(msRemaining(paused, 60_000)).toBe(SLA_DURATION_MS) // the elapsed 60s was all paused
  })

  it('ticketUrgency transitions safe -> warning -> overdue -> expired', () => {
    const t = makeTicket()
    expect(ticketUrgency(t, 0)).toBe('safe')
    expect(ticketUrgency(t, SLA_DURATION_MS * 0.5)).toBe('safe')
    expect(ticketUrgency(t, SLA_DURATION_MS * 0.6)).toBe('warning')
    expect(ticketUrgency(t, SLA_DURATION_MS + 1)).toBe('overdue')
    expect(ticketUrgency(t, SLA_DURATION_MS + TICKET_GRACE_MS + 1)).toBe('expired')
  })

  it('a paused ticket never advances in urgency while paused', () => {
    // 100 real ms elapsed, but all of it paused -> still exactly at "safe", start-of-window
    const t = makeTicket({ pausedMs: SLA_DURATION_MS + TICKET_GRACE_MS })
    expect(ticketUrgency(t, SLA_DURATION_MS + TICKET_GRACE_MS)).toBe('safe')
  })

  it('isTicketExpired matches the "expired" urgency stage exactly', () => {
    const t = makeTicket()
    expect(isTicketExpired(t, SLA_DURATION_MS + TICKET_GRACE_MS)).toBe(false)
    expect(isTicketExpired(t, SLA_DURATION_MS + TICKET_GRACE_MS + 1)).toBe(true)
  })
})
