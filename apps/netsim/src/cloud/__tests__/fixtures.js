/**
 * Shared test fixture: a tenant with two subscriptions and a resource group in each,
 * built only through operations.js (the same rule as dev presets: drive the real engine).
 */
import { expect } from 'vitest'
import { createCloudState } from '../model.js'
import * as op from '../operations.js'

export const TENANT = '11111111-1111-4111-8111-111111111111'
export const SUB_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
export const SUB_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

/** Apply an operation that must succeed; returns { state, id, warnings }. */
export function must(result) {
  if (!result.ok) throw new Error(`expected success, got ${result.outcome} (${result.ruleId}): ${result.message}`)
  return result
}

/** Assert an operation was refused with this exact outcome and rule. */
export function expectRefused(result, outcome, ruleId) {
  expect(result.ok).toBe(false)
  expect({ outcome: result.outcome, ruleId: result.ruleId }).toEqual({ outcome, ruleId })
  expect(typeof result.message).toBe('string')
}

export function baseState() {
  let s = createCloudState({ tenantId: TENANT })
  s = must(op.addSubscription(s, { id: SUB_A, displayName: 'Production' })).state
  s = must(op.addSubscription(s, { id: SUB_B, displayName: 'Development' })).state
  s = must(op.createResourceGroup(s, { subscriptionId: SUB_A, name: 'rg-app', location: 'westeurope' })).state
  s = must(op.createResourceGroup(s, { subscriptionId: SUB_B, name: 'rg-dev', location: 'westeurope' })).state
  return s
}

export const at = (rg = 'rg-app', sub = SUB_A, location = 'westeurope') => ({ subscriptionId: sub, resourceGroup: rg, location })

/** baseState + a VNet 10.0.0.0/16 with subnet "web" 10.0.1.0/24 in rg-app. */
export function networkState() {
  const r = must(op.createVirtualNetwork(baseState(), {
    ...at(), name: 'vnet-app', addressPrefixes: ['10.0.0.0/16'],
    subnets: [{ name: 'web', addressPrefix: '10.0.1.0/24' }],
  }))
  return { state: r.state, vnetId: r.id, webSubnetId: `${r.id}/subnets/web` }
}
