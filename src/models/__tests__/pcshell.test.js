/**
 * Linux shell (PCCLIEngine) fidelity — `ip` / `dhclient` must fail where iproute2 and
 * ISC dhclient fail, instead of silently doing something else.
 *
 * Each case below used to be accepted by the engine and quietly produce a state or a
 * lesson that real Linux would not (see .claude/brain/STATUS.md history). Error strings
 * are the real ones.
 *
 * N1  - a gateway needs a directly connected network: no address / interface off / off-link
 * N2  - ...but an enabled adapter with no carrier accepts it (the route is just linkdown)
 * N3  - `ip route add` on an existing destination: "File exists"; `replace` swaps or creates
 * N4  - `ip route del` of a route that isn't there: "No such process"
 * N5  - `ip addr add` of the address already present: "File exists"
 * N6  - `ip addr del` must name the configured address
 * N7  - deleting an interface's address flushes the routes that were only reachable through it
 * N8  - dhclient stays resident: a second run on a leased interface is refused
 * N9  - the DHCP server re-offers a client its existing binding (RFC 2131 §4.3.1)
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { Device } from '../Device.js'
import { Topology } from '../Topology.js'
import { CLIEngine } from '../CLIEngine.js'
import { PCCLIEngine } from '../PCCLIEngine.js'
import { performDHCP, releaseDHCP } from '../DHCPEngine.js'

const make = (type, model, n, prefix, start = 0) => {
  const d = new Device({ type, model, portCount: n, portPrefix: prefix, portStart: start })
  d.powered = true
  return d
}
const run = (eng, dev, ...cmds) => { let out = []; for (const c of cmds) out = eng.execute(dev, c); return out }

let topo, ios, lx, router, pc
const defaults = d => d.routing_table.filter(r => r.network === '0.0.0.0')

beforeEach(() => {
  topo = new Topology(); ios = new CLIEngine(topo); lx = new PCCLIEngine(topo)
  router = make('router', 'R', 4, 'GigabitEthernet0/')
  pc = make('pc', 'P', 1, 'Ethernet0/')
  topo.addDevice(router); topo.addDevice(pc)
  topo.connect(`${router.id}:GigabitEthernet0/0`, `${pc.id}:Ethernet0/0`)
  run(ios, router,
    'enable', 'configure terminal',
    'interface GigabitEthernet0/0', 'ip address 192.168.1.1 255.255.255.0', 'no shutdown', 'exit',
    'ip dhcp pool LAN', 'network 192.168.1.0 255.255.255.0', 'default-router 192.168.1.1', 'exit',
  )
})

// ── N1 ────────────────────────────────────────────────────────────────────────

describe('N1 — a gateway must be reachable over a connected network', () => {
  it('no address on any interface → "Nexthop has invalid gateway", route not installed', () => {
    const out = run(lx, pc, 'ip route add default via 192.168.1.1')
    expect(out[0]).toBe('Error: Nexthop has invalid gateway.')
    expect(out.join('\n')).toMatch(/ip addr add/)          // nudge toward the missing step
    expect(defaults(pc)).toHaveLength(0)
  })

  it('address present but the interface switched off → same error, with the "bring it up" nudge', () => {
    run(lx, pc, 'ip addr add 192.168.1.10/24 dev eth0')     // fresh interface is admin_down
    expect(pc.getInterface('Ethernet0/0').status).toBe('admin_down')
    const out = run(lx, pc, 'ip route add default via 192.168.1.1')
    expect(out[0]).toBe('Error: Nexthop has invalid gateway.')
    expect(out.join('\n')).toMatch(/ip link set eth0 up/)
    expect(defaults(pc)).toHaveLength(0)
  })

  it('a gateway on some other network is refused', () => {
    run(lx, pc, 'ip addr add 192.168.1.10/24 dev eth0', 'ip link set eth0 up')
    const out = run(lx, pc, 'ip route add default via 10.99.99.99')
    expect(out[0]).toBe('Error: Nexthop has invalid gateway.')
    expect(defaults(pc)).toHaveLength(0)
  })

  it('address, then link up, then route works — the order the missions teach', () => {
    run(lx, pc, 'ip addr add 192.168.1.10/24 dev eth0', 'ip link set eth0 up')
    expect(run(lx, pc, 'ip route add default via 192.168.1.1')).toEqual([])
    expect(topo.checkPing('192.168.1.10', '192.168.1.1').reachable).toBe(true)
  })
})

// ── N2 ────────────────────────────────────────────────────────────────────────

describe('N2 — an enabled adapter with no carrier still accepts routes', () => {
  it('cable unplugged (status down, not admin_down) → route installs (linkdown)', () => {
    const lone = make('pc', 'P2', 1, 'Ethernet0/'); topo.addDevice(lone)
    run(lx, lone, 'ip addr add 10.0.0.5/24 dev eth0', 'ip link set eth0 up')
    expect(lone.getInterface('Ethernet0/0').status).toBe('down')
    expect(run(lx, lone, 'ip route add default via 10.0.0.1')).toEqual([])
    expect(defaults(lone)).toHaveLength(1)
  })
})

// ── N3 ────────────────────────────────────────────────────────────────────────

describe('N3 — add vs replace', () => {
  beforeEach(() => { run(lx, pc, 'ip addr add 192.168.1.10/24 dev eth0', 'ip link set eth0 up', 'ip route add default via 192.168.1.1') })

  it('a second `add default` is "File exists" and changes nothing', () => {
    expect(run(lx, pc, 'ip route add default via 192.168.1.2')).toEqual(['RTNETLINK answers: File exists'])
    expect(defaults(pc).map(r => r.next_hop)).toEqual(['192.168.1.1'])
  })

  it('`replace` swaps the existing route', () => {
    expect(run(lx, pc, 'ip route replace default via 192.168.1.2')).toEqual([])
    expect(defaults(pc).map(r => r.next_hop)).toEqual(['192.168.1.2'])
  })

  it('`replace` creates the route when there is none', () => {
    run(lx, pc, 'ip route del default')
    expect(run(lx, pc, 'ip route replace default via 192.168.1.1')).toEqual([])
    expect(defaults(pc)).toHaveLength(1)
  })

  it('`replace` is still subject to the gateway rule', () => {
    expect(run(lx, pc, 'ip route replace default via 10.99.99.99')[0]).toBe('Error: Nexthop has invalid gateway.')
    expect(defaults(pc).map(r => r.next_hop)).toEqual(['192.168.1.1'])
  })

  it('a different destination is a different route', () => {
    expect(run(lx, pc, 'ip route add 10.5.0.0/16 via 192.168.1.1')).toEqual([])
    expect(pc.routing_table).toHaveLength(2)
  })
})

// ── N4 ────────────────────────────────────────────────────────────────────────

describe('N4 — deleting a route that is not there', () => {
  it('"No such process" for a missing default route', () => {
    expect(run(lx, pc, 'ip route del default')).toEqual(['RTNETLINK answers: No such process'])
  })
  it('deletes silently when it exists, and a repeat is then an error', () => {
    run(lx, pc, 'ip addr add 192.168.1.10/24 dev eth0', 'ip link set eth0 up', 'ip route add default via 192.168.1.1')
    expect(run(lx, pc, 'ip route del default')).toEqual([])
    expect(run(lx, pc, 'ip route del default')).toEqual(['RTNETLINK answers: No such process'])
  })
})

// ── N5 / N6 ───────────────────────────────────────────────────────────────────

describe('N5/N6 — addresses', () => {
  it('adding the address that is already there is "File exists"', () => {
    run(lx, pc, 'ip addr add 192.168.1.10/24 dev eth0')
    expect(run(lx, pc, 'ip addr add 192.168.1.10/24 dev eth0')).toEqual(['RTNETLINK answers: File exists'])
  })

  it('deleting an address that is not configured is an error, and changes nothing', () => {
    run(lx, pc, 'ip addr add 192.168.1.10/24 dev eth0')
    expect(run(lx, pc, 'ip addr del 192.168.1.99/24 dev eth0')).toEqual(['RTNETLINK answers: Cannot assign requested address'])
    expect(run(lx, pc, 'ip addr del 192.168.1.10/16 dev eth0')).toEqual(['RTNETLINK answers: Cannot assign requested address'])
    expect(pc.getInterface('Ethernet0/0').ip).toBe('192.168.1.10')
  })

  it('deleting on an interface with no address is the same error', () => {
    expect(run(lx, pc, 'ip addr del 192.168.1.10/24 dev eth0')).toEqual(['RTNETLINK answers: Cannot assign requested address'])
  })

  it('deleting the right address works', () => {
    run(lx, pc, 'ip addr add 192.168.1.10/24 dev eth0')
    expect(run(lx, pc, 'ip addr del 192.168.1.10/24 dev eth0')).toEqual([])
    expect(pc.getInterface('Ethernet0/0').ip).toBeNull()
  })
})

// ── N7 ────────────────────────────────────────────────────────────────────────

describe('N7 — deleting the address flushes the routes that depended on it', () => {
  it('the default route via that subnet goes with the address', () => {
    run(lx, pc, 'ip addr add 192.168.1.10/24 dev eth0', 'ip link set eth0 up', 'ip route add default via 192.168.1.1')
    run(lx, pc, 'ip addr del 192.168.1.10/24 dev eth0')
    expect(defaults(pc)).toHaveLength(0)
  })

  it('so a new address can take a gateway without deleting the route first', () => {
    run(lx, pc, 'ip addr add 192.168.1.10/24 dev eth0', 'ip link set eth0 up', 'ip route add default via 192.168.1.1')
    run(lx, pc, 'ip addr del 192.168.1.10/24 dev eth0', 'ip addr add 192.168.1.20/24 dev eth0')
    expect(run(lx, pc, 'ip route add default via 192.168.1.1')).toEqual([])
  })

  it('a route still reachable through another interface stays', () => {
    const srv = make('server', 'S', 2, 'Ethernet0/'); topo.addDevice(srv)
    run(lx, srv, 'ip link set eth0 up', 'ip link set eth1 up',
      'ip addr add 10.0.0.5/24 dev eth0', 'ip addr add 10.0.0.6/24 dev eth1', 'ip route add default via 10.0.0.1')
    run(lx, srv, 'ip addr del 10.0.0.5/24 dev eth0')
    expect(defaults(srv)).toHaveLength(1)           // eth1 still covers 10.0.0.1
  })

  it('routes that were never reachable through that address are left alone', () => {
    const srv = make('server', 'S', 2, 'Ethernet0/'); topo.addDevice(srv)
    run(lx, srv, 'ip link set eth0 up', 'ip link set eth1 up',
      'ip addr add 10.0.0.5/24 dev eth0', 'ip addr add 172.16.0.5/24 dev eth1', 'ip route add default via 10.0.0.1')
    run(lx, srv, 'ip addr del 172.16.0.5/24 dev eth1')
    expect(defaults(srv).map(r => r.next_hop)).toEqual(['10.0.0.1'])
  })

  it('deleting a DHCP address leaves the interface plainly unaddressed', () => {
    run(lx, pc, 'ip link set eth0 up', 'dhclient eth0')
    const ip = pc.getInterface('Ethernet0/0').ip
    run(lx, pc, `ip addr del ${ip}/24 dev eth0`)
    expect(pc.getInterface('Ethernet0/0')).toMatchObject({ ip: null, dhcp_assigned: false })
    expect(defaults(pc)).toHaveLength(0)
  })
})

// ── N8 ────────────────────────────────────────────────────────────────────────

describe('N8 — dhclient stays resident', () => {
  beforeEach(() => { run(lx, pc, 'ip link set eth0 up') })

  it('a second dhclient on a leased interface is refused and takes no second address', () => {
    run(lx, pc, 'dhclient eth0')
    const first = pc.getInterface('Ethernet0/0').ip
    const out = run(lx, pc, 'dhclient eth0')
    expect(out[0]).toMatch(/^dhclient\(\d+\) is already running - exiting\.$/)
    expect(out.join('\n')).toMatch(/dhclient -r eth0/)      // how to ask again
    expect(pc.getInterface('Ethernet0/0').ip).toBe(first)
    expect(router.dhcp_bindings).toHaveLength(1)
  })

  it('release, then request again → same address back, still exactly one binding', () => {
    run(lx, pc, 'dhclient eth0')
    const first = pc.getInterface('Ethernet0/0').ip
    run(lx, pc, 'dhclient -r eth0')
    expect(router.dhcp_bindings).toHaveLength(0)
    run(lx, pc, 'dhclient eth0')
    expect(pc.getInterface('Ethernet0/0').ip).toBe(first)
    expect(router.dhcp_bindings).toHaveLength(1)
  })

  it('a manually addressed interface still gets the existing refusal, not a lease', () => {
    run(lx, pc, 'ip addr add 192.168.1.50/24 dev eth0')
    expect(run(lx, pc, 'dhclient eth0').join('\n')).toMatch(/manually-assigned/)
    expect(router.dhcp_bindings).toHaveLength(0)
  })
})

// ── N9 ────────────────────────────────────────────────────────────────────────

describe('N9 — the server re-offers a client its existing binding', () => {
  beforeEach(() => { run(lx, pc, 'ip link set eth0 up') })

  it('asking twice at the protocol level yields the same address and one binding', () => {
    const iface = pc.getInterface('Ethernet0/0')
    const a = performDHCP(topo, pc, iface)
    const b = performDHCP(topo, pc, iface)
    expect(a.success && b.success).toBe(true)
    expect(b.ip).toBe(a.ip)
    expect(router.dhcp_bindings).toHaveLength(1)
  })

  it('a different client still gets a different address', () => {
    const other = make('pc', 'P3', 1, 'Ethernet0/'); topo.addDevice(other)
    const sw = make('switch', 'SW', 8, 'FastEthernet0/', 1); topo.addDevice(sw)
    topo.disconnect(`${pc.id}:Ethernet0/0`)
    topo.connect(`${router.id}:GigabitEthernet0/0`, `${sw.id}:FastEthernet0/1`)
    topo.connect(`${pc.id}:Ethernet0/0`, `${sw.id}:FastEthernet0/2`)
    topo.connect(`${other.id}:Ethernet0/0`, `${sw.id}:FastEthernet0/3`)
    run(lx, pc, 'ip link set eth0 up'); run(lx, other, 'ip link set eth0 up')
    const a = performDHCP(topo, pc, pc.getInterface('Ethernet0/0'))
    const b = performDHCP(topo, other, other.getInterface('Ethernet0/0'))
    expect(a.success && b.success).toBe(true)
    expect(b.ip).not.toBe(a.ip)
    expect(router.dhcp_bindings).toHaveLength(2)
  })

  it('a released lease frees the address for someone else', () => {
    const iface = pc.getInterface('Ethernet0/0')
    performDHCP(topo, pc, iface)
    iface.ip = router.dhcp_bindings[0].ip; iface.subnet_mask = '255.255.255.0'; iface.dhcp_assigned = true
    expect(releaseDHCP(topo, pc, iface).released).toBe(true)
    expect(router.dhcp_bindings).toHaveLength(0)
  })
})
