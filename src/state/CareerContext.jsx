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
import { scoreAfterMission, tierForScore, scoreAfterTicket, scoreAfterExpiredTicket, satisfactionDelta } from '../engine/reputation.js'
import { shouldIssueNewTicket, ticketUrgency, isTicketExpired, SLA_DURATION_MS, DORMANCY_THRESHOLD } from '../engine/contractClock.js'
import { pickTicketTemplate, createTicketInstance } from '../data/serviceTickets.js'
import {
  ticketIssuedNotification, slaWarningNotification, slaExpiredNotification,
  ticketCompletedNotification, clientDormantNotification,
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

const CareerContext = createContext(null)

export function CareerProvider({ children }) {
  const [company, setCompany] = useState(_loadCompany)
  const savedCareer = _loadCareer()
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

  // Persist reputation/clients/contracts/tickets/notifications as they change.
  // Runs after every render where one of them changed — cheap (small JSON)
  // and simpler than trying to hook this to GameContext's tick-driven autosave.
  useEffect(() => {
    if (isResetting()) return
    try {
      localStorage.setItem(CAREER_KEY, JSON.stringify({ reputation, clients, contracts, activeTickets, notifications, ticketHistory }))
    } catch { /* ignore quota errors */ }
  }, [reputation, clients, contracts, activeTickets, notifications, ticketHistory])

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
  // The single orchestration entry point, called from ContractClockDriver.jsx
  // (mounted once in App.jsx, the one place with both useGame() and
  // useCareer() readily available) rather than from an internal interval
  // here — CareerContext has no way to know whether a job-board mission is
  // currently active (that's GameContext state), and a ticket's SLA clock
  // must PAUSE while one is, so a ticket can never expire through no fault of
  // the player. The caller passes that in as `activeMissionId`.
  // `contractsInput`/`ticketsInput` default to live state, but callers that
  // just mutated timestamps in the SAME synchronous pass (see
  // devFastForwardContracts below) must pass the freshly-computed values
  // directly — setContracts()/setActiveTickets() don't apply until the next
  // render, so reading the (still-stale) `contracts`/`activeTickets` closure
  // immediately afterward would evaluate against pre-fast-forward timestamps.
  // `forceCommit` guarantees contractsInput/ticketsInput get persisted even
  // when nothing "eventful" happened this pass (no threshold crossed) — the
  // changed-flags below exist to skip pointless setState calls on the real
  // ContractClockDriver's frequent no-op polling, but a caller that just
  // computed genuinely new timestamps (like a fast-forward) must not have
  // that optimization silently discard them.
  function tickContracts(activeMissionId, now, contractsInput = contracts, ticketsInput = activeTickets, forceCommit = false) {
    let nextReputation = reputation
    const nextClients   = { ...clients }
    const nextContracts = { ...contractsInput }
    const nextTickets   = { ...ticketsInput }
    const newNotifications = []
    let clientsChanged = false, contractsChanged = forceCommit, ticketsChanged = forceCommit

    for (const contract of Object.values(contractsInput)) {
      const client = nextClients[contract.clientId]
      if (!client) continue

      const openTicket = contract.openTicketId ? nextTickets[contract.openTicketId] : null

      if (openTicket) {
        // Pause the clock entirely while a job-board mission is active —
        // a ticket can never expire through no fault of the player.
        if (activeMissionId) {
          nextTickets[openTicket.id] = { ...openTicket, pausedMs: (openTicket.pausedMs ?? 0) + 15_000 }
          ticketsChanged = true
          continue
        }

        if (isTicketExpired(openTicket, now)) {
          // Force-closed, unaddressed: reputation/satisfaction penalty,
          // clear the ticket, track the miss, possibly go dormant.
          nextReputation = scoreAfterExpiredTicket(nextReputation).newScore
          const missed = (client.consecutiveMissedTickets ?? 0) + 1
          const goingDormant = missed >= DORMANCY_THRESHOLD
          nextClients[contract.clientId] = {
            ...client,
            satisfaction: Math.max(0, client.satisfaction + satisfactionDelta('expired')),
            consecutiveMissedTickets: missed,
            dormant: goingDormant,
          }
          clientsChanged = true
          nextContracts[contract.id] = { ...contract, openTicketId: null, lastTicketAt: now }
          contractsChanged = true
          delete nextTickets[openTicket.id]
          ticketsChanged = true
          newNotifications.push(slaExpiredNotification(client, openTicket, now))
          if (goingDormant) newNotifications.push(clientDormantNotification(client, now))
          continue
        }

        const urgency = ticketUrgency(openTicket, now)
        if (urgency === 'warning' && !openTicket.notifiedStages.includes('warning')) {
          nextTickets[openTicket.id] = { ...openTicket, notifiedStages: [...openTicket.notifiedStages, 'warning'] }
          ticketsChanged = true
          newNotifications.push(slaWarningNotification(client, openTicket, now))
        }
        continue
      }

      if (shouldIssueNewTicket(contract, client, now)) {
        const template = pickTicketTemplate(contract.clientId)
        if (!template) continue
        const ticket = createTicketInstance(contract.clientId, contract.id, template, now, SLA_DURATION_MS)
        nextTickets[ticket.id] = ticket
        ticketsChanged = true
        nextContracts[contract.id] = { ...contract, openTicketId: ticket.id, lastTicketAt: now }
        contractsChanged = true
        newNotifications.push(ticketIssuedNotification(client, ticket, now))
      }
    }

    if (nextReputation !== reputation) setReputation(nextReputation)
    if (clientsChanged)   setClients(nextClients)
    if (contractsChanged) setContracts(nextContracts)
    if (ticketsChanged)   setActiveTickets(nextTickets)
    if (newNotifications.length > 0) setNotifications(prev => [...newNotifications.reverse(), ...prev])
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

  /** Call once GameContext confirms every objective on the ticket passed. */
  function completeTicket(ticket, completedAtMs) {
    const { newScore, kind } = scoreAfterTicket(reputation, ticket, completedAtMs)
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
      return { ...prev, [ticket.contractId]: { ...contract, openTicketId: null, lastTicketAt: completedAtMs } }
    })
    setActiveTickets(prev => {
      const next = { ...prev }
      delete next[ticket.id]
      return next
    })
    const client = clients[ticket.clientId]
    if (client) setNotifications(prev => [ticketCompletedNotification(client, ticket, kind, completedAtMs), ...prev])
    setTicketHistory(prev => [...prev, {
      clientId: ticket.clientId, title: ticket.title, reward: ticket.reward, kind, completedAt: completedAtMs,
    }])
    return { kind, newReputation: newScore }
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
  }

  return <CareerContext.Provider value={value}>{children}</CareerContext.Provider>
}

export function useCareer() {
  const ctx = useContext(CareerContext)
  if (!ctx) throw new Error('useCareer must be called inside <CareerProvider>')
  return ctx
}
