/**
 * subnet_mismatch — two ends of one Ethernet segment disagree about the subnet
 * because one of them has the wrong mask.
 *
 * Each host decides "on-link (ARP for it) or off-link (send to a gateway)" from ITS
 * OWN address and mask. When the masks disagree, the two directions fail differently:
 *
 *   SM1  sender's mask too narrow, sender has no route → the sender never transmits.
 *        Linux: `ping: connect: Network is unreachable`; Windows: `General failure`.
 *        failurePoint = the sender.
 *   SM2  same wrong mask, but the sender has a gateway → it hands the echo to the
 *        router, which delivers it on the shared segment. Real hosts get replies.
 *   SM3  receiver's mask too narrow, receiver has no route → the echo arrives (ARP
 *        worked) but the reply is never sent. The sender just sees timeouts — no
 *        local error, no ICMP error. failurePoint = the receiver; lostOnReturn = true.
 *   SM4  same, but the receiver has a gateway that can reach the sender → the reply
 *        goes via the router and the ping works.
 *   SM5  a router pinging a host whose mask excludes the router → timeouts (IOS `.....`).
 *   SM6  the Windows admin laptop gets the same diagnosis as a Linux host.
 *   SM7  genuine one-way routing through a router stays `no_return_path`.
 *
 * All state is built through the shells, as a player would.
 */
import { describe, it, expect } from 'vitest'
import { Device, createAdminLaptop } from '../Device.js'
import { Topology } from '../Topology.js'
import { CLIEngine } from '../CLIEngine.js'
import { PCCLIEngine } from '../PCCLIEngine.js'
import { WindowsCLIEngine } from '../WindowsCLIEngine.js'

const run = (eng, dev, ...cmds) => { let out = []; for (const c of cmds) out = eng.execute(dev, c); return out }

function dev(type, portCount, portPrefix, portStart) {
  const d = new Device({ type, model: `${type}-test`, portCount, portPrefix, portStart })
  d.powered = true
  return d
}

// PC1, PC2 and a router on one switch (all VLAN 1). Addresses are set by each test.
function lan() {
  const topo = new Topology()
  const ios = new CLIEngine(topo), lx = new PCCLIEngine(topo), win = new WindowsCLIEngine(topo)
  const sw = dev('switch', 4, 'GigabitEthernet0/', 1)
  const r1 = dev('router', 2, 'GigabitEthernet0/', 0)
  const pc1 = dev('pc', 1, 'Ethernet0/', 0)
  const pc2 = dev('pc', 1, 'Ethernet0/', 0)
  for (const d of [sw, r1, pc1, pc2]) topo.addDevice(d)
  topo.connect(`${sw.id}:GigabitEthernet0/1`, `${pc1.id}:Ethernet0/0`)
  topo.connect(`${sw.id}:GigabitEthernet0/2`, `${pc2.id}:Ethernet0/0`)
  topo.connect(`${sw.id}:GigabitEthernet0/3`, `${r1.id}:GigabitEthernet0/0`)
  const router = ip => run(ios, r1, 'enable', 'configure terminal',
    'interface GigabitEthernet0/0', `ip address ${ip} 255.255.255.0`, 'no shutdown', 'end')
  return { topo, ios, lx, win, sw, r1, pc1, pc2, router }
}

// Collect what an async ping prints, synchronously (the shells call onStart before any timer).
function asyncStart(eng, device, target) {
  let start = null, done = null
  const cancel = eng.executePingAsync(device, target, {
    onStart: l => { start = l }, onPacket: () => {}, onDone: l => { done = l },
  })
  cancel()
  return { start: (start ?? []).join('\n'), done }
}

describe('SM1 — sender mask too narrow, no route: the sender never transmits', () => {
  it('reports subnet_mismatch at the sender, not lost on return', () => {
    const { topo, lx, pc1, pc2 } = lan()
    run(lx, pc1, 'ip addr add 192.168.1.10/25 dev eth0', 'ip link set eth0 up')
    run(lx, pc2, 'ip addr add 192.168.1.200/24 dev eth0', 'ip link set eth0 up')
    const r = topo.checkPing('192.168.1.10', '192.168.1.200')
    expect(r.reachable).toBe(false)
    expect(r.failureReason).toBe('subnet_mismatch')
    expect(r.failurePoint).toBe(pc1.id)
    expect(r.lostOnReturn).toBe(false)
  })

  it('Linux prints the local error immediately (async ping)', () => {
    const { lx, pc1, pc2 } = lan()
    run(lx, pc1, 'ip addr add 192.168.1.10/25 dev eth0', 'ip link set eth0 up')
    run(lx, pc2, 'ip addr add 192.168.1.200/24 dev eth0', 'ip link set eth0 up')
    const { start, done } = asyncStart(lx, pc1, '192.168.1.200')
    expect(start).toMatch(/^ping: connect: Network is unreachable/)
    expect(done).toEqual([])
  })
})

describe('SM2 — sender mask too narrow but it has a gateway: the router delivers it', () => {
  it('is reachable (echo via the router, reply direct on the segment)', () => {
    const { topo, lx, pc1, pc2, router } = lan()
    router('192.168.1.1')
    run(lx, pc1, 'ip addr add 192.168.1.10/25 dev eth0', 'ip link set eth0 up', 'ip route add default via 192.168.1.1')
    run(lx, pc2, 'ip addr add 192.168.1.200/24 dev eth0', 'ip link set eth0 up')
    expect(topo.checkPing('192.168.1.10', '192.168.1.200').reachable).toBe(true)
  })
})

describe('SM3 — receiver mask too narrow, no route: the reply is never sent', () => {
  function build() {
    const L = lan()
    run(L.lx, L.pc1, 'ip addr add 192.168.1.10/24 dev eth0', 'ip link set eth0 up')
    run(L.lx, L.pc2, 'ip addr add 192.168.1.200/25 dev eth0', 'ip link set eth0 up')
    return L
  }

  it('reports subnet_mismatch at the receiver, lost on return', () => {
    const { topo, pc2 } = build()
    const r = topo.checkPing('192.168.1.10', '192.168.1.200')
    expect(r.reachable).toBe(false)
    expect(r.failureReason).toBe('subnet_mismatch')
    expect(r.failurePoint).toBe(pc2.id)
    expect(r.lostOnReturn).toBe(true)
  })

  it('pinging the other way fails at the (same) mis-masked host, before it transmits', () => {
    const { topo, pc2 } = build()
    const r = topo.checkPing('192.168.1.200', '192.168.1.10')
    expect(r.failureReason).toBe('subnet_mismatch')
    expect(r.failurePoint).toBe(pc2.id)
    expect(r.lostOnReturn).toBe(false)
  })

  it('Linux sender sees plain timeouts: no local error, no ICMP error lines', () => {
    const { lx, pc1 } = build()
    const out = run(lx, pc1, 'ping 192.168.1.200').join('\n')
    expect(out).not.toMatch(/Network is unreachable/)
    expect(out).not.toMatch(/Destination Host Unreachable/)
    expect(out).toMatch(/4 packets transmitted, 0 received, 100% packet loss/)
    expect(out).not.toMatch(/errors/)

    const { start } = asyncStart(lx, pc1, '192.168.1.200')
    expect(start).toBe('PING 192.168.1.200 (192.168.1.200) 56(84) bytes of data.')
  })

  it('the Linux terminal is told the packet was lost on the way back (no per-packet line)', () => {
    const { lx, pc1 } = build()
    const calls = []
    const cancel = lx.executePingAsync(pc1, '192.168.1.200', {
      onStart: () => {}, onPacket: (...a) => calls.push(a), onDone: () => {},
    })
    cancel()
    // first packet fires synchronously; 8th argument = lostOnReturn
    expect(calls[0][1]).toBe(false)
    expect(calls[0][4]).toBe('subnet_mismatch')
    expect(calls[0][7]).toBe(true)
  })

  it('fixing the mask restores the ping', () => {
    const { topo, lx, pc2 } = build()
    run(lx, pc2, 'ip addr del 192.168.1.200/25 dev eth0', 'ip addr add 192.168.1.200/24 dev eth0')
    expect(topo.checkPing('192.168.1.10', '192.168.1.200').reachable).toBe(true)
  })
})

describe('SM4 — receiver mask too narrow but its gateway reaches the sender', () => {
  it('is reachable (reply via the router)', () => {
    const { topo, lx, pc1, pc2, router } = lan()
    router('192.168.1.129')
    run(lx, pc1, 'ip addr add 192.168.1.10/24 dev eth0', 'ip link set eth0 up')
    run(lx, pc2, 'ip addr add 192.168.1.200/25 dev eth0', 'ip link set eth0 up', 'ip route add default via 192.168.1.129')
    expect(topo.checkPing('192.168.1.10', '192.168.1.200').reachable).toBe(true)
  })
})

describe('SM5 — a router pinging a host whose mask excludes the router', () => {
  it('subnet_mismatch at the host, lost on return; IOS shows timeouts', () => {
    const { topo, ios, lx, r1, pc2, router } = lan()
    router('192.168.1.1')
    run(lx, pc2, 'ip addr add 192.168.1.200/25 dev eth0', 'ip link set eth0 up')
    const r = topo.checkPing('192.168.1.1', '192.168.1.200')
    expect(r.failureReason).toBe('subnet_mismatch')
    expect(r.failurePoint).toBe(pc2.id)
    expect(r.lostOnReturn).toBe(true)

    const out = run(ios, r1, 'ping 192.168.1.200')
    expect(out).toContain('.....')
    expect(out).toContain('Success rate is 0 percent (0/5)')
    expect(out.join('\n')).not.toMatch(/Destination host unreachable/i)
  })
})

describe('SM6 — the Windows admin laptop', () => {
  function build(lapMask, pcPrefix) {
    const L = lan()
    const lap = createAdminLaptop(); lap.os_type = 'windows'; lap.powered = true
    L.topo.addDevice(lap)
    L.topo.connect(`${L.sw.id}:GigabitEthernet0/4`, `${lap.id}:Ethernet0/0`)
    run(L.win, lap, 'netsh interface set interface name="Ethernet0" admin=enabled',
      `netsh interface ip set address "Ethernet0" static 192.168.1.50 ${lapMask}`)
    run(L.lx, L.pc2, `ip addr add 192.168.1.200/${pcPrefix} dev eth0`, 'ip link set eth0 up')
    return { ...L, lap }
  }

  it('laptop mask too narrow → subnet_mismatch at the laptop; Windows "General failure"', () => {
    const { topo, win, lap } = build('255.255.255.128', 24)
    const r = topo.checkPing('192.168.1.50', '192.168.1.200')
    expect(r.failureReason).toBe('subnet_mismatch')
    expect(r.failurePoint).toBe(lap.id)
    const { start } = asyncStart(win, lap, '192.168.1.200')
    expect(start).toMatch(/PING: transmit failed\. General failure\./)
  })

  it('receiver mask too narrow → Windows sender just times out (no General failure)', () => {
    const { win, lap } = build('255.255.255.0', 25)
    const { start } = asyncStart(win, lap, '192.168.1.200')
    expect(start).toBe('Pinging 192.168.1.200 with 32 bytes of data:')
  })
})

describe('SM7 — real one-way routing is still no_return_path', () => {
  it('receiver on another subnet with no gateway → no_return_path, not subnet_mismatch', () => {
    const topo = new Topology()
    const ios = new CLIEngine(topo), lx = new PCCLIEngine(topo)
    const r1 = dev('router', 2, 'GigabitEthernet0/', 0)
    const pc1 = dev('pc', 1, 'Ethernet0/', 0), pc2 = dev('pc', 1, 'Ethernet0/', 0)
    for (const d of [r1, pc1, pc2]) topo.addDevice(d)
    topo.connect(`${r1.id}:GigabitEthernet0/0`, `${pc1.id}:Ethernet0/0`)
    topo.connect(`${r1.id}:GigabitEthernet0/1`, `${pc2.id}:Ethernet0/0`)
    run(ios, r1, 'enable', 'configure terminal',
      'interface GigabitEthernet0/0', 'ip address 10.0.1.1 255.255.255.0', 'no shutdown', 'exit',
      'interface GigabitEthernet0/1', 'ip address 10.0.2.1 255.255.255.0', 'no shutdown', 'end')
    run(lx, pc1, 'ip addr add 10.0.1.10/24 dev eth0', 'ip link set eth0 up', 'ip route add default via 10.0.1.1')
    run(lx, pc2, 'ip addr add 10.0.2.10/24 dev eth0', 'ip link set eth0 up')
    const r = topo.checkPing('10.0.1.10', '10.0.2.10')
    expect(r.failureReason).toBe('no_return_path')
    expect(r.lostOnReturn).toBe(true)
  })
})
