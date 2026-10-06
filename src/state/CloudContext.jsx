/**
 * CloudContext — state for the Cloud section (roadmap Phase 1a).
 *
 * Owns the cloud slice and persists it on its own (`netsim_cloud_v1`), the same way
 * CareerContext owns the career slice; it never reads or writes GameContext's save.
 *
 *   slice = { sandbox: tenant, mission: { id, tenant } | null, completedMissions: [id] }
 *
 * `cloud` is the tenant being worked on: the active mission's (a customer's environment)
 * or, with no mission running, the player's sandbox. Components change it only through
 * `apply(operation, args)` with a function from src/cloud/operations.js (ui.md rule 3).
 */
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { createCloudState } from '../cloud/model.js'
import { loadCloud, saveCloud } from '../cloud/persistence.js'
import { findCloudMission, missionProgress } from '../cloud/missions/index.js'
import { isResetting } from '../utils/resetGuard.js'

const CloudContext = createContext(null)

const emptySlice = () => ({ sandbox: createCloudState(), mission: null, completedMissions: [] })

function bootCloud() {
  const { state, notice } = loadCloud(localStorage)
  return { slice: state ?? emptySlice(), notice: notice ?? null }
}

/** The tenant in play, after `tenant` replaced it — and the mission recorded once it's complete. */
function withActiveTenant(slice, tenant) {
  if (!slice.mission) return { ...slice, sandbox: tenant }
  const next = { ...slice, mission: { ...slice.mission, tenant } }
  const def = findCloudMission(slice.mission.id)
  if (def && !slice.completedMissions.includes(def.id) && missionProgress(def, tenant).complete)
    next.completedMissions = [...slice.completedMissions, def.id]
  return next
}

export function CloudProvider({ children }) {
  const [boot] = useState(bootCloud)
  const [slice, setSlice] = useState(boot.slice)
  // Why the saved cloud couldn't be restored, if it couldn't (shown once by the UI).
  const [loadNotice, setLoadNotice] = useState(boot.notice)

  // apply() must see the result of an apply() earlier in the same event, before React
  // re-renders — so the latest slice lives in a ref as well as in React state.
  const latest = useRef(slice)
  const commit = useCallback(next => { latest.current = next; setSlice(next) }, [])

  const apply = useCallback((operation, args) => {
    const s = latest.current
    const result = operation(s.mission ? s.mission.tenant : s.sandbox, args)
    if (result.ok) commit(withActiveTenant(s, result.state))
    return result
  }, [commit])

  /** Start (or restart) a mission in a fresh copy of its customer's tenant. */
  const startMission = useCallback(id => {
    const def = findCloudMission(id)
    if (def) commit({ ...latest.current, mission: { id, tenant: def.setup() } })
  }, [commit])

  /** Leave the mission — its tenant is discarded; the sandbox is untouched. */
  const leaveMission = useCallback(() => commit({ ...latest.current, mission: null }), [commit])

  /** Start the sandbox over with an empty tenant (missions and the on-prem game are untouched). */
  const resetCloud = useCallback(() => commit({ ...latest.current, sandbox: createCloudState() }), [commit])

  // Persist on every change — the cloud slice is small JSON. Skipped while New game is
  // wiping storage (resetGuard), like every other autosave.
  useEffect(() => {
    if (isResetting()) return
    saveCloud(localStorage, slice)
  }, [slice])

  const def = slice.mission ? findCloudMission(slice.mission.id) : null
  const value = {
    cloud: slice.mission ? slice.mission.tenant : slice.sandbox,
    apply, resetCloud,
    mission: def ? { def, progress: missionProgress(def, slice.mission.tenant) } : null,
    completedMissions: slice.completedMissions,
    startMission, leaveMission,
    loadNotice, dismissLoadNotice: () => setLoadNotice(null),
  }
  return <CloudContext.Provider value={value}>{children}</CloudContext.Provider>
}

export function useCloud() {
  const ctx = useContext(CloudContext)
  if (!ctx) throw new Error('useCloud must be used inside CloudProvider')
  return ctx
}
