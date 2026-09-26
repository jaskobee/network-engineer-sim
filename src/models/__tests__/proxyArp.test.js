/**
 * Proxy ARP (IOS `ip proxy-arp`, enabled by default on every router interface) and the
 * rule underneath it: a device on an Ethernet segment only picks up a frame addressed
 * to it — to the next hop the sender chose (the destination itself when on-link, else
 * its gateway) — or, for a router with proxy ARP on, a frame for a destination it has
 * a specific route to out of ANOTHER interface.
 *
 *   PA1  host mask too wide (thinks a remote host is on-link) → router proxy-ARPs → works
 *   PA2  `no ip proxy-arp` on the host-facing interface → ARP fails → subnet_mismatch
 *   PA3  `ip proxy-arp` turns it back on; the far-side interface's setting is irrelevant
 *   PA4  the router only knows the destination through its default route → no proxy reply
 *   PA5  a frame for the host's gateway is not routed by some OTHER router on the segment
 *   PA6  CLI: running-config, show ip interface, rejected on switches and firewalls
 *
 * Note (PA4): IOS answers proxy ARP only from a specific route, not from 0.0.0.0/0.
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

const cfgIf = (ios, r, name, ...lines) =>
  run(ios, r, 'enable', 'configure terminal', `interface ${name}`, ...lines, 'end')

// PC1 on a switch with R1 Gi0/0 (192.168.1.1/24); PC2 behind R1 Gi0/1 (192.168.2.0/24).
// PC1's mask is /16, so it treats 192.168.2.5 as on-link and ARPs for it directly.
function wideMask() {
  const topo = new Topology()
  const ios = new CLIEngine(topo), lx = new PCCLIEngine(topo)
  const sw = dev('switch', 4, 'GigabitEthernet0/', 1)
  const r1 = dev('router', 2, 'GigabitEthernet0/', 0)
  const pc1 = dev('pc', 1, 'Ethernet0/', 0), pc2 = dev('pc', 1, 'Ethernet0/', 0)
  for (const d of [sw, r1, pc1, pc2]) topo.addDevice(d)
  topo.connect(`${sw.id}:GigabitEthernet0/1`, `${pc1.id}:Ethernet0/0`)
  topo.connect(`${sw.id}:GigabitEthernet0/3`, `${r1.id}:GigabitEthernet0/0`)
  topo.connect(`${r1.id}:GigabitEthernet0/1`, `${pc2.id}:Ethernet0/0`)
  cfgIf(ios, r1, 'GigabitEthernet0/0', 'ip address 192.168.1.1 255.255.255.0', 'no shutdown')
  cfgIf(ios, r1, 'GigabitEthernet0/1', 'ip address 192.168.2.1 255.255.255.0', 'no shutdown')
  run(lx, pc1, 'ip addr add 192.168.1.10/16 dev eth0', 'ip link set eth0 up')
  run(lx, pc2, 'ip addr add 192.168.2.5/24 dev eth0', 'ip link set eth0 up', 'ip route add default via 192.168.2.1')
  return { topo, ios, lx, sw, r1, pc1, pc2 }
}

describe('PA1 — proxy ARP is on by default', () => {
  it('a host with a too-wide mask still reaches a remote host through the router', () => {
    const { topo, sw, r1, pc1, pc2 } = wideMask()
    expect(topo.checkPing('192.168.1.10', '192.168.2.5').reachable).toBe(true)
    expect(topo.findPath('192.168.1.10', '192.168.2.5')).toEqual([pc1.id, sw.id, r1.id, pc2.id])
  })
})

describe('PA2 — no ip proxy-arp exposes the wrong mask', () => {
  it('fails with subnet_mismatch at the host (its ARP is never answered)', () => {
    const { topo, ios, r1, pc1 } = wideMask()
    expect(cfgIf(ios, r1, 'GigabitEthernet0/0', 'no ip proxy-arp')).toEqual([])
    const r = topo.checkPing('192.168.1.10', '192.168.2.5')
    expect(r.reachable).toBe(false)
    expect(r.failureReason).toBe('subnet_mismatch')
    expect(r.failurePoint).toBe(pc1.id)
    expect(r.lostOnReturn).toBe(false)
  })

  it('Linux shows the ARP failure: Destination Host Unreachable from itself', () => {
    const { ios, lx, r1, pc1 } = wideMask()
    cfgIf(ios, r1, 'GigabitEthernet0/0', 'no ip proxy-arp')
    const out = run(lx, pc1, 'ping 192.168.2.5').join('\n')
    expect(out).toMatch(/From 192\.168\.1\.10 icmp_seq=1 Destination Host Unreachable/)
    expect(out).not.toMatch(/Network is unreachable/)
  })

  it('a correct /24 mask on the host fixes it without proxy ARP (it uses its gateway)', () => {
    const { topo, ios, lx, r1, pc1 } = wideMask()
    cfgIf(ios, r1, 'GigabitEthernet0/0', 'no ip proxy-arp')
    run(lx, pc1, 'ip addr del 192.168.1.10/16 dev eth0', 'ip addr add 192.168.1.10/24 dev eth0',
      'ip route add default via 192.168.1.1')
    expect(topo.checkPing('192.168.1.10', '192.168.2.5').reachable).toBe(true)
  })
})

describe('PA2b — ARP for the router\'s OTHER interface address', () => {
  it('is answered only by proxy ARP (IOS replies for the ingress interface\'s own address)', () => {
    const { topo, ios, r1 } = wideMask()
    expect(topo.checkPing('192.168.1.10', '192.168.2.1').reachable).toBe(true)
    cfgIf(ios, r1, 'GigabitEthernet0/0', 'no ip proxy-arp')
    expect(topo.checkPing('192.168.1.10', '192.168.2.1').reachable).toBe(false)
    expect(topo.checkPing('192.168.1.10', '192.168.1.1').reachable).toBe(true)
  })
})

describe('PA2c — Windows host with a too-wide mask', () => {
  it('sends (no General failure) when nobody answers its ARP', () => {
    const { topo, ios, sw, r1 } = wideMask()
    const lap = createAdminLaptop(); lap.os_type = 'windows'; lap.powered = true
    topo.addDevice(lap)
    topo.connect(`${sw.id}:GigabitEthernet0/2`, `${lap.id}:Ethernet0/0`)
    const win = new WindowsCLIEngine(topo)
    run(win, lap, 'netsh interface set interface name="Ethernet0" admin=enabled',
      'netsh interface ip set address "Ethernet0" static 192.168.1.50 255.255.0.0')
    cfgIf(ios, r1, 'GigabitEthernet0/0', 'no ip proxy-arp')
    expect(topo.checkPing('192.168.1.50', '192.168.2.5').failureReason).toBe('subnet_mismatch')
    let start = null
    win.executePingAsync(lap, '192.168.2.5', { onStart: l => { start = l }, onPacket: () => {}, onDone: () => {} })()
    expect(start).toEqual(['Pinging 192.168.2.5 with 32 bytes of data:'])
  })
})

describe('PA3 — the setting is per interface, on the interface that hears the ARP', () => {
  it('ip proxy-arp turns it back on', () => {
    const { topo, ios, r1 } = wideMask()
    cfgIf(ios, r1, 'GigabitEthernet0/0', 'no ip proxy-arp')
    cfgIf(ios, r1, 'GigabitEthernet0/0', 'ip proxy-arp')
    expect(topo.checkPing('192.168.1.10', '192.168.2.5').reachable).toBe(true)
  })

  it('disabling it on the far-side interface changes nothing', () => {
    const { topo, ios, r1 } = wideMask()
    cfgIf(ios, r1, 'GigabitEthernet0/1', 'no ip proxy-arp')
    expect(topo.checkPing('192.168.1.10', '192.168.2.5').reachable).toBe(true)
  })
})

describe('PA4 — no proxy reply from the default route alone', () => {
  // PC1 (192.168.1.10/16) — SW — R1 Gi0/0 .1/24 ; R1 Gi0/1 10.0.0.1/30 — R2 Gi0/0 10.0.0.2/30 ;
  // R2 Gi0/1 192.168.2.1/24 — PC2 192.168.2.5/24
  function twoRouters() {
    const topo = new Topology()
    const ios = new CLIEngine(topo), lx = new PCCLIEngine(topo)
    const sw = dev('switch', 4, 'GigabitEthernet0/', 1)
    const r1 = dev('router', 2, 'GigabitEthernet0/', 0), r2 = dev('router', 2, 'GigabitEthernet0/', 0)
    const pc1 = dev('pc', 1, 'Ethernet0/', 0), pc2 = dev('pc', 1, 'Ethernet0/', 0)
    for (const d of [sw, r1, r2, pc1, pc2]) topo.addDevice(d)
    topo.connect(`${sw.id}:GigabitEthernet0/1`, `${pc1.id}:Ethernet0/0`)
    topo.connect(`${sw.id}:GigabitEthernet0/3`, `${r1.id}:GigabitEthernet0/0`)
    topo.connect(`${r1.id}:GigabitEthernet0/1`, `${r2.id}:GigabitEthernet0/0`)
    topo.connect(`${r2.id}:GigabitEthernet0/1`, `${pc2.id}:Ethernet0/0`)
    cfgIf(ios, r1, 'GigabitEthernet0/0', 'ip address 192.168.1.1 255.255.255.0', 'no shutdown')
    cfgIf(ios, r1, 'GigabitEthernet0/1', 'ip address 10.0.0.1 255.255.255.252', 'no shutdown')
    cfgIf(ios, r2, 'GigabitEthernet0/0', 'ip address 10.0.0.2 255.255.255.252', 'no shutdown')
    cfgIf(ios, r2, 'GigabitEthernet0/1', 'ip address 192.168.2.1 255.255.255.0', 'no shutdown')
    run(ios, r1, 'enable', 'configure terminal', 'ip route 0.0.0.0 0.0.0.0 10.0.0.2', 'end')
    run(ios, r2, 'enable', 'configure terminal', 'ip route 192.168.1.0 255.255.255.0 10.0.0.1', 'end')
    run(lx, pc1, 'ip addr add 192.168.1.10/16 dev eth0', 'ip link set eth0 up')
    run(lx, pc2, 'ip addr add 192.168.2.5/24 dev eth0', 'ip link set eth0 up', 'ip route add default via 192.168.2.1')
    return { topo, ios, r1, pc1 }
  }

  it('R1 has only 0.0.0.0/0 toward the destination → no proxy reply → subnet_mismatch', () => {
    const { topo, pc1 } = twoRouters()
    const r = topo.checkPing('192.168.1.10', '192.168.2.5')
    expect(r.reachable).toBe(false)
    expect(r.failureReason).toBe('subnet_mismatch')
    expect(r.failurePoint).toBe(pc1.id)
  })

  it('a specific route on R1 lets it proxy', () => {
    const { topo, ios, r1 } = twoRouters()
    run(ios, r1, 'enable', 'configure terminal', 'ip route 192.168.2.0 255.255.255.0 10.0.0.2', 'end')
    expect(topo.checkPing('192.168.1.10', '192.168.2.5').reachable).toBe(true)
  })
})

describe('PA5 — only the gateway the host chose routes its packet', () => {
  it('another router on the segment that could reach the destination does not pick it up', () => {
    const topo = new Topology()
    const ios = new CLIEngine(topo), lx = new PCCLIEngine(topo)
    const sw = dev('switch', 4, 'GigabitEthernet0/', 1)
    const gw = dev('router', 2, 'GigabitEthernet0/', 0), other = dev('router', 2, 'GigabitEthernet0/', 0)
    const pc1 = dev('pc', 1, 'Ethernet0/', 0), pc2 = dev('pc', 1, 'Ethernet0/', 0)
    for (const d of [sw, gw, other, pc1, pc2]) topo.addDevice(d)
    topo.connect(`${sw.id}:GigabitEthernet0/1`, `${pc1.id}:Ethernet0/0`)
    topo.connect(`${sw.id}:GigabitEthernet0/2`, `${gw.id}:GigabitEthernet0/0`)
    topo.connect(`${sw.id}:GigabitEthernet0/3`, `${other.id}:GigabitEthernet0/0`)
    topo.connect(`${other.id}:GigabitEthernet0/1`, `${pc2.id}:Ethernet0/0`)
    cfgIf(ios, gw, 'GigabitEthernet0/0', 'ip address 192.168.1.1 255.255.255.0', 'no shutdown')
    cfgIf(ios, other, 'GigabitEthernet0/0', 'ip address 192.168.1.2 255.255.255.0', 'no shutdown')
    cfgIf(ios, other, 'GigabitEthernet0/1', 'ip address 192.168.2.1 255.255.255.0', 'no shutdown')
    run(lx, pc1, 'ip addr add 192.168.1.10/24 dev eth0', 'ip link set eth0 up', 'ip route add default via 192.168.1.1')
    run(lx, pc2, 'ip addr add 192.168.2.5/24 dev eth0', 'ip link set eth0 up', 'ip route add default via 192.168.2.1')

    // The gateway (.1) has no route to 192.168.2.0/24; the other router does, but the
    // frame is addressed to .1's MAC, so it never routes it.
    const r = topo.checkPing('192.168.1.10', '192.168.2.5')
    expect(r.reachable).toBe(false)
    expect(r.failureReason).toBe('no_route')

    // Pointing the host at the router that has the route fixes it.
    run(lx, pc1, 'ip route replace default via 192.168.1.2')
    expect(topo.checkPing('192.168.1.10', '192.168.2.5').reachable).toBe(true)
  })
})

describe('PA6 — CLI', () => {
  it('running-config shows `no ip proxy-arp` only when it is off', () => {
    const { ios, r1 } = wideMask()
    const cfg = () => run(ios, r1, 'show running-config').join('\n')
    expect(cfg()).not.toMatch(/proxy-arp/)
    cfgIf(ios, r1, 'GigabitEthernet0/0', 'no ip proxy-arp')
    expect(cfg()).toMatch(/interface GigabitEthernet0\/0\n ip address 192\.168\.1\.1 255\.255\.255\.0\n no ip proxy-arp\n/)
  })

  it('show ip interface reports Proxy ARP is enabled / disabled', () => {
    const { ios, r1 } = wideMask()
    expect(run(ios, r1, 'show ip interface GigabitEthernet0/0')).toContain('  Proxy ARP is enabled')
    cfgIf(ios, r1, 'GigabitEthernet0/0', 'no ip proxy-arp')
    expect(run(ios, r1, 'show ip interface GigabitEthernet0/0')).toContain('  Proxy ARP is disabled')
  })

  it('works on a router subinterface', () => {
    const { ios, r1 } = wideMask()
    run(ios, r1, 'enable', 'configure terminal', 'interface GigabitEthernet0/0.10',
      'encapsulation dot1Q 10', 'ip address 10.10.0.1 255.255.255.0', 'no ip proxy-arp', 'end')
    expect(run(ios, r1, 'show running-config').join('\n'))
      .toMatch(/interface GigabitEthernet0\/0\.10\n encapsulation dot1Q 10\n ip address 10\.10\.0\.1 255\.255\.255\.0\n no ip proxy-arp\n/)
  })

  it('is rejected on an L2 switchport and on the firewall', () => {
    const { ios, sw } = wideMask()
    const out = run(ios, sw, 'enable', 'configure terminal', 'interface GigabitEthernet0/1', 'no ip proxy-arp')
    expect(out.join('\n')).toMatch(/% Invalid input detected at '\^' marker\./)
    expect(sw.getInterface('GigabitEthernet0/1').proxy_arp).toBeUndefined()

    const topo = new Topology(), fwEng = new CLIEngine(topo)
    const fw = dev('firewall', 2, 'GigabitEthernet0/', 0)
    topo.addDevice(fw)
    expect(run(fwEng, fw, 'enable', 'configure terminal', 'interface GigabitEthernet0/0', 'ip proxy-arp').join('\n'))
      .toMatch(/% Invalid input detected at '\^' marker\./)
  })
})
