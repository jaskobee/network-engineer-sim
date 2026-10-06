/**
 * "New game" resets the on-prem game only (owner decision 2026-10-06).
 *
 * R1  every on-prem netsim_* key is swept, including ones added later (prefix rule)
 * R2  the cloud section's keys survive — main slice and the unreadable-save backup
 * R3  non-NetSim keys are never touched
 */
import { describe, it, expect } from 'vitest'
import { sweptByNewGame } from '../resetGuard.js'
import { CLOUD_SAVE_KEY, CLOUD_UNREADABLE_KEY } from '../../cloud/persistence.js'

describe('New game key sweep', () => {
  it('R1: sweeps the on-prem keys', () => {
    for (const k of ['netsim_v2', 'netsim_v1_company', 'netsim_v1_career', 'netsim_subnet_planner', 'netsim_laptop_intro_seen', 'netsim_some_future_setting'])
      expect(sweptByNewGame(k)).toBe(true)
  })
  it('R2: keeps the cloud section', () => {
    expect(sweptByNewGame(CLOUD_SAVE_KEY)).toBe(false)
    expect(sweptByNewGame(CLOUD_UNREADABLE_KEY)).toBe(false)
  })
  it('R3: leaves other keys alone', () => {
    expect(sweptByNewGame('theme')).toBe(false)
  })
})
