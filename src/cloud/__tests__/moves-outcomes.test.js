/**
 * Resource moves (docs/AZURE_ACCURACY.md J9) and the outcome registry.
 *
 * M-J9a  a move changes the resource ID and resource group, never the region
 * M-J9b  references to a moved resource follow it (NIC → VNet subnet, VM → NIC)
 * M-J9c  across subscriptions, every dependent must be in the move (MissingMoveDependentResources)
 * M-J9d  within a subscription, cross-resource-group references are fine (J5)
 * O-1    every outcome operations.js can return is registered; armCode only where sourced
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as op from '../operations.js'
import { OUTCOME, OUTCOMES } from '../outcomes.js'
import { SUB_A, SUB_B, must, expectRefused, at, networkState } from './fixtures.js'

function workload() {
  const { state, vnetId, webSubnetId } = networkState()
  const nic = must(op.createNetworkInterface(state, { ...at(), name: 'nic-vm1', subnetId: webSubnetId }))
  const vm = must(op.createVirtualMachine(nic.state, {
    ...at(), name: 'vm1', osType: 'Linux', size: 'Standard_B2s',
    osDisk: { diskType: 'PremiumSSD' }, networkInterfaceIds: [nic.id],
  }))
  return { state: vm.state, vnetId, nicId: nic.id, vmId: vm.id }
}

describe('M-J9 — moving resources', () => {
  it('a: the ID and resource group change; the region doesn\'t', () => {
    const { state, vnetId } = networkState()
    const t = must(op.createResourceGroup(state, { subscriptionId: SUB_A, name: 'rg-network', location: 'northeurope' })).state
    const r = must(op.moveResources(t, { ids: [vnetId], targetSubscriptionId: SUB_A, targetResourceGroup: 'rg-network' }))
    const [newId] = r.id
    expect(newId).toBe(`/subscriptions/${SUB_A}/resourceGroups/rg-network/providers/Microsoft.Network/virtualNetworks/vnet-app`)
    expect(r.state.resources[vnetId]).toBeUndefined()
    expect(r.state.resources[newId].location).toBe('westeurope')
  })

  it('b+d: within a subscription, a VNet can move alone and its NIC follows the new subnet ID', () => {
    const { state, vnetId, nicId } = workload()
    const t = must(op.createResourceGroup(state, { subscriptionId: SUB_A, name: 'rg-network', location: 'westeurope' })).state
    const r = must(op.moveResources(t, { ids: [vnetId], targetSubscriptionId: SUB_A, targetResourceGroup: 'rg-network' }))
    expect(r.state.resources[nicId].properties.subnetId).toBe(`${r.id[0]}/subnets/web`)
  })

  it('c: across subscriptions a VM without its NIC and VNet is refused with the real code', () => {
    const { state, vmId } = workload()
    const res = op.moveResources(state, { ids: [vmId], targetSubscriptionId: SUB_B, targetResourceGroup: 'rg-dev' })
    expectRefused(res, OUTCOME.MOVE_MISSING_DEPENDENTS, 'J9')
    expect(res.message).toContain('nic-vm1')
    expect(res.message).toContain('vnet-app')
    expect(OUTCOMES[res.outcome].armCode).toBe('MissingMoveDependentResources')
  })

  it('c: with every dependent included the move succeeds and the VM still points at its NIC', () => {
    const { state, vmId, nicId, vnetId } = workload()
    const r = must(op.moveResources(state, { ids: [vmId, nicId, vnetId], targetSubscriptionId: SUB_B, targetResourceGroup: 'rg-dev' }))
    const vm = Object.values(r.state.resources).find(x => x.name === 'vm1')
    const nic = Object.values(r.state.resources).find(x => x.name === 'nic-vm1')
    expect(vm.subscriptionId).toBe(SUB_B)
    expect(vm.properties.networkInterfaceIds).toEqual([nic.id])
    expect(nic.properties.virtualMachineId).toBe(vm.id)
  })

  it('moving into the same group, or onto a name already there, is refused', () => {
    const { state, vnetId } = networkState()
    expectRefused(op.moveResources(state, { ids: [vnetId], targetSubscriptionId: SUB_A, targetResourceGroup: 'rg-app' }), OUTCOME.INVALID_VALUE, 'J9')
    let t = must(op.createResourceGroup(state, { subscriptionId: SUB_A, name: 'rg-network', location: 'westeurope' })).state
    t = must(op.createVirtualNetwork(t, { ...at('rg-network'), name: 'vnet-app', addressPrefixes: ['10.9.0.0/16'] })).state
    expectRefused(op.moveResources(t, { ids: [vnetId], targetSubscriptionId: SUB_A, targetResourceGroup: 'rg-network' }), OUTCOME.NAME_NOT_UNIQUE, 'K')
  })

  it('deleting a group whose resources are used from another group is not modelled', () => {
    const { state, webSubnetId } = networkState()
    let t = must(op.createResourceGroup(state, { subscriptionId: SUB_A, name: 'rg-compute', location: 'westeurope' })).state
    t = must(op.createNetworkInterface(t, { ...at('rg-compute'), name: 'nic-x', subnetId: webSubnetId })).state
    expectRefused(op.deleteResourceGroup(t, { subscriptionId: SUB_A, name: 'rg-app' }), OUTCOME.NOT_MODELLED, null)
  })
})

describe('O-1 — outcome registry', () => {
  const src = fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../operations.js'), 'utf8')
  it('every OUTCOME.X used by operations.js is registered', () => {
    const used = [...new Set([...src.matchAll(/OUTCOME\.([A-Z_]+)/g)].map(m => m[1]))]
    expect(used.filter(k => !(k in OUTCOME))).toEqual([])
    expect(used.length).toBeGreaterThan(15)
  })
  it('a real ARM error code is attached only where the spec sources one', () => {
    expect(Object.values(OUTCOMES).filter(o => o.armCode).map(o => [o.code, o.armCode]))
      .toEqual([['move_missing_dependents', 'MissingMoveDependentResources']])
  })
  it('every entry belongs to the cloud domain and is frozen', () => {
    for (const o of Object.values(OUTCOMES)) {
      expect(o.domain).toBe('cloud')
      expect(Object.isFrozen(o)).toBe(true)
    }
  })
})
