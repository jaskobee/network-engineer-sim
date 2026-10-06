/**
 * Foundation smoke tests — programmatic twin of docs/foundation-smoke-test.md.
 *
 * Each test builds its own topology via the real engine, asserts expected
 * reachability / DHCP results, then returns a result object.  The runner
 * clears the sandbox between tests so topology state never leaks.
 *
 * RULE: never assert on hardcoded expectations that bypass the engine.
 *       The engine produces the result; we verify it matches the spec.
 */

import { deviceCatalog } from '../data/deviceCatalog.js'

const ISP_ENTRY = { type: 'isp', model: 'ISP-CLOUD', displayName: 'ISP / Internet', portCount: 1 }
const cat = (type) => deviceCatalog.find(e => e.type === type)

function exec(engine, device, ...cmds) {
  for (const cmd of cmds) engine.execute(device, cmd)
}

function byType(sbTopology) {
  const groups = {}
  for (const d of sbTopology.devices.values()) {
    ;(groups[d.type] = groups[d.type] || []).push(d)
  }
  return groups
}

function pass(name, detail)   { return { name, pass: true,  detail } }
function fail(name, detail)   { return { name, pass: false, detail } }

// ── Individual smoke tests ────────────────────────────────────────────────────

function testT1BasicLan(ctx) {
  const { addSandboxDevice, sbTopology, sbEngine, sbPcEngine, sbConnectInterfaces } = ctx

  addSandboxDevice(cat('router'))
  addSandboxDevice(cat('pc'))
  const g = byType(sbTopology)
  const r = g.router[0], pc = g.pc[0]

  sbConnectInterfaces(`${r.id}:GigabitEthernet0/0`, `${pc.id}:Ethernet0/0`)
  exec(sbEngine, r,
    'enable', 'configure terminal',
    'interface GigabitEthernet0/0', 'ip address 192.168.1.1 255.255.255.0', 'no shutdown', 'end',
  )
  exec(sbPcEngine, pc, 'ip addr add 192.168.1.10/24 dev eth0', 'ip link set eth0 up')

  const ping = sbTopology.checkPing('192.168.1.1', '192.168.1.10')
  const gig  = r.interfaces.find(i => i.name === 'GigabitEthernet0/0')

  if (!ping.reachable)
    return fail('T1 — Basic LAN', `ping failed: ${ping.failureReason ?? 'unknown'}`)
  if (gig?.status !== 'up')
    return fail('T1 — Basic LAN', `Gig0/0 status=${gig?.status} (expected up)`)

  return pass('T1 — Basic LAN', 'ping 192.168.1.1↔192.168.1.10 OK; Gig0/0 up/up')
}

function testT2Switch(ctx) {
  const { addSandboxDevice, sbTopology, sbEngine, sbPcEngine, sbConnectInterfaces } = ctx

  addSandboxDevice(cat('switch'))
  addSandboxDevice(cat('pc'))
  addSandboxDevice(cat('pc'))
  const g = byType(sbTopology)
  const sw = g.switch[0], [pc1, pc2] = g.pc

  sbConnectInterfaces(`${pc1.id}:Ethernet0/0`, `${sw.id}:FastEthernet0/1`)
  sbConnectInterfaces(`${pc2.id}:Ethernet0/0`, `${sw.id}:FastEthernet0/2`)

  exec(sbPcEngine, pc1, 'ip addr add 192.168.1.10/24 dev eth0', 'ip link set eth0 up')
  exec(sbPcEngine, pc2, 'ip addr add 192.168.1.11/24 dev eth0', 'ip link set eth0 up')

  // Part A: PCs talk through unconfigured switch
  const pingA = sbTopology.checkPing('192.168.1.10', '192.168.1.11')
  if (!pingA.reachable)
    return fail('T2 — Switch', `PCs could not reach each other through unconfigured switch: ${pingA.failureReason}`)

  // Part B: ip address on a physical switch port must be rejected
  exec(sbEngine, sw, 'enable', 'configure terminal', 'interface FastEthernet0/1')
  const ipOut = sbEngine.execute(sw, 'ip address 10.0.0.1 255.255.255.0')
  const rejected = ipOut.some(l => l.includes('%'))
  exec(sbEngine, sw, 'end')
  if (!rejected)
    return fail('T2 — Switch', 'ip address on physical switch port was NOT rejected')

  // Part C: SVI management IP answers a ping
  exec(sbEngine, sw,
    'configure terminal', 'interface vlan 1', 'ip address 192.168.1.2 255.255.255.0', 'no shutdown', 'end',
  )
  const pingC = sbTopology.checkPing('192.168.1.10', '192.168.1.2')
  if (!pingC.reachable)
    return fail('T2 — Switch', `Ping to SVI 192.168.1.2 failed: ${pingC.failureReason}`)

  return pass('T2 — Switch', 'PCs bridge OK; port ip rejected; SVI ping OK')
}

function testT3StaticRouting(ctx) {
  const { addSandboxDevice, sbTopology, sbEngine, sbPcEngine, sbConnectInterfaces } = ctx

  addSandboxDevice(cat('router'))
  addSandboxDevice(cat('router'))
  addSandboxDevice(cat('pc'))
  addSandboxDevice(cat('pc'))
  const g = byType(sbTopology)
  const [r1, r2] = g.router, [pc1, pc2] = g.pc

  sbConnectInterfaces(`${pc1.id}:Ethernet0/0`,       `${r1.id}:GigabitEthernet0/0`)
  sbConnectInterfaces(`${r1.id}:GigabitEthernet0/1`, `${r2.id}:GigabitEthernet0/1`)
  sbConnectInterfaces(`${pc2.id}:Ethernet0/0`,       `${r2.id}:GigabitEthernet0/0`)

  exec(sbEngine, r1,
    'enable', 'configure terminal',
    'interface GigabitEthernet0/0', 'ip address 192.168.1.1 255.255.255.0', 'no shutdown', 'exit',
    'interface GigabitEthernet0/1', 'ip address 10.0.0.1 255.255.255.252',  'no shutdown', 'end',
  )
  exec(sbEngine, r2,
    'enable', 'configure terminal',
    'interface GigabitEthernet0/0', 'ip address 192.168.2.1 255.255.255.0', 'no shutdown', 'exit',
    'interface GigabitEthernet0/1', 'ip address 10.0.0.2 255.255.255.252',  'no shutdown', 'end',
  )
  exec(sbPcEngine, pc1,
    'ip addr add 192.168.1.10/24 dev eth0', 'ip link set eth0 up', 'ip route add default via 192.168.1.1',
  )
  exec(sbPcEngine, pc2,
    'ip addr add 192.168.2.10/24 dev eth0', 'ip link set eth0 up', 'ip route add default via 192.168.2.1',
  )

  // Phase A: one-way route — must fail
  exec(sbEngine, r1, 'configure terminal', 'ip route 192.168.2.0 255.255.255.0 10.0.0.2', 'end')
  const pingA = sbTopology.checkPing('192.168.1.10', '192.168.2.10')
  if (pingA.reachable)
    return fail('T3 — Static Routing', 'Ping succeeded with only one-way route — return-path bug')
  if (pingA.failureReason !== 'no_return_path')
    return fail('T3 — Static Routing',
      `One-way-route phase failed with wrong reason: ${pingA.failureReason} (expected no_return_path)`)

  // Phase B: add return route — must succeed
  exec(sbEngine, r2, 'configure terminal', 'ip route 192.168.1.0 255.255.255.0 10.0.0.1', 'end')
  const pingB = sbTopology.checkPing('192.168.1.10', '192.168.2.10')
  if (!pingB.reachable)
    return fail('T3 — Static Routing', `Ping failed after both routes: ${pingB.failureReason}`)

  return pass('T3 — Static Routing', 'One-way fails (no_return_path); both routes → OK')
}

function testT4ROAS(ctx) {
  const { addSandboxDevice, sbTopology, sbEngine, sbPcEngine, sbConnectInterfaces } = ctx

  addSandboxDevice(cat('router'))
  addSandboxDevice(cat('switch'))
  addSandboxDevice(cat('pc'))
  addSandboxDevice(cat('pc'))
  const g = byType(sbTopology)
  const r = g.router[0], sw = g.switch[0], [pc1, pc2] = g.pc

  sbConnectInterfaces(`${pc1.id}:Ethernet0/0`,    `${sw.id}:FastEthernet0/1`)
  sbConnectInterfaces(`${pc2.id}:Ethernet0/0`,    `${sw.id}:FastEthernet0/2`)
  sbConnectInterfaces(`${sw.id}:FastEthernet0/3`, `${r.id}:GigabitEthernet0/0`)

  exec(sbEngine, sw,
    'enable', 'configure terminal',
    'vlan 10', 'exit', 'vlan 20', 'exit',
    'interface FastEthernet0/1', 'switchport mode access', 'switchport access vlan 10', 'exit',
    'interface FastEthernet0/2', 'switchport mode access', 'switchport access vlan 20', 'exit',
    'interface FastEthernet0/3', 'switchport mode trunk', 'end',
  )
  exec(sbEngine, r,
    'enable', 'configure terminal',
    'interface GigabitEthernet0/0', 'no shutdown', 'exit',
    'interface GigabitEthernet0/0.10', 'encapsulation dot1Q 10', 'ip address 192.168.10.1 255.255.255.0', 'exit',
    'interface GigabitEthernet0/0.20', 'encapsulation dot1Q 20', 'ip address 192.168.20.1 255.255.255.0', 'end',
  )
  exec(sbPcEngine, pc1,
    'ip addr add 192.168.10.10/24 dev eth0', 'ip link set eth0 up', 'ip route add default via 192.168.10.1',
  )
  exec(sbPcEngine, pc2,
    'ip addr add 192.168.20.10/24 dev eth0', 'ip link set eth0 up', 'ip route add default via 192.168.20.1',
  )

  // Phase A: trunk — must succeed
  const pingA = sbTopology.checkPing('192.168.10.10', '192.168.20.10')
  if (!pingA.reachable)
    return fail('T4 — ROAS', `Cross-VLAN ping failed with trunk: ${pingA.failureReason}`)

  // Phase B: switch uplink to access mode — must fail
  exec(sbEngine, sw, 'configure terminal', 'interface FastEthernet0/3', 'switchport mode access', 'end')
  const pingB = sbTopology.checkPing('192.168.10.10', '192.168.20.10')
  if (pingB.reachable)
    return fail('T4 — ROAS', 'Cross-VLAN ping still succeeded after switching uplink to access mode')

  // Restore trunk — must succeed again
  exec(sbEngine, sw, 'configure terminal', 'interface FastEthernet0/3', 'switchport mode trunk', 'end')
  const pingC = sbTopology.checkPing('192.168.10.10', '192.168.20.10')
  if (!pingC.reachable)
    return fail('T4 — ROAS', `Ping failed after restoring trunk: ${pingC.failureReason}`)

  return pass('T4 — ROAS', 'trunk→OK; access→fail; trunk restored→OK')
}

function testT5ISP(ctx) {
  const { addSandboxDevice, sbTopology, sbEngine, sbConnectInterfaces } = ctx

  addSandboxDevice(cat('router'))
  addSandboxDevice(ISP_ENTRY)
  const g = byType(sbTopology)
  const r   = g.router[0]
  const isp = g.isp[0]

  // ISP's fixed IP is 203.0.113.1/30 on WAN0/0
  sbConnectInterfaces(`${r.id}:GigabitEthernet0/1`, `${isp.id}:WAN0/0`)

  exec(sbEngine, r,
    'enable', 'configure terminal',
    'interface GigabitEthernet0/1', 'ip address 203.0.113.2 255.255.255.252', 'no shutdown', 'exit',
    'ip route 0.0.0.0 0.0.0.0 203.0.113.1', 'end',
  )

  // Default route must appear in routing table
  const defRoute = r.routing_table.find(rt => rt.network === '0.0.0.0' && rt.mask === '0.0.0.0')
  if (!defRoute)
    return fail('T5 — ISP / Default Route', 'Default route not found in routing table')

  // Ping to ISP must succeed
  const ping = sbTopology.checkPing('203.0.113.2', '203.0.113.1')
  if (!ping.reachable)
    return fail('T5 — ISP / Default Route', `Ping to ISP 203.0.113.1 failed: ${ping.failureReason}`)

  return pass('T5 — ISP / Default Route', 'default route installed; ping 203.0.113.1 OK')
}

function testT6aDHCPLocal(ctx) {
  const { addSandboxDevice, sbTopology, sbEngine, sbPcEngine, sbConnectInterfaces } = ctx

  addSandboxDevice(cat('router'))
  addSandboxDevice(cat('switch'))
  addSandboxDevice(cat('pc'))
  const g = byType(sbTopology)
  const r = g.router[0], sw = g.switch[0], pc = g.pc[0]

  sbConnectInterfaces(`${r.id}:GigabitEthernet0/0`,  `${sw.id}:FastEthernet0/1`)
  sbConnectInterfaces(`${pc.id}:Ethernet0/0`,         `${sw.id}:FastEthernet0/2`)

  exec(sbEngine, r,
    'enable', 'configure terminal',
    'interface GigabitEthernet0/0', 'ip address 192.168.1.1 255.255.255.0', 'no shutdown', 'exit',
    'ip dhcp excluded-address 192.168.1.1 192.168.1.10',
    'ip dhcp pool LAN1', 'network 192.168.1.0 255.255.255.0', 'default-router 192.168.1.1', 'end',
  )
  sbPcEngine.execute(pc, 'ip link set eth0 up')
  sbPcEngine.execute(pc, 'dhclient eth0')

  const iface = pc.interfaces.find(i => i.name === 'Ethernet0/0')
  if (!iface?.ip)
    return fail('T6a — DHCP Local', 'PC received no DHCP address')

  const [a, b, c, d] = iface.ip.split('.').map(Number)
  if (a !== 192 || b !== 168 || c !== 1 || d < 11)
    return fail('T6a — DHCP Local', `IP ${iface.ip} is inside excluded range or wrong subnet`)

  if (!iface.dhcp_assigned)
    return fail('T6a — DHCP Local', 'dhcp_assigned flag not set')

  return pass('T6a — DHCP Local', `PC got ${iface.ip} (excluded .1–.10 respected)`)
}

function testT6bDHCPRelay(ctx) {
  const { addSandboxDevice, sbTopology, sbEngine, sbPcEngine, sbConnectInterfaces } = ctx

  // Build two-router topology
  addSandboxDevice(cat('router'))
  addSandboxDevice(cat('router'))
  addSandboxDevice(cat('pc'))
  addSandboxDevice(cat('pc'))
  const g = byType(sbTopology)
  const [r1, r2] = g.router, [, pc2] = g.pc   // pc1 unused in this test

  sbConnectInterfaces(`${g.pc[0].id}:Ethernet0/0`,  `${r1.id}:GigabitEthernet0/0`)
  sbConnectInterfaces(`${r1.id}:GigabitEthernet0/1`, `${r2.id}:GigabitEthernet0/1`)
  sbConnectInterfaces(`${pc2.id}:Ethernet0/0`,       `${r2.id}:GigabitEthernet0/0`)

  exec(sbEngine, r1,
    'enable', 'configure terminal',
    'interface GigabitEthernet0/0', 'ip address 192.168.1.1 255.255.255.0', 'no shutdown', 'exit',
    'interface GigabitEthernet0/1', 'ip address 10.0.0.1 255.255.255.252',  'no shutdown', 'exit',
    'ip route 192.168.2.0 255.255.255.0 10.0.0.2',
    'ip dhcp excluded-address 192.168.2.1',
    'ip dhcp pool LAN2', 'network 192.168.2.0 255.255.255.0', 'default-router 192.168.2.1', 'end',
  )
  exec(sbEngine, r2,
    'enable', 'configure terminal',
    'interface GigabitEthernet0/0', 'ip address 192.168.2.1 255.255.255.0', 'no shutdown', 'exit',
    'interface GigabitEthernet0/1', 'ip address 10.0.0.2 255.255.255.252',  'no shutdown', 'exit',
    'ip route 192.168.1.0 255.255.255.0 10.0.0.1', 'end',
  )

  // Phase A: no helper — PC must get no address
  sbPcEngine.execute(pc2, 'ip link set eth0 up')
  sbPcEngine.execute(pc2, 'dhclient eth0')
  const ifaceA = pc2.interfaces.find(i => i.name === 'Ethernet0/0')
  if (ifaceA?.ip)
    return fail('T6b — DHCP Relay', `PC got ${ifaceA.ip} without helper — relay broadcast-blocking bug`)

  // Phase B: add helper — PC must get address
  exec(sbEngine, r2,
    'configure terminal', 'interface GigabitEthernet0/0', 'ip helper-address 10.0.0.1', 'end',
  )
  sbPcEngine.execute(pc2, 'dhclient eth0')
  const ifaceB = pc2.interfaces.find(i => i.name === 'Ethernet0/0')
  if (!ifaceB?.ip)
    return fail('T6b — DHCP Relay', 'PC still got no address after ip helper-address was configured')

  return pass('T6b — DHCP Relay', `no-helper→fail; helper→${ifaceB.ip} OK`)
}

// ── Test suite ────────────────────────────────────────────────────────────────

const TESTS = [
  { id: 'T1',  name: 'T1 — Basic LAN',          fn: testT1BasicLan },
  { id: 'T2',  name: 'T2 — Switch',              fn: testT2Switch },
  { id: 'T3',  name: 'T3 — Static Routing',      fn: testT3StaticRouting },
  { id: 'T4',  name: 'T4 — ROAS',                fn: testT4ROAS },
  { id: 'T5',  name: 'T5 — ISP/Default Route',   fn: testT5ISP },
  { id: 'T6a', name: 'T6a — DHCP Local',         fn: testT6aDHCPLocal },
  { id: 'T6b', name: 'T6b — DHCP Relay',         fn: testT6bDHCPRelay },
]

/**
 * Run all smoke tests against the sandbox topology.
 * Clears sandbox before each test; calls ctx.refresh() once at the end.
 * Returns an array of { id, name, pass, detail }.
 */
export function runSmokeTests(ctx) {
  const results = []

  for (const test of TESTS) {
    ctx.clearSandbox()
    let result
    try {
      result = test.fn(ctx)
    } catch (err) {
      result = fail(test.name, `Exception: ${err.message}`)
    }
    results.push({ id: test.id, ...result })
  }

  ctx.refresh()   // batch all React state updates from the runs into one render
  return results
}
