/**
 * CareerContext — company/client/reputation/contract state for the
 * progression layer described in the mission/progression plan.
 *
 * Deliberately separate from GameContext (per the "no giant GameManager"
 * constraint): GameContext owns topology/engine/CLI plumbing (and already
 * knows how to start/complete ANY mission, legacy or client-based, via
 * acceptMission/completeMission — see getMissionMeta in engine/missionEngine.js).
 * This context owns the player's business layer on top of that: company
 * identity, reputation, and per-client relationship/contract state. It's a
 * thin state shell — actual logic lives in plain-JS modules
 * (engine/reputation.js, data/clients.js, data/contracts.js) that this
 * context calls into.
 *
 * `clients`/`contracts` are plain objects keyed by id (not Maps) so mutating
 * them via setState produces a new reference React will actually re-render on.
 *
 * Persistence: `company` keeps its own dedicated key (Phase 5).
 * `reputation`/`clients`/`contracts` share a second dedicated key rather than
 * folding into GameContext's save blob — this module owns that data, and
 * GameContext has no way to read a child context's state (CareerProvider
 * wraps AppContent *inside* GameProvider), so each context persisting its own
 * slice is simpler than threading data backward across that boundary.
 * `clientTopologies` (the actual devices/interfaces) live in GameContext and
 * are persisted there instead — this context only ever holds the business
 * records (satisfaction, growth stage, contract terms), never Topology
 * objects. All `netsim_*` keys are wiped together by GameContext's
 * newGame() reset sweep.
 */
import { createContext, useContext, useState, useEffect } from 'react'
import { createClientInstance, CLIENT_TEMPLATES } from '../data/clients.js'
import { createContract } from '../data/contracts.js'
import { scoreAfterMission, tierForScore } from '../engine/reputation.js'
import { isResetting } from '../utils/resetGuard.js'

const COMPANY_KEY = 'netsim_v1_company'
const CAREER_KEY  = 'netsim_v1_career'

function _loadCompany() {
  try {
    const raw = localStorage.getItem(COMPANY_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function _loadCareer() {
  try {
    const raw = localStorage.getItem(CAREER_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

const CareerContext = createContext(null)

export function CareerProvider({ children }) {
  const [company, setCompany] = useState(_loadCompany)
  const savedCareer = _loadCareer()
  const [reputation, setReputation] = useState(savedCareer?.reputation ?? 0)
  const [clients, setClients]     = useState(savedCareer?.clients ?? {})   // clientId -> Client
  const [contracts, setContracts] = useState(savedCareer?.contracts ?? {}) // contractId -> Contract

  // Persist reputation/clients/contracts as they change. Runs after every
  // render where one of them changed — cheap (small JSON) and simpler than
  // trying to hook this to GameContext's tick-driven autosave.
  useEffect(() => {
    if (isResetting()) return
    try { localStorage.setItem(CAREER_KEY, JSON.stringify({ reputation, clients, contracts })) }
    catch { /* ignore quota errors */ }
  }, [reputation, clients, contracts])

  // Seed the game's first client the moment a company exists but has none
  // yet — covers both "just created a company" (Phase 5's onboarding) and
  // "loaded an older company record from localStorage that predates this."
  useEffect(() => {
    if (isResetting()) return
    if (company && Object.keys(clients).length === 0) {
      const first = createClientInstance(CLIENT_TEMPLATES[0].id)
      if (first) setClients({ [first.id]: first })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [company])

  function createCompany(name, avatar = '💼') {
    const trimmed = name?.trim()
    if (!trimmed) return
    const record = { name: trimmed, avatar, foundedAt: new Date().toISOString() }
    setCompany(record)
    try { localStorage.setItem(COMPANY_KEY, JSON.stringify(record)) } catch { /* ignore quota errors */ }
  }

  /**
   * Call once, right after GameContext.completeMission() has run, for any
   * mission with a clientId. Awards reputation and advances the client's
   * completed/available-mission lists (this is what turns a mission's
   * followUpMissionIds into the client's next available job). Does NOT touch
   * contracts — that's a separate, player-initiated action (acceptContractOffer)
   * so a contract offer is a real choice, not something silently granted.
   */
  function completeClientMission(mission) {
    const { newScore, gained } = scoreAfterMission(reputation, mission)
    setReputation(newScore)

    setClients(prev => {
      const client = prev[mission.clientId]
      if (!client) return prev
      const updated = {
        ...client,
        completedMissionIds: [...client.completedMissionIds, mission.id],
        availableFutureMissionIds: [
          ...client.availableFutureMissionIds.filter(id => id !== mission.id),
          ...(mission.followUpMissionIds ?? []),
        ],
        growthStage: client.growthStage + 1,
      }
      return { ...prev, [client.id]: updated }
    })

    return { reputationGained: gained, newReputation: newScore, tierLabel: tierForScore(newScore).label }
  }

  /**
   * Player-initiated: turn a completed mission's `contractOutcome` into a
   * real, ongoing Contract tied to the client. No-op if the client already
   * has an active contract (mission_local_shop_2, for instance, has no
   * contractOutcome of its own — the mission_1 contract already covers it).
   */
  function acceptContractOffer(clientId, mission) {
    const client = clients[clientId]
    if (!client || client.currentContractId || !mission.contractOutcome) return null
    const contract = createContract({
      clientId, contractType: mission.contractOutcome.type, startedAtMissionId: mission.id,
    })
    if (!contract) return null
    setContracts(prev => ({ ...prev, [contract.id]: contract }))
    setClients(prev => ({ ...prev, [clientId]: { ...prev[clientId], currentContractId: contract.id } }))
    return contract
  }

  const value = {
    company, createCompany,
    reputation,
    clients, contracts,
    completeClientMission, acceptContractOffer,
  }

  return <CareerContext.Provider value={value}>{children}</CareerContext.Provider>
}

export function useCareer() {
  const ctx = useContext(CareerContext)
  if (!ctx) throw new Error('useCareer must be called inside <CareerProvider>')
  return ctx
}
