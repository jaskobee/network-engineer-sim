/**
 * Cloud missions, played end to end through operations.js only (the same rule as dev
 * presets: drive the real engine). For each mission: the fresh tenant is incomplete, the
 * partial state is still incomplete before the last step (LESSONS: assert the partial
 * state), every trap is refused with its exact outcome + rule, and the finished state is complete.
 *
 * MS0  registry: unique ids, every objective has text + hint + check, setup is deterministic
 * MS1  Landing zone basics
 * MS2  First workload (trap: the North Europe VNet — L2; public IP must be None)
 * MS3  Storage for the app (trap: "contosostorage" taken — K2; wrong kind is immutable — M1)
 */
import { describe, it, expect } from 'vitest'
import * as op from '../../operations.js'
import { OUTCOME } from '../../outcomes.js'
import { TYPES, subnetId, resourceId } from '../../model.js'
import { CLOUD_MISSIONS, findCloudMission, missionProgress } from '../index.js'
import { SUB_CONNECTIVITY, SUB_CORP_PROD } from '../landingZone.js'
import { SUB as WORKLOAD_SUB } from '../firstWorkload.js'
import { SUB as STORAGE_SUB } from '../appStorage.js'
import { ruleSource } from '../../ruleSources.js'

function must(r) {
  if (!r.ok) throw new Error(`expected success, got ${r.outcome} (${r.ruleId}): ${r.message}`)
  return r.state
}
const progress = (id, t) => missionProgress(findCloudMission(id), t)
const done = (id, t) => progress(id, t).objectives.filter(o => o.done).map(o => o.id)

describe('MS0 — mission registry', () => {
  it('ids are unique and every objective is complete', () => {
    expect(new Set(CLOUD_MISSIONS.map(m => m.id)).size).toBe(CLOUD_MISSIONS.length)
    for (const m of CLOUD_MISSIONS) {
      expect(m.brief.length).toBeGreaterThan(0)
      for (const o of m.objectives) {
        expect(typeof o.text).toBe('string')
        expect(typeof o.hint).toBe('string')
        expect(typeof o.check).toBe('function')
      }
      for (const rule of m.learn) expect(ruleSource(rule)).not.toBe(null)
    }
  })
  it('setup is deterministic and nothing is complete at the start', () => {
    for (const m of CLOUD_MISSIONS) {
      expect(m.setup()).toEqual(m.setup())
      expect(missionProgress(m, m.setup()).doneCount).toBe(0)
    }
  })
})

describe('MS1 — Landing zone basics', () => {
  const id = 'cloud_landing_zone'
  it('subscriptions start under the root (I3)', () => {
    const t = findCloudMission(id).setup()
    expect(t.subscriptions[SUB_CORP_PROD].parentId).toBe(t.tenantId)
  })
  it('played through: partial is incomplete, the full hierarchy completes it', () => {
    let t = findCloudMission(id).setup()
    t = must(op.createManagementGroup(t, { id: 'mg-platform', displayName: 'Platform' }))
    t = must(op.createManagementGroup(t, { id: 'mg-landingzones', displayName: 'Landing zones' }))
    // Corp in the wrong place first — not counted
    t = must(op.createManagementGroup(t, { id: 'mg-corp', displayName: 'Corp' }))
    expect(done(id, t)).toEqual(['platform', 'landingzones'])
    t = must(op.moveManagementGroup(t, { id: 'mg-corp', parentId: 'mg-landingzones' }))
    t = must(op.moveSubscription(t, { id: SUB_CONNECTIVITY, parentId: 'mg-platform' }))
    expect(progress(id, t).complete).toBe(false)
    t = must(op.moveSubscription(t, { id: SUB_CORP_PROD, parentId: 'mg-corp' }))
    expect(progress(id, t).complete).toBe(true)
  })
  it('a wrong display name doesn\'t count', () => {
    let t = findCloudMission(id).setup()
    t = must(op.createManagementGroup(t, { id: 'mg-platform', displayName: 'Platfrom' }))
    expect(done(id, t)).toEqual([])
  })
})

describe('MS2 — First workload', () => {
  const id = 'cloud_first_workload'
  const at = { subscriptionId: WORKLOAD_SUB, resourceGroup: 'rg-web-prod', location: 'westeurope' }
  const vnetId = resourceId(WORKLOAD_SUB, 'rg-web-prod', TYPES.VIRTUAL_NETWORK, 'vnet-web-prod')
  const hubSubnet = subnetId(resourceId(WORKLOAD_SUB, 'rg-network-neu', TYPES.VIRTUAL_NETWORK, 'vnet-hub-neu'), 'snet-shared')
  const vmArgs = o => ({ ...at, name: 'vm-web-01', osType: 'Linux', image: 'ubuntu-24_04-lts', size: 'Standard_B2s', osDisk: { diskType: 'PremiumSSD' }, ...o })

  function network() {
    let t = findCloudMission(id).setup()
    t = must(op.createResourceGroup(t, { subscriptionId: WORKLOAD_SUB, name: 'rg-web-prod', location: 'westeurope' }))
    t = must(op.createVirtualNetwork(t, { ...at, name: 'vnet-web-prod', addressPrefixes: ['10.10.0.0/16'], subnets: [{ name: 'snet-web', addressPrefix: '10.10.1.0/24' }] }))
    t = must(op.createNetworkSecurityGroup(t, { ...at, name: 'nsg-snet-web', securityRules: [
      { name: 'Allow-HTTPS', priority: 200, direction: 'Inbound', access: 'Allow', protocol: 'TCP', destinationPorts: '443' },
    ] }))
    return t
  }

  it('trap: a West Europe VM can\'t use the North Europe hub subnet (L2)', () => {
    const r = op.deployVirtualMachine(network(), vmArgs({ subnetId: hubSubnet, publicIp: 'none' }))
    expect([r.outcome, r.ruleId]).toEqual([OUTCOME.REGION_MISMATCH, 'L2'])
  })

  it('the NSG must be associated with snet-web, not just exist', () => {
    const t = network()
    expect(done(id, t)).toEqual(['rg', 'vnet'])
    const nsgId = resourceId(WORKLOAD_SUB, 'rg-web-prod', TYPES.NETWORK_SECURITY_GROUP, 'nsg-snet-web')
    expect(done(id, must(op.associateNetworkSecurityGroup(t, { nsgId, targetId: subnetId(vnetId, 'snet-web') })))).toEqual(['rg', 'vnet', 'nsg'])
  })

  it('a VM with a public IP completes everything except "no public IP"', () => {
    let t = network()
    t = must(op.associateNetworkSecurityGroup(t, { nsgId: resourceId(WORKLOAD_SUB, 'rg-web-prod', TYPES.NETWORK_SECURITY_GROUP, 'nsg-snet-web'), targetId: subnetId(vnetId, 'snet-web') }))
    t = must(op.deployVirtualMachine(t, vmArgs({ subnetId: subnetId(vnetId, 'snet-web'), publicIp: 'new' })))
    expect(done(id, t)).toEqual(['rg', 'vnet', 'nsg', 'vm'])
    expect(progress(id, t).complete).toBe(false)
  })

  it('the right build completes it', () => {
    let t = network()
    t = must(op.associateNetworkSecurityGroup(t, { nsgId: resourceId(WORKLOAD_SUB, 'rg-web-prod', TYPES.NETWORK_SECURITY_GROUP, 'nsg-snet-web'), targetId: subnetId(vnetId, 'snet-web') }))
    t = must(op.deployVirtualMachine(t, vmArgs({ subnetId: subnetId(vnetId, 'snet-web'), publicIp: 'none' })))
    expect(progress(id, t).complete).toBe(true)
  })

  it('an HTTP-only rule doesn\'t satisfy "allow TCP 443"', () => {
    let t = findCloudMission(id).setup()
    t = must(op.createResourceGroup(t, { subscriptionId: WORKLOAD_SUB, name: 'rg-web-prod', location: 'westeurope' }))
    t = must(op.createVirtualNetwork(t, { ...at, name: 'vnet-web-prod', addressPrefixes: ['10.10.0.0/16'], subnets: [{ name: 'snet-web', addressPrefix: '10.10.1.0/24' }] }))
    const n = op.createNetworkSecurityGroup(t, { ...at, name: 'nsg-snet-web', securityRules: [
      { name: 'Allow-HTTP', priority: 200, direction: 'Inbound', access: 'Allow', protocol: 'TCP', destinationPorts: '80' },
    ] })
    t = must(op.associateNetworkSecurityGroup(n.state, { nsgId: n.id, targetId: subnetId(vnetId, 'snet-web') }))
    expect(done(id, t)).not.toContain('nsg')
  })
})

describe('MS3 — Storage for the app', () => {
  const id = 'cloud_app_storage'
  const at = { subscriptionId: STORAGE_SUB, resourceGroup: 'rg-app-prod', location: 'westeurope' }
  it('trap: "contosostorage" is taken across Azure (K2)', () => {
    const r = op.createStorageAccount(findCloudMission(id).setup(), { ...at, name: 'contosostorage', redundancy: 'LRS' })
    expect([r.outcome, r.ruleId]).toEqual([OUTCOME.NAME_NOT_UNIQUE, 'K2'])
  })
  it('a premium account can\'t be switched to general-purpose v2 afterwards (M1)', () => {
    const r = must(op.createStorageAccount(findCloudMission(id).setup(), { ...at, name: 'stinvoiceprod01', kind: 'BlockBlobStorage', redundancy: 'ZRS' }))
    const saId = resourceId(STORAGE_SUB, 'rg-app-prod', TYPES.STORAGE_ACCOUNT, 'stinvoiceprod01')
    expect(done(id, r)).toEqual(['name'])
    expect(op.updateStorageAccount(r, { id: saId, kind: 'StorageV2' })).toMatchObject({ outcome: OUTCOME.IMMUTABLE, ruleId: 'M1' })
  })
  it('GZRS (no read access to the secondary) is not enough; RA-GZRS + Disabled completes it', () => {
    let t = findCloudMission(id).setup()
    t = must(op.createStorageAccount(t, { ...at, name: 'stinvoiceprod01', redundancy: 'GZRS', publicNetworkAccess: 'Disabled' }))
    expect(done(id, t)).toEqual(['name', 'kind', 'public-access'])
    t = must(op.deleteResource(t, { id: resourceId(STORAGE_SUB, 'rg-app-prod', TYPES.STORAGE_ACCOUNT, 'stinvoiceprod01') }))
    t = must(op.createStorageAccount(t, { ...at, name: 'stinvoiceprod01', redundancy: 'RA-GZRS' }))
    expect(progress(id, t).complete).toBe(false)              // public access still enabled
    const saId = resourceId(STORAGE_SUB, 'rg-app-prod', TYPES.STORAGE_ACCOUNT, 'stinvoiceprod01')
    t = must(op.updateStorageAccount(t, { id: saId, publicNetworkAccess: 'Disabled' }))
    expect(progress(id, t).complete).toBe(true)
  })
})
