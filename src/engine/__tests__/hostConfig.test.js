/**
 * Host network settings (the "Configure GUI" window) — everything runs against the
 * REAL Topology + CLI engines, because the GUI's whole contract is "same commands,
 * same state as the terminal".
 *
 * G1  - reading an adapter: three link states, modes, gateway ownership, subnet facts
 * G2  - manual apply emits the exact iproute2 commands and the host can ping its gateway
 * G3  - invalid input never reaches the engine (mask, network/broadcast, gateway, duplicate)
 * G4  - manual → DHCP: manual address removed, lease obtained, ping works
 * G5  - DHCP → manual: lease released FIRST (binding + DHCP route gone), then static applied
 * G6  - DHCP failure is honest: no address, no fake state
 * G7  - idempotence: re-applying changes nothing; DHCP with a lease never takes a second one
 * G8  - renew = release + request, exactly one binding afterwards
 * G9  - clearing the gateway removes the default route only
 * G10 - the adapter switch (`ip link set`) drives all three link states
 * G11 - a failing command stops the plan and reports the engine's own words
 * G12 - two-adapter server: each adapter owns the gateway on its own subnet
 * G12b- a host has one default route: a second adapter can't silently take it over
 * G13 - GUI-applied state equals typing the same commands
 * H-Win   - the same window over the Windows shell (netsh / ipconfig), laptop included
 * H-Clear / H-Quick / H-Guard - clearing an address, the inspector's edit, a gateway needs an enabled adapter
 *
 * Command ORDER is asserted on purpose: it is what real iproute2 needs (route delete before
 * the last address goes; del+add rather than a second `add default`), so the transcript the
 * window shows would also work typed on a real box.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { Device } from '../../models/Device.js'
import { Topology } from '../../models/Topology.js'
import { CLIEngine } from '../../models/CLIEngine.js'
import { PCCLIEngine } from '../../models/PCCLIEngine.js'
import { WindowsCLIEngine } from '../../models/WindowsCLIEngine.js'
import { createAdminLaptop } from '../../models/Device.js'
import {
  supportsHostGui, osOf, linuxName, adapterName, prefixToMask, readAdapter, formFromAdapter, sameForm, subnetFacts,
  validateManual, validateDns, planApply, planRenew, planLink, planClear, planQuickAddress, applyPlan,
} from '../hostConfig.js'

// ── Helpers ───────────────────────────────────────────────────────────────────

const make = (type, model, portCount, portPrefix, portStart = 0) => {
  const d = new Device({ type, model, portCount, portPrefix, portStart })
  d.powered = true
  return d
}
const makeRouter = () => make('router', 'R-test', 4, 'GigabitEthernet0/')
const makeSwitch = () => make('switch', 'SW-test', 8, 'FastEthernet0/', 1)
const makePc     = () => make('pc', 'PC-test', 1, 'Ethernet0/')
const makeServer = () => make('server', 'SRV-test', 2, 'Ethernet0/')

let topo, ios, lx, router, pc

function run(engine, device, ...cmds) { let out = []; for (const c of cmds) out = engine.execute(device, c); return out }
const exec = device => cmd => lx.execute(device, cmd)

const MANUAL = { mode: 'manual', ip: '192.168.1.10', mask: '255.255.255.0', gateway: '192.168.1.1' }
const DHCP   = { mode: 'dhcp', ip: '', mask: '', gateway: '' }

/** Apply a form the way the window does: plan, then run through the engine. */
function apply(device, form, ifaceName = 'Ethernet0/0') {
  const plan = planApply(topo, device, ifaceName, form)
  if (Object.keys(plan.errors).length) return { plan, result: null }
  return { plan, result: applyPlan(exec(device), device, ifaceName, plan.commands) }
}

beforeEach(() => {
  topo = new Topology()
  ios = new CLIEngine(topo)
  lx  = new PCCLIEngine(topo)
  router = makeRouter()
  pc = makePc()
  topo.addDevice(router)
  topo.addDevice(pc)
  topo.connect(`${router.id}:GigabitEthernet0/0`, `${pc.id}:Ethernet0/0`)
  run(ios, router,
    'enable', 'configure terminal',
    'interface GigabitEthernet0/0', 'ip address 192.168.1.1 255.255.255.0', 'no shutdown', 'exit',
    'ip dhcp pool LAN', 'network 192.168.1.0 255.255.255.0', 'default-router 192.168.1.1', 'dns-server 8.8.8.8', 'exit',
  )
  run(lx, pc, 'ip link set eth0 up')
})

// ── G1 ────────────────────────────────────────────────────────────────────────

describe('G1 — reading an adapter', () => {
  it('only end hosts get the window (not routers, switches, firewalls)', () => {
    expect(supportsHostGui(pc)).toBe(true)
    expect(supportsHostGui(makeServer())).toBe(true)
    expect(supportsHostGui(make('phone', 'P', 1, 'Ethernet0/'))).toBe(true)
    expect(supportsHostGui(router)).toBe(false)
    expect(supportsHostGui(makeSwitch())).toBe(false)
    expect(supportsHostGui(make('firewall', 'F', 4, 'GigabitEthernet0/'))).toBe(false)
    expect(supportsHostGui(createAdminLaptop())).toBe(true)
  })

  it('uses the Linux names the shell prints', () => {
    expect(linuxName('Ethernet0/0')).toBe('eth0')
    expect(linuxName('Ethernet0/1')).toBe('eth1')
  })

  it('an unconfigured, cabled, enabled PC is up with no address', () => {
    const a = readAdapter(topo, pc, 'Ethernet0/0')
    expect(a).toMatchObject({ label: 'eth0', status: 'up', enabled: true, mode: 'none', ip: null, gateway: null })
    expect(a.remote).toEqual({ hostname: router.hostname, port: 'GigabitEthernet0/0' })
  })

  it('link states stay three distinct things: up, down (no cable) and disabled', () => {
    const lone = makePc(); topo.addDevice(lone)
    expect(readAdapter(topo, lone, 'Ethernet0/0').status).toBe('admin_down')       // fresh: disabled
    run(lx, lone, 'ip link set eth0 up')
    expect(readAdapter(topo, lone, 'Ethernet0/0')).toMatchObject({ status: 'down', enabled: true, remote: null })  // enabled, no cable
    run(lx, pc, 'ip link set eth0 down')
    expect(readAdapter(topo, pc, 'Ethernet0/0')).toMatchObject({ status: 'admin_down', enabled: false })
  })

  it('a manual address reads back as manual, with its gateway', () => {
    run(lx, pc, 'ip addr add 192.168.1.10/24 dev eth0', 'ip route add default via 192.168.1.1')
    const a = readAdapter(topo, pc, 'Ethernet0/0')
    expect(a).toMatchObject({ mode: 'manual', ip: '192.168.1.10', mask: '255.255.255.0', prefix: 24, gateway: '192.168.1.1' })
    expect(formFromAdapter(a)).toEqual({ ...MANUAL, dnsMode: 'auto', dns1: '', dns2: '' })   // no DNS set by hand
  })

  it('a leased address reads back as dhcp and shows the DNS it was handed', () => {
    run(lx, pc, 'dhclient eth0')
    const a = readAdapter(topo, pc, 'Ethernet0/0')
    expect(a.mode).toBe('dhcp')
    expect(a.dnsServers).toEqual(['8.8.8.8'])
    expect(formFromAdapter(a)).toEqual({ ...DHCP, dnsMode: 'auto', dns1: '', dns2: '' })   // manual fields stay empty for a lease
  })

  it('usable hosts = 2^hostBits − 2 (network and broadcast address are reserved), for every common prefix', () => {
    const cases = { 8: 16777214, 16: 65534, 20: 4094, 24: 254, 25: 126, 26: 62, 27: 30, 28: 14, 29: 6, 30: 2 }
    for (const [prefix, hosts] of Object.entries(cases)) {
      const mask = prefixToMask(prefix)
      const f = subnetFacts('10.0.0.1', mask)
      expect(f.hosts).toBe(hosts)
      expect(f.hosts).toBe(2 ** f.hostBits - 2)
    }
    // the classic mix-up: a /24 is 254, not 252 (that would need two more reserved addresses)
    expect(subnetFacts('192.168.1.10', '255.255.255.0').hosts).toBe(254)
    // and the first/last usable addresses really are one inside the network and broadcast addresses
    const f = subnetFacts('192.168.1.10', '255.255.255.0')
    expect([f.network, f.first, f.last, f.broadcast]).toEqual(['192.168.1.0', '192.168.1.1', '192.168.1.254', '192.168.1.255'])
  })

  it('subnet facts: /24, /30, /31 (RFC 3021) and /32', () => {
    expect(subnetFacts('192.168.1.10', '255.255.255.0')).toEqual({ prefix: 24, hostBits: 8, network: '192.168.1.0', first: '192.168.1.1', last: '192.168.1.254', broadcast: '192.168.1.255', hosts: 254 })
    expect(subnetFacts('10.0.0.5', '255.255.255.252')).toMatchObject({ network: '10.0.0.4', first: '10.0.0.5', last: '10.0.0.6', broadcast: '10.0.0.7', hosts: 2 })
    expect(subnetFacts('10.0.0.1', '255.255.255.254')).toMatchObject({ network: '10.0.0.0', first: '10.0.0.0', last: '10.0.0.1', broadcast: null, hosts: 2 })
    expect(subnetFacts('10.0.0.1', '255.255.255.255')).toMatchObject({ first: '10.0.0.1', last: '10.0.0.1', broadcast: null, hosts: 1 })
    expect(subnetFacts('10.0.0.1', '255.0.255.0')).toBeNull()
  })
})

// ── G2 ────────────────────────────────────────────────────────────────────────

describe('G2 — manual apply', () => {
  it('emits exactly the iproute2 commands a person would type', () => {
    const { plan } = apply(pc, MANUAL)
    expect(plan.commands).toEqual([
      'ip addr add 192.168.1.10/24 dev eth0',
      'ip route add default via 192.168.1.1',
    ])
  })

  it('leaves the host addressed, routed and able to ping its gateway', () => {
    const { result } = apply(pc, MANUAL)
    expect(result.ok).toBe(true)
    const i = pc.getInterface('Ethernet0/0')
    expect(i).toMatchObject({ ip: '192.168.1.10', subnet_mask: '255.255.255.0', dhcp_assigned: false })
    expect(topo.checkPing('192.168.1.10', '192.168.1.1').reachable).toBe(true)
    expect(run(lx, pc, 'ip route').join('\n')).toContain('default via 192.168.1.1')
  })

  it('changing the address replaces the old one (del then add), so it never lingers', () => {
    apply(pc, MANUAL)
    const { plan, result } = apply(pc, { ...MANUAL, ip: '192.168.1.20' })
    // Real Linux flushes the default route when the interface's last address goes, so the
    // route is simply added again afterwards — exactly what a person would type.
    expect(plan.commands).toEqual([
      'ip addr del 192.168.1.10/24 dev eth0',
      'ip addr add 192.168.1.20/24 dev eth0',
      'ip route add default via 192.168.1.1',
    ])
    expect(result.ok).toBe(true)
    expect(pc.getInterface('Ethernet0/0').ip).toBe('192.168.1.20')
    expect(pc.routing_table.filter(r => r.network === '0.0.0.0')).toHaveLength(1)
  })

  it('a /31 point-to-point host address is accepted (RFC 3021)', () => {
    const { plan, result } = apply(pc, { mode: 'manual', ip: '10.9.9.0', mask: '255.255.255.254', gateway: '' })
    expect(plan.errors).toEqual({})
    expect(result.ok).toBe(true)
  })
})

// ── G3 ────────────────────────────────────────────────────────────────────────

describe('G3 — invalid input is stopped before the engine and explained', () => {
  const bad = (over) => validateManual(topo, pc, { ...MANUAL, ...over })

  it('requires an address and a mask', () => {
    expect(bad({ ip: '', mask: '' })).toMatchObject({ ip: expect.any(String), mask: expect.any(String) })
  })
  it('rejects malformed addresses', () => {
    expect(bad({ ip: '192.168.1' }).ip).toMatch(/not a valid IPv4/)
    expect(bad({ ip: '192.168.1.300' }).ip).toMatch(/not a valid IPv4/)
    expect(bad({ ip: '192.168.01.10' }).ip).toMatch(/not a valid IPv4/)   // leading-zero ambiguity
  })
  it('rejects a non-contiguous mask and a prefix typed where a dotted mask belongs', () => {
    expect(bad({ mask: '255.0.255.0' }).mask).toMatch(/unbroken run/)
    expect(bad({ mask: '/24' }).mask).toMatch(/dotted/)
    expect(bad({ mask: '24' }).mask).toMatch(/dotted/)
  })
  it('rejects the network and broadcast address as a host address', () => {
    expect(bad({ ip: '192.168.1.0' }).ip).toMatch(/network address of 192\.168\.1\.0\/24/)
    expect(bad({ ip: '192.168.1.255' }).ip).toMatch(/broadcast address of 192\.168\.1\.0\/24/)
  })
  it('rejects a gateway outside the host subnet, even though the CLI would accept it', () => {
    expect(bad({ gateway: '10.0.0.1' }).gateway).toMatch(/same subnet.*192\.168\.1\.0\/24/)
  })
  it('rejects a gateway that is the host itself, or the subnet network/broadcast address', () => {
    expect(bad({ gateway: '192.168.1.10' }).gateway).toMatch(/own address/)
    expect(bad({ gateway: '192.168.1.0' }).gateway).toMatch(/network address/)
    expect(bad({ gateway: '192.168.1.255' }).gateway).toMatch(/broadcast address/)
  })
  it('a blank gateway is allowed (isolated segment)', () => {
    expect(bad({ gateway: '' })).toEqual({})
  })
  it('rejects an address already used by another device, naming it', () => {
    expect(bad({ ip: '192.168.1.1' }).ip).toContain(router.hostname)
  })
  it('an invalid form produces no commands and changes nothing', () => {
    const before = JSON.stringify(pc.interfaces)
    const { plan, result } = apply(pc, { ...MANUAL, gateway: '10.0.0.1' })
    expect(plan.commands).toEqual([])
    expect(result).toBeNull()
    expect(JSON.stringify(pc.interfaces)).toBe(before)
  })
})

// ── G4 ────────────────────────────────────────────────────────────────────────

describe('G4 — manual → DHCP', () => {
  it('removes the manual address (and its gateway), then requests a lease', () => {
    apply(pc, MANUAL)
    const { plan, result } = apply(pc, DHCP)
    // Route first: on real Linux, deleting the last address flushes routes via it, so a
    // later `ip route del default` would fail with "No such process".
    expect(plan.commands).toEqual([
      'ip route del default',
      'ip addr del 192.168.1.10/24 dev eth0',
      'dhclient eth0',
    ])
    expect(result.ok).toBe(true)
    const a = readAdapter(topo, pc, 'Ethernet0/0')
    expect(a.mode).toBe('dhcp')
    expect(a.ip).toMatch(/^192\.168\.1\./)
    expect(a.gateway).toBe('192.168.1.1')
    expect(topo.checkPing(a.ip, '192.168.1.1').reachable).toBe(true)
  })

  it('the DORA exchange shows up as the step output', () => {
    const { result } = apply(pc, DHCP)
    expect(result.steps.at(-1).output.join('\n')).toMatch(/DHCPDISCOVER[\s\S]*DHCPACK/)
  })
})

// ── G5 ────────────────────────────────────────────────────────────────────────

describe('G5 — DHCP → manual', () => {
  it('gives the lease back first: binding, DHCP route and DNS are gone, not stale', () => {
    apply(pc, DHCP)
    expect(router.dhcp_bindings).toHaveLength(1)
    const { plan, result } = apply(pc, { ...MANUAL, ip: '192.168.1.50' })
    expect(plan.commands).toEqual([
      'dhclient -r eth0',
      'ip addr add 192.168.1.50/24 dev eth0',
      'ip route add default via 192.168.1.1',
    ])
    expect(result.ok).toBe(true)
    expect(router.dhcp_bindings).toHaveLength(0)
    expect(pc.dhcp_dns_servers).toEqual([])
    const i = pc.getInterface('Ethernet0/0')
    expect(i).toMatchObject({ ip: '192.168.1.50', dhcp_assigned: false })
    expect(pc.routing_table.filter(r => r.network === '0.0.0.0')).toHaveLength(1)
    expect(pc.routing_table[0].dhcp_assigned).toBeUndefined()
  })

  it('with a blank gateway the leased default route is not left behind', () => {
    apply(pc, DHCP)
    apply(pc, { ...MANUAL, ip: '192.168.1.50', gateway: '' })
    expect(pc.routing_table.filter(r => r.network === '0.0.0.0')).toHaveLength(0)
    expect(readAdapter(topo, pc, 'Ethernet0/0').gateway).toBeNull()
  })
})

// ── G6 ────────────────────────────────────────────────────────────────────────

describe('G6 — DHCP failure is reported, never faked', () => {
  it('no server: no address, plan fails, engine words surface', () => {
    run(ios, router, 'enable', 'configure terminal', 'no ip dhcp pool LAN', 'end')
    const { result } = apply(pc, DHCP)
    expect(result.ok).toBe(false)
    expect(result.steps.at(-1).output.join('\n')).toMatch(/No DHCPOFFERS received/)
    expect(pc.getInterface('Ethernet0/0')).toMatchObject({ ip: null, dhcp_assigned: false })
  })

  it('adapter disabled: the request fails and says why', () => {
    run(lx, pc, 'ip link set eth0 down')
    const { result } = apply(pc, DHCP)
    expect(result.ok).toBe(false)
    expect(result.steps.at(-1).output.join('\n')).toMatch(/not up/)
    expect(pc.getInterface('Ethernet0/0').ip).toBeNull()
  })

  it('will not discard a manual address for a DHCP request that cannot be answered (link down)', () => {
    apply(pc, MANUAL)
    run(lx, pc, 'ip link set eth0 down')
    const before = JSON.stringify([pc.interfaces, pc.routing_table])
    const { plan, result } = apply(pc, DHCP)
    expect(plan.commands).toEqual([])
    expect(plan.errors.link).toMatch(/discard the manual address/)
    expect(result).toBeNull()
    expect(JSON.stringify([pc.interfaces, pc.routing_table])).toBe(before)
    // once the link is back the same switch goes through
    run(lx, pc, 'ip link set eth0 up')
    expect(planApply(topo, pc, 'Ethernet0/0', DHCP).commands).toContain('dhclient eth0')
  })

  it('a failed request leaves the form reading as DHCP (no lease) so Apply can retry', () => {
    run(lx, pc, 'ip link set eth0 down')
    apply(pc, DHCP)
    const a = readAdapter(topo, pc, 'Ethernet0/0')
    expect(a.mode).toBe('none')
    expect(formFromAdapter(a).mode).toBe('dhcp')
    expect(planApply(topo, pc, 'Ethernet0/0', DHCP).commands).toEqual(['dhclient eth0'])
  })
})

// ── G7 ────────────────────────────────────────────────────────────────────────

describe('G7 — idempotence', () => {
  it('re-applying an unchanged manual form runs nothing', () => {
    apply(pc, MANUAL)
    expect(planApply(topo, pc, 'Ethernet0/0', MANUAL).commands).toEqual([])
  })

  it('changing only the gateway touches only the route', () => {
    apply(pc, MANUAL)
    run(ios, router, 'configure terminal', 'interface GigabitEthernet0/0', 'ip address 192.168.1.1 255.255.255.0', 'end')
    const { plan } = apply(pc, { ...MANUAL, gateway: '192.168.1.2' })
    // `ip route add default` while one exists is "RTNETLINK answers: File exists" on real Linux.
    expect(plan.commands).toEqual(['ip route del default', 'ip route add default via 192.168.1.2'])
    expect(pc.routing_table.filter(r => r.network === '0.0.0.0')).toHaveLength(1)
  })

  it('applying DHCP while already holding a lease does nothing — no second binding', () => {
    apply(pc, DHCP)
    const first = pc.getInterface('Ethernet0/0').ip
    const { plan } = apply(pc, DHCP)
    expect(plan.commands).toEqual([])
    expect(pc.getInterface('Ethernet0/0').ip).toBe(first)
    expect(router.dhcp_bindings).toHaveLength(1)
  })
})

// ── G8 ────────────────────────────────────────────────────────────────────────

describe('G8 — renew', () => {
  it('is only offered while a lease is held', () => {
    expect(planRenew(topo, pc, 'Ethernet0/0')).toBeNull()
    run(lx, pc, 'ip addr add 192.168.1.10/24 dev eth0')
    expect(planRenew(topo, pc, 'Ethernet0/0')).toBeNull()
  })

  it('is refused while the link is down — the release would succeed and the request fail', () => {
    apply(pc, DHCP)
    run(lx, pc, 'ip link set eth0 down')
    expect(planRenew(topo, pc, 'Ethernet0/0')).toBeNull()
    expect(router.dhcp_bindings).toHaveLength(1)   // the lease is untouched
  })

  it('releases then requests again, ending with exactly one binding', () => {
    apply(pc, DHCP)
    const cmds = planRenew(topo, pc, 'Ethernet0/0')
    expect(cmds).toEqual(['dhclient -r eth0', 'dhclient eth0'])
    const result = applyPlan(exec(pc), pc, 'Ethernet0/0', cmds)
    expect(result.ok).toBe(true)
    expect(router.dhcp_bindings).toHaveLength(1)
    expect(readAdapter(topo, pc, 'Ethernet0/0').mode).toBe('dhcp')
  })
})

// ── G9 ────────────────────────────────────────────────────────────────────────

describe('G9 — clearing the gateway', () => {
  it('removes the default route and nothing else', () => {
    apply(pc, MANUAL)
    run(lx, pc, 'ip route add 10.5.0.0/16 via 192.168.1.1')
    const { plan, result } = apply(pc, { ...MANUAL, gateway: '' })
    expect(plan.commands).toEqual(['ip route del default'])
    expect(result.ok).toBe(true)
    expect(pc.routing_table.map(r => r.network)).toEqual(['10.5.0.0'])
    expect(pc.getInterface('Ethernet0/0').ip).toBe('192.168.1.10')
  })

  it('clearing it while the address changes deletes the route BEFORE the address goes', () => {
    apply(pc, MANUAL)
    const { plan, result } = apply(pc, { ...MANUAL, ip: '192.168.1.20', gateway: '' })
    expect(plan.commands).toEqual([
      'ip route del default',
      'ip addr del 192.168.1.10/24 dev eth0',
      'ip addr add 192.168.1.20/24 dev eth0',
    ])
    expect(result.ok).toBe(true)
    expect(pc.routing_table.filter(r => r.network === '0.0.0.0')).toHaveLength(0)
  })

  it('a host with no gateway can reach its own subnet but not beyond it', () => {
    apply(pc, { ...MANUAL, gateway: '' })
    expect(topo.checkPing('192.168.1.10', '192.168.1.1').reachable).toBe(true)
    expect(topo.checkPing('192.168.1.10', '8.8.8.8').reachable).toBe(false)
  })
})

// ── G10 ───────────────────────────────────────────────────────────────────────

describe('G10 — the adapter switch', () => {
  it('maps to ip link set and moves the adapter between all three states', () => {
    expect(planLink(pc, 'Ethernet0/0', false)).toEqual(['ip link set eth0 down'])
    expect(planLink(pc, 'Ethernet0/0', true)).toEqual(['ip link set eth0 up'])

    applyPlan(exec(pc), pc, 'Ethernet0/0', planLink(pc, 'Ethernet0/0', false))
    expect(readAdapter(topo, pc, 'Ethernet0/0').status).toBe('admin_down')
    // the switch end loses carrier — it's "down", not administratively down
    expect(router.getInterface('GigabitEthernet0/0').status).toBe('down')

    applyPlan(exec(pc), pc, 'Ethernet0/0', planLink(pc, 'Ethernet0/0', true))
    expect(readAdapter(topo, pc, 'Ethernet0/0').status).toBe('up')
  })
})

// ── G11 ───────────────────────────────────────────────────────────────────────

describe('G11 — a failing command stops the plan', () => {
  it('reports the engine text and does not run later steps', () => {
    const calls = []
    const stub = cmd => { calls.push(cmd); return cmd.startsWith('ip addr') ? ['ip: Error: boom'] : [] }
    const result = applyPlan(stub, pc, 'Ethernet0/0', ['ip addr add 1.1.1.1/24 dev eth0', 'ip route add default via 1.1.1.2'])
    expect(result.ok).toBe(false)
    expect(calls).toEqual(['ip addr add 1.1.1.1/24 dev eth0'])
    expect(result.steps).toEqual([{ cmd: 'ip addr add 1.1.1.1/24 dev eth0', output: ['ip: Error: boom'], ok: false }])
  })
})

// ── G12 ───────────────────────────────────────────────────────────────────────

describe('G12 — a two-adapter server', () => {
  it('each adapter owns the gateway that lives on its own subnet', () => {
    const srv = makeServer(); topo.addDevice(srv)
    const sw = makeSwitch(); topo.addDevice(sw)
    topo.connect(`${srv.id}:Ethernet0/0`, `${sw.id}:FastEthernet0/1`)
    run(lx, srv, 'ip link set eth0 up', 'ip link set eth1 up')
    apply(srv, { mode: 'manual', ip: '10.0.0.5', mask: '255.255.255.0', gateway: '10.0.0.1' }, 'Ethernet0/0')
    apply(srv, { mode: 'manual', ip: '172.16.0.5', mask: '255.255.255.0', gateway: '' }, 'Ethernet0/1')
    expect(readAdapter(topo, srv, 'Ethernet0/0').gateway).toBe('10.0.0.1')
    expect(readAdapter(topo, srv, 'Ethernet0/1').gateway).toBeNull()
    // eth1 with a blank gateway must not remove the default route that belongs to eth0
    expect(srv.routing_table.filter(r => r.network === '0.0.0.0')).toHaveLength(1)
  })
})

describe('G12b — one default route per host', () => {
  function twoNicServer() {
    const srv = makeServer(); topo.addDevice(srv)
    run(lx, srv, 'ip link set eth0 up', 'ip link set eth1 up')
    apply(srv, { mode: 'manual', ip: '10.0.0.5', mask: '255.255.255.0', gateway: '10.0.0.1' }, 'Ethernet0/0')
    return srv
  }

  it('refuses a second adapter\'s gateway rather than silently taking over eth0\'s', () => {
    const srv = twoNicServer()
    const before = JSON.stringify(srv.routing_table)
    const { plan, result } = apply(srv, { mode: 'manual', ip: '172.16.0.5', mask: '255.255.255.0', gateway: '172.16.0.1' }, 'Ethernet0/1')
    expect(plan.errors.gateway).toMatch(/eth0 already uses 10\.0\.0\.1 as the default gateway/)
    expect(plan.commands).toEqual([])
    expect(result).toBeNull()
    expect(JSON.stringify(srv.routing_table)).toBe(before)
    expect(readAdapter(topo, srv, 'Ethernet0/0').gateway).toBe('10.0.0.1')
  })

  it('after eth0\'s gateway is cleared, eth1 can hold the default route', () => {
    const srv = twoNicServer()
    apply(srv, { mode: 'manual', ip: '10.0.0.5', mask: '255.255.255.0', gateway: '' }, 'Ethernet0/0')
    const { result } = apply(srv, { mode: 'manual', ip: '172.16.0.5', mask: '255.255.255.0', gateway: '172.16.0.1' }, 'Ethernet0/1')
    expect(result.ok).toBe(true)
    expect(readAdapter(topo, srv, 'Ethernet0/1').gateway).toBe('172.16.0.1')
    expect(readAdapter(topo, srv, 'Ethernet0/0').gateway).toBeNull()
  })

  it('re-applying eth0\'s own gateway is not blocked', () => {
    const srv = twoNicServer()
    expect(planApply(topo, srv, 'Ethernet0/0', { mode: 'manual', ip: '10.0.0.5', mask: '255.255.255.0', gateway: '10.0.0.1' }).errors).toEqual({})
  })
})

// ── G13 ───────────────────────────────────────────────────────────────────────

describe('G13 — GUI state equals typed state', () => {
  it('applying the form and typing the same commands leave identical interface + route state', () => {
    const typed = makePc(); topo.addDevice(typed)
    topo.connect(`${router.id}:GigabitEthernet0/1`, `${typed.id}:Ethernet0/0`)
    run(ios, router, 'enable', 'configure terminal', 'interface GigabitEthernet0/1', 'ip address 192.168.2.1 255.255.255.0', 'no shutdown', 'end')
    run(lx, typed, 'ip link set eth0 up', 'ip addr add 192.168.2.10/24 dev eth0', 'ip route add default via 192.168.2.1')

    const gui = makePc(); topo.addDevice(gui)
    topo.connect(`${router.id}:GigabitEthernet0/2`, `${gui.id}:Ethernet0/0`)
    run(ios, router, 'configure terminal', 'interface GigabitEthernet0/2', 'ip address 192.168.3.1 255.255.255.0', 'no shutdown', 'end')
    run(lx, gui, 'ip link set eth0 up')
    apply(gui, { mode: 'manual', ip: '192.168.3.10', mask: '255.255.255.0', gateway: '192.168.3.1' })

    const shape = d => ({ ...d.getInterface('Ethernet0/0'), ip: 'x', connected_to: 'x' })
    expect(shape(gui)).toEqual(shape(typed))
    expect(gui.routing_table.map(r => ({ ...r, next_hop: 'x' }))).toEqual(typed.routing_table.map(r => ({ ...r, next_hop: 'x' })))
  })

  it('sameForm ignores surrounding whitespace only', () => {
    expect(sameForm(MANUAL, { ...MANUAL, ip: ' 192.168.1.10 ' })).toBe(true)
    expect(sameForm(MANUAL, { ...MANUAL, ip: '192.168.1.11' })).toBe(false)
    expect(sameForm(MANUAL, DHCP)).toBe(false)
  })
})

// ══ Windows laptop ═══════════════════════════════════════════════════════════════

describe('H-Win — the same window over the Windows shell', () => {
  let win, lap
  const wexec = cmd => win.execute(lap, cmd)
  const wapply = (form, ifaceName = 'Ethernet0/0') => {
    const plan = planApply(topo, lap, ifaceName, form)
    if (Object.keys(plan.errors).length) return { plan, result: null }
    return { plan, result: applyPlan(wexec, lap, ifaceName, plan.commands) }
  }

  beforeEach(() => {
    win = new WindowsCLIEngine(topo)
    lap = createAdminLaptop(); lap.os_type = 'windows'; lap.powered = true
    topo.addDevice(lap)
    topo.connect(`${router.id}:GigabitEthernet0/1`, `${lap.id}:Ethernet0/0`)
    run(ios, router, 'enable', 'configure terminal',
      'interface GigabitEthernet0/1', 'ip address 192.168.2.1 255.255.255.0', 'no shutdown', 'exit',
      'ip dhcp pool LAP', 'network 192.168.2.0 255.255.255.0', 'default-router 192.168.2.1', 'dns-server 9.9.9.9', 'end')
    win.execute(lap, 'netsh interface set interface name="Ethernet0" admin=enabled')
  })

  const WMANUAL = { mode: 'manual', ip: '192.168.2.50', mask: '255.255.255.0', gateway: '192.168.2.1' }

  it('a Windows laptop is a Windows host; anything else is Linux', () => {
    expect(osOf(lap)).toBe('windows')
    lap.os_type = 'linux'; expect(osOf(lap)).toBe('linux')
    expect(osOf(pc)).toBe('linux')
  })

  it('adapter names are the shell\'s own: Ethernet1 on Windows, eth1 on Linux', () => {
    expect(adapterName(lap, 'Ethernet0/1')).toBe('Ethernet1')
    expect(adapterName(pc, 'Ethernet0/1')).toBe('eth1')
    expect(readAdapter(topo, lap, 'Ethernet0/0')).toMatchObject({ os: 'windows', label: 'Ethernet0' })
  })

  it('static is ONE netsh command — address, mask, gateway together', () => {
    const { plan, result } = wapply(WMANUAL)
    expect(plan.commands).toEqual(['netsh interface ip set address "Ethernet0" static 192.168.2.50 255.255.255.0 192.168.2.1'])
    expect(result.ok).toBe(true)
    expect(topo.checkPing('192.168.2.50', '192.168.2.1').reachable).toBe(true)
    expect(readAdapter(topo, lap, 'Ethernet0/0')).toMatchObject({ mode: 'manual', ip: '192.168.2.50', gateway: '192.168.2.1' })
  })

  it('no Linux command is ever emitted for a Windows laptop', () => {
    const all = [
      wapply(WMANUAL).plan.commands, wapply(DHCP).plan.commands, planLink(lap, 'Ethernet0/0', false),
      planLink(lap, 'Ethernet0/0', true), planClear(topo, lap, 'Ethernet0/0'),
    ].flat().join('\n')
    expect(all).not.toMatch(/\bip (addr|route|link)\b|dhclient/)
  })

  it('a blank gateway is expressed by leaving it out — and clears the old one', () => {
    wapply(WMANUAL)
    const { plan, result } = wapply({ ...WMANUAL, gateway: '' })
    expect(plan.commands).toEqual(['netsh interface ip set address "Ethernet0" static 192.168.2.50 255.255.255.0'])
    expect(result.ok).toBe(true)
    expect(lap.routing_table.filter(r => r.network === '0.0.0.0')).toHaveLength(0)
  })

  it('re-applying an unchanged form runs nothing', () => {
    wapply(WMANUAL)
    expect(planApply(topo, lap, 'Ethernet0/0', WMANUAL).commands).toEqual([])
  })

  it('static → DHCP is one command and works (this used to be refused by the shell)', () => {
    wapply(WMANUAL)
    const { plan, result } = wapply(DHCP)
    expect(plan.commands).toEqual(['netsh interface ip set address "Ethernet0" dhcp'])
    expect(result.ok).toBe(true)
    const a = readAdapter(topo, lap, 'Ethernet0/0')
    expect(a).toMatchObject({ mode: 'dhcp', gateway: '192.168.2.1', dnsServers: ['9.9.9.9'] })
    expect(router.dhcp_bindings.filter(b => b.pool_name === 'LAP')).toHaveLength(1)
  })

  it('DHCP while already leased does nothing', () => {
    wapply(DHCP)
    expect(planApply(topo, lap, 'Ethernet0/0', DHCP).commands).toEqual([])
  })

  it('DHCP → static gives the lease back', () => {
    wapply(DHCP)
    wapply({ ...WMANUAL, ip: '192.168.2.77' })
    expect(router.dhcp_bindings.filter(b => b.pool_name === 'LAP')).toHaveLength(0)
    expect(lap.dhcp_dns_servers).toEqual([])
  })

  it('no DHCP server: the setting takes, but the result is reported as no lease — never a fake address', () => {
    run(ios, router, 'configure terminal', 'no ip dhcp pool LAP', 'end')
    const { result } = wapply(DHCP)
    expect(result.ok).toBe(false)
    expect(result.headline).toBe('No DHCP lease')
    expect(lap.getInterface('Ethernet0/0').ip).toBeNull()
    expect(readAdapter(topo, lap, 'Ethernet0/0').mode).toBe('none')
    expect(formFromAdapter(readAdapter(topo, lap, 'Ethernet0/0')).mode).toBe('dhcp')   // still reads as DHCP-enabled
  })

  it('renew is `ipconfig /renew` and keeps the address', () => {
    wapply(DHCP)
    const before = lap.getInterface('Ethernet0/0').ip
    const cmds = planRenew(topo, lap, 'Ethernet0/0')
    expect(cmds).toEqual(['ipconfig /renew'])
    expect(applyPlan(wexec, lap, 'Ethernet0/0', cmds).ok).toBe(true)
    expect(lap.getInterface('Ethernet0/0').ip).toBe(before)
    expect(router.dhcp_bindings.filter(b => b.pool_name === 'LAP')).toHaveLength(1)
  })

  it('renew is refused while the link is down', () => {
    wapply(DHCP)
    win.execute(lap, 'netsh interface set interface name="Ethernet0" admin=disabled')
    expect(planRenew(topo, lap, 'Ethernet0/0')).toBeNull()
  })

  it('the adapter switch is netsh interface set interface', () => {
    expect(planLink(lap, 'Ethernet0/0', false)).toEqual(['netsh interface set interface name="Ethernet0" admin=disabled'])
    applyPlan(wexec, lap, 'Ethernet0/0', planLink(lap, 'Ethernet0/0', false))
    expect(readAdapter(topo, lap, 'Ethernet0/0')).toMatchObject({ status: 'admin_down', enabled: false })
    applyPlan(wexec, lap, 'Ethernet0/0', planLink(lap, 'Ethernet0/0', true))
    expect(readAdapter(topo, lap, 'Ethernet0/0').status).toBe('up')
  })

  it('a Windows host can be configured while its adapter is disabled (netsh allows it)', () => {
    win.execute(lap, 'netsh interface set interface name="Ethernet0" admin=disabled')
    expect(wapply(WMANUAL).result.ok).toBe(true)
  })

  it('GUI state equals typed state', () => {
    const typed = createAdminLaptop(); typed.os_type = 'windows'; typed.powered = true; topo.addDevice(typed)
    topo.connect(`${router.id}:GigabitEthernet0/2`, `${typed.id}:Ethernet0/0`)
    run(ios, router, 'configure terminal', 'interface GigabitEthernet0/2', 'ip address 192.168.3.1 255.255.255.0', 'no shutdown', 'end')
    win.execute(typed, 'netsh interface set interface name="Ethernet0" admin=enabled')
    win.execute(typed, 'netsh interface ip set address "Ethernet0" static 192.168.3.50 255.255.255.0 192.168.3.1')
    wapply(WMANUAL)
    const shape = d => ({ ...d.getInterface('Ethernet0/0'), ip: 'x', connected_to: 'x', status: 'x' })
    expect(shape(lap)).toEqual(shape(typed))
    expect(lap.routing_table.map(r => ({ ...r, next_hop: 'x' }))).toEqual(typed.routing_table.map(r => ({ ...r, next_hop: 'x' })))
  })
})

// ══ New planner pieces ═══════════════════════════════════════════════════════════

describe('H-Clear — taking the address away', () => {
  it('Linux manual: route first, then the address', () => {
    apply(pc, MANUAL)
    expect(planClear(topo, pc, 'Ethernet0/0')).toEqual(['ip route del default', 'ip addr del 192.168.1.10/24 dev eth0'])
    expect(applyPlan(exec(pc), pc, 'Ethernet0/0', planClear(topo, pc, 'Ethernet0/0')).ok).toBe(true)
    expect(readAdapter(topo, pc, 'Ethernet0/0').mode).toBe('none')
    expect(pc.routing_table).toHaveLength(0)
  })
  it('Linux manual without a gateway: just the address', () => {
    apply(pc, { ...MANUAL, gateway: '' })
    expect(planClear(topo, pc, 'Ethernet0/0')).toEqual(['ip addr del 192.168.1.10/24 dev eth0'])
  })
  it('Linux lease: released, so the binding goes too', () => {
    apply(pc, DHCP)
    expect(planClear(topo, pc, 'Ethernet0/0')).toEqual(['dhclient -r eth0'])
    applyPlan(exec(pc), pc, 'Ethernet0/0', planClear(topo, pc, 'Ethernet0/0'))
    expect(router.dhcp_bindings).toHaveLength(0)
  })
  it('nothing to clear → nothing to run', () => {
    expect(planClear(topo, pc, 'Ethernet0/0')).toEqual([])
  })
})

describe('H-Quick — the inspector edit as a manual form', () => {
  it('prefixToMask converts and rejects', () => {
    expect(prefixToMask(24)).toBe('255.255.255.0')
    expect(prefixToMask('30')).toBe('255.255.255.252')
    expect(prefixToMask(0)).toBe('0.0.0.0')
    expect(prefixToMask(32)).toBe('255.255.255.255')
    for (const bad of [33, -1, '', 'x', '24.5', '2 4']) expect(prefixToMask(bad)).toBeNull()
  })

  it('keeps the gateway when it is still reachable on the new address', () => {
    apply(pc, MANUAL)
    const plan = planQuickAddress(topo, pc, 'Ethernet0/0', '192.168.1.20', 24)
    expect(plan.errors).toEqual({})
    const r = applyPlan(exec(pc), pc, 'Ethernet0/0', plan.commands)
    expect(r.ok).toBe(true)
    expect(readAdapter(topo, pc, 'Ethernet0/0')).toMatchObject({ ip: '192.168.1.20', gateway: '192.168.1.1' })
  })

  it('drops the gateway when the new subnet can no longer reach it', () => {
    apply(pc, MANUAL)
    const plan = planQuickAddress(topo, pc, 'Ethernet0/0', '10.5.5.5', 24)
    expect(plan.commands).toEqual(['ip route del default', 'ip addr del 192.168.1.10/24 dev eth0', 'ip addr add 10.5.5.5/24 dev eth0'])
    expect(applyPlan(exec(pc), pc, 'Ethernet0/0', plan.commands).ok).toBe(true)
    expect(pc.routing_table.filter(r => r.network === '0.0.0.0')).toHaveLength(0)
  })

  it('a leased host editing its address releases the lease first (no stale dhcp_assigned)', () => {
    apply(pc, DHCP)
    const plan = planQuickAddress(topo, pc, 'Ethernet0/0', '192.168.1.99', 24)
    expect(plan.commands[0]).toBe('dhclient -r eth0')
    applyPlan(exec(pc), pc, 'Ethernet0/0', plan.commands)
    expect(pc.getInterface('Ethernet0/0')).toMatchObject({ ip: '192.168.1.99', dhcp_assigned: false })
    expect(router.dhcp_bindings).toHaveLength(0)
  })

  it('is validated like the form: network address, duplicate, bad prefix', () => {
    expect(planQuickAddress(topo, pc, 'Ethernet0/0', '192.168.1.0', 24).errors.ip).toMatch(/network address/)
    expect(planQuickAddress(topo, pc, 'Ethernet0/0', '192.168.1.1', 24).errors.ip).toMatch(/already in use/)
    expect(planQuickAddress(topo, pc, 'Ethernet0/0', '192.168.1.5', 99).errors.ip).toMatch(/0 to 32/)
  })
})

describe('H-Guard — a Linux gateway needs an enabled adapter', () => {
  it('applying a gateway on a disabled adapter is refused up front, changing nothing', () => {
    run(lx, pc, 'ip link set eth0 down')
    const before = JSON.stringify([pc.interfaces, pc.routing_table])
    const { plan, result } = apply(pc, MANUAL)
    expect(plan.errors.gateway).toMatch(/Turn the adapter on first/)
    expect(plan.commands).toEqual([])
    expect(result).toBeNull()
    expect(JSON.stringify([pc.interfaces, pc.routing_table])).toBe(before)
  })

  it('an address alone (no gateway) may be set on a disabled adapter', () => {
    run(lx, pc, 'ip link set eth0 down')
    expect(apply(pc, { ...MANUAL, gateway: '' }).result.ok).toBe(true)
  })

  it('once enabled the same form goes through', () => {
    run(lx, pc, 'ip link set eth0 down', 'ip link set eth0 up')
    expect(apply(pc, MANUAL).result.ok).toBe(true)
  })
})

// ── DNS in the window ─────────────────────────────────────────────────────────

describe('H-DNS — preferred / alternate DNS servers, through the same shells', () => {
  const manual = (extra = {}) => ({ ...MANUAL, dnsMode: 'manual', dns1: '8.8.8.8', dns2: '', ...extra })

  it('reads what the host asks, in order, and where it came from', () => {
    run(lx, pc, 'resolvectl dns eth0 8.8.8.8 8.8.4.4')
    const a = readAdapter(topo, pc, 'Ethernet0/0')
    expect(a).toMatchObject({ dnsServers: ['8.8.8.8', '8.8.4.4'], dnsMode: 'static', dnsStatic: ['8.8.8.8', '8.8.4.4'] })
    expect(formFromAdapter(a)).toMatchObject({ dnsMode: 'manual', dns1: '8.8.8.8', dns2: '8.8.4.4' })
  })

  it('a lease\'s servers read as automatic, not as something typed', () => {
    run(lx, pc, 'dhclient eth0')
    const a = readAdapter(topo, pc, 'Ethernet0/0')
    expect(a).toMatchObject({ dnsServers: ['8.8.8.8'], dnsMode: 'dhcp', dnsStatic: [], dnsDhcp: ['8.8.8.8'] })
    expect(formFromAdapter(a)).toMatchObject({ dnsMode: 'auto', dns1: '', dns2: '' })
  })

  it('what "automatic" would use is the lease\'s list, even while a static list is in effect', () => {
    run(lx, pc, 'dhclient eth0', 'resolvectl dns eth0 1.1.1.1')
    expect(readAdapter(topo, pc, 'Ethernet0/0')).toMatchObject({ dnsServers: ['1.1.1.1'], dnsMode: 'static', dnsDhcp: ['8.8.8.8'] })
  })

  it('a form without DNS fields (the inspector quick edit) leaves DNS alone', () => {
    run(lx, pc, 'resolvectl dns eth0 1.1.1.1')
    const { plan } = apply(pc, MANUAL)
    expect(plan.commands.some(c => c.startsWith('resolvectl'))).toBe(false)
    expect(pc.dns_servers).toEqual(['1.1.1.1'])
    expect(planQuickAddress(topo, pc, 'Ethernet0/0', '192.168.1.44', 24).commands.some(c => /resolvectl|dns/.test(c))).toBe(false)
  })

  it('Linux: one systemd-resolved command carries the whole list, and it really lands', () => {
    const { plan, result } = apply(pc, manual({ dns2: '8.8.4.4' }))
    expect(plan.commands.at(-1)).toBe('resolvectl dns eth0 8.8.8.8 8.8.4.4')
    expect(result.ok).toBe(true)
    expect(pc.dns_servers).toEqual(['8.8.8.8', '8.8.4.4'])
  })

  it('unchanged DNS plans nothing; back to automatic plans `resolvectl revert`', () => {
    apply(pc, manual({ dns2: '8.8.4.4' }))
    const same = planApply(topo, pc, 'Ethernet0/0', manual({ dns2: '8.8.4.4' }))
    expect(same.commands).toEqual([])
    const back = apply(pc, { ...MANUAL, dnsMode: 'auto', dns1: '', dns2: '' })
    expect(back.plan.commands).toEqual(['resolvectl revert eth0'])
    expect(back.result.ok).toBe(true)
    expect(pc.dns_servers).toEqual([])
  })

  it('automatic with nothing set by hand plans nothing at all', () => {
    expect(planApply(topo, pc, 'Ethernet0/0', { ...MANUAL, dnsMode: 'auto', dns1: '', dns2: '' }).commands.filter(c => /dns|resolvectl/.test(c))).toEqual([])
  })

  it('validates: needs a preferred server, valid addresses, and an alternate that differs', () => {
    expect(validateDns({ dnsMode: 'auto', dns1: 'junk' })).toEqual({})
    expect(validateDns({ dnsMode: 'manual', dns1: '', dns2: '' }).dns1).toMatch(/Enter the preferred DNS server/)
    expect(validateDns({ dnsMode: 'manual', dns1: '', dns2: '8.8.4.4' }).dns1).toMatch(/preferred DNS server before the alternate/)
    expect(validateDns({ dnsMode: 'manual', dns1: '8.8.8', dns2: '' }).dns1).toMatch(/not a valid IPv4/)
    expect(validateDns({ dnsMode: 'manual', dns1: '8.8.8.8', dns2: '8.8.4' }).dns2).toMatch(/not a valid IPv4/)
    expect(validateDns({ dnsMode: 'manual', dns1: '8.8.8.8', dns2: '8.8.8.8' }).dns2).toMatch(/same as the preferred/)
    const { plan, result } = apply(pc, manual({ dns1: 'x' }))
    expect(plan.errors.dns1).toBeTruthy()
    expect(plan.commands).toEqual([])          // an invalid form runs NOTHING — not even its valid address half
    expect(result).toBeNull()
    expect(pc.interfaces[0].ip).toBeNull()
  })

  it('an address error and a DNS error are reported together', () => {
    const plan = planApply(topo, pc, 'Ethernet0/0', manual({ ip: 'nope', dns1: '' }))
    expect(plan.errors.ip).toBeTruthy()
    expect(plan.errors.dns1).toBeTruthy()
  })

  it('Windows: set dns (preferred) then add dns … index=2 (alternate) — netsh, never Linux commands', () => {
    const lap = createAdminLaptop(); lap.os_type = 'windows'; lap.powered = true
    topo.addDevice(lap)
    topo.connect(`${router.id}:GigabitEthernet0/1`, `${lap.id}:Ethernet0/0`)
    const win = new WindowsCLIEngine(topo)
    run(win, lap, 'netsh interface set interface name="Ethernet0" admin=enabled')
    const form = { mode: 'dhcp', ip: '', mask: '', gateway: '', dnsMode: 'manual', dns1: '8.8.8.8', dns2: '8.8.4.4' }
    const plan = planApply(topo, lap, 'Ethernet0/0', form)
    expect(plan.commands.filter(c => /dns/.test(c))).toEqual([
      'netsh interface ip set dns "Ethernet0" static 8.8.8.8',
      'netsh interface ip add dns "Ethernet0" 8.8.4.4 index=2',
    ])
    expect(plan.commands.join('\n')).not.toMatch(/resolvectl|ip addr|dhclient/)
    const res = applyPlan(cmd => win.execute(lap, cmd), lap, 'Ethernet0/0', plan.commands.filter(c => /dns/.test(c)))
    expect(res.ok).toBe(true)
    expect(lap.dns_servers).toEqual(['8.8.8.8', '8.8.4.4'])
    const back = planApply(topo, lap, 'Ethernet0/0', { ...form, dnsMode: 'auto', dns1: '', dns2: '' })
    expect(back.commands.filter(c => /dns/.test(c))).toEqual(['netsh interface ip set dns "Ethernet0" dhcp'])
  })

  it('a single preferred server on Windows is one command', () => {
    const lap = createAdminLaptop(); lap.os_type = 'windows'; lap.powered = true
    topo.addDevice(lap)
    const plan = planApply(topo, lap, 'Ethernet0/0', { mode: 'dhcp', ip: '', mask: '', gateway: '', dnsMode: 'manual', dns1: '1.1.1.1', dns2: '' })
    expect(plan.commands.filter(c => /dns/.test(c))).toEqual(['netsh interface ip set dns "Ethernet0" static 1.1.1.1'])
  })

  it('sameForm notices a DNS edit (so Revert lights up and the form is not overwritten)', () => {
    const base = formFromAdapter(readAdapter(topo, pc, 'Ethernet0/0'))
    expect(sameForm(base, { ...base, dnsMode: 'manual', dns1: '8.8.8.8' })).toBe(false)
    expect(sameForm(base, { ...base })).toBe(true)
    expect(sameForm({ mode: 'dhcp', ip: '', mask: '', gateway: '' }, { mode: 'dhcp', ip: '', mask: '', gateway: '', dnsMode: 'auto', dns1: '', dns2: '' })).toBe(true)
  })
})
