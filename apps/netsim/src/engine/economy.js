/**
 * Economy — pure functions, no React, no I/O.
 *
 * computeRefund() reproduces the exact calculation GameContext.completeMission
 * has always used: full catalog price of every purchased device (ISP and the
 * admin laptop are pre-placed/free, and excluded). Extracted here so it has one
 * definition shared by the legacy 'refund' financial model and any future caller.
 */
import { deviceCatalog } from '../data/deviceCatalog.js'

export function computeRefund(topology) {
  let sum = 0
  for (const d of topology.devices.values()) {
    if (d.type === 'isp' || d.type === 'laptop') continue
    const entry = deviceCatalog.find(e => e.model === d.model)
    sum += entry?.price ?? 0
  }
  return sum
}

/**
 * Total payout for completing a mission.
 *
 * financialModel 'keep' (persistent client infrastructure) never refunds — the
 * hardware is still there, still in use. Anything else (including legacy
 * missions, which have no financialModel field at all) refunds, matching
 * today's behavior exactly.
 */
export function computePayout(mission, { optionalObjectivesMet = false, topology = null } = {}) {
  const reward = mission.reward ?? 0
  const bonus  = (optionalObjectivesMet && mission.optionalObjectiveBonus) ? mission.optionalObjectiveBonus : 0
  const refund = (mission.financialModel !== 'keep' && topology) ? computeRefund(topology) : 0
  return { reward, bonus, refund, total: reward + bonus + refund }
}
