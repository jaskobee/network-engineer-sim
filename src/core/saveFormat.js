/**
 * Save-format versioning shared by every track (docs/HYBRID_PLATFORM_ROADMAP.md §3.5).
 *
 * `schemaVersion` describes the cross-track shape of saved topology data; each saved
 * node carries a `domain` naming the plane that evaluates it. Both are new in Phase 0,
 * so a file without them is a schemaVersion 1, all-on-prem file — which is exactly what
 * every save written before this change is.
 *
 * Not to be confused with the existing `version` fields (`2` in the game save,
 * `'netsim-dev-v1'` in the dev-mode sandbox export). Those still gate what each import
 * accepts and are left untouched: changing `version` would discard every player's
 * autosave (loadFromStorage drops a mismatch).
 *
 * `domain` here is the track ('onprem' | 'cloud'), not a DNS domain name.
 */

export const SCHEMA_VERSION = 1

/** Domains a saved node may belong to. 'cloud' joined in roadmap Phase 1a (src/cloud/persistence.js). */
export const DOMAINS = Object.freeze(['onprem', 'cloud'])
export const DEFAULT_DOMAIN = 'onprem'

/** schemaVersion of a parsed save; files from before Phase 0 have none and are 1. */
export function schemaVersionOf(data) {
  return data?.schemaVersion ?? 1
}

/** Domain of a saved node; nodes from before Phase 0 have none and are on-prem. */
export function domainOf(raw) {
  return raw?.domain ?? DEFAULT_DOMAIN
}
