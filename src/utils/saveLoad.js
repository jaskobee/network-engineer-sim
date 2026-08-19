import { deviceFromSave, setIdCounter } from '../models/Device.js'
import { Topology } from '../models/Topology.js'

const SAVE_KEY = 'netsim_v1'
const VERSION = 1

export function serialize(topology, placements, inventory, budget, completedMissions, activeMissionId) {
  const devices = []
  for (const dev of topology.devices.values()) {
    devices.push({
      id:               dev.id,
      type:             dev.type,
      model:            dev.model,
      hostname:         dev.hostname,
      config_mode:      dev.config_mode,
      active_interface: dev.active_interface,
      active_dhcp_pool: dev.active_dhcp_pool ?? null,
      active_vlan:      dev.active_vlan      ?? null,
      dns_server:       dev.dns_server       ?? null,
      powered:          dev.powered          ?? false,
      interfaces:    dev.interfaces.map(i => ({ ...i })),
      routing_table: (dev.routing_table || []).map(r => ({ ...r })),
      vlan_db:       { ...(dev.vlan_db || {}) },
      dhcp_pools:       dev.dhcp_pools       ? dev.dhcp_pools.map(p       => ({ ...p }))                                    : undefined,
      dhcp_excluded:    dev.dhcp_excluded    ? dev.dhcp_excluded.map(e    => ({ ...e }))                                    : undefined,
      dhcp_bindings:    dev.dhcp_bindings    ? dev.dhcp_bindings.map(b    => ({ ...b }))                                    : undefined,
      nat_acls:         dev.nat_acls         ? dev.nat_acls.map(a         => ({ ...a, entries: a.entries.map(e => ({ ...e })) })) : undefined,
      nat_rules:        dev.nat_rules        ? dev.nat_rules.map(r        => ({ ...r }))                                    : undefined,
      nat_translations: dev.nat_translations ? dev.nat_translations.map(t => ({ ...t }))                                    : undefined,
      fw_zones:           dev.fw_zones           ? { ...dev.fw_zones }                        : undefined,
      fw_rules:           dev.fw_rules           ? dev.fw_rules.map(r     => ({ ...r }))      : undefined,
      fw_sessions:        dev.fw_sessions        ? dev.fw_sessions.map(s  => ({ ...s }))      : undefined,
      fw_security_levels: dev.fw_security_levels ? { ...dev.fw_security_levels }               : undefined,
      fw_log:             dev.fw_log             ? dev.fw_log.map(e       => ({ ...e }))      : undefined,
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

export function exportToFile(topology, placements, inventory, budget, completedMissions, activeMissionId) {
  const data = serialize(topology, placements, inventory, budget, completedMissions, activeMissionId)
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href     = url
  a.download = `netsim-save-${new Date().toISOString().slice(0, 10)}.json`
  a.click()
  URL.revokeObjectURL(url)
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
