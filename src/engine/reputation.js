/**
 * Reputation — pure functions, no React, no I/O.
 *
 * Missions gate access by a plain numeric `requiredReputation` — never by tier
 * name — so tiers can be added/renamed/rebalanced without touching mission data.
 */

export const REPUTATION_TIERS = [
  { min: 0,    label: 'Junior Network Engineer' },
  { min: 100,  label: 'Freelance Network Engineer' },
  { min: 300,  label: 'Established Network Engineer' },
  { min: 700,  label: 'Senior Network Engineer' },
  { min: 1500, label: 'Enterprise Network Engineer' },
]

export function tierForScore(score) {
  let current = REPUTATION_TIERS[0]
  for (const tier of REPUTATION_TIERS) {
    if (score >= tier.min) current = tier
  }
  return current
}

/**
 * Reputation gained for completing a mission. Base gain scales with the
 * mission's difficulty (1-4 stars). `outcome.qualityMultiplier` is a hook for a
 * future performance-based scoring system (e.g. shotgun fixes, unnecessary
 * reconfiguration) — defaults to 1 (full credit) since that scoring doesn't
 * exist yet.
 */
export function scoreAfterMission(currentScore, mission, outcome = {}) {
  const base = (mission.difficulty ?? 1) * 20
  const multiplier = outcome.qualityMultiplier ?? 1
  const gained = Math.round(base * multiplier)
  return { newScore: currentScore + gained, gained }
}

export function canAccessClient(reputationScore, requiredReputation = 0) {
  return reputationScore >= requiredReputation
}
