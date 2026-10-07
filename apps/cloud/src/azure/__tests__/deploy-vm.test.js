/**
 * The portal's VM wizard path — operations.deployVirtualMachine.
 *
 * D1  creates the VM with its own NIC in the chosen subnet (and a Standard public IP if asked)
 * D2  "None" public IP → the NIC has no public IP
 * D3  all or nothing: any refusal leaves the tenant exactly as it was (no stray NIC or IP)
 * D4  the VM's own name rule is reported first, not a derived NIC-name problem
 */
import { describe, it, expect } from 'vitest'
import * as op from '../operations.js'
import { OUTCOME } from '../outcomes.js'
import { TYPES } from '../model.js'
import { SUB_A, must, expectRefused, at, networkState } from './fixtures.js'

const wizard = (o = {}) => ({
  ...at(), name: 'vm-web-01', osType: 'Linux', image: 'ubuntu-24_04-lts', size: 'Standard_B2s',
  osDisk: { diskType: 'PremiumSSD', sizeGiB: 64 }, publicIp: 'new', ...o,
})

describe('D1/D2 — what the wizard deploys', () => {
  const { state, webSubnetId } = networkState()
  it('VM + NIC + Standard public IP, wired together', () => {
    const r = must(op.deployVirtualMachine(state, wizard({ subnetId: webSubnetId })))
    const vm = r.state.resources[r.id]
    const nic = r.state.resources[vm.properties.networkInterfaceIds[0]]
    const pip = r.state.resources[nic.properties.publicIpId]
    expect(vm.properties.image).toBe('ubuntu-24_04-lts')
    expect([nic.name, nic.properties.subnetId, nic.properties.virtualMachineId]).toEqual(['vm-web-01-nic', webSubnetId, vm.id])
    expect([pip.name, pip.properties.sku, pip.properties.ipConfigurationId]).toEqual(['vm-web-01-ip', 'Standard', nic.id])
  })
  it('with "None", no public IP exists at all', () => {
    const r = must(op.deployVirtualMachine(state, wizard({ subnetId: webSubnetId, publicIp: 'none' })))
    const nic = Object.values(r.state.resources).find(x => x.type === TYPES.NETWORK_INTERFACE)
    expect(nic.properties.publicIpId).toBe(null)
    expect(Object.values(r.state.resources).some(x => x.type === TYPES.PUBLIC_IP)).toBe(false)
  })
})

describe('D3 — all or nothing', () => {
  const { state, webSubnetId } = networkState()
  const before = JSON.stringify(state)
  it('a subnet in another region is refused (L2) and leaves no public IP or NIC behind', () => {
    const r = op.deployVirtualMachine(state, wizard({ ...at('rg-app', SUB_A, 'northeurope'), subnetId: webSubnetId }))
    expectRefused(r, OUTCOME.REGION_MISMATCH, 'L2')
    expect(JSON.stringify(state)).toBe(before)
  })
  it('an OS disk that can\'t be an OS disk is refused (L7) after NIC/IP were planned — still nothing deployed', () => {
    const r = op.deployVirtualMachine(state, wizard({ subnetId: webSubnetId, osDisk: { diskType: 'UltraDisk' } }))
    expectRefused(r, OUTCOME.DISK_NOT_OS_CAPABLE, 'L7')
    expect(JSON.stringify(state)).toBe(before)
  })
})

describe('D4 — the VM name is checked first', () => {
  const { state, webSubnetId } = networkState()
  it('a 16-character Windows name is a VM-name refusal', () => {
    const r = op.deployVirtualMachine(state, wizard({ subnetId: webSubnetId, osType: 'Windows', name: 'web-server-prod1' }))
    expectRefused(r, OUTCOME.NAME_INVALID, 'K')
    expect(r.message).toMatch(/Windows virtual machine name/)
  })
})
