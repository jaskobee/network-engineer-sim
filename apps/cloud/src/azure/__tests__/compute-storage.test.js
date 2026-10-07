/**
 * Compute and storage — docs/cloud/AZURE_ACCURACY.md §K, §L, §M.
 *
 * CS-K1 VM host names: Windows 1–15, Linux 1–64, forbidden characters
 * CS-L1 a VM needs a NIC; an attached NIC can't be deleted
 * CS-L2 VM and NIC in the same region and subscription
 * CS-L7 Ultra Disk / Premium SSD v2 can't be OS disks; HDD OS disks warn about retirement
 * CS-L8 Ultra Disk is LRS only
 * CS-K2 storage names: 3–24 lowercase/digits, unique across Azure (incl. the simulated "taken" list)
 * CS-M1 storage kinds and their redundancy; kind can't change
 * CS-M4 public network access defaults to all networks; Disabled and Deny are accepted
 */
import { describe, it, expect } from 'vitest'
import * as op from '../operations.js'
import { OUTCOME } from '../outcomes.js'
import { TYPES } from '../model.js'
import { SUB_A, must, expectRefused, at, networkState } from './fixtures.js'

function withNic() {
  const { state, webSubnetId } = networkState()
  const r = must(op.createNetworkInterface(state, { ...at(), name: 'nic-vm1', subnetId: webSubnetId }))
  return { state: r.state, nicId: r.id }
}

const vm = (o = {}) => ({ ...at(), name: 'vm1', osType: 'Linux', size: 'Standard_B2s', osDisk: { diskType: 'PremiumSSD', sizeGiB: 64 }, ...o })

describe('CS-K1 — VM names', () => {
  const { state, nicId } = withNic()
  it('Windows host names stop at 15 characters, Linux at 64', () => {
    expectRefused(op.createVirtualMachine(state, vm({ name: 'web-server-prod1', osType: 'Windows', networkInterfaceIds: [nicId] })), OUTCOME.NAME_INVALID, 'K')
    expect(op.createVirtualMachine(state, vm({ name: 'web-server-prod', osType: 'Windows', networkInterfaceIds: [nicId] })).ok).toBe(true)
    expect(op.createVirtualMachine(state, vm({ name: 'web-server-production-linux', networkInterfaceIds: [nicId] })).ok).toBe(true)
  })
  it.each([['web_01'], ['web.01'], ['web 01'], ['web-']])('refuses "%s"', name => {
    expectRefused(op.createVirtualMachine(state, vm({ name, networkInterfaceIds: [nicId] })), OUTCOME.NAME_INVALID, 'K')
  })
})

describe('CS-L1/L2 — VMs and their NICs', () => {
  const { state, nicId } = withNic()
  it('a VM without a NIC is refused', () => {
    expectRefused(op.createVirtualMachine(state, vm()), OUTCOME.NIC_REQUIRED, 'L1')
  })
  it('the VM must share the NIC\'s region', () => {
    expectRefused(op.createVirtualMachine(state, vm({ ...at('rg-app', SUB_A, 'northeurope'), networkInterfaceIds: [nicId] })), OUTCOME.REGION_MISMATCH, 'L2')
  })
  it('attaching marks the NIC; an attached NIC can\'t be deleted; deleting the VM frees it', () => {
    const r = must(op.createVirtualMachine(state, vm({ networkInterfaceIds: [nicId] })))
    expect(r.state.resources[nicId].properties.virtualMachineId).toBe(r.id)
    expectRefused(op.deleteResource(r.state, { id: nicId }), OUTCOME.NIC_ATTACHED, 'L1')
    const gone = must(op.deleteResource(r.state, { id: r.id })).state
    expect(gone.resources[nicId].properties.virtualMachineId).toBe(null)
    expect(op.deleteResource(gone, { id: nicId }).ok).toBe(true)
  })
  it('a NIC already on a VM can\'t join a second one (not modelled, not guessed)', () => {
    const r = must(op.createVirtualMachine(state, vm({ networkInterfaceIds: [nicId] })))
    expectRefused(op.createVirtualMachine(r.state, vm({ name: 'vm2', networkInterfaceIds: [nicId] })), OUTCOME.NOT_MODELLED, null)
  })
})

describe('CS-L7/L8 — managed disks', () => {
  const { state, nicId } = withNic()
  it.each([['UltraDisk'], ['PremiumSSDv2']])('%s can\'t be the OS disk', diskType => {
    expectRefused(op.createVirtualMachine(state, vm({ networkInterfaceIds: [nicId], osDisk: { diskType } })), OUTCOME.DISK_NOT_OS_CAPABLE, 'L7')
  })
  it('a Standard HDD OS disk works but warns about the 2028 retirement', () => {
    const r = must(op.createVirtualMachine(state, vm({ networkInterfaceIds: [nicId], osDisk: { diskType: 'StandardHDD' } })))
    expect(r.warnings.map(w => w.ruleId)).toEqual(['L7'])
  })
  it('Ultra Disk works as a data disk, LRS only', () => {
    expectRefused(op.createDisk(state, { ...at(), name: 'data-ultra', diskType: 'UltraDisk', redundancy: 'ZRS', sizeGiB: 128 }), OUTCOME.INVALID_VALUE, 'L8')
    const d = must(op.createDisk(state, { ...at(), name: 'data-ultra', diskType: 'UltraDisk', sizeGiB: 128 }))
    const r = must(op.createVirtualMachine(d.state, vm({ networkInterfaceIds: [nicId], dataDiskIds: [d.id] })))
    expect(r.state.resources[d.id].properties.managedBy).toBe(r.id)
  })
  // Azure's per-type maximum sizes are not in the verified spec (L7 lists types only), so the
  // simulator's own cap is refused as not_modelled, never as an Azure rule (gate 2026-10-07).
  it('sizes above the simulator\'s cap are not modelled; a size is a whole number ≥ 1', () => {
    expectRefused(op.createDisk(state, { ...at(), name: 'big', diskType: 'PremiumSSD', sizeGiB: 32768 }), OUTCOME.NOT_MODELLED, null)
    expect(op.createDisk(state, { ...at(), name: 'big', diskType: 'PremiumSSDv2', sizeGiB: 32768 }).ok).toBe(true)
    expectRefused(op.createDisk(state, { ...at(), name: 'tiny', diskType: 'PremiumSSD', sizeGiB: 0 }), OUTCOME.INVALID_VALUE, null)
    expectRefused(op.createVirtualMachine(state, vm({ networkInterfaceIds: [nicId], osDisk: { diskType: 'PremiumSSD', sizeGiB: 40000 } })), OUTCOME.NOT_MODELLED, null)
  })
})

describe('CS-K2 — storage account names', () => {
  const { state } = networkState()
  const sa = (name, o = {}) => op.createStorageAccount(state, { ...at(), name, redundancy: 'LRS', ...o })
  it.each([['ab'], ['a'.repeat(25)], ['MyStorage'], ['my-storage'], ['my_storage']])('refuses "%s"', name => {
    expectRefused(sa(name), OUTCOME.NAME_INVALID, 'K')
  })
  it('names are unique across Azure — in this tenant and in the simulated rest of the world', () => {
    const r = must(sa('stappprod001'))
    expectRefused(op.createStorageAccount(r.state, { ...at('rg-dev', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'), name: 'stappprod001', redundancy: 'LRS' }), OUTCOME.NAME_NOT_UNIQUE, 'K2')
    expectRefused(sa('mystorageaccount'), OUTCOME.NAME_NOT_UNIQUE, 'K2')
  })
})

describe('CS-M1/M4 — storage accounts', () => {
  const { state } = networkState()
  it('premium kinds support LRS and ZRS only; GPv2 supports geo options', () => {
    expectRefused(op.createStorageAccount(state, { ...at(), name: 'stpremium001', kind: 'BlockBlobStorage', redundancy: 'GRS' }), OUTCOME.INVALID_VALUE, 'M1')
    expect(op.createStorageAccount(state, { ...at(), name: 'stpremium001', kind: 'BlockBlobStorage', redundancy: 'ZRS' }).ok).toBe(true)
    expect(op.createStorageAccount(state, { ...at(), name: 'stgeo001', redundancy: 'RA-GZRS' }).ok).toBe(true)
  })
  it('a new account accepts all networks by default and gets the standard endpoints', () => {
    const r = must(op.createStorageAccount(state, { ...at(), name: stName(), redundancy: 'ZRS' }))
    const p = r.state.resources[r.id].properties
    expect([p.publicNetworkAccess, p.networkAcls.defaultAction]).toEqual(['Enabled', 'Allow'])
    expect(p.primaryEndpoints.blob).toBe(`https://${r.state.resources[r.id].name}.blob.core.windows.net`)
  })
  it('the kind can\'t change; network access can (Disabled, or Enabled + Deny for selected networks)', () => {
    const r = must(op.createStorageAccount(state, { ...at(), name: 'stchange001', redundancy: 'LRS' }))
    expectRefused(op.updateStorageAccount(r.state, { id: r.id, kind: 'FileStorage' }), OUTCOME.IMMUTABLE, 'M1')
    const off = must(op.updateStorageAccount(r.state, { id: r.id, publicNetworkAccess: 'Disabled' })).state
    expect(off.resources[r.id].properties.publicNetworkAccess).toBe('Disabled')
    const sel = must(op.updateStorageAccount(r.state, { id: r.id, defaultAction: 'Deny' })).state
    expect(sel.resources[r.id].properties.networkAcls.defaultAction).toBe('Deny')
    expectRefused(op.updateStorageAccount(r.state, { id: r.id, publicNetworkAccess: 'SecuredByPerimeter' }), OUTCOME.NOT_MODELLED, null)
  })
  it('storage accounts are drawn outside the VNet: no network link exists yet', () => {
    const r = must(op.createStorageAccount(state, { ...at(), name: 'stalone001', redundancy: 'LRS' }))
    expect(r.state.resources[r.id].type).toBe(TYPES.STORAGE_ACCOUNT)
    expect(r.state.resources[r.id].properties.networkAcls.virtualNetworkRules).toEqual([])
  })
})

let n = 0
function stName() { return `stdefault${String(++n).padStart(3, '0')}` }
