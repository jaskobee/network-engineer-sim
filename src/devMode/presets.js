/**
 * Preset topology builders for DevMode.
 *
 * CORE PRINCIPLE: every preset reaches its state by running REAL CLI commands
 * through the existing engine. No direct state writes to Device properties.
 * "Broken" presets are genuinely broken — the engine produces the failure, not
 * a script that fakes it.
 */

import { deviceCatalog } from '../data/deviceCatalog.js'

const ISP_ENTRY = { type: 'isp', model: 'ISP-CLOUD', displayName: 'ISP / Internet', portCount: 1 }
const cat = (type) => deviceCatalog.find(e => e.type === type)

// Run a sequence of CLI commands against a device.
function exec(engine, device, ...cmds) {
  for (const cmd of cmds) engine.execute(device, cmd)
}

// Get all devices from sandbox topology grouped by type, in insertion order.
function byType(sbTopology) {
  const groups = {}
  for (const d of sbTopology.devices.values()) {
    ;(groups[d.type] = groups[d.type] || []).push(d)
  }
  return groups
}

// ── Preset metadata ───────────────────────────────────────────────────────────

export const PRESETS = [
  {
    id: 'basic-lan-solved',
    label: 'Basic LAN (solved)',
    category: 'working',
    description: 'Router + PC on same /24. checkPing should succeed.',
    pingCheck: { src: '192.168.1.1', dst: '192.168.1.10' },
  },
  {
    id: 'two-router-routing-solved',
    label: 'Two-router static routing (solved)',
    category: 'working',
    description: 'R1↔R2 with bidirectional static routes. PC1→PC2 should succeed.',
    pingCheck: { src: '192.168.1.10', dst: '192.168.2.10' },
  },
  {
    id: 'two-router-one-way-broken',
    label: 'Two-router ONE-WAY route (broken)',
    category: 'broken',
    expectedFailure: 'no_return_path',
    description: 'Route only on R1. PC1→PC2 should fail: no_return_path.',
    pingCheck: { src: '192.168.1.10', dst: '192.168.2.10' },
  },
  {
    id: 'roas-solved',
    label: 'Router-on-a-stick inter-VLAN (solved)',
    category: 'working',
    description: 'Trunk + subinterfaces. PC1 (VLAN10) → PC2 (VLAN20) should succeed.',
    pingCheck: { src: '192.168.10.10', dst: '192.168.20.10' },
  },
  {
    id: 'roas-access-broken',
    label: 'ROAS with access-mode uplink (broken)',
    category: 'broken',
    expectedFailure: 'vlan_isolated',
    description: 'ROAS topology but uplink is access mode. Cross-VLAN ping should fail.',
    pingCheck: { src: '192.168.10.10', dst: '192.168.20.10' },
  },
  {
    id: 'dhcp-local-solved',
    label: 'DHCP local (solved)',
    category: 'working',
    description: 'Router DHCP server + PC on same LAN. PC gets address via dhclient.',
    pingCheck: null,
  },
  {
    id: 'dhcp-relay-solved',
    label: 'DHCP relay across router (solved)',
    category: 'working',
    description: 'DHCP on R1, PC behind R2, ip helper-address set. PC gets address.',
    pingCheck: null,
  },
  {
    id: 'dhcp-relay-no-helper-broken',
    label: 'DHCP relay WITHOUT helper (broken)',
    category: 'broken',
    expectedFailure: 'no DHCP offer',
    description: 'DHCP on R1, PC behind R2, no helper. PC should get no address.',
    pingCheck: null,
  },
]

// ── Public entry point ────────────────────────────────────────────────────────

/**
 * Apply a preset to the sandbox.
 * Returns a result object: { type:'ping'|'dhcp', reachable?, assigned?, ... }
 * The caller must call ctx.refresh() — this function does NOT call it so that
 * all React state updates from clearSandbox/addSandboxDevice batch together.
 */
export function buildPreset(presetId, ctx) {
  const { setMode, clearSandbox } = ctx
  setMode('sandbox')
  clearSandbox()

  const builders = {
    'basic-lan-solved':             _basicLan,
    'two-router-routing-solved':    _twoRouterSolved,
    'two-router-one-way-broken':    _twoRouterOneway,
    'roas-solved':                  _roasSolved,
    'roas-access-broken':           _roasAccessBroken,
    'dhcp-local-solved':            _dhcpLocal,
    'dhcp-relay-solved':            _dhcpRelay,
    'dhcp-relay-no-helper-broken':  _dhcpRelayNoHelper,
  }

  const builder = builders[presetId]
  if (!builder) return { type: 'error', message: `Unknown preset: ${presetId}` }

  const preset = PRESETS.find(p => p.id === presetId)
  const engineResult = builder(ctx)

  // Normalise to a common shape for DevPanel display
  if (preset?.pingCheck) {
    const ping = ctx.sbTopology.checkPing(preset.pingCheck.src, preset.pingCheck.dst)
    return {
      type: 'ping',
      src: preset.pingCheck.src,
      dst: preset.pingCheck.dst,
      reachable: ping.reachable,
      failureReason: ping.failureReason,
      failurePoint: ping.failurePoint,
    }
  }
  // DHCP presets return engineResult directly (already normalised below)
  return engineResult
}

// ── Individual builders ───────────────────────────────────────────────────────

function _basicLan({ addSandboxDevice, sbTopology, sbEngine, sbPcEngine, sbConnectInterfaces }) {
  addSandboxDevice(cat('router'))
  addSandboxDevice(cat('pc'))

  const g = byType(sbTopology)
  const r  = g.router[0]
  const pc = g.pc[0]

  sbConnectInterfaces(`${r.id}:GigabitEthernet0/0`, `${pc.id}:Ethernet0/0`)

  exec(sbEngine, r,
    'enable', 'configure terminal',
    'interface GigabitEthernet0/0', 'ip address 192.168.1.1 255.255.255.0', 'no shutdown', 'end',
  )
  exec(sbPcEngine, pc,
    'ip addr add 192.168.1.10/24 dev eth0', 'ip link set eth0 up',
  )
}

// Builds two-router base (cables + router IPs only; no routes, no PC static IPs).
function _buildTwoRouterBase({ addSandboxDevice, sbTopology, sbEngine, sbConnectInterfaces }) {
  addSandboxDevice(cat('router'))
  addSandboxDevice(cat('router'))
  addSandboxDevice(cat('pc'))
  addSandboxDevice(cat('pc'))

  const g = byType(sbTopology)
  const [r1, r2]   = g.router
  const [pc1, pc2] = g.pc

  sbConnectInterfaces(`${pc1.id}:Ethernet0/0`,         `${r1.id}:GigabitEthernet0/0`)
  sbConnectInterfaces(`${r1.id}:GigabitEthernet0/1`,   `${r2.id}:GigabitEthernet0/1`)
  sbConnectInterfaces(`${pc2.id}:Ethernet0/0`,         `${r2.id}:GigabitEthernet0/0`)

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

  return { r1, r2, pc1, pc2 }
}

function _twoRouterSolved(ctx) {
  const { sbTopology, sbEngine, sbPcEngine } = ctx
  const { r1, r2, pc1, pc2 } = _buildTwoRouterBase(ctx)

  exec(sbPcEngine, pc1,
    'ip addr add 192.168.1.10/24 dev eth0', 'ip link set eth0 up', 'ip route add default via 192.168.1.1',
  )
  exec(sbPcEngine, pc2,
    'ip addr add 192.168.2.10/24 dev eth0', 'ip link set eth0 up', 'ip route add default via 192.168.2.1',
  )
  exec(sbEngine, r1, 'configure terminal', 'ip route 192.168.2.0 255.255.255.0 10.0.0.2', 'end')
  exec(sbEngine, r2, 'configure terminal', 'ip route 192.168.1.0 255.255.255.0 10.0.0.1', 'end')
}

function _twoRouterOneway(ctx) {
  const { sbEngine, sbPcEngine } = ctx
  const { r1, pc1, pc2 } = _buildTwoRouterBase(ctx)

  exec(sbPcEngine, pc1,
    'ip addr add 192.168.1.10/24 dev eth0', 'ip link set eth0 up', 'ip route add default via 192.168.1.1',
  )
  exec(sbPcEngine, pc2,
    'ip addr add 192.168.2.10/24 dev eth0', 'ip link set eth0 up', 'ip route add default via 192.168.2.1',
  )
  // Route on R1 ONLY — return path missing; engine will report no_return_path
  exec(sbEngine, r1, 'configure terminal', 'ip route 192.168.2.0 255.255.255.0 10.0.0.2', 'end')
}

function _buildROASBase({ addSandboxDevice, sbTopology, sbEngine, sbPcEngine, sbConnectInterfaces }, uplinkMode) {
  addSandboxDevice(cat('router'))
  addSandboxDevice(cat('switch'))
  addSandboxDevice(cat('pc'))
  addSandboxDevice(cat('pc'))

  const g = byType(sbTopology)
  const r    = g.router[0]
  const sw   = g.switch[0]
  const [pc1, pc2] = g.pc

  sbConnectInterfaces(`${pc1.id}:Ethernet0/0`,       `${sw.id}:FastEthernet0/1`)
  sbConnectInterfaces(`${pc2.id}:Ethernet0/0`,       `${sw.id}:FastEthernet0/2`)
  sbConnectInterfaces(`${sw.id}:FastEthernet0/3`,    `${r.id}:GigabitEthernet0/0`)

  exec(sbEngine, sw,
    'enable', 'configure terminal',
    'vlan 10', 'exit',
    'vlan 20', 'exit',
    'interface FastEthernet0/1', 'switchport mode access', 'switchport access vlan 10', 'exit',
    'interface FastEthernet0/2', 'switchport mode access', 'switchport access vlan 20', 'exit',
    `interface FastEthernet0/3`, `switchport mode ${uplinkMode}`, 'end',
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

  return { r, sw, pc1, pc2 }
}

function _roasSolved(ctx)       { _buildROASBase(ctx, 'trunk')  }
function _roasAccessBroken(ctx) { _buildROASBase(ctx, 'access') }

function _dhcpLocal({ addSandboxDevice, sbTopology, sbEngine, sbPcEngine, sbConnectInterfaces }) {
  addSandboxDevice(cat('router'))
  addSandboxDevice(cat('switch'))
  addSandboxDevice(cat('pc'))

  const g  = byType(sbTopology)
  const r  = g.router[0]
  const sw = g.switch[0]
  const pc = g.pc[0]

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
  return {
    type: 'dhcp',
    assigned: !!iface?.ip,
    assignedIp: iface?.ip ?? null,
    failureReason: iface?.ip ? null : 'no_dhcp_offer',
  }
}

// Two-router base with bidirectional routes + DHCP pool on R1 for R2's subnet.
function _buildDHCPRelayBase(ctx) {
  const { sbEngine } = ctx
  const { r1, r2, pc2 } = _buildTwoRouterBase(ctx)

  exec(sbEngine, r1,
    'configure terminal',
    'ip route 192.168.2.0 255.255.255.0 10.0.0.2', 'end',
    'configure terminal',
    'ip dhcp excluded-address 192.168.2.1',
    'ip dhcp pool LAN2', 'network 192.168.2.0 255.255.255.0', 'default-router 192.168.2.1', 'end',
  )
  exec(sbEngine, r2,
    'configure terminal', 'ip route 192.168.1.0 255.255.255.0 10.0.0.1', 'end',
  )

  return { r1, r2, pc2 }
}

function _dhcpRelayNoHelper(ctx) {
  const { sbPcEngine } = ctx
  const { pc2 } = _buildDHCPRelayBase(ctx)

  sbPcEngine.execute(pc2, 'ip link set eth0 up')
  sbPcEngine.execute(pc2, 'dhclient eth0')    // broadcasts blocked — no helper → should fail

  const iface = pc2.interfaces.find(i => i.name === 'Ethernet0/0')
  return {
    type: 'dhcp',
    assigned: !!iface?.ip,
    assignedIp: iface?.ip ?? null,
    failureReason: iface?.ip ? null : 'no_dhcp_offer',
  }
}

function _dhcpRelay(ctx) {
  const { sbEngine, sbPcEngine } = ctx
  const { r2, pc2 } = _buildDHCPRelayBase(ctx)

  exec(sbEngine, r2,
    'configure terminal',
    'interface GigabitEthernet0/0', 'ip helper-address 10.0.0.1', 'end',
  )

  sbPcEngine.execute(pc2, 'ip link set eth0 up')
  sbPcEngine.execute(pc2, 'dhclient eth0')

  const iface = pc2.interfaces.find(i => i.name === 'Ethernet0/0')
  return {
    type: 'dhcp',
    assigned: !!iface?.ip,
    assignedIp: iface?.ip ?? null,
    failureReason: iface?.ip ? null : 'no_dhcp_offer',
  }
}
