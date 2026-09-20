/**
 * The inspector's quick address edit, routed through the CLI engines.
 *
 * It used to assign iface.ip / iface.subnet_mask straight onto the device. These tests are
 * the checks that write skipped: the engine's own validation (overlap, duplicate, network /
 * broadcast address), a clean lease hand-back on a DHCP host, the gateway, and leaving the
 * device's open terminal in whatever CLI mode it was in.
 *
 * A1 - hosts: a Linux PC edits its address through ip / dhclient
 * A2 - hosts: a Windows laptop edits through netsh
 * A3 - routers / firewalls: real IOS, with IOS's own errors
 * A4 - the CLI session the player has open is not disturbed
 * A5 - switch SVI, ISP, bad prefix
 * A6 - clearing an address
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { Device, createAdminLaptop, createIspDevice } from '../../models/Device.js'
import { Topology } from '../../models/Topology.js'
import { CLIEngine } from '../../models/CLIEngine.js'
import { PCCLIEngine } from '../../models/PCCLIEngine.js'
import { WindowsCLIEngine } from '../../models/WindowsCLIEngine.js'
import { planAddressEdit, runAddressPlan } from '../interfaceAddress.js'
import { readAdapter } from '../hostConfig.js'

const make = (type, model, n, prefix, start = 0) => { const d = new Device({ type, model, portCount: n, portPrefix: prefix, portStart: start }); d.powered = true; return d }
const run = (eng, dev, ...cmds) => { let out = []; for (const c of cmds) out = eng.execute(dev, c); return out }

let topo, ios, lx, win, router, pc

/** Edit the way the inspector does: plan, then run each command through the right engine. */
function edit(device, ifaceName, ip, prefix) {
  const plan = planAddressEdit(topo, device, ifaceName, ip, prefix)
  if (Object.keys(plan.errors).length) return { plan, result: null }
  const eng = device.type === 'laptop' && device.os_type === 'windows' ? win : (['pc', 'server', 'phone', 'laptop'].includes(device.type) ? lx : ios)
  return { plan, result: runAddressPlan(cmd => eng.execute(device, cmd), device, ifaceName, plan) }
}

beforeEach(() => {
  topo = new Topology(); ios = new CLIEngine(topo); lx = new PCCLIEngine(topo); win = new WindowsCLIEngine(topo)
  router = make('router', 'R', 4, 'GigabitEthernet0/'); pc = make('pc', 'P', 1, 'Ethernet0/')
  topo.addDevice(router); topo.addDevice(pc)
  topo.connect(`${router.id}:GigabitEthernet0/0`, `${pc.id}:Ethernet0/0`)
  run(ios, router, 'enable', 'configure terminal',
    'interface GigabitEthernet0/0', 'ip address 192.168.1.1 255.255.255.0', 'no shutdown', 'exit',
    'ip dhcp pool LAN', 'network 192.168.1.0 255.255.255.0', 'default-router 192.168.1.1', 'exit')
  run(lx, pc, 'ip link set eth0 up')
})

// ── A1 ────────────────────────────────────────────────────────────────────────

describe('A1 — a Linux host edits through ip / dhclient', () => {
  it('a bare adapter takes the address as an ip command, not a field write', () => {
    const { plan, result } = edit(pc, 'Ethernet0/0', '192.168.1.40', '24')
    expect(plan).toMatchObject({ kind: 'host', commands: ['ip addr add 192.168.1.40/24 dev eth0'] })
    expect(result.ok).toBe(true)
    expect(pc.getInterface('Ethernet0/0')).toMatchObject({ ip: '192.168.1.40', subnet_mask: '255.255.255.0', dhcp_assigned: false })
  })

  it('a leased host releases its lease first — no stale dhcp_assigned, no orphan binding', () => {
    run(lx, pc, 'dhclient eth0')
    expect(router.dhcp_bindings).toHaveLength(1)
    const { result } = edit(pc, 'Ethernet0/0', '192.168.1.90', '24')
    expect(result.ok).toBe(true)
    expect(pc.getInterface('Ethernet0/0')).toMatchObject({ ip: '192.168.1.90', dhcp_assigned: false })
    expect(router.dhcp_bindings).toHaveLength(0)
    expect(pc.dns_server).toBeNull()
  })

  it('the gateway rides along when still valid, and goes when it is not', () => {
    run(lx, pc, 'ip addr add 192.168.1.10/24 dev eth0', 'ip route add default via 192.168.1.1')
    edit(pc, 'Ethernet0/0', '192.168.1.11', '24')
    expect(readAdapter(topo, pc, 'Ethernet0/0').gateway).toBe('192.168.1.1')
    edit(pc, 'Ethernet0/0', '10.9.9.9', '24')
    expect(pc.routing_table.filter(r => r.network === '0.0.0.0')).toHaveLength(0)
  })

  it('is validated: network address, duplicate, bad prefix', () => {
    expect(edit(pc, 'Ethernet0/0', '192.168.1.0', '24').plan.errors.ip).toMatch(/network address/)
    expect(edit(pc, 'Ethernet0/0', '192.168.1.1', '24').plan.errors.ip).toMatch(/already in use/)
    expect(edit(pc, 'Ethernet0/0', '192.168.1.9', '40').plan.errors.ip).toMatch(/0 to 32/)
    expect(pc.getInterface('Ethernet0/0').ip).toBeNull()
  })

  it('setting the same address again changes nothing', () => {
    edit(pc, 'Ethernet0/0', '192.168.1.40', '24')
    expect(planAddressEdit(topo, pc, 'Ethernet0/0', '192.168.1.40', '24').commands).toEqual([])
  })
})

// ── A2 ────────────────────────────────────────────────────────────────────────

describe('A2 — a Windows laptop edits through netsh', () => {
  let lap
  beforeEach(() => {
    lap = createAdminLaptop(); lap.os_type = 'windows'; lap.powered = true; topo.addDevice(lap)
    topo.connect(`${router.id}:GigabitEthernet0/1`, `${lap.id}:Ethernet0/0`)
    run(ios, router, 'configure terminal', 'interface GigabitEthernet0/1', 'ip address 10.0.0.1 255.255.255.0', 'no shutdown', 'end')
    run(win, lap, 'netsh interface set interface name="Ethernet0" admin=enabled')
  })

  it('emits one netsh command and no Linux ones', () => {
    const { plan, result } = edit(lap, 'Ethernet0/0', '10.0.0.50', '24')
    expect(plan.commands).toEqual(['netsh interface ip set address "Ethernet0" static 10.0.0.50 255.255.255.0'])
    expect(plan.commands.join(' ')).not.toMatch(/\bip (addr|route)\b|dhclient/)
    expect(result.ok).toBe(true)
    expect(lap.getInterface('Ethernet0/0')).toMatchObject({ ip: '10.0.0.50', dhcp_assigned: false })
  })

  it('keeps a still-valid gateway in the same command', () => {
    run(win, lap, 'netsh interface ip set address "Ethernet0" static 10.0.0.50 255.255.255.0 10.0.0.1')
    const { plan } = edit(lap, 'Ethernet0/0', '10.0.0.60', '24')
    expect(plan.commands).toEqual(['netsh interface ip set address "Ethernet0" static 10.0.0.60 255.255.255.0 10.0.0.1'])
  })

  it('clearing a static address is netsh delete address', () => {
    run(win, lap, 'netsh interface ip set address "Ethernet0" static 10.0.0.50 255.255.255.0 10.0.0.1')
    const { plan, result } = edit(lap, 'Ethernet0/0', '', '24')
    expect(plan.commands).toEqual(['netsh interface ip delete address "Ethernet0" 10.0.0.50'])
    expect(result.ok).toBe(true)
    expect(lap.getInterface('Ethernet0/0').ip).toBeNull()
  })
})

// ── A3 ────────────────────────────────────────────────────────────────────────

describe('A3 — routers and firewalls: real IOS, real errors', () => {
  it('sets an interface address with ip address, and the state follows', () => {
    const { plan, result } = edit(router, 'GigabitEthernet0/1', '10.1.1.1', '24')
    expect(plan.kind).toBe('ios')
    expect(plan.commands).toEqual(['enable', 'configure terminal', 'interface GigabitEthernet0/1', 'ip address 10.1.1.1 255.255.255.0', 'end'])
    expect(result.ok).toBe(true)
    expect(router.getInterface('GigabitEthernet0/1')).toMatchObject({ ip: '10.1.1.1', subnet_mask: '255.255.255.0' })
  })

  it('an overlapping subnet on the same router is refused (the direct write allowed it)', () => {
    const { result } = edit(router, 'GigabitEthernet0/1', '192.168.1.77', '24')
    expect(result.ok).toBe(false)
    expect(result.steps.at(-1).output.join(' ')).toMatch(/overlaps with 192\.168\.1\.1 on GigabitEthernet0\/0/)
    expect(router.getInterface('GigabitEthernet0/1').ip).toBeNull()
  })

  it('an address another device already has is refused, naming it', () => {
    run(lx, pc, 'ip addr add 172.16.0.5/24 dev eth0')
    const { result } = edit(router, 'GigabitEthernet0/1', '172.16.0.5', '24')
    expect(result.ok).toBe(false)
    expect(result.steps.at(-1).output.join(' ')).toMatch(/already assigned to/)
  })

  it('a network or broadcast address is refused with IOS wording', () => {
    expect(edit(router, 'GigabitEthernet0/1', '10.1.1.0', '24').result.steps.at(-1).output.join(' ')).toMatch(/is the network address for subnet 10\.1\.1\.0\/24/)
    expect(edit(router, 'GigabitEthernet0/1', '10.1.1.255', '24').result.steps.at(-1).output.join(' ')).toMatch(/is the broadcast address/)
  })

  it('does not bring the interface up — that stays an explicit no shutdown', () => {
    edit(router, 'GigabitEthernet0/1', '10.1.1.1', '24')
    expect(router.getInterface('GigabitEthernet0/1').status).toBe('admin_down')
  })

  it('the same address again changes nothing', () => {
    expect(planAddressEdit(topo, router, 'GigabitEthernet0/0', '192.168.1.1', '24').commands).toEqual([])
  })
})

// ── A4 ────────────────────────────────────────────────────────────────────────

describe('A4 — the open terminal is not disturbed', () => {
  it('a router sitting in interface-config mode is put back exactly', () => {
    run(ios, router, 'enable', 'configure terminal', 'interface GigabitEthernet0/2')
    expect(router.config_mode).toBe('interface_config')
    expect(router.active_interface).toBe('GigabitEthernet0/2')
    edit(router, 'GigabitEthernet0/1', '10.1.1.1', '24')
    expect(router.config_mode).toBe('interface_config')
    expect(router.active_interface).toBe('GigabitEthernet0/2')
    // …and the next thing the player types lands in the interface they were configuring
    run(ios, router, 'ip address 10.2.2.1 255.255.255.0')
    expect(router.getInterface('GigabitEthernet0/2').ip).toBe('10.2.2.1')
  })

  it('restores the mode even when the edit fails', () => {
    run(ios, router, 'enable', 'configure terminal', 'ip dhcp pool LAN')
    const mode = router.config_mode, pool = router.active_dhcp_pool
    edit(router, 'GigabitEthernet0/1', '192.168.1.77', '24')            // overlap → refused
    expect(router.config_mode).toBe(mode)
    expect(router.active_dhcp_pool).toBe(pool)
  })

  it('works from user-exec mode too', () => {
    router.config_mode = 'user_exec'
    expect(edit(router, 'GigabitEthernet0/1', '10.1.1.1', '24').result.ok).toBe(true)
    expect(router.config_mode).toBe('user_exec')
  })
})

// ── A5 ────────────────────────────────────────────────────────────────────────

describe('A5 — switch SVI, ISP, bad prefix', () => {
  it('a switch SVI is edited with interface vlan / ip address', () => {
    const sw = make('switch', 'SW', 8, 'FastEthernet0/', 1); topo.addDevice(sw)
    run(ios, sw, 'enable', 'configure terminal', 'interface vlan 1', 'end')
    const { plan, result } = edit(sw, 'Vlan1', '192.168.1.200', '24')
    expect(plan.commands).toContain('ip address 192.168.1.200 255.255.255.0')
    expect(result.ok).toBe(true)
    expect(sw.getInterface('Vlan1').ip).toBe('192.168.1.200')
  })

  it('a switch port cannot take an address — IOS refuses, as it always did', () => {
    const sw = make('switch', 'SW', 8, 'FastEthernet0/', 1); topo.addDevice(sw)
    const { result } = edit(sw, 'FastEthernet0/1', '10.0.0.1', '24')
    expect(result.ok).toBe(false)
    expect(result.steps.at(-1).output.join(' ')).toMatch(/not supported on switchports/)
  })

  it('the ISP is mission infrastructure: not editable', () => {
    const isp = createIspDevice(); topo.addDevice(isp)
    const plan = planAddressEdit(topo, isp, 'WAN0/0', '1.1.1.1', '24')
    expect(plan.kind).toBe('none')
    expect(plan.errors.ip).toMatch(/mission infrastructure/)
    expect(plan.commands).toEqual([])
  })

  it('a bad prefix is rejected before any command runs', () => {
    expect(planAddressEdit(topo, router, 'GigabitEthernet0/1', '10.1.1.1', '33')).toMatchObject({ commands: [], errors: { ip: expect.stringMatching(/0 to 32/) } })
  })
})

// ── A6 ────────────────────────────────────────────────────────────────────────

describe('A6 — clearing an address', () => {
  it('router: no ip address', () => {
    const { plan, result } = edit(router, 'GigabitEthernet0/0', '', '24')
    expect(plan.commands).toEqual(['enable', 'configure terminal', 'interface GigabitEthernet0/0', 'no ip address', 'end'])
    expect(result.ok).toBe(true)
    expect(router.getInterface('GigabitEthernet0/0').ip).toBeNull()
  })
  it('router: nothing to clear → nothing to run', () => {
    expect(planAddressEdit(topo, router, 'GigabitEthernet0/1', '', '24').commands).toEqual([])
  })
  it('Linux host manual address', () => {
    run(lx, pc, 'ip addr add 192.168.1.40/24 dev eth0')
    const { result } = edit(pc, 'Ethernet0/0', '', '24')
    expect(result.ok).toBe(true)
    expect(pc.getInterface('Ethernet0/0').ip).toBeNull()
  })
  it('Linux host lease: released back to the server', () => {
    run(lx, pc, 'dhclient eth0')
    edit(pc, 'Ethernet0/0', '', '24')
    expect(pc.getInterface('Ethernet0/0').ip).toBeNull()
    expect(router.dhcp_bindings).toHaveLength(0)
  })
})
