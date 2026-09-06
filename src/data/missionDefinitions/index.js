/**
 * Registry of new-style declarative MissionDefinitions (see
 * src/engine/missionEngine.js for the objective interpreter).
 *
 * The 5 legacy missions (mission_001-005) are NOT here — they stay on
 * src/data/missionTasks.js's MISSION_TASKS, consumed verbatim via the legacy
 * adapter in missionEngine.js's getMissionRuntime().
 */
import { mission_local_shop_1 } from './mission_local_shop_1.js'
import { mission_local_shop_2 } from './mission_local_shop_2.js'

export const MISSION_DEFINITIONS = {
  mission_local_shop_1,
  mission_local_shop_2,
}
