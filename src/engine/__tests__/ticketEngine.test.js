/**
 * The service-ticket clock, played for simulated hours (engine/ticketEngine.js).
 *
 * The bug this replaces: ContractClockDriver's interval kept calling the FIRST render's copy of
 * tickContracts, which never saw the ticket it had just issued — so once the gap elapsed it raised a
 * new ticket, and a new email, on every 15 s tick ("cable loose / lost IP every minute").
 *
 * E1 - the regression: an ignored ticket is issued once, not on every tick
 * E2 - after a FIX the next problem waits at least the minimum cooldown
 * E3 - while the player is busy: fewer tickets, the SLA clock is paused, nobody nags
 * E4 - the mailbox: one alert, then reminders that back off — never a flood
 * E5 - two clients: never two problems at once or back to back
 * E6 - a dormant client is left alone; an older save gets no surprise ticket on load
 * E7 - problems don't repeat on a loop
 */
import { describe, it, expect } from 'vitest'
import { tickTickets, afterTicketFixed } from '../ticketEngine.js'
import { TICKET_GAP_MS, GLOBAL_MIN_SPACING_MS, BUSY_GAP_FACTOR } from '../ticketScheduler.js'
import { SLA_DURATION_MS, TICKET_GRACE_MS } from '../contractClock.js'
import { SERVICE_TICKET_TEMPLATES } from '../../data/serviceTickets.js'

const MIN = 60_000, TICK = 15_000
const T0 = 1_000_000

// A small seeded generator so "random" is repeatable.
function lcg(seed) { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296) }

const client = id => ({ id, companyName: "Sam's Corner Store", contactName: 'Sam', dormant: false, satisfaction: 100, consecutiveMissedTickets: 0 })
const contract = (id, clientId) => ({ id, clientId, active: true, startedAtMs: T0, lastTicketAt: null, openTicketId: null })

function world(clientIds = ['client_local_shop']) {
  return {
    reputation: 100,
    clients: Object.fromEntries(clientIds.map(id => [id, client(id)])),
    contracts: Object.fromEntries(clientIds.map((id, i) => [`c${i}`, contract(`c${i}`, id)])),
    tickets: {},
  }
}

/**
 * Run the clock every 15 s for `minutes`. `busyAt(t)` says whether the player is on another job;
 * `fixAfterMs` (optional) fixes each ticket that long after it opens (through the same reschedule the
 * app uses). Returns a log of what happened.
 */
function simulate(state, { minutes, busyAt = () => false, fixAfterMs = null, rng, prev = null }) {
  const log = { issued: [], notes: [], fixed: [], maxOpen: 0 }
  let prevTickAt = prev
  for (let now = T0; now <= T0 + minutes * MIN; now += TICK) {
    const r = tickTickets(state, { now, prevTickAt, busy: busyAt(now - T0), rng })
    prevTickAt = now
    state = { reputation: r.reputation, clients: r.clients, contracts: r.contracts, tickets: r.tickets }
    for (const t of r.issued) log.issued.push({ at: now - T0, id: t.id, templateId: t.templateId })
    for (const n of r.notifications) log.notes.push({ at: now - T0, kind: n.kind })
    log.maxOpen = Math.max(log.maxOpen, Object.keys(state.tickets).length)
    if (fixAfterMs != null) {
      for (const t of Object.values(state.tickets)) {
        if (now - t.issuedAt >= fixAfterMs && !busyAt(now - T0)) {
          state = {
            ...state,
            contracts: { ...state.contracts, [t.contractId]: afterTicketFixed(state.contracts[t.contractId], t, now, rng) },
            tickets: Object.fromEntries(Object.entries(state.tickets).filter(([id]) => id !== t.id)),
          }
          log.fixed.push({ at: now - T0, id: t.id })
        }
      }
    }
  }
  return { state, log }
}

describe('E1 — an ignored ticket is raised once, not on every tick', () => {
  it('three hours of ignoring problems: two tickets, then the client goes quiet — never a flood', () => {
    const { log, state } = simulate(world(), { minutes: 180, rng: lcg(1) })
    expect(log.maxOpen).toBe(1)
    expect(log.issued).toHaveLength(2)                      // two unanswered in a row → dormant (existing rule)
    expect(state.clients.client_local_shop.dormant).toBe(true)
    expect(log.notes.filter(n => n.kind === 'client-dormant')).toHaveLength(1)
    // a full cycle (open → expire → wait) is well over 25 minutes, so nothing arrives back to back
    const gap = log.issued[1].at - log.issued[0].at
    expect(gap).toBeGreaterThanOrEqual(SLA_DURATION_MS + TICKET_GRACE_MS + TICKET_GAP_MS[0])
  })

  it('an engaged player (fixing each one) keeps getting problems, spaced out', () => {
    const { log } = simulate(world(), { minutes: 180, fixAfterMs: 2 * MIN, rng: lcg(1) })
    expect(log.issued.length).toBeGreaterThanOrEqual(6)
    expect(log.issued.length).toBeLessThanOrEqual(Math.ceil(180 / 10))
  })

  it('state is threaded through: feeding the result back never re-issues an open ticket', () => {
    let state = world()
    let r = tickTickets(state, { now: T0 + 60 * MIN, rng: lcg(2) })          // schedules
    state = { reputation: r.reputation, clients: r.clients, contracts: r.contracts, tickets: r.tickets }
    let issued = 0
    for (let now = T0 + 60 * MIN; now < T0 + 200 * MIN; now += TICK) {
      r = tickTickets(state, { now, rng: lcg(3) })
      issued += r.issued.length
      state = { reputation: r.reputation, clients: r.clients, contracts: r.contracts, tickets: r.tickets }
      expect(Object.keys(state.tickets).length).toBeLessThanOrEqual(1)
      if (issued > 0) break
    }
    expect(issued).toBe(1)
    // once open, another pass in the same minute does nothing
    r = tickTickets(state, { now: T0 + 400 * MIN, rng: lcg(3) })
    expect(r.issued).toHaveLength(0)
  })
})

describe('E2 — after a fix, leave the player alone', () => {
  it('the next problem is at least the minimum gap after the FIX (not after it was raised)', () => {
    const { log } = simulate(world(), { minutes: 240, fixAfterMs: 90_000, rng: lcg(4) })
    expect(log.fixed.length).toBeGreaterThanOrEqual(3)
    for (let i = 0; i < log.fixed.length - 1; i++) {
      const nextIssue = log.issued.find(t => t.at > log.fixed[i].at)
      expect(nextIssue.at - log.fixed[i].at).toBeGreaterThanOrEqual(TICKET_GAP_MS[0])
    }
  })

  it('a quick fixer still gets at most one new problem per ten minutes', () => {
    const { log } = simulate(world(), { minutes: 240, fixAfterMs: 30_000, rng: lcg(5) })
    expect(log.issued.length).toBeLessThanOrEqual(Math.ceil(240 / 10) + 1)
  })

  it('the gaps between problems vary (the rhythm is not a metronome)', () => {
    const { log } = simulate(world(), { minutes: 600, fixAfterMs: 60_000, rng: lcg(6) })
    const gaps = new Set(log.issued.slice(1).map((t, i) => Math.round((t.at - log.issued[i].at) / 15_000)))
    expect(gaps.size).toBeGreaterThan(4)
  })
})

describe('E3 — busy on another job', () => {
  it('the same clock raises fewer problems while the player is on a job', () => {
    const idle = simulate(world(), { minutes: 300, fixAfterMs: 60_000, rng: lcg(7) }).log.issued.length
    const busy = simulate(world(), { minutes: 300, fixAfterMs: 60_000, busyAt: () => true, rng: lcg(7) }).log.issued.length
    expect(busy).toBeLessThan(idle)
    expect(busy).toBeLessThanOrEqual(Math.ceil(300 / (TICK_MIN() * BUSY_GAP_FACTOR)) + 1)
  })

  it('an open ticket does not age while the player is busy: no expiry, no reminder, clock paused', () => {
    const state = { ...world(), tickets: { t1: { id: 't1', contractId: 'c0', clientId: 'client_local_shop', templateId: 'x', title: 'X', issuedAt: T0, pausedMs: 0, status: 'open', alertsSent: 1, lastAlertAt: T0 } } }
    state.contracts.c0 = { ...state.contracts.c0, openTicketId: 't1' }
    const { state: after, log } = simulate(state, { minutes: 30, busyAt: () => true, rng: lcg(8), prev: T0 })
    expect(log.notes).toEqual([])                                   // 30 min busy: > 5 min reminder, > 14 min expiry — none fired
    expect(Object.keys(after.tickets)).toEqual(['t1'])
    expect(after.tickets.t1.pausedMs).toBeGreaterThanOrEqual(29 * MIN)
  })

  it('SLA time is paused for the REAL time that passed — not a fixed step per call', () => {
    const state = { ...world(), tickets: { t1: { id: 't1', contractId: 'c0', clientId: 'client_local_shop', templateId: 'x', title: 'X', issuedAt: T0, pausedMs: 0, status: 'open', alertsSent: 1, lastAlertAt: T0 } } }
    state.contracts.c0 = { ...state.contracts.c0, openTicketId: 't1' }
    // a background tab that only woke up once a minute
    const r = tickTickets(state, { now: T0 + 60_000, prevTickAt: T0, busy: true, rng: lcg(9) })
    expect(r.tickets.t1.pausedMs).toBe(60_000)
    // and never more than a couple of minutes for one pass, however long the gap
    const r2 = tickTickets(state, { now: T0 + 3_600_000, prevTickAt: T0, busy: true, rng: lcg(9) })
    expect(r2.tickets.t1.pausedMs).toBe(2 * MIN)
    // first pass after a load has no previous tick: nothing is credited
    expect(tickTickets(state, { now: T0 + 60_000, prevTickAt: null, busy: true, rng: lcg(9) }).tickets.t1.pausedMs ?? 0).toBe(0)
  })

  it('a ticket never expires through the player\'s being on another job', () => {
    let state = world()
    state = { ...state, contracts: { c0: { ...state.contracts.c0, ticketGapStartedAt: T0, ticketGapMs: 1 } } }
    let r = tickTickets(state, { now: T0 + 10, rng: lcg(10) })
    expect(r.issued).toHaveLength(1)
    state = { reputation: r.reputation, clients: r.clients, contracts: r.contracts, tickets: r.tickets }
    let prev = T0 + 10, rep = state.reputation
    for (let now = T0 + 10 + TICK; now <= T0 + 10 + 60 * MIN; now += TICK) {     // an hour busy
      r = tickTickets(state, { now, prevTickAt: prev, busy: true, rng: lcg(10) })
      prev = now
      state = { reputation: r.reputation, clients: r.clients, contracts: r.contracts, tickets: r.tickets }
    }
    expect(Object.keys(state.tickets)).toHaveLength(1)
    expect(state.reputation).toBe(rep)
    expect(state.clients.client_local_shop.dormant).toBe(false)
  })
})

describe('E4 — the mailbox is not spammed', () => {
  it('an ignored ticket produces: one alert, one reminder, one expiry notice — nothing else', () => {
    let state = world()
    state = { ...state, contracts: { c0: { ...state.contracts.c0, ticketGapStartedAt: T0, ticketGapMs: 1 } } }
    const { log } = simulate(state, { minutes: 16, rng: lcg(11) })
    // gap of 1 ms → issued on the first pass; a reminder 5 min later; expiry after SLA + grace (14 min)
    expect(log.notes.map(n => n.kind)).toEqual(['ticket-issued', 'ticket-reminder', 'sla-expired'])
    expect(log.notes[1].at - log.notes[0].at).toBeGreaterThanOrEqual(5 * MIN)
    expect(log.notes[1].at - log.notes[0].at).toBeLessThan(5 * MIN + 2 * TICK)
  })

  it('over three hours of ignoring everything the mailbox gets a handful of messages, not hundreds', () => {
    const { log } = simulate(world(), { minutes: 180, rng: lcg(12) })
    expect(log.notes.length).toBeLessThanOrEqual(7 * 3 + 2)      // ≤ 3 per ticket (+ dormancy notice)
    // and the same problem never produces two alerts in the same five minutes
    const perTicket = {}
    for (const n of log.notes.filter(n => n.kind === 'ticket-issued' || n.kind === 'ticket-reminder')) (perTicket[Math.floor(n.at / (5 * MIN))] ??= []).push(n)
    for (const bucket of Object.values(perTicket)) expect(bucket.length).toBeLessThanOrEqual(2)
  })

  it('reminders stay quiet while busy and resume, backed off, when the player is free again', () => {
    let state = world()
    state = { ...state, contracts: { c0: { ...state.contracts.c0, ticketGapStartedAt: T0, ticketGapMs: 1 } } }
    const busyUntil = 40 * MIN
    const { log } = simulate(state, { minutes: 60, busyAt: t => t > 1 * MIN && t < busyUntil, rng: lcg(13) })
    const reminders = log.notes.filter(n => n.kind === 'ticket-reminder')
    expect(reminders.length).toBeGreaterThanOrEqual(1)
    expect(reminders[0].at).toBeGreaterThanOrEqual(busyUntil)                 // none during the busy stretch
    if (reminders[1]) expect(reminders[1].at - reminders[0].at).toBeGreaterThanOrEqual(10 * MIN - TICK)   // then it backs off
  })
})

describe('E5 — two clients', () => {
  it('never two problems at the same moment or back to back', () => {
    SERVICE_TICKET_TEMPLATES.client_b = SERVICE_TICKET_TEMPLATES.client_local_shop
    try {
      let state = world(['client_local_shop', 'client_b'])
      for (const id of Object.keys(state.contracts)) state.contracts[id] = { ...state.contracts[id], ticketGapStartedAt: T0, ticketGapMs: 1 }
      const { log } = simulate(state, { minutes: 120, rng: lcg(14) })
      const times = log.issued.map(t => t.at).sort((a, b) => a - b)
      for (let i = 1; i < times.length; i++) expect(times[i] - times[i - 1]).toBeGreaterThanOrEqual(GLOBAL_MIN_SPACING_MS)
      expect(log.maxOpen).toBeLessThanOrEqual(2)
    } finally { delete SERVICE_TICKET_TEMPLATES.client_b }
  })
})

describe('E6 — dormant clients and older saves', () => {
  it('a dormant client is never given a ticket', () => {
    const state = world()
    state.clients.client_local_shop = { ...state.clients.client_local_shop, dormant: true }
    state.contracts.c0 = { ...state.contracts.c0, ticketGapStartedAt: T0, ticketGapMs: 1 }
    expect(simulate(state, { minutes: 120, rng: lcg(15) }).log.issued).toHaveLength(0)
  })

  it('a contract saved before scheduling existed gets a schedule, not an instant ticket', () => {
    const state = world()
    state.contracts.c0 = { ...state.contracts.c0, lastTicketAt: T0 - 5 * 3_600_000, startedAtMs: T0 - 9 * 3_600_000 }   // hours ago, no gap fields
    const r = tickTickets(state, { now: T0, rng: lcg(16) })
    expect(r.issued).toHaveLength(0)
    expect(r.contracts.c0.ticketGapMs).toBeGreaterThanOrEqual(TICKET_GAP_MS[0])
    expect(r.contracts.c0.ticketGapStartedAt).toBe(T0)
  })
})

describe('E7 — problems do not repeat on a loop', () => {
  it('the same kind of problem never comes twice in a row', () => {
    const { log } = simulate(world(), { minutes: 900, fixAfterMs: 60_000, rng: lcg(17) })
    expect(log.issued.length).toBeGreaterThan(20)
    for (let i = 1; i < log.issued.length; i++) expect(log.issued[i].templateId).not.toBe(log.issued[i - 1].templateId)
    expect(new Set(log.issued.map(t => t.templateId)).size).toBeGreaterThanOrEqual(3)
  })
})

function TICK_MIN() { return TICKET_GAP_MS[0] / MIN }
