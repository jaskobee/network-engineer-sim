/**
 * Mission 003 — Dr. Patel's Clinic
 *
 * Engine tests: checkPing behaves correctly for the two-router / static-route topology.
 * Task-logic tests: check003() checkFn reflects real task state.
 *
 * Topology (matches the mission's addressing plan):
 *   PC-Reception ↔ R1 Gi0/0 (192.168.1.1/24)
 *   R1 Gi0/1 ↔ R2 Gi0/1 (10.0.0.x/30 WAN)
 *   R2 Gi0/0 ↔ Switch Gi0/1 (192.168.2.1/24 Clinical LAN)
 *   Switch Gi0/2 ↔ PC-Clinical
 *   Switch Gi0/3 ↔ Records Server
 *
 * Both PC-Clinical (192.168.2.10) and Records Server (192.168.2.20) are on the
 * Clinical LAN switch, sharing R2's Gi0/0 subnet (192.168.2.0/24).
 */
import { describe, it, expect } from 'vitest'
import { Device } from '../Device.js'
import { Topology } from '../Topology.js'
import { CLIEngine } from '../CLIEngine.js'
import { PCCLIEngine } from '../PCCLIEngine.js'
import { MISSION_TASKS } from '../../data/missionTasks.js'

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeRouter() {
  const d = new Device({ type: 'router', model: 'R-test', portCount: 4, portPrefix: 'GigabitEthernet0/', portStart: 0 })
  d.powered = true
  return d
}

function makePc() {
  const d = new Device({ type: 'pc', model: 'PC-test', portCount: 1, portPrefix: 'Ethernet0/', portStart: 0 })
  d.powered = true
  return d
}

function makeServer() {
  const d = new Device({ type: 'server', model: 'SRV-test', portCount: 2, portPrefix: 'Ethernet0/', portStart: 0 })
  d.powered = true
  return d
}

function makeSwitch() {
  const d = new Device({ type: 'switch', model: 'SW-test', portCount: 8, portPrefix: 'GigabitEthernet0/', portStart: 1 })
  d.powered = true
  return d
}

function ios(eng, device, ...cmds) {
  for (const cmd of cmds) eng.execute(device, cmd)
}

function lx(eng, device, ...cmds) {
  for (const cmd of cmds) eng.execute(device, cmd)
}

function wire(topo, d1, if1, d2, if2) {
  return topo.connect(`${d1.id}:${if1}`, `${d2.id}:${if2}`)
}

/**
 * Build a fully-working Mission 003 topology.
 * Clinical side uses a switch so both PC-Clinical and Server share 192.168.2.0/24.
 */
function buildM003Topo({ omitR1Route = false, omitR2Route = false } = {}) {
  const topo   = new Topology()
  const iosEng = new CLIEngine(topo)
  const lxEng  = new PCCLIEngine(topo)

  const r1     = makeRouter()
  const r2     = makeRouter()
  const sw     = makeSwitch()
  const pcRx   = makePc()
  const pcClin = makePc()
  const srv    = makeServer()

  ;[r1, r2, sw, pcRx, pcClin, srv].forEach(d => topo.addDevice(d))

  // Cabling
  wire(topo, pcRx,   'Ethernet0/0',        r1, 'GigabitEthernet0/0')   // PC-Reception ↔ R1 LAN
  wire(topo, r1,     'GigabitEthernet0/1',  r2, 'GigabitEthernet0/1')   // R1 ↔ R2 (WAN)
  wire(topo, r2,     'GigabitEthernet0/0',  sw, 'GigabitEthernet0/1')   // R2 LAN ↔ Switch
  wire(topo, pcClin, 'Ethernet0/0',         sw, 'GigabitEthernet0/2')   // PC-Clinical ↔ Switch
  wire(topo, srv,    'Ethernet0/0',          sw, 'GigabitEthernet0/3')   // Server ↔ Switch

  // Configure R1
  ios(iosEng, r1,
    'enable', 'configure terminal',
    'interface GigabitEthernet0/0', 'ip address 192.168.1.1 255.255.255.0', 'no shutdown', 'exit',
    'interface GigabitEthernet0/1', 'ip address 10.0.0.1 255.255.255.252', 'no shutdown', 'exit',
  )
  if (!omitR1Route) ios(iosEng, r1, 'ip route 192.168.2.0 255.255.255.0 10.0.0.2')
  ios(iosEng, r1, 'end')

  // Configure R2
  ios(iosEng, r2,
    'enable', 'configure terminal',
    'interface GigabitEthernet0/1', 'ip address 10.0.0.2 255.255.255.252', 'no shutdown', 'exit',
    'interface GigabitEthernet0/0', 'ip address 192.168.2.1 255.255.255.0', 'no shutdown', 'exit',
  )
  if (!omitR2Route) ios(iosEng, r2, 'ip route 192.168.1.0 255.255.255.0 10.0.0.1')
  ios(iosEng, r2, 'end')

  // Configure PC-Reception
  lx(lxEng, pcRx,
    'ip addr add 192.168.1.10/24 dev eth0',
    'ip link set eth0 up',
    'ip route add default via 192.168.1.1',
  )

  // Configure PC-Clinical
  lx(lxEng, pcClin,
    'ip addr add 192.168.2.10/24 dev eth0',
    'ip link set eth0 up',
    'ip route add default via 192.168.2.1',
  )

  // Configure Records Server
  lx(lxEng, srv,
    'ip addr add 192.168.2.20/24 dev eth0',
    'ip link set eth0 up',
    'ip route add default via 192.168.2.1',
  )

  return { topo, r1, r2, sw, pcRx, pcClin, srv, iosEng, lxEng }
}

// ── Engine tests ───────────────────────────────────────────────────────────────

describe('M003 engine — solved topology (both routes)', () => {
  it('PC-Reception → PC-Clinical is reachable', () => {
    const { topo } = buildM003Topo()
    expect(topo.checkPing('192.168.1.10', '192.168.2.10').reachable).toBe(true)
  })

  it('PC-Reception → Records Server is reachable', () => {
    const { topo } = buildM003Topo()
    expect(topo.checkPing('192.168.1.10', '192.168.2.20').reachable).toBe(true)
  })

  it('ping is symmetric — Clinical → Reception also works', () => {
    const { topo } = buildM003Topo()
    expect(topo.checkPing('192.168.2.10', '192.168.1.10').reachable).toBe(true)
  })

  it('Server → PC-Reception is also reachable (full bidirectional)', () => {
    const { topo } = buildM003Topo()
    expect(topo.checkPing('192.168.2.20', '192.168.1.10').reachable).toBe(true)
  })
})

describe('M003 engine — missing return route (the lesson)', () => {
  it('omitting R2 return route → no_return_path', () => {
    const { topo } = buildM003Topo({ omitR2Route: true })
    const result = topo.checkPing('192.168.1.10', '192.168.2.10')
    expect(result.reachable).toBe(false)
    expect(result.failureReason).toBe('no_return_path')
  })

  it('omitting R1 forward route → ping fails', () => {
    const { topo } = buildM003Topo({ omitR1Route: true })
    const result = topo.checkPing('192.168.1.10', '192.168.2.10')
    expect(result.reachable).toBe(false)
    expect(['no_route', 'no_return_path']).toContain(result.failureReason)
  })

  it('omitting both routes → ping fails', () => {
    const { topo } = buildM003Topo({ omitR1Route: true, omitR2Route: true })
    expect(topo.checkPing('192.168.1.10', '192.168.2.10').reachable).toBe(false)
  })
})

describe('M003 engine — host misconfiguration', () => {
  it('no default gateway on PC-Reception → cross-subnet ping fails', () => {
    const { topo, pcRx, lxEng } = buildM003Topo()
    lx(lxEng, pcRx, 'ip route del default')
    expect(topo.checkPing('192.168.1.10', '192.168.2.10').reachable).toBe(false)
  })
})

// ── Task-logic (check003 checkFn) tests ───────────────────────────────────────

describe('M003 check003 — fully solved topology', () => {
  it('all 9 tasks pass when topology is complete and pings logged', () => {
    const { topo, r1, r2, sw, pcRx, pcClin, srv } = buildM003Topo()

    topo.logPing('192.168.1.10', '192.168.2.10')
    topo.logPing('192.168.1.10', '192.168.2.20')

    const allDevs    = [r1, r2, sw, pcRx, pcClin, srv]
    const placements = Object.fromEntries(allDevs.map(d => [d.id, true]))
    const checks     = MISSION_TASKS.mission_003.checkFn(allDevs, placements, topo)

    expect(checks).toEqual({
      t1: true, t2: true, t3: true, t4: true, t5: true,
      t6: true, t7: true, t8: true, t9: true,
    })
  })
})

describe('M003 check003 — partial configurations', () => {
  it('t7 passes, t8 fails, t9 fails when only R1 has a route', () => {
    const { topo, r1, r2, sw, pcRx, pcClin, srv } = buildM003Topo({ omitR2Route: true })

    const allDevs    = [r1, r2, sw, pcRx, pcClin, srv]
    const placements = Object.fromEntries(allDevs.map(d => [d.id, true]))
    const checks     = MISSION_TASKS.mission_003.checkFn(allDevs, placements, topo)

    expect(checks.t7).toBe(true)
    expect(checks.t8).toBe(false)
    expect(checks.t9).toBe(false)
  })

  it('t6 fails when a host has no default gateway', () => {
    const { topo, r1, r2, sw, pcRx, pcClin, srv, lxEng } = buildM003Topo()
    lx(lxEng, pcRx, 'ip route del default')

    const allDevs    = [r1, r2, sw, pcRx, pcClin, srv]
    const placements = Object.fromEntries(allDevs.map(d => [d.id, true]))
    const checks     = MISSION_TASKS.mission_003.checkFn(allDevs, placements, topo)

    expect(checks.t6).toBe(false)
    expect(checks.t9).toBe(false)
  })

  it('t9 fails when pings have not been logged yet', () => {
    const { topo, r1, r2, sw, pcRx, pcClin, srv } = buildM003Topo()
    // Do NOT call topo.logPing — player has not typed ping yet

    const allDevs    = [r1, r2, sw, pcRx, pcClin, srv]
    const placements = Object.fromEntries(allDevs.map(d => [d.id, true]))
    const checks     = MISSION_TASKS.mission_003.checkFn(allDevs, placements, topo)

    expect(checks.t7).toBe(true)
    expect(checks.t8).toBe(true)
    expect(checks.t9).toBe(false)
  })

  it('t9 fails when only one cross-subnet ping is logged (server not pinged)', () => {
    const { topo, r1, r2, sw, pcRx, pcClin, srv } = buildM003Topo()
    topo.logPing('192.168.1.10', '192.168.2.10')  // only PC-Clinical pinged, not Server

    const allDevs    = [r1, r2, sw, pcRx, pcClin, srv]
    const placements = Object.fromEntries(allDevs.map(d => [d.id, true]))
    const checks     = MISSION_TASKS.mission_003.checkFn(allDevs, placements, topo)

    expect(checks.t9).toBe(false)
  })

  it('t9 fails when PC-Clinical and Server are on the same subnet as Reception', () => {
    // Misconfiguration: all hosts on 192.168.1.0/24 — no cross-subnet targets exist.
    const { topo, r1, r2, sw, pcRx, pcClin, srv, lxEng } = buildM003Topo()

    // Override Clinical PC and Server to Reception subnet
    lx(lxEng, pcClin, 'ip addr del 192.168.2.10/24 dev eth0')
    lx(lxEng, pcClin, 'ip addr add 192.168.1.50/24 dev eth0', 'ip route add default via 192.168.1.1')
    lx(lxEng, srv, 'ip addr del 192.168.2.20/24 dev eth0')
    lx(lxEng, srv, 'ip addr add 192.168.1.60/24 dev eth0', 'ip route add default via 192.168.1.1')

    topo.logPing('192.168.1.10', '192.168.1.50')
    topo.logPing('192.168.1.10', '192.168.1.60')

    const allDevs    = [r1, r2, sw, pcRx, pcClin, srv]
    const placements = Object.fromEntries(allDevs.map(d => [d.id, true]))
    const checks     = MISSION_TASKS.mission_003.checkFn(allDevs, placements, topo)

    expect(checks.t9).toBe(false)
  })

  it('t4 fails when R1 has only one interface configured', () => {
    const { topo, r1, r2, sw, pcRx, pcClin, srv, iosEng } = buildM003Topo()
    ios(iosEng, r1,
      'enable', 'configure terminal',
      'interface GigabitEthernet0/1', 'no ip address', 'shutdown', 'exit', 'end')

    const allDevs    = [r1, r2, sw, pcRx, pcClin, srv]
    const placements = Object.fromEntries(allDevs.map(d => [d.id, true]))
    const checks     = MISSION_TASKS.mission_003.checkFn(allDevs, placements, topo)

    expect(checks.t4).toBe(false)
  })
})
