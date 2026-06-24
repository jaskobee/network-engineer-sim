import { networkAddress } from '../models/ipUtils.js'

// ── Mission 001 ───────────────────────────────────────────────────────────────

const TASKS_001 = [
  { id: 't1', label: 'Buy a Router and a PC',
    hint: 'Open the Shop tab on the left and purchase one Router and one PC.' },
  { id: 't2', label: 'Place both devices on the map',
    hint: 'Drag each device from Inventory onto the floorplan.' },
  { id: 't3', label: 'Cable Router → PC',
    hint: 'Right-click the Router on the floorplan → "Connect Cable", then click the PC.' },
  { id: 't4', label: 'Assign IP to Router LAN port & bring it up',
    hint: ['Right-click the Router → Open Terminal, then type:',
      'enable', 'configure terminal', 'interface GigabitEthernet0/0',
      'ip address 192.168.1.1 255.255.255.0', 'no shutdown'] },
  { id: 't5', label: 'Assign IP to PC & bring it up',
    hint: ['Right-click the PC → Open Terminal, then type:',
      'ip addr add 192.168.1.100/24 dev eth0', 'ip link set eth0 up'] },
  { id: 't6', label: 'Ping from Router to PC succeeds',
    hint: ['Open Router terminal and verify connectivity:', 'ping 192.168.1.100'] },
]

function check001(devices, placements, topology) {
  const router = devices.find(d => d.type === 'router')
  const pc     = devices.find(d => d.type === 'pc')
  const t1 = !!router && !!pc
  const t2 = t1 && !!placements[router.id] && !!placements[pc.id]
  const t3 = t1 && router.interfaces.some(i => i.connected_to && i.connected_to.split(':')[0] === pc.id)
  // t4: must be the LAN interface — the one physically cabled to the PC.
  // 'no shutdown' issued => status moves from 'admin_down' to 'down' (or 'up' if
  // the peer is already up). Checking !== 'admin_down' lets t4 pass as soon as the
  // player assigns an IP and issues 'no shutdown', without waiting for the PC to also
  // bring up its interface (that's t5's job).  The actual link-up is proven by t6 (ping).
  const routerLan = router?.interfaces.find(i =>
    i.ip && i.subnet_mask && i.status !== 'admin_down' &&
    i.connected_to && i.connected_to.split(':')[0] === pc?.id
  )
  const t4 = !!routerLan
  const pcLan = pc?.interfaces.find(i => i.ip && i.subnet_mask && i.status === 'up')
  // Both masks must agree AND both IPs must be in the same network — catches mask-mismatch
  const t5 = !!(pcLan && routerLan &&
    pcLan.subnet_mask === routerLan.subnet_mask &&
    networkAddress(pcLan.ip, pcLan.subnet_mask) === networkAddress(routerLan.ip, routerLan.subnet_mask))
  // t6 requires the user to have actually typed `ping` in the terminal (not just auto-check)
  const t6 = !!(routerLan && pcLan && (
    topology.pingLog.has(`${routerLan.ip}:${pcLan.ip}`) ||
    topology.pingLog.has(`${pcLan.ip}:${routerLan.ip}`)
  ))
  return { t1, t2, t3, t4, t5, t6 }
}

// ── Mission 002 ───────────────────────────────────────────────────────────────

const TASKS_002 = [
  { id: 't1', label: 'Buy 1 Router + 1 Switch + 3 PCs',
    hint: 'Open the Shop tab and purchase one Router, one Switch, and three PCs.' },
  { id: 't2', label: 'Place all 5 devices on the map',
    hint: 'Drag each device from Inventory onto the floorplan.' },
  { id: 't3', label: 'Cable: Router → Switch, Switch → each PC',
    hint: 'Right-click Router → Connect Cable → click Switch. Then right-click Switch → Connect Cable → click each PC.' },
  { id: 't4', label: 'Configure Router interface: IP + no shutdown',
    hint: ['Right-click the Router → Open Terminal, then type:',
      'enable', 'configure terminal', 'interface GigabitEthernet0/0',
      'ip address 192.168.1.1 255.255.255.0', 'no shutdown'] },
  { id: 't5', label: 'Configure all 3 PCs with IPs in 192.168.1.0/24',
    hint: ['On each PC terminal (change .x to .101, .102, .103):',
      'ip addr add 192.168.1.101/24 dev eth0', 'ip link set eth0 up'] },
  { id: 't6', label: 'Router can ping all 3 PCs',
    hint: ['Open Router terminal and ping each PC (use their actual IPs):',
      'ping 192.168.1.101', 'ping 192.168.1.102', 'ping 192.168.1.103'] },
]

function check002(devices, placements, topology) {
  const router  = devices.find(d => d.type === 'router')
  const sw      = devices.find(d => d.type === 'switch')
  const pcs     = devices.filter(d => d.type === 'pc').slice(0, 3)

  const t1 = !!router && !!sw && pcs.length >= 3

  const t2 = t1 && [router, sw, ...pcs].every(d => !!placements[d.id])

  const routerToSwitch = t1 && router.interfaces.some(i =>
    i.connected_to && i.connected_to.split(':')[0] === sw.id)
  const pcsToSwitch = t1 && pcs.every(pc =>
    pc.interfaces.some(i => i.connected_to && i.connected_to.split(':')[0] === sw.id) ||
    sw.interfaces.some(i => i.connected_to && i.connected_to.split(':')[0] === pc.id))
  const t3 = routerToSwitch && pcsToSwitch

  const routerLan = router?.interfaces.find(i => i.ip && i.subnet_mask && i.status === 'up')
  const t4 = !!routerLan

  const t5 = !!(routerLan && pcs.every(pc => {
    const pif = pc.interfaces.find(i => i.ip && i.subnet_mask && i.status === 'up')
    return pif &&
      pif.subnet_mask === routerLan.subnet_mask &&
      networkAddress(pif.ip, pif.subnet_mask) === networkAddress(routerLan.ip, routerLan.subnet_mask)
  }))

  // t6: player must have actually run `ping` from the router to each PC — auto-check
  // is insufficient; the pedagogical goal is hands-on CLI verification.
  const t6 = !!(routerLan && pcs.every(pc => {
    const pif = pc.interfaces.find(i => i.ip && i.status === 'up')
    return pif && (
      topology.pingLog.has(`${routerLan.ip}:${pif.ip}`) ||
      topology.pingLog.has(`${pif.ip}:${routerLan.ip}`)
    )
  }))

  return { t1, t2, t3, t4, t5, t6 }
}

// ── Mission 003 ───────────────────────────────────────────────────────────────

const TASKS_003 = [
  {
    id: 't1',
    label: 'Buy: 2 Routers, 1 Switch, 2 PCs, 1 Server',
    hint: 'Open the Shop tab and purchase 2 Routers, 1 Switch, 2 PCs, and 1 Server.',
  },
  {
    id: 't2',
    label: 'Place all 6 devices on the map',
    hint: 'Drag each device from Inventory onto the floorplan. Group R1+PC on the Reception side and R2+Switch+PC+Server on the Clinical side.',
  },
  {
    id: 't3',
    label: 'Cable: PC↔R1, R1↔R2 (WAN), R2↔Switch, Switch↔PC-Clinical, Switch↔Server',
    hint: 'Right-click each device → Connect Cable. PC-Reception→R1, R1 directly to R2 (WAN link), R2→Switch, Switch→PC-Clinical, Switch→Server.',
  },
  {
    id: 't4',
    label: 'Configure R1: LAN interface + WAN interface, both up',
    hint: ['Open R1 terminal, then type (Gi0/0 = LAN, Gi0/1 = WAN):',
      'enable', 'configure terminal',
      'interface GigabitEthernet0/0', 'ip address 192.168.1.1 255.255.255.0', 'no shutdown',
      'interface GigabitEthernet0/1', 'ip address 10.0.0.1 255.255.255.252', 'no shutdown'],
  },
  {
    id: 't5',
    label: 'Configure R2: WAN interface + LAN interface, both up',
    hint: ['Open R2 terminal, then type (Gi0/1 = WAN, Gi0/0 = LAN):',
      'enable', 'configure terminal',
      'interface GigabitEthernet0/1', 'ip address 10.0.0.2 255.255.255.252', 'no shutdown',
      'interface GigabitEthernet0/0', 'ip address 192.168.2.1 255.255.255.0', 'no shutdown'],
  },
  {
    id: 't6',
    label: 'All hosts: IP assigned, interface up, default gateway configured',
    hint: ['On each PC/Server terminal (replace x.y with a free IP in that host\'s subnet):',
      'ip addr add 192.168.x.y/24 dev eth0',
      'ip link set eth0 up',
      'ip route add default via 192.168.x.1'],
  },
  {
    id: 't7',
    label: 'Add static route on R1 toward the Clinical subnet',
    hint: ['Open R1 terminal:',
      'enable', 'configure terminal',
      'ip route 192.168.2.0 255.255.255.0 10.0.0.2'],
  },
  {
    id: 't8',
    label: 'Add static route on R2 toward the Reception subnet',
    hint: ['Open R2 terminal:',
      'enable', 'configure terminal',
      'ip route 192.168.1.0 255.255.255.0 10.0.0.1'],
  },
  {
    id: 't9',
    label: 'PC-Reception can ping the Clinical PC AND the Records Server',
    hint: ['Open PC-Reception terminal and ping both Clinical hosts:',
      'ping 192.168.2.10', 'ping 192.168.2.20'],
  },
]

function check003(devices, placements, topology) {
  const routers = devices.filter(d => d.type === 'router').slice(0, 2)
  const sws     = devices.filter(d => d.type === 'switch').slice(0, 1)
  const pcs     = devices.filter(d => d.type === 'pc').slice(0, 2)
  const server  = devices.find(d => d.type === 'server')

  const t1 = routers.length >= 2 && sws.length >= 1 && pcs.length >= 2 && !!server

  const allDevs = t1 ? [...routers, ...sws, ...pcs, server] : []
  const t2 = t1 && allDevs.every(d => !!placements[d.id])

  // t3: WAN link + each host reachable from a router (direct or via Clinical switch).
  const sw = sws[0]
  const wanLink = t1 && routers[0].interfaces.some(i =>
    i.connected_to && i.connected_to.split(':')[0] === routers[1].id)
  function hostReachesRouter(h) {
    if (h.interfaces.some(i =>
      i.connected_to && routers.some(r => r.id === i.connected_to.split(':')[0])))
      return true
    // Via the Clinical-side switch
    const onSwitch =
      h.interfaces.some(i => i.connected_to && i.connected_to.split(':')[0] === sw.id) ||
      sw.interfaces.some(i => i.connected_to && i.connected_to.split(':')[0] === h.id)
    if (!onSwitch) return false
    return routers.some(r =>
      r.interfaces.some(i => i.connected_to && i.connected_to.split(':')[0] === sw.id) ||
      sw.interfaces.some(i => i.connected_to && i.connected_to.split(':')[0] === r.id))
  }
  const hostsWired = t1 && [...pcs, server].every(hostReachesRouter)
  const t3 = wanLink && hostsWired

  // t4/t5: Each router has ≥2 physical interfaces with IPs on distinct subnets and
  // 'no shutdown' issued (status !== 'admin_down').  Checking !== 'admin_down' rather
  // than === 'up' lets the task pass as soon as the player configures the router,
  // without waiting for every peer (PC, other router) to also come up.  The actual
  // end-to-end link state is verified by t9 (the ping).
  function routerConfigured(r) {
    const readyIfs = r.interfaces.filter(
      i => !i.parent && i.ip && i.subnet_mask && i.status !== 'admin_down'
    )
    if (readyIfs.length < 2) return false
    const nets = new Set(readyIfs.map(i => networkAddress(i.ip, i.subnet_mask)))
    return nets.size >= 2
  }
  const t4 = t1 && routerConfigured(routers[0])
  const t5 = t1 && routerConfigured(routers[1])

  // t6: Each host has IP + up interface AND a default gateway within its own subnet.
  // Out-of-subnet gateways are a real misconfiguration — detect and block completion.
  function hostConfigured(h) {
    const iface = h.interfaces.find(i => i.ip && i.subnet_mask && i.status === 'up')
    if (!iface) return false
    const defRoute = (h.routing_table ?? []).find(r => r.network === '0.0.0.0')
    if (!defRoute) return false
    return networkAddress(defRoute.next_hop, iface.subnet_mask) ===
           networkAddress(iface.ip,           iface.subnet_mask)
  }
  const t6 = t1 && [...pcs, server].every(hostConfigured)

  // t7/t8: Each router has at least one manually-added static route.
  // The cross-subnet ping (t9) is the real bidirectional gate — no duplicate string check here.
  const t7 = t4 && routers[0].routing_table.length >= 1
  const t8 = t5 && routers[1].routing_table.length >= 1

  // t9: A PC on one LAN pinged both hosts on the other LAN (player must have typed ping).
  // Because checkPing is bidirectional, a logged success proves both static routes are valid.
  const t9 = (() => {
    if (!t6 || !t7 || !t8) return false
    const hosts = [...pcs, server]
    for (const srcPc of pcs) {
      const si = srcPc.interfaces.find(i => i.ip && i.subnet_mask && i.status === 'up')
      if (!si) continue
      const srcNet = networkAddress(si.ip, si.subnet_mask)
      const crossTargets = hosts.filter(h => {
        if (h === srcPc) return false
        const hi = h.interfaces.find(i => i.ip && i.subnet_mask && i.status === 'up')
        return hi && networkAddress(hi.ip, hi.subnet_mask) !== srcNet
      })
      if (crossTargets.length < 2) continue  // need both PC and Server on the other side
      const allPinged = crossTargets.every(target => {
        const ti = target.interfaces.find(i => i.ip && i.status === 'up')
        if (!ti) return false
        return topology.pingLog.has(`${si.ip}:${ti.ip}`) ||
               topology.pingLog.has(`${ti.ip}:${si.ip}`)
      })
      if (allPinged) return true
    }
    return false
  })()

  return { t1, t2, t3, t4, t5, t6, t7, t8, t9 }
}

// ── Mission 004 ───────────────────────────────────────────────────────────────
//
// TechNova Startup HQ — VLAN + ROAS + DHCP + static server + ISP + NAT
// Addressing plan:
//   VLAN 10 Users    192.168.10.0/24  gw .10.1  DHCP
//   VLAN 20 Guest    192.168.20.0/24  gw .20.1  DHCP
//   VLAN 30 Servers  192.168.30.0/24  gw .30.1  STATIC (server at .30.10)
//   VLAN 40 Voice    192.168.40.0/24  gw .40.1  DHCP
//   R1 WAN   203.0.113.2/30  →  ISP 203.0.113.1/30  (default route + NAT overload)

const TASKS_004 = [
  // ── Build & Cable ────────────────────────────────────────────────────────────
  {
    id: 't1',
    label: 'Buy: 1 Router, 1 Switch, 3 PCs, 1 Server, 1 IP Phone',
    hint: 'Open the Shop tab. Total: Router ($1,200) + Switch ($800) + 3×PC ($600) + Server ($600) + Phone ($150) = $3,350. The ISP node is pre-placed — do not buy it.',
  },
  {
    id: 't2',
    label: 'Place all 6 purchased devices on the map',
    hint: 'Drag each device from Inventory onto the floorplan. Keep the ISP in the top-right corner (it is already there).',
  },
  {
    id: 't3',
    label: 'Cable: all hosts→switch, switch→router (trunk link), router WAN port→ISP',
    hint: [
      'Right-click each device → Connect Cable.',
      '  1. Cable every PC, Server, and Phone to a different switch port.',
      '  2. Cable the switch to one router port (this becomes the ROAS trunk).',
      '  3. Cable the router\'s remaining WAN port to the ISP.',
    ],
  },
  // ── VLANs ────────────────────────────────────────────────────────────────────
  {
    id: 't4',
    label: 'VLANs: create 10/20/30/40 on the switch, assign host ports, trunk to router',
    hint: [
      'Open the Switch terminal, then type:',
      'enable', 'configure terminal',
      'vlan 10', 'exit',
      'vlan 20', 'exit',
      'vlan 30', 'exit',
      'vlan 40', 'exit',
      '# Assign each host port (replace Fa0/x with your cable\'s port):',
      'interface FastEthernet0/1', 'switchport mode access', 'switchport access vlan 10', 'exit',
      '# Repeat for other ports/VLANs. Mark the router-facing port trunk:',
      'interface FastEthernet0/6', 'switchport mode trunk', 'exit',
    ],
  },
  // ── ROAS ─────────────────────────────────────────────────────────────────────
  {
    id: 't5',
    label: 'ROAS: 4 subinterfaces on the router with encapsulation dot1Q + gateway IPs',
    hint: [
      'Open the Router terminal:',
      'enable', 'configure terminal',
      '# Bring up the physical trunk port (no IP here):',
      'interface GigabitEthernet0/0', 'no shutdown', 'exit',
      '# One subinterface per VLAN:',
      'interface GigabitEthernet0/0.10',
      'encapsulation dot1Q 10',
      'ip address 192.168.10.1 255.255.255.0', 'exit',
      '# Repeat with .20 (192.168.20.1), .30 (192.168.30.1), .40 (192.168.40.1)',
    ],
  },
  // ── Servers ──────────────────────────────────────────────────────────────────
  {
    id: 't6',
    label: 'Servers: statically address the DMZ server in 192.168.30.0/24 (no DHCP)',
    hint: [
      'Open the Server terminal (Linux):',
      'ip addr add 192.168.30.10/24 dev eth0',
      'ip link set eth0 up',
      'ip route add default via 192.168.30.1',
    ],
  },
  // ── DHCP ─────────────────────────────────────────────────────────────────────
  {
    id: 't7',
    label: 'DHCP: pools for VLANs 10/20/40 on router; run dhclient on all DHCP clients',
    hint: [
      'Open the Router terminal and configure three DHCP pools:',
      'enable', 'configure terminal',
      'ip dhcp pool VLAN10',
      'network 192.168.10.0 255.255.255.0',
      'default-router 192.168.10.1',
      'dns-server 8.8.8.8', 'exit',
      '# Repeat for VLAN20 (192.168.20.0, gw .20.1) and VLAN40 (192.168.40.0, gw .40.1)',
      '# On each PC/Phone terminal:',
      'ip link set eth0 up',
      'dhclient eth0',
    ],
  },
  // ── ISP ──────────────────────────────────────────────────────────────────────
  {
    id: 't8',
    label: 'ISP link: WAN interface 203.0.113.2/30 up + default route to ISP',
    hint: [
      'Open the Router terminal (ISP is pre-configured at 203.0.113.1):',
      'enable', 'configure terminal',
      'interface GigabitEthernet0/1',
      'ip address 203.0.113.2 255.255.255.252',
      'no shutdown', 'exit',
      'ip route 0.0.0.0 0.0.0.0 203.0.113.1',
    ],
  },
  // ── NAT ──────────────────────────────────────────────────────────────────────
  {
    id: 't9',
    label: 'NAT: ip nat inside/outside, ACL for all private subnets, overload rule',
    hint: [
      'Open the Router terminal:',
      'enable', 'configure terminal',
      '# Mark the LAN-side (trunk) interface as inside:',
      'interface GigabitEthernet0/0', 'ip nat inside', 'exit',
      '# Mark the WAN interface as outside:',
      'interface GigabitEthernet0/1', 'ip nat outside', 'exit',
      '# ACL selects which private addresses are translated:',
      'access-list 1 permit 192.168.10.0 0.0.0.255',
      'access-list 1 permit 192.168.20.0 0.0.0.255',
      'access-list 1 permit 192.168.30.0 0.0.0.255',
      'access-list 1 permit 192.168.40.0 0.0.0.255',
      '# Overload = PAT (many hosts share the one WAN IP):',
      'ip nat inside source list 1 interface GigabitEthernet0/1 overload',
    ],
  },
  // ── Verify ───────────────────────────────────────────────────────────────────
  {
    id: 't10',
    label: 'Verify inter-VLAN: a VLAN-10 user PC pings the server (192.168.30.10)',
    hint: [
      'Open a User PC terminal (one that got a 192.168.10.x address via DHCP):',
      'ping 192.168.30.10',
    ],
  },
  {
    id: 't11',
    label: 'Verify internet: any client pings 8.8.8.8 (end-to-end: VLAN+ROAS+DHCP+NAT)',
    hint: [
      'Open any PC or Phone terminal and ping Google DNS:',
      'ping 8.8.8.8',
      '# All green? TechNova is live. A firewall (Mission 005) will true-up the DMZ.',
    ],
  },
]

function check004(devices, placements, topology) {
  const router  = devices.find(d => d.type === 'router')
  const sw      = devices.find(d => d.type === 'switch')
  const pcs     = devices.filter(d => d.type === 'pc')
  const server  = devices.find(d => d.type === 'server')
  const phone   = devices.find(d => d.type === 'phone')
  const isp     = devices.find(d => d.type === 'isp')

  // t1: hardware bought
  const t1 = !!router && !!sw && pcs.length >= 3 && !!server && !!phone

  // t2: all player-bought devices placed
  const t2 = t1 && [router, sw, ...pcs, server, phone].every(d => !!placements[d.id])

  // t3: cabling — every host wired to switch, switch to router, router to ISP
  const swToRouter = t1 && (
    sw.interfaces.some(i => i.connected_to?.split(':')[0] === router.id) ||
    router.interfaces.some(i => !i.parent && i.connected_to?.split(':')[0] === sw.id)
  )
  const hosts = t1 ? [...pcs, server, phone] : []
  const hostsOnSwitch = hosts.every(h =>
    h.interfaces.some(i => i.connected_to?.split(':')[0] === sw.id) ||
    sw.interfaces.some(i => i.connected_to?.split(':')[0] === h.id)
  )
  const routerToIsp = t1 && !!isp && router.interfaces.some(i =>
    !i.parent && i.connected_to?.split(':')[0] === isp.id
  )
  const t3 = swToRouter && hostsOnSwitch && routerToIsp

  // t4: switch-router link is trunk; at least 4 different non-default VLANs on access ports
  const trunkPort = t3 ? sw.interfaces.find(i =>
    i.connected_to?.split(':')[0] === router.id && i.switchport_mode === 'trunk'
  ) : null
  const accessVlans = t3 ? new Set(
    sw.interfaces
      .filter(i => i.switchport_mode !== 'trunk' && !i.svi && i.vlan && i.vlan !== 1)
      .map(i => i.vlan)
  ) : new Set()
  const t4 = !!trunkPort && accessVlans.size >= 4

  // t5: router has 4 subinterfaces (VLANs 10/20/30/40), each with dot1Q encap + IP + up
  const parentIf = t3 ? router.interfaces.find(i =>
    !i.parent && !i.svi && i.connected_to?.split(':')[0] === sw.id && i.status !== 'admin_down'
  ) : null
  const subifs = parentIf ? router.interfaces.filter(i =>
    i.parent === parentIf.name && i.vlanTag !== null && i.ip && i.subnet_mask && i.status === 'up'
  ) : []
  const subifTags = new Set(subifs.map(s => s.vlanTag))
  const t5 = !!parentIf && [10, 20, 30, 40].every(v => subifTags.has(v))

  // t6: server statically addressed in VLAN-30 subnet, with correct default gateway
  const getSubif = v => t5 ? router.interfaces.find(i => i.parent && i.vlanTag === v && i.ip) : null
  const sub30    = getSubif(30)
  const sub30Net = sub30 ? networkAddress(sub30.ip, sub30.subnet_mask ?? '255.255.255.0') : null
  const srvIf    = server?.interfaces.find(i => i.ip && i.subnet_mask && i.status === 'up')
  const srvNet   = srvIf ? networkAddress(srvIf.ip, srvIf.subnet_mask) : null
  const srvGw    = server?.routing_table?.find(r => r.network === '0.0.0.0')
  const t6 = !!(sub30Net && srvIf && !srvIf.dhcp_assigned &&
    srvNet === sub30Net &&
    srvGw && networkAddress(srvGw.next_hop, srvIf.subnet_mask) === srvNet)

  // t7: DHCP pools for VLANs 10/20/40 exist; all DHCP clients received addresses in those subnets
  const poolsOk = t5 && [10, 20, 40].every(v => {
    const subif = getSubif(v)
    if (!subif) return false
    return (router.dhcp_pools ?? []).some(p =>
      p.network && p.mask && networkAddress(subif.ip, p.mask) === p.network
    )
  })
  const dhcpHosts = t1 ? [...pcs, phone] : []
  const clientsGotDhcp = t5 && dhcpHosts.every(c => {
    const cif = c.interfaces.find(i => i.dhcp_assigned && i.ip && i.status === 'up')
    if (!cif) return false
    const net = networkAddress(cif.ip, cif.subnet_mask ?? '255.255.255.0')
    return [10, 20, 40].some(v => {
      const subif = getSubif(v)
      return subif && networkAddress(subif.ip, subif.subnet_mask ?? '255.255.255.0') === net
    })
  })
  const t7 = poolsOk && clientsGotDhcp

  // t8: WAN interface up + default route to ISP
  const wanIf = t3 ? router.interfaces.find(i =>
    !i.parent && i.connected_to?.split(':')[0] === isp?.id && i.ip && i.status === 'up'
  ) : null
  const defRoute = router?.routing_table?.find(r => r.network === '0.0.0.0')
  const t8 = !!wanIf && !!defRoute

  // t9: ip nat inside on trunk physical interface, ip nat outside on WAN, ACL + overload rule
  const natInside  = parentIf?.nat_inside === true
  const natOutside = wanIf?.nat_outside === true
  const hasNatRule = (router?.nat_rules?.length ?? 0) > 0
  const hasNatAcl  = (router?.nat_acls?.length ?? 0) > 0
  const t9 = t8 && natInside && natOutside && hasNatRule && hasNatAcl

  // t10: inter-VLAN verify — a VLAN-10 DHCP client has a logged ping to the server
  const t10 = (() => {
    if (!t7 || !t6) return false
    const sub10 = getSubif(10)
    if (!sub10 || !srvIf) return false
    const net10 = networkAddress(sub10.ip, sub10.subnet_mask ?? '255.255.255.0')
    return dhcpHosts.some(c => {
      const cif = c.interfaces.find(i => i.dhcp_assigned && i.ip && i.status === 'up')
      if (!cif) return false
      if (networkAddress(cif.ip, cif.subnet_mask ?? '255.255.255.0') !== net10) return false
      return topology.pingLog.has(`${cif.ip}:${srvIf.ip}`) ||
             topology.pingLog.has(`${srvIf.ip}:${cif.ip}`)
    })
  })()

  // t11: internet verify — any DHCP client has a logged ping to 8.8.8.8
  const t11 = (() => {
    if (!t9 || !t7) return false
    return dhcpHosts.some(c => {
      const cif = c.interfaces.find(i => i.ip && i.status === 'up')
      return cif && topology.pingLog.has(`${cif.ip}:8.8.8.8`)
    })
  })()

  return { t1, t2, t3, t4, t5, t6, t7, t8, t9, t10, t11 }
}

// ── Diagnose functions (beginner-mode inline troubleshoot hints) ───────────────
//
// diagnoseFn(devices, placements, topology, checks) → { t1: string[]|null, … }
// Returns an array of hint strings for each currently-failing task, or null/absent
// if the task is passing or not yet reached.  Only called in beginner mode.
// Lines starting with "  " are rendered as CLI-command suggestions (blue monospace).

function _gwForHost(host, iface, topology) {
  // Try to find the actual router IP in the same subnet as the host interface.
  for (const dev of topology.devices.values()) {
    if (dev.type !== 'router' && dev.type !== 'isp') continue
    const match = dev.interfaces.find(i =>
      i.ip && i.subnet_mask &&
      networkAddress(i.ip, i.subnet_mask) === networkAddress(iface.ip, iface.subnet_mask)
    )
    if (match) return match.ip
  }
  return null
}

function diagnose001(devices, placements, topology, checks) {
  const router = devices.find(d => d.type === 'router')
  const pc     = devices.find(d => d.type === 'pc')
  const out    = {}

  if (!checks.t3 && checks.t2) {
    const linked = router?.interfaces.some(i => i.connected_to?.split(':')[0] === pc?.id)
    if (!linked)
      out.t3 = [`${router?.hostname ?? 'Router'} and ${pc?.hostname ?? 'PC'} are not cabled — right-click a device → Connect Cable`]
  }

  if (!checks.t4 && checks.t3) {
    const rIf = router?.interfaces.find(i => i.connected_to?.split(':')[0] === pc?.id)
    if (rIf) {
      if (!rIf.ip) {
        out.t4 = [
          `${router.hostname}: ${rIf.name} needs an IP — open Router terminal:`,
          `  enable`,
          `  configure terminal`,
          `  interface ${rIf.name}`,
          `  ip address 192.168.1.1 255.255.255.0`,
          `  no shutdown`,
        ]
      } else if (rIf.status === 'admin_down') {
        out.t4 = [
          `${router.hostname}: ${rIf.name} has IP but is still admin-down`,
          `  enable → configure terminal → interface ${rIf.name} → no shutdown`,
        ]
      }
    }
  }

  if (!checks.t5 && checks.t4) {
    const pcIf = pc?.interfaces.find(i => !i.parent)
    if (pcIf) {
      if (!pcIf.ip)              out.t5 = [`${pc.hostname}: no IP — run: ip addr add 192.168.1.100/24 dev eth0`]
      else if (pcIf.status !== 'up') out.t5 = [`${pc.hostname}: interface is down — run: ip link set eth0 up`]
    }
  }

  if (!checks.t6 && checks.t5) {
    const rIf  = router?.interfaces.find(i => i.ip && i.status === 'up')
    const pcIf = pc?.interfaces.find(i => i.ip && i.status === 'up')
    if (rIf && pcIf)
      out.t6 = [`Open ${router.hostname} terminal and type: ping ${pcIf.ip}`]
  }

  return out
}

function diagnose002(devices, placements, topology, checks) {
  const router = devices.find(d => d.type === 'router')
  const sw     = devices.find(d => d.type === 'switch')
  const pcs    = devices.filter(d => d.type === 'pc').slice(0, 3)
  const out    = {}

  if (!checks.t3 && checks.t2) {
    const hints = []
    const swToRouter = router?.interfaces.some(i => i.connected_to?.split(':')[0] === sw?.id) ||
                       sw?.interfaces.some(i => i.connected_to?.split(':')[0] === router?.id)
    if (!swToRouter) hints.push(`${router?.hostname} ↔ ${sw?.hostname}: cable missing`)
    for (const pc of pcs) {
      const ok = pc.interfaces.some(i => i.connected_to?.split(':')[0] === sw?.id) ||
                 sw?.interfaces.some(i => i.connected_to?.split(':')[0] === pc.id)
      if (!ok) hints.push(`${pc.hostname} is not connected to the switch`)
    }
    if (hints.length) out.t3 = hints
  }

  if (!checks.t4 && checks.t3 && router) {
    const configured = router.interfaces.find(i => i.ip && i.status !== 'admin_down')
    if (!configured) {
      const adminIf = router.interfaces.find(i => i.status === 'admin_down')
      out.t4 = [
        `${router.hostname}: no interface configured yet — open Router terminal:`,
        `  enable`,
        `  configure terminal`,
        `  interface ${adminIf?.name ?? 'GigabitEthernet0/0'}`,
        `  ip address 192.168.1.1 255.255.255.0`,
        `  no shutdown`,
      ]
    }
  }

  if (!checks.t5 && checks.t4) {
    const rIf = router?.interfaces.find(i => i.ip && i.status === 'up')
    if (rIf) {
      const hints = []
      for (const pc of pcs) {
        const pIf = pc.interfaces.find(i => i.status === 'up' && i.ip)
        if (!pIf) {
          const hasIp = pc.interfaces.find(i => i.ip)
          hints.push(hasIp
            ? `${pc.hostname}: interface down — run: ip link set eth0 up`
            : `${pc.hostname}: no IP — run: ip addr add 192.168.1.x/24 dev eth0 && ip link set eth0 up`)
        }
      }
      if (hints.length) out.t5 = hints
    }
  }

  if (!checks.t6 && checks.t5) {
    const rIf = router?.interfaces.find(i => i.ip && i.status === 'up')
    const notYetPinged = pcs
      .map(pc => pc.interfaces.find(i => i.ip && i.status === 'up')?.ip)
      .filter(Boolean)
      .filter(ip => !topology.pingLog.has(`${rIf?.ip}:${ip}`) && !topology.pingLog.has(`${ip}:${rIf?.ip}`))
    if (notYetPinged.length)
      out.t6 = [`Open ${router?.hostname} terminal and ping each PC:`,
        ...notYetPinged.map(ip => `  ping ${ip}`)]
  }

  return out
}

function diagnose003(devices, placements, topology, checks) {
  const routers = devices.filter(d => d.type === 'router').slice(0, 2)
  const sws     = devices.filter(d => d.type === 'switch').slice(0, 1)
  const pcs     = devices.filter(d => d.type === 'pc').slice(0, 2)
  const server  = devices.find(d => d.type === 'server')
  const sw      = sws[0]
  const out     = {}

  // t3 — cabling
  if (!checks.t3 && checks.t2) {
    const hints = []
    if (routers.length >= 2) {
      const [r0, r1] = routers
      const wanOk = r0.interfaces.some(i => i.connected_to?.split(':')[0] === r1.id) ||
                    r1.interfaces.some(i => i.connected_to?.split(':')[0] === r0.id)
      if (!wanOk) hints.push(`${r0.hostname} ↔ ${r1.hostname}: WAN cable missing — connect them directly`)
    }
    for (const h of [...pcs, server].filter(Boolean)) {
      const toRouter = h.interfaces.some(i => routers.some(r => r.id === i.connected_to?.split(':')[0]))
      const toSwitch = sw && (h.interfaces.some(i => i.connected_to?.split(':')[0] === sw.id) ||
                              sw.interfaces.some(i => i.connected_to?.split(':')[0] === h.id))
      if (!toRouter && !toSwitch)
        hints.push(`${h.hostname}: not connected — cable it to the switch or a router`)
    }
    if (hints.length) out.t3 = hints
  }

  // shared helper for router interface diagnostics
  function routerIfHints(r) {
    const phys    = r.interfaces.filter(i => !i.parent)
    const ready   = phys.filter(i => i.ip && i.subnet_mask && i.status !== 'admin_down')
    const admin   = phys.filter(i => i.status === 'admin_down')
    if (ready.length === 0) {
      return [
        `${r.hostname}: no interfaces configured — open terminal:`,
        `  enable → configure terminal`,
        `  interface ${admin[0]?.name ?? 'Gi0/0'} → ip address <ip> <mask> → no shutdown`,
        `  interface ${admin[1]?.name ?? 'Gi0/1'} → ip address <ip> <mask> → no shutdown`,
      ]
    }
    if (ready.length === 1) {
      const missing = phys.find(i => i !== ready[0])
      const hints = [`${r.hostname}: only ${ready[0].name} configured — a second interface (LAN + WAN) is needed`]
      if (missing) hints.push(`  configure interface ${missing.name}: ip address <ip> <mask> → no shutdown`)
      return hints
    }
    const stillAdmin = phys.filter(i => i.ip && i.status === 'admin_down')
    if (stillAdmin.length)
      return stillAdmin.map(i => `${r.hostname}: ${i.name} has IP but is still admin-down — run: no shutdown`)
    const nets = new Set(ready.map(i => networkAddress(i.ip, i.subnet_mask)))
    if (nets.size < 2)
      return [`${r.hostname}: both interfaces are on the same subnet — one must be LAN (/24), one must be WAN (/30)`]
    return []
  }

  if (!checks.t4 && checks.t3 && routers[0]) {
    const h = routerIfHints(routers[0])
    if (h.length) out.t4 = h
  }
  if (!checks.t5 && checks.t3 && routers[1]) {
    const h = routerIfHints(routers[1])
    if (h.length) out.t5 = h
  }

  // t6 — host config
  if (!checks.t6 && checks.t3) {
    const hints = []
    for (const h of [...pcs, server].filter(Boolean)) {
      const iface = h.interfaces.find(i => i.ip && i.subnet_mask && i.status === 'up')
      if (!iface) {
        const hasIp = h.interfaces.find(i => i.ip)
        hints.push(hasIp
          ? `${h.hostname}: interface down — run: ip link set eth0 up`
          : `${h.hostname}: no IP — run: ip addr add 192.168.x.y/24 dev eth0 && ip link set eth0 up`)
        continue
      }
      const defRoute = (h.routing_table ?? []).find(r => r.network === '0.0.0.0')
      if (!defRoute) {
        const gw = _gwForHost(h, iface, topology)
        hints.push(`${h.hostname}: no default gateway — run: ip route add default via ${gw ?? '<router-LAN-ip>'}`)
        continue
      }
      if (networkAddress(defRoute.next_hop, iface.subnet_mask) !== networkAddress(iface.ip, iface.subnet_mask))
        hints.push(`${h.hostname}: gateway ${defRoute.next_hop} is not in subnet ${networkAddress(iface.ip, iface.subnet_mask)} — fix it`)
    }
    if (hints.length) out.t6 = hints
  }

  // t7 — R1 static route
  if (!checks.t7 && checks.t4 && routers[0]) {
    const r  = routers[0]
    const r2 = routers[1]
    if (r.routing_table.length === 0) {
      // Clinical LAN = R2's interface that does NOT face R1
      const r2LanIf = r2?.interfaces.find(i =>
        i.ip && i.subnet_mask && !i.parent && i.connected_to?.split(':')[0] !== r.id)
      const r2WanIf = r2?.interfaces.find(i => i.connected_to?.split(':')[0] === r.id && i.ip)
      const dstNet  = r2LanIf ? networkAddress(r2LanIf.ip, r2LanIf.subnet_mask) : '192.168.2.0'
      const dstMask = r2LanIf?.subnet_mask ?? '255.255.255.0'
      const nextHop = r2WanIf?.ip ?? '<R2-WAN-ip>'
      out.t7 = [
        `${r.hostname}: no static route to Clinical LAN — open terminal:`,
        `  enable → configure terminal`,
        `  ip route ${dstNet} ${dstMask} ${nextHop}`,
      ]
    }
  }

  // t8 — R2 static route
  if (!checks.t8 && checks.t5 && routers[1]) {
    const r  = routers[1]
    const r1 = routers[0]
    if (r.routing_table.length === 0) {
      // Reception LAN = R1's interface that does NOT face R2
      const r1LanIf = r1?.interfaces.find(i =>
        i.ip && i.subnet_mask && !i.parent && i.connected_to?.split(':')[0] !== r.id)
      const r1WanIf = r1?.interfaces.find(i => i.connected_to?.split(':')[0] === r.id && i.ip)
      const dstNet  = r1LanIf ? networkAddress(r1LanIf.ip, r1LanIf.subnet_mask) : '192.168.1.0'
      const dstMask = r1LanIf?.subnet_mask ?? '255.255.255.0'
      const nextHop = r1WanIf?.ip ?? '<R1-WAN-ip>'
      out.t8 = [
        `${r.hostname}: no static route to Reception LAN — open terminal:`,
        `  enable → configure terminal`,
        `  ip route ${dstNet} ${dstMask} ${nextHop}`,
      ]
    }
  }

  // t9 — ping diagnostic (calls checkPing to find the actual failure)
  if (!checks.t9 && checks.t7 && checks.t8) {
    const hints = []

    // Find the Reception PC — one that has ≥2 cross-subnet targets
    for (const srcPc of pcs) {
      const si = srcPc.interfaces.find(i => i.ip && i.subnet_mask && i.status === 'up')
      if (!si) continue
      const srcNet      = networkAddress(si.ip, si.subnet_mask)
      const allHosts    = [...pcs, server].filter(Boolean)
      const crossTargets = allHosts.filter(h => {
        if (h === srcPc) return false
        const hi = h.interfaces.find(i => i.ip && i.subnet_mask && i.status === 'up')
        return hi && networkAddress(hi.ip, hi.subnet_mask) !== srcNet
      })
      if (crossTargets.length < 2) continue  // not Reception PC

      let anyRemaining = false
      for (const target of crossTargets) {
        const ti = target.interfaces.find(i => i.ip && i.subnet_mask && i.status === 'up')
        if (!ti) continue
        const logged = topology.pingLog.has(`${si.ip}:${ti.ip}`) || topology.pingLog.has(`${ti.ip}:${si.ip}`)
        if (logged) continue
        anyRemaining = true

        const result = topology.checkPing(si.ip, ti.ip)
        if (result.reachable) {
          hints.push(`Routing to ${target.hostname} (${ti.ip}) works! Open ${srcPc.hostname} terminal:`)
          hints.push(`  ping ${ti.ip}`)
          continue
        }

        const dstNet = networkAddress(ti.ip, ti.subnet_mask)
        if (result.failureReason === 'no_route' || result.failureReason === 'host_no_gateway') {
          for (const router of routers) {
            const covered = router.routing_table.some(rt =>
              networkAddress(ti.ip, rt.mask ?? '255.255.255.0') === rt.network)
            if (!covered) {
              const peer    = routers.find(ro => ro !== router)
              const peerWan = peer?.interfaces.find(i => i.connected_to?.split(':')[0] === router.id && i.ip)
              const nhop    = peerWan?.ip ?? '<peer-WAN-ip>'
              hints.push(`${router.hostname}: missing route to ${dstNet} (needed to reach ${target.hostname})`)
              hints.push(`  enable → configure terminal → ip route ${dstNet} ${ti.subnet_mask} ${nhop}`)
            }
          }
        } else if (result.failureReason === 'no_return_path') {
          for (const router of routers) {
            const covered = router.routing_table.some(rt =>
              networkAddress(si.ip, rt.mask ?? '255.255.255.0') === rt.network)
            if (!covered) {
              const peer    = routers.find(ro => ro !== router)
              const peerWan = peer?.interfaces.find(i => i.connected_to?.split(':')[0] === router.id && i.ip)
              const nhop    = peerWan?.ip ?? '<peer-WAN-ip>'
              const srcNet2 = networkAddress(si.ip, si.subnet_mask)
              hints.push(`${router.hostname}: missing return route to ${srcNet2} (reply can't get back)`)
              hints.push(`  enable → configure terminal → ip route ${srcNet2} ${si.subnet_mask} ${nhop}`)
            }
          }
        } else if (result.failureReason === 'admin_down' || result.failureReason === 'link_down') {
          hints.push(`A link is down on the path to ${target.hostname} — check cables and interface status`)
          hints.push(`  Run on each router: show ip interface brief`)
        } else {
          hints.push(`Cannot reach ${target.hostname} (${ti.ip}) — verify IP addressing and routing`)
        }
      }

      if (!anyRemaining) {
        hints.push(`All cross-subnet pings logged — t9 should complete on next refresh`)
      }
      break
    }

    if (hints.length) out.t9 = hints
  }

  return out
}

function diagnose004(devices, placements, topology, checks) {
  const router = devices.find(d => d.type === 'router')
  const sw     = devices.find(d => d.type === 'switch')
  const pcs    = devices.filter(d => d.type === 'pc')
  const server = devices.find(d => d.type === 'server')
  const phone  = devices.find(d => d.type === 'phone')
  const isp    = devices.find(d => d.type === 'isp')
  const out    = {}

  if (!checks.t1) {
    const missing = []
    if (!router) missing.push('1 Router ($1,200)')
    if (!sw) missing.push('1 Switch ($800)')
    if (pcs.length < 3) missing.push(`${3 - pcs.length} more PC(s) ($200 each)`)
    if (!server) missing.push('1 Server ($600)')
    if (!phone) missing.push('1 IP Phone ($150)')
    if (missing.length) out.t1 = [`Still needed from the Shop:`, ...missing.map(m => `  ${m}`)]
  }

  if (!checks.t2 && checks.t1) {
    const unplaced = [router, sw, ...pcs, server, phone].filter(d => !placements[d.id])
    if (unplaced.length)
      out.t2 = [`Drag to the floorplan:`, ...unplaced.map(d => `  ${d.hostname} (${d.type})`)]
  }

  if (!checks.t3 && checks.t2) {
    const hints = []
    const swToRouter = sw.interfaces.some(i => i.connected_to?.split(':')[0] === router.id) ||
                       router.interfaces.some(i => !i.parent && i.connected_to?.split(':')[0] === sw.id)
    if (!swToRouter) hints.push(`${sw.hostname} ↔ ${router.hostname}: trunk cable missing`)
    for (const h of [...pcs, server, phone]) {
      const onSw = h.interfaces.some(i => i.connected_to?.split(':')[0] === sw.id) ||
                   sw.interfaces.some(i => i.connected_to?.split(':')[0] === h.id)
      if (!onSw) hints.push(`${h.hostname}: not connected to the switch`)
    }
    if (isp && !router.interfaces.some(i => !i.parent && i.connected_to?.split(':')[0] === isp.id))
      hints.push(`${router.hostname}: WAN port not connected to ISP`)
    if (hints.length) out.t3 = hints
  }

  if (!checks.t4 && checks.t3) {
    const hints = []
    const trunkPort = sw.interfaces.find(i =>
      i.connected_to?.split(':')[0] === router.id && i.switchport_mode === 'trunk'
    )
    if (!trunkPort) hints.push(`Switch port to router is not a trunk — on the switch: interface <port> → switchport mode trunk`)
    const accessVlans = new Set(
      sw.interfaces
        .filter(i => i.switchport_mode !== 'trunk' && !i.svi && i.vlan && i.vlan !== 1)
        .map(i => i.vlan)
    )
    const needed = [10, 20, 30, 40].filter(v => !accessVlans.has(v))
    if (needed.length)
      hints.push(`VLANs not yet assigned to host ports: ${needed.join(', ')} — on the switch:`,
        ...needed.map(v => `  interface <port> → switchport mode access → switchport access vlan ${v}`))
    if (hints.length) out.t4 = hints
  }

  if (!checks.t5 && checks.t4) {
    const hints = []
    const parentIf = router.interfaces.find(i =>
      !i.parent && !i.svi && i.connected_to?.split(':')[0] === sw.id
    )
    if (parentIf?.status === 'admin_down')
      hints.push(`${router.hostname}: physical trunk port ${parentIf.name} is admin-down — run: interface ${parentIf.name} → no shutdown`)
    const presentTags = new Set(
      router.interfaces
        .filter(i => i.parent && i.vlanTag !== null && i.ip && i.status === 'up')
        .map(i => i.vlanTag)
    )
    const vlanMap = { 10: '192.168.10.1', 20: '192.168.20.1', 30: '192.168.30.1', 40: '192.168.40.1' }
    for (const [v, gw] of Object.entries(vlanMap)) {
      if (!presentTags.has(Number(v)))
        hints.push(`Missing subinterface for VLAN ${v}:`,
          `  interface ${parentIf?.name ?? 'Gi0/0'}.${v}`,
          `  encapsulation dot1Q ${v}`,
          `  ip address ${gw} 255.255.255.0`)
    }
    if (hints.length) out.t5 = hints
  }

  if (!checks.t6 && checks.t5) {
    const srvIf = server?.interfaces.find(i => i.ip && i.status === 'up')
    if (!srvIf) {
      out.t6 = [
        `Server has no static IP. Open the Server terminal:`,
        `  ip addr add 192.168.30.10/24 dev eth0`,
        `  ip link set eth0 up`,
        `  ip route add default via 192.168.30.1`,
      ]
    } else if (srvIf.dhcp_assigned) {
      out.t6 = [`Server got a DHCP address (${srvIf.ip}) — release it and set a static IP:`,
        `  dhclient -r eth0`,
        `  ip addr add 192.168.30.10/24 dev eth0`,
        `  ip route add default via 192.168.30.1`]
    } else {
      const srvGw = server.routing_table?.find(r => r.network === '0.0.0.0')
      if (!srvGw)
        out.t6 = [`Server has an IP but no default gateway — run:`,
          `  ip route add default via 192.168.30.1`]
    }
  }

  if (!checks.t7 && checks.t5) {
    const hints = []
    const getSubif = v => router.interfaces.find(i => i.parent && i.vlanTag === v && i.ip)
    for (const v of [10, 20, 40]) {
      const subif = getSubif(v)
      if (!subif) continue
      const hasPool = (router.dhcp_pools ?? []).some(p =>
        p.network && p.mask && networkAddress(subif.ip, p.mask) === p.network
      )
      if (!hasPool) {
        const net = networkAddress(subif.ip, '255.255.255.0')
        hints.push(`Missing DHCP pool for VLAN ${v} — on the router:`,
          `  ip dhcp pool VLAN${v}`,
          `  network ${net} 255.255.255.0`,
          `  default-router ${subif.ip}`,
          `  dns-server 8.8.8.8`)
      }
    }
    const dhcpHosts = [...pcs, phone]
    for (const c of dhcpHosts) {
      const gotIp = c.interfaces.some(i => i.dhcp_assigned && i.ip && i.status === 'up')
      if (!gotIp)
        hints.push(`${c.hostname}: no DHCP lease — open terminal and run: ip link set eth0 up && dhclient eth0`)
    }
    if (hints.length) out.t7 = hints
  }

  if (!checks.t8 && checks.t5) {
    const hints = []
    const wanIf = router.interfaces.find(i =>
      !i.parent && i.connected_to?.split(':')[0] === isp?.id
    )
    if (!wanIf?.ip)
      hints.push(`WAN interface not configured — on the router:`,
        `  interface ${wanIf?.name ?? 'GigabitEthernet0/1'}`,
        `  ip address 203.0.113.2 255.255.255.252`,
        `  no shutdown`)
    else if (wanIf.status !== 'up')
      hints.push(`WAN interface ${wanIf.name} is not up — run: no shutdown`)
    if (!router.routing_table?.find(r => r.network === '0.0.0.0'))
      hints.push(`No default route — on the router: ip route 0.0.0.0 0.0.0.0 203.0.113.1`)
    if (hints.length) out.t8 = hints
  }

  if (!checks.t9 && checks.t8) {
    const hints = []
    const parentIf = router.interfaces.find(i =>
      !i.parent && !i.svi && i.connected_to?.split(':')[0] === sw.id
    )
    const wanIf = router.interfaces.find(i =>
      !i.parent && i.connected_to?.split(':')[0] === isp?.id && i.ip
    )
    if (parentIf && !parentIf.nat_inside)
      hints.push(`LAN trunk port missing "ip nat inside" — on the router: interface ${parentIf.name} → ip nat inside`)
    if (wanIf && !wanIf.nat_outside)
      hints.push(`WAN port missing "ip nat outside" — on the router: interface ${wanIf.name} → ip nat outside`)
    if (!(router.nat_acls?.length))
      hints.push(`No NAT ACL — create one:`,
        `  access-list 1 permit 192.168.10.0 0.0.0.255`,
        `  access-list 1 permit 192.168.20.0 0.0.0.255`,
        `  access-list 1 permit 192.168.30.0 0.0.0.255`,
        `  access-list 1 permit 192.168.40.0 0.0.0.255`)
    if (!(router.nat_rules?.length))
      hints.push(`No NAT overload rule — add:`,
        `  ip nat inside source list 1 interface ${wanIf?.name ?? 'GigabitEthernet0/1'} overload`)
    if (hints.length) out.t9 = hints
  }

  if (!checks.t10 && checks.t7 && checks.t6) {
    const sub10 = router.interfaces.find(i => i.parent && i.vlanTag === 10 && i.ip)
    const srvIf = server?.interfaces.find(i => i.ip && i.status === 'up')
    const net10 = sub10 ? networkAddress(sub10.ip, sub10.subnet_mask ?? '255.255.255.0') : null
    const vlan10Clients = [...pcs, phone].filter(c => {
      const cif = c.interfaces.find(i => i.dhcp_assigned && i.ip && i.status === 'up')
      return cif && net10 && networkAddress(cif.ip, cif.subnet_mask ?? '255.255.255.0') === net10
    })
    if (vlan10Clients.length && srvIf)
      out.t10 = [`Open a VLAN-10 user PC terminal and ping the server:`,
        `  ping ${srvIf.ip}`,
        `VLAN-10 clients: ${vlan10Clients.map(c => c.hostname).join(', ')}`]
    else if (!vlan10Clients.length)
      out.t10 = [`No VLAN-10 DHCP clients found — complete t7 first`]
  }

  if (!checks.t11 && checks.t9 && checks.t7) {
    out.t11 = [`Open any PC or Phone terminal and ping the internet:`,
      `  ping 8.8.8.8`]
  }

  return out
}

// ── Mission 005 ───────────────────────────────────────────────────────────────
//
// Secure the Office — perimeter firewall, DMZ, zone-based policy, ordering puzzle
// Addressing plan:
//   FW INSIDE  (Gi0/0): 10.0.0.2/30  ↔ R1 WAN (Gi0/1): 10.0.0.1/30
//   FW DMZ     (Gi0/1): 172.16.1.1/24 — server at 172.16.1.10
//   FW OUTSIDE (Gi0/2): 203.0.113.2/30 ↔ ISP: 203.0.113.1/30
//   LAN VLANs behind R1: 192.168.10-40.0/24 (unchanged from M004)

const TASKS_005 = [
  // ── Build ────────────────────────────────────────────────────────────────────
  {
    id: 't1',
    label: 'Buy 1 Firewall from the Shop',
    hint: 'Open the Shop tab and purchase one Firewall. The M004 network (router, switch, PCs, server) is pre-configured and ready.',
  },
  {
    id: 't2',
    label: 'Place the Firewall on the map',
    hint: 'Drag the Firewall from Inventory onto the floorplan. Place it between the router and the ISP.',
  },
  {
    id: 't3',
    label: 'Cable: Server→FW DMZ port, R1 WAN port→FW INSIDE port, FW OUTSIDE port→ISP',
    hint: [
      'Right-click each device → Connect Cable:',
      '  1. The server is currently on the switch (VLAN 30 from M004). Right-click the switch',
      '     port connected to the server → Disconnect, then cable Server → FW DMZ port.',
      '  2. Cable R1\'s free WAN port (Gi0/1) to an FW port (this becomes the INSIDE leg).',
      '  3. Cable the remaining FW port to the ISP (this becomes the OUTSIDE leg).',
    ],
  },
  // ── Firewall Interfaces ───────────────────────────────────────────────────────
  {
    id: 't4',
    label: 'Configure FW interfaces: IPs + zones (nameif INSIDE/DMZ/OUTSIDE) + no shutdown',
    hint: [
      'Open the Firewall terminal:',
      'enable', 'configure terminal',
      '# INSIDE leg (toward R1):',
      'interface GigabitEthernet0/0',
      'nameif INSIDE', 'security-level 100',
      'ip address 10.0.0.2 255.255.255.252', 'no shutdown', 'exit',
      '# DMZ leg (toward server):',
      'interface GigabitEthernet0/1',
      'nameif DMZ', 'security-level 50',
      'ip address 172.16.1.1 255.255.255.0', 'no shutdown', 'exit',
      '# OUTSIDE leg (toward ISP):',
      'interface GigabitEthernet0/2',
      'nameif OUTSIDE', 'security-level 0',
      'ip address 203.0.113.2 255.255.255.252', 'no shutdown', 'exit',
    ],
  },
  // ── Router Reconfiguration ────────────────────────────────────────────────────
  {
    id: 't5',
    label: 'Reconfigure R1 WAN: new IP 10.0.0.1/30, default route via 10.0.0.2 (FW)',
    hint: [
      'Open the Router terminal — the WAN address changes from 203.0.113.2 to 10.0.0.1:',
      'enable', 'configure terminal',
      '# Replace WAN IP (use the interface cabled to the FW):',
      'interface GigabitEthernet0/1',
      'no ip address', 'ip address 10.0.0.1 255.255.255.252', 'no shutdown', 'exit',
      '# Replace default route — now points at the firewall, not the ISP directly:',
      'no ip route 0.0.0.0 0.0.0.0 203.0.113.1',
      'ip route 0.0.0.0 0.0.0.0 10.0.0.2',
    ],
  },
  // ── Server in DMZ ─────────────────────────────────────────────────────────────
  {
    id: 't6',
    label: 'Move server to DMZ: new static IP 172.16.1.10/24, gateway 172.16.1.1',
    hint: [
      'Open the Server terminal — release the old VLAN-30 address, assign DMZ address:',
      'ip addr flush dev eth0',
      'ip addr add 172.16.1.10/24 dev eth0',
      'ip link set eth0 up',
      'ip route add default via 172.16.1.1',
    ],
  },
  // ── FW Routing ────────────────────────────────────────────────────────────────
  {
    id: 't7',
    label: 'FW routing: default route to ISP + static routes to all 4 LAN subnets via R1',
    hint: [
      'Open the Firewall terminal — it needs a default route and return paths:',
      'enable', 'configure terminal',
      '# Default route to internet:',
      'ip route 0.0.0.0 0.0.0.0 203.0.113.1',
      '# Return routes to each LAN VLAN (next-hop = R1\'s INSIDE-facing IP):',
      'ip route 192.168.10.0 255.255.255.0 10.0.0.1',
      'ip route 192.168.20.0 255.255.255.0 10.0.0.1',
      'ip route 192.168.30.0 255.255.255.0 10.0.0.1',
      'ip route 192.168.40.0 255.255.255.0 10.0.0.1',
    ],
  },
  // ── FW NAT ───────────────────────────────────────────────────────────────────
  {
    id: 't8',
    label: 'FW NAT: ip nat inside/outside, ACL for all private subnets, overload rule',
    hint: [
      'Open the Firewall terminal — NAT now lives here, not on R1:',
      'enable', 'configure terminal',
      '# Mark INSIDE interface:',
      'interface GigabitEthernet0/0', 'ip nat inside', 'exit',
      '# Mark OUTSIDE interface:',
      'interface GigabitEthernet0/2', 'ip nat outside', 'exit',
      '# ACL for all private subnets:',
      'access-list 1 permit 192.168.10.0 0.0.0.255',
      'access-list 1 permit 192.168.20.0 0.0.0.255',
      'access-list 1 permit 192.168.30.0 0.0.0.255',
      'access-list 1 permit 192.168.40.0 0.0.0.255',
      '# PAT overload — all private hosts share the one public WAN IP:',
      'ip nat inside source list 1 interface GigabitEthernet0/2 overload',
    ],
  },
  // ── Security Policy ──────────────────────────────────────────────────────────
  {
    id: 't9',
    label: 'Security policy: permit INSIDE→OUTSIDE (any), permit OUTSIDE→DMZ HTTPS only',
    hint: [
      'Open the Firewall terminal — two explicit permit rules, everything else is blocked:',
      'enable', 'configure terminal',
      '# Inside hosts can reach the internet (stateful — return traffic is automatic):',
      'firewall-rule permit from-zone INSIDE to-zone OUTSIDE src any dst any service any',
      '# Publish server on HTTPS only — nothing else from outside reaches the DMZ:',
      'firewall-rule permit from-zone OUTSIDE to-zone DMZ src any dst any service HTTPS',
    ],
  },
  // ── Ordering Puzzle ──────────────────────────────────────────────────────────
  {
    id: 't10',
    label: 'Ordering puzzle: deny Guest VLAN → DMZ above the broad INSIDE→DMZ HTTPS permit',
    hint: [
      'Open the Firewall terminal — first-match wins, so the narrow deny must be ABOVE the broad permit:',
      'enable', 'configure terminal',
      '# Step 1 — add an explicit permit for INSIDE→DMZ HTTPS (Guest included):',
      'firewall-rule permit from-zone INSIDE to-zone DMZ src any dst any service HTTPS',
      '# Step 2 — ABOVE that rule, deny Guest VLAN from reaching the DMZ:',
      '# Run "show firewall-rules" to see current IDs, then:',
      'no firewall-rule <id-of-the-INSIDE-to-DMZ-permit>',
      '# Now re-add the deny first, then the permit:',
      'firewall-rule deny  from-zone INSIDE to-zone DMZ src 192.168.20.0/24 dst any service any',
      'firewall-rule permit from-zone INSIDE to-zone DMZ src any dst any service HTTPS',
      '# Result: Guest VLAN (192.168.20.x) hits the deny and stops; others continue to the permit.',
    ],
  },
  // ── Verify ───────────────────────────────────────────────────────────────────
  {
    id: 't11',
    label: 'Verify: an inside user PC pings 8.8.8.8 (internet works through the firewall)',
    hint: [
      'Open a VLAN-10 user PC terminal (one with a 192.168.10.x DHCP address):',
      'ping 8.8.8.8',
      '# Success = INSIDE→OUTSIDE stateful rule + NAT PAT are working end-to-end.',
    ],
  },
]

function check005(devices, placements, topology) {
  const fw     = devices.find(d => d.type === 'firewall')
  const router = devices.find(d => d.type === 'router')
  const sw     = devices.find(d => d.type === 'switch')
  const server = devices.find(d => d.type === 'server')
  const isp    = devices.find(d => d.type === 'isp')
  const pcs    = devices.filter(d => d.type === 'pc')
  const phone  = devices.find(d => d.type === 'phone')

  // t1: firewall purchased
  const t1 = !!fw

  // t2: firewall placed on floorplan
  const t2 = t1 && !!placements[fw.id]

  // t3: three cables — server→FW, router→FW, FW→ISP
  const fwToIsp = t2 && !!isp && fw.interfaces.some(i =>
    i.connected_to?.split(':')[0] === isp.id
  )
  const fwToRouter = t2 && !!router && (
    fw.interfaces.some(i => i.connected_to?.split(':')[0] === router.id) ||
    router.interfaces.some(i => !i.parent && i.connected_to?.split(':')[0] === fw.id)
  )
  const fwToServer = t2 && !!server && (
    fw.interfaces.some(i => i.connected_to?.split(':')[0] === server.id) ||
    server.interfaces.some(i => i.connected_to?.split(':')[0] === fw.id)
  )
  const t3 = fwToIsp && fwToRouter && fwToServer

  // t4: FW has 3 zones (INSIDE, DMZ, OUTSIDE) each on an interface with IP + not admin_down
  const zones = fw ? fw.fw_zones ?? {} : {}
  const zoneNames = Object.values(zones).map(z => z.toUpperCase())
  const hasInsideZone   = zoneNames.includes('INSIDE')
  const hasDmzZone      = zoneNames.includes('DMZ')
  const hasOutsideZone  = zoneNames.includes('OUTSIDE')
  const fwZonesOk = hasInsideZone && hasDmzZone && hasOutsideZone
  // All three zone interfaces must have IPs and not be admin_down
  const fwIfUp = fw ? [hasInsideZone, hasDmzZone, hasOutsideZone].every(() => {
    const zoneIf = fw.interfaces.find(i => i.ip && i.status !== 'admin_down')
    return !!zoneIf
  }) : false
  const insideIf  = fw ? fw.interfaces.find(i => (fw.fw_zones ?? {})[i.name]?.toUpperCase() === 'INSIDE' && i.ip && i.status !== 'admin_down') : null
  const dmzIf     = fw ? fw.interfaces.find(i => (fw.fw_zones ?? {})[i.name]?.toUpperCase() === 'DMZ'    && i.ip && i.status !== 'admin_down') : null
  const outsideIf = fw ? fw.interfaces.find(i => (fw.fw_zones ?? {})[i.name]?.toUpperCase() === 'OUTSIDE' && i.ip && i.status !== 'admin_down') : null
  const t4 = fwZonesOk && !!insideIf && !!dmzIf && !!outsideIf

  // t5: R1 WAN interface has 10.0.0.1/30 (or same subnet as FW INSIDE), default route → FW
  const routerWanIf = t4 && router ? router.interfaces.find(i =>
    !i.parent && i.connected_to?.split(':')[0] === fw?.id && i.ip && i.status !== 'admin_down'
  ) : null
  const r1ToFwSubnet = routerWanIf && insideIf ?
    networkAddress(routerWanIf.ip, routerWanIf.subnet_mask ?? '255.255.255.252') ===
    networkAddress(insideIf.ip, insideIf.subnet_mask ?? '255.255.255.252') : false
  const r1DefRoute = router?.routing_table?.find(r => r.network === '0.0.0.0')
  const r1DefRouteViaFw = r1DefRoute && insideIf && r1DefRoute.next_hop === insideIf.ip
  const t5 = t4 && !!routerWanIf && r1ToFwSubnet && !!r1DefRouteViaFw

  // t6: server has static IP in 172.16.1.0/24, gateway = FW DMZ IP
  const srvIf  = server?.interfaces.find(i => i.ip && i.subnet_mask && i.status === 'up' && !i.dhcp_assigned)
  const srvNet = srvIf ? networkAddress(srvIf.ip, srvIf.subnet_mask) : null
  const dmzNet = dmzIf ? networkAddress(dmzIf.ip, dmzIf.subnet_mask ?? '255.255.255.0') : null
  const srvGw  = server?.routing_table?.find(r => r.network === '0.0.0.0')
  const t6 = t4 && !!srvIf && srvNet === dmzNet && !!srvGw && srvGw.next_hop === dmzIf?.ip

  // t7: FW has default route + at least 4 static routes covering the 4 LAN VLANs
  const fwDefRoute = fw?.routing_table?.find(r => r.network === '0.0.0.0')
  const lanNets    = ['192.168.10.0', '192.168.20.0', '192.168.30.0', '192.168.40.0']
  const fwHasLanRoutes = fw ? lanNets.every(net =>
    (fw.routing_table ?? []).some(r => r.network === net)
  ) : false
  const t7 = t5 && !!fwDefRoute && fwHasLanRoutes

  // t8: FW NAT — inside interface marked nat_inside, outside marked nat_outside, ACL + rule
  const fwNatInside  = insideIf?.nat_inside  === true
  const fwNatOutside = outsideIf?.nat_outside === true
  const fwHasNatAcl  = (fw?.nat_acls?.length ?? 0) > 0
  const fwHasNatRule = (fw?.nat_rules?.length ?? 0) > 0
  const t8 = t7 && fwNatInside && fwNatOutside && fwHasNatAcl && fwHasNatRule

  // t9: security policy — INSIDE→OUTSIDE permit (any) AND OUTSIDE→DMZ permit (tcp/443)
  const rules = fw?.fw_rules ?? []
  const hasInsideOutPermit = rules.some(r =>
    r.action === 'permit' &&
    r.fromZone?.toUpperCase() === 'INSIDE' &&
    r.toZone?.toUpperCase()   === 'OUTSIDE' &&
    r.enabled !== false
  )
  const hasOutsideDmzHttps = rules.some(r =>
    r.action === 'permit' &&
    r.fromZone?.toUpperCase() === 'OUTSIDE' &&
    r.toZone?.toUpperCase()   === 'DMZ' &&
    r.service && r.service !== 'any' &&
    (r.service.port === 443 || r.service === 'HTTPS') &&
    r.enabled !== false
  )
  const t9 = t8 && hasInsideOutPermit && hasOutsideDmzHttps

  // t10: ordering puzzle — a deny for Guest (192.168.20.x) → DMZ must sit BEFORE the
  // broad INSIDE→DMZ permit (or any INSIDE→DMZ rule that would otherwise match guest).
  // We verify via checkPing: guest IP → server:443 must be blocked_by_firewall,
  // while a VLAN-10 IP → server:443 is reachable.
  const t10 = (() => {
    if (!t9 || !srvIf) return false
    const guestSubif = router?.interfaces.find(i => i.parent && i.vlanTag === 20 && i.ip)
    const userSubif  = router?.interfaces.find(i => i.parent && i.vlanTag === 10 && i.ip)
    if (!guestSubif || !userSubif) return false
    const guestNet = networkAddress(guestSubif.ip, guestSubif.subnet_mask ?? '255.255.255.0')
    const guestIp  = guestNet.replace(/\.0$/, '.50') // synthetic guest host
    const userIp   = networkAddress(userSubif.ip, userSubif.subnet_mask ?? '255.255.255.0').replace(/\.0$/, '.50')
    const svc443 = { protocol: 'tcp', port: 443 }
    const guestResult = topology.checkPing(guestIp, srvIf.ip, svc443)
    const userResult  = topology.checkPing(userIp,  srvIf.ip, svc443)
    return !guestResult.reachable && guestResult.failureReason === 'blocked_by_firewall' &&
           userResult.reachable
  })()

  // t11: internet verify — any VLAN-10 DHCP client has logged a successful ping to 8.8.8.8
  const t11 = (() => {
    if (!t8 || !t9) return false
    const allClients = [...pcs, phone].filter(Boolean)
    return allClients.some(c => {
      const cif = c.interfaces.find(i => i.ip && i.status === 'up')
      return cif && topology.pingLog.has(`${cif.ip}:8.8.8.8`)
    })
  })()

  return { t1, t2, t3, t4, t5, t6, t7, t8, t9, t10, t11 }
}

function diagnose005(devices, placements, topology, checks) {
  const fw     = devices.find(d => d.type === 'firewall')
  const router = devices.find(d => d.type === 'router')
  const server = devices.find(d => d.type === 'server')
  const isp    = devices.find(d => d.type === 'isp')
  const pcs    = devices.filter(d => d.type === 'pc')
  const phone  = devices.find(d => d.type === 'phone')
  const out    = {}

  if (!checks.t1) {
    out.t1 = ['Open the Shop tab and buy 1 Firewall ($1,500).']
  }

  if (!checks.t2 && checks.t1) {
    out.t2 = ['Drag the Firewall from Inventory onto the floorplan.']
  }

  if (!checks.t3 && checks.t2) {
    const hints = []
    if (!fw.interfaces.some(i => i.connected_to?.split(':')[0] === isp?.id) &&
        !(isp?.interfaces.some(i => i.connected_to?.split(':')[0] === fw?.id)))
      hints.push('FW is not cabled to ISP — right-click FW → Connect Cable → click ISP.')
    if (!fw.interfaces.some(i => i.connected_to?.split(':')[0] === router?.id) &&
        !router?.interfaces.some(i => !i.parent && i.connected_to?.split(':')[0] === fw?.id))
      hints.push('FW is not cabled to R1 — right-click FW → Connect Cable → click R1.')
    if (!fw.interfaces.some(i => i.connected_to?.split(':')[0] === server?.id) &&
        !server?.interfaces.some(i => i.connected_to?.split(':')[0] === fw?.id))
      hints.push('FW is not cabled to Server — right-click FW → Connect Cable → click Server.')
    if (hints.length) out.t3 = hints
  }

  if (!checks.t4 && checks.t3) {
    const hints = []
    const zones = fw?.fw_zones ?? {}
    const zoneNames = Object.values(zones).map(z => z.toUpperCase())
    const missing = ['INSIDE', 'DMZ', 'OUTSIDE'].filter(z => !zoneNames.includes(z))
    if (missing.length)
      hints.push(`Missing zones on FW: ${missing.join(', ')} — open FW terminal and run nameif on each interface.`)
    for (const iface of (fw?.interfaces ?? [])) {
      if (!iface.connected_to) continue
      if (!iface.ip)
        hints.push(`FW ${iface.name}: no IP — configure: ip address <ip> <mask>`)
      else if (iface.status === 'admin_down')
        hints.push(`FW ${iface.name}: admin-down — run: no shutdown`)
    }
    if (hints.length) out.t4 = hints
  }

  if (!checks.t5 && checks.t4) {
    const hints = []
    const insideIf = fw?.interfaces.find(i => (fw.fw_zones ?? {})[i.name]?.toUpperCase() === 'INSIDE' && i.ip)
    const routerWanIf = router?.interfaces.find(i => !i.parent && i.connected_to?.split(':')[0] === fw?.id && i.ip)
    if (!routerWanIf)
      hints.push('R1 WAN interface (cabled to FW) has no IP — open R1 terminal:',
        '  interface GigabitEthernet0/1', '  ip address 10.0.0.1 255.255.255.252', '  no shutdown')
    if (insideIf && routerWanIf &&
        networkAddress(routerWanIf.ip, routerWanIf.subnet_mask ?? '255.255.255.252') !==
        networkAddress(insideIf.ip,    insideIf.subnet_mask    ?? '255.255.255.252'))
      hints.push(`R1 WAN IP (${routerWanIf.ip}) and FW INSIDE IP (${insideIf.ip}) are on different subnets — they must be /30 neighbours.`)
    const r1Def = router?.routing_table?.find(r => r.network === '0.0.0.0')
    if (!r1Def)
      hints.push(`R1 has no default route — run: ip route 0.0.0.0 0.0.0.0 ${insideIf?.ip ?? '10.0.0.2'}`)
    else if (insideIf && r1Def.next_hop !== insideIf.ip)
      hints.push(`R1 default route points at ${r1Def.next_hop} but FW INSIDE is ${insideIf.ip} — update: ip route 0.0.0.0 0.0.0.0 ${insideIf.ip}`)
    if (hints.length) out.t5 = hints
  }

  if (!checks.t6 && checks.t4) {
    const hints = []
    const dmzIf = fw?.interfaces.find(i => (fw.fw_zones ?? {})[i.name]?.toUpperCase() === 'DMZ' && i.ip)
    const dmzNet = dmzIf ? networkAddress(dmzIf.ip, dmzIf.subnet_mask ?? '255.255.255.0') : null
    const srvIf  = server?.interfaces.find(i => i.ip && i.status === 'up')
    if (!srvIf)
      hints.push('Server has no IP — open Server terminal:',
        '  ip addr add 172.16.1.10/24 dev eth0', '  ip link set eth0 up', '  ip route add default via 172.16.1.1')
    else if (srvIf.dhcp_assigned)
      hints.push(`Server has a DHCP address (${srvIf.ip}) — release it and set a static DMZ address:`,
        '  ip addr flush dev eth0',
        '  ip addr add 172.16.1.10/24 dev eth0',
        '  ip route add default via 172.16.1.1')
    else if (dmzNet && networkAddress(srvIf.ip, srvIf.subnet_mask ?? '255.255.255.0') !== dmzNet)
      hints.push(`Server IP ${srvIf.ip} is not in the DMZ subnet (${dmzNet}/24) — reassign it.`)
    else {
      const srvGw = server?.routing_table?.find(r => r.network === '0.0.0.0')
      if (!srvGw)
        hints.push(`Server has no default gateway — run: ip route add default via ${dmzIf?.ip ?? '172.16.1.1'}`)
      else if (dmzIf && srvGw.next_hop !== dmzIf.ip)
        hints.push(`Server gateway ${srvGw.next_hop} is wrong — should be ${dmzIf.ip} (FW DMZ port).`)
    }
    if (hints.length) out.t6 = hints
  }

  if (!checks.t7 && checks.t5) {
    const hints = []
    const fwDef = fw?.routing_table?.find(r => r.network === '0.0.0.0')
    if (!fwDef)
      hints.push('FW has no default route — run: ip route 0.0.0.0 0.0.0.0 203.0.113.1')
    const lanNets = ['192.168.10.0', '192.168.20.0', '192.168.30.0', '192.168.40.0']
    const insideIf = fw?.interfaces.find(i => (fw.fw_zones ?? {})[i.name]?.toUpperCase() === 'INSIDE' && i.ip)
    for (const net of lanNets) {
      const hasRoute = (fw?.routing_table ?? []).some(r => r.network === net)
      if (!hasRoute)
        hints.push(`FW missing route to ${net} — run: ip route ${net} 255.255.255.0 ${insideIf?.ip === '10.0.0.2' ? '10.0.0.1' : '<R1-INSIDE-ip>'}`)
    }
    if (hints.length) out.t7 = hints
  }

  if (!checks.t8 && checks.t7) {
    const hints = []
    const insideIf  = fw?.interfaces.find(i => (fw.fw_zones ?? {})[i.name]?.toUpperCase() === 'INSIDE')
    const outsideIf = fw?.interfaces.find(i => (fw.fw_zones ?? {})[i.name]?.toUpperCase() === 'OUTSIDE')
    if (insideIf && !insideIf.nat_inside)
      hints.push(`FW INSIDE interface missing "ip nat inside" — run: interface ${insideIf.name} → ip nat inside`)
    if (outsideIf && !outsideIf.nat_outside)
      hints.push(`FW OUTSIDE interface missing "ip nat outside" — run: interface ${outsideIf.name} → ip nat outside`)
    if (!(fw?.nat_acls?.length))
      hints.push('No NAT ACL on FW — create one:',
        '  access-list 1 permit 192.168.10.0 0.0.0.255',
        '  access-list 1 permit 192.168.20.0 0.0.0.255',
        '  access-list 1 permit 192.168.30.0 0.0.0.255',
        '  access-list 1 permit 192.168.40.0 0.0.0.255')
    if (!(fw?.nat_rules?.length))
      hints.push(`No NAT overload rule — run: ip nat inside source list 1 interface ${outsideIf?.name ?? 'GigabitEthernet0/2'} overload`)
    if (hints.length) out.t8 = hints
  }

  if (!checks.t9 && checks.t8) {
    const hints = []
    const rules = fw?.fw_rules ?? []
    const hasInsideOut = rules.some(r =>
      r.action === 'permit' && r.fromZone?.toUpperCase() === 'INSIDE' && r.toZone?.toUpperCase() === 'OUTSIDE' && r.enabled !== false
    )
    const hasDmzHttps = rules.some(r =>
      r.action === 'permit' && r.fromZone?.toUpperCase() === 'OUTSIDE' && r.toZone?.toUpperCase() === 'DMZ' &&
      r.service && r.service !== 'any' && (r.service.port === 443 || r.service === 'HTTPS') && r.enabled !== false
    )
    if (!hasInsideOut)
      hints.push('Missing INSIDE→OUTSIDE permit — run: firewall-rule permit from-zone INSIDE to-zone OUTSIDE src any dst any service any')
    if (!hasDmzHttps)
      hints.push('Missing OUTSIDE→DMZ HTTPS permit — run: firewall-rule permit from-zone OUTSIDE to-zone DMZ src any dst any service HTTPS')
    if (hints.length) out.t9 = hints
  }

  if (!checks.t10 && checks.t9) {
    const rules = fw?.fw_rules ?? []
    const guestDenyIdx = rules.findIndex(r =>
      r.action === 'deny' &&
      r.fromZone?.toUpperCase() === 'INSIDE' &&
      r.toZone?.toUpperCase()   === 'DMZ' &&
      r.src?.includes('192.168.20.') &&
      r.enabled !== false
    )
    const insideDmzPermitIdx = rules.findIndex(r =>
      r.action === 'permit' &&
      r.fromZone?.toUpperCase() === 'INSIDE' &&
      r.toZone?.toUpperCase()   === 'DMZ' &&
      r.enabled !== false
    )
    if (guestDenyIdx === -1)
      out.t10 = [
        'Need a deny rule blocking Guest VLAN from the DMZ:',
        '  firewall-rule deny from-zone INSIDE to-zone DMZ src 192.168.20.0/24 dst any service any',
        'Then add the broad permit AFTER it:',
        '  firewall-rule permit from-zone INSIDE to-zone DMZ src any dst any service HTTPS',
      ]
    else if (insideDmzPermitIdx !== -1 && guestDenyIdx > insideDmzPermitIdx)
      out.t10 = [
        `Rule ordering is wrong — the broad INSIDE→DMZ permit (rule #${insideDmzPermitIdx + 1}) is ABOVE the Guest deny (rule #${guestDenyIdx + 1}).`,
        'First-match wins: Guest traffic hits the permit first and gets through.',
        'Delete and re-create in order: deny Guest first, then permit INSIDE.',
        '  show firewall-rules   (to see IDs)',
        '  no firewall-rule <id-of-permit>',
        '  firewall-rule deny  from-zone INSIDE to-zone DMZ src 192.168.20.0/24 dst any service any',
        '  firewall-rule permit from-zone INSIDE to-zone DMZ src any dst any service HTTPS',
      ]
  }

  if (!checks.t11 && checks.t9) {
    const clients = [...pcs, phone].filter(Boolean)
    const needsPing = clients.filter(c => {
      const cif = c.interfaces.find(i => i.ip && i.status === 'up')
      return cif && !topology.pingLog.has(`${cif.ip}:8.8.8.8`)
    })
    if (needsPing.length)
      out.t11 = [
        'Open an inside PC terminal and ping the internet:',
        '  ping 8.8.8.8',
        `(Suggested: ${needsPing[0]?.hostname})`,
      ]
  }

  return out
}

// ── Registry ──────────────────────────────────────────────────────────────────

export const MISSION_TASKS = {
  mission_001: { tasks: TASKS_001, checkFn: check001, diagnoseFn: diagnose001 },
  mission_002: { tasks: TASKS_002, checkFn: check002, diagnoseFn: diagnose002 },
  mission_003: { tasks: TASKS_003, checkFn: check003, diagnoseFn: diagnose003 },
  mission_004: { tasks: TASKS_004, checkFn: check004, diagnoseFn: diagnose004 },
  mission_005: { tasks: TASKS_005, checkFn: check005, diagnoseFn: diagnose005 },
}
