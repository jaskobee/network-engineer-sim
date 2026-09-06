import { describe, it, expect } from 'vitest'
import { CLIENT_TEMPLATES, findClientTemplate, createClientInstance } from '../clients.js'
import { CONTRACT_TYPES, createContract } from '../contracts.js'

describe('clients', () => {
  it('createClientInstance builds a fresh mutable record from a template', () => {
    const c = createClientInstance('client_local_shop')
    expect(c.id).toBe('client_local_shop')
    expect(c.companyName).toBe(CLIENT_TEMPLATES[0].companyName)
    expect(c.satisfaction).toBe(100)
    expect(c.completedMissionIds).toEqual([])
    expect(c.availableFutureMissionIds).toEqual(['mission_local_shop_1'])
  })

  it('createClientInstance returns fresh arrays per call (no shared mutable state)', () => {
    const a = createClientInstance('client_local_shop')
    const b = createClientInstance('client_local_shop')
    a.completedMissionIds.push('mission_local_shop_1')
    expect(b.completedMissionIds).toEqual([])
  })

  it('returns null for an unknown template id', () => {
    expect(createClientInstance('nope')).toBeNull()
    expect(findClientTemplate('nope')).toBeNull()
  })
})

describe('contracts', () => {
  it('createContract builds a contract from a known contract type', () => {
    const contract = createContract({ clientId: 'client_local_shop', contractType: 'monthly-support', startedAtMissionId: 'mission_local_shop_1' })
    expect(contract.clientId).toBe('client_local_shop')
    expect(contract.amountPerMonth).toBe(CONTRACT_TYPES['monthly-support'].amountPerMonth)
    expect(contract.active).toBe(true)
    expect(contract.id).toMatch(/^contract-\d+$/)
  })

  it('returns null for an unknown contract type', () => {
    expect(createContract({ clientId: 'x', contractType: 'nope' })).toBeNull()
  })
})
