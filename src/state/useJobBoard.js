import { useMemo } from 'react'
import { useGame } from './GameContext.jsx'
import { useCareer } from './CareerContext.jsx'
import { MISSIONS } from '../data/missions.js'
import { MISSION_DEFINITIONS } from '../data/missionDefinitions/index.js'
import { getAvailableJobs, pendingOffers } from '../engine/jobBoard.js'

/**
 * What the player can take on right now (engine/jobBoard.js) plus which of those are news they haven't
 * answered yet. The one place the two contexts are combined for this, so the Career list, the offer
 * popup and the Career icon's badge can never disagree.
 */
export function useJobBoard() {
  const { completedMissions, activeMissionId } = useGame()
  const { clients, reputation, jobOffers } = useCareer()
  const board = useMemo(
    () => getAvailableJobs({ legacyMissions: MISSIONS, definitions: MISSION_DEFINITIONS, clients, completedMissions, reputation, activeMissionId }),
    [clients, completedMissions, reputation, activeMissionId],
  )
  const availableIds = board.all.map(m => m.id)
  const pendingIds = pendingOffers(jobOffers, availableIds)
  return { ...board, availableIds, pendingIds, jobOffers }
}
