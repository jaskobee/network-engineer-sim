/**
 * The job board — which jobs the player can take right now, and which of them are NEW news.
 * Pure functions, no React, no I/O.
 *
 * Only AVAILABLE jobs are listed: a job whose reputation requirement is met (client jobs) or whose
 * prerequisite is done (tutorial jobs). Locked and future jobs are not shown — there will be many
 * more jobs, and a wall of greyed-out ones is noise. A job that becomes available after the game
 * has started is offered to the player: they can accept it or decline for now (it then stays on the
 * board, quietly, until they pick it up).
 */

/**
 * { clientJobs, legacyJobs, all } — available, not completed, not the one in progress.
 * `definitions` is the declarative-mission registry (id → MissionDefinition).
 */
export function getAvailableJobs({ legacyMissions, definitions, clients, completedMissions, reputation, activeMissionId }) {
  const done = new Set(completedMissions.map(c => c.id))
  const open = m => m && !done.has(m.id) && m.id !== activeMissionId

  const legacyJobs = legacyMissions.filter(m => open(m) && (m.prerequisite ? done.has(m.prerequisite) : true))

  const seen = new Set()
  const clientJobs = []
  for (const client of Object.values(clients)) {
    for (const id of client.availableFutureMissionIds ?? []) {
      const m = definitions[id]
      if (!open(m) || seen.has(id)) continue
      if ((reputation ?? 0) < (m.requiredReputation ?? 0)) continue
      seen.add(id)
      clientJobs.push(m)
    }
  }
  return { clientJobs, legacyJobs, all: [...clientJobs, ...legacyJobs] }
}

/**
 * Reconcile the record of offered jobs with what is available now.
 * offers: { [missionId]: { status: 'new' | 'declined' | 'seen' | 'accepted', offeredAt } }
 *
 * The first time this ever runs (`seeded` false) everything already available is marked 'seen' with no
 * popup — a new player's starting jobs, or an older save's whole history, are not "news". After that,
 * any newly available job becomes a 'new' offer. Returns { offers, seeded, fresh: [ids just offered] }.
 */
export function syncJobOffers(offers, seeded, availableIds, now) {
  if (!seeded) {
    const next = { ...offers }
    for (const id of availableIds) if (!next[id]) next[id] = { status: 'seen', offeredAt: now }
    return { offers: next, seeded: true, fresh: [] }
  }
  const fresh = availableIds.filter(id => !offers[id])
  if (fresh.length === 0) return { offers, seeded, fresh }
  const next = { ...offers }
  for (const id of fresh) next[id] = { status: 'new', offeredAt: now }
  return { offers: next, seeded, fresh }
}

/** Offers the player hasn't decided on yet (drives the popup and the Career badge). */
export function pendingOffers(offers, availableIds) {
  const avail = new Set(availableIds)
  return Object.entries(offers)
    .filter(([id, o]) => o.status === 'new' && avail.has(id))
    .sort((a, b) => a[1].offeredAt - b[1].offeredAt)
    .map(([id]) => id)
}
