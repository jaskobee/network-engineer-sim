import { deviceFromSave, setIdCounter } from '../models/Device.js'
import { Topology } from '../models/Topology.js'

const SAVE_KEY = 'netsim_v1'
const VERSION = 1

export function serialize(topology, placements, inventory, budget, completedMissions, activeMissionId) {
  const devices = []
  for (const dev of topology.devices.values()) {
    devices.push({
      id: dev.id,
      type: dev.type,
      model: dev.model,
      hostname: dev.hostname,
      config_mode: dev.config_mode,
      active_interface: dev.active_interface,
      powered: dev.powered ?? false,
      interfaces: dev.interfaces.map(i => ({ ...i })),
      routing_table: dev.routing_table.map(r => ({ ...r })),
      vlan_db: { ...dev.vlan_db },
    })
  }
  return {
    version: VERSION,
    savedAt: new Date().toISOString(),
    budget,
    completedMissions,
    activeMissionId: activeMissionId ?? null,
    devices,
    placements,
    inventory,
  }
}

export function saveToStorage(data) {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(data)); return true }
  catch { return false }
}

export function loadFromStorage() {
  try {
    const raw = localStorage.getItem(SAVE_KEY)
    if (!raw) return null
    const data = JSON.parse(raw)
    return data?.version === VERSION ? data : null
  } catch { return null }
}

export function hasSave() { return !!localStorage.getItem(SAVE_KEY) }

export function deleteSave() { localStorage.removeItem(SAVE_KEY) }

export function deserialize(data) {
  const topology = new Topology()
  let maxId = 0
  for (const raw of (data.devices || [])) {
    const num = parseInt(raw.id.replace('dev-', ''), 10)
    if (num > maxId) maxId = num
    topology.addDevice(deviceFromSave(raw))
  }
  setIdCounter(maxId)
  return {
    topology,
    budget: data.budget ?? 3000,
    completedMissions: data.completedMissions ?? [],
    activeMissionId: data.activeMissionId ?? null,
    placements: data.placements ?? {},
    inventory: data.inventory ?? [],
  }
}
