/**
 * CloudContext — state for the Cloud section (roadmap Phase 1a, PHASE_1A step 2).
 *
 * Owns the cloud tenant and persists its own slice (`netsim_cloud_v1`), the same way
 * CareerContext owns the career slice; it never reads or writes GameContext's save.
 * Components change cloud state only through `apply(operation, args)`, where `operation`
 * is a function from src/cloud/operations.js — never by assigning fields (ui.md rule 3).
 */
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { createCloudState } from '../cloud/model.js'
import { loadCloud, saveCloud } from '../cloud/persistence.js'
import { isResetting } from '../utils/resetGuard.js'

const CloudContext = createContext(null)

function bootCloud() {
  const { state, notice } = loadCloud(localStorage)
  return { state: state ?? createCloudState(), notice: notice ?? null }
}

export function CloudProvider({ children }) {
  const [boot] = useState(bootCloud)
  const [cloud, setCloud] = useState(boot.state)
  // Why the saved tenant couldn't be restored, if it couldn't (shown once by the UI).
  const [loadNotice, setLoadNotice] = useState(boot.notice)

  // apply() must see the result of an apply() earlier in the same event, before React
  // re-renders — so the latest state lives in a ref as well as in React state.
  const latest = useRef(cloud)

  const apply = useCallback((operation, args) => {
    const result = operation(latest.current, args)
    if (result.ok) {
      latest.current = result.state
      setCloud(result.state)
    }
    return result
  }, [])

  /** Start over with an empty tenant (cloud sandbox "start over"; on-prem is untouched). */
  const resetCloud = useCallback(() => {
    const fresh = createCloudState()
    latest.current = fresh
    setCloud(fresh)
  }, [])

  // Persist on every change — the cloud slice is small JSON. Skipped while New game is
  // wiping storage (resetGuard), like every other autosave.
  useEffect(() => {
    if (isResetting()) return
    saveCloud(localStorage, cloud)
  }, [cloud])

  const value = {
    cloud, apply, resetCloud,
    loadNotice, dismissLoadNotice: () => setLoadNotice(null),
  }
  return <CloudContext.Provider value={value}>{children}</CloudContext.Provider>
}

export function useCloud() {
  const ctx = useContext(CloudContext)
  if (!ctx) throw new Error('useCloud must be used inside CloudProvider')
  return ctx
}
