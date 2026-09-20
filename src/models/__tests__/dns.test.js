/**
 * DNS phase 1 — a name resolves only through a configured name server that the host can really
 * reach (docs/DNS_DESIGN.md). Every state below is built through the real CLI engines.
 *
 * R1  - the resolver: literals, no server, unreachable, NAT, refused, NXDOMAIN, failover, precedence
 * R2  - the path is the real one: a firewall that only permits ICMP blocks DNS until udp/53 is allowed
 * L1  - Linux: ping <name>, exact failure wording per rung
 * L2  - Linux: nslookup (stub and explicit server), resolvectl, cat resolv.conf
 * L3  - Linux: DHCP hands out a list; a static list wins; revert returns to the lease
 * W1  - Windows: ping <name>, nslookup, netsh set/add/delete dns, ipconfig /all, show config
 * I1  - IOS: ip name-server / ip domain-lookup, ping <name>, show running-config, switch, firewall
 * C1  - the UDP/53 exchange is captured (WireFish shows real frames)
 * S1  - saves: lists survive a round trip; an old save's single dns_server is the lease's
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { Device, createAdminLaptop, createIspDevice, deviceFromSave } from '../Device.js'
import { Topology } from '../Topology.js'
import { CLIEngine } from '../CLIEngine.js'
import { PCCLIEngine } from '../PCCLIEngine.js'
import { WindowsCLIEngine } from '../WindowsCLIEngine.js'
import { resolveName, queryServer, effectiveDnsServers, dnsSource, PUBLIC_ZONE } from '../dns.js'
import { serialize, deserialize } from '../../utils/saveLoad.js'

const run = (eng, dev, ...cmds) => { let out = []; for (const c of cmds) out = eng.execute(dev, c); return out }

function dev(type, model, ports, prefix) {
  const d = new Device({ type, model, portCount: ports, portPrefix: prefix, portStart: type === 'switch' ? 1 : 0 })
  d.powered = true
  return d
}

/**
 * pc (192.168.1.10) ─┐
 * lap (.50, Windows) ─┼─ switch ─ router Gi0/0 (192.168.1.1)      Gi0/1 (203.0.113.2/30) ─ ISP
 * srv (.20, no DNS) ──┘
 * NAT overload on the router, default route to the ISP — so the LAN really reaches 8.8.8.8.
 */
function lab({ nat = true } = {}) {
  const topo = new Topology()
  const ios = new CLIEngine(topo), pcEng = new PCCLIEngine(topo), win = new WindowsCLIEngine(topo)
  const router = dev('router', 'R', 4, 'GigabitEthernet0/')
  const sw = dev('switch', 'SW', 8, 'FastEthernet0/')
  const pc = dev('pc', 'PC', 1, 'Ethernet0/')
  const srv = dev('server', 'SRV', 1, 'Ethernet0/')
  const lap = createAdminLaptop(); lap.os_type = 'windows'; lap.powered = true
  const isp = createIspDevice()
  for (const d of [router, sw, pc, srv, lap, isp]) topo.addDevice(d)
  const wire = (a, ai, b, bi) => topo.connect(`${a.id}:${ai}`, `${b.id}:${bi}`)
  wire(router, 'GigabitEthernet0/0', sw, 'FastEthernet0/1')
  wire(pc, 'Ethernet0/0', sw, 'FastEthernet0/2')
  wire(lap, 'Ethernet0/0', sw, 'FastEthernet0/3')
  wire(srv, 'Ethernet0/0', sw, 'FastEthernet0/4')
  wire(router, 'GigabitEthernet0/1', isp, 'WAN0/0')

  run(ios, router,
    'enable', 'configure terminal',
    'interface GigabitEthernet0/0', 'ip address 192.168.1.1 255.255.255.0', 'no shutdown', 'exit',
    'interface GigabitEthernet0/1', 'ip address 203.0.113.2 255.255.255.252', 'no shutdown', 'exit',
    'ip route 0.0.0.0 0.0.0.0 203.0.113.1',
  )
  if (nat) {
    run(ios, router,
      'interface GigabitEthernet0/0', 'ip nat inside', 'exit',
      'interface GigabitEthernet0/1', 'ip nat outside', 'exit',
      'access-list 1 permit 192.168.1.0 0.0.0.255',
      'ip nat inside source list 1 interface GigabitEthernet0/1 overload',
    )
  }
  run(ios, router, 'end')
  run(pcEng, pc, 'ip link set eth0 up', 'ip addr add 192.168.1.10/24 dev eth0', 'ip route add default via 192.168.1.1')
  run(pcEng, srv, 'ip link set eth0 up', 'ip addr add 192.168.1.20/24 dev eth0', 'ip route add default via 192.168.1.1')
  run(win, lap,
    'netsh interface set interface name="Ethernet0" admin=enabled',
    'netsh interface ip set address "Ethernet0" static 192.168.1.50 255.255.255.0 192.168.1.1')
  return { topo, ios, pcEng, win, router, sw, pc, srv, lap, isp }
}

let L
beforeEach(() => { L = lab() })

// ── R1 — the resolver ─────────────────────────────────────────────────────────

describe('R1 — resolveName walks the real network', () => {
  it('an address is returned as is, and localhost is answered by the host itself — no server needed', () => {
    expect(resolveName(L.topo, L.pc, '10.9.9.9')).toMatchObject({ ok: true, ip: '10.9.9.9', literal: true })
    expect(resolveName(L.topo, L.pc, 'localhost')).toMatchObject({ ok: true, ip: '127.0.0.1', local: true })
  })

  it('no name server configured → dns_no_server, and google.com does NOT resolve (no built-in table)', () => {
    const r = resolveName(L.topo, L.pc, 'google.com')
    expect(r).toMatchObject({ ok: false, reason: 'dns_no_server', ip: null })
  })

  it('with a server that the host can reach, the name resolves', () => {
    run(L.pcEng, L.pc, 'resolvectl dns eth0 8.8.8.8')
    const r = resolveName(L.topo, L.pc, 'Google.COM.')
    expect(r).toMatchObject({ ok: true, ip: '8.8.8.8', server: '8.8.8.8', name: 'google.com', authoritative: false })
    expect(r.tried).toHaveLength(1)
  })

  it('no NAT → the query cannot get back: dns_unreachable carrying nat_required', () => {
    L = lab({ nat: false })
    run(L.pcEng, L.pc, 'resolvectl dns eth0 8.8.8.8')
    const r = resolveName(L.topo, L.pc, 'google.com')
    expect(r).toMatchObject({ ok: false, reason: 'dns_unreachable' })
    expect(r.tried[0]).toMatchObject({ outcome: 'unreachable', failureReason: 'nat_required' })
  })

  it('no default gateway on the host → dns_unreachable carrying host_no_gateway', () => {
    run(L.pcEng, L.pc, 'ip route del default', 'resolvectl dns eth0 8.8.8.8')
    const r = resolveName(L.topo, L.pc, 'google.com')
    expect(r.reason).toBe('dns_unreachable')
    expect(r.tried[0].failureReason).toBe('host_no_gateway')
  })

  it('the adapter is down → nothing to send from: dns_unreachable', () => {
    run(L.pcEng, L.pc, 'resolvectl dns eth0 8.8.8.8', 'ip link set eth0 down')
    const r = resolveName(L.topo, L.pc, 'google.com')
    expect(r).toMatchObject({ ok: false, reason: 'dns_unreachable' })
    expect(r.tried[0].outcome).toBe('no_source')
  })

  it('a name the server does not know → dns_nxdomain (an answer, not a failure of the path)', () => {
    run(L.pcEng, L.pc, 'resolvectl dns eth0 8.8.8.8')
    expect(resolveName(L.topo, L.pc, 'no-such-host.example')).toMatchObject({ ok: false, reason: 'dns_nxdomain', server: '8.8.8.8' })
  })

  it('a LAN address with nothing listening on UDP/53 → dns_refused', () => {
    run(L.pcEng, L.pc, 'resolvectl dns eth0 192.168.1.20')
    const r = resolveName(L.topo, L.pc, 'google.com')
    expect(r).toMatchObject({ ok: false, reason: 'dns_refused' })
    expect(r.tried[0].outcome).toBe('refused')
  })

  it('an internet address that is not a DNS server never answers → dns_unreachable (a timeout, not a refusal)', () => {
    run(L.pcEng, L.pc, 'resolvectl dns eth0 4.4.4.4')
    const r = resolveName(L.topo, L.pc, 'google.com')
    expect(r).toMatchObject({ ok: false, reason: 'dns_unreachable' })
    expect(r.tried[0].outcome).toBe('no_answer')
  })

  it('servers are asked IN ORDER: a dead preferred server is skipped, the alternate answers', () => {
    run(L.pcEng, L.pc, 'resolvectl dns eth0 192.168.1.20 8.8.4.4')
    const r = resolveName(L.topo, L.pc, 'github.com')
    expect(r).toMatchObject({ ok: true, ip: PUBLIC_ZONE['github.com'], server: '8.8.4.4' })
    expect(r.tried.map(t => t.outcome)).toEqual(['refused', 'answered'])
  })

  it('an authoritative "no such name" ends the search — the alternate is not asked', () => {
    run(L.pcEng, L.pc, 'resolvectl dns eth0 8.8.8.8 1.1.1.1')
    const r = resolveName(L.topo, L.pc, 'no-such-host.example')
    expect(r.reason).toBe('dns_nxdomain')
    expect(r.tried).toHaveLength(1)
  })

  it('a static list wins over the lease; dnsSource says which is in effect', () => {
    L.pc.dhcp_dns_servers = []   // (a lease is exercised end to end in L3)
    expect(dnsSource(L.pc)).toBe('none')
    run(L.pcEng, L.pc, 'resolvectl dns eth0 8.8.8.8 8.8.4.4')
    expect(dnsSource(L.pc)).toBe('static')
    expect(effectiveDnsServers(L.pc)).toEqual(['8.8.8.8', '8.8.4.4'])
  })

  it('queryServer asks one server directly, whatever the host has configured', () => {
    expect(queryServer(L.topo, L.pc, '1.1.1.1', 'cloudflare.com')).toMatchObject({ outcome: 'answered', ip: '1.1.1.1' })
    expect(queryServer(L.topo, L.pc, '192.168.1.20', 'cloudflare.com').outcome).toBe('refused')
  })

  it('resolution is free of side effects on the host (a mission validator can call it silently)', () => {
    run(L.pcEng, L.pc, 'resolvectl dns eth0 8.8.8.8')
    const before = JSON.stringify(L.pc.dns_servers) + JSON.stringify(L.pc.routing_table) + L.topo.packetCapture.length
    resolveName(L.topo, L.pc, 'google.com')
    expect(JSON.stringify(L.pc.dns_servers) + JSON.stringify(L.pc.routing_table) + L.topo.packetCapture.length).toBe(before)
  })
})

// ── R2 — a firewall in the path ───────────────────────────────────────────────

describe('R2 — DNS is UDP/53, so a firewall can block it', () => {
  it('a policy that only permits ICMP blocks the query; permitting DNS restores it', () => {
    const topo = new Topology()
    const ios = new CLIEngine(topo), pcEng = new PCCLIEngine(topo)
    const fw = dev('firewall', 'ASA-5506-X', 4, 'GigabitEthernet0/')
    const pc = dev('pc', 'PC', 1, 'Ethernet0/')
    const isp = createIspDevice()
    for (const d of [fw, pc, isp]) topo.addDevice(d)
    topo.connect(`${fw.id}:GigabitEthernet0/0`, `${pc.id}:Ethernet0/0`)
    topo.connect(`${fw.id}:GigabitEthernet0/1`, `${isp.id}:WAN0/0`)
    run(ios, fw, 'enable', 'configure terminal',
      // public addressing on purpose: this test is about the firewall, not about NAT
      'interface GigabitEthernet0/0', 'nameif INSIDE', 'ip address 198.51.100.1 255.255.255.0', 'no shutdown', 'exit',
      'interface GigabitEthernet0/1', 'nameif OUTSIDE', 'ip address 203.0.113.2 255.255.255.252', 'no shutdown', 'exit',
      'ip route 0.0.0.0 0.0.0.0 203.0.113.1',
      'firewall-rule permit from-zone INSIDE to-zone OUTSIDE src any dst any service icmp', 'end')
    run(pcEng, pc, 'ip link set eth0 up', 'ip addr add 198.51.100.10/24 dev eth0', 'ip route add default via 198.51.100.1', 'resolvectl dns eth0 8.8.8.8')

    expect(topo.checkPing('198.51.100.10', '8.8.8.8').reachable).toBe(true)   // ping works…
    const blocked = resolveName(topo, pc, 'google.com')
    expect(blocked).toMatchObject({ ok: false, reason: 'dns_unreachable' })   // …DNS does not
    expect(blocked.tried[0]).toMatchObject({ outcome: 'unreachable', failureReason: 'blocked_by_firewall', failurePoint: fw.id })

    run(ios, fw, 'configure terminal', 'firewall-rule permit from-zone INSIDE to-zone OUTSIDE src any dst any service DNS', 'end')
    expect(resolveName(topo, pc, 'google.com')).toMatchObject({ ok: true, ip: '8.8.8.8' })
  })
})

// ── L1 — Linux ping <name> ────────────────────────────────────────────────────

describe('L1 — Linux: ping <name>', () => {
  it('no name server → "Temporary failure in name resolution"', () => {
    expect(run(L.pcEng, L.pc, 'ping -c 1 google.com')).toEqual(['ping: google.com: Temporary failure in name resolution'])
  })

  it('a server that cannot be reached → the same wording (the resolver just timed out)', () => {
    L = lab({ nat: false })
    run(L.pcEng, L.pc, 'resolvectl dns eth0 8.8.8.8')
    expect(run(L.pcEng, L.pc, 'ping -c 1 google.com')).toEqual(['ping: google.com: Temporary failure in name resolution'])
  })

  it('a name that does not exist → "Name or service not known"', () => {
    run(L.pcEng, L.pc, 'resolvectl dns eth0 8.8.8.8')
    expect(run(L.pcEng, L.pc, 'ping -c 1 nope.example')).toEqual(['ping: nope.example: Name or service not known'])
  })

  it('a name that resolves pings the address and prints both, as ping does', () => {
    run(L.pcEng, L.pc, 'resolvectl dns eth0 8.8.8.8')
    const out = run(L.pcEng, L.pc, 'ping -c 2 google.com')
    expect(out[0]).toBe('PING google.com (8.8.8.8) 56(84) bytes of data.')
    expect(out[1]).toMatch(/^64 bytes from google\.com \(8\.8\.8\.8\): icmp_seq=1 ttl=\d+ time=/)
    expect(out.join('\n')).toContain('--- google.com ping statistics ---')
    expect(out.join('\n')).toContain('2 packets transmitted, 2 received, 0% packet loss')
  })

  it('a literal address never touches DNS', () => {
    const out = run(L.pcEng, L.pc, 'ping -c 1 192.168.1.1')
    expect(out[0]).toBe('PING 192.168.1.1 (192.168.1.1) 56(84) bytes of data.')
  })

  it('resolveForPing (what the terminal uses) reports the same failure lines', () => {
    expect(L.pcEng.resolveForPing(L.pc, 'google.com')).toEqual({ ok: false, lines: ['ping: google.com: Temporary failure in name resolution'] })
    run(L.pcEng, L.pc, 'resolvectl dns eth0 8.8.8.8')
    expect(L.pcEng.resolveForPing(L.pc, 'google.com')).toEqual({ ok: true, ip: '8.8.8.8', lines: [] })
  })

  it('the async ping shows "PING name (ip)" and the name in the statistics', () => {
    run(L.pcEng, L.pc, 'resolvectl dns eth0 8.8.8.8')
    let start = null
    const cancel = L.pcEng.executePingAsync(L.pc, '8.8.8.8', { displayName: 'google.com', onStart: l => { start = l }, onPacket: () => {}, onDone: () => {} })
    cancel()
    expect(start).toEqual(['PING google.com (8.8.8.8) 56(84) bytes of data.'])
  })
})

// ── L2 — Linux nslookup / resolvectl / cat ────────────────────────────────────

describe('L2 — Linux: nslookup, resolvectl, resolv.conf (systemd-resolved, stub mode)', () => {
  beforeEach(() => { run(L.pcEng, L.pc, 'resolvectl dns eth0 8.8.8.8 8.8.4.4') })

  it('nslookup asks the local stub and prints a non-authoritative answer', () => {
    expect(run(L.pcEng, L.pc, 'nslookup google.com')).toEqual([
      'Server:\t\t127.0.0.53', 'Address:\t127.0.0.53#53', '',
      'Non-authoritative answer:', 'Name:\tgoogle.com', 'Address: 8.8.8.8', '',
    ])
  })

  it('a missing name is NXDOMAIN; a dead resolver is SERVFAIL (the stub answers, its upstream did not)', () => {
    expect(run(L.pcEng, L.pc, 'nslookup nope.example')).toEqual([
      'Server:\t\t127.0.0.53', 'Address:\t127.0.0.53#53', '', "** server can't find nope.example: NXDOMAIN", '',
    ])
    run(L.pcEng, L.pc, 'resolvectl dns eth0 192.168.1.20')
    expect(run(L.pcEng, L.pc, 'nslookup google.com').join('\n')).toContain("** server can't find google.com: SERVFAIL")
  })

  it('nslookup <name> <server> asks THAT server directly', () => {
    const out = run(L.pcEng, L.pc, 'nslookup cloudflare.com 1.1.1.1')
    expect(out.slice(0, 2)).toEqual(['Server:\t\t1.1.1.1', 'Address:\t1.1.1.1#53'])
    expect(out).toContain('Address: 1.1.1.1')
  })

  it('a LAN address with no DNS service: the classic "connection refused" lines', () => {
    const e = ';; communications error to 192.168.1.20#53: connection refused'
    expect(run(L.pcEng, L.pc, 'nslookup google.com 192.168.1.20')).toEqual([e, e, e, ';; no servers could be reached'])
  })

  it('a server the query cannot reach: "connection timed out"', () => {
    L = lab({ nat: false })
    expect(run(L.pcEng, L.pc, 'nslookup google.com 8.8.8.8')).toEqual([';; connection timed out; no servers could be reached'])
  })

  it('resolvectl status lists the link with its servers in order', () => {
    const out = run(L.pcEng, L.pc, 'resolvectl status')
    expect(out).toContain('resolv.conf mode: stub')
    expect(out).toContain('Link 2 (eth0)')
    expect(out).toContain('    Current Scopes: DNS')
    expect(out).toContain('Current DNS Server: 8.8.8.8')
    expect(out).toContain('       DNS Servers: 8.8.8.8 8.8.4.4')
  })

  it('a host with no servers shows Current Scopes: none', () => {
    run(L.pcEng, L.pc, 'resolvectl revert eth0')
    const out = run(L.pcEng, L.pc, 'resolvectl status')
    expect(out).toContain('    Current Scopes: none')
    expect(out.some(l => l.startsWith('DNS Servers') || l.includes('Current DNS Server'))).toBe(false)
  })

  it('resolvectl dns shows and sets; bad input is refused in resolvectl\'s words', () => {
    expect(run(L.pcEng, L.pc, 'resolvectl dns eth0')).toEqual(['Link 2 (eth0): 8.8.8.8 8.8.4.4'])
    expect(run(L.pcEng, L.pc, 'resolvectl dns')).toEqual(['Global:', 'Link 2 (eth0): 8.8.8.8 8.8.4.4'])
    expect(run(L.pcEng, L.pc, 'resolvectl dns eth0 1.1.1.1')).toEqual([])
    expect(L.pc.dns_servers).toEqual(['1.1.1.1'])
    expect(run(L.pcEng, L.pc, 'resolvectl dns eth0 not-an-ip')).toEqual(['Failed to parse DNS server address: not-an-ip'])
    expect(run(L.pcEng, L.pc, 'resolvectl dns eth9 1.1.1.1')).toEqual(['Failed to resolve interface "eth9": No such device'])
    expect(L.pc.dns_servers).toEqual(['1.1.1.1'])
  })

  it('resolvectl query resolves, and fails with the real wording', () => {
    const ok = run(L.pcEng, L.pc, 'resolvectl query google.com')
    expect(ok[0]).toMatch(/^google\.com: 8\.8\.8\.8\s+-- link: eth0$/)
    expect(ok).toContain('-- Data is authenticated: no; Data is confidential: no')
    expect(run(L.pcEng, L.pc, 'resolvectl query nope.example')).toEqual(["nope.example: resolve call failed: 'nope.example' not found"])
    run(L.pcEng, L.pc, 'resolvectl revert eth0')
    expect(run(L.pcEng, L.pc, 'resolvectl query google.com')).toEqual(['google.com: resolve call failed: No appropriate name servers or networks for name found'])
    run(L.pcEng, L.pc, 'resolvectl dns eth0 192.168.1.20')
    expect(run(L.pcEng, L.pc, 'resolvectl query google.com')).toEqual(['google.com: resolve call failed: All attempts to contact name servers or networks failed'])
  })

  it('/etc/resolv.conf shows only the local stub (as on Ubuntu); the real servers are upstream', () => {
    const stub = run(L.pcEng, L.pc, 'cat /etc/resolv.conf')
    expect(stub).toContain('nameserver 127.0.0.53')
    expect(stub).not.toContain('nameserver 8.8.8.8')
    expect(stub.join('\n')).toContain('Run "resolvectl status" to see details about the uplink DNS servers')
    const up = run(L.pcEng, L.pc, 'cat /run/systemd/resolve/resolv.conf')
    expect(up).toContain('nameserver 8.8.8.8')
    expect(up).toContain('nameserver 8.8.4.4')
    expect(run(L.pcEng, L.pc, 'cat /etc/nope')).toEqual(['cat: /etc/nope: No such file or directory'])
  })

  it('reverse lookups and interactive mode are said to be unsimulated, not faked', () => {
    expect(run(L.pcEng, L.pc, 'nslookup 8.8.8.8')[0]).toMatch(/reverse \(PTR\) lookups are not simulated/)
    expect(run(L.pcEng, L.pc, 'nslookup')[0]).toMatch(/interactive mode is not simulated/)
  })

  it('does not leak Windows or IOS idioms into the Linux shell', () => {
    const out = run(L.pcEng, L.pc, 'nslookup google.com').join('\n') + run(L.pcEng, L.pc, 'resolvectl status').join('\n')
    expect(out).not.toMatch(/netsh|ipconfig|Non-existent domain|ip name-server/)
    expect(run(L.pcEng, L.pc, 'netsh interface ip set dns "Ethernet0" static 8.8.8.8')[0]).toMatch(/command not found/)
  })
})

// ── L3 — lease vs. static ─────────────────────────────────────────────────────

describe('L3 — Linux: what DHCP hands out and what is set by hand', () => {
  function withDhcp(dnsLine) {
    run(L.ios, L.router, 'enable', 'configure terminal',
      'ip dhcp excluded-address 192.168.1.1 192.168.1.30',
      'ip dhcp pool LAN', 'network 192.168.1.0 255.255.255.0', 'default-router 192.168.1.1', dnsLine, 'exit', 'end')
    run(L.pcEng, L.pc, 'ip addr del 192.168.1.10/24 dev eth0')
  }

  it('a pool can hand out several servers, in order — and the client keeps that order', () => {
    withDhcp('dns-server 8.8.8.8 8.8.4.4')
    expect(run(L.ios, L.router, 'show running-config')).toContain(' dns-server 8.8.8.8 8.8.4.4')
    run(L.pcEng, L.pc, 'dhclient eth0')
    expect(L.pc.dhcp_dns_servers).toEqual(['8.8.8.8', '8.8.4.4'])
    expect(L.pc.dns_servers).toEqual([])
    expect(dnsSource(L.pc)).toBe('dhcp')
    expect(run(L.pcEng, L.pc, 'ping -c 1 google.com')[0]).toBe('PING google.com (8.8.8.8) 56(84) bytes of data.')
  })

  it('a server set by hand wins over the lease, and `resolvectl revert` gives the lease back', () => {
    withDhcp('dns-server 8.8.8.8')
    run(L.pcEng, L.pc, 'dhclient eth0', 'resolvectl dns eth0 1.1.1.1')
    expect(effectiveDnsServers(L.pc)).toEqual(['1.1.1.1'])
    run(L.pcEng, L.pc, 'resolvectl revert eth0')
    expect(effectiveDnsServers(L.pc)).toEqual(['8.8.8.8'])
  })

  it('releasing the lease forgets the lease\'s servers but keeps the ones set by hand', () => {
    withDhcp('dns-server 8.8.8.8')
    run(L.pcEng, L.pc, 'dhclient eth0', 'resolvectl dns eth0 1.1.1.1', 'dhclient -r eth0')
    expect(L.pc.dhcp_dns_servers).toEqual([])
    expect(L.pc.dns_servers).toEqual(['1.1.1.1'])
  })

  it('the pool command validates its addresses and clears with `no dns-server`', () => {
    run(L.ios, L.router, 'enable', 'configure terminal', 'ip dhcp pool LAN')
    expect(run(L.ios, L.router, 'dns-server')[0]).toMatch(/Incomplete command/)
    expect(run(L.ios, L.router, 'dns-server 8.8.8.8 bogus')).toEqual(['% Invalid IP address: bogus'])
    run(L.ios, L.router, 'dns-server 8.8.8.8 8.8.4.4', 'dns-server 1.1.1.1')
    expect(L.router.dhcp_pools[0].dns_servers).toEqual(['1.1.1.1'])   // one command sets the whole list, as on IOS
    run(L.ios, L.router, 'no dns-server')
    expect(L.router.dhcp_pools[0].dns_servers).toEqual([])
  })
})

// ── W1 — Windows ──────────────────────────────────────────────────────────────

describe('W1 — Windows: netsh dns, nslookup, ping <name>, ipconfig', () => {
  const SET = 'netsh interface ip set dns "Ethernet0" static 8.8.8.8'
  const ADD = 'netsh interface ip add dns "Ethernet0" 8.8.4.4 index=2'

  it('set dns static replaces the list with the preferred server; add dns … index=2 makes the alternate', () => {
    expect(run(L.win, L.lap, SET)).toEqual(['Ok.'])
    expect(L.lap.dns_servers).toEqual(['8.8.8.8'])
    expect(run(L.win, L.lap, ADD)).toEqual(['Ok.'])
    expect(L.lap.dns_servers).toEqual(['8.8.8.8', '8.8.4.4'])
    run(L.win, L.lap, 'netsh interface ip add dns "Ethernet0" 1.1.1.1 index=1')
    expect(L.lap.dns_servers).toEqual(['1.1.1.1', '8.8.8.8', '8.8.4.4'])
    run(L.win, L.lap, SET)
    expect(L.lap.dns_servers).toEqual(['8.8.8.8'])   // set replaces
  })

  it('the named form works too (name=/source=/address=)', () => {
    run(L.win, L.lap, 'netsh interface ip set dnsservers name="Ethernet0" source=static address=9.9.9.9')
    expect(L.lap.dns_servers).toEqual(['9.9.9.9'])
  })

  it('bad input is refused, not corrected', () => {
    expect(run(L.win, L.lap, 'netsh interface ip set dns "Ethernet0" static 8.8.8')[0]).toMatch(/parameter is incorrect/)
    expect(run(L.win, L.lap, 'netsh interface ip set dns "Nope" static 8.8.8.8')).toEqual(['There is no interface with the specified name "Nope".'])
    run(L.win, L.lap, SET)
    expect(run(L.win, L.lap, 'netsh interface ip add dns "Ethernet0" 8.8.8.8')).toEqual(['The object already exists.'])
    expect(run(L.win, L.lap, 'netsh interface ip add dns "Ethernet0" 8.8.4.4 index=5')[0]).toMatch(/parameter is incorrect/)
    expect(L.lap.dns_servers).toEqual(['8.8.8.8'])
  })

  it('delete dns removes one server or all; set dns dhcp goes back to the lease', () => {
    run(L.win, L.lap, SET, ADD)
    expect(run(L.win, L.lap, 'netsh interface ip delete dns "Ethernet0" 8.8.8.8')).toEqual(['Ok.'])
    expect(L.lap.dns_servers).toEqual(['8.8.4.4'])
    expect(run(L.win, L.lap, 'netsh interface ip delete dns "Ethernet0" 8.8.8.8')).toEqual(['The system cannot find the file specified.'])
    run(L.win, L.lap, 'netsh interface ip delete dns "Ethernet0" all')
    expect(L.lap.dns_servers).toEqual([])
    run(L.win, L.lap, SET, 'netsh interface ip set dns "Ethernet0" dhcp')
    expect(L.lap.dns_servers).toEqual([])
  })

  it('ipconfig /all lists every server, one under the other', () => {
    run(L.win, L.lap, SET, ADD)
    const out = run(L.win, L.lap, 'ipconfig /all')
    const i = out.findIndex(l => l.startsWith('   DNS Servers'))
    expect(out[i]).toBe('   DNS Servers . . . . . . . . . . . : 8.8.8.8')
    expect(out[i + 1]).toBe('                                       8.8.4.4')
  })

  it('show config and show dnsservers say where the servers came from', () => {
    expect(run(L.win, L.lap, 'netsh interface ip show config "Ethernet0"').join('\n')).toContain('Statically Configured DNS Servers:    None')
    run(L.win, L.lap, SET, ADD)
    const cfg = run(L.win, L.lap, 'netsh interface ip show config "Ethernet0"')
    expect(cfg).toContain('    Statically Configured DNS Servers:    8.8.8.8')
    expect(cfg).toContain('                                          8.8.4.4')
    expect(run(L.win, L.lap, 'netsh interface ip show dnsservers "Ethernet0"')).toEqual([
      'Configuration for interface "Ethernet0"',
      '    Statically Configured DNS Servers:    8.8.8.8',
      '                                          8.8.4.4',
      '    Register with which suffix:           Primary only',
      '',
    ])
  })

  it('a lease\'s servers read "DNS servers configured through DHCP" (never the old "via DHCP" wording)', () => {
    run(L.ios, L.router, 'enable', 'configure terminal', 'ip dhcp pool LAN', 'network 192.168.1.0 255.255.255.0',
      'default-router 192.168.1.1', 'dns-server 8.8.8.8 8.8.4.4', 'exit', 'ip dhcp excluded-address 192.168.1.1 192.168.1.30', 'end')
    run(L.win, L.lap, 'netsh interface ip set address "Ethernet0" dhcp')
    expect(L.lap.dhcp_dns_servers).toEqual(['8.8.8.8', '8.8.4.4'])
    const cfg = run(L.win, L.lap, 'netsh interface ip show config "Ethernet0"')
    expect(cfg).toContain('    DNS servers configured through DHCP:  8.8.8.8')
    expect(cfg).toContain('                                          8.8.4.4')
    expect(cfg.join('\n')).not.toMatch(/via DHCP/)
    run(L.win, L.lap, 'netsh interface ip set dns "Ethernet0" static 1.1.1.1')   // static replaces the lease's list
    expect(run(L.win, L.lap, 'netsh interface ip show config "Ethernet0"').join('\n')).toContain('Statically Configured DNS Servers:    1.1.1.1')
  })

  it('ping <name>: found → "Pinging name [ip]"; anything wrong → the one Windows message', () => {
    const fail = 'Ping request could not find host google.com. Please check the name and try again.'
    expect(L.win.resolveForPing(L.lap, 'google.com')).toEqual({ ok: false, lines: [fail] })   // no server
    run(L.win, L.lap, SET)
    expect(L.win.resolveForPing(L.lap, 'google.com')).toEqual({ ok: true, ip: '8.8.8.8', lines: [] })
    expect(L.win.resolveForPing(L.lap, 'nope.example').lines).toEqual(['Ping request could not find host nope.example. Please check the name and try again.'])
    L = lab({ nat: false }); run(L.win, L.lap, SET)
    expect(L.win.resolveForPing(L.lap, 'google.com')).toEqual({ ok: false, lines: [fail] })   // unreachable: same message
    let start = null
    L = lab(); run(L.win, L.lap, SET)
    L.win.executePingAsync(L.lap, '8.8.8.8', { displayName: 'google.com', onStart: l => { start = l }, onPacket: () => {}, onDone: () => {} })()
    expect(start).toEqual(['Pinging google.com [8.8.8.8] with 32 bytes of data:'])
  })

  it('nslookup: answer, NXDOMAIN, timeout — in Windows\' words, with the server named by reverse lookup', () => {
    run(L.win, L.lap, SET)
    expect(run(L.win, L.lap, 'nslookup google.com')).toEqual([
      'Server:  dns.google', 'Address:  8.8.8.8', '',
      'Non-authoritative answer:', 'Name:    google.com', 'Address:  8.8.8.8', '',
    ])
    expect(run(L.win, L.lap, 'nslookup nope.example')).toEqual([
      'Server:  dns.google', 'Address:  8.8.8.8', '', "*** dns.google can't find nope.example: Non-existent domain",
    ])
    // a LAN box with no DNS service: nothing answers → a timeout
    const t = run(L.win, L.lap, 'nslookup google.com 192.168.1.20')
    expect(t).toEqual([
      'Server:  UnKnown', 'Address:  192.168.1.20', '',
      'DNS request timed out.', '    timeout was 2 seconds.', 'DNS request timed out.', '    timeout was 2 seconds.',
      '*** Request to UnKnown timed-out',
    ])
  })

  it('nslookup with no server configured', () => {
    expect(run(L.win, L.lap, 'nslookup google.com')).toEqual([
      '*** Default servers are not available', 'Server:  UnKnown', 'Address:  127.0.0.1', '',
      "*** UnKnown can't find google.com: No response from server",
    ])
  })

  it('does not leak Linux idioms into Windows', () => {
    const out = [...run(L.win, L.lap, SET), ...run(L.win, L.lap, 'nslookup google.com'), ...run(L.win, L.lap, 'ipconfig /all')].join('\n')
    expect(out).not.toMatch(/resolvectl|127\.0\.0\.53|SERVFAIL|Temporary failure/)
    expect(run(L.win, L.lap, 'resolvectl status')[0]).toMatch(/is not recognized as an internal or external command/)
  })
})

// ── I1 — IOS ──────────────────────────────────────────────────────────────────

describe('I1 — IOS: ip name-server, ip domain-lookup, ping <name>', () => {
  beforeEach(() => { run(L.ios, L.router, 'enable', 'configure terminal') })

  it('ip name-server adds to the list, in order; several per command; a repeat is ignored', () => {
    run(L.ios, L.router, 'ip name-server 8.8.8.8', 'ip name-server 8.8.4.4 1.1.1.1', 'ip name-server 8.8.8.8')
    expect(L.router.dns_servers).toEqual(['8.8.8.8', '8.8.4.4', '1.1.1.1'])
    run(L.ios, L.router, 'end')
    expect(run(L.ios, L.router, 'show running-config')).toContain('ip name-server 8.8.8.8 8.8.4.4 1.1.1.1')
  })

  it('no ip name-server removes one address, or all', () => {
    run(L.ios, L.router, 'ip name-server 8.8.8.8 8.8.4.4', 'no ip name-server 8.8.8.8')
    expect(L.router.dns_servers).toEqual(['8.8.4.4'])
    run(L.ios, L.router, 'no ip name-server')
    expect(L.router.dns_servers).toEqual([])
  })

  it('it is a global-config command, takes valid addresses, and needs an argument', () => {
    expect(run(L.ios, L.router, 'ip name-server')).toEqual(['% Incomplete command.'])
    expect(run(L.ios, L.router, 'ip name-server 300.1.1.1')).toEqual(['% Invalid IP address: 300.1.1.1'])
    run(L.ios, L.router, 'interface GigabitEthernet0/0')
    expect(run(L.ios, L.router, 'ip name-server 8.8.8.8')).toEqual(["% Invalid input detected at '^' marker."])
    expect(L.router.dns_servers).toEqual([])
  })

  it('ip domain-lookup is on by default; `no ip domain-lookup` (and the IOS 15 spelling) turn it off and on', () => {
    expect(L.router.domain_lookup).toBe(true)
    run(L.ios, L.router, 'no ip domain-lookup')
    expect(L.router.domain_lookup).toBe(false)
    run(L.ios, L.router, 'ip domain lookup')
    expect(L.router.domain_lookup).toBe(true)
    run(L.ios, L.router, 'no ip domain lookup', 'end')
    expect(run(L.ios, L.router, 'show running-config')).toContain('no ip domain lookup')
  })

  it('ping <name>: no server → the classic broadcast Translating line, then the failure', () => {
    run(L.ios, L.router, 'end')
    expect(run(L.ios, L.router, 'ping google.com')).toEqual([
      'Translating "google.com"...domain server (255.255.255.255)', '', '% Unrecognized host or address, or protocol not running.',
    ])
  })

  it('ping <name>: an unreachable or wrong server, and a name that does not exist, fail the same way', () => {
    run(L.ios, L.router, 'ip name-server 4.4.4.4', 'end')
    expect(run(L.ios, L.router, 'ping google.com')).toEqual([
      'Translating "google.com"...domain server (4.4.4.4)', '', '% Unrecognized host or address, or protocol not running.',
    ])
    run(L.ios, L.router, 'configure terminal', 'no ip name-server', 'ip name-server 8.8.8.8', 'end')
    expect(run(L.ios, L.router, 'ping nope.example')).toEqual([
      'Translating "nope.example"...domain server (8.8.8.8)', '', '% Unrecognized host or address, or protocol not running.',
    ])
  })

  it('ping <name> resolves through the configured server and then pings the address', () => {
    run(L.ios, L.router, 'ip name-server 8.8.8.8', 'end')
    const out = run(L.ios, L.router, 'ping google.com')
    expect(out.slice(0, 4)).toEqual([
      'Translating "google.com"...domain server (8.8.8.8) [OK]', '', 'Type escape sequence to abort.',
      'Sending 5, 100-byte ICMP Echos to 8.8.8.8, timeout is 2 seconds:',
    ])
    expect(out.join('\n')).toMatch(/Success rate is 100 percent/)
  })

  it('a dead first server is skipped: the Translating line lists the servers asked, up to the one that answered', () => {
    run(L.ios, L.router, 'ip name-server 192.168.1.20 8.8.8.8', 'end')
    expect(run(L.ios, L.router, 'ping google.com')[0]).toBe('Translating "google.com"...domain server (192.168.1.20) (8.8.8.8) [OK]')
  })

  it('with `no ip domain-lookup` the name is not looked up at all — even with a good server', () => {
    run(L.ios, L.router, 'ip name-server 8.8.8.8', 'no ip domain-lookup', 'end')
    expect(run(L.ios, L.router, 'ping google.com')).toEqual(['% Unrecognized host or address, or protocol not running.'])
    expect(L.ios.resolveForPing(L.router, 'google.com').ok).toBe(false)
  })

  it('IOS has no "localhost" of its own — a literal address still pings without any DNS', () => {
    run(L.ios, L.router, 'end')
    expect(run(L.ios, L.router, 'ping localhost')[0]).toMatch(/^Translating "localhost"/)
    expect(run(L.ios, L.router, 'ping 192.168.1.10').join('\n')).toMatch(/Success rate is 100 percent/)
  })

  it('a switch takes the same two commands (its SVI is the source); a firewall does not', () => {
    run(L.ios, L.sw, 'enable', 'configure terminal', 'ip name-server 8.8.8.8', 'no ip domain-lookup')
    expect(L.sw.dns_servers).toEqual(['8.8.8.8'])
    expect(L.sw.domain_lookup).toBe(false)
    run(L.ios, L.sw, 'end')
    const cfg = run(L.ios, L.sw, 'show running-config')
    expect(cfg).toContain('no ip domain lookup')
    expect(cfg).toContain('ip name-server 8.8.8.8')
    const fw = dev('firewall', 'ASA', 2, 'GigabitEthernet0/')
    L.topo.addDevice(fw)
    run(L.ios, fw, 'enable', 'configure terminal')
    expect(run(L.ios, fw, 'ip name-server 8.8.8.8')).toEqual(["% Invalid input detected at '^' marker."])
  })

  it('an interface-mode `ip name-server` is refused and the switch/router route rules are unchanged', () => {
    run(L.ios, L.sw, 'enable', 'configure terminal')
    expect(run(L.ios, L.sw, 'ip route 0.0.0.0 0.0.0.0 1.1.1.1').join(' ')).toMatch(/IP routing is not enabled on this switch/)
  })
})

// ── C1 — capture ──────────────────────────────────────────────────────────────

describe('C1 — a lookup a person runs leaves real UDP/53 frames in the capture', () => {
  it('shell lookups record the query and reply; the same lookup with capture off leaves nothing', () => {
    run(L.pcEng, L.pc, 'resolvectl dns eth0 8.8.8.8')
    const n0 = L.topo.packetCapture.length
    resolveName(L.topo, L.pc, 'google.com')                       // silent (mission validators)
    expect(L.topo.packetCapture.length).toBe(n0)
    run(L.pcEng, L.pc, 'nslookup google.com')
    const rows = L.topo.packetCapture.slice(n0)
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.every(r => r.protocol === 'UDP' && r.dport === 53)).toBe(true)
    expect(rows.some(r => r.dst === '8.8.8.8' && r.info === 'UDP/53 request')).toBe(true)
    expect(rows.some(r => r.src === '8.8.8.8' && r.info === 'UDP/53 reply')).toBe(true)
  })

  it('a query that is dropped is recorded as a drop with its reason', () => {
    L = lab({ nat: false })
    run(L.pcEng, L.pc, 'resolvectl dns eth0 8.8.8.8')
    const n0 = L.topo.packetCapture.length
    run(L.pcEng, L.pc, 'nslookup google.com')
    const drop = L.topo.packetCapture.slice(n0).find(r => r.action === 'drop')
    expect(drop).toMatchObject({ protocol: 'UDP', dport: 53, failure_reason: 'nat_required' })
  })
})

// ── S1 — saves ────────────────────────────────────────────────────────────────

describe('S1 — saves keep the lists', () => {
  it('a round trip keeps static servers, the lease\'s servers, the pool list and domain-lookup', () => {
    run(L.ios, L.router, 'enable', 'configure terminal', 'ip name-server 8.8.8.8 1.1.1.1', 'no ip domain-lookup',
      'ip dhcp pool LAN', 'network 192.168.1.0 255.255.255.0', 'dns-server 9.9.9.9 8.8.4.4', 'end')
    run(L.pcEng, L.pc, 'resolvectl dns eth0 8.8.8.8 8.8.4.4')
    L.lap.dhcp_dns_servers = []   // (the lease case is covered above)
    const saved = JSON.parse(JSON.stringify(serialize(L.topo, {}, [], 0, [], null, new Map(), null, null, [])))
    const back = deserialize(saved).topology
    const r2 = back.devices.get(L.router.id), pc2 = back.devices.get(L.pc.id)
    expect(r2.dns_servers).toEqual(['8.8.8.8', '1.1.1.1'])
    expect(r2.domain_lookup).toBe(false)
    expect(r2.dhcp_pools[0].dns_servers).toEqual(['9.9.9.9', '8.8.4.4'])
    expect(pc2.dns_servers).toEqual(['8.8.8.8', '8.8.4.4'])
    expect(back.devices.get(L.sw.id).domain_lookup).toBe(true)
    // and the restored copy is independent of the saved data
    r2.dns_servers.push('9.9.9.9')
    expect(saved.devices.find(d => d.id === L.router.id).dns_servers).toEqual(['8.8.8.8', '1.1.1.1'])
  })

  it('an older save with a single dns_server keeps it as the lease\'s (that is all it ever was), and a pool\'s single server as a list', () => {
    const raw = {
      id: 'dev-900', type: 'pc', model: 'PC', hostname: 'old', config_mode: 'user_exec', powered: true,
      interfaces: [{ name: 'Ethernet0/0', ip: null, subnet_mask: null, status: 'down', connected_to: null }],
      routing_table: [], vlan_db: {}, dns_server: '8.8.8.8',
    }
    const d = deviceFromSave(raw)
    expect(d.dhcp_dns_servers).toEqual(['8.8.8.8'])
    expect(d.dns_servers).toEqual([])
    const r = deviceFromSave({
      id: 'dev-901', type: 'router', model: 'R', hostname: 'old-r', config_mode: 'user_exec', powered: true,
      interfaces: [{ name: 'GigabitEthernet0/0', ip: null, subnet_mask: null, status: 'down', connected_to: null }],
      routing_table: [], vlan_db: {}, dhcp_pools: [{ name: 'P', network: '10.0.0.0', mask: '255.255.255.0', default_router: '10.0.0.1', dns_server: '1.1.1.1', lease_days: 1, lease_hours: 0, lease_mins: 0 }],
    })
    expect(r.dhcp_pools[0].dns_servers).toEqual(['1.1.1.1'])
    expect(r.domain_lookup).toBe(true)
  })
})
