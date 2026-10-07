import { describe, it, expect } from 'vitest'
import { computeRefund, computePayout } from '../economy.js'

function fakeTopology(devices) {
  return { devices: new Map(devices.map((d, i) => [`dev-${i}`, d])) }
}

describe('economy', () => {
  it('computeRefund sums catalog price, excluding isp and laptop', () => {
    const topo = fakeTopology([
      { type: 'router', model: 'ISR-4321' },   // $1200
      { type: 'pc',     model: 'GENERIC-PC' }, // $200
      { type: 'isp',    model: 'ISP-CLOUD' },  // excluded
      { type: 'laptop', model: 'ADMIN-LAPTOP' }, // excluded
    ])
    expect(computeRefund(topo)).toBe(1400)
  })

  it('computePayout refunds by default (legacy missions have no financialModel)', () => {
    const topo = fakeTopology([{ type: 'router', model: 'ISR-4321' }])
    const mission = { reward: 800 }
    expect(computePayout(mission, { topology: topo })).toEqual({ reward: 800, bonus: 0, refund: 1200, total: 2000 })
  })

  it('computePayout skips refund when financialModel is "keep"', () => {
    const topo = fakeTopology([{ type: 'router', model: 'ISR-4321' }])
    const mission = { reward: 800, financialModel: 'keep' }
    expect(computePayout(mission, { topology: topo })).toEqual({ reward: 800, bonus: 0, refund: 0, total: 800 })
  })

  it('computePayout adds the optional-objective bonus only when earned', () => {
    const mission = { reward: 800, optionalObjectiveBonus: 200, financialModel: 'keep' }
    expect(computePayout(mission, {}).total).toBe(800)
    expect(computePayout(mission, { optionalObjectivesMet: true }).total).toBe(1000)
  })
})
