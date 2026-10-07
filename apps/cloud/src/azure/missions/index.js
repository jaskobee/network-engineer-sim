/**
 * Cloud missions (PHASE_1A step 6). Each mission builds its own tenant — a customer's
 * environment, separate from the player's sandbox — and lists objectives that are pure
 * checks on that tenant. Progress is always derived, never stored.
 *
 * Mission shape: { id, title, client, summary, brief[], objectives[{ id, text, hint, check }],
 * learn[ruleIds], debrief[], setup() → tenant }.
 */
import { landingZoneMission } from './landingZone.js'
import { firstWorkloadMission } from './firstWorkload.js'
import { appStorageMission } from './appStorage.js'

export const CLOUD_MISSIONS = Object.freeze([landingZoneMission, firstWorkloadMission, appStorageMission])

export function findCloudMission(id) {
  return CLOUD_MISSIONS.find(m => m.id === id) ?? null
}

/** → { objectives: [{ id, text, hint, done }], doneCount, total, complete } */
export function missionProgress(mission, tenant) {
  const objectives = mission.objectives.map(o => ({ id: o.id, text: o.text, hint: o.hint, done: !!o.check(tenant) }))
  const doneCount = objectives.filter(o => o.done).length
  return { objectives, doneCount, total: objectives.length, complete: doneCount === objectives.length }
}
