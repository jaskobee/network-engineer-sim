/**
 * Cloud save slice — PHASE_1A steps 2 and 6, roadmap §3.5.
 *
 * P1  a save carries kind, schemaVersion and domain 'cloud' on every node of every tenant
 * P2  save → load is lossless: sandbox, an active mission's tenant, completed missions
 * P3  tolerant of missing fields and of the pre-mission layout; strict about wrong ones
 * P4  an unreadable save is kept under a backup key, never silently destroyed
 * P5  the cloud slice has its own key, apart from the on-prem save and the career slice
 */
import { describe, it, expect } from 'vitest'
import * as op from '../operations.js'
import {
  serializeCloud, deserializeCloud, serializeTenant, loadCloud, saveCloud, CLOUD_SAVE_KEY, CLOUD_UNREADABLE_KEY,
} from '../persistence.js'
import { findCloudMission } from '../missions/index.js'
import { SCHEMA_VERSION, DOMAINS } from '@sim/kernel/saveFormat.js'
import { must, at, networkState } from './fixtures.js'

function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial))
  return {
    getItem: k => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => { data.set(k, String(v)) },
    data,
  }
}

function workloadTenant() {
  const { state, webSubnetId } = networkState()
  return must(op.deployVirtualMachine(state, {
    ...at(), name: 'vm1', osType: 'Linux', size: 'Standard_B2s', osDisk: { diskType: 'PremiumSSD' }, subnetId: webSubnetId,
  })).state
}

function slice() {
  const lz = findCloudMission('cloud_landing_zone')
  const missionTenant = must(op.createManagementGroup(lz.setup(), { id: 'mg-platform', displayName: 'Platform' })).state
  return { sandbox: workloadTenant(), mission: { id: lz.id, tenant: missionTenant }, completedMissions: ['cloud_app_storage'] }
}

const COLLECTIONS = ['managementGroups', 'subscriptions', 'resourceGroups', 'resources']

describe('P1 — what a cloud save contains', () => {
  it('kind, schemaVersion and domain "cloud" on every node of both tenants', () => {
    const file = serializeCloud(slice())
    expect(file.kind).toBe('netsim-cloud')
    expect(file.schemaVersion).toBe(SCHEMA_VERSION)
    expect(DOMAINS).toContain('cloud')
    for (const t of [file.sandbox, file.mission.tenant])
      for (const c of COLLECTIONS) for (const node of Object.values(t[c])) expect(node.domain).toBe('cloud')
  })
})

describe('P2 — round trip', () => {
  it('save → JSON → load gives back the same slice, and the tenants are still live models', () => {
    const s = slice()
    const back = deserializeCloud(JSON.parse(JSON.stringify(serializeCloud(s))))
    expect(back.ok).toBe(true)
    expect(back.state).toEqual(s)
    const subId = Object.keys(s.sandbox.subscriptions)[0]
    expect(op.createResourceGroup(back.state.sandbox, { subscriptionId: subId, name: 'rg-more', location: 'westeurope' }).ok).toBe(true)
  })
})

describe('P3 — tolerant of missing fields, strict about wrong ones', () => {
  const file = () => JSON.parse(JSON.stringify(serializeCloud(slice())))
  it('no schemaVersion and no domain fields → still loads', () => {
    const f = file()
    delete f.schemaVersion
    for (const t of [f.sandbox, f.mission.tenant]) for (const c of COLLECTIONS) for (const n of Object.values(t[c])) delete n.domain
    expect(deserializeCloud(f).ok).toBe(true)
  })
  it('a pre-mission save (tenant at the top level) loads as the sandbox', () => {
    const t = workloadTenant()
    const old = { kind: 'netsim-cloud', schemaVersion: 1, ...serializeTenant(t) }
    expect(deserializeCloud(old)).toEqual({ ok: true, state: { sandbox: t, mission: null, completedMissions: [] } })
  })
  it('an unknown mission is dropped, and so is its completion record', () => {
    const f = file()
    f.mission.id = 'cloud_not_a_mission'
    f.completedMissions.push('cloud_not_a_mission')
    const r = deserializeCloud(f)
    expect(r.state.mission).toBe(null)
    expect(r.state.completedMissions).toEqual(['cloud_app_storage'])
  })
  it('a node from another domain is refused', () => {
    const f = file()
    Object.values(f.sandbox.resources)[0].domain = 'onprem'
    expect(deserializeCloud(f)).toMatchObject({ ok: false })
  })
  it('a save from a newer schema is refused rather than half-read', () => {
    const f = file()
    f.schemaVersion = SCHEMA_VERSION + 1
    expect(deserializeCloud(f).error).toMatch(/newer NetSim/)
  })
  it('other JSON (e.g. an on-prem save) is not a cloud save', () => {
    expect(deserializeCloud({ version: 2, devices: [] }).ok).toBe(false)
  })
})

describe('P4 — storage', () => {
  it('nothing saved → no state, no notice', () => {
    expect(loadCloud(memoryStorage())).toEqual({ state: null })
  })
  it('saveCloud then loadCloud restores the slice under the cloud key', () => {
    const s = memoryStorage()
    const sl = slice()
    expect(saveCloud(s, sl)).toBe(true)
    expect([...s.data.keys()]).toEqual([CLOUD_SAVE_KEY])
    expect(loadCloud(s).state).toEqual(sl)
  })
  it('an unreadable save is copied to the backup key and reported', () => {
    const s = memoryStorage({ [CLOUD_SAVE_KEY]: '{not json' })
    const r = loadCloud(s)
    expect(r.state).toBe(null)
    expect(r.notice).toMatch(/copy was kept/)
    expect(s.getItem(CLOUD_UNREADABLE_KEY)).toBe('{not json')
  })
})

describe('P5 — its own slice', () => {
  it('the cloud key differs from the on-prem save and the career keys', () => {
    expect(CLOUD_SAVE_KEY).toBe('netsim_cloud_v1')
    expect(['netsim_v2', 'netsim_v1_company', 'netsim_v1_career']).not.toContain(CLOUD_SAVE_KEY)
  })
})
