import { describe, it, expect } from 'vitest'
import {
  REPUTATION_TIERS, tierForScore, scoreAfterMission, canAccessClient,
  scoreAfterTicket, scoreAfterExpiredTicket, satisfactionDelta,
} from '../reputation.js'

describe('reputation', () => {
  it('tierForScore returns the highest tier at or below the score', () => {
    expect(tierForScore(0).label).toBe('Junior Network Engineer')
    expect(tierForScore(99).label).toBe('Junior Network Engineer')
    expect(tierForScore(100).label).toBe('Freelance Network Engineer')
    expect(tierForScore(2000).label).toBe('Enterprise Network Engineer')
  })

  it('tiers are sorted ascending by min (invariant tierForScore relies on)', () => {
    for (let i = 1; i < REPUTATION_TIERS.length; i++) {
      expect(REPUTATION_TIERS[i].min).toBeGreaterThan(REPUTATION_TIERS[i - 1].min)
    }
  })

  it('scoreAfterMission scales gain with difficulty and applies quality multiplier', () => {
    expect(scoreAfterMission(0, { difficulty: 1 })).toEqual({ newScore: 20, gained: 20 })
    expect(scoreAfterMission(50, { difficulty: 4 })).toEqual({ newScore: 130, gained: 80 })
    expect(scoreAfterMission(0, { difficulty: 2 }, { qualityMultiplier: 0.5 })).toEqual({ newScore: 20, gained: 20 })
  })

  it('canAccessClient gates on requiredReputation', () => {
    expect(canAccessClient(0, 0)).toBe(true)
    expect(canAccessClient(50, 100)).toBe(false)
    expect(canAccessClient(100, 100)).toBe(true)
  })

  describe('scoreAfterTicket (contract SLA)', () => {
    const ticket = { issuedAt: 1000, deadlineAt: 1000 + 8 * 60 * 1000, pausedMs: 0 } // 8 min SLA window

    it('grants the fast bonus when completed within the first half of the SLA window', () => {
      const result = scoreAfterTicket(0, ticket, 1000 + 3 * 60 * 1000) // 3 min in, well under 50%
      expect(result).toEqual({ newScore: 15, gained: 15, kind: 'fast' })
    })

    it('grants the smaller on-time gain when completed before the deadline but past 50%', () => {
      const result = scoreAfterTicket(0, ticket, 1000 + 6 * 60 * 1000) // 6 min in, past 50%, before 8 min deadline
      expect(result).toEqual({ newScore: 5, gained: 5, kind: 'ontime' })
    })

    it('applies a penalty when completed after the deadline', () => {
      const result = scoreAfterTicket(20, ticket, 1000 + 10 * 60 * 1000) // past the 8 min deadline
      expect(result).toEqual({ newScore: 15, gained: -5, kind: 'late' })
    })

    it('excludes paused time (mission was active) from the elapsed calculation', () => {
      const paused = { ...ticket, pausedMs: 7 * 60 * 1000 } // 7 min paused
      // 10 min of wall-clock elapsed, but 7 min of it was paused -> only 3 min really counted, still "fast"
      const result = scoreAfterTicket(0, paused, 1000 + 10 * 60 * 1000)
      expect(result.kind).toBe('fast')
    })

    it('never drops reputation below zero', () => {
      const result = scoreAfterTicket(2, ticket, 1000 + 10 * 60 * 1000) // -5 penalty
      expect(result.newScore).toBe(0)
    })
  })

  it('scoreAfterExpiredTicket applies a fixed penalty, clamped at zero', () => {
    expect(scoreAfterExpiredTicket(100)).toEqual({ newScore: 75, gained: -25 })
    expect(scoreAfterExpiredTicket(10)).toEqual({ newScore: 0, gained: -25 })
  })

  it('satisfactionDelta returns the right sign per outcome kind', () => {
    expect(satisfactionDelta('fast')).toBeGreaterThan(0)
    expect(satisfactionDelta('ontime')).toBe(0)
    expect(satisfactionDelta('late')).toBeLessThan(0)
    expect(satisfactionDelta('expired')).toBeLessThan(satisfactionDelta('late'))
    expect(satisfactionDelta('unknown-kind')).toBe(0)
  })
})
