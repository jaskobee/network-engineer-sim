import { describe, it, expect } from 'vitest'
import { REPUTATION_TIERS, tierForScore, scoreAfterMission, canAccessClient } from '../reputation.js'

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
})
