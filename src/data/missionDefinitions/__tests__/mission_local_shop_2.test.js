/**
 * End-to-end test for mission_local_shop_2, driven against the REAL engine,
 * continuing directly on top of mission_local_shop_1's finished topology —
 * this is the concrete proof that a client's infrastructure persists between
 * missions rather than being wiped.
 */
import { describe, it, expect } from 'vitest'
import { Device } from '../../../models/Device.js'
import { Topology } from '../../../models/Topology.js'
import { CLIEngine } from '../../../models/CLIEngine.js'
import { PCCLIEngine } from '../../../models/PCCLIEngine.js'
import { deviceCatalog } from '../../deviceCatalog.js'
import { getMissionRuntime } from '../../../engine/missionEngine.js'
import { mission_local_shop_2 } from '../mission_local_shop_2.js'

const cat = (type) => deviceCatalog.find(e => e.type === type)

// Builds mission_local_shop_1's finished state directly against the real
// engine (buy → place → cable → configure → verify), exactly what completing
// mission 1 in-game would leave behind.
function buildFinishedMission1Topology() {
  const topology = new Topology()
  const engine   = new CLIEngine(topology, 'beginner')
  const pcEngine = new PCCLIEngine(topology, 'beginner')

  const router = new Device(cat('router')); router.powered = true
  const sw     = new Device(cat('switch')); sw.powered     = true
  const pc1    = new Device(cat('pc'));      pc1.powered    = true
  const pc2    = new Device(cat('pc'));      pc2.powered    = true
  const pc3    = new Device(cat('pc'));      pc3.powered    = true
  for (const d of [router, sw, pc1, pc2, pc3]) topology.addDevice(d)

  topology.connect(`${router.id}:GigabitEthernet0/0`, `${sw.id}:FastEthernet0/1`)
  topology.connect(`${sw.id}:FastEthernet0/2`, `${pc1.id}:Ethernet0/0`)
  topology.connect(`${sw.id}:FastEthernet0/3`, `${pc2.id}:Ethernet0/0`)
  topology.connect(`${sw.id}:FastEthernet0/4`, `${pc3.id}:Ethernet0/0`)

  engine.execute(router, 'enable')
  engine.execute(router, 'configure terminal')
  engine.execute(router, 'interface GigabitEthernet0/0')
  engine.execute(router, 'ip address 10.0.10.1 255.255.255.0')
  engine.execute(router, 'no shutdown')

  pcEngine.execute(pc1, 'ip addr add 10.0.10.101/24 dev eth0')
  pcEngine.execute(pc1, 'ip link set eth0 up')
  pcEngine.execute(pc2, 'ip addr add 10.0.10.102/24 dev eth0')
  pcEngine.execute(pc2, 'ip link set eth0 up')
  pcEngine.execute(pc3, 'ip addr add 10.0.10.103/24 dev eth0')
  pcEngine.execute(pc3, 'ip link set eth0 up')

  return { topology, engine, pcEngine, router, sw, pc1, pc2, pc3 }
}

describe('mission_local_shop_2 — follow-up mission, continues on the SAME persisted topology', () => {
  it('is registered and reachable through getMissionRuntime', () => {
    const runtime = getMissionRuntime('mission_local_shop_2')
    expect(runtime).not.toBeNull()
    expect(runtime.tasks.map(t => t.id)).toEqual(['t1', 't2', 't3', 't4', 't5', 't6'])
    expect(runtime.optionalTasks.map(t => t.id)).toEqual(['t7'])
  })

  it('walks buy -> place -> cable -> configure -> verify for the two NEW devices, on top of mission 1\'s already-finished network', () => {
    const { topology, engine, pcEngine, router, sw, pc1, pc2, pc3 } = buildFinishedMission1Topology()
    const runtime = getMissionRuntime('mission_local_shop_2')

    // Sanity: mission 1's devices are still exactly as mission 1 left them —
    // nothing about them needs to change for mission 2.
    const routerIface = router.interfaces.find(i => i.ip)
    expect(routerIface.ip).toBe('10.0.10.1')
    expect(pc1.interfaces[0].ip).toBe('10.0.10.101')

    let devices = [router, sw, pc1, pc2, pc3]
    let checks = runtime.checkFn(devices, {}, topology)
    expect(checks.t1).toBe(false) // no 4th PC / server bought yet

    // ── t1: buy a PC and a Server ────────────────────────────────────────────
    const pc4    = new Device(cat('pc'));     pc4.powered    = true
    const server = new Device(cat('server')); server.powered = true
    topology.addDevice(pc4)
    topology.addDevice(server)
    devices = [router, sw, pc1, pc2, pc3, pc4, server]

    checks = runtime.checkFn(devices, {}, topology)
    expect(checks).toMatchObject({ t1: true, t2: false, t3: false, t4: false, t5: false, t6: false, t7: false })

    // ── t2: place ────────────────────────────────────────────────────────────
    const placements = { [pc4.id]: { x: 10, y: 10 }, [server.id]: { x: 30, y: 10 } }
    checks = runtime.checkFn(devices, placements, topology)
    expect(checks.t2).toBe(true)

    // ── t3: cable both into the existing switch ────────────────────────────
    topology.connect(`${sw.id}:FastEthernet0/5`, `${pc4.id}:Ethernet0/0`)
    topology.connect(`${sw.id}:FastEthernet0/6`, `${server.id}:Ethernet0/0`)
    checks = runtime.checkFn(devices, placements, topology)
    expect(checks.t3).toBe(true)
    expect(checks.t4).toBe(false)

    // ── t4/t5: configure the two new hosts ─────────────────────────────────
    pcEngine.execute(pc4, 'ip addr add 10.0.10.104/24 dev eth0')
    pcEngine.execute(pc4, 'ip link set eth0 up')
    checks = runtime.checkFn(devices, placements, topology)
    expect(checks.t4).toBe(true)
    expect(checks.t5).toBe(false) // server not addressed yet

    pcEngine.execute(server, 'ip addr add 10.0.10.50/24 dev eth0')
    pcEngine.execute(server, 'ip link set eth0 up')
    checks = runtime.checkFn(devices, placements, topology)
    expect(checks.t5).toBe(true)
    expect(checks.t6).toBe(false)

    // ── t6: router reaches both new devices ────────────────────────────────
    topology.logPing('10.0.10.1', '10.0.10.104')
    checks = runtime.checkFn(devices, placements, topology)
    expect(checks.t6).toBe(false) // server not pinged yet — must require BOTH
    topology.logPing('10.0.10.1', '10.0.10.50')
    checks = runtime.checkFn(devices, placements, topology)
    expect(checks.t6).toBe(true)
    expect(runtime.tasks.every(t => checks[t.id])).toBe(true)

    // ── t7 (optional): the ORIGINAL register PC reaches the new POS server —
    // proves the whole shop LAN, old and new, is one unified network ────────
    expect(checks.t7).toBe(false)
    topology.logPing('10.0.10.101', '10.0.10.50')
    checks = runtime.checkFn(devices, placements, topology)
    expect(checks.t7).toBe(true)
  })

  it('financialModel is "keep" and there is no new contractOutcome (mission 1\'s contract already covers this)', () => {
    expect(mission_local_shop_2.financialModel).toBe('keep')
    expect(mission_local_shop_2.contractOutcome).toBeNull()
    expect(mission_local_shop_2.clientId).toBe('client_local_shop')
  })
})
