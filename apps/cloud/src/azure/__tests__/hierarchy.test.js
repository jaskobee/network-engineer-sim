/**
 * Management hierarchy — docs/cloud/AZURE_ACCURACY.md §I, §J (resource groups).
 *
 * H-I1  one root per tenant, ID = tenant ID, display name "Tenant root group"
 * H-I2  the root can't be moved or deleted (its display name can change)
 * H-I3  new subscriptions land under the root
 * H-I4  one parent; no cycles
 * H-I5  at most six levels below the root — on create and on move
 * H-I8  MG ID naming; ID unique in the tenant
 * H-J   resource groups: naming, region required, unique per subscription, delete cascades (J3)
 */
import { describe, it, expect } from 'vitest'
import { createCloudState, ROOT_DISPLAY_NAME, managementGroupDepth, TYPES } from '../model.js'
import * as op from '../operations.js'
import { OUTCOME } from '../outcomes.js'
import { TENANT, SUB_A, must, expectRefused, baseState, at, networkState } from './fixtures.js'

const chain = (s, ids) => {
  let parent = TENANT
  for (const id of ids) { s = must(op.createManagementGroup(s, { id, displayName: id, parentId: parent })).state; parent = id }
  return s
}

describe('H-I1 — the root management group', () => {
  it('a new tenant has exactly one MG: the root, with the tenant ID and the default name', () => {
    const s = createCloudState({ tenantId: TENANT })
    expect(Object.values(s.managementGroups)).toEqual([{ id: TENANT, displayName: ROOT_DISPLAY_NAME, parentId: null }])
    expect(ROOT_DISPLAY_NAME).toBe('Tenant root group')
  })
})

describe('H-I2 — the root is immutable in place', () => {
  const s = createCloudState({ tenantId: TENANT })
  it('can\'t be moved', () => {
    const t = must(op.createManagementGroup(s, { id: 'platform', displayName: 'Platform' })).state
    expectRefused(op.moveManagementGroup(t, { id: TENANT, parentId: 'platform' }), OUTCOME.ROOT_IMMUTABLE, 'I2')
  })
  it('can\'t be deleted', () => {
    expectRefused(op.deleteManagementGroup(s, { id: TENANT }), OUTCOME.ROOT_IMMUTABLE, 'I2')
  })
  it('can be renamed', () => {
    const t = must(op.renameManagementGroup(s, { id: TENANT, displayName: 'Contoso' })).state
    expect(t.managementGroups[TENANT].displayName).toBe('Contoso')
  })
})

describe('H-I3 — new subscriptions default to the root', () => {
  it('addSubscription parents the subscription to the root', () => {
    const s = must(op.addSubscription(createCloudState({ tenantId: TENANT }), { id: SUB_A, displayName: 'Prod' })).state
    expect(s.subscriptions[SUB_A].parentId).toBe(TENANT)
  })
  it('a subscription can then move under a management group (one parent)', () => {
    let s = baseState()
    s = must(op.createManagementGroup(s, { id: 'landing-zones', displayName: 'Landing zones' })).state
    s = must(op.moveSubscription(s, { id: SUB_A, parentId: 'landing-zones' })).state
    expect(s.subscriptions[SUB_A].parentId).toBe('landing-zones')
  })
})

describe('H-I4 — no cycles', () => {
  it('an MG can\'t move under its own descendant', () => {
    const s = chain(createCloudState({ tenantId: TENANT }), ['a', 'b', 'c'])
    expectRefused(op.moveManagementGroup(s, { id: 'a', parentId: 'c' }), OUTCOME.HIERARCHY_CYCLE, 'I4')
    expectRefused(op.moveManagementGroup(s, { id: 'a', parentId: 'a' }), OUTCOME.HIERARCHY_CYCLE, 'I4')
  })
})

describe('H-I5 — six levels below the root', () => {
  it('level 6 is allowed, level 7 is refused', () => {
    const s = chain(createCloudState({ tenantId: TENANT }), ['l1', 'l2', 'l3', 'l4', 'l5', 'l6'])
    expect(managementGroupDepth(s, 'l6')).toBe(6)
    expectRefused(op.createManagementGroup(s, { id: 'l7', displayName: 'L7', parentId: 'l6' }), OUTCOME.HIERARCHY_TOO_DEEP, 'I5')
  })
  it('a move that would push a subtree past six levels is refused', () => {
    let s = chain(createCloudState({ tenantId: TENANT }), ['l1', 'l2', 'l3', 'l4'])
    s = chain(s, ['x1', 'x2', 'x3'])                      // a 3-level branch under the root
    // x1 under l4 would put x3 at level 7
    expectRefused(op.moveManagementGroup(s, { id: 'x1', parentId: 'l4' }), OUTCOME.HIERARCHY_TOO_DEEP, 'I5')
    // under l3 it lands at level 6 — allowed
    expect(op.moveManagementGroup(s, { id: 'x1', parentId: 'l3' }).ok).toBe(true)
  })
  it('subscriptions don\'t count as a level', () => {
    let s = chain(baseState(), ['l1', 'l2', 'l3', 'l4', 'l5', 'l6'])
    expect(op.moveSubscription(s, { id: SUB_A, parentId: 'l6' }).ok).toBe(true)
  })
})

describe('H-I8 — management group IDs', () => {
  const s = createCloudState({ tenantId: TENANT })
  it.each([['corp'], ['Landing.Zones'], ['mg-(prod)_1'], ['a'.repeat(90)]])('accepts %s', id => {
    expect(op.createManagementGroup(s, { id, displayName: 'x' }).ok).toBe(true)
  })
  it.each([[''], ['-corp'], ['corp.'], ['corp mg'], ['a'.repeat(91)]])('refuses "%s"', id => {
    expectRefused(op.createManagementGroup(s, { id, displayName: 'x' }), OUTCOME.NAME_INVALID, 'I8')
  })
  it('the ID is unique in the tenant; the display name is separate and required', () => {
    const t = must(op.createManagementGroup(s, { id: 'corp', displayName: 'Corp' })).state
    expectRefused(op.createManagementGroup(t, { id: 'corp', displayName: 'Other' }), OUTCOME.NAME_NOT_UNIQUE, 'K')
    expectRefused(op.createManagementGroup(s, { id: 'online', displayName: '  ' }), OUTCOME.INVALID_VALUE, 'I8')
  })
  it('deleting an MG that still has children is not modelled (not guessed)', () => {
    let t = chain(s, ['parent', 'child'])
    expectRefused(op.deleteManagementGroup(t, { id: 'parent' }), OUTCOME.NOT_MODELLED, null)
    expect(op.deleteManagementGroup(t, { id: 'child' }).ok).toBe(true)
  })
})

describe('H-J — resource groups', () => {
  const s = baseState()
  it('names follow the K-table rule (Unicode letters allowed, no trailing period)', () => {
    expect(op.createResourceGroup(s, { subscriptionId: SUB_A, name: 'rg-Zürich_(prod).1', location: 'westeurope' }).ok).toBe(true)
    expectRefused(op.createResourceGroup(s, { subscriptionId: SUB_A, name: 'rg.', location: 'westeurope' }), OUTCOME.NAME_INVALID, 'K')
    expectRefused(op.createResourceGroup(s, { subscriptionId: SUB_A, name: 'rg app', location: 'westeurope' }), OUTCOME.NAME_INVALID, 'K')
  })
  it('J2: a region is required', () => {
    expectRefused(op.createResourceGroup(s, { subscriptionId: SUB_A, name: 'rg-x', location: 'nowhere' }), OUTCOME.INVALID_VALUE, 'J2')
  })
  it('names are unique per subscription, not per tenant', () => {
    expectRefused(op.createResourceGroup(s, { subscriptionId: SUB_A, name: 'rg-app', location: 'westeurope' }), OUTCOME.NAME_NOT_UNIQUE, 'K')
    expect(op.createResourceGroup(s, { subscriptionId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', name: 'rg-app', location: 'westeurope' }).ok).toBe(true)
  })
  it('J2: a resource may live in a different region from its resource group', () => {
    expect(op.createNetworkSecurityGroup(s, { ...at('rg-app', SUB_A, 'northeurope'), name: 'nsg-ne' }).ok).toBe(true)
  })
  it('J3: deleting a resource group deletes every resource in it', () => {
    const { state } = networkState()
    const t = must(op.deleteResourceGroup(state, { subscriptionId: SUB_A, name: 'rg-app' })).state
    expect(Object.values(t.resources).filter(r => r.type === TYPES.VIRTUAL_NETWORK)).toEqual([])
    expect(Object.keys(t.resourceGroups)).not.toContain(`/subscriptions/${SUB_A}/resourceGroups/rg-app`)
  })
})
