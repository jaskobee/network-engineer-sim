/**
 * End-to-end test for mission_local_shop_1, driven against the REAL engine
 * (real deviceCatalog entries, CLIEngine, PCCLIEngine, Topology) exactly the
 * way a player's actions would populate state — same rigor as the legacy
 * mission003/004/005 test files, proving the declarative DSL handles a real
 * multi-device (router+switch+3PCs) mission correctly end to end.
 */
import { describe, it, expect } from 'vitest'
import { Device } from '../../../models/Device.js'
import { Topology } from '../../../models/Topology.js'
import { CLIEngine } from '../../../models/CLIEngine.js'
import { PCCLIEngine } from '../../../models/PCCLIEngine.js'
import { deviceCatalog } from '../../deviceCatalog.js'
import { getMissionRuntime } from '../../../engine/missionEngine.js'
import { mission_local_shop_1 } from '../mission_local_shop_1.js'

const cat = (type) => deviceCatalog.find(e => e.type === type)

describe('mission_local_shop_1 — declarative Local Shop mission, real engine', () => {
  it('is registered and reachable through getMissionRuntime', () => {
    const runtime = getMissionRuntime('mission_local_shop_1')
    expect(runtime).not.toBeNull()
    expect(runtime.tasks.map(t => t.id)).toEqual(['t1', 't2', 't3', 't4', 't5', 't6'])
    expect(runtime.optionalTasks.map(t => t.id)).toEqual(['t7'])
  })

  it('walks the full buy → place → cable → configure → verify flow, task by task', () => {
    const topology = new Topology()
    const engine   = new CLIEngine(topology, 'beginner')
    const pcEngine = new PCCLIEngine(topology, 'beginner')
    const runtime  = getMissionRuntime('mission_local_shop_1')

    // Nothing bought yet.
    let checks = runtime.checkFn([], {}, topology)
    expect(checks.t1).toBe(false)

    // ── t1: buy ──────────────────────────────────────────────────────────────
    const router = new Device(cat('router')); router.powered = true
    const sw     = new Device(cat('switch')); sw.powered     = true
    const pc1    = new Device(cat('pc'));      pc1.powered    = true
    const pc2    = new Device(cat('pc'));      pc2.powered    = true
    const pc3    = new Device(cat('pc'));      pc3.powered    = true
    for (const d of [router, sw, pc1, pc2, pc3]) topology.addDevice(d)
    const devices = [router, sw, pc1, pc2, pc3]

    checks = runtime.checkFn(devices, {}, topology)
    expect(checks).toMatchObject({ t1: true, t2: false, t3: false, t4: false, t5: false, t6: false, t7: false })

    // ── t2: place ────────────────────────────────────────────────────────────
    const placements = Object.fromEntries(devices.map((d, i) => [d.id, { x: i * 10, y: 0 }]))
    checks = runtime.checkFn(devices, placements, topology)
    expect(checks.t2).toBe(true)
    expect(checks.t3).toBe(false)

    // ── t3: cable Router–Switch, Switch–PC1/2/3 ────────────────────────────
    topology.connect(`${router.id}:GigabitEthernet0/0`, `${sw.id}:FastEthernet0/1`)
    topology.connect(`${sw.id}:FastEthernet0/2`, `${pc1.id}:Ethernet0/0`)
    topology.connect(`${sw.id}:FastEthernet0/3`, `${pc2.id}:Ethernet0/0`)
    topology.connect(`${sw.id}:FastEthernet0/4`, `${pc3.id}:Ethernet0/0`)
    checks = runtime.checkFn(devices, placements, topology)
    expect(checks.t3).toBe(true)
    expect(checks.t4).toBe(false)

    // ── t4: configure router LAN interface ─────────────────────────────────
    engine.execute(router, 'enable')
    engine.execute(router, 'configure terminal')
    engine.execute(router, 'interface GigabitEthernet0/0')
    engine.execute(router, 'ip address 10.0.10.1 255.255.255.0')
    engine.execute(router, 'no shutdown')
    checks = runtime.checkFn(devices, placements, topology)
    expect(checks.t4).toBe(true)
    expect(checks.t5).toBe(false) // PCs not addressed yet

    // ── t5: configure the 3 PCs ─────────────────────────────────────────────
    pcEngine.execute(pc1, 'ip addr add 10.0.10.101/24 dev eth0')
    pcEngine.execute(pc1, 'ip link set eth0 up')
    pcEngine.execute(pc2, 'ip addr add 10.0.10.102/24 dev eth0')
    pcEngine.execute(pc2, 'ip link set eth0 up')
    // t5 must require ALL THREE PCs — verify partial config is still false
    checks = runtime.checkFn(devices, placements, topology)
    expect(checks.t5).toBe(false)
    pcEngine.execute(pc3, 'ip addr add 10.0.10.103/24 dev eth0')
    pcEngine.execute(pc3, 'ip link set eth0 up')
    checks = runtime.checkFn(devices, placements, topology)
    expect(checks.t5).toBe(true)
    expect(checks.t6).toBe(false)

    // ── t6: router pings all 3 PCs (logPing simulates a real typed ping,
    // exactly as TerminalPane.jsx records it — see missionEngine.test.js) ──
    topology.logPing('10.0.10.1', '10.0.10.101')
    topology.logPing('10.0.10.1', '10.0.10.102')
    checks = runtime.checkFn(devices, placements, topology)
    expect(checks.t6).toBe(false) // PC-3 not pinged yet — must require all three, not just one
    topology.logPing('10.0.10.1', '10.0.10.103')
    checks = runtime.checkFn(devices, placements, topology)
    expect(checks.t6).toBe(true)

    // All REQUIRED tasks pass; optional bonus (t7) is independently unmet.
    expect(runtime.tasks.every(t => checks[t.id])).toBe(true)
    expect(checks.t7).toBe(false)

    // ── t7 (optional): PC-1 pings PC-2 directly, proving switch forwarding ──
    topology.logPing('10.0.10.101', '10.0.10.102')
    checks = runtime.checkFn(devices, placements, topology)
    expect(checks.t7).toBe(true)
  })

  it('diagnoseFn auto-generates a hint for every unmet task before any config exists', () => {
    const topology = new Topology()
    const runtime  = getMissionRuntime('mission_local_shop_1')
    const devices  = []
    const checks   = runtime.checkFn(devices, {}, topology)
    const facts    = runtime.diagnoseFn(devices, {}, topology, checks)
    expect(Object.keys(facts)).toEqual(['t1', 't2', 't3', 't4', 't5', 't6', 't7'])
  })

  it('financialModel is "keep" (persistent client — no hardware refund once wired in Phase 4)', () => {
    expect(mission_local_shop_1.financialModel).toBe('keep')
    expect(mission_local_shop_1.clientId).toBe('client_local_shop')
  })
})
