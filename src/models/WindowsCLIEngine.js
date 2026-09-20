import {
  isValidIp, isValidMask, networkAddress, maskToPrefixLen,
  ipToNum, isHostAddress,
} from './ipUtils.js'
import { performDHCP, releaseDHCP } from './DHCPEngine.js'

// Windows CMD-style CLI for the Admin Laptop when device.os_type === 'windows'.
// Commands: ipconfig, route, netsh, ping, arp, hostname, cls, help.
// Interface naming: internal 'Ethernet0/0' ↔ Windows 'Ethernet0'.

export class WindowsCLIEngine {
  constructor(topology, difficulty = 'beginner') {
    this.topology = topology
    this.difficulty = difficulty
  }

  getPrompt(device) {
    return `C:\\Users\\${device.hostname}>`
  }

  execute(device, input) {
    const line = input.trim()
    if (!line) return []
    const tokens = _tokenize(line)
    const cmd = tokens[0].toLowerCase()
    try {
      return this._dispatch(device, cmd, tokens) || []
    } catch (e) {
      return [`Error: ${e.message}`]
    }
  }

  // Fires onPacket(index, reachable, targetIp, srcIp, failureReason, ttl, rtt) once per echo.
  // Returns a cancel() function.
  executePingAsync(device, targetIp, { onStart, onPacket, onDone } = {}) {
    if (!isValidIp(targetIp)) {
      onStart?.([`Ping request could not find host ${targetIp}. Please check the name and try again.`])
      onDone?.([], false)
      return () => {}
    }
    const srcIp = device.interfaces.find(i => i.status === 'up' && i.ip)?.ip
    if (!srcIp) {
      const noIp = !device.interfaces.find(i => i.ip)
      const off  = device.interfaces.find(i => i.status === 'admin_down')
      const hint = off
        ? `The adapter is disabled — enable it with: netsh interface set interface name="${_winName(off.name)}" admin=enabled`
        : noIp
          ? `No IP configured — use: netsh interface ip set address "Ethernet0" static <ip> <mask> <gw>`
          : `Media disconnected — check the cable and the device at the other end`
      onStart?.([`Pinging ${targetIp} with 32 bytes of data:`, `PING: transmit failed. General failure.`, `  (${hint})`])
      onDone?.([``, `Ping statistics for ${targetIp}:`, `    Packets: Sent = 4, Received = 0, Lost = 4 (100% loss),`], false)
      return () => {}
    }

    const COUNT = 4
    const result = this.topology.checkPing(srcIp, targetIp)
    this.topology.recordCapture(srcIp, targetIp, result)

    // Local failure: show general failure immediately, no per-packet loop
    if (!result.reachable && _isLocalError(result.failureReason)) {
      const hint = _localErrorHint(result.failureReason)
      const startLines = [`Pinging ${targetIp} with 32 bytes of data:`, `PING: transmit failed. General failure.`]
      if (hint) startLines.push(`  (${hint})`)
      onStart?.(startLines)
      onDone?.([``, `Ping statistics for ${targetIp}:`, `    Packets: Sent = 4, Received = 0, Lost = 4 (100% loss),`], false)
      return () => {}
    }

    const { ttl, routerHops } = _pathInfo(this.topology, srcIp, targetIp)
    const rtts = _pingRtts(COUNT, routerHops)

    onStart?.([`Pinging ${targetIp} with 32 bytes of data:`])
    let i = 0
    const timers = []
    const fire = () => {
      if (i >= COUNT) {
        const recv = result.reachable ? COUNT : 0
        const lost = COUNT - recv
        const lossP = Math.round((lost / COUNT) * 100)
        const lines = [
          ``,
          `Ping statistics for ${targetIp}:`,
          `    Packets: Sent = ${COUNT}, Received = ${recv}, Lost = ${lost} (${lossP}% loss),`,
        ]
        if (result.reachable) {
          const ms = rtts.map(r => Math.max(1, Math.round(r)))
          const min = Math.min(...ms), max = Math.max(...ms)
          const avg = Math.round(ms.reduce((a, b) => a + b, 0) / ms.length)
          lines.push(`Approximate round trip times in milli-seconds:`)
          lines.push(`    Minimum = ${min}ms, Maximum = ${max}ms, Average = ${avg}ms`)
        }
        onDone?.(lines, result.reachable)
        return
      }
      onPacket?.(i, result.reachable, targetIp, srcIp, result.failureReason, ttl, rtts[i])
      i++
      timers.push(setTimeout(fire, 1100))
    }
    fire()
    return () => timers.forEach(clearTimeout)
  }

  _dispatch(device, cmd, tokens) {
    if (cmd === 'ipconfig') return this._cmdIpconfig(device, tokens)
    if (cmd === 'route')    return this._cmdRoute(device, tokens)
    if (cmd === 'netsh')    return this._cmdNetsh(device, tokens)
    if (cmd === 'ping')     return [`Usage: ping [-n count] [-w timeout] <destination>`]
    if (cmd === 'arp')      return this._cmdArp(device, tokens)
    if (cmd === 'hostname') return [device.hostname]
    if (cmd === 'cls' || cmd === 'clear') return ['\x1b[2J\x1b[H']
    if (cmd === 'echo')     return [tokens.slice(1).join(' ')]
    if (cmd === 'help' || cmd === '?') return this._help()
    if (cmd === 'ver')      return [`Microsoft Windows [Version 10.0.19045.4651]`]
    return [
      `'${tokens[0]}' is not recognized as an internal or external command,`,
      `operable program or batch file.`,
    ]
  }

  // ── ipconfig ─────────────────────────────────────────────────────────────────

  _cmdIpconfig(device, tokens) {
    const flag = tokens[1]?.toLowerCase()
    if (!flag || flag === '/4')                    return this._ipconfigBasic(device)
    if (flag === '/all')                           return this._ipconfigAll(device)
    if (flag === '/release' || flag === '/release4') return this._ipconfigRelease(device)
    if (flag === '/renew'   || flag === '/renew4')   return this._ipconfigRenew(device)
    if (flag === '/?')                             return ['Usage: ipconfig [/all] [/release] [/renew]']
    return [`The option "${tokens[1]}" is not valid.`]
  }

  _ipconfigBasic(device) {
    const lines = [`Windows IP Configuration`, ``]
    for (const iface of device.interfaces) {
      const name = _winName(iface.name)
      lines.push(`Ethernet adapter ${name}:`, ``)
      if (!iface.ip || iface.status !== 'up') {
        lines.push(`   Media State . . . . . . . . . . . : Media disconnected`)
        lines.push(`   Connection-specific DNS Suffix  . : `, ``)
        continue
      }
      const gw = device.routing_table.find(r => r.network === '0.0.0.0')?.next_hop ?? ''
      lines.push(`   Connection-specific DNS Suffix  . : `)
      lines.push(`   IPv4 Address. . . . . . . . . . . : ${iface.ip}`)
      lines.push(`   Subnet Mask . . . . . . . . . . . : ${iface.subnet_mask}`)
      lines.push(`   Default Gateway . . . . . . . . . : ${gw}`)
      lines.push(``)
    }
    return lines
  }

  _ipconfigAll(device) {
    const lines = [
      `Windows IP Configuration`, ``,
      `   Host Name . . . . . . . . . . . : ${device.hostname}`,
      `   Node Type . . . . . . . . . . . : Hybrid`,
      `   IP Routing Enabled. . . . . . . : No`,
      `   WINS Proxy Enabled. . . . . . . : No`,
      ``,
    ]
    for (const [idx, iface] of device.interfaces.entries()) {
      const name = _winName(iface.name)
      const mac  = `00-11-22-33-44-${idx.toString(16).padStart(2, '0').toUpperCase()}`
      lines.push(`Ethernet adapter ${name}:`, ``)
      if (!iface.ip || iface.status !== 'up') {
        lines.push(`   Media State . . . . . . . . . . . : Media disconnected`)
        lines.push(`   Connection-specific DNS Suffix  . : `)
        lines.push(`   Physical Address. . . . . . . . . : ${mac}`)
        lines.push(`   DHCP Enabled. . . . . . . . . . . : ${_dhcpEnabled(iface) ? 'Yes' : 'No'}`, ``)
        continue
      }
      const gw = device.routing_table.find(r => r.network === '0.0.0.0')?.next_hop ?? ''
      lines.push(`   Connection-specific DNS Suffix  . : `)
      lines.push(`   Physical Address. . . . . . . . . : ${mac}`)
      lines.push(`   DHCP Enabled. . . . . . . . . . . : ${_dhcpEnabled(iface) ? 'Yes' : 'No'}`)
      lines.push(`   Autoconfiguration Enabled . . . . : Yes`)
      lines.push(`   IPv4 Address. . . . . . . . . . . : ${iface.ip}${iface.dhcp_assigned ? '(Preferred)' : ''}`)
      lines.push(`   Subnet Mask . . . . . . . . . . . : ${iface.subnet_mask}`)
      lines.push(`   Default Gateway . . . . . . . . . : ${gw}`)
      if (device.dns_server) lines.push(`   DNS Servers . . . . . . . . . . . : ${device.dns_server}`)
      lines.push(``)
    }
    return lines
  }

  _ipconfigRelease(device) {
    const lines = []
    let anyReleased = false
    for (const iface of device.interfaces) {
      if (!iface.dhcp_assigned) continue
      const result = releaseDHCP(this.topology, device, iface)
      if (result.released) {
        anyReleased = true
        lines.push(``, `Ethernet adapter ${_winName(iface.name)}:`, ``)
        lines.push(`   Connection-specific DNS Suffix  . : `)
        lines.push(`   Default Gateway . . . . . . . . . : `)
      }
    }
    if (!anyReleased) {
      // Real wording: a cable-less adapter names itself; anything else (disabled, static)
      // simply isn't in a state to release.
      const disc = device.interfaces.find(i => i.status === 'down')
      lines.push(disc
        ? `No operation can be performed on ${_winName(disc.name)} while it has its media disconnected.`
        : `The operation failed as no adapter is in the state permissible for this operation.`)
    }
    return lines
  }

  _ipconfigRenew(device) {
    const lines = []
    let eligible = 0
    for (const iface of device.interfaces) {
      if (iface.status === 'admin_down') continue         // a disabled adapter isn't in a state to renew
      if (iface.ip && !iface.dhcp_assigned) continue      // DHCP isn't enabled on a static adapter
      eligible++
      const name = _winName(iface.name)
      if (iface.status !== 'up') {
        lines.push(`No operation can be performed on ${name} while it has its media disconnected.`)
        continue
      }
      // The server re-offers the binding it already holds, so renewing keeps the address.
      const result = performDHCP(this.topology, device, iface)
      if (!result.success) {
        lines.push(`An error occurred while renewing interface ${name} : unable to contact your DHCP server. Request has timed out.`)
        continue
      }
      this._applyLease(device, iface, result)
      const gw = device.routing_table.find(r => r.network === '0.0.0.0')?.next_hop ?? ''
      lines.push(``, `Ethernet adapter ${name}:`, ``)
      lines.push(`   Connection-specific DNS Suffix  . : `)
      lines.push(`   IPv4 Address. . . . . . . . . . . : ${result.ip}`)
      lines.push(`   Subnet Mask . . . . . . . . . . . : ${result.mask}`)
      lines.push(`   Default Gateway . . . . . . . . . : ${gw}`)
    }
    if (eligible === 0) lines.push(`The operation failed as no adapter is in the state permissible for this operation.`)
    return lines
  }

  // Apply what a DHCP server handed out: address, mask, default gateway, DNS.
  _applyLease(device, iface, result) {
    iface.ip            = result.ip
    iface.subnet_mask   = result.mask
    iface.dhcp_assigned = true
    if (result.gateway && isValidIp(result.gateway)) {
      device.routing_table = device.routing_table.filter(r => !(r.network === '0.0.0.0' && r.dhcp_assigned))
      device.routing_table.push({ network: '0.0.0.0', mask: '0.0.0.0', next_hop: result.gateway, dhcp_assigned: true })
    }
    if (result.dns && isValidIp(result.dns)) device.dns_server = result.dns
  }

  // ── route ─────────────────────────────────────────────────────────────────────

  _cmdRoute(device, tokens) {
    const sub = tokens[1]?.toLowerCase()
    if (!sub || sub === 'print') return this._routePrint(device)
    if (sub === 'add')           return this._routeAdd(device, tokens)
    if (sub === 'delete')        return this._routeDelete(device, tokens)
    if (sub === '/?')            return [
      'ROUTE [command] [destination] [MASK netmask] [gateway] [METRIC metric]',
      '',
      '  print    Prints a route.',
      '  add      Adds a route.      route add <dst> mask <mask> <gw>',
      '  delete   Deletes a route.   route delete <dst>',
    ]
    return [`The parameter format is incorrect.`]
  }

  _routePrint(device) {
    const lines = [
      `===========================================================================`,
      `Interface List`,
    ]
    device.interfaces.forEach((iface, idx) => {
      const mac = `00 11 22 33 44 ${idx.toString(16).padStart(2, '0').toUpperCase()}`
      lines.push(`  ${idx + 1}...${mac} ......${_winName(iface.name)}`)
    })
    lines.push(
      `===========================================================================`,
      ``, `IPv4 Route Table`,
      `===========================================================================`,
      `Active Routes:`,
      `Network Destination        Netmask          Gateway       Interface  Metric`,
    )
    for (const iface of device.interfaces) {
      if (!iface.ip || !iface.subnet_mask || iface.status !== 'up') continue
      const net = networkAddress(iface.ip, iface.subnet_mask)
      lines.push(`${net.padEnd(27)} ${iface.subnet_mask.padEnd(17)}  On-link   ${iface.ip.padEnd(14)} 281`)
      lines.push(`${iface.ip.padEnd(27)} ${'255.255.255.255'.padEnd(17)}  On-link   ${iface.ip.padEnd(14)} 281`)
    }
    for (const r of device.routing_table) {
      const exitIf = device.interfaces.find(i =>
        i.ip && i.status === 'up' &&
        networkAddress(i.ip, i.subnet_mask) === networkAddress(r.next_hop, i.subnet_mask)
      )
      const ifIp = exitIf?.ip ?? '0.0.0.0'
      lines.push(`${r.network.padEnd(27)} ${r.mask.padEnd(17)} ${r.next_hop.padEnd(13)} ${ifIp.padEnd(14)} 25`)
    }
    lines.push(`===========================================================================`, `Persistent Routes:`, `  None`)
    return lines
  }

  _routeAdd(device, tokens) {
    // route add <dest> mask <mask> <gw>
    const dest = tokens[2]
    const maskIdx = tokens.findIndex(t => t.toLowerCase() === 'mask')
    if (!dest || maskIdx < 0 || !tokens[maskIdx + 1] || !tokens[maskIdx + 2]) {
      return [
        `The syntax of this command is:`,
        ``,
        `ROUTE [-f] [-p] command [destination] [MASK netmask] [gateway]`,
        `  Example: route add 10.0.0.0 mask 255.255.255.0 192.168.1.1`,
      ]
    }
    const mask = tokens[maskIdx + 1]
    const gw   = tokens[maskIdx + 2]
    if (!isValidIp(dest))  return [`The route addition failed: "${dest}" is not a valid IP address.`]
    if (!isValidMask(mask)) return [`The route addition failed: "${mask}" is not a valid subnet mask.`]
    if (!isValidIp(gw))    return [`The route addition failed: "${gw}" is not a valid gateway address.`]
    const canonical = networkAddress(dest, mask)
    const idx = device.routing_table.findIndex(r => r.network === canonical && r.mask === mask)
    const entry = { network: canonical, mask, next_hop: gw }
    if (idx >= 0) device.routing_table[idx] = entry
    else          device.routing_table.push(entry)
    return [`OK!`]
  }

  _routeDelete(device, tokens) {
    const dest = tokens[2]
    if (!dest) return [`The syntax of this command is: ROUTE DELETE destination`]
    if (!isValidIp(dest)) return [`The route deletion failed: "${dest}" is not a valid IP address.`]
    const before = device.routing_table.length
    device.routing_table = device.routing_table.filter(r => {
      const canonical = networkAddress(dest, r.mask)
      return r.network !== canonical && r.network !== dest
    })
    return before !== device.routing_table.length ? [`OK!`] : [`The route deletion failed: Element not found.`]
  }

  // ── netsh ─────────────────────────────────────────────────────────────────────
  // netsh interface ip set address "name" static <ip> <mask> [<gw>]      (positional)
  // netsh interface ip set address name="n" source=static addr=<ip> mask=<m> gateway=<gw>
  // netsh interface ip set address "name" dhcp   |   … source=dhcp
  // netsh interface ip show config ["name"]
  // netsh interface set interface name="n" admin=enabled|disabled   (also: "n" enable|disable)
  // netsh interface show interface

  _cmdNetsh(device, tokens) {
    const ctx  = tokens[1]?.toLowerCase()
    const sub  = tokens[2]?.toLowerCase()
    const verb = tokens[3]?.toLowerCase()
    if (ctx !== 'interface') return [`The following command was not found: netsh ${tokens.slice(1).join(' ')}`]
    if (sub === 'set'  && verb === 'interface') return this._netshSetInterface(device, tokens)
    if (sub === 'show' && verb === 'interface') return this._netshShowInterface(device)
    if (sub === 'ip' || sub === 'ipv4') {
      if (verb === 'set')    return this._netshSet(device, tokens)
      if (verb === 'show')   return this._netshShow(device, tokens)
      if (verb === 'delete') return this._netshDelete(device, tokens)
    }
    return [`The following command was not found: ${tokens.join(' ')}`]
  }

  _netshSet(device, tokens) {
    if (tokens[4]?.toLowerCase() !== 'address') {
      return [`The following command was not found: netsh interface ip set ${tokens[4] ?? ''}`]
    }
    const a = _parseNetshArgs(tokens.slice(5), ['static', 'dhcp'])
    const usage = name => [
      `The syntax of this command is:`,
      `  netsh interface ip set address "${name}" static <ip> <mask> [<gw>]`,
      `  netsh interface ip set address "${name}" dhcp`,
    ]
    if (!a.name) return usage('name')
    const iface = _resolveWinIf(device, a.name)
    if (!iface) return [`There is no interface with the specified name "${a.name}".`]
    const source = (a.named.source ?? a.word)?.toLowerCase()
    if (source === 'dhcp')   return this._netshDhcp(device, iface, a.name)
    if (source === 'static') {
      // Named values win; positional ones fill the remaining slots in ip, mask, gateway order.
      const v = { ip: a.named.addr ?? a.named.address, mask: a.named.mask, gw: a.named.gateway ?? a.named.gw }
      for (const k of ['ip', 'mask', 'gw']) if (v[k] === undefined) v[k] = a.pos.shift()
      return this._netshStatic(device, iface, v)
    }
    return usage(a.name)
  }

  // Switching to DHCP replaces the whole static configuration (address, gateway, routes
  // through it) — it is not refused because a manual address is present.
  _netshDhcp(device, iface, name) {
    if (iface.dhcp_assigned) return [`DHCP is already enabled on this interface.`]
    if (iface.ip) {
      const oldIp = iface.ip, oldMask = iface.subnet_mask
      iface.ip = null
      iface.subnet_mask = null
      device.flushRoutesVia(oldIp, oldMask)
    }
    const result = performDHCP(this.topology, device, iface)
    if (!result.success) {
      // The command itself worked — the adapter is now DHCP-enabled and simply has no lease.
      return [`Ok.`, `  (DHCP is enabled on "${name}", but there is no lease yet — ${_dhcpWhy(result)})`]
    }
    this._applyLease(device, iface, result)
    return [`Ok.`]
  }

  // `set address … static` replaces the whole IPv4 configuration: the previous address, the
  // gateway, and any lease. Bad parameters are refused, never quietly "corrected".
  _netshStatic(device, iface, { ip, mask, gw }) {
    if (!ip || !isValidIp(ip)) return [`The parameter is incorrect. Expected a valid IP address after "static".`]
    if (mask && !isValidMask(mask)) return [`The parameter is incorrect. "${mask}" is not a valid subnet mask.`]
    const m = mask || '255.255.255.0'
    if (!isHostAddress(ip, m)) return [`The parameter is incorrect. "${ip}" is not a valid host address in that subnet.`]
    if (gw) {
      if (!isValidIp(gw)) return [`The parameter is incorrect. "${gw}" is not a valid gateway address.`]
      if (networkAddress(gw, m) !== networkAddress(ip, m)) {
        return [`The parameter is incorrect. The gateway ${gw} is not on the same subnet as ${ip} (${networkAddress(ip, m)}/${maskToPrefixLen(m)}).`]
      }
      if (gw === ip || !isHostAddress(gw, m)) return [`The parameter is incorrect. "${gw}" cannot be used as a gateway on this subnet.`]
    }
    const dup = [...this.topology.devices.values()].find(d => d !== device && d.interfaces.some(i => i.ip === ip))
    if (dup) return [`The IP address ${ip} is already assigned to another host.`]

    if (iface.dhcp_assigned) releaseDHCP(this.topology, device, iface)   // gives the lease back
    const oldIp = iface.ip, oldMask = iface.subnet_mask
    iface.ip = ip
    iface.subnet_mask = m
    iface.dhcp_assigned = false
    if (oldIp) device.flushRoutesVia(oldIp, oldMask)
    // The gateway is replaced, not added to: drop this adapter's previous default route.
    device.routing_table = device.routing_table.filter(r => !(
      r.network === '0.0.0.0' && r.mask === '0.0.0.0' &&
      ((oldIp && networkAddress(r.next_hop, oldMask) === networkAddress(oldIp, oldMask)) ||
        networkAddress(r.next_hop, m) === networkAddress(ip, m))))
    if (gw) device.routing_table.push({ network: '0.0.0.0', mask: '0.0.0.0', next_hop: gw })
    return [`Ok.`]
  }

  // netsh interface ip delete address "name" <ip>   (or name=… addr=…) — the address goes,
  // and so do the routes that were only reachable through it.
  _netshDelete(device, tokens) {
    if (tokens[4]?.toLowerCase() !== 'address') {
      return [`The following command was not found: netsh interface ip delete ${tokens[4] ?? ''}`]
    }
    const a = _parseNetshArgs(tokens.slice(5), [])
    const ip = a.named.addr ?? a.named.address ?? a.pos.shift()
    if (!a.name || !ip) {
      return [`The syntax of this command is:`, `  netsh interface ip delete address "name" <ip>`]
    }
    const iface = _resolveWinIf(device, a.name)
    if (!iface) return [`There is no interface with the specified name "${a.name}".`]
    if (iface.ip !== ip) return [`The system cannot find the file specified.`]
    if (iface.dhcp_assigned) {
      releaseDHCP(this.topology, device, iface)          // a leased address goes back to the server
    } else {
      const oldIp = iface.ip, oldMask = iface.subnet_mask
      iface.ip = null
      iface.subnet_mask = null
      device.flushRoutesVia(oldIp, oldMask)
    }
    return [`Ok.`]
  }

  // Enable / disable the adapter — the Windows twin of `ip link set up|down`.
  _netshSetInterface(device, tokens) {
    const a = _parseNetshArgs(tokens.slice(4), ['enable', 'enabled', 'disable', 'disabled'])
    const want = (a.named.admin ?? a.word ?? '').toLowerCase()
    if (!a.name || !/^(enable|enabled|disable|disabled)$/.test(want)) {
      return [
        `The syntax of this command is:`,
        `  netsh interface set interface name="<name>" admin=enabled|disabled`,
      ]
    }
    const iface = _resolveWinIf(device, a.name)
    if (!iface) return [`There is no interface with the specified name "${a.name}".`]
    this.topology.setInterfaceAdmin(`${device.id}:${iface.name}`, want.startsWith('enable'))
    return []
  }

  _netshShowInterface(device) {
    const lines = [
      ``,
      `Admin State    State          Type             Interface Name`,
      `-------------------------------------------------------------------------`,
    ]
    for (const iface of device.interfaces) {
      const admin = iface.status === 'admin_down' ? 'Disabled' : 'Enabled'
      const state = iface.status === 'up' ? 'Connected' : 'Disconnected'
      lines.push(`${admin.padEnd(15)}${state.padEnd(15)}${'Dedicated'.padEnd(17)}${_winName(iface.name)}`)
    }
    lines.push(``)
    return lines
  }

  _netshShow(device, tokens) {
    const s4 = tokens[4]?.toLowerCase()
    if (s4 !== 'config' && s4 !== 'address' && s4 !== 'addresses') {
      return [`The following command was not found: netsh interface ip show ${tokens[4] ?? ''}`]
    }
    const rawName = tokens[5]
    const ifaces = rawName ? [_resolveWinIf(device, rawName)].filter(Boolean) : device.interfaces
    if (rawName && ifaces.length === 0) return [`There is no interface with the specified name "${rawName}".`]

    const lines = []
    for (const iface of ifaces) {
      const name = _winName(iface.name)
      const gw   = device.routing_table.find(r => r.network === '0.0.0.0')?.next_hop ?? ''
      lines.push(`Configuration for interface "${name}"`)
      lines.push(`    DHCP enabled:                         ${_dhcpEnabled(iface) ? 'Yes' : 'No'}`)
      if (iface.ip) {
        lines.push(`    IP Address:                           ${iface.ip}`)
        lines.push(`    Subnet Prefix:                        ${iface.ip}/${maskToPrefixLen(iface.subnet_mask)} (mask ${iface.subnet_mask})`)
      } else {
        lines.push(`    IP Address:                           (not configured)`)
      }
      if (gw) lines.push(`    Default Gateway:                      ${gw}`)
      if (device.dns_server) lines.push(`    DNS Servers via DHCP:                 ${device.dns_server}`)
      lines.push(`    Statically Configured DNS Servers:    None`)
      lines.push(``)
    }
    return lines
  }

  // ── arp ──────────────────────────────────────────────────────────────────────

  _cmdArp(device, tokens) {
    if (tokens[1] !== '-a') return [`Usage: arp -a [<inet-addr>] [-N <if-addr>]`, `  -a  Display current ARP table for all interfaces.`]
    const lines = []
    for (const iface of device.interfaces) {
      if (!iface.ip || iface.status !== 'up') continue
      lines.push(``, `Interface: ${iface.ip} --- 0x${(device.interfaces.indexOf(iface) + 1).toString(16)}`)
      lines.push(`  Internet Address      Physical Address      Type`)
      const gw = device.routing_table.find(r => r.network === '0.0.0.0')?.next_hop
      if (gw) lines.push(`  ${gw.padEnd(22)}00-11-22-33-44-01     dynamic`)
    }
    if (lines.length === 0) lines.push(`No ARP Entries Found`)
    return lines
  }

  // ── help ─────────────────────────────────────────────────────────────────────

  _help() {
    const base = [
      `For more information on a specific command, type HELP command-name`,
      ``,
      `ARP         Displays and modifies the IP-to-Physical address translation tables.`,
      `CLS         Clears the screen.`,
      `HOSTNAME    Displays the name of the current host.`,
      `IPCONFIG    Display Windows IP configuration.  Flags: /all /release /renew`,
      `NETSH       Network configuration scripting utility.`,
      `PING        Sends ICMP Echo Requests to a network host.`,
      `ROUTE       Manipulates network routing tables.`,
      `VER         Displays the Windows version.`,
    ]
    if (this.difficulty === 'networkEngineer') return base

    const tips = this.difficulty === 'beginner' ? [
      ``,
      `Quick setup — static IP:`,
      `  1. netsh interface set interface name="Ethernet0" admin=enabled`,
      `  2. netsh interface ip set address "Ethernet0" static <ip> <mask> <gateway>`,
      `  3. ping <gateway>`,
      ``,
      `  Example:`,
      `    C:\\> netsh interface set interface name="Ethernet0" admin=enabled`,
      `    C:\\> netsh interface ip set address "Ethernet0" static 192.168.1.50 255.255.255.0 192.168.1.1`,
      `    C:\\> ping 192.168.1.1`,
    ] : [
      ``,
      `Tip: "netsh interface set interface" enables or disables the adapter.`,
      `     "netsh interface ip set address" sets a static IP, or turns DHCP on.`,
      `     Use "ipconfig /renew" when the network has a DHCP server.`,
    ]
    return [...base, ...tips]
  }

  // ── Tab completion ────────────────────────────────────────────────────────────

  complete(device, input) {
    const trailingSpace = input.endsWith(' ')
    const tokens = input.trim().split(/\s+/).filter(Boolean)
    const partial = trailingSpace ? '' : (tokens[tokens.length - 1] || '')
    const base    = trailingSpace
      ? tokens.join(' ') + ' '
      : tokens.slice(0, -1).join(' ') + (tokens.length > 1 ? ' ' : '')

    let candidates
    if (tokens.length === 0 || (!trailingSpace && tokens.length === 1)) {
      candidates = ['ipconfig', 'route', 'netsh', 'ping', 'arp', 'hostname', 'cls', 'help', 'ver']
    } else {
      candidates = _winTabCandidates(device, tokens, trailingSpace)
    }

    const matches = candidates.filter(c => c.toLowerCase().startsWith(partial.toLowerCase()))
    if (matches.length === 0) return { newInput: input, completions: [] }
    const common = _commonPrefix(matches)
    if (matches.length === 1) return { newInput: base + matches[0] + ' ', completions: [] }
    if (common.length > partial.length) return { newInput: base + common, completions: matches }
    return { newInput: input, completions: matches }
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

// Ethernet0/0 → Ethernet0  (first port on the adapter)
function _winName(ifaceName) {
  const m = ifaceName.match(/Ethernet(\d+)\/(\d+)/i)
  return m ? `Ethernet${m[2]}` : ifaceName
}

// Resolve "Ethernet0" or "Ethernet0/0" to the interface object
function _resolveWinIf(device, raw) {
  const name = raw.replace(/^"(.*)"$/, '$1').trim()
  for (const iface of device.interfaces) {
    if (iface.name.toLowerCase() === name.toLowerCase()) return iface
    if (_winName(iface.name).toLowerCase() === name.toLowerCase()) return iface
  }
  return null
}

// DHCP is "enabled" on an adapter unless it carries a static address — a fresh adapter,
// or one waiting on a lease, is DHCP-enabled (that is the Windows default).
function _dhcpEnabled(iface) { return !iface.ip || iface.dhcp_assigned === true }

// Windows wording for why a DHCP request got no lease (the shared engine's reasons are
// worded for the Linux shell, so they are not shown as-is).
function _dhcpWhy(result) {
  switch (result.reason) {
    case 'link_down':      return 'the adapter has no link'
    case 'no_link':        return 'the adapter is not cabled'
    case 'pool_exhausted': return 'the DHCP server has no free addresses'
    default:               return 'no DHCP server answered'
  }
}

// netsh arguments come positionally ("Ethernet0" static …) or as key=value pairs
// (name="Ethernet0" source=static …), and may mix the two. Returns the adapter name,
// the keyword (static / dhcp / enable / …) if given positionally, the named pairs, and
// what positional values are left over.
function _parseNetshArgs(rest, keywords) {
  const named = {}, pos = []
  for (const t of rest) {
    const m = /^([a-z]+)=(.*)$/i.exec(t)
    if (m) named[m[1].toLowerCase()] = m[2]
    else pos.push(t)
  }
  const name = named.name ?? pos.shift()
  const word = pos.length && keywords.includes(pos[0].toLowerCase()) ? pos.shift() : undefined
  return { name, word, named, pos }
}

// Tokenize a Windows command line, stripping quotes but keeping quoted names intact
function _tokenize(input) {
  const tokens = []
  let current = ''
  let inQuote = false
  for (const ch of input) {
    if (ch === '"') { inQuote = !inQuote; continue }
    if (ch === ' ' && !inQuote) {
      if (current) { tokens.push(current); current = '' }
    } else {
      current += ch
    }
  }
  if (current) tokens.push(current)
  return tokens
}

function _isLocalError(r) {
  return r === 'no_route' || r === 'host_no_gateway' || r === 'admin_down' || r === 'link_down' || r === 'subnet_mismatch'
}

function _localErrorHint(r) {
  if (r === 'host_no_gateway') return 'No default gateway — set one with: netsh interface ip set address "Ethernet0" static <ip> <mask> <gw>'
  if (r === 'no_route')        return 'No route to host — verify gateway and routing'
  if (r === 'admin_down')      return 'The adapter is disabled — enable it with: netsh interface set interface name="Ethernet0" admin=enabled'
  if (r === 'link_down')       return 'Cable not connected — attach a cable from the floorplan'
  return null
}

function _pathInfo(topology, srcIp, dstIp) {
  const path = topology.findPath(srcIp, dstIp)
  const routerHops = path.slice(1, -1).filter(id => {
    const dev = topology.devices.get(id)
    return dev?.type === 'router'
  }).length
  return { ttl: 128 - routerHops, routerHops } // Windows default TTL = 128
}

function _pingRtts(count, routerHops) {
  const base   = routerHops === 0 ? 0.391 : 0.391 + routerHops * 1.824
  const jitter = [0.031, 0.018, 0.024, 0.047, 0.012, 0.038, 0.021, 0.044]
  return Array.from({ length: count }, (_, k) =>
    parseFloat((base + jitter[k % jitter.length]).toFixed(3))
  )
}

function _winTabCandidates(device, tokens, trailingSpace) {
  const depth = trailingSpace ? tokens.length : tokens.length - 1
  const a = (i) => tokens[i]?.toLowerCase() ?? ''

  if (a(0) === 'ipconfig') {
    if (depth === 1) return ['/all', '/release', '/renew']
  }
  if (a(0) === 'route') {
    if (depth === 1) return ['print', 'add', 'delete']
    if (a(1) === 'add') {
      if (depth === 2) return ['<destination>']
      if (depth === 3) return ['mask']
      if (depth === 4) return ['<subnet-mask>']
      if (depth === 5) return ['<gateway>']
    }
    if (a(1) === 'delete' && depth === 2) return ['<destination>']
  }
  if (a(0) === 'netsh') {
    const ipCtx = a(2) === 'ip' || a(2) === 'ipv4'
    if (depth === 1) return ['interface']
    if (a(1) === 'interface' && depth === 2) return ['ip', 'ipv4', 'set', 'show']
    if (a(1) === 'interface' && (a(2) === 'set' || a(2) === 'show') && depth === 3) return ['interface']
    if (a(1) === 'interface' && a(2) === 'set' && a(3) === 'interface' && depth === 4) return device.interfaces.map(i => `"${_winName(i.name)}"`)
    if (a(1) === 'interface' && a(2) === 'set' && a(3) === 'interface' && depth === 5) return ['enable', 'disable']
    if (a(1) === 'interface' && ipCtx && depth === 3) return ['set', 'show', 'delete']
    if (a(1) === 'interface' && ipCtx && a(3) === 'delete' && depth === 4) return ['address']
    if (a(1) === 'interface' && ipCtx && a(3) === 'set' && depth === 4) return ['address']
    if (a(1) === 'interface' && ipCtx && a(3) === 'show' && depth === 4) return ['config']
    if (a(1) === 'interface' && ipCtx && a(3) === 'set' && a(4) === 'address') {
      if (depth === 5) return device.interfaces.map(i => `"${_winName(i.name)}"`)
      if (depth === 6) return ['static', 'dhcp']
      if (a(6) === 'static') {
        if (depth === 7) return ['<ip-address>']
        if (depth === 8) return ['<subnet-mask>']
        if (depth === 9) return ['<gateway>']
      }
    }
  }
  if (a(0) === 'ping'    && depth === 1) return ['-n', '<ip-address>']
  if (a(0) === 'arp'     && depth === 1) return ['-a']
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
