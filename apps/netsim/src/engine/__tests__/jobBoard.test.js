/**
 * The job board: only AVAILABLE jobs are listed, and a newly available job is an offer.
 *   J1 - locked / future jobs are not listed
 *   J2 - completed and in-progress jobs are not listed
 *   J3 - offers: the starting jobs are quiet; a job that unlocks later is news
 */
import { describe, it, expect } from 'vitest'
import { getAvailableJobs, syncJobOffers, pendingOffers } from '../jobBoard.js'
import { MISSIONS } from '../../data/missions.js'
import { MISSION_DEFINITIONS } from '../../data/missionDefinitions/index.js'
import { createClientInstance } from '../../data/clients.js'

const args = over => ({
  legacyMissions: MISSIONS, definitions: MISSION_DEFINITIONS,
  clients: { client_local_shop: createClientInstance('client_local_shop') },
  completedMissions: [], reputation: 0, activeMissionId: null, ...over,
})
const ids = jobs => jobs.map(m => m.id)

describe('J1 — only available jobs', () => {
  it('a new player sees the first tutorial job and the first client job — nothing locked', () => {
    const { legacyJobs, clientJobs, all } = getAvailableJobs(args())
    expect(ids(legacyJobs)).toEqual(['mission_001'])
    expect(ids(clientJobs)).toEqual(['mission_local_shop_1'])
    expect(all).toHaveLength(2)
  })

  it('tutorial jobs unlock one at a time as prerequisites are completed', () => {
    const done = [{ id: 'mission_001' }]
    expect(ids(getAvailableJobs(args({ completedMissions: done })).legacyJobs)).toEqual(['mission_002'])
    const done2 = [{ id: 'mission_001' }, { id: 'mission_002' }]
    expect(ids(getAvailableJobs(args({ completedMissions: done2 })).legacyJobs)).toEqual(['mission_003'])
  })

  it('a client job whose reputation requirement is not met is hidden until it is', () => {
    const client = { ...createClientInstance('client_local_shop'), availableFutureMissionIds: ['mission_local_shop_2'] }
    const need = MISSION_DEFINITIONS.mission_local_shop_2.requiredReputation ?? 0
    if (need > 0) {
      expect(ids(getAvailableJobs(args({ clients: { c: client }, reputation: need - 1 })).clientJobs)).toEqual([])
    }
    expect(ids(getAvailableJobs(args({ clients: { c: client }, reputation: need })).clientJobs)).toEqual(['mission_local_shop_2'])
  })

  it('never lists a locked tutorial job "for later"', () => {
    const shown = ids(getAvailableJobs(args()).all)
    for (const later of ['mission_002', 'mission_003', 'mission_004', 'mission_005']) expect(shown).not.toContain(later)
  })
})

describe('J2 — completed and in-progress jobs are not listed', () => {
  it('completed jobs drop off', () => {
    const r = getAvailableJobs(args({ completedMissions: [{ id: 'mission_local_shop_1' }, { id: 'mission_001' }] }))
    expect(ids(r.all)).not.toContain('mission_local_shop_1')
    expect(ids(r.all)).not.toContain('mission_001')
  })
  it('the job in progress is not offered again', () => {
    expect(ids(getAvailableJobs(args({ activeMissionId: 'mission_001' })).legacyJobs)).toEqual([])
  })
  it('a job listed under two clients appears once', () => {
    const c = createClientInstance('client_local_shop')
    const r = getAvailableJobs(args({ clients: { a: c, b: { ...c, id: 'b' } } }))
    expect(ids(r.clientJobs)).toEqual(['mission_local_shop_1'])
  })
})

describe('J3 — offers', () => {
  it('the first look is quiet: what is already available is just "seen"', () => {
    const r = syncJobOffers({}, false, ['mission_001', 'mission_local_shop_1'], 100)
    expect(r.seeded).toBe(true)
    expect(r.fresh).toEqual([])
    expect(Object.values(r.offers).every(o => o.status === 'seen')).toBe(true)
    expect(pendingOffers(r.offers, ['mission_001', 'mission_local_shop_1'])).toEqual([])
  })

  it('a job that becomes available afterwards is a new offer', () => {
    let r = syncJobOffers({}, false, ['mission_001'], 100)
    r = syncJobOffers(r.offers, r.seeded, ['mission_001', 'mission_002'], 200)
    expect(r.fresh).toEqual(['mission_002'])
    expect(r.offers.mission_002).toEqual({ status: 'new', offeredAt: 200 })
    expect(pendingOffers(r.offers, ['mission_001', 'mission_002'])).toEqual(['mission_002'])
  })

  it('an offer is made once — it is not re-offered on the next pass', () => {
    let r = syncJobOffers({}, true, ['mission_002'], 100)
    const again = syncJobOffers(r.offers, r.seeded, ['mission_002'], 999)
    expect(again.fresh).toEqual([])
    expect(again.offers.mission_002.offeredAt).toBe(100)
  })

  it('a declined offer stays available but is no longer pending', () => {
    let r = syncJobOffers({}, true, ['mission_002'], 100)
    const offers = { ...r.offers, mission_002: { ...r.offers.mission_002, status: 'declined' } }
    expect(pendingOffers(offers, ['mission_002'])).toEqual([])
  })

  it('pending offers are oldest first, and only for jobs still available', () => {
    const offers = { a: { status: 'new', offeredAt: 300 }, b: { status: 'new', offeredAt: 100 }, gone: { status: 'new', offeredAt: 50 } }
    expect(pendingOffers(offers, ['a', 'b'])).toEqual(['b', 'a'])
  })
})
