/**
 * Interpreter tests for the declarative mission objective DSL, plus a proof
 * that the legacy adapter returns mission_001-005's existing runtime UNCHANGED.
 */
import { describe, it, expect } from 'vitest'
import { Device } from '../../models/Device.js'
import { Topology } from '../../models/Topology.js'
import { CLIEngine } from '../../models/CLIEngine.js'
import { PCCLIEngine } from '../../models/PCCLIEngine.js'
import { MISSION_TASKS } from '../../data/missionTasks.js'
import {
  evaluateObjectives, diagnoseObjectives, buildRuntimeFromDefinition, getMissionRuntime, getMissionMeta,
} from '../missionEngine.js'

function makeRouter() {
  const d = new Device({ type: 'router', model: 'R-test', portCount: 2, portPrefix: 'GigabitEthernet0/', portStart: 0 })
  d.powered = true
  return d
}
function makePc() {
  const d = new Device({ type: 'pc', model: 'PC-test', portCount: 1, portPrefix: 'Ethernet0/', portStart: 0 })
  d.powered = true
  return d
}

// A minimal declarative mission mirroring mission_001's shape (router+PC,
// same-subnet addressing, ping) — used to exercise the interpreter end-to-end.
const TEST_MISSION = {
  id: 'mission_test',
  deviceRoles: {
    router: { type: 'router', match: 'first', label: 'Router' },
    pc:     { type: 'pc',     match: 'first', label: 'PC' },
  },
  objectives: [
    { id: 'cable', label: 'Cable router to PC', condition: { type: 'cabled', roleA: 'router', roleB: 'pc' } },
    { id: 'routerIp', label: 'Configure router interface', condition: {
      type: 'interfaceConfigured', role: 'router', requires: ['ip', 'subnetMask', 'notAdminDown'] } },
    { id: 'subnet', label: 'Same subnet', condition: { type: 'sameSubnet', roleA: 'router', roleB: 'pc' } },
    { id: 'ping', label: 'Ping succeeds', condition: { type: 'pingSucceeded', roleA: 'router', roleB: 'pc' } },
    { id: 'bonus', label: 'Optional extra', optional: true, condition: { type: 'deviceExists', deviceType: 'server', count: 1 } },
  ],
}

describe('missionEngine — declarative objective interpreter', () => {
  it('evaluates cabled/interfaceConfigured/sameSubnet/pingSucceeded end-to-end against the real engine', () => {
    const topology = new Topology()
    const engine   = new CLIEngine(topology, 'beginner')
    const pcEngine = new PCCLIEngine(topology, 'beginner')
    const router = makeRouter()
    const pc     = makePc()
    topology.addDevice(router)
    topology.addDevice(pc)
    topology.connect(`${router.id}:GigabitEthernet0/0`, `${pc.id}:Ethernet0/0`)

    let checks = evaluateObjectives(TEST_MISSION, { devices: [router, pc], placements: {}, topology })
    expect(checks).toEqual({ cable: true, routerIp: false, subnet: false, ping: false, bonus: false })

    engine.execute(router, 'enable')
    engine.execute(router, 'configure terminal')
    engine.execute(router, 'interface GigabitEthernet0/0')
    engine.execute(router, 'ip address 192.168.1.1 255.255.255.0')
    engine.execute(router, 'no shutdown')

    checks = evaluateObjectives(TEST_MISSION, { devices: [router, pc], placements: {}, topology })
    expect(checks.routerIp).toBe(true)
    expect(checks.subnet).toBe(false) // PC has no IP yet

    pcEngine.execute(pc, 'ip addr add 192.168.1.10/24 dev eth0')
    pcEngine.execute(pc, 'ip link set eth0 up')

    checks = evaluateObjectives(TEST_MISSION, { devices: [router, pc], placements: {}, topology })
    expect(checks.subnet).toBe(true)
    expect(checks.ping).toBe(false)

    // logPing() is called from TerminalPane.jsx (the terminal UI) once a typed
    // `ping` visually succeeds — not from CLIEngine.execute() itself. Simulate
    // "the player already typed ping and it succeeded" directly, matching the
    // convention in mission003.test.js/mission004.test.js.
    const routerIp = router.interfaces.find(i => i.ip).ip
    topology.logPing(routerIp, '192.168.1.10')
    checks = evaluateObjectives(TEST_MISSION, { devices: [router, pc], placements: {}, topology })
    expect(checks.ping).toBe(true)
    expect(checks.bonus).toBe(false) // no server purchased — optional objective correctly unmet
  })

  it('resolves interfaceConfigured/sameSubnet/pingSucceeded correctly when roles are separated by a switch (not directly cabled)', () => {
    // Router—Switch—PC: router and PC are NOT directly cabled to each other,
    // only to the switch. Regression test for a real bug caught while
    // authoring the Local Shop mission: an earlier version of this interpreter
    // resolved "the relevant interface" by cabling-adjacency to the OTHER
    // role, which returns null the moment an L2 hop sits between them.
    const topology = new Topology()
    const engine   = new CLIEngine(topology, 'beginner')
    const pcEngine = new PCCLIEngine(topology, 'beginner')
    const router = makeRouter()
    const sw     = new Device({ type: 'switch', model: 'SW-test', portCount: 4, portPrefix: 'FastEthernet0/', portStart: 1 })
    sw.powered = true
    const pc = makePc()
    topology.addDevice(router)
    topology.addDevice(sw)
    topology.addDevice(pc)
    topology.connect(`${router.id}:GigabitEthernet0/0`, `${sw.id}:FastEthernet0/1`)
    topology.connect(`${sw.id}:FastEthernet0/2`, `${pc.id}:Ethernet0/0`)

    engine.execute(router, 'enable')
    engine.execute(router, 'configure terminal')
    engine.execute(router, 'interface GigabitEthernet0/0')
    engine.execute(router, 'ip address 10.0.10.1 255.255.255.0')
    engine.execute(router, 'no shutdown')
    pcEngine.execute(pc, 'ip addr add 10.0.10.101/24 dev eth0')
    pcEngine.execute(pc, 'ip link set eth0 up')

    const switchedMission = {
      deviceRoles: {
        router: { type: 'router', match: 'first' },
        pc:     { type: 'pc',     match: 'first' },
      },
      objectives: [
        { id: 'routerIp', condition: { type: 'interfaceConfigured', role: 'router', requires: ['ip', 'subnetMask', 'notAdminDown'] } },
        { id: 'subnet',   condition: { type: 'sameSubnet', roleA: 'router', roleB: 'pc' } },
        { id: 'ping',     condition: { type: 'pingSucceeded', roleA: 'router', roleB: 'pc' } },
      ],
    }
    const checks = evaluateObjectives(switchedMission, { devices: [router, sw, pc], placements: {}, topology })
    expect(checks.routerIp).toBe(true)
    expect(checks.subnet).toBe(true)

    topology.logPing('10.0.10.1', '10.0.10.101')
    const checks2 = evaluateObjectives(switchedMission, { devices: [router, sw, pc], placements: {}, topology })
    expect(checks2.ping).toBe(true)
  })

  it('ifaceName disambiguates a multi-homed device (e.g. a router with both a LAN and a WAN port)', () => {
    const router = makeRouter() // 2 ports: GigabitEthernet0/0 and 0/1
    router.getInterface('GigabitEthernet0/0').ip = '192.168.1.1'
    router.getInterface('GigabitEthernet0/0').subnet_mask = '255.255.255.0'
    router.getInterface('GigabitEthernet0/1').ip = '10.0.0.1'
    router.getInterface('GigabitEthernet0/1').subnet_mask = '255.255.255.252'

    const lanOnly = evaluateObjectives(
      { deviceRoles: { router: { type: 'router', match: 'first' } },
        objectives: [{ id: 'lan', condition: { type: 'interfaceConfigured', role: 'router', ifaceName: 'GigabitEthernet0/0', requires: ['ip'] } }] },
      { devices: [router], placements: {}, topology: new Topology() },
    )
    expect(lanOnly.lan).toBe(true)

    // Without ifaceName, resolution falls back to "the first interface with an
    // IP" — ambiguous by design when a device is multi-homed. Mission authors
    // of multi-homed-device missions must always pass ifaceName explicitly;
    // this just documents that the fallback picks a specific, stable choice
    // rather than crashing or returning null.
    const ambiguous = evaluateObjectives(
      { deviceRoles: { router: { type: 'router', match: 'first' } },
        objectives: [{ id: 'any', condition: { type: 'interfaceConfigured', role: 'router', requires: ['ip'] } }] },
      { devices: [router], placements: {}, topology: new Topology() },
    )
    expect(ambiguous.any).toBe(true)
  })

  it('diagnoseObjectives auto-generates a hint only for unmet objectives', () => {
    const topology = new Topology()
    const router = makeRouter()
    const pc     = makePc()
    const checks = evaluateObjectives(TEST_MISSION, { devices: [router, pc], placements: {}, topology })
    const facts  = diagnoseObjectives(TEST_MISSION, { devices: [router, pc], placements: {}, topology }, checks)
    expect(Object.keys(facts)).toEqual(['cable', 'routerIp', 'subnet', 'ping', 'bonus'])
    expect(facts.cable[0]).toMatch(/Cable Router to PC/)
  })

  it('buildRuntimeFromDefinition splits required vs optional objectives into tasks/optionalTasks', () => {
    const runtime = buildRuntimeFromDefinition(TEST_MISSION)
    expect(runtime.tasks.map(t => t.id)).toEqual(['cable', 'routerIp', 'subnet', 'ping'])
    expect(runtime.optionalTasks.map(t => t.id)).toEqual(['bonus'])
  })

  it('getMissionMeta resolves legacy missions (and unknown ids) to clientId: null, financialModel: "refund"', () => {
    for (const id of ['mission_001', 'mission_002', 'mission_003', 'mission_004', 'mission_005', 'mission_does_not_exist']) {
      expect(getMissionMeta(id)).toEqual({ clientId: null, financialModel: 'refund' })
    }
  })

  it('getMissionMeta resolves a declarative mission\'s own clientId/financialModel', () => {
    expect(getMissionMeta('mission_local_shop_1')).toEqual({ clientId: 'client_local_shop', financialModel: 'keep' })
  })

  it('getMissionRuntime returns the legacy MISSION_TASKS entry UNCHANGED for mission_001-005', () => {
    for (const id of ['mission_001', 'mission_002', 'mission_003', 'mission_004', 'mission_005']) {
      expect(getMissionRuntime(id)).toBe(MISSION_TASKS[id]) // same object reference — zero reimplementation risk
    }
  })

  it('getMissionRuntime returns null for an unknown mission id', () => {
    expect(getMissionRuntime('mission_does_not_exist')).toBeNull()
  })
})
