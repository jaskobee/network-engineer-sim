/*
 * L2-vs-L3 device contract — do not drift from this.
 *
 * ROUTER (type: 'router')
 *   Physical interfaces carry IPs and route packets.  ip address, ip route,
 *   no shutdown all apply normally.
 *
 * SWITCH (type: 'switch') — strictly Layer 2 (Catalyst 2960 model)
 *   Physical switchports (FastEthernet0/x) are Layer 2 ONLY.
 *   • `ip address` on a physical port → rejected (% Invalid input detected)
 *   • `no switchport` → rejected (not a routed-port switch)
 *   • `ip route` → rejected (no routing table on L2 switch)
 *   Management IP lives on an SVI: `interface vlan <id>` → `ip address ...`
 *   The SVI IP is for managing the switch only; it does NOT route host traffic.
 *   L2 forwarding floods frames out all up ports in the same VLAN.
 *
 * PC / SERVER (type: 'pc' | 'server')
 *   Use PCCLIEngine (Linux iproute2 idioms — ip addr, ip route, ping).
 */

import { normalizeIfName, getParentIfName, createSubinterface, refreshSubifs } from './Device.js'
import { isValidIp, isValidMask, broadcastAddress, isHostAddress, networkAddress, maskToPrefixLen, resolveHostname } from './ipUtils.js'

export class CLIEngine {
  constructor(topology, difficulty = 'beginner') {
    this.topology = topology
    this.difficulty = difficulty
  }

  getPrompt(device) {
    switch (device.config_mode) {
      case 'user_exec':           return `${device.hostname}>`
      case 'priv_exec':           return `${device.hostname}#`
      case 'global_config':       return `${device.hostname}(config)#`
      case 'interface_config':    return `${device.hostname}(config-if)#`
      case 'subif_config':        return `${device.hostname}(config-subif)#`
      case 'vlan_config':         return `${device.hostname}(config-vlan)#`
      case 'dhcp_pool_config':    return `${device.hostname}(dhcp-config)#`
      default:                    return `${device.hostname}>`
    }
  }

  execute(device, input) {
    const line = input.trim()
    if (!line) return []
    const tokens = line.split(/\s+/).filter(Boolean)
    const cmd = tokens[0].toLowerCase()
    try {
      return this._dispatch(device, cmd, tokens, line) || []
    } catch (e) {
      return [`% Error: ${e.message}`]
    }
  }

  // Fires onPacket(index, reachable) once per ICMP echo, ~1100 ms apart.
  // Returns a cancel() function that aborts pending timeouts.
  executePingAsync(device, targetIp, { onStart, onPacket, onDone } = {}) {
    const COUNT = 5
    if (!isValidIp(targetIp)) {
      onStart?.([`% Bad IP address: ${targetIp}`])
      onDone?.([], false)
      return () => {}
    }
    const srcIp = _getSrcIp(this.topology, device, targetIp)
    const header = [
      `Type escape sequence to abort.`,
      `Sending ${COUNT}, 100-byte ICMP Echos to ${targetIp}, timeout is 2 seconds:`,
    ]
    if (!srcIp) {
      onStart?.(header)
      let i = 0; const timers = []
      const fire = () => {
        if (i >= COUNT) { onDone?.([`\r\nSuccess rate is 0 percent (0/${COUNT})`, `% No usable source interface`], false); return }
        onPacket?.(i, false); i++
        timers.push(setTimeout(fire, 1100))
      }
      fire()
      return () => timers.forEach(clearTimeout)
    }
    const result = this.topology.checkPing(srcIp, targetIp)
    onStart?.(header)
    let i = 0; const timers = []
    const fire = () => {
      if (i >= COUNT) {
        const ok = result.reachable ? COUNT : 0
        const pct = result.reachable ? 100 : 0
        const summary = `\r\nSuccess rate is ${pct} percent (${ok}/${COUNT})`
        let lines
        if (result.reachable) {
          // Realistic RTT range scaled by router hops (IOS shows whole-ms, no mdev)
          const path = this.topology.findPath(srcIp, targetIp)
          const routerHops = path.slice(1, -1).filter(id =>
            this.topology.devices.get(id)?.type === 'router'
          ).length
          const rttMin = routerHops === 0 ? 1 : routerHops * 2
          const rttMax = rttMin + 3
          const rttAvg = rttMin + 1
          lines = [summary + `, round-trip min/avg/max = ${rttMin}/${rttAvg}/${rttMax} ms`]
        } else {
          lines = [summary]
          const msg = _iosFailureMsg(result.failureReason)
          if (msg) lines.push(`% ${msg}`)
        }
        onDone?.(lines, result.reachable); return
      }
      onPacket?.(i, result.reachable, result.failureReason); i++
      timers.push(setTimeout(fire, 1100))
    }
    fire()
    return () => timers.forEach(clearTimeout)
  }

  _dispatch(device, cmd, tokens) {
    const mode = device.config_mode

    // ── DHCP pool config mode ──────────────────────────────────────────────
    if (mode === 'dhcp_pool_config') {
      return this._cmdDhcpPool(device, cmd, tokens)
    }

    // ── Universal ──────────────────────────────────────────────────────────
    if (cmd === 'exit')   return this._cmdExit(device)
    if (cmd === 'end')    return this._cmdEnd(device)
    if (cmd === 'ping')   return this._cmdPing(device, tokens)
    if (cmd === 'no')     return this._cmdNo(device, tokens)
    if (cmd === '?')      return this._cmdHelp(device)
    if (cmd === 'help')   return this._cmdHelp(device)
    if (cmd === 'man')    return this._cmdMan(tokens)

    // ── User exec ──────────────────────────────────────────────────────────
    if (cmd === 'enable') {
      if (mode !== 'user_exec') return this._invalidInput()
      device.config_mode = 'priv_exec'
      return []
    }

    // ── Priv exec + ───────────────────────────────────────────────────────
    if (cmd === 'disable') {
      if (mode !== 'priv_exec') return this._invalidInput()
      device.config_mode = 'user_exec'
      return []
    }

    if (cmd === 'show' || cmd === 'sh') {
      // `show running-config` needs privileged exec; all other shows work from user exec too
      if (mode === 'user_exec') {
        const s = tokens[1]?.toLowerCase()
        if (s === 'running-config' || s === 'run')
          return ['% This command requires privileged mode. Type "enable" first.']
      }
      return this._cmdShow(device, tokens)
    }

    // `traceroute` — exec command, available in user and priv exec
    if (cmd === 'traceroute' || cmd === 'trace') {
      if (!['user_exec', 'priv_exec'].includes(mode)) return this._invalidInput()
      return ['% Traceroute is not available in this simulator. Use ping to test reachability.']
    }

    // `do <exec-command>` — run exec-level commands from inside any config mode
    if (cmd === 'do') {
      if (!['global_config', 'interface_config', 'subif_config', 'vlan_config'].includes(mode))
        return this._invalidInput()
      if (!tokens[1]) return ['% Incomplete command.  Usage: do <exec-command>']
      const origMode = device.config_mode
      device.config_mode = 'priv_exec'
      try {
        return this._dispatch(device, tokens[1].toLowerCase(), tokens.slice(1)) || []
      } finally {
        device.config_mode = origMode
      }
    }

    if (cmd === 'configure' || cmd === 'conf') {
      if (mode !== 'priv_exec') return this._invalidInput()
      const sub = tokens[1]?.toLowerCase()
      if (!sub || (sub !== 'terminal' && sub !== 't'))
        return ['% Incomplete command.  Usage: configure terminal']
      device.config_mode = 'global_config'
      return ['Enter configuration commands, one per line.  End with CNTL/Z.']
    }

    // ── Global config ──────────────────────────────────────────────────────
    if (cmd === 'hostname') {
      if (mode !== 'global_config') return this._invalidInput()
      if (!tokens[1]) return ['% Incomplete command.  Usage: hostname <name>']
      device.hostname = tokens[1]
      return []
    }

    if (cmd === 'interface' || cmd === 'int') {
      if (mode !== 'global_config') return this._invalidInput()
      const ifArg = tokens.slice(1).join(' ')
      if (!ifArg) return ['% Incomplete command.  Usage: interface <name>']
      const ifName = normalizeIfName(ifArg)

      // SVI: `interface vlan <id>` — switch-only, creates the SVI on demand
      if (ifName.startsWith('Vlan')) {
        if (device.type !== 'switch') return this._invalidInput()
        const vlanId = parseInt(ifName.slice(4), 10)
        if (isNaN(vlanId) || vlanId < 1 || vlanId > 4094)
          return [`% Invalid VLAN ID: ${ifName.slice(4)}`]
        let svi = device.interfaces.find(i => i.name === ifName)
        if (!svi) {
          svi = { name: ifName, description: null, ip: null, subnet_mask: null, status: 'admin_down', connected_to: null, vlan: vlanId, svi: true }
          device.interfaces.push(svi)
        }
        // Real IOS auto-creates the VLAN in the database when you enter interface vlan <id>
        if (!device.vlan_db[vlanId]) {
          device.vlan_db[vlanId] = { name: `VLAN${String(vlanId).padStart(4, '0')}` }
        }
        device.active_interface = ifName
        device.config_mode = 'interface_config'
        return []
      }

      // Subinterface: `interface GigabitEthernet0/0.10` — router only, creates on demand
      const parentName = getParentIfName(ifName)
      if (parentName !== null) {
        if (device.type === 'switch') return [
          `% Invalid input detected at '^' marker.`,
          `% Subinterfaces are not supported on Layer 2 switches.`,
        ]
        const parent = device.getInterface(parentName)
        if (!parent) return [
          `% Invalid input detected at '^' marker.`,
          `% No such interface: ${parentName}`,
        ]
        let subif = device.interfaces.find(i => i.name === ifName)
        if (!subif) {
          subif = createSubinterface(ifName, parentName)
          device.interfaces.push(subif)
        }
        device.active_interface = ifName
        device.config_mode = 'subif_config'
        return []
      }

      const iface = device.getInterface(ifName)
      if (!iface) return [
        `% Invalid input detected at '^' marker.`,
        `% No such interface: ${ifArg}`,
      ]
      device.active_interface = iface.name
      device.config_mode = 'interface_config'
      return []
    }

    // ── Global config: vlan <id> ── switch-only, enters vlan_config mode ────
    if (cmd === 'vlan') {
      if (mode !== 'global_config') return this._invalidInput()
      if (device.type !== 'switch') return [
        `% Invalid input detected at '^' marker.`,
        `% VLAN database commands are only valid on switch devices.`,
      ]
      const vid = parseInt(tokens[1], 10)
      if (isNaN(vid) || vid < 1 || vid > 4094)
        return ['% Incomplete command.  Usage: vlan <1-4094>']
      if (!device.vlan_db[vid]) device.vlan_db[vid] = { name: `VLAN${String(vid).padStart(4, '0')}` }
      device.active_vlan = vid
      device.config_mode = 'vlan_config'
      return []
    }

    // ── vlan_config: name <name> ───────────────────────────────────────────
    if (cmd === 'name') {
      if (mode !== 'vlan_config') return this._invalidInput()
      if (!tokens[1]) return ['% Incomplete command.  Usage: name <vlan-name>']
      const vid = device.active_vlan
      if (vid && device.vlan_db[vid]) device.vlan_db[vid].name = tokens[1]
      return []
    }

    // `description <text>` — available in interface_config and subif_config on any device type
    if (cmd === 'description') {
      if (mode !== 'interface_config' && mode !== 'subif_config') return this._invalidInput()
      const iface = device.getInterface(device.active_interface)
      if (!iface) return ['% No active interface']
      const text = tokens.slice(1).join(' ').trim()
      iface.description = text || null
      return []
    }

    if (cmd === 'ip') return this._cmdIp(device, tokens)

    // ── Firewall-only: nameif (interface_config) ───────────────────────────
    // Inspired by Cisco ASA `nameif`; assigns the interface to a security zone.
    // Documented simplification: real ASA syntax differs from IOS routers, but
    // the zone concept (nameif INSIDE/OUTSIDE/DMZ) is educationally accurate.
    if (cmd === 'nameif') {
      if (mode !== 'interface_config') return this._invalidInput()
      if (device.type !== 'firewall') return this._invalidInput()
      const zone = tokens[1]
      if (!zone) return ['% Incomplete command.  Usage: nameif <zone-name>  (e.g. INSIDE, OUTSIDE, DMZ)']
      const iface = device.getInterface(device.active_interface)
      if (!iface) return ['% No active interface']
      if (!device.fw_zones) device.fw_zones = {}
      device.fw_zones[iface.name] = zone.toUpperCase()
      return []
    }

    // ── Firewall-only: security-level (interface_config) ──────────────────
    // Security level 0-100: 100 = most trusted (INSIDE), 0 = least (OUTSIDE).
    // Stored for display; zone-based rules govern actual policy enforcement.
    if (cmd === 'security-level') {
      if (mode !== 'interface_config') return this._invalidInput()
      if (device.type !== 'firewall') return this._invalidInput()
      const level = parseInt(tokens[1], 10)
      if (isNaN(level) || level < 0 || level > 100)
        return ['% Incomplete command.  Usage: security-level <0-100>']
      const iface = device.getInterface(device.active_interface)
      if (!iface) return ['% No active interface']
      if (!device.fw_security_levels) device.fw_security_levels = {}
      device.fw_security_levels[iface.name] = level
      return []
    }

    // ── Firewall-only: firewall-rule (global_config) ───────────────────────
    // Ordered rule list; first-match wins; implicit default-deny at the end.
    // Syntax: firewall-rule permit|deny from-zone <z> to-zone <z>
    //           src <ip|subnet/prefix|any> dst <ip|subnet/prefix|any>
    //           [service any|icmp|<name>|<proto>/<port>]
    // Named services: HTTP HTTPS SSH DNS FTP TELNET RDP SMTP
    // Raw:  tcp/443  udp/53  (protocol must be tcp or udp; port 1-65535)
    if (cmd === 'firewall-rule') {
      if (mode !== 'global_config') return this._invalidInput()
      if (device.type !== 'firewall') return this._invalidInput()

      // `firewall-rule <id> enable|disable` — toggle without removing
      const maybeId = parseInt(tokens[1], 10)
      const toggle  = tokens[2]?.toLowerCase()
      if (!isNaN(maybeId) && (toggle === 'enable' || toggle === 'disable')) {
        const rule = (device.fw_rules ?? []).find(r => r.id === maybeId)
        if (!rule) return [`% Rule ${maybeId} not found`]
        rule.enabled = (toggle === 'enable')
        device.fw_sessions = []  // changing effective rules invalidates established sessions
        return []
      }

      // `firewall-rule permit|deny from-zone ... to-zone ... src ... dst ... [service ...]`
      const action = tokens[1]?.toLowerCase()
      if (action !== 'permit' && action !== 'deny')
        return [
          '% Incomplete command.',
          '  Usage: firewall-rule permit|deny from-zone <zone> to-zone <zone>',
          '         src <ip|any> dst <ip|any> [service any|icmp|HTTPS|tcp/443|...]',
          '  Or:    firewall-rule <id> enable|disable',
        ]
      const kv = _parseFirewallRuleTokens(tokens.slice(2))
      if (!kv.fromZone || !kv.toZone)
        return ['% Missing from-zone or to-zone.', '  Usage: firewall-rule ... from-zone <zone> to-zone <zone> ...']
      const svcStr = kv.service || 'any'
      if (!_isValidFwService(svcStr))
        return [
          `% Invalid service: ${svcStr}`,
          '  Use: any | icmp | <name> | <proto>/<port>',
          '  Named services: HTTP HTTPS SSH DNS FTP TELNET RDP SMTP',
          '  Raw examples:   tcp/443  tcp/22  udp/53  tcp/3389',
        ]
      if (!device.fw_rules) device.fw_rules = []
      const nextId = device.fw_rules.length > 0
        ? Math.max(...device.fw_rules.map(r => r.id)) + 1 : 1
      device.fw_rules.push({
        id:       nextId,
        enabled:  true,
        action,
        fromZone: kv.fromZone.toUpperCase(),
        toZone:   kv.toZone.toUpperCase(),
        src:      kv.src || 'any',
        dst:      kv.dst || 'any',
        service:  svcStr,
      })
      return []
    }

    // `access-list <1-99> permit <network> <wildcard>` — standard ACL for NAT, router + firewall
    if (cmd === 'access-list') {
      if (mode !== 'global_config') return this._invalidInput()
      if (device.type !== 'router' && device.type !== 'firewall') return this._invalidInput()
      const aclId = parseInt(tokens[1], 10)
      if (isNaN(aclId) || aclId < 1 || aclId > 99)
        return ['% Standard ACL number must be 1-99']
      const action = tokens[2]?.toLowerCase()
      if (!action) return ['% Incomplete command.  Usage: access-list <1-99> permit <network> <wildcard>']
      if (action !== 'permit')
        return [`% Invalid input detected at '^' marker.`, `% Only 'permit' entries are supported.`]
      const network  = tokens[3]
      const wildcard = tokens[4]
      if (!network || !wildcard)
        return ['% Incomplete command.  Usage: access-list <1-99> permit <network> <wildcard>']
      if (!isValidIp(network))  return [`% Invalid network: ${network}`]
      if (!isValidIp(wildcard)) return [`% Invalid wildcard mask: ${wildcard}`]
      let acl = device.nat_acls.find(a => a.id === aclId)
      if (!acl) { acl = { id: aclId, entries: [] }; device.nat_acls.push(acl) }
      acl.entries.push({ permit: true, network, wildcard })
      return []
    }

    // `encapsulation dot1Q <vlan-id> [native]` — subinterface only, router only
    if (cmd === 'encapsulation') {
      if (mode !== 'subif_config') return this._invalidInput()
      const subif = device.getInterface(device.active_interface)
      if (!subif) return ['% No active subinterface']
      const proto = tokens[1]?.toLowerCase()
      if (proto !== 'dot1q' && proto !== 'dot1q') return [
        `% Invalid input detected at '^' marker.`,
        `% Only 'dot1Q' encapsulation is supported.`,
      ]
      const vlanId = parseInt(tokens[2], 10)
      if (isNaN(vlanId) || vlanId < 1 || vlanId > 4094)
        return ['% Incomplete command.  Usage: encapsulation dot1Q <vlan-id> [native]']
      const isNativeKw = tokens[3]?.toLowerCase() === 'native'
      subif.vlanTag = vlanId
      subif.native = isNativeKw
      refreshSubifs(device)
      return []
    }

    // ── Switch-only: switchport ────────────────────────────────────────────
    if (cmd === 'switchport') {
      if (mode !== 'interface_config') return this._invalidInput()
      if (device.type !== 'switch') return this._invalidInput()
      const iface = device.getInterface(device.active_interface)
      if (!iface) return ['% No active interface']
      if (iface.svi) return [
        `% Invalid input detected at '^' marker.`,
        `% Switchport commands are not valid on SVIs (use interface vlan <id> for management).`,
      ]
      return this._cmdSwitchport(device, iface, tokens)
    }

    // ── Interface config / subif_config ───────────────────────────────────
    if (cmd === 'shutdown') {
      if (mode !== 'interface_config' && mode !== 'subif_config') return this._invalidInput()
      const iface = device.getInterface(device.active_interface)
      if (!iface) return ['% No active interface']

      if (iface.parent) {
        // Subinterface individual shutdown
        const wasUp = iface.status === 'up'
        iface.sub_shutdown = true
        refreshSubifs(device)
        return wasUp ? [
          `%LINK-5-CHANGED: Interface ${iface.name}, changed state to administratively down`,
          `%LINEPROTO-5-UPDOWN: Line protocol on Interface ${iface.name}, changed state to down`,
        ] : []
      }

      const wasUp = iface.status === 'up'
      iface.status = 'admin_down'
      // Propagate carrier-loss to the directly connected peer (real IOS behaviour:
      // when a port goes admin-down the remote loses link signal immediately).
      if (iface.connected_to) this.topology.shutdownPeer(iface.connected_to)
      if (device.type === 'switch' && !iface.svi) _refreshSvis(device)
      // Physical shutdown also brings all child subinterfaces down
      refreshSubifs(device)
      return wasUp ? [
        `%LINK-5-CHANGED: Interface ${iface.name}, changed state to administratively down`,
        `%LINEPROTO-5-UPDOWN: Line protocol on Interface ${iface.name}, changed state to down`,
      ] : []
    }

    // `wr` / `write memory` — save config (no persistence in sim; acknowledge so students
    // learn the command exists and don't think their config will be lost)
    if (cmd === 'wr' || cmd === 'write') {
      if (mode === 'user_exec') return this._invalidInput()
      const sub = tokens[1]?.toLowerCase()
      if (sub && sub !== 'memory' && sub !== 'mem') return this._invalidInput()
      return ['Building configuration...', '[OK]']
    }

    // `copy running-config startup-config` (and common abbreviations)
    if (cmd === 'copy') {
      if (mode === 'user_exec') return this._invalidInput()
      const src = tokens[1]?.toLowerCase()
      const dst = tokens[2]?.toLowerCase()
      if ((src === 'running-config' || src === 'run') &&
          (dst === 'startup-config'  || dst === 'start'))
        return ['Building configuration...', '[OK]']
      return this._invalidInput()
    }

    return this._invalidInput()
  }

  // ── exit / end ─────────────────────────────────────────────────────────────
  _cmdExit(device) {
    switch (device.config_mode) {
      case 'interface_config':
      case 'subif_config':
        device.config_mode = 'global_config'
        device.active_interface = null
        return []
      case 'vlan_config':
        device.config_mode = 'global_config'
        device.active_vlan = null
        return []
      case 'dhcp_pool_config':
        device.config_mode = 'global_config'
        device.active_dhcp_pool = null
        return []
      case 'global_config':
        device.config_mode = 'priv_exec'
        return []
      case 'priv_exec':
        device.config_mode = 'user_exec'
        return []
      default:
        return []
    }
  }

  _cmdEnd(device) {
    if (['global_config', 'interface_config', 'subif_config', 'vlan_config', 'dhcp_pool_config'].includes(device.config_mode)) {
      device.config_mode = 'priv_exec'
      device.active_interface = null
      device.active_vlan = null
      device.active_dhcp_pool = null
    }
    return []
  }

  // ── ping ───────────────────────────────────────────────────────────────────
  _cmdPing(device, tokens) {
    if (!tokens[1]) return ['% Incomplete command.  Usage: ping <destination>']
    let dstIp = tokens[1]
    if (!isValidIp(dstIp)) {
      const resolved = resolveHostname(dstIp)
      if (!resolved) return [`% Unknown host: ${dstIp}`]
      dstIp = resolved
    }

    const srcIp = _getSrcIp(this.topology, device, dstIp)
    if (!srcIp) return [
      `Type escape sequence to abort.`,
      `Sending 5, 100-byte ICMP Echos to ${dstIp}, timeout is 2 seconds:`,
      `.....`,
      `Success rate is 0 percent (0/5)`,
      `% No usable source interface`,
    ]

    const result = this.topology.checkPing(srcIp, dstIp)
    let rttLine = ''
    if (result.reachable) {
      const path = this.topology.findPath(srcIp, dstIp)
      const routerHops = path.slice(1, -1).filter(id =>
        this.topology.devices.get(id)?.type === 'router'
      ).length
      const rttMin = routerHops === 0 ? 1 : routerHops * 2
      const rttMax = rttMin + 3
      const rttAvg = rttMin + 1
      rttLine = `, round-trip min/avg/max = ${rttMin}/${rttAvg}/${rttMax} ms`
    }
    const lines = [
      `Type escape sequence to abort.`,
      `Sending 5, 100-byte ICMP Echos to ${dstIp}, timeout is 2 seconds:`,
      result.reachable ? '!!!!!' : '.....',
      result.reachable
        ? `Success rate is 100 percent (5/5)${rttLine}`
        : `Success rate is 0 percent (0/5)`,
    ]
    const msg = _iosFailureMsg(result.failureReason)
    if (!result.reachable && msg) lines.push(`% ${msg}`)
    return lines
  }

  // ── show ───────────────────────────────────────────────────────────────────
  _cmdShow(device, tokens) {
    const sub = tokens[1]?.toLowerCase()

    if (sub === 'running-config' || sub === 'run') return this._showRunCfg(device)

    if (sub === 'ip') {
      const sub2 = tokens[2]?.toLowerCase()
      if (sub2 === 'interface' || sub2 === 'int') {
        const sub3 = tokens[3]?.toLowerCase()
        if (!sub3 || sub3 === 'brief' || sub3 === 'br') return this._showIpIntBrief(device)
        return this._showIpIntDetail(device, tokens[3])
      }
      if (sub2 === 'route' || sub2 === 'ro') {
        if (device.type === 'switch') return [
          'Default gateway is not set',
          '',
          'Host               Gateway           Last Use    Total Uses  Interface',
          'ICMP redirect cache is empty',
        ]
        return this._showIpRoute(device)
      }
      if (sub2 === 'dhcp') {
        if (device.type !== 'router') return this._invalidInput()
        const sub3 = tokens[3]?.toLowerCase()
        if (sub3 === 'binding')  return this._showDhcpBinding(device)
        if (sub3 === 'pool')     return this._showDhcpPool(device)
        return ['% Incomplete command.  Usage: show ip dhcp { binding | pool }']
      }

      if (sub2 === 'nat') {
        if (device.type !== 'router' && device.type !== 'firewall') return this._invalidInput()
        const sub3 = tokens[3]?.toLowerCase()
        if (!sub3 || sub3 === 'translations' || sub3 === 'trans')
          return this._showNatTranslations(device)
        if (sub3 === 'statistics' || sub3 === 'stat')
          return this._showNatStatistics(device)
        return ['% Incomplete command.  Usage: show ip nat { translations | statistics }']
      }
    }

    if (sub === 'vlan') {
      if (device.type !== 'switch') return this._invalidInput()
      const sub2 = tokens[2]?.toLowerCase()
      if (!sub2 || sub2 === 'brief' || sub2 === 'br') return this._showVlanBrief(device)
    }

    // `show interfaces trunk` — switch-only, lists trunk ports
    if (sub === 'interfaces' && tokens[2]?.toLowerCase() === 'trunk') {
      if (device.type !== 'switch') return this._invalidInput()
      return this._showInterfacesTrunk(device)
    }

    if (sub === 'mac-address-table' || (sub === 'mac' && tokens[2]?.toLowerCase() === 'address-table')) {
      if (device.type !== 'switch') return this._invalidInput()
      return ['Mac Address Table', '-------------------------------------------',
        'Vlan    Mac Address       Type        Ports', '----    -----------       --------    -----',
        '(MAC address table is empty in simulation)']
    }

    if (sub === 'arp') {
      return [
        'Protocol  Address          Age (min)  Hardware Addr   Type   Interface',
        '(ARP table is empty — ARP is not simulated)',
      ]
    }

    // Firewall-specific show commands
    if (sub === 'nameif') {
      if (device.type !== 'firewall') return this._invalidInput()
      return this._showNameif(device)
    }
    if (sub === 'firewall-rules') {
      if (device.type !== 'firewall') return this._invalidInput()
      return this._showFirewallRules(device)
    }
    if (sub === 'conn') {
      if (device.type !== 'firewall') return this._invalidInput()
      return this._showConn(device)
    }

    // `show interfaces [<name>]` — Layer 1/2 detail (without the `ip` keyword)
    if (sub === 'interfaces' || sub === 'int') {
      const ifArg = tokens[2]
      if (!ifArg) {
        return device.interfaces.flatMap(i => [...this._showIpIntDetail(device, i.name), ''])
      }
      return this._showIpIntDetail(device, ifArg)
    }

    if (sub === 'version' || sub === 'ver') return [
      'Cisco IOS Software [Simulator], Version 1.0 (NetEngineerSim)',
    ]

    return this._invalidInput()
  }

  _showRunCfg(device) {
    const L = [
      'Building configuration...',
      '',
      'Current configuration:',
      '!',
      `version ${device.type === 'switch' ? '15.0' : '15.2'}`,
      '!',
      `hostname ${device.hostname}`,
      '!',
    ]

    if (device.type === 'firewall') {
      // Interfaces — show zone, security-level, IP, and admin state
      for (const iface of device.interfaces) {
        L.push(`interface ${iface.name}`)
        if (iface.description) L.push(` description ${iface.description}`)
        const zone  = device.fw_zones?.[iface.name]
        const level = device.fw_security_levels?.[iface.name]
        if (zone  !== undefined) L.push(` nameif ${zone}`)
        if (level !== undefined) L.push(` security-level ${level}`)
        if (iface.ip && iface.subnet_mask) L.push(` ip address ${iface.ip} ${iface.subnet_mask}`)
        else L.push(` no ip address`)
        if (iface.status === 'admin_down') L.push(` shutdown`)
        L.push('!')
      }
      // Static routes
      for (const r of device.routing_table) {
        L.push(`ip route ${r.network} ${r.mask} ${r.next_hop}`)
      }
      if (device.routing_table.length) L.push('!')
      // Firewall policy rules (ordered)
      for (const r of (device.fw_rules ?? [])) {
        const parts = [
          `firewall-rule ${r.action}`,
          `from-zone ${r.fromZone}`,
          `to-zone ${r.toZone}`,
          `src ${r.src ?? 'any'}`,
          `dst ${r.dst ?? 'any'}`,
        ]
        if (r.service && r.service !== 'any') parts.push(`service ${r.service}`)
        L.push(parts.join(' '))
        if (r.enabled === false) L.push(`firewall-rule ${r.id} disable`)
      }
      if ((device.fw_rules ?? []).length) L.push('!')
    } else if (device.type === 'switch') {
      // VLAN database — entries created with `vlan <id>` in config mode
      for (const [vid, entry] of Object.entries(device.vlan_db).sort((a, b) => parseInt(a) - parseInt(b))) {
        L.push(`vlan ${vid}`)
        L.push(` name ${entry.name}`)
        L.push('!')
      }
      // Physical switchports (no IP — L2 config only)
      for (const iface of device.interfaces) {
        if (iface.svi) continue
        L.push(`interface ${iface.name}`)
        if (iface.description) L.push(` description ${iface.description}`)
        const mode = iface.switchport_mode || 'access'
        L.push(` switchport mode ${mode}`)
        if (mode === 'access') L.push(` switchport access vlan ${iface.vlan ?? 1}`)
        if (iface.status === 'admin_down') L.push(` shutdown`)
        L.push('!')
      }
      // SVIs (management IP lives here)
      for (const iface of device.interfaces) {
        if (!iface.svi) continue
        L.push(`interface ${iface.name}`)
        if (iface.description) L.push(` description ${iface.description}`)
        if (iface.ip && iface.subnet_mask) L.push(` ip address ${iface.ip} ${iface.subnet_mask}`)
        else L.push(` no ip address`)
        if (iface.status === 'admin_down') L.push(` shutdown`)
        L.push('!')
      }
    } else {
      // NAT ACLs (appear before interface and NAT rule config in real IOS)
      for (const acl of (device.nat_acls ?? [])) {
        for (const entry of acl.entries) {
          L.push(`access-list ${acl.id} ${entry.permit ? 'permit' : 'deny'} ${entry.network} ${entry.wildcard}`)
        }
      }
      if ((device.nat_acls ?? []).some(a => a.entries.length > 0)) L.push('!')

      // NAT overload rules
      for (const r of (device.nat_rules ?? [])) {
        L.push(`ip nat inside source list ${r.acl_id} interface ${r.outside_interface} overload`)
      }
      if ((device.nat_rules ?? []).length) L.push('!')

      // DHCP excluded-address lines (must appear before pool definitions in real IOS)
      for (const e of (device.dhcp_excluded ?? [])) {
        if (e.start === e.end) L.push(`ip dhcp excluded-address ${e.start}`)
        else L.push(`ip dhcp excluded-address ${e.start} ${e.end}`)
      }
      if (device.dhcp_excluded?.length) L.push('!')
      // DHCP pool definitions
      for (const pool of (device.dhcp_pools ?? [])) {
        L.push(`ip dhcp pool ${pool.name}`)
        if (pool.network && pool.mask) L.push(` network ${pool.network} ${pool.mask}`)
        if (pool.default_router)       L.push(` default-router ${pool.default_router}`)
        if (pool.dns_server)           L.push(` dns-server ${pool.dns_server}`)
        L.push(` lease ${pool.lease_days} ${pool.lease_hours} ${pool.lease_mins}`)
        L.push('!')
      }
      // Physical interfaces first
      for (const iface of device.interfaces) {
        if (iface.parent) continue  // subinterfaces rendered below
        L.push(`interface ${iface.name}`)
        if (iface.description) L.push(` description ${iface.description}`)
        if (iface.ip && iface.subnet_mask) L.push(` ip address ${iface.ip} ${iface.subnet_mask}`)
        else L.push(` no ip address`)
        for (const h of (iface.helper_addresses ?? [])) L.push(` ip helper-address ${h}`)
        if (iface.nat_inside)  L.push(` ip nat inside`)
        if (iface.nat_outside) L.push(` ip nat outside`)
        if (iface.status === 'admin_down') L.push(` shutdown`)
        L.push('!')
      }
      // Subinterfaces (sorted by name for readability)
      const subifs = device.interfaces.filter(i => i.parent)
        .sort((a, b) => a.name.localeCompare(b.name))
      for (const iface of subifs) {
        L.push(`interface ${iface.name}`)
        if (iface.description) L.push(` description ${iface.description}`)
        if (iface.vlanTag !== null)
          L.push(` encapsulation dot1Q ${iface.vlanTag}${iface.native ? ' native' : ''}`)
        if (iface.ip && iface.subnet_mask) L.push(` ip address ${iface.ip} ${iface.subnet_mask}`)
        else L.push(` no ip address`)
        if (iface.sub_shutdown) L.push(` shutdown`)
        L.push('!')
      }
      for (const r of device.routing_table) {
        L.push(`ip route ${r.network} ${r.mask} ${r.next_hop}`)
      }
      if (device.routing_table.length) L.push('!')
    }

    L.push('end')
    return L
  }

  _showIpIntBrief(device) {
    const L = ['Interface                  IP-Address      OK? Method Status                Protocol']
    // Physical and SVI interfaces first, then subinterfaces (sorted)
    const physAndSvi = device.interfaces.filter(i => !i.parent)
    const subifs = device.interfaces.filter(i => i.parent).sort((a, b) => a.name.localeCompare(b.name))
    for (const iface of [...physAndSvi, ...subifs]) {
      // Real Catalyst 2960 `show ip interface brief` shows ALL interfaces — physical
      // switchports appear with "unassigned" IP and their current line/protocol state.
      const [status, proto] = _statusProto(iface.status)
      L.push(
        iface.name.padEnd(27) +
        (iface.ip || 'unassigned').padEnd(16) +
        (iface.ip ? 'YES' : 'NO ') + '  ' +
        (iface.ip ? 'manual' : 'unset ') + ' ' +
        status.padEnd(22) + proto
      )
    }
    return L
  }

  _showIpIntDetail(device, ifArg) {
    const iface = device.getInterface(normalizeIfName(ifArg))
    if (!iface) return [`% Invalid interface: ${ifArg}`]
    const [status, proto] = _statusProto(iface.status)
    const cidr = iface.ip ? `${iface.ip}/${maskToPrefixLen(iface.subnet_mask)}` : 'not set'
    const lines = [`${iface.name} is ${status}, line protocol is ${proto}`]
    if (iface.description) lines.push(`  Description: ${iface.description}`)
    lines.push(`  Internet address is ${cidr}`)
    lines.push(`  Connected to: ${iface.connected_to || 'nothing'}`)
    return lines
  }

  _showIpRoute(device) {
    // A static route is only installed (active) when its next-hop is reachable via a
    // directly-connected subnet. Real IOS: unresolvable routes stay in running-config
    // but do NOT appear in `show ip route`. Uses each interface's own mask for lookup.
    const isRouteActive = r => device.interfaces.some(i =>
      i.status === 'up' && i.ip && i.subnet_mask &&
      networkAddress(r.next_hop, i.subnet_mask) === networkAddress(i.ip, i.subnet_mask)
    )
    const defaultRoute = device.routing_table.find(r => r.network === '0.0.0.0' && r.mask === '0.0.0.0')
    const defaultActive = defaultRoute && isRouteActive(defaultRoute)

    const L = ['Codes: C - connected, L - local, S - static', '']
    L.push(defaultActive
      ? `Gateway of last resort is ${defaultRoute.next_hop} to network 0.0.0.0`
      : 'Gateway of last resort is not set')
    L.push('')

    let any = false
    for (const iface of device.interfaces) {
      if (iface.ip && iface.subnet_mask && iface.status === 'up') {
        const net = networkAddress(iface.ip, iface.subnet_mask)
        const pfx = maskToPrefixLen(iface.subnet_mask)
        L.push(`C       ${net}/${pfx} is directly connected, ${iface.name}`)
        L.push(`L       ${iface.ip}/32 is directly connected, ${iface.name}`)
        any = true
      }
    }
    for (const r of device.routing_table) {
      if (!isRouteActive(r)) continue   // next-hop not reachable — route not installed
      const pfx = maskToPrefixLen(r.mask)
      const isDefault = r.network === '0.0.0.0' && pfx === 0
      L.push(`S${isDefault ? '*' : ' '}      ${r.network}/${pfx} [1/0] via ${r.next_hop}`)
      any = true
    }
    if (!any) L.push('% No IP routing table entries found.')
    return L
  }

  _showDhcpBinding(device) {
    const L = [
      'Bindings from all pools not associated with VRF:',
      'IP address          Client-ID/           Lease expiration         Type',
      '                    Hardware address',
    ]
    if (!device.dhcp_bindings?.length) {
      L.push('(no bindings)')
      return L
    }
    for (const b of device.dhcp_bindings) {
      L.push(
        b.ip.padEnd(20) +
        b.client_id.padEnd(29) +
        b.lease_expires.padEnd(25) +
        'Automatic'
      )
    }
    return L
  }

  _showDhcpPool(device) {
    if (!device.dhcp_pools?.length) return ['(no DHCP pools configured)']
    const L = []
    for (const pool of device.dhcp_pools) {
      const leased = device.dhcp_bindings?.filter(b => b.pool_name === pool.name).length ?? 0
      const excluded = device.dhcp_excluded?.reduce((acc, e) => {
        if (!pool.network || !pool.mask) return acc
        const sN = _ipToNum(e.start), eN = _ipToNum(e.end)
        const netN = _ipToNum(pool.network), bcastN = _ipToNum(pool.network) | (~_ipToNum(pool.mask)) >>> 0
        let count = 0
        for (let n = sN; n <= eN; n++) if (n > netN && n < bcastN) count++
        return acc + count
      }, 0) ?? 0
      const total = pool.network && pool.mask ? _poolHostCount(pool) : 0
      const lease = `${pool.lease_days} day${pool.lease_days !== 1 ? 's' : ''}`
      L.push(`Pool ${pool.name} :`)
      L.push(` Utilization mark (high/low)    : 100 / 0`)
      L.push(` Subnet size (first/next)       : 0 / 0`)
      L.push(` Total addresses                : ${total}`)
      L.push(` Leased addresses               : ${leased}`)
      L.push(` Excluded addresses             : ${excluded}`)
      L.push(` Network                        : ${pool.network ?? '(not set)'} ${pool.mask ?? ''}`)
      L.push(` Default router                 : ${pool.default_router ?? '(not set)'}`)
      L.push(` DNS server                     : ${pool.dns_server ?? '(not set)'}`)
      L.push(` Lease                          : ${lease}`)
    }
    return L
  }

  _showNatTranslations(device) {
    const L = ['Pro Inside global      Inside local       Outside local      Outside global']
    const entries = device.nat_translations ?? []
    if (!entries.length) { L.push('(no active translations)'); return L }
    for (const t of entries) {
      L.push(
        '--- ' +
        (t.inside_global ?? '---').padEnd(19) +
        (t.inside_local  ?? '---').padEnd(19) +
        '---                ---'
      )
    }
    return L
  }

  _showNatStatistics(device) {
    const active    = (device.nat_translations ?? []).length
    const outsideIf = (device.interfaces ?? []).filter(i => i.nat_outside && !i.parent).map(i => i.name)
    const insideIf  = (device.interfaces ?? []).filter(i => i.nat_inside  && !i.parent).map(i => i.name)
    const L = [
      `Total active translations: ${active} (${active} extended, 0 static)`,
      `Peak translations: ${active}`,
      'Outside interfaces:',
      ...(outsideIf.length ? outsideIf.map(n => `  ${n}`) : ['  (none)']),
      'Inside interfaces:',
      ...(insideIf.length  ? insideIf.map(n => `  ${n}`)  : ['  (none)']),
    ]
    if ((device.nat_rules ?? []).length) {
      L.push('Dynamic mappings:')
      L.push('-- Inside Source')
      for (const r of device.nat_rules) {
        L.push(` access-list ${r.acl_id} interface ${r.outside_interface} overload`)
      }
    }
    return L
  }

  // ── Firewall show methods ──────────────────────────────────────────────────

  _showNameif(device) {
    const L = [
      'Interface                Zone          Security-level',
      '----------------------------------------------------',
    ]
    for (const iface of device.interfaces) {
      const zone  = device.fw_zones?.[iface.name] ?? '(unassigned)'
      const level = device.fw_security_levels?.[iface.name]
      L.push(
        iface.name.padEnd(25) +
        zone.padEnd(14) +
        (level !== undefined ? level : '--')
      )
    }
    return L
  }

  _showFirewallRules(device) {
    const rules = device.fw_rules ?? []
    if (!rules.length) {
      return [
        'Firewall policy: (no rules configured)',
        '! Default action: deny — all inter-zone traffic is blocked until rules are added.',
      ]
    }
    const L = [
      '  ID  State    Action   From-Zone    To-Zone      Src              Dst              Service',
      '  ─────────────────────────────────────────────────────────────────────────────────────────',
    ]
    for (const r of rules) {
      const state = r.enabled === false ? 'disabled' : 'enabled '
      L.push(
        `  ${String(r.id).padEnd(4)}` +
        state.padEnd(9) +
        r.action.padEnd(9) +
        r.fromZone.padEnd(13) +
        r.toZone.padEnd(13) +
        (r.src ?? 'any').padEnd(17) +
        (r.dst ?? 'any').padEnd(17) +
        (r.service ?? 'any')
      )
    }
    L.push('')
    L.push('  (implicit) deny  any → any  — default-deny (no match = blocked)')
    return L
  }

  _showConn(device) {
    const sessions = device.fw_sessions ?? []
    if (!sessions.length) {
      return ['Active stateful connections: 0', '(no established sessions)']
    }
    const L = [
      `Active stateful connections: ${sessions.length}`,
      '  Protocol  Port   Src IP           Dst IP',
      '  ────────────────────────────────────────────────────────',
    ]
    for (const s of sessions) {
      const proto = s.protocol ? s.protocol.toUpperCase() : 'ANY'
      const port  = s.port != null ? String(s.port) : '—'
      L.push(
        `  ${proto.padEnd(10)}${port.padEnd(7)}${(s.srcIp ?? '?').padEnd(17)} ${s.dstIp ?? '?'}`
      )
    }
    return L
  }

  // ── ip (address / route) ───────────────────────────────────────────────────
  _cmdIp(device, tokens) {
    const sub = tokens[1]?.toLowerCase()

    if (sub === 'address' || sub === 'addr') {
      if (device.config_mode !== 'interface_config' && device.config_mode !== 'subif_config')
        return this._invalidInput()

      // L2 switch: ip address is only valid on an SVI (Vlan*), not on physical switchports
      if (device.type === 'switch') {
        const iface = device.getInterface(device.active_interface)
        if (!iface?.svi) return [
          `% Invalid input detected at '^' marker.`,
          `% ip address is not supported on switchports. Use 'interface vlan <id>' for management IP.`,
        ]
      }

      const [, , ip, mask] = tokens
      if (!ip || !mask) return ['% Incomplete command.  Usage: ip address <ip> <mask>']
      if (!isValidIp(ip))     return [`% Invalid IP address: ${ip}`]
      if (!isValidMask(mask)) return [`% Invalid mask: ${mask}`]
      if (!isHostAddress(ip, mask)) {
        if (ip === networkAddress(ip, mask))
          return [`% ${ip} is the network address for subnet ${networkAddress(ip, mask)}/${maskToPrefixLen(mask)}`]
        return [`% ${ip} is the broadcast address for subnet ${networkAddress(ip, mask)}/${maskToPrefixLen(mask)}`]
      }
      const iface = device.getInterface(device.active_interface)
      if (!iface) return ['% No active interface']
      // Reject duplicate IPs — two devices with the same IP cause ARP conflicts
      const dupDevice = [...this.topology.devices.values()].find(dev =>
        dev !== device && dev.interfaces.some(i => i.ip === ip)
      )
      if (dupDevice) return [`% ${ip}: address is already assigned to ${dupDevice.hostname} — duplicate IPs cause network conflicts`]
      // Reject overlapping subnets on the same router (real IOS: "% X overlaps with Y")
      if (device.type !== 'switch') {
        const newNet = networkAddress(ip, mask)
        for (const other of device.interfaces) {
          if (other === iface || !other.ip || !other.subnet_mask) continue
          const otherNet = networkAddress(other.ip, other.subnet_mask)
          if (networkAddress(other.ip, mask) === newNet ||
              networkAddress(ip, other.subnet_mask) === otherNet) {
            return [`% ${ip} overlaps with ${other.ip} on ${other.name}`]
          }
        }
      }
      iface.ip = ip
      iface.subnet_mask = mask
      return []
    }

    if (sub === 'route') {
      // L2 switch has no routing table
      if (device.type === 'switch') return [
        `% Invalid input detected at '^' marker.`,
        `% IP routing is not enabled on this switch.`,
      ]
      if (device.config_mode !== 'global_config') return this._invalidInput()
      const [, , network, mask, nextHop] = tokens
      if (!network || !mask || !nextHop)
        return ['% Incomplete command.  Usage: ip route <network> <mask> <next-hop>']
      if (!isValidIp(network)) return [`% Invalid network: ${network}`]
      if (!isValidIp(mask))    return [`% Invalid mask: ${mask}`]
      if (!isValidIp(nextHop)) return [`% Invalid next-hop: ${nextHop}`]
      const canonical = networkAddress(network, mask)
      const idx = device.routing_table.findIndex(r => r.network === canonical && r.mask === mask)
      const entry = { network: canonical, mask, next_hop: nextHop }
      if (idx >= 0) device.routing_table[idx] = entry
      else device.routing_table.push(entry)
      return []
    }

    // ── ip dhcp (global_config, router only) ───────────────────────────────
    if (sub === 'dhcp') {
      if (device.config_mode !== 'global_config') return this._invalidInput()
      if (device.type !== 'router') return [
        `% Invalid input detected at '^' marker.`,
        `% ip dhcp commands are only valid on routers.`,
      ]
      const sub2 = tokens[2]?.toLowerCase()

      if (sub2 === 'excluded-address') {
        const start = tokens[3]
        const end = tokens[4] ?? tokens[3]
        if (!start || !isValidIp(start))
          return ['% Incomplete command.  Usage: ip dhcp excluded-address <start-ip> [end-ip]']
        if (!isValidIp(end)) return [`% Invalid IP: ${end}`]
        device.dhcp_excluded.push({ start, end })
        return []
      }

      if (sub2 === 'pool') {
        const name = tokens[3]
        if (!name) return ['% Incomplete command.  Usage: ip dhcp pool <name>']
        let pool = device.dhcp_pools.find(p => p.name === name)
        if (!pool) {
          pool = { name, network: null, mask: null, default_router: null, dns_server: null, lease_days: 1, lease_hours: 0, lease_mins: 0 }
          device.dhcp_pools.push(pool)
        }
        device.active_dhcp_pool = name
        device.config_mode = 'dhcp_pool_config'
        return []
      }

      return ['% Incomplete command.  Usage: ip dhcp { excluded-address | pool }']
    }

    // ── ip helper-address (interface_config, router only) ──────────────────
    if (sub === 'helper-address') {
      if (device.config_mode !== 'interface_config') return this._invalidInput()
      if (device.type !== 'router') return this._invalidInput()
      const helperIp = tokens[2]
      if (!helperIp || !isValidIp(helperIp))
        return ['% Incomplete command.  Usage: ip helper-address <ip>']
      const iface = device.getInterface(device.active_interface)
      if (!iface) return ['% No active interface']
      if (!iface.helper_addresses.includes(helperIp))
        iface.helper_addresses.push(helperIp)
      return []
    }

    // ── ip nat (interface_config or global_config, router + firewall) ─────────
    if (sub === 'nat') {
      if (device.type !== 'router' && device.type !== 'firewall') return [
        `% Invalid input detected at '^' marker.`,
        `% ip nat commands are only valid on routers and firewalls.`,
      ]
      const sub2 = tokens[2]?.toLowerCase()

      // Interface config: `ip nat inside` / `ip nat outside`
      if (device.config_mode === 'interface_config') {
        const iface = device.getInterface(device.active_interface)
        if (!iface) return ['% No active interface']
        if (sub2 === 'inside')  { iface.nat_inside = true; iface.nat_outside = false; return [] }
        if (sub2 === 'outside') { iface.nat_outside = true; iface.nat_inside = false; return [] }
        return ['% Incomplete command.  Usage: ip nat { inside | outside }']
      }

      // Global config: `ip nat inside source list <n> interface <if> overload`
      if (device.config_mode === 'global_config') {
        if (sub2 !== 'inside')
          return ['% Incomplete command.  Usage: ip nat inside source list <acl-id> interface <if> overload']
        const sub3 = tokens[3]?.toLowerCase()
        const sub4 = tokens[4]?.toLowerCase()
        if (sub3 !== 'source' || sub4 !== 'list')
          return ['% Incomplete command.  Usage: ip nat inside source list <acl-id> interface <if> overload']
        const aclId    = parseInt(tokens[5], 10)
        const kw       = tokens[6]?.toLowerCase()
        const wanIfArg = tokens[7]
        const overload = tokens[8]?.toLowerCase()
        if (isNaN(aclId) || kw !== 'interface' || !wanIfArg || overload !== 'overload')
          return ['% Incomplete command.  Usage: ip nat inside source list <acl-id> interface <if> overload']
        const wanIfName = normalizeIfName(wanIfArg)
        const wanIface  = device.getInterface(wanIfName)
        if (!wanIface) return [`% No such interface: ${wanIfArg}`]
        const rule = { acl_id: aclId, outside_interface: wanIfName, overload: true }
        const idx  = device.nat_rules.findIndex(r => r.acl_id === aclId)
        if (idx >= 0) device.nat_rules[idx] = rule
        else device.nat_rules.push(rule)
        return []
      }

      return this._invalidInput()
    }

    return this._invalidInput()
  }

  // ── no ─────────────────────────────────────────────────────────────────────
  _cmdNo(device, tokens) {
    const sub = tokens[1]?.toLowerCase()
    const mode = device.config_mode

    // `no access-list <n>` — remove standard ACL (global_config, router only)
    if (sub === 'access-list') {
      if (mode !== 'global_config') return this._invalidInput()
      if (device.type !== 'router') return this._invalidInput()
      const aclId = parseInt(tokens[2], 10)
      if (isNaN(aclId)) return ['% Incomplete command.  Usage: no access-list <1-99>']
      device.nat_acls = device.nat_acls.filter(a => a.id !== aclId)
      device.nat_translations = []  // stale translations no longer valid
      return []
    }

    if (sub === 'switchport') {
      const sub2 = tokens[2]?.toLowerCase()
      const sub3 = tokens[3]?.toLowerCase()
      // `no switchport access vlan` — reset port to VLAN 1 (must be in interface_config on switch)
      if (sub2 === 'access' && sub3 === 'vlan') {
        if (mode !== 'interface_config') return this._invalidInput()
        if (device.type !== 'switch') return this._invalidInput()
        const iface = device.getInterface(device.active_interface)
        if (!iface) return ['% No active interface']
        iface.vlan = 1
        return []
      }
      // `no switchport` makes a port a routed port — not supported on a pure L2 switch
      if (device.type === 'switch') return [
        `% Invalid input detected at '^' marker.`,
        `% 'no switchport' is not supported on a Layer 2-only switch.`,
      ]
      return this._invalidInput()
    }

    if (sub === 'description') {
      if (mode !== 'interface_config' && mode !== 'subif_config') return this._invalidInput()
      const iface = device.getInterface(device.active_interface)
      if (!iface) return ['% No active interface']
      iface.description = null
      return []
    }

    if (sub === 'shutdown') {
      if (mode !== 'interface_config' && mode !== 'subif_config') return this._invalidInput()
      const iface = device.getInterface(device.active_interface)
      if (!iface) return ['% No active interface']

      if (iface.parent) {
        // Subinterface: clear individual shutdown; status re-derived from parent
        iface.sub_shutdown = false
        refreshSubifs(device)
        const state = iface.status
        return [
          `%LINK-5-CHANGED: Interface ${iface.name}, changed state to ${state}`,
          `%LINEPROTO-5-UPDOWN: Line protocol on Interface ${iface.name}, changed state to ${state}`,
        ]
      }

      if (iface.svi) {
        // SVI comes up only when at least one port in the VLAN is up (real IOS behavior)
        iface.status = _sviPortIsUp(device, iface.vlan) ? 'up' : 'down'
      } else {
        // When bringing up a physical interface, check the peer — if the peer is
        // admin_down there is no carrier signal and the local interface stays 'down'.
        // Also wake up the peer if it was waiting on carrier (peer.status === 'down').
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
        if (device.type === 'switch') _refreshSvis(device)
      }
      // Physical interface state changed — refresh any subinterfaces that depend on it
      refreshSubifs(device)
      const state = iface.status
      return [
        `%LINK-5-CHANGED: Interface ${iface.name}, changed state to ${state}`,
        `%LINEPROTO-5-UPDOWN: Line protocol on Interface ${iface.name}, changed state to ${state}`,
      ]
    }

    if (sub === 'ip') {
      const sub2 = tokens[2]?.toLowerCase()
      if (sub2 === 'address') {
        if (mode !== 'interface_config' && mode !== 'subif_config') return this._invalidInput()
        const iface = device.getInterface(device.active_interface)
        if (!iface) return ['% No active interface']
        iface.ip = null
        iface.subnet_mask = null
        return []
      }
      if (sub2 === 'route') {
        if (device.type === 'switch') return this._invalidInput()
        if (mode !== 'global_config') return this._invalidInput()
        const network = tokens[3], mask = tokens[4]
        if (!network || !mask) return ['% Incomplete command.']
        const canonical = networkAddress(network, mask)
        device.routing_table = device.routing_table.filter(
          r => !(r.network === canonical && r.mask === mask)
        )
        return []
      }
      // no ip dhcp excluded-address / no ip dhcp pool
      if (sub2 === 'dhcp') {
        if (device.type !== 'router' || mode !== 'global_config') return this._invalidInput()
        const sub3 = tokens[3]?.toLowerCase()
        if (sub3 === 'excluded-address') {
          const start = tokens[4], end = tokens[5] ?? tokens[4]
          if (!start) return ['% Incomplete command.']
          device.dhcp_excluded = device.dhcp_excluded.filter(e => !(e.start === start && e.end === (end ?? start)))
          return []
        }
        if (sub3 === 'pool') {
          const name = tokens[4]
          if (!name) return ['% Incomplete command.  Usage: no ip dhcp pool <name>']
          device.dhcp_pools    = device.dhcp_pools.filter(p => p.name !== name)
          device.dhcp_bindings = device.dhcp_bindings.filter(b => b.pool_name !== name)
          return []
        }
        return ['% Incomplete command.']
      }
      // no ip helper-address <ip>
      if (sub2 === 'helper-address') {
        if (mode !== 'interface_config' || device.type !== 'router') return this._invalidInput()
        const helperIp = tokens[3]
        const iface = device.getInterface(device.active_interface)
        if (!iface) return ['% No active interface']
        if (helperIp) {
          iface.helper_addresses = iface.helper_addresses.filter(h => h !== helperIp)
        } else {
          iface.helper_addresses = []
        }
        return []
      }

      // `no ip nat inside` / `no ip nat outside` (interface_config, router + firewall)
      // `no ip nat inside source list <n>` (global_config, router + firewall)
      if (sub2 === 'nat') {
        if (device.type !== 'router' && device.type !== 'firewall') return this._invalidInput()
        const sub3 = tokens[3]?.toLowerCase()

        if (mode === 'interface_config') {
          const iface = device.getInterface(device.active_interface)
          if (!iface) return ['% No active interface']
          if (sub3 === 'inside')  { iface.nat_inside  = false; return [] }
          if (sub3 === 'outside') { iface.nat_outside = false; return [] }
          return ['% Incomplete command.  Usage: no ip nat { inside | outside }']
        }

        if (mode === 'global_config') {
          // no ip nat inside source list <n>
          if (sub3 === 'inside') {
            const sub4 = tokens[4]?.toLowerCase()
            const sub5 = tokens[5]?.toLowerCase()
            if (sub4 === 'source' && sub5 === 'list') {
              const aclId = parseInt(tokens[6], 10)
              if (isNaN(aclId)) return ['% Incomplete command.  Usage: no ip nat inside source list <acl-id>']
              device.nat_rules        = device.nat_rules.filter(r => r.acl_id !== aclId)
              device.nat_translations = []  // stale translations cleared
              return []
            }
          }
          return ['% Incomplete command.  Usage: no ip nat inside source list <acl-id>']
        }

        return this._invalidInput()
      }
    }

    // `no encapsulation dot1q` — clear VLAN binding on subinterface
    if (sub === 'encapsulation') {
      if (mode !== 'subif_config') return this._invalidInput()
      const iface = device.getInterface(device.active_interface)
      if (!iface?.parent) return ['% No active subinterface']
      iface.vlanTag = null
      iface.native = false
      refreshSubifs(device)
      return []
    }

    // `no interface <name>` — delete subinterface or SVI
    if (sub === 'interface' || sub === 'int') {
      if (mode !== 'global_config') return this._invalidInput()
      const ifArg = tokens.slice(2).join(' ')
      if (!ifArg) return ['% Incomplete command.  Usage: no interface <name>']
      const ifName = normalizeIfName(ifArg)

      // `no interface vlan <id>` — delete SVI
      if (ifName.startsWith('Vlan')) {
        if (device.type !== 'switch') return this._invalidInput()
        const idx = device.interfaces.findIndex(i => i.name === ifName && i.svi)
        if (idx === -1) return [`% Interface ${ifName} not found`]
        device.interfaces.splice(idx, 1)
        return []
      }

      // `no interface GigabitEthernet0/0.10` — delete subinterface
      const parentName = getParentIfName(ifName)
      if (parentName !== null) {
        const idx = device.interfaces.findIndex(i => i.name === ifName && i.parent)
        if (idx === -1) return [`% Subinterface ${ifName} not found`]
        device.interfaces.splice(idx, 1)
        // Exit subif_config if we just deleted the active subinterface
        if (device.active_interface === ifName) {
          device.active_interface = null
          device.config_mode = 'global_config'
        }
        return []
      }

      return this._invalidInput()
    }

    // `no vlan <id>` — remove VLAN from switch database
    if (sub === 'vlan') {
      if (mode !== 'global_config') return this._invalidInput()
      if (device.type !== 'switch') return this._invalidInput()
      const vid = parseInt(tokens[2], 10)
      if (isNaN(vid) || vid < 1 || vid > 4094) return ['% Incomplete command.  Usage: no vlan <1-4094>']
      delete device.vlan_db[vid]
      return []
    }

    // `no firewall-rule <id>` — remove a rule by ID; clears stale sessions (firewall only)
    if (sub === 'firewall-rule') {
      if (mode !== 'global_config') return this._invalidInput()
      if (device.type !== 'firewall') return this._invalidInput()
      const ruleId = parseInt(tokens[2], 10)
      if (isNaN(ruleId)) return ['% Incomplete command.  Usage: no firewall-rule <rule-id>']
      const lenBefore = device.fw_rules.length
      device.fw_rules = device.fw_rules.filter(r => r.id !== ruleId)
      if (device.fw_rules.length === lenBefore) return [`% Rule ${ruleId} not found`]
      if (!device.fw_sessions) device.fw_sessions = []
      device.fw_sessions = []  // changing rules invalidates established sessions
      return []
    }

    // `no nameif` — remove zone assignment from interface (interface_config, firewall only)
    if (sub === 'nameif') {
      if (mode !== 'interface_config') return this._invalidInput()
      if (device.type !== 'firewall') return this._invalidInput()
      const iface = device.getInterface(device.active_interface)
      if (!iface) return ['% No active interface']
      if (device.fw_zones) delete device.fw_zones[iface.name]
      return []
    }

    return this._invalidInput()
  }

  // ── dhcp-config mode commands ──────────────────────────────────────────────
  _cmdDhcpPool(device, cmd, tokens) {
    // Universal commands still work inside dhcp_pool_config
    if (cmd === 'exit') return this._cmdExit(device)
    if (cmd === 'end')  return this._cmdEnd(device)
    if (cmd === '?' || cmd === 'help') return [
      '  network <network> <mask>     Pool subnet (e.g. network 192.168.1.0 255.255.255.0)',
      '  default-router <ip>          Default gateway for DHCP clients',
      '  dns-server <ip>              DNS server for DHCP clients',
      '  lease <days> [hours] [min]   Lease duration (default: 1 0 0)',
      '  no network                   Clear pool subnet',
      '  no default-router            Clear default gateway',
      '  no dns-server                Clear DNS server',
      '  exit                         Return to global config',
    ]
    if (cmd === 'do') {
      if (!tokens[1]) return ['% Incomplete command.  Usage: do <exec-command>']
      const origMode = device.config_mode
      device.config_mode = 'priv_exec'
      try { return this._dispatch(device, tokens[1].toLowerCase(), tokens.slice(1)) || [] }
      finally { device.config_mode = origMode }
    }

    const pool = device.dhcp_pools?.find(p => p.name === device.active_dhcp_pool)
    if (!pool) return ['% Error: active DHCP pool not found']

    if (cmd === 'network') {
      const net = tokens[1], mask = tokens[2]
      if (!net || !mask) return ['% Incomplete command.  Usage: network <network> <mask>']
      if (!isValidIp(net))     return [`% Invalid network: ${net}`]
      if (!isValidMask(mask))  return [`% Invalid mask: ${mask}`]
      pool.network = networkAddress(net, mask)
      pool.mask = mask
      return []
    }

    if (cmd === 'default-router') {
      const ip = tokens[1]
      if (!ip || !isValidIp(ip)) return ['% Incomplete command.  Usage: default-router <ip>']
      pool.default_router = ip
      return []
    }

    if (cmd === 'dns-server') {
      const ip = tokens[1]
      if (!ip || !isValidIp(ip)) return ['% Incomplete command.  Usage: dns-server <ip>']
      pool.dns_server = ip
      return []
    }

    if (cmd === 'lease') {
      const days = parseInt(tokens[1], 10)
      if (isNaN(days) || days < 0) return ['% Incomplete command.  Usage: lease <days> [<hours>] [<minutes>]']
      pool.lease_days  = days
      pool.lease_hours = parseInt(tokens[2] ?? '0', 10) || 0
      pool.lease_mins  = parseInt(tokens[3] ?? '0', 10) || 0
      return []
    }

    if (cmd === 'no') {
      const sub = tokens[1]?.toLowerCase()
      if (sub === 'network')        { pool.network = null; pool.mask = null; return [] }
      if (sub === 'default-router') { pool.default_router = null; return [] }
      if (sub === 'dns-server')     { pool.dns_server = null; return [] }
      return this._invalidInput()
    }

    return this._invalidInput()
  }

  _cmdHelp(device) {
    const mode = device.config_mode
    const d    = this.difficulty

    if (d === 'networkEngineer') {
      const cmds = {
        user_exec:        ['enable', 'ping', 'exit', 'help', 'man'],
        priv_exec:        ['configure', 'show', 'ping', 'disable', 'exit', 'end', 'help', 'man'],
        global_config:    ['hostname', 'interface', 'ip', 'no', 'exit', 'end', 'help', 'man'],
        interface_config: ['ip', 'shutdown', 'no', 'exit', 'end', 'help', 'man'],
      }
      return (cmds[mode] || []).map(c => `  ${c}`)
    }

    // beginner / advanced — descriptive help
    const cmds = {
      user_exec: [
        '  enable                     Enter privileged exec mode',
        '  ping <ip-address>          Test reachability to a host',
        '  exit                       Exit current mode',
      ],
      priv_exec: [
        '  configure terminal         Enter global configuration mode',
        '  show running-config        Display current device configuration',
        '  show ip interface brief    Show interface status and IPs',
        '  show ip route              Show the routing table',
        '  ping <ip-address>          Test reachability to a host',
        '  disable                    Return to user exec mode',
        '  exit / end                 Exit current mode',
      ],
      global_config: device.type === 'switch' ? [
        '  hostname <name>            Set the device hostname',
        '  interface <name>           Enter interface configuration mode',
        '  interface vlan <id>        Create/enter SVI (management interface)',
        '  vlan <id>                  Create a VLAN in the VLAN database',
        '  exit / end                 Return to privileged exec mode',
      ] : [
        '  hostname <name>            Set the device hostname',
        '  interface <name>           Enter interface configuration mode',
        '  ip route <net> <mask> <gw> Add a static route',
        '  no ip route <net> <mask>   Remove a static route',
        '  exit / end                 Return to privileged exec mode',
      ],
      interface_config: [
        '  description <text>         Add a label to this interface (e.g. "WAN link to R2")',
        '  ip address <ip> <mask>     Assign an IP address to this interface',
        '  no ip address              Remove the IP address',
        '  no shutdown                Bring this interface up (enable it)',
        '  shutdown                   Shut this interface down',
        '  no description             Clear the interface description',
        '  exit                       Return to global config mode',
      ],
    }

    const lines = cmds[mode] || []

    if (d === 'advanced') {
      const tips = {
        user_exec:        '  Tip: Type "enable" to access configuration commands.',
        priv_exec:        '  Tip: Use "configure terminal" then "interface <name>" to assign IPs.',
        global_config:    '  Tip: After "interface <name>", use "ip address" then "no shutdown".',
        interface_config: '  Tip: Set IP with "ip address", then bring it up with "no shutdown".',
      }
      if (tips[mode]) return [...lines, '', tips[mode]]
    }

    return lines
  }

  _cmdMan(tokens) {
    const subject = tokens[1]?.toLowerCase()
    const d       = this.difficulty

    const manPages = {
      ping: {
        synopsis: 'ping <ip-address>',
        desc:     'Send ICMP echo requests to a remote host and report reachability.',
        beginner: [
          '  Examples:',
          '    Router# ping 192.168.1.1',
          '',
          '  Tip: Make sure both source and destination interfaces are "up" and',
          '       in the same subnet. If it fails, check "show ip interface brief".',
        ],
        advanced: [
          '  Examples:',
          '    Router# ping 192.168.1.1',
          '',
          '  Troubleshooting:',
          '    1. Check "show ip interface brief" — both interfaces must be up',
          '    2. Verify both IPs are in the same subnet',
          '    3. If routing across subnets, check "show ip route"',
        ],
      },
      interface: {
        synopsis: 'interface <interface-name>',
        desc:     'Enter interface configuration mode for the specified port.',
        beginner: [
          '  Examples:',
          '    Router(config)# interface GigabitEthernet0/0',
          '    Router(config-if)# ip address 192.168.1.1 255.255.255.0',
          '    Router(config-if)# no shutdown',
          '',
          '  Tip: You must "no shutdown" after assigning an IP to bring the link up.',
        ],
        advanced: [
          '  Examples:',
          '    Router(config)# interface GigabitEthernet0/0',
          '  Then inside interface mode:',
          '    ip address <ip> <mask>  — assign IP',
          '    no shutdown             — enable the interface',
        ],
      },
      'ip': {
        synopsis: 'ip address <ip> <subnet-mask>  |  ip route <net> <mask> <gateway>',
        desc:     'Assign an IP address to the active interface, or add a static route.',
        beginner: [
          '  Examples:',
          '    Router(config-if)# ip address 192.168.1.1 255.255.255.0',
          '    Router(config)#    ip route 0.0.0.0 0.0.0.0 10.0.0.1',
          '',
          '  Tip: Use 255.255.255.0 for a /24 subnet.',
        ],
        advanced: [
          '  ip address <ip> <mask>  — use inside interface config mode',
          '  ip route <net> <mask> <next-hop>  — use in global config mode',
          '  For a default route: ip route 0.0.0.0 0.0.0.0 <gateway>',
        ],
      },
      show: {
        synopsis: 'show { running-config | ip interface brief | ip route }',
        desc:     'Display device state and configuration.',
        beginner: [
          '  show running-config       — full device config',
          '  show ip interface brief   — quick interface status table',
          '  show ip route             — routing table',
        ],
        advanced: [
          '  show ip interface brief   — check interface status (up/down/admin down)',
          '  show ip route             — verify routes are installed',
          '  show running-config       — verify IP address configuration',
        ],
      },
    }

    if (!subject || !manPages[subject]) {
      const available = Object.keys(manPages).join(', ')
      return [`man: available topics: ${available}`]
    }

    const page = manPages[subject]
    const lines = [
      `SYNOPSIS`,
      `  ${page.synopsis}`,
      '',
      `DESCRIPTION`,
      `  ${page.desc}`,
      '',
    ]

    if (d === 'networkEngineer') return lines
    lines.push(...(d === 'advanced' ? page.advanced : page.beginner))
    return lines
  }

  // ── switchport ─────────────────────────────────────────────────────────────
  _cmdSwitchport(device, iface, tokens) {
    const sub = tokens[1]?.toLowerCase()
    if (!sub) return ['% Incomplete command.  Usage: switchport mode {access|trunk}']

    if (sub === 'mode') {
      const m = tokens[2]?.toLowerCase()
      if (m === 'access') { iface.switchport_mode = 'access'; return [] }
      if (m === 'trunk')  { iface.switchport_mode = 'trunk';  return [] }
      return [`% Invalid input detected at '^' marker.`]
    }

    if (sub === 'access') {
      if (tokens[2]?.toLowerCase() === 'vlan') {
        const vid = parseInt(tokens[3], 10)
        if (isNaN(vid) || vid < 1 || vid > 4094) return [`% Invalid VLAN ID: ${tokens[3]}`]
        iface.vlan = vid
        return []
      }
      return ['% Incomplete command.  Usage: switchport access vlan <vlan-id>']
    }

    if (sub === 'trunk') {
      const subsub = tokens[2]?.toLowerCase()
      if (subsub === 'allowed' && tokens[3]?.toLowerCase() === 'vlan') {
        iface.trunk_vlans = tokens[4] ?? 'all'
        return []
      }
      if (subsub === 'native' && tokens[3]?.toLowerCase() === 'vlan') {
        const vid = parseInt(tokens[4], 10)
        if (!isNaN(vid) && vid >= 1 && vid <= 4094) { iface.native_vlan = vid; return [] }
      }
      return ['% Incomplete command.']
    }

    return this._invalidInput()
  }

  // ── show vlan brief ────────────────────────────────────────────────────────
  _showVlanBrief(device) {
    const vlanPorts = {}
    for (const iface of device.interfaces) {
      if (iface.svi) continue
      // Trunk ports carry multiple VLANs — they do NOT belong to a single VLAN in
      // show vlan brief. Only access ports are listed under their VLAN's port column.
      if (iface.switchport_mode === 'trunk') continue
      const vid = String(iface.vlan ?? 1)
      if (!vlanPorts[vid]) vlanPorts[vid] = []
      // VLAN membership is a config fact, not a link-state fact — list the port
      // regardless of whether its link is up, down, or nothing is connected.
      vlanPorts[vid].push(iface.name.replace('FastEthernet', 'Fa').replace('GigabitEthernet', 'Gi'))
    }
    if (!vlanPorts['1']) vlanPorts['1'] = []  // VLAN 1 always present
    // Include VLANs created with `vlan <id>` even if no ports are assigned yet
    for (const vid of Object.keys(device.vlan_db)) {
      if (!vlanPorts[vid]) vlanPorts[vid] = []
    }

    const L = [
      'VLAN Name                             Status    Ports',
      '---- -------------------------------- --------- -------------------------------',
    ]
    for (const vid of Object.keys(vlanPorts).sort((a, b) => parseInt(a) - parseInt(b))) {
      const dbEntry = device.vlan_db?.[parseInt(vid)]
      const name    = dbEntry?.name ?? (vid === '1' ? 'default' : `VLAN${String(vid).padStart(4, '0')}`)
      const ports   = vlanPorts[vid]
      // Real IOS shows 'active' for all configured VLANs — 'act/lshut' is only when a
      // VLAN is explicitly suspended (not modelled here). No ports ≠ lshut.
      L.push(vid.padEnd(5) + name.padEnd(33) + 'active    ' + ports.join(', '))
    }
    return L
  }

  // ── show interfaces trunk ─────────────────────────────────────────────────
  _showInterfacesTrunk(device) {
    const trunks = device.interfaces.filter(
      i => !i.svi && !i.parent && i.switchport_mode === 'trunk' && i.status === 'up'
    )
    if (trunks.length === 0) return ['(No trunk interfaces currently active)']
    const shortName = n => n.replace('GigabitEthernet', 'Gi').replace('FastEthernet', 'Fa')
    const L = [
      'Port        Mode             Encapsulation  Status        Native vlan',
      ...trunks.map(i =>
        shortName(i.name).padEnd(12) +
        'on'.padEnd(17) +
        '802.1q'.padEnd(15) +
        'trunking'.padEnd(14) +
        String(i.native_vlan ?? 1)
      ),
      '',
      'Port        Vlans allowed on trunk',
      ...trunks.map(i =>
        shortName(i.name).padEnd(12) + (i.trunk_vlans ?? 'all')
      ),
    ]
    return L
  }

  _invalidInput() {
    return ["% Invalid input detected at '^' marker."]
  }

  // ── Tab completion ──────────────────────────────────────────────────────────
  // Returns { newInput: string, completions: string[] }
  complete(device, input) {
    const trailingSpace = input.endsWith(' ')
    const tokens = input.trim().split(/\s+/).filter(Boolean)
    const mode = device.config_mode

    const partial = trailingSpace ? '' : (tokens[tokens.length - 1] || '')
    const base = trailingSpace
      ? tokens.join(' ') + ' '
      : tokens.slice(0, -1).join(' ') + (tokens.length > 1 ? ' ' : '')

    let candidates
    if (tokens.length === 0 || (!trailingSpace && tokens.length === 1)) {
      candidates = _modesCommands(mode, device)
    } else {
      const cmd = tokens[0].toLowerCase()
      const filled = trailingSpace ? tokens.slice(1) : tokens.slice(1, -1)
      candidates = _iosSubCandidates(device, mode, cmd, filled)
    }

    const matches = candidates.filter(c => c.toLowerCase().startsWith(partial.toLowerCase()))
    if (matches.length === 0) return { newInput: input, completions: [] }

    const common = _commonPrefix(matches)
    if (matches.length === 1) return { newInput: base + matches[0] + ' ', completions: [] }
    if (common.length > partial.length) return { newInput: base + common, completions: matches }
    return { newInput: input, completions: matches }
  }
}

// Returns true if at least one port carrying vlanId is up — the condition that
// brings a VLAN SVI up on real Cisco IOS.
// Trunk ports must explicitly carry the VLAN (via trunk_vlans list); a trunk that
// only carries VLANs 1,20 does NOT bring up the VLAN 10 SVI.
function _sviPortIsUp(device, vlanId) {
  return device.interfaces.some(i => {
    if (i.svi || i.status !== 'up') return false
    if (i.switchport_mode === 'trunk') return _vlanAllowed(i.trunk_vlans, vlanId)
    return (i.vlan ?? 1) === vlanId
  })
}

// Recalculate status for all SVIs that have been no-shutdown'd.
// Called after any physical port state change on a switch.
// Keep in sync with _refreshSvis in Topology.js.
function _refreshSvis(device) {
  for (const iface of device.interfaces) {
    if (!iface.svi || iface.status === 'admin_down') continue
    iface.status = _sviPortIsUp(device, iface.vlan) ? 'up' : 'down'
  }
}

// Mirror of _vlanAllowed from Topology.js — checks whether a vlanId is permitted
// on a trunk port. Must stay in sync with Topology.js's copy.
function _vlanAllowed(trunkVlans, vlanId) {
  if (!trunkVlans || trunkVlans === 'all') return true
  for (const part of String(trunkVlans).split(',')) {
    if (part.includes('-')) {
      const [lo, hi] = part.split('-').map(Number)
      if (vlanId >= lo && vlanId <= hi) return true
    } else if (parseInt(part, 10) === vlanId) return true
  }
  return false
}

// Select the source IP for a ping by finding which interface the router would use
// to forward traffic toward dstIp (connected-route or static-route lookup), then
// using that interface's IP.  Fallback: first up interface with an IP.
// This matches IOS behavior — source IP = outgoing interface IP, not always eth0.
function _getSrcIp(topology, device, dstIp) {
  const exits = topology._findExitInterfaces(device, dstIp)
  for (const iface of exits) {
    if (iface.ip) return iface.ip
  }
  return device.interfaces.find(i => i.status === 'up' && i.ip)?.ip ?? null
}

// Map checkPing failureReason enum to human-readable IOS error strings.
function _iosFailureMsg(failureReason) {
  switch (failureReason) {
    case 'admin_down':       return 'Source interface is administratively down'
    case 'link_down':        return 'Network is unreachable'
    case 'no_route':         return 'Network is unreachable'
    case 'host_no_gateway':  return 'Network is unreachable'
    case 'no_return_path':   return 'Request timed out (no return path configured)'
    case 'vlan_isolated':    return 'Destination host unreachable (VLAN boundary)'
    case 'gateway_unreachable': return 'Destination host unreachable'
    case 'subnet_mismatch':  return 'Destination host unreachable (subnet mismatch)'
    case 'nat_required':         return 'Destination host unreachable (NAT required — private source address is not internet-routable)'
    case 'blocked_by_firewall': return 'Destination host unreachable (packet blocked by firewall policy — check zone rules and ensure return path is permitted)'
    default: return failureReason ?? null
  }
}

function _modesCommands(mode, device) {
  const isSw = device?.type === 'switch'
  switch (mode) {
    case 'user_exec':        return ['enable', 'ping', 'traceroute', 'show', 'exit', 'help', 'man']
    case 'priv_exec':        return ['configure', 'show', 'ping', 'traceroute', 'write', 'copy', 'disable', 'exit', 'end', 'help', 'man']
    case 'global_config':    return isSw
        ? ['hostname', 'interface', 'vlan', 'no', 'exit', 'end', 'help', 'man']
        : ['hostname', 'interface', 'ip', 'access-list', 'no', 'exit', 'end', 'help', 'man']
    case 'vlan_config':      return ['name', 'exit', 'end', 'help']
    case 'dhcp_pool_config': return ['network', 'default-router', 'dns-server', 'lease', 'no', 'exit', 'end', 'help']
    case 'interface_config': {
      if (isSw) {
        const onSvi = device?.active_interface?.startsWith('Vlan')
        return onSvi
          ? ['description', 'ip', 'shutdown', 'no', 'exit', 'end', 'help', 'man']
          : ['description', 'switchport', 'shutdown', 'no', 'exit', 'end', 'help', 'man']
      }
      return ['description', 'ip', 'shutdown', 'no', 'exit', 'end', 'help', 'man']
    }
    case 'subif_config':
      return ['description', 'encapsulation', 'ip', 'shutdown', 'no', 'exit', 'end', 'help', 'man']
    default: return []
  }
}

function _iosSubCandidates(device, mode, cmd, filled) {
  const depth = filled.length
  const a0 = filled[0]?.toLowerCase()
  const a1 = filled[1]?.toLowerCase()
  const isSw = device?.type === 'switch'

  if (cmd === 'configure' || cmd === 'conf') {
    if (depth === 0) return ['terminal']
  }
  if (cmd === 'show' || cmd === 'sh') {
    if (depth === 0) return isSw
      ? ['running-config', 'interfaces', 'ip', 'vlan', 'mac-address-table', 'arp', 'version']
      : ['running-config', 'interfaces', 'ip', 'arp', 'version']
    if (depth === 1 && a0 === 'ip') return device?.type === 'router' ? ['interface', 'route', 'dhcp', 'nat'] : ['interface', 'route']
    if (depth === 2 && a0 === 'ip' && a1 === 'dhcp') return ['binding', 'pool']
    if (depth === 2 && a0 === 'ip' && a1 === 'nat') return ['translations', 'statistics']
    if (depth === 2 && a0 === 'ip' && a1 === 'interface') return ['brief']
    if (depth === 1 && a0 === 'vlan') return ['brief']
    if (depth === 1 && (a0 === 'interfaces' || a0 === 'int')) {
      return device.interfaces.map(i => i.name)
    }
  }
  if (cmd === 'write' || cmd === 'wr') {
    if (depth === 0) return ['memory']
  }
  if (cmd === 'copy') {
    if (depth === 0) return ['running-config']
    if (depth === 1 && a0 === 'running-config') return ['startup-config']
  }
  if (cmd === 'do') {
    if (depth === 0) return ['show', 'ping', 'write']
    if (a0 === 'show') return _iosSubCandidates(device, 'priv_exec', 'show', filled.slice(1))
  }
  if (cmd === 'interface' || cmd === 'int') {
    if (depth === 0) {
      const physical = device.interfaces.filter(i => !i.svi).map(i => i.name)
      return isSw ? [...physical, 'vlan'] : physical
    }
    if (isSw && depth === 1 && a0 === 'vlan') return ['<vlan-id>']
  }
  if (cmd === 'vlan') {
    if (depth === 0) return ['<1-4094>']
  }
  if (cmd === 'name') {
    if (depth === 0) return ['<vlan-name>']
  }
  if (cmd === 'encapsulation') {
    if (depth === 0) return ['dot1Q']
    if (depth === 1) return ['<vlan-id>']
  }
  if (cmd === 'ip') {
    if (isSw) {
      const activeSvi = device.getInterface?.(device.active_interface)?.svi
      if (mode === 'interface_config' && activeSvi) return ['address']
      return []
    }
    if (depth === 0) {
      if (mode === 'interface_config') return ['address', 'helper-address', 'nat']
      if (mode === 'subif_config') return ['address']
      return ['route', 'dhcp', 'nat']
    }
    if (depth === 1 && a0 === 'dhcp') return ['excluded-address', 'pool']
    if (depth === 1 && a0 === 'helper-address') return ['<ip-address>']
    if (depth === 1 && a0 === 'nat') return ['inside', 'outside']
    if (depth === 2 && a0 === 'nat' && filled[1]?.toLowerCase() === 'inside' && mode === 'global_config')
      return ['source']
  }
  if (cmd === 'access-list') {
    if (depth === 0) return ['<1-99>']
    if (depth === 1) return ['permit']
    if (depth === 2) return ['<network>']
    if (depth === 3) return ['<wildcard>']
  }
  if (cmd === 'switchport') {
    if (depth === 0) return ['mode', 'access', 'trunk']
    if (a0 === 'mode')   return ['access', 'trunk']
    if (a0 === 'access') return ['vlan']
    if (a0 === 'trunk')  return ['allowed', 'native']
    if (a0 === 'allowed') return ['vlan']
    if (a0 === 'native')  return ['vlan']
  }
  if (cmd === 'no') {
    if (depth === 0) {
      if (isSw) return mode === 'interface_config' ? ['shutdown', 'description'] : ['vlan', 'interface']
      if (mode === 'interface_config' || mode === 'subif_config') return ['shutdown', 'ip', 'description', 'encapsulation']
      return ['ip', 'access-list', 'interface']
    }
    if (depth === 1 && a0 === 'ip') {
      if (mode === 'interface_config' || mode === 'subif_config') return ['address', 'nat']
      return ['route', 'dhcp', 'nat']
    }
    if (depth === 2 && a0 === 'ip' && filled[1]?.toLowerCase() === 'nat') return ['inside', 'outside']
    if (depth === 1 && a0 === 'access-list') return ['<1-99>']
  }
  if (cmd === 'description') {
    if (depth === 0) return ['<description-text>']
  }
  if (cmd === 'hostname') {
    if (depth === 0) return ['<name>']
  }
  if (cmd === 'ping') {
    if (depth === 0) return ['<ip-address>']
  }
  return []
}

// Named firewall services — must match the NAMED_SERVICES table in Topology.js exactly.
// These are real IANA well-known ports; accuracy matters here.
const FW_NAMED_SERVICES = new Set(['HTTP', 'HTTPS', 'SSH', 'DNS', 'FTP', 'TELNET', 'RDP', 'SMTP'])

// Returns true when str is a valid service specifier: 'any', 'icmp', a named service,
// or a raw proto/port string (tcp/443, udp/53).
function _isValidFwService(str) {
  if (!str) return false
  const lo = str.toLowerCase()
  if (lo === 'any' || lo === 'icmp') return true
  if (FW_NAMED_SERVICES.has(str.toUpperCase())) return true
  const slash = str.indexOf('/')
  if (slash !== -1) {
    const proto = str.slice(0, slash).toLowerCase()
    const port  = parseInt(str.slice(slash + 1), 10)
    if ((proto === 'tcp' || proto === 'udp') && !isNaN(port) && port > 0 && port <= 65535)
      return true
  }
  return false
}

// Parse keyword-value pairs from a `firewall-rule` argument list.
// Recognises: from-zone, to-zone, src, dst, service (order-independent).
function _parseFirewallRuleTokens(tokens) {
  const result = {}
  for (let i = 0; i < tokens.length; i++) {
    const kw = tokens[i]?.toLowerCase()
    if (kw === 'from-zone') { result.fromZone = tokens[i + 1]; i++; continue }
    if (kw === 'to-zone')   { result.toZone   = tokens[i + 1]; i++; continue }
    if (kw === 'src')       { result.src       = tokens[i + 1]; i++; continue }
    if (kw === 'dst')       { result.dst       = tokens[i + 1]; i++; continue }
    if (kw === 'service')   { result.service   = tokens[i + 1]; i++; continue }
  }
  return result
}

// Return the number of usable host addresses in a DHCP pool (network+1 … broadcast-1)
function _poolHostCount(pool) {
  if (!pool.network || !pool.mask) return 0
  const maskNum = _ipToNum(pool.mask)
  const hostBits = (~maskNum) >>> 0
  return Math.max(0, hostBits - 1)
}

function _ipToNum(ip) {
  if (!ip) return 0
  return ip.split('.').reduce((acc, o) => ((acc << 8) | parseInt(o, 10)) >>> 0, 0)
}

function _commonPrefix(strs) {
  if (!strs.length) return ''
  return strs.reduce((prefix, s) => {
    while (s.toLowerCase().indexOf(prefix.toLowerCase()) !== 0 && prefix.length > 0)
      prefix = prefix.slice(0, -1)
    return prefix
  })
}

function _statusProto(status) {
  switch (status) {
    case 'up':         return ['up', 'up']
    case 'down':       return ['down', 'down']
    case 'admin_down': return ['administratively down', 'down']
    default:           return ['unknown', 'unknown']
  }
}
