import { deviceFromSave, setIdCounter } from '../models/Device.js'
import { Topology } from '../models/Topology.js'

const SAVE_KEY = 'netsim_v2'
const VERSION = 2

// Full per-device snapshot — shared by the legacy topology and every client
// topology, so there's exactly one place that knows a Device's save shape.
function serializeDevice(dev) {
  return {
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
  }
}

/**
 * clientTopologies: the live Map<clientId, {topology, engine, pcEngine, winEngine}>
 * from GameContext's clientTopologiesRef (optional — omit for the legacy-only
 * export paths, e.g. sandbox tooling that never touches client missions).
 */
export function serialize(topology, placements, inventory, budget, completedMissions, activeMissionId, clientTopologies, activeClientId, activeTicket) {
  const devices = [...topology.devices.values()].map(serializeDevice)

  const savedClientTopologies = {}
  for (const [clientId, entry] of (clientTopologies ?? new Map())) {
    const clientDevices = [...entry.topology.devices.values()].map(serializeDevice)
    // Only the placement entries this client's own devices actually use —
    // placements itself stays one flat object shared by every topology.
    const clientPlacements = {}
    for (const dev of entry.topology.devices.values()) {
      if (placements[dev.id]) clientPlacements[dev.id] = placements[dev.id]
    }
    savedClientTopologies[clientId] = { devices: clientDevices, placements: clientPlacements }
  }

  return {
    version: VERSION,
    savedAt: new Date().toISOString(),
    budget,
    completedMissions,
    activeMissionId: activeMissionId ?? null,
    activeClientId: activeClientId ?? null,
    activeTicket: activeTicket ?? null,
    devices,
    placements,
    inventory,
    clientTopologies: savedClientTopologies,
  }
}

export function exportToFile(topology, placements, inventory, budget, completedMissions, activeMissionId, clientTopologies, activeClientId, activeTicket) {
  const data = serialize(topology, placements, inventory, budget, completedMissions, activeMissionId, clientTopologies, activeClientId, activeTicket)
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

/**
 * Returns { topology, clientTopologies, budget, completedMissions,
 * activeMissionId, placements, inventory }. `clientTopologies` is a
 * Map<clientId, {topology, placements}> — GameContext is responsible for
 * building fresh CLIEngine/PCCLIEngine/WindowsCLIEngine instances bound to
 * each restored topology (this module has no engine dependency). Every
 * client's saved placements are merged into the single flat `placements`
 * object returned, matching the shape GameContext keeps at runtime.
 */
export function deserialize(data) {
  const topology = new Topology()
  let maxId = 0
  for (const raw of (data.devices || [])) {
    const num = parseInt(raw.id.replace('dev-', ''), 10)
    if (num > maxId) maxId = num
    topology.addDevice(deviceFromSave(raw))
  }

  const clientTopologies = new Map()
  let mergedPlacements = { ...(data.placements ?? {}) }
  for (const [clientId, saved] of Object.entries(data.clientTopologies ?? {})) {
    const clientTopo = new Topology()
    for (const raw of (saved.devices || [])) {
      const num = parseInt(raw.id.replace('dev-', ''), 10)
      if (num > maxId) maxId = num
      clientTopo.addDevice(deviceFromSave(raw))
    }
    clientTopologies.set(clientId, { topology: clientTopo, placements: saved.placements ?? {} })
    mergedPlacements = { ...mergedPlacements, ...(saved.placements ?? {}) }
  }

  setIdCounter(maxId)
  return {
    topology,
    clientTopologies,
    budget: data.budget ?? 3000,
    completedMissions: data.completedMissions ?? [],
    activeMissionId: data.activeMissionId ?? null,
    activeClientId: data.activeClientId ?? null,
    activeTicket: data.activeTicket ?? null,
    placements: mergedPlacements,
    inventory: data.inventory ?? [],
  }
}
