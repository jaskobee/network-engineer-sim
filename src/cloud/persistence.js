/**
 * Cloud save slice (roadmap §3.5, PHASE_1A step 2). The cloud section saves on its own,
 * apart from the on-prem game save (`netsim_v2`) and the career slice — the same
 * "each context persists its own slice" rule as CareerContext.
 *
 * On disk every node carries `domain: 'cloud'` and the file carries `schemaVersion`
 * (src/core/saveFormat.js); in memory the model has neither, because everything in the
 * cloud state is cloud. Storage is passed in (localStorage in the app, a stub in tests).
 */
import { SCHEMA_VERSION, schemaVersionOf } from '../core/saveFormat.js'

export const CLOUD_SAVE_KEY = 'netsim_cloud_v1'
/** Where an unreadable save is parked before a fresh tenant overwrites the main key. */
export const CLOUD_UNREADABLE_KEY = 'netsim_cloud_v1_unreadable'

const KIND = 'netsim-cloud'
const COLLECTIONS = ['managementGroups', 'subscriptions', 'resourceGroups', 'resources']

export function serializeCloud(state) {
  const tag = nodes => Object.fromEntries(Object.entries(nodes).map(([id, n]) => [id, { ...n, domain: 'cloud' }]))
  return {
    kind: KIND,
    schemaVersion: SCHEMA_VERSION,
    savedAt: new Date().toISOString(),
    tenantId: state.tenantId,
    ...Object.fromEntries(COLLECTIONS.map(c => [c, tag(state[c])])),
  }
}

/** Parsed save → { ok: true, state } or { ok: false, error } (never a half-loaded state). */
export function deserializeCloud(data) {
  if (data?.kind !== KIND) return { ok: false, error: 'This is not a NetSim cloud save.' }
  const version = schemaVersionOf(data)
  if (version > SCHEMA_VERSION)
    return { ok: false, error: `This cloud save was made by a newer NetSim (schema ${version}).` }
  if (typeof data.tenantId !== 'string' || COLLECTIONS.some(c => !data[c] || typeof data[c] !== 'object'))
    return { ok: false, error: 'The cloud save is incomplete.' }
  if (data.managementGroups[data.tenantId]?.parentId !== null)
    return { ok: false, error: 'The cloud save has no root management group.' }

  const state = { tenantId: data.tenantId }
  for (const c of COLLECTIONS) {
    state[c] = {}
    for (const [id, node] of Object.entries(data[c])) {
      if (node?.id !== id) return { ok: false, error: `The cloud save has a mismatched entry (${id}).` }
      const { domain = 'cloud', ...rest } = node
      if (domain !== 'cloud') return { ok: false, error: `The cloud save contains a "${domain}" node (${id}).` }
      state[c][id] = rest
    }
  }
  return { ok: true, state }
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

export function saveCloud(storage, state) {
  try {
    storage.setItem(CLOUD_SAVE_KEY, JSON.stringify(serializeCloud(state)))
    return true
  } catch {
    return false
  }
}
