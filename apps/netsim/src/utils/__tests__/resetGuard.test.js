/**
 * "New game" resets NetSim only. The products share one origin in production, so every
 * product keeps its keys under its own prefix and NetSim sweeps only its own.
 *
 * R1  every netsim_* key is swept, including ones added later (prefix rule)
 * R2  another product's keys survive (Cloud Engineer: cloudeng_*)
 * R3  keys of nobody in particular are never touched
 */
import { describe, it, expect } from 'vitest'
import { sweptByNewGame } from '../resetGuard.js'

describe('New game key sweep', () => {
  it('R1: sweeps the NetSim keys', () => {
    for (const k of ['netsim_v2', 'netsim_v1_company', 'netsim_v1_career', 'netsim_subnet_planner', 'netsim_laptop_intro_seen', 'netsim_some_future_setting'])
      expect(sweptByNewGame(k)).toBe(true)
  })
  it("R2: keeps the other products' keys", () => {
    expect(sweptByNewGame('cloudeng_save_v1')).toBe(false)
    expect(sweptByNewGame('cloudeng_save_v1_unreadable')).toBe(false)
  })
  it('R3: leaves other keys alone', () => {
    expect(sweptByNewGame('theme')).toBe(false)
  })
})
