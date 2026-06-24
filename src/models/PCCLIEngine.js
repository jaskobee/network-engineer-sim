import { isValidIp, isValidMask, broadcastAddress, isHostAddress, networkAddress, maskToPrefixLen, ipToNum, resolveHostname } from './ipUtils.js'
import { performDHCP, releaseDHCP } from './DHCPEngine.js'

// Linux-style CLI for PC and Server device types.
// Uses `ip`, `ifconfig`, `ping`, `route`, `hostname` — no IOS config modes.

export class PCCLIEngine {
  constructor(topology, difficulty = 'beginner') {
    this.topology = topology
    this.difficulty = difficulty
  }

  getPrompt(device) {
    return `user@${device.hostname}:~$`
  }

  execute(device, input) {
    const line = input.trim()
    if (!line) return []
    const tokens = line.split(/\s+/).filter(Boolean)
    const cmd = tokens[0].toLowerCase()
    try {
      return this._dispatch(device, cmd, tokens) || []
    } catch (e) {
      return [`bash: ${e.message}`]
    }
  }

  // Fires onPacket(index, reachable, targetIp, srcIp, failureReason, ttl, rtt) once per echo,
  // ~1100 ms apart.  Returns a cancel() function.
  executePingAsync(device, targetIp, { onStart, onPacket, onDone } = {}) {
    if (!isValidIp(targetIp)) {
      onStart?.([`ping: ${targetIp}: Name or service not known`])
      onDone?.([], false)
      return () => {}
    }
    const srcIp = device.interfaces.find(i => i.status === 'up' && i.ip)?.ip
    if (!srcIp) {
      const noIp = !device.interfaces.find(i => i.ip)
      const lines = [`ping: connect: Network is unreachable`]
      if (noIp) lines.push(`  (no IP configured — run: ip addr add x.x.x.x/24 dev eth0)`)
      else      lines.push(`  (interface is down — run: ip link set eth0 up)`)
      onStart?.(lines)
      onDone?.([], false)
      return () => {}
    }
    const COUNT = 4
    const result = this.topology.checkPing(srcIp, targetIp)

    // "Network is unreachable" class: show error immediately and exit without packet loop
    if (!result.reachable && _isNetworkUnreachable(result.failureReason)) {
      const lines = [`ping: connect: Network is unreachable`]
      const r = result.failureReason
      if      (r === 'host_no_gateway') lines.push(`  (no default gateway — run: ip route add default via <gw>)`)
      else if (r === 'no_route')        lines.push(`  (no route to ${targetIp} — check static routes on routers)`)
      else if (r === 'admin_down')      lines.push(`  (interface is admin-down — run: ip link set eth0 up)`)
      else if (r === 'link_down')       lines.push(`  (link is down — check cable connection)`)
      else if (r === 'subnet_mismatch') lines.push(`  (IP/mask mismatch — verify subnet configuration)`)
      onStart?.(lines)
      onDone?.([], false)
      return () => {}
    }

    const { ttl, routerHops } = _pathInfo(this.topology, srcIp, targetIp)
    const rtts = _pingRtts(COUNT, routerHops)

    onStart?.([`PING ${targetIp} (${targetIp}) 56(84) bytes of data.`])
    let i = 0; const timers = []
    const fire = () => {
      if (i >= COUNT) {
        const recv = result.reachable ? COUNT : 0
        const loss = result.reachable ? 0 : 100
        const timeMs = (COUNT - 1) * 1000 + 3
      const lines = [``, `--- ${targetIp} ping statistics ---`,
          `${COUNT} packets transmitted, ${recv} received, ${loss}% packet loss, time ${timeMs}ms`]
        if (result.reachable) lines.push(_rttStatsLine(rtts))
        onDone?.(lines, result.reachable); return
      }
      onPacket?.(i, result.reachable, targetIp, srcIp, result.failureReason, ttl, rtts[i]); i++
      timers.push(setTimeout(fire, 1100))
    }
    fire()
    return () => timers.forEach(clearTimeout)
  }

  _dispatch(device, cmd, tokens) {
    if (cmd === 'ping')     return this._cmdPing(device, tokens)
    if (cmd === 'dhclient') return this._cmdDhclient(device, tokens)
    if (cmd === 'ip')       return this._cmdIp(device, tokens)
    if (cmd === 'ifconfig') return this._cmdIfconfig(device, tokens)
    if (cmd === 'route')    return this._cmdRoute(device)
    if (cmd === 'hostname') {
      if (tokens[1]) { device.hostname = tokens[1]; return [] }
      return [device.hostname]
    }
    if (cmd === 'whoami') return ['user']
    if (cmd === 'uname')  return [tokens[1] === '-a' ? `Linux ${device.hostname} 5.15.0-netlab #1 SMP x86_64` : 'Linux']
    if (cmd === 'clear')  return ['\x1b[2J\x1b[H']
    if (cmd === 'echo')   return [tokens.slice(1).join(' ')]
    if (cmd === 'help' || cmd === '?') return this._help()
    if (cmd === 'man') return this._cmdMan(tokens)
    return [`bash: ${tokens[0]}: command not found`]
  }

  // ── dhclient ───────────────────────────────────────────────────────────────
  // dhclient [-r] <iface>
  // -r: release the DHCP lease; without -r: request a new lease.
  _cmdDhclient(device, tokens) {
    const releaseFlag = tokens[1] === '-r'
    const ifArg = releaseFlag ? tokens[2] : tokens[1]
    if (!ifArg) return ['Usage: dhclient [-r] <interface>']

    const iface = _resolveIf(device, ifArg)
    if (!iface) return [`dhclient: ${ifArg}: no such interface`]

    if (releaseFlag) {
      const result = releaseDHCP(this.topology, device, iface)
      if (!result.released) return [`dhclient: ${result.message}`]
      return [
        `Killed old lease for IP address ${result.ip}`,
        `dhclient: Released ${result.ip} on ${_linuxName(iface.name)}`,
      ]
    }

    // Acquire lease
    if (iface.ip && !iface.dhcp_assigned) {
      return [
        `dhclient: ${_linuxName(iface.name)}: interface has a manually-assigned address (${iface.ip})`,
        `  Remove it first with: ip addr del ${iface.ip}/<prefix> dev ${_linuxName(iface.name)}`,
      ]
    }

    const result = performDHCP(this.topology, device, iface)
    if (!result.success) {
      return [
        `dhclient: No DHCPOFFERS received.`,
        `  (${result.message})`,
        `No working leases in persistent database - sleeping.`,
      ]
    }

    // Apply the offered configuration (same fields as manual addressing)
    iface.ip           = result.ip
    iface.subnet_mask  = result.mask
    iface.dhcp_assigned = true

    const lines = [
      `DHCPDISCOVER on ${_linuxName(iface.name)} to 255.255.255.255 port 67`,
      `DHCPOFFER of ${result.ip} from server`,
      `DHCPREQUEST for ${result.ip}`,
      `DHCPACK of ${result.ip} from server`,
      `bound to ${result.ip} -- renewal in 43200 seconds.`,
    ]

    // Install default gateway route (tagged dhcp_assigned for later release)
    if (result.gateway && isValidIp(result.gateway)) {
      device.routing_table = device.routing_table.filter(r => !(r.network === '0.0.0.0' && r.dhcp_assigned))
      device.routing_table.push({ network: '0.0.0.0', mask: '0.0.0.0', next_hop: result.gateway, dhcp_assigned: true })
    }

    // Apply DNS server
    if (result.dns && isValidIp(result.dns)) {
      device.dns_server = result.dns
    }

    return lines
  }

  // ── ping ───────────────────────────────────────────────────────────────────
  _cmdPing(device, tokens) {
    let count = 4
    let target = null
    let i = 1
    while (i < tokens.length) {
      if (tokens[i] === '-c' && tokens[i + 1]) { count = parseInt(tokens[i + 1], 10) || 4; i += 2 }
      else { target = tokens[i]; i++ }
    }
    if (!target) return ['Usage: ping [-c count] <destination>']
    if (!isValidIp(target)) {
      const resolved = resolveHostname(target)
      if (!resolved) return [`ping: ${target}: Name or service not known`]
      target = resolved
    }

    const srcIp = device.interfaces.find(i => i.status === 'up' && i.ip)?.ip
    if (!srcIp) return ['ping: connect: Network is unreachable']

    const result = this.topology.checkPing(srcIp, target)
    const lines = [`PING ${target} (${target}) 56(84) bytes of data.`]

    if (result.reachable) {
      const { ttl, routerHops } = _pathInfo(this.topology, srcIp, target)
      const packetCount = Math.min(count, 5)
      const rtts = _pingRtts(packetCount, routerHops)
      for (let n = 0; n < packetCount; n++) {
        lines.push(`64 bytes from ${target}: icmp_seq=${n + 1} ttl=${ttl} time=${rtts[n].toFixed(3)} ms`)
      }
      lines.push('')
      lines.push(`--- ${target} ping statistics ---`)
      lines.push(`${packetCount} packets transmitted, ${packetCount} received, 0% packet loss, time ${(packetCount - 1) * 1000 + 3}ms`)
      lines.push(_rttStatsLine(rtts))
    } else if (_isNetworkUnreachable(result.failureReason)) {
      // Local failure — no packets sent, immediate error
      lines.push('ping: connect: Network is unreachable')
    } else {
      // Remote ICMP unreachable or timeout
      const packetCount = Math.min(count, 4)
      for (let n = 1; n <= packetCount; n++) {
        lines.push(`From ${srcIp} icmp_seq=${n} Destination Host Unreachable`)
      }
      lines.push('')
      lines.push(`--- ${target} ping statistics ---`)
      lines.push(`${packetCount} packets transmitted, 0 received, +${packetCount} errors, 100% packet loss`)
    }
    return lines
  }

  // ── ip ─────────────────────────────────────────────────────────────────────
  _cmdIp(device, tokens) {
    const sub = tokens[1]?.toLowerCase()

    if (!sub || sub === 'addr' || sub === 'address' || sub === 'a') {
      const op = tokens[2]?.toLowerCase()
      if (!op || op === 'show' || op === 'list') return this._showAddr(device)
      if (op === 'add')                return this._addrAdd(device, tokens)
      if (op === 'del' || op === 'delete') return this._addrDel(device, tokens)
    }
    if (sub === 'link' || sub === 'l') {
      const op = tokens[2]?.toLowerCase()
      if (!op || op === 'show') return this._showLink(device)
      if (op === 'set')         return this._linkSet(device, tokens)
    }
    if (sub === 'route' || sub === 'r') {
      const op = tokens[2]?.toLowerCase()
      if (!op || op === 'show' || op === 'list') return this._showRoute(device)
      if (op === 'add')                return this._routeAdd(device, tokens)
      if (op === 'del' || op === 'delete')  return this._routeDel(device, tokens)
    }
    return [`ip: option "${tokens[1] || ''}" is unknown, try "ip help".`]
  }

  _showAddr(device) {
    const lines = []
    device.interfaces.forEach((iface, idx) => {
      const name = _linuxName(iface.name)
      const flags = iface.status === 'up' ? 'UP,BROADCAST,RUNNING,MULTICAST' : 'BROADCAST,MULTICAST'
      lines.push(`${idx + 1}: ${name}: <${flags}> mtu 1500 qdisc fq_codel state ${iface.status === 'up' ? 'UP' : 'DOWN'}`)
      lines.push(`    link/ether 00:11:22:33:44:${idx.toString(16).padStart(2, '0')} brd ff:ff:ff:ff:ff:ff`)
      if (iface.ip && iface.subnet_mask) {
        const prefix = maskToPrefixLen(iface.subnet_mask)
        const bcast = _bcast(iface.ip, iface.subnet_mask)
        const scope = iface.dhcp_assigned ? 'global dynamic' : 'global'
        lines.push(`    inet ${iface.ip}/${prefix} brd ${bcast} scope ${scope} ${name}`)
        lines.push(`       valid_lft forever preferred_lft forever`)
      }
    })
    return lines
  }

  _showLink(device) {
    return device.interfaces.map((iface, idx) => {
      const name = _linuxName(iface.name)
      const state = iface.status === 'up' ? 'UP' : 'DOWN'
      return `${idx + 1}: ${name}: <${state}> mtu 1500 state ${state} mode DEFAULT group default`
    })
  }

  _addrAdd(device, tokens) {
    // ip addr add <ip>/<prefix> dev <if>
    const cidr = tokens[3]
    const devArg = tokens.indexOf('dev') >= 0 ? tokens[tokens.indexOf('dev') + 1] : tokens[4]
    if (!cidr || !devArg) return ['Usage: ip addr add <ip>/<prefix> dev <interface>']
    const [ip, prefixStr] = cidr.split('/')
    if (!isValidIp(ip)) return [`ip: Error: inet prefix is expected rather than "${cidr}".`]
    const mask = _prefixToMask(prefixStr)
    if (!mask) return [`ip: Error: prefix length "${prefixStr}" is invalid.`]
    if (!isHostAddress(ip, mask)) {
      const net = networkAddress(ip, mask)
      const bcast = broadcastAddress(ip, mask)
      if (ip === net)   return [`ip: Error: ${ip} is the network address (not a valid host address).`]
      if (ip === bcast) return [`ip: Error: ${ip} is the broadcast address (not a valid host address).`]
    }
    const iface = _resolveIf(device, devArg)
    if (!iface) return [`ip: Cannot find device "${devArg}"`]
    const dupDevice = [...this.topology.devices.values()].find(dev =>
      dev !== device && dev.interfaces.some(i => i.ip === ip)
    )
    if (dupDevice) return [`ip: Error: ${ip}: address already assigned to another host (duplicate IP)`]
    iface.ip = ip
    iface.subnet_mask = mask
    return []
  }

  _addrDel(device, tokens) {
    const cidr = tokens[3]
    const devArg = tokens.indexOf('dev') >= 0 ? tokens[tokens.indexOf('dev') + 1] : tokens[4]
    if (!cidr || !devArg) return ['Usage: ip addr del <ip>/<prefix> dev <interface>']
    const iface = _resolveIf(device, devArg)
    if (!iface) return [`ip: Cannot find device "${devArg}"`]
    iface.ip = null
    iface.subnet_mask = null
    return []
  }

  _linkSet(device, tokens) {
    // ip link set <if> up|down
    const ifArg = tokens[3]
    const state = tokens[4]?.toLowerCase()
    if (!ifArg || !state) return ['Usage: ip link set <interface> up|down']
    const iface = _resolveIf(device, ifArg)
    if (!iface) return [`ip: Cannot find device "${ifArg}"`]
    if (state === 'up') {
      // Check peer state: if the peer is admin_down there is no carrier signal.
      // Also wake up the peer if it was waiting (peer.status === 'down').
      if (iface.connected_to) {
        const remIface = this.topology._resolveIface(iface.connected_to)
        if (remIface && remIface.status !== 'admin_down') {
          iface.status = 'up'
          if (remIface.status === 'down') remIface.status = 'up'
        } else {
          iface.status = 'down'
        }
      } else {
        iface.status = 'down'
      }
    } else if (state === 'down') {
      iface.status = 'admin_down'
      // Propagate carrier-loss to the peer (real hardware drops link signal immediately)
      if (iface.connected_to) this.topology.shutdownPeer(iface.connected_to)
    } else {
      return [`ip: link: Invalid state "${state}"`]
    }
    return []
  }

  _showRoute(device) {
    const lines = []
    for (const iface of device.interfaces) {
      if (iface.ip && iface.subnet_mask && iface.status === 'up') {
        const net = networkAddress(iface.ip, iface.subnet_mask)
        const pfx = maskToPrefixLen(iface.subnet_mask)
        lines.push(`${net}/${pfx} dev ${_linuxName(iface.name)} proto kernel scope link src ${iface.ip}`)
      }
    }
    for (const r of device.routing_table) {
      const pfx = maskToPrefixLen(r.mask)
      const isDefault = r.network === '0.0.0.0' && pfx === 0
      // Linux ip route shows the default route as "default via ..." not "0.0.0.0/0 via ..."
      const dest = isDefault ? 'default' : `${r.network}/${pfx}`
      const exitIf = _findExitIfForRoute(device, r.next_hop)
      const devPart = exitIf ? ` dev ${_linuxName(exitIf.name)}` : ''
      lines.push(`${dest} via ${r.next_hop}${devPart} proto static`)
    }
    if (lines.length === 0) lines.push('(no routes)')
    return lines
  }

  _routeAdd(device, tokens) {
    // ip route add <net>/<prefix> via <gw>  OR  ip route add default via <gw>
    let cidr = tokens[3]
    const viaIdx = tokens.indexOf('via')
    const nextHop = viaIdx >= 0 ? tokens[viaIdx + 1] : null
    if (!cidr || !nextHop) return ['Usage: ip route add <network>/<prefix> via <gateway>']
    if (cidr === 'default') cidr = '0.0.0.0/0'
    const [network, prefixStr] = cidr.split('/')
    const mask = _prefixToMask(prefixStr ?? '32')
    if (!isValidIp(network)) return [`ip: Error: Invalid network "${network}"`]
    if (!mask) return [`ip: Error: Invalid prefix length "${prefixStr}"`]
    if (!isValidIp(nextHop)) return [`ip: Error: Invalid gateway "${nextHop}"`]
    const canonical = networkAddress(network, mask)
    const idx = device.routing_table.findIndex(r => r.network === canonical && r.mask === mask)
    const entry = { network: canonical, mask, next_hop: nextHop }
    if (idx >= 0) device.routing_table[idx] = entry
    else device.routing_table.push(entry)
    return []
  }

  _routeDel(device, tokens) {
    let cidr = tokens[3]
    if (!cidr) return ['Usage: ip route del <network>/<prefix>']
    if (cidr === 'default') cidr = '0.0.0.0/0'
    const [network, prefixStr] = cidr.split('/')
    const mask = _prefixToMask(prefixStr ?? '32')
    if (!mask) return ['ip: Error: invalid prefix']
    const canonical = networkAddress(network, mask)
    device.routing_table = device.routing_table.filter(r => !(r.network === canonical && r.mask === mask))
    return []
  }

  // ── ifconfig ───────────────────────────────────────────────────────────────
  _cmdIfconfig(device, tokens) {
    const ifArg = tokens[1]
    if (!ifArg) return this._showAddr(device)

    const iface = _resolveIf(device, ifArg)
    if (!iface) return [`ifconfig: ${ifArg}: error fetching interface information: Device not found`]

    // ifconfig eth0 up | down — same peer-aware logic as `ip link set up`
    if (tokens[2] === 'up') {
      if (iface.connected_to) {
        const remIface = this.topology._resolveIface(iface.connected_to)
        if (remIface && remIface.status !== 'admin_down') {
          iface.status = 'up'
          if (remIface.status === 'down') remIface.status = 'up'
        } else {
          iface.status = 'down'
        }
      } else {
        iface.status = 'down'
      }
      return []
    }
    if (tokens[2] === 'down') {
      iface.status = 'admin_down'
      if (iface.connected_to) this.topology.shutdownPeer(iface.connected_to)
      return []
    }

    // ifconfig eth0 192.168.1.2 netmask 255.255.255.0
    if (tokens[2] && isValidIp(tokens[2])) {
      const maskIdx = tokens.findIndex(t => t.toLowerCase() === 'netmask')
      const mask = maskIdx >= 0 ? tokens[maskIdx + 1] : '255.255.255.0'
      if (!isValidMask(mask)) return [`ifconfig: ${ifArg}: invalid mask "${mask}"`]
      const ip = tokens[2]
      if (!isHostAddress(ip, mask)) {
        const net = networkAddress(ip, mask)
        const bcast = broadcastAddress(ip, mask)
        if (ip === net)   return [`ifconfig: ${ifArg}: ${ip} is the network address`]
        if (ip === bcast) return [`ifconfig: ${ifArg}: ${ip} is the broadcast address`]
      }
      const dupDevice = [...this.topology.devices.values()].find(dev =>
        dev !== device && dev.interfaces.some(i => i.ip === ip)
      )
      if (dupDevice) return [`ifconfig: ${ifArg}: ${ip}: address already assigned to another host`]
      iface.ip = ip
      iface.subnet_mask = mask
      return []
    }

    // ifconfig eth0  — show single interface
    const name = _linuxName(iface.name)
    // Flags match real ifconfig: UP+BROADCAST+RUNNING+MULTICAST=4163 when up,
    // BROADCAST+MULTICAST=4098 when down (no UP/RUNNING bits set)
    const isUp = iface.status === 'up'
    const flags = isUp ? '4163<UP,BROADCAST,RUNNING,MULTICAST>' : '4098<BROADCAST,MULTICAST>'
    const lines = [
      `${name}: flags=${flags}  mtu 1500`,
    ]
    if (iface.ip && iface.subnet_mask) {
      const bcast = _bcast(iface.ip, iface.subnet_mask)
      lines.push(`        inet ${iface.ip}  netmask ${iface.subnet_mask}  broadcast ${bcast}`)
    }
    lines.push(`        ether 00:11:22:33:44:00  txqueuelen 1000  (Ethernet)`)
    lines.push(`        RX packets 0  bytes 0 (0.0 B)`)
    lines.push(`        TX packets 0  bytes 0 (0.0 B)`)
    return lines
  }

  // ── route (legacy) ─────────────────────────────────────────────────────────
  _cmdRoute(device) {
    const lines = [
      'Kernel IP routing table',
      'Destination     Gateway         Genmask         Flags Metric Ref    Use Iface',
    ]
    for (const iface of device.interfaces) {
      if (iface.ip && iface.subnet_mask && iface.status === 'up') {
        const net = networkAddress(iface.ip, iface.subnet_mask)
        lines.push(`${net.padEnd(16)}0.0.0.0         ${iface.subnet_mask.padEnd(16)}U     100    0        0 ${_linuxName(iface.name)}`)
      }
    }
    for (const r of device.routing_table) {
      const exitIf = _findExitIfForRoute(device, r.next_hop)
      const ifName = exitIf ? _linuxName(exitIf.name) : '-'
      lines.push(`${r.network.padEnd(16)}${r.next_hop.padEnd(16)}${r.mask.padEnd(16)}UG    100    0        0 ${ifName}`)
    }
    return lines
  }

  _help() {
    const d = this.difficulty
    const base = [
      'Available commands:',
      '  ping [-c N] <ip>                     ICMP echo request',
      '  dhclient <if>                        Request DHCP lease on interface',
      '  dhclient -r <if>                     Release DHCP lease',
      '  ip addr [show]                       Show interfaces + IPs',
      '  ip addr add <ip>/<prefix> dev <if>   Add IP address',
      '  ip addr del <ip>/<prefix> dev <if>   Remove IP address',
      '  ip link set <if> up|down             Bring link up or down',
      '  ip route [show]                      Show routing table',
      '  ip route add <net>/<prefix> via <gw> Add static route',
      '  ip route add default via <gw>        Add default gateway route',
      '  ifconfig [if] [ip] [netmask <mask>]  Configure interface (legacy)',
      '  route                                Show routing table (legacy)',
      '  hostname [name]                      Show or set hostname',
      '  man <command>                        Show manual for a command',
    ]
    if (d === 'networkEngineer') return base

    if (d === 'advanced') {
      return [...base, '',
        '  Tip: To configure this PC, bring the interface up with:',
        '       ip link set eth0 up',
        '       ip addr add <ip>/<prefix> dev eth0',
        '       ip route add default via <gateway>',
        '  Then test with: ping <gateway-ip>',
      ]
    }

    // beginner
    return [...base, '',
      '  Quick guide:',
      '    1. ip link set eth0 up                              bring interface online',
      '    2. ip addr add 192.168.1.10/24 dev eth0            assign IP',
      '    3. ip route add default via 192.168.1.1            set gateway',
      '    4. ping 192.168.1.1                                test connectivity',
    ]
  }

  _cmdMan(tokens) {
    const subject = tokens[1]?.toLowerCase()
    const d       = this.difficulty

    const manPages = {
      ping: {
        synopsis: 'ping [-c count] <destination>',
        desc:     'Send ICMP ECHO_REQUEST packets to network hosts.',
        beginner: [
          '  Options:',
          '    -c <count>   Stop after sending <count> packets (default: 4)',
          '',
          '  Examples:',
          '    $ ping 192.168.1.1',
          '    $ ping -c 1 192.168.1.1',
          '',
          '  Tip: If ping fails, check that the interface is up ("ip link set eth0 up")',
          '       and an IP is assigned ("ip addr add <ip>/<prefix> dev eth0").',
        ],
        advanced: [
          '  Options:',
          '    -c <count>   Number of packets to send',
          '',
          '  Troubleshooting:',
          '    1. Interface up?    → ip link set eth0 up',
          '    2. IP assigned?     → ip addr show',
          '    3. Route exists?    → ip route show',
          '    4. Gateway reachable? → ping <gateway>',
        ],
        networkEngineer: [
          '  Options:',
          '    -c count   Stop after sending count echo packets.',
          '    -i interval  Wait interval seconds between each packet.',
          '    -W timeout   Time to wait for a response, in seconds.',
          '',
          '  RETURN VALUE',
          '    0  if the host is reachable',
          '    1  if the host is unreachable or an error occurred',
        ],
      },
      'ip': {
        synopsis: 'ip [ OPTIONS ] OBJECT { COMMAND | help }',
        desc:     'Show and manipulate network configuration.',
        beginner: [
          '  Common usage:',
          '    ip addr show                       — list interfaces and IPs',
          '    ip addr add 192.168.1.2/24 dev eth0',
          '    ip link set eth0 up',
          '    ip route add default via 192.168.1.1',
          '',
          '  Tip: Add the IP first, then bring the link up, then add a default route.',
        ],
        advanced: [
          '  Objects: addr, link, route',
          '    ip addr add <cidr> dev <if>   — assign IP',
          '    ip link set <if> up|down      — toggle interface',
          '    ip route add default via <gw> — default gateway',
        ],
        networkEngineer: [
          '  OBJECTS',
          '    link     — network device',
          '    addr     — protocol address on a device',
          '    route    — routing table entry',
          '',
          '  OPTIONS',
          '    -4    Force IPv4',
          '    -br   Brief output (addr show -br)',
        ],
      },
      ifconfig: {
        synopsis: 'ifconfig [interface] [address] [netmask mask]',
        desc:     'Configure a network interface (legacy tool; prefer "ip").',
        beginner: [
          '  Examples:',
          '    ifconfig eth0 192.168.1.2 netmask 255.255.255.0',
          '    ifconfig eth0 up',
          '',
          '  Tip: Use "ip addr add ..." for the modern equivalent.',
        ],
        advanced: [
          '  ifconfig eth0 <ip> netmask <mask>   — assign IP',
          '  ifconfig eth0 up / down             — toggle state',
          '  Modern equivalent: ip addr add <ip>/<prefix> dev eth0',
        ],
        networkEngineer: [
          '  SYNOPSIS',
          '    ifconfig [-a] [-v] [interface]',
          '    ifconfig interface [address] [netmask mask] [up|down]',
          '',
          '  NOTE: ifconfig is deprecated. Use "ip" command instead.',
        ],
      },
    }

    if (!subject || !manPages[subject]) {
      return [`man: no manual entry for '${subject || ''}'.  Try: ping, ip, ifconfig`]
    }

    const page = manPages[subject]
    const extra = page[d] ?? page.beginner
    return [
      `SYNOPSIS`,
      `  ${page.synopsis}`,
      '',
      `DESCRIPTION`,
      `  ${page.desc}`,
      '',
      ...extra,
    ]
  }

  // ── Tab completion ──────────────────────────────────────────────────────────
  complete(device, input) {
    const trailingSpace = input.endsWith(' ')
    const tokens = input.trim().split(/\s+/).filter(Boolean)

    const partial = trailingSpace ? '' : (tokens[tokens.length - 1] || '')
    const base = trailingSpace
      ? tokens.join(' ') + ' '
      : tokens.slice(0, -1).join(' ') + (tokens.length > 1 ? ' ' : '')

    let candidates
    if (tokens.length === 0 || (!trailingSpace && tokens.length === 1)) {
      candidates = ['ping', 'dhclient', 'ip', 'ifconfig', 'route', 'hostname', 'clear', 'echo', 'whoami', 'uname', 'help', 'man']
    } else {
      const cmd = tokens[0].toLowerCase()
      const filled = trailingSpace ? tokens.slice(1) : tokens.slice(1, -1)
      candidates = _pcSubCandidates(device, cmd, filled)
    }

    const matches = candidates.filter(c => c.toLowerCase().startsWith(partial.toLowerCase()))
    if (matches.length === 0) return { newInput: input, completions: [] }

    const common = _commonPrefix(matches)
    if (matches.length === 1) return { newInput: base + matches[0] + ' ', completions: [] }
    if (common.length > partial.length) return { newInput: base + common, completions: matches }
    return { newInput: input, completions: matches }
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────────

// Returns true for failures where Linux shows "Network is unreachable" (local error,
// no packets sent) rather than per-packet "Destination Host Unreachable" (ICMP error).
function _isNetworkUnreachable(failureReason) {
  return failureReason === 'no_route' ||
         failureReason === 'host_no_gateway' ||
         failureReason === 'subnet_mismatch' ||
         failureReason === 'admin_down' ||
         failureReason === 'link_down'
}

// Returns { ttl, routerHops } for a path.
// TTL: Linux default 64, decremented by each L3 router hop (switches are L2, don't decrement).
function _pathInfo(topology, srcIp, dstIp) {
  const path = topology.findPath(srcIp, dstIp)
  const routerHops = path.slice(1, -1).filter(id => {
    const dev = topology.devices.get(id)
    return dev?.type === 'router'
  }).length
  return { ttl: 64 - routerHops, routerHops }
}

// Generate realistic RTT samples (3 decimal places, matching real Linux iputils-ping output).
// Base: ~0.4ms for switched LAN (no router hops), +1.8ms per L3 router hop.
// Sub-ms jitter pattern is non-monotonic so values look like real hardware, not a formula.
function _pingRtts(count, routerHops) {
  const base   = routerHops === 0 ? 0.391 : 0.391 + routerHops * 1.824
  const jitter = [0.031, 0.018, 0.024, 0.047, 0.012, 0.038, 0.021, 0.044]
  return Array.from({ length: count }, (_, k) =>
    parseFloat((base + jitter[k % jitter.length]).toFixed(3))
  )
}

// Compute rtt min/avg/max/mdev from an array of RTT samples (matches real iputils output).
function _rttStatsLine(rtts) {
  const min  = Math.min(...rtts)
  const max  = Math.max(...rtts)
  const avg  = rtts.reduce((a, b) => a + b, 0) / rtts.length
  const mdev = Math.sqrt(rtts.reduce((acc, v) => acc + (v - avg) ** 2, 0) / rtts.length)
  return `rtt min/avg/max/mdev = ${min.toFixed(3)}/${avg.toFixed(3)}/${max.toFixed(3)}/${mdev.toFixed(3)} ms`
}

function _prefixToMask(prefix) {
  const n = parseInt(prefix, 10)
  if (isNaN(n) || n < 0 || n > 32) return null
  const mask = n === 0 ? 0 : (0xffffffff << (32 - n)) >>> 0
  return [mask >>> 24, (mask >>> 16) & 0xff, (mask >>> 8) & 0xff, mask & 0xff].join('.')
}

// eth0 → Ethernet0/0,  eth1 → Ethernet0/1
function _ethToInternal(name) {
  const m = name.match(/^eth(\d+)$/i)
  return m ? `Ethernet0/${m[1]}` : name
}

// Ethernet0/0 → eth0
function _linuxName(ifaceName) {
  const m = ifaceName.match(/Ethernet0\/(\d+)$/i)
  return m ? `eth${m[1]}` : ifaceName.toLowerCase()
}

// Resolve by Linux name (eth0) or internal name (Ethernet0/0)
function _resolveIf(device, arg) {
  return device.getInterface(_ethToInternal(arg)) || device.getInterface(arg) || null
}

function _pcSubCandidates(device, cmd, filled) {
  const depth = filled.length
  const a0 = filled[0]?.toLowerCase()
  const a1 = filled[1]?.toLowerCase()
  const a2 = filled[2]?.toLowerCase()

  if (cmd === 'ip') {
    if (depth === 0) return ['addr', 'link', 'route']
    if (a0 === 'addr' || a0 === 'address' || a0 === 'a') {
      if (depth === 1) return ['show', 'add', 'del']
      if (depth === 2 && (a1 === 'add' || a1 === 'del')) return ['<ip>/<prefix>']
      if (depth === 3) return ['dev']
      if (depth === 4 && a2 === 'dev') return device.interfaces.map(i => _linuxName(i.name))
    }
    if (a0 === 'link' || a0 === 'l') {
      if (depth === 1) return ['show', 'set']
      if (depth === 2 && a1 === 'set') return device.interfaces.map(i => _linuxName(i.name))
      if (depth === 3 && a1 === 'set') return ['up', 'down']
    }
    if (a0 === 'route' || a0 === 'r') {
      if (depth === 1) return ['show', 'add', 'del']
      if (depth === 2 && (a1 === 'add' || a1 === 'del')) return ['default', '<network>/<prefix>']
      if (depth === 3 && a1 === 'add') return ['via']
      if (depth === 4 && a1 === 'add') return ['<gateway>']
    }
  }
  if (cmd === 'ifconfig') {
    if (depth === 0) return [...device.interfaces.map(i => _linuxName(i.name))]
    if (depth === 1) return ['up', 'down', '<ip-address>']
    if (depth === 2) return ['netmask']
  }
  if (cmd === 'ping') {
    if (depth === 0) return ['-c', '<ip-address>']
    if (depth === 1 && a0 === '-c') return ['1', '4', '8']
  }
  if (cmd === 'dhclient') {
    if (depth === 0) return ['-r', ...device.interfaces.map(i => _linuxName(i.name))]
    if (depth === 1 && a0 === '-r') return device.interfaces.map(i => _linuxName(i.name))
  }
  return []
}

function _commonPrefix(strs) {
  if (!strs.length) return ''
  return strs.reduce((prefix, s) => {
    while (s.toLowerCase().indexOf(prefix.toLowerCase()) !== 0 && prefix.length > 0)
      prefix = prefix.slice(0, -1)
    return prefix
  })
}

function _bcast(ip, mask) {
  const n = (ipToNum(ip) | (~ipToNum(mask))) >>> 0
  return [(n >>> 24), (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff].join('.')
}

// Find the outgoing interface for a given next-hop by connected-route lookup.
// Used to add "dev <if>" to static route entries in `ip route show`.
function _findExitIfForRoute(device, nextHop) {
  if (!isValidIp(nextHop)) return null
  for (const iface of device.interfaces) {
    if (iface.status !== 'up' || !iface.ip || !iface.subnet_mask) continue
    if (networkAddress(iface.ip, iface.subnet_mask) === networkAddress(nextHop, iface.subnet_mask))
      return iface
  }
  return null
}
