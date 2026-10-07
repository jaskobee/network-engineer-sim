/**
 * Cloud Engineer's save (roadmap §3.5, PHASE_1A steps 2 and 6). The products share one
 * origin in production, so the key carries this product's own prefix: NetSim's New game
 * sweeps `netsim*` keys and never sees this one.
 *
 * The slice is { sandbox: tenant, mission: { id, tenant } | null, completedMissions: [id] }.
 * On disk every tenant node carries `domain: 'cloud'` and the file carries `schemaVersion`
 * (packages/kernel/saveFormat.js); in memory the model has neither, because everything here is
 * cloud. Storage is passed in (localStorage in the app, a stub in tests).
 */
import { SCHEMA_VERSION, schemaVersionOf } from '@sim/kernel/saveFormat.js'
import { findCloudMission } from './missions/index.js'

export const CLOUD_SAVE_KEY = 'cloudeng_save_v1'
/** Where an unreadable save is parked before a fresh tenant overwrites the main key. */
export const CLOUD_UNREADABLE_KEY = 'cloudeng_save_v1_unreadable'

const KIND = 'cloudeng-save'
const COLLECTIONS = ['managementGroups', 'subscriptions', 'resourceGroups', 'resources']

export function serializeTenant(tenant) {
  const tag = nodes => Object.fromEntries(Object.entries(nodes).map(([id, n]) => [id, { ...n, domain: 'cloud' }]))
  return { tenantId: tenant.tenantId, ...Object.fromEntries(COLLECTIONS.map(c => [c, tag(tenant[c])])) }
}

/** Saved tenant → { ok: true, tenant } or { ok: false, error }. */
export function deserializeTenant(data) {
  if (typeof data?.tenantId !== 'string' || COLLECTIONS.some(c => !data[c] || typeof data[c] !== 'object'))
    return { ok: false, error: 'The cloud save is incomplete.' }
  if (data.managementGroups[data.tenantId]?.parentId !== null)
    return { ok: false, error: 'The cloud save has no root management group.' }
  const tenant = { tenantId: data.tenantId }
  for (const c of COLLECTIONS) {
    tenant[c] = {}
    for (const [id, node] of Object.entries(data[c])) {
      if (node?.id !== id) return { ok: false, error: `The cloud save has a mismatched entry (${id}).` }
      const { domain = 'cloud', ...rest } = node
      if (domain !== 'cloud') return { ok: false, error: `The cloud save contains a "${domain}" node (${id}).` }
      tenant[c][id] = rest
    }
  }
  return { ok: true, tenant }
}

export function serializeCloud(slice) {
  return {
    kind: KIND,
    schemaVersion: SCHEMA_VERSION,
    savedAt: new Date().toISOString(),
    sandbox: serializeTenant(slice.sandbox),
    mission: slice.mission ? { id: slice.mission.id, tenant: serializeTenant(slice.mission.tenant) } : null,
    completedMissions: [...slice.completedMissions],
  }
}

/**
 * Parsed save → { ok: true, state: slice } or { ok: false, error } — never half-loaded.
 * A mission this build doesn't know is dropped (its id stays out of the slice).
 */
export function deserializeCloud(data) {
  if (data?.kind !== KIND) return { ok: false, error: 'This is not a Cloud Engineer save.' }
  const version = schemaVersionOf(data)
  if (version > SCHEMA_VERSION)
    return { ok: false, error: `This save was made by a newer Cloud Engineer (schema ${version}).` }

  const sandbox = deserializeTenant(data.sandbox)
  if (!sandbox.ok) return sandbox
  let mission = null
  if (data.mission && findCloudMission(data.mission.id)) {
    const m = deserializeTenant(data.mission.tenant)
    if (!m.ok) return m
    mission = { id: data.mission.id, tenant: m.tenant }
  }
  const completedMissions = (Array.isArray(data.completedMissions) ? data.completedMissions : [])
    .filter(id => typeof id === 'string' && findCloudMission(id))
  return { ok: true, state: { sandbox: sandbox.tenant, mission, completedMissions } }
}

/**
 * Read the cloud slice. → { state } (null when there is nothing saved) and, when the save
 * couldn't be read, a `notice` for the player. An unreadable save is copied to
 * CLOUD_UNREADABLE_KEY first so starting fresh never destroys it.
 */
export function loadCloud(storage) {
  let raw
  try { raw = storage.getItem(CLOUD_SAVE_KEY) } catch { return { state: null } }
  if (!raw) return { state: null }
  let result
  try { result = deserializeCloud(JSON.parse(raw)) } catch { result = { ok: false, error: 'The cloud save is not valid JSON.' } }
  if (result.ok) return { state: result.state }
  try { storage.setItem(CLOUD_UNREADABLE_KEY, raw) } catch { /* nothing more we can do */ }
  return { state: null, notice: `${result.error} A copy was kept and a new tenant was started.` }
}

export function saveCloud(storage, slice) {
  try {
    storage.setItem(CLOUD_SAVE_KEY, JSON.stringify(serializeCloud(slice)))
    return true
  } catch {
    return false
  }
}
