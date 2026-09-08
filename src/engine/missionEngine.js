/**
 * Mission objective interpreter — the declarative replacement for hand-written
 * checkNNN()/diagnoseNNN() functions (see src/data/missionTasks.js).
 *
 * A MissionDefinition (src/data/missionDefinitions/) supplies `deviceRoles` (how
 * to find "the router" / "the shop PC" etc. inside a topology) and `objectives`
 * (declarative conditions to evaluate against those roles). This module never
 * touches CLIEngine/PCCLIEngine/WindowsCLIEngine/Topology/Device state directly —
 * it only reads what's already there (interfaces, placements, topology.pingLog),
 * exactly like the legacy checkNNN functions do.
 *
 * getMissionRuntime(missionId) is the single entry point consumers use. It
 * returns the exact `{tasks, checkFn, diagnoseFn}` shape ActiveJobPanel.jsx and
 * MissionPanel.jsx already consume — unchanged for the 5 legacy missions
 * (mission_001-005 stay on MISSION_TASKS, verbatim), and built from the
 * interpreter for any new declarative MissionDefinition.
 */
import { networkAddress } from '../models/ipUtils.js'
import { MISSION_TASKS } from '../data/missionTasks.js'
import { MISSION_DEFINITIONS } from '../data/missionDefinitions/index.js'

// ── Device role resolution ───────────────────────────────────────────────────

// Resolves `deviceRoles` (e.g. { router: {type:'router', match:'first'} }) into
// concrete device objects, once per evaluation, so conditions can say
// `role: 'router'` instead of re-deriving "which device is this" every time.
function resolveDeviceRoles(deviceRoles, devices) {
  const roles = {}
  const seenByType = {}
  for (const [roleName, spec] of Object.entries(deviceRoles ?? {})) {
    const candidates = devices.filter(d => d.type === spec.type)
    const index = spec.match === 'first' || spec.match == null ? 0
      : spec.match === 'second' ? 1
      : spec.match === 'third'  ? 2
      : typeof spec.match === 'number' ? spec.match
      : 0
    roles[roleName] = candidates[index] ?? null
    seenByType[spec.type] = (seenByType[spec.type] ?? 0) + 1
  }
  return roles
}

function roleLabel(mission, roleName) {
  return mission.deviceRoles?.[roleName]?.label ?? roleName
}

// Public wrapper so UI components (which need to know "which device is
// `pc2`?" to scope the per-device executed-commands checklist) can resolve
// roles without duplicating resolveDeviceRoles' matching logic.
export function resolveMissionRoles(mission, devices) {
  return resolveDeviceRoles(mission?.deviceRoles, devices)
}

// Finds the interface to check on a role's device. If `ifaceName` is given,
// match it exactly (use this whenever a device has more than one candidate
// interface — e.g. a router with both a LAN and a WAN port — the same way
// mission authors already hardcode exact interface names in hint text).
// Otherwise, use the single interface that has an IP assigned.
//
// Deliberately NOT "the interface cabled to the other role's device": that
// only holds when the two roles are directly, physically linked. The moment a
// switch sits between them (Router—Switch—PC, the dominant topology shape in
// this game), the router's LAN interface is cabled to the SWITCH, not the PC,
// so a cabling-adjacency lookup silently returns null for every PC role and
// every objective built on it would never pass. Resolving "which interface
// serves which L3 path" for real requires the same graph walk Topology.js's
// own BFS already does — reimplementing that here would risk exactly the kind
// of subtle networking bug the project's accuracy rules exist to prevent.
// `ifaceName` sidesteps that entirely: it's unambiguous and needs no walk.
function findRoleInterface(device, ifaceName) {
  if (!device) return null
  if (ifaceName) return device.getInterface(ifaceName) ?? null
  return device.interfaces.find(i => i.ip) ?? device.interfaces[0] ?? null
}

function isCabled(devA, devB) {
  if (!devA || !devB) return false
  return devA.interfaces.some(i => i.connected_to && i.connected_to.split(':')[0] === devB.id) ||
         devB.interfaces.some(i => i.connected_to && i.connected_to.split(':')[0] === devA.id)
}

// ── Condition primitives ─────────────────────────────────────────────────────

const CUSTOM_PREDICATES = {}
// Escape hatch for mission-specific logic that doesn't fit the primitives below.
// Register once (e.g. at module load in the mission's own definition file):
//   registerCustomPredicate('hasSecondRouterRoute', (ctx) => ...)
export function registerCustomPredicate(name, fn) { CUSTOM_PREDICATES[name] = fn }

function evaluateCondition(condition, ctx) {
  if (!condition) return false
  switch (condition.type) {
    case 'deviceExists': {
      const count = ctx.devices.filter(d => d.type === condition.deviceType).length
      return count >= (condition.count ?? 1)
    }
    case 'devicesPlaced':
      return condition.roles.every(r => {
        const d = ctx.roles[r]
        return !!d && !!ctx.placements[d.id]
      })
    case 'cabled':
      // Direct physical adjacency only — correct for genuinely-adjacent roles
      // (Router–Switch, Switch–PC). Do not use this between roles that are
      // related at L3 but separated by an L2 hop (e.g. Router–PC across a
      // switch) — they are not cabled to each other at all.
      return isCabled(ctx.roles[condition.roleA], ctx.roles[condition.roleB])
    case 'interfaceConfigured': {
      const device = ctx.roles[condition.role]
      const iface = findRoleInterface(device, condition.ifaceName)
      if (!iface) return false
      for (const req of condition.requires ?? []) {
        if (req === 'ip' && !iface.ip) return false
        if (req === 'subnetMask' && !iface.subnet_mask) return false
        if (req === 'notAdminDown' && iface.status === 'admin_down') return false
        if (req === 'up' && iface.status !== 'up') return false
      }
      return true
    }
    case 'sameSubnet': {
      const devA = ctx.roles[condition.roleA]
      const devB = ctx.roles[condition.roleB]
      const ifaceA = findRoleInterface(devA, condition.ifaceNameA)
      const ifaceB = findRoleInterface(devB, condition.ifaceNameB)
      if (!ifaceA?.ip || !ifaceA?.subnet_mask || !ifaceB?.ip || !ifaceB?.subnet_mask) return false
      return ifaceA.subnet_mask === ifaceB.subnet_mask &&
        networkAddress(ifaceA.ip, ifaceA.subnet_mask) === networkAddress(ifaceB.ip, ifaceB.subnet_mask)
    }
    case 'pingSucceeded': {
      const devA = ctx.roles[condition.roleA]
      const devB = ctx.roles[condition.roleB]
      const ifaceA = findRoleInterface(devA, condition.ifaceNameA)
      const ifaceB = findRoleInterface(devB, condition.ifaceNameB)
      if (!ifaceA?.ip || !ifaceB?.ip) return false
      return ctx.topology.pingLog.has(`${ifaceA.ip}:${ifaceB.ip}`) ||
             ctx.topology.pingLog.has(`${ifaceB.ip}:${ifaceA.ip}`)
    }
    case 'and':
      return condition.conditions.every(c => evaluateCondition(c, ctx))
    case 'or':
      return condition.conditions.some(c => evaluateCondition(c, ctx))
    case 'not':
      return !evaluateCondition(condition.condition, ctx)
    case 'custom': {
      const fn = CUSTOM_PREDICATES[condition.name]
      return fn ? !!fn(ctx, condition.params) : false
    }
    default:
      return false
  }
}

// ── Public evaluation API ────────────────────────────────────────────────────

export function evaluateObjectives(mission, { devices, placements, topology }) {
  const roles = resolveDeviceRoles(mission.deviceRoles, devices)
  const ctx = { devices, placements, topology, roles }
  const checks = {}
  for (const obj of mission.objectives ?? []) {
    checks[obj.id] = evaluateCondition(obj.condition, ctx)
  }
  return checks
}

// Auto-generates a beginner-mode hint straight from a failing condition's own
// shape — no per-mission hand-written diagnose function needed. Less precise
// than the legacy missions' hand-tuned diagnoseNNN text, but scales to any
// number of new missions with zero extra authoring.
function autoHintFor(mission, condition) {
  switch (condition?.type) {
    case 'deviceExists':
      return [`Buy at least ${condition.count ?? 1} ${condition.deviceType}.`]
    case 'devicesPlaced':
      return [`Place ${condition.roles.map(r => roleLabel(mission, r)).join(', ')} on the floorplan.`]
    case 'cabled':
      return [`Cable ${roleLabel(mission, condition.roleA)} to ${roleLabel(mission, condition.roleB)}.`]
    case 'interfaceConfigured': {
      const reqs = condition.requires ?? []
      const lines = [`Configure ${roleLabel(mission, condition.role)}'s interface:`]
      if (reqs.includes('ip') || reqs.includes('subnetMask')) lines.push('  assign an IP address and subnet mask')
      if (reqs.includes('notAdminDown') || reqs.includes('up')) lines.push('  bring it up (no shutdown / ip link set up)')
      return lines
    }
    case 'sameSubnet':
      return [`Check addressing: ${roleLabel(mission, condition.roleA)} and ${roleLabel(mission, condition.roleB)} must be in the same subnet.`]
    case 'pingSucceeded':
      return [`Test connectivity: ping between ${roleLabel(mission, condition.roleA)} and ${roleLabel(mission, condition.roleB)}.`]
    case 'and':
    case 'or':
      return condition.conditions.flatMap(c => autoHintFor(mission, c))
    case 'not':
      return autoHintFor(mission, condition.condition)
    default:
      return ['Check the mission objectives.']
  }
}

export function diagnoseObjectives(mission, { devices, placements, topology }, checks) {
  const facts = {}
  for (const obj of mission.objectives ?? []) {
    if (checks[obj.id]) continue
    facts[obj.id] = autoHintFor(mission, obj.condition)
  }
  return facts
}

// ── Runtime builder + legacy adapter ─────────────────────────────────────────

// Builds the {tasks, optionalTasks, checkFn, diagnoseFn} runtime for a
// declarative MissionDefinition. `checkFn`/`diagnoseFn` evaluate ALL objectives
// (required + optional) — `tasks`/`optionalTasks` just split them for display.
export function buildRuntimeFromDefinition(mission) {
  const objectives = mission.objectives ?? []
  const toTask = o => ({ id: o.id, label: o.label, hint: o.hint })
  return {
    tasks: objectives.filter(o => !o.optional).map(toTask),
    optionalTasks: objectives.filter(o => o.optional).map(toTask),
    checkFn: (devices, placements, topology) => evaluateObjectives(mission, { devices, placements, topology }),
    diagnoseFn: (devices, placements, topology, checks) =>
      diagnoseObjectives(mission, { devices, placements, topology }, checks),
  }
}

/**
 * Single entry point consumers use instead of importing MISSION_TASKS directly.
 * mission_001-005 return their existing MISSION_TASKS entry, completely
 * unchanged. Any other id is looked up in the new declarative registry.
 */
export function getMissionRuntime(missionId) {
  if (MISSION_TASKS[missionId]) return MISSION_TASKS[missionId]
  const def = MISSION_DEFINITIONS[missionId]
  return def ? buildRuntimeFromDefinition(def) : null
}

/**
 * Career-layer metadata for a mission, without building its full runtime.
 * Legacy missions (mission_001-005, or any unrecognized id) always resolve to
 * `{ clientId: null, financialModel: 'refund' }` — the exact behavior the game
 * had before persistent clients existed — so GameContext can branch on this
 * without needing to know whether a mission is legacy or declarative.
 */
export function getMissionMeta(missionId) {
  const def = MISSION_DEFINITIONS[missionId]
  if (def) return { clientId: def.clientId ?? null, financialModel: def.financialModel ?? 'refund' }
  return { clientId: null, financialModel: 'refund' }
}
