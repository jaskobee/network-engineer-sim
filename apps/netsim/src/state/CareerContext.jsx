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
import { createContext, useContext, useState, useEffect, useRef } from 'react'
import { createClientInstance, CLIENT_TEMPLATES } from '../data/clients.js'
import { createContract, setContractIdCounter } from '../data/contracts.js'
import { scoreAfterMission, tierForScore, scoreAfterTicket, satisfactionDelta } from '../engine/reputation.js'
import { tickTickets, afterTicketFixed } from '../engine/ticketEngine.js'
import { syncJobOffers as reconcileOffers } from '../engine/jobBoard.js'
import { setTicketIdCounter } from '../data/serviceTickets.js'
import {
  ticketCompletedNotification, ticketResolutionMessage, newJobNotification, setNotificationIdCounter,
} from '../data/notifications.js'
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

// Ids are counters that start from zero on every page load. Saved tickets, notifications and
// contracts already hold ids like `ticket-3` / `note-7`, so the counters must resume past them —
// otherwise a new one reuses a saved id (React key clashes, a new ticket overwriting an open one).
function _restoreIdCounters(saved) {
  const maxOf = (ids, re) => ids.reduce((m, id) => { const n = re.exec(String(id))?.[1]; return n ? Math.max(m, +n) : m }, 0)
  setTicketIdCounter(maxOf(Object.keys(saved?.activeTickets ?? {}), /^ticket-(\d+)$/))
  setNotificationIdCounter(maxOf((saved?.notifications ?? []).map(n => n.id), /^note-(\d+)$/))
  setContractIdCounter(maxOf(Object.keys(saved?.contracts ?? {}), /^contract-(\d+)$/))
}

const MAX_NOTIFICATIONS = 60           // the inbox keeps the newest; old history isn't worth the space
const TOAST_MS = 10_000

const CareerContext = createContext(null)

export function CareerProvider({ children }) {
  const [company, setCompany] = useState(_loadCompany)
  const savedCareer = _loadCareer()
  useState(() => { _restoreIdCounters(savedCareer); return null })   // once, before anything can mint an id
  const [reputation, setReputation] = useState(savedCareer?.reputation ?? 0)
  const [clients, setClients]     = useState(savedCareer?.clients ?? {})   // clientId -> Client
  const [contracts, setContracts] = useState(savedCareer?.contracts ?? {}) // contractId -> Contract
  // Background-contract SLA state (see engine/contractClock.js). Both are
  // additive to an unversioned, freely-extensible save blob — old saves
  // simply predate these fields and default to empty here.
  const [activeTickets, setActiveTickets] = useState(savedCareer?.activeTickets ?? {}) // ticketId -> Ticket
  const [notifications, setNotifications] = useState(savedCareer?.notifications ?? []) // newest first
  // Append-only record of completed contract tickets — notifications capture
  // the same events but without a dollar amount, so this is what lets the
  // Admin Laptop dashboard show real (not guessed) earnings-over-time and a
  // real "recent activity" feed that includes ticket income alongside
  // mission income. Additive to the unversioned save blob, same pattern as
  // `activeTicket`/floorplan `labels` before it.
  const [ticketHistory, setTicketHistory] = useState(savedCareer?.ticketHistory ?? [])
  // Job offers: which available jobs the player has been told about and what they did with them
  // (engine/jobBoard.js). The refs are the source of truth between renders — an effect that runs
  // twice before a re-render must not offer the same job twice — and the state mirrors them for
  // rendering and saving.
  const [jobOffers, setJobOffers] = useState(savedCareer?.jobOffers ?? {})
  const [jobOffersSeeded, setJobOffersSeeded] = useState(savedCareer?.jobOffersSeeded ?? false)
  const offersRef = useRef(jobOffers)
  const seededRef = useRef(jobOffersSeeded)
  // Transient on-screen messages (not saved): "Service restored…" and the like.
  const [toasts, setToasts] = useState([])

  // The tick below runs from a long-lived interval, so it must read the LATEST state — never the
  // state captured when the interval was created (that stale copy is what raised a ticket every tick).
  const latest = useRef(null)
  latest.current = { reputation, clients, contracts, activeTickets }
  const lastTickAtRef = useRef(null)

  // Persist reputation/clients/contracts/tickets/notifications as they change.
  // Runs after every render where one of them changed — cheap (small JSON)
  // and simpler than trying to hook this to GameContext's tick-driven autosave.
  useEffect(() => {
    if (isResetting()) return
    try {
      localStorage.setItem(CAREER_KEY, JSON.stringify({ reputation, clients, contracts, activeTickets, notifications, ticketHistory, jobOffers, jobOffersSeeded }))
    } catch { /* ignore quota errors */ }
  }, [reputation, clients, contracts, activeTickets, notifications, ticketHistory, jobOffers, jobOffersSeeded])

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

  // ── Background contract tickets (SLA-timed maintenance work) ───────────────
  //
  // The single orchestration entry point, called from ContractClockDriver.jsx (mounted once in
  // App.jsx, where both useGame() and useCareer() are available). The policy itself — when a ticket
  // may appear, the cooldown after a fix, less often while the player is busy, the SLA clock pausing,
  // the back-off reminders — is engine/ticketEngine.js, a pure function of the state passed in.
  // `activeMissionId` says whether the player is on a job-board mission (busy).
  // `contractsInput`/`ticketsInput` let devFastForwardContracts pass values it has just computed
  // (setState hasn't applied them yet); `forceCommit` saves them even if nothing "eventful" happened.
  function tickContracts(activeMissionId, now, contractsInput = null, ticketsInput = null, forceCommit = false) {
    const cur = latest.current
    const r = tickTickets(
      { reputation: cur.reputation, clients: cur.clients, contracts: contractsInput ?? cur.contracts, tickets: ticketsInput ?? cur.activeTickets },
      { now, prevTickAt: lastTickAtRef.current, busy: !!activeMissionId },
    )
    lastTickAtRef.current = now
    if (r.changed.reputation) setReputation(r.reputation)
    if (r.changed.clients)    setClients(r.clients)
    if (forceCommit || r.changed.contracts) setContracts(r.contracts)
    if (forceCommit || r.changed.tickets)   setActiveTickets(r.tickets)
    if (r.notifications.length > 0) {
      setNotifications(prev => [...r.notifications.slice().reverse(), ...prev].slice(0, MAX_NOTIFICATIONS))
    }
  }

  /** Applies a newly-issued ticket's real topology fault (GameContext already
   * did the actual mutation) — flips faultApplied so ContractClockDriver
   * doesn't try to apply it again on the next tick. */
  function markTicketFaultApplied(ticketId) {
    setActiveTickets(prev => {
      const ticket = prev[ticketId]
      if (!ticket || ticket.faultApplied) return prev
      return { ...prev, [ticketId]: { ...ticket, faultApplied: true } }
    })
  }

  /** Bookkeeping only — the actual topology switch happens in GameContext. */
  function acceptTicket(ticket) {
    setActiveTickets(prev => {
      const existing = prev[ticket.id]
      if (!existing || existing.status === 'active') return prev
      return { ...prev, [ticket.id]: { ...existing, status: 'active' } }
    })
  }

  /**
   * Call once GameContext confirms every objective on the ticket passed. Pays out reputation and
   * satisfaction, starts the client's next (randomized, cooled-down) wait, and TELLS the player:
   * a toast and an inbox message — "Cable is connected again and service is restored. Sam is
   * happy with your service. You gained 5 reputation and earned $60."
   */
  function completeTicket(ticket, completedAtMs) {
    const { newScore, kind } = scoreAfterTicket(reputation, ticket, completedAtMs)
    const gained = newScore - reputation                   // the real change (the floor at 0 can shrink a penalty)
    setReputation(newScore)
    setClients(prev => {
      const client = prev[ticket.clientId]
      if (!client) return prev
      return {
        ...prev,
        [ticket.clientId]: {
          ...client,
          satisfaction: Math.min(100, Math.max(0, client.satisfaction + satisfactionDelta(kind))),
          consecutiveMissedTickets: 0,
        },
      }
    })
    setContracts(prev => {
      const contract = prev[ticket.contractId]
      if (!contract) return prev
      return { ...prev, [ticket.contractId]: afterTicketFixed(contract, ticket, completedAtMs) }
    })
    setActiveTickets(prev => {
      const next = { ...prev }
      delete next[ticket.id]
      return next
    })
    const client = clients[ticket.clientId]
    if (client) {
      setNotifications(prev => [ticketCompletedNotification(client, ticket, kind, completedAtMs, { gained, reward: ticket.reward }), ...prev].slice(0, MAX_NOTIFICATIONS))
      const { title, body } = ticketResolutionMessage(client, ticket, kind, gained, ticket.reward)
      pushToast({ kind: kind === 'late' ? 'info' : 'success', title, body })
    }
    setTicketHistory(prev => [...prev, {
      clientId: ticket.clientId, title: ticket.title, reward: ticket.reward, kind, completedAt: completedAtMs,
    }])
    return { kind, gained, newReputation: newScore }
  }

  // ── Toasts ─────────────────────────────────────────────────────────────────
  let _toastSeq = 0
  function pushToast({ kind = 'info', title, body }) {
    const id = `toast-${Date.now()}-${++_toastSeq}`
    setToasts(prev => [...prev, { id, kind, title, body }])
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), TOAST_MS)
  }
  function dismissToast(id) { setToasts(prev => prev.filter(t => t.id !== id)) }

  // ── Job offers ─────────────────────────────────────────────────────────────
  /**
   * Called by JobOfferDriver whenever the set of available jobs may have changed. Jobs that are new
   * since the last look become offers (and one inbox message each); the very first look is silent.
   */
  function syncJobOffers(availableJobs, now = Date.now()) {
    const ids = availableJobs.map(m => m.id)
    const r = reconcileOffers(offersRef.current, seededRef.current, ids, now)
    if (r.offers !== offersRef.current) { offersRef.current = r.offers; setJobOffers(r.offers) }
    if (r.seeded !== seededRef.current) { seededRef.current = r.seeded; setJobOffersSeeded(r.seeded) }
    if (r.fresh.length > 0) {
      const notes = r.fresh.map(id => availableJobs.find(m => m.id === id)).filter(Boolean).map(m => newJobNotification(m, now))
      setNotifications(prev => [...notes.reverse(), ...prev].slice(0, MAX_NOTIFICATIONS))
    }
  }

  /** The player looked at the offer / turned it down for now: it stays on the board, no longer news. */
  function resolveJobOffer(missionId, status = 'declined') {
    const cur = offersRef.current[missionId]
    if (!cur) return
    offersRef.current = { ...offersRef.current, [missionId]: { ...cur, status } }
    setJobOffers(offersRef.current)
  }

  function markNotificationRead(id) {
    setNotifications(prev => prev.map(n => (n.id === id ? { ...n, read: true } : n)))
  }

  /**
   * DEV/QA ONLY — never fakes an outcome, only moves the clock backward and
   * immediately re-runs the real tick check against those shifted values —
   * NOT via separate setState calls (setContracts()/setActiveTickets() don't
   * apply until the next render, so a naive "shift, then call tickContracts()"
   * would evaluate against the still-stale pre-shift timestamps). Passing the
   * freshly-computed values straight into tickContracts()'s optional
   * `contractsInput`/`ticketsInput` params sidesteps that entirely. Lets a
   * human tester see a ticket issue/warn/expire in seconds instead of the
   * real 5-14 minutes.
   */
  function devFastForwardContracts(minutes, activeMissionId) {
    const ms = minutes * 60 * 1000
    const shiftedContracts = {}
    for (const [id, c] of Object.entries(contracts)) {
      shiftedContracts[id] = {
        ...c,
        lastTicketAt: c.lastTicketAt != null ? c.lastTicketAt - ms : null,
        lastTicketIssuedAt: c.lastTicketIssuedAt != null ? c.lastTicketIssuedAt - ms : null,
        ticketGapStartedAt: c.ticketGapStartedAt != null ? c.ticketGapStartedAt - ms : null,
        startedAtMs: (c.startedAtMs ?? Date.now()) - ms,
      }
    }
    const shiftedTickets = {}
    for (const [id, t] of Object.entries(activeTickets)) {
      // issuedAt/deadlineAt always shift back by the full simulated duration
      // (that many ms have elapsed since issuance, full stop). If a mission
      // was active for this stretch, ALSO add the same amount to pausedMs so
      // msRemaining/ticketUrgency's (now - issuedAt) - pausedMs nets to zero
      // for it — matching the real driver's pattern of pairing every real
      // elapsed tick with a matching pausedMs bump, just at fast-forward
      // granularity instead of 15s-per-call. (Shifting pausedMs alone, with
      // issuedAt left untouched, would silently cancel out a LATER unpaused
      // fast-forward that shifts issuedAt on its own — this keeps the two
      // consistent across any sequence of paused/unpaused fast-forwards.)
      shiftedTickets[id] = {
        ...t,
        issuedAt: t.issuedAt - ms,
        deadlineAt: t.deadlineAt - ms,
        lastAlertAt: t.lastAlertAt != null ? t.lastAlertAt - ms : t.lastAlertAt,
        pausedMs: activeMissionId ? (t.pausedMs ?? 0) + ms : (t.pausedMs ?? 0),
      }
    }
    tickContracts(activeMissionId, Date.now(), shiftedContracts, shiftedTickets, true)
  }

  const value = {
    company, createCompany,
    reputation,
    clients, contracts,
    completeClientMission, acceptContractOffer,
    activeTickets, notifications, ticketHistory,
    tickContracts, markTicketFaultApplied, acceptTicket, completeTicket, markNotificationRead,
    devFastForwardContracts,
    jobOffers, syncJobOffers, resolveJobOffer,
    toasts, pushToast, dismissToast,
  }

  return <CareerContext.Provider value={value}>{children}</CareerContext.Provider>
}

export function useCareer() {
  const ctx = useContext(CareerContext)
  if (!ctx) throw new Error('useCareer must be called inside <CareerProvider>')
  return ctx
}
