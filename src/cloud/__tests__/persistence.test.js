/**
 * Cloud save slice — PHASE_1A step 2, roadmap §3.5.
 *
 * P1  a save carries kind, schemaVersion and domain 'cloud' on every node
 * P2  save → load is lossless (a whole workload, references intact)
 * P3  a file without schemaVersion / domain still loads; a foreign domain or a newer schema is refused
 * P4  an unreadable save is kept under a backup key, never silently destroyed
 * P5  the cloud slice has its own key, apart from the on-prem save and the career slice
 */
import { describe, it, expect } from 'vitest'
import * as op from '../operations.js'
import {
  serializeCloud, deserializeCloud, loadCloud, saveCloud, CLOUD_SAVE_KEY, CLOUD_UNREADABLE_KEY,
} from '../persistence.js'
import { SCHEMA_VERSION, DOMAINS } from '../../core/saveFormat.js'
import { must, at, networkState } from './fixtures.js'

function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial))
  return {
    getItem: k => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => { data.set(k, String(v)) },
    data,
  }
}

function workloadState() {
  const { state, webSubnetId } = networkState()
  const nic = must(op.createNetworkInterface(state, { ...at(), name: 'nic-vm1', subnetId: webSubnetId }))
  return must(op.createVirtualMachine(nic.state, {
    ...at(), name: 'vm1', osType: 'Linux', size: 'Standard_B2s',
    osDisk: { diskType: 'PremiumSSD' }, networkInterfaceIds: [nic.id],
  })).state
}

describe('P1 — what a cloud save contains', () => {
  it('kind, schemaVersion and domain "cloud" on every node', () => {
    const file = serializeCloud(workloadState())
    expect(file.kind).toBe('netsim-cloud')
    expect(file.schemaVersion).toBe(SCHEMA_VERSION)
    expect(DOMAINS).toContain('cloud')
    for (const c of ['managementGroups', 'subscriptions', 'resourceGroups', 'resources'])
      for (const node of Object.values(file[c])) expect(node.domain).toBe('cloud')
  })
})

describe('P2 — round trip', () => {
  it('save → JSON → load gives back the same state, references intact', () => {
    const state = workloadState()
    const back = deserializeCloud(JSON.parse(JSON.stringify(serializeCloud(state))))
    expect(back.ok).toBe(true)
    expect(back.state).toEqual(state)
    // and it is still a live model: operations keep working on the loaded state
    expect(op.createResourceGroup(back.state, { subscriptionId: Object.keys(state.subscriptions)[0], name: 'rg-more', location: 'westeurope' }).ok).toBe(true)
  })
})

describe('P3 — tolerant of missing fields, strict about wrong ones', () => {
  const file = () => JSON.parse(JSON.stringify(serializeCloud(workloadState())))
  it('no schemaVersion and no domain fields → still loads as a cloud tenant', () => {
    const f = file()
    delete f.schemaVersion
    for (const c of ['managementGroups', 'subscriptions', 'resourceGroups', 'resources'])
      for (const n of Object.values(f[c])) delete n.domain
    expect(deserializeCloud(f).ok).toBe(true)
  })
  it('a node from another domain is refused', () => {
    const f = file()
    Object.values(f.resources)[0].domain = 'onprem'
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
  it('saveCloud then loadCloud restores the tenant under the cloud key', () => {
    const s = memoryStorage()
    const state = workloadState()
    expect(saveCloud(s, state)).toBe(true)
    expect([...s.data.keys()]).toEqual([CLOUD_SAVE_KEY])
    expect(loadCloud(s).state).toEqual(state)
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
