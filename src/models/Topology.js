import { isValidIp, networkAddress, maskToPrefixLen, ipToNum } from './ipUtils.js'
import { refreshSubifs } from './Device.js'

export class Topology {
  constructor() {
    this.devices = new Map() // deviceId -> Device
    this.pingLog = new Set() // 'srcIp:dstIp' — pings actually run by the user in terminal
  }

  addDevice(device) {
    this.devices.set(device.id, device)
  }

  removeDevice(deviceId) {
    const device = this.devices.get(deviceId)
    if (!device) return
    for (const iface of device.interfaces) {
      if (iface.connected_to) this.disconnect(`${device.id}:${iface.name}`)
    }
    this.devices.delete(deviceId)
  }

  // Wipe all devices and ping history (used after mission completion).
  clearDevices() {
    this.devices.clear()
    this.pingLog.clear()
  }

  // Record that the user actually ran a ping command and it succeeded.
  logPing(srcIp, dstIp) {
    this.pingLog.add(`${srcIp}:${dstIp}`)
    // Also record reverse so either direction satisfies task checks.
    this.pingLog.add(`${dstIp}:${srcIp}`)
  }

  // ifaceId format: "dev-1:GigabitEthernet0/0"
  connect(ifaceId1, ifaceId2) {
    const iface1 = this._resolveIface(ifaceId1)
    const iface2 = this._resolveIface(ifaceId2)
    if (!iface1 || !iface2) return false
    if (iface1.connected_to || iface2.connected_to) return false // already cabled

    iface1.connected_to = ifaceId2
    iface2.connected_to = ifaceId1

    // Bring up both ends only when neither is admin_down.
    // admin_down means the player explicitly issued `shutdown` — that is sticky and must
    // survive cable events.  'down' means "no cable/no carrier" and auto-recovers.
    // A switch port connected to an admin_down peer shows 'down' (no carrier signal).
    const dev1 = this.devices.get(ifaceId1.slice(0, ifaceId1.indexOf(':')))
    const dev2 = this.devices.get(ifaceId2.slice(0, ifaceId2.indexOf(':')))
    if (iface1.status !== 'admin_down' && iface2.status !== 'admin_down') {
      iface1.status = 'up'
      iface2.status = 'up'
    } else {
      // At least one side is admin_down — the other side gets 'down' (no carrier)
      if (iface1.status !== 'admin_down') iface1.status = 'down'
      if (iface2.status !== 'admin_down') iface2.status = 'down'
    }
    if (dev1?.type === 'switch') _refreshSvis(dev1)
    if (dev2?.type === 'switch') _refreshSvis(dev2)
    // If either side is a router, refresh its subinterfaces (their status depends on parent up/down)
    if (dev1?.type === 'router') refreshSubifs(dev1)
    if (dev2?.type === 'router') refreshSubifs(dev2)
    return true
  }

  disconnect(ifaceId) {
    const iface = this._resolveIface(ifaceId)
    if (!iface) return
    const localDevId = ifaceId.slice(0, ifaceId.indexOf(':'))
    const localDev = this.devices.get(localDevId)
    let remoteDev = null
    if (iface.connected_to) {
      const remoteDevId = iface.connected_to.slice(0, iface.connected_to.indexOf(':'))
      remoteDev = this.devices.get(remoteDevId)
      const remote = this._resolveIface(iface.connected_to)
      if (remote) {
        remote.connected_to = null
        if (remote.status === 'up') remote.status = 'down'
      }
    }
    iface.connected_to = null
    if (iface.status === 'up') iface.status = 'down'
    if (localDev?.type === 'switch') _refreshSvis(localDev)
    if (remoteDev?.type === 'switch') _refreshSvis(remoteDev)
    if (localDev?.type === 'router') refreshSubifs(localDev)
    if (remoteDev?.type === 'router') refreshSubifs(remoteDev)
  }

  // Called by CLI engines when an interface is shut down (IOS `shutdown`) or
  // brought admin_down (Linux `ip link set down`).  Propagates carrier-loss to
  // the directly connected peer interface — real hardware drops carrier to the
  // peer the instant the local port goes admin_down.
  // Also refreshes SVIs on the peer device if it is a switch, because losing
  // an access port can take a VLAN SVI down.
  shutdownPeer(ifaceId) {
    const remIface = this._resolveIface(ifaceId)
    if (!remIface || remIface.status !== 'up') return
    remIface.status = 'down'
    const remDev = this._getDeviceByIfaceId(ifaceId)
    if (remDev?.type === 'switch') _refreshSvis(remDev)
    if (remDev?.type === 'router') refreshSubifs(remDev)
  }

  // Check whether a flow from srcIp to dstIp would succeed by walking the graph.
  // service = { protocol, port } specifies the traffic type for firewall rule matching.
  // Defaults to ICMP (the original ping command) — all existing callers are unaffected.
  // Protocol: 'icmp' | 'tcp' | 'udp' | 'any'.  Port: integer or null.
  // Returns a rich result object (see _pingResult) used by CLI `ping` and mission checks.
  checkPing(srcIp, dstIp, service = { protocol: 'icmp', port: null }) {
    if (!isValidIp(srcIp) || !isValidIp(dstIp)) {
      return _pingResult(false, 'no_route', null)
    }
    if (srcIp === dstIp) return _pingResult(true, null, null)

    // Loopback (127.x.x.x) always replies if the source interface is up — no path needed
    if (dstIp.startsWith('127.')) {
      let srcUp = false
      for (const dev of this.devices.values()) {
        if (dev.interfaces.some(i => i.ip === srcIp && i.status === 'up')) { srcUp = true; break }
      }
      return _pingResult(srcUp, srcUp ? null : 'link_down', null)
    }

    // Locate source device and capture interface state even if not up
    let srcDevice = null, srcIfStatus = null
    outer:
    for (const dev of this.devices.values()) {
      for (const iface of dev.interfaces) {
        if (iface.ip === srcIp) {
          srcIfStatus = iface.status
          if (iface.status === 'up') srcDevice = dev
          break outer
        }
      }
    }

    if (!srcDevice) {
      if (srcIfStatus === 'admin_down') return _pingResult(false, 'admin_down', null)
      if (srcIfStatus === 'down')       return _pingResult(false, 'link_down', null)
      return _pingResult(false, 'no_route', null)
    }

    // Forward path BFS
    const fwd = this._bfsReach(srcDevice, dstIp, srcIp, false, service)
    if (!fwd.reachable) {
      // vlan_isolated from BFS propagates directly — no further refinement needed.
      if (fwd.failureReason === 'vlan_isolated')
        return _pingResult(false, 'vlan_isolated', fwd.failurePoint)

      // Post-BFS refinements for PC/server when BFS returned 'no_route'.
      // Routers, and any failure reason other than no_route, are left unchanged.
      if (fwd.failureReason === 'no_route' &&
          (srcDevice.type === 'pc' || srcDevice.type === 'server')) {
        const upIfaces = srcDevice.interfaces.filter(i => i.status === 'up' && i.ip && i.subnet_mask)
        const dstIsLocal = upIfaces.some(iface =>
          networkAddress(dstIp, iface.subnet_mask) === networkAddress(iface.ip, iface.subnet_mask)
        )
        if (dstIsLocal) {
          // Src thinks dst is on the same subnet — BFS failed only because of VLAN
          // isolation at the switch (or no physical path at all).
          const vlanIsolated = _checkVlanIsolation(srcDevice, srcIp, dstIp, this)
          if (vlanIsolated) return _pingResult(false, 'vlan_isolated', null)
          return _pingResult(false, 'no_route', null)
        }
        // Dst is off-subnet from src's perspective.
        // subnet_mismatch: dst is up, and from dst's own mask src falls in the same subnet.
        const dstDev = this._findDeviceByIp(dstIp)
        if (dstDev) {
          const dstIface = dstDev.interfaces.find(
            i => i.ip === dstIp && i.status === 'up' && i.subnet_mask
          )
          if (dstIface &&
              networkAddress(srcIp, dstIface.subnet_mask) === networkAddress(dstIp, dstIface.subnet_mask)) {
            return _pingResult(false, 'subnet_mismatch', null)
          }
        }
        // host_no_gateway: dst is off all connected subnets and there is no
        // default route with a next-hop reachable via a connected subnet.
        const hasUsableGateway = srcDevice.routing_table.some(r =>
          r.network === '0.0.0.0' && r.mask === '0.0.0.0' &&
          upIfaces.some(iface =>
            networkAddress(r.next_hop, iface.subnet_mask) === networkAddress(iface.ip, iface.subnet_mask)
          )
        )
        if (!hasUsableGateway) return _pingResult(false, 'host_no_gateway', null)
      }
      return _pingResult(false, fwd.failureReason, fwd.failurePoint)
    }

    // Return path BFS — a real ping fails if the reply can't get back.
    // isReturnPath=true so the firewall session check uses directional lookup
    // (the session was recorded as {srcIp→dstIp}; return BFS looks it up as
    // {dstIp→srcIp} from the session's perspective).
    const dstDevice = this._findDeviceByIp(dstIp)
    if (dstDevice) {
      const ret = this._bfsReach(dstDevice, srcIp, dstIp, true, service)
      if (!ret.reachable) return _pingResult(false, 'no_return_path', ret.failurePoint)
    }

    return _pingResult(true, null, null)
  }

  // BFS from srcDevice looking for an interface owning dstIp.
  // srcIp is used to determine the starting VLAN when srcDevice is a switch (SVI ping).
  // isReturnPath signals that this BFS is the reply direction of an already-established
  // flow, not a new initiation.  The firewall stateful session lookup uses this flag to
  // distinguish "allowed return traffic" (session initiated in the other direction) from
  // "new unsolicited inbound" (which must match a rule, not just exist in the session table).
  // service = { protocol, port } is the traffic descriptor for firewall rule / session matching.
  _bfsReach(srcDevice, dstIp, srcIp = null, isReturnPath = false, service = { protocol: 'icmp', port: null }) {
    const visited = new Set()
    const startVlan = _getStartVlan(srcDevice, srcIp)
    const queue = [{ device: srcDevice, ingressVlan: startVlan, ingressIfaceId: null }]
    let vlanBlocked = false  // set when VLAN boundary blocks progress
    let fwBlocked = false    // set when firewall policy drops a packet
    let fwBlockedAt = null   // device id where the firewall dropped it

    while (queue.length > 0) {
      const { device, ingressVlan, ingressIfaceId } = queue.shift()
      // Switches can be visited multiple times with different VLAN contexts (different
      // L2 forwarding domains).  Non-switch devices (routers, PCs) are visited once.
      const visitKey = device.type === 'switch'
        ? `${device.id}:${ingressVlan}`
        : device.id
      if (visited.has(visitKey)) continue
      visited.add(visitKey)

      // ISP device routes to any IP not assigned locally (the internet)
      if (device.type === 'isp') {
        const isLocal = [...this.devices.values()].some(d =>
          d.interfaces.some(i => i.ip === dstIp)
        )
        if (!isLocal) return { reachable: true }
      }

      // ROAS: when a tagged frame arrives at a router via a trunk (ingressVlan set),
      // the router must have a subinterface whose encapsulation dot1Q matches that tag
      // and is up.  Without a match, the frame is discarded at L2/L3 boundary.
      if (ingressVlan !== null && device.type === 'router') {
        const accepted = device.interfaces.some(i =>
          i.parent && i.vlanTag === ingressVlan && i.status === 'up'
        )
        if (!accepted) { vlanBlocked = true; continue }
      }

      // Does this device own the destination IP on an up interface?
      for (const iface of device.interfaces) {
        if (iface.ip === dstIp && iface.status === 'up') {
          // SVI can only be reached from within its own VLAN (L2 boundary)
          if (iface.svi && ingressVlan !== null && iface.vlan !== ingressVlan) continue
          return { reachable: true }
        }
      }

      // Walk forward via exit interfaces
      for (const exitIface of this._findExitInterfaces(device, dstIp, ingressVlan)) {
        if (exitIface.status !== 'up') continue

        // Subinterfaces don't have their own cable — physical connectivity is via parent.
        // Resolve the physical interface to get connected_to.
        const physIface = exitIface.parent
          ? device.interfaces.find(i => i.name === exitIface.parent)
          : exitIface
        if (!physIface?.connected_to) continue

        const remoteDevice = this._getDeviceByIfaceId(physIface.connected_to)
        if (!remoteDevice || visited.has(remoteDevice.id)) continue
        const remoteIface = this._resolveIface(physIface.connected_to)
        // Both ends of a cable must be up — a shutdown remote port has no carrier
        if (!remoteIface || remoteIface.status !== 'up') continue

        // NAT enforcement: RFC 1918 private addresses are not internet-routable.
        // When a packet with a private source is about to cross from a router to the
        // ISP (internet) device, the router MUST have NAT configured to translate it.
        // Without NAT the reply can never return — the private source is not globally
        // unique — so we fail here rather than letting the ISP optimistically accept.
        // Skip on the return path: the forward BFS already enforced NAT for inside→outside
        // flows; return traffic from DMZ servers replying to outside-initiated connections
        // is handled by the firewall's stateful session table, not by source NAT.
        if (!isReturnPath && remoteDevice.type === 'isp' && srcIp && _isRfc1918(srcIp)) {
          // Resolve the router interface this packet arrived on; null means the router
          // itself is the source (no forwarded ingress).  _resolveNat skips the
          // nat_inside check when null — the router's own pings use the WAN IP as
          // source anyway, so they never reach the RFC 1918 gate.
          const ingressIface = ingressIfaceId
            ? device.getInterface(ingressIfaceId.slice(ingressIfaceId.indexOf(':') + 1))
            : null
          const wanIp = _resolveNat(device, physIface, srcIp, ingressIface)
          if (!wanIp) {
            // No NAT rule covers this private source → internet is unreachable.
            return { reachable: false, failureReason: 'nat_required', failurePoint: device.id }
          }
          // NAT translates the source; record the mapping (idempotent).
          if (!(device.nat_translations ?? []).some(t => t.inside_local === srcIp)) {
            if (!device.nat_translations) device.nat_translations = []
            device.nat_translations.push({ inside_local: srcIp, inside_global: wanIp })
          }
        }

        // Firewall policy: when a packet crosses zone boundaries on a firewall,
        // evaluate the ordered rule list.  Stateful return traffic is allowed
        // automatically via the session table (no explicit inbound rule needed).
        // ingressIfaceId is null when the firewall is the origin of the ping
        // (router-generated traffic is not subject to inter-zone filtering).
        if (device.type === 'firewall' && ingressIfaceId) {
          const ingressIfName = ingressIfaceId.slice(ingressIfaceId.indexOf(':') + 1)
          const ingressZone   = device.fw_zones?.[ingressIfName] ?? null
          const exitZone      = device.fw_zones?.[physIface.name] ?? null

          if (ingressZone && exitZone && ingressZone !== exitZone) {
            // Check for an existing stateful session.
            // Sessions are recorded as { srcIp, dstIp, protocol, port } on the FORWARD path.
            // Forward BFS (isReturnPath=false): new traffic — look for exact-direction match.
            // Return BFS  (isReturnPath=true):  reply traffic — look for the reverse entry.
            // Session lookup INCLUDES protocol+port: a tcp/443 session does NOT open tcp/22.
            const { protocol, port } = service
            const hasSession = isReturnPath
              ? (device.fw_sessions ?? []).some(s =>
                  s.srcIp === dstIp && s.dstIp === srcIp && s.protocol === protocol && s.port === port)
              : (device.fw_sessions ?? []).some(s =>
                  s.srcIp === srcIp && s.dstIp === dstIp && s.protocol === protocol && s.port === port)

            if (!hasSession) {
              const { allowed, ruleId } = _evaluateFirewallRules(device, ingressZone, exitZone, srcIp, dstIp, service)
              // Log the verdict on the forward path only (return is stateful — no duplicate entry).
              if (!isReturnPath) {
                if (!device.fw_log) device.fw_log = []
                if (device.fw_log.length >= 200) device.fw_log.shift()
                device.fw_log.push({ ts: Date.now(), srcIp, dstIp, protocol, port, fromZone: ingressZone, toZone: exitZone, verdict: allowed ? 'permit' : 'deny', ruleId })
              }
              if (!allowed) {
                fwBlocked  = true
                fwBlockedAt = device.id
                continue  // drop this path — firewall default-deny
              }
              // Allowed by rule: record session (protocol+port) so return traffic is auto-permitted.
              // Idempotent — the same (srcIp, dstIp, protocol, port) tuple is never duplicated.
              // Different services between the same hosts create separate session entries.
              if (!(device.fw_sessions ?? []).some(s =>
                  s.srcIp === srcIp && s.dstIp === dstIp && s.protocol === protocol && s.port === port)) {
                if (!device.fw_sessions) device.fw_sessions = []
                device.fw_sessions.push({ srcIp, dstIp, protocol, port })
              }
            } else if (!isReturnPath) {
              // Session hit — log as permitted-by-session (no rule lookup needed).
              if (!device.fw_log) device.fw_log = []
              if (device.fw_log.length >= 200) device.fw_log.shift()
              device.fw_log.push({ ts: Date.now(), srcIp, dstIp, protocol, port, fromZone: ingressZone, toZone: exitZone, verdict: 'session', ruleId: null })
            }
          }
        }

        // Determine the VLAN context entering remoteDevice.
        // exitIface.vlanTag: VLAN the router tags the frame with (ROAS egress).
        // ingressVlan: VLAN carried through a switch trunk.
        let nextVlan = null
        if (remoteDevice.type === 'switch') {
          if (remoteIface.switchport_mode === 'trunk') {
            // Frame arrives tagged; VLAN from subinterface (ROAS) or from current ingressVlan
            nextVlan = exitIface.vlanTag ?? ingressVlan
          } else {
            // Access port — frame is untagged, VLAN from port config
            nextVlan = remoteIface.vlan ?? 1
          }
        } else if (device.type === 'switch' && exitIface.switchport_mode === 'trunk') {
          // Switch trunk → non-switch (router): carry the ingressVlan (frame is tagged)
          nextVlan = ingressVlan
        }
        // else: non-trunk link to non-switch device — no VLAN context

        queue.push({ device: remoteDevice, ingressVlan: nextVlan, ingressIfaceId: physIface.connected_to })
      }
    }

    return {
      reachable: false,
      failureReason: vlanBlocked ? 'vlan_isolated' : (fwBlocked ? 'blocked_by_firewall' : 'no_route'),
      failurePoint: vlanBlocked ? null : (fwBlocked ? fwBlockedAt : null),
    }
  }

  // Returns ordered list of device IDs from src to dst following the actual
  // network path, or [] if unreachable.  Used for ping animation routing.
  // State is tracked as (device.id, ingressVlan) pairs so that the same physical
  // device (e.g. a switch in a ROAS topology) can appear twice in the path with
  // different VLAN contexts: PC→Switch(vlan10)→Router→Switch(vlan30)→Server.
  findPath(srcIp, dstIp) {
    const srcDevice = this._findDeviceByIp(srcIp)
    if (!srcDevice) return []
    if (srcIp === dstIp) return [srcDevice.id]

    const startVlan = _getStartVlan(srcDevice, srcIp)
    const mk = (devId, vlan) => `${devId}:${vlan ?? 'x'}`

    const visited = new Set()
    const states  = new Map() // stateKey -> { parentKey, deviceId }

    const srcKey = mk(srcDevice.id, startVlan)
    visited.add(srcKey)
    states.set(srcKey, { parentKey: null, deviceId: srcDevice.id })
    const queue = [{ device: srcDevice, ingressVlan: startVlan, key: srcKey }]

    while (queue.length > 0) {
      const { device, ingressVlan, key } = queue.shift()

      // ISP device: path terminates here for any internet (non-local) destination
      if (device.type === 'isp') {
        const isLocal = [...this.devices.values()].some(d =>
          d.interfaces.some(i => i.ip === dstIp)
        )
        if (!isLocal) return _rebuildPath(key, states)
      }

      // Does this device own the destination IP?
      for (const iface of device.interfaces) {
        if (iface.ip === dstIp && iface.status === 'up') {
          if (iface.svi && ingressVlan !== null && iface.vlan !== ingressVlan) continue
          return _rebuildPath(key, states)
        }
      }

      // Walk forward via exit interfaces
      for (const exitIface of this._findExitInterfaces(device, dstIp, ingressVlan)) {
        if (exitIface.status !== 'up') continue
        const physIface = exitIface.parent
          ? device.interfaces.find(i => i.name === exitIface.parent)
          : exitIface
        if (!physIface?.connected_to) continue
        const remoteDev = this._getDeviceByIfaceId(physIface.connected_to)
        if (!remoteDev) continue
        const remoteIface = this._resolveIface(physIface.connected_to)
        if (!remoteIface || remoteIface.status !== 'up') continue
        let nextVlan = null
        if (remoteDev.type === 'switch') {
          if (remoteIface.switchport_mode === 'trunk') {
            nextVlan = exitIface.vlanTag ?? ingressVlan
          } else {
            nextVlan = remoteIface.vlan ?? 1
          }
        } else if (device.type === 'switch' && exitIface.switchport_mode === 'trunk') {
          nextVlan = ingressVlan
        }
        const nextKey = mk(remoteDev.id, nextVlan)
        if (visited.has(nextKey)) continue
        visited.add(nextKey)
        states.set(nextKey, { parentKey: key, deviceId: remoteDev.id })
        queue.push({ device: remoteDev, ingressVlan: nextVlan, key: nextKey })
      }
    }

    return []
  }

  // Return the list of exit interfaces a device would use to forward a packet to dstIp.
  // Priority: (1) directly-connected subnet match, (2) static route longest-prefix match.
  // L2 switches flood within the ingress VLAN only (VLAN isolation).
  _findExitInterfaces(device, dstIp, ingressVlan = null) {
    const exits = []

    // ISP device — forwards to any destination (it's the internet gateway)
    if (device.type === 'isp') {
      return device.interfaces.filter(i => i.status === 'up' && i.connected_to)
    }

    // L2 switch — flood within the ingress VLAN only.
    // SVIs are virtual and don't participate in physical forwarding.
    if (device.type === 'switch') {
      // When ingressVlan is null (packet arrived from an L3 router via a trunk without
      // subinterface tagging info), try to resolve the VLAN from the destination's
      // access port on this switch. This models what a router subinterface would tag.
      const effectiveVlan = ingressVlan ?? _resolveAccessVlan(device, dstIp, this)
      return device.interfaces.filter(i => {
        if (i.status !== 'up' || !i.connected_to || i.svi) return false
        if (effectiveVlan === null) {
          // VLAN still unknown — only allow trunk ports; never bypass access-port isolation
          return i.switchport_mode === 'trunk'
        }
        if (i.switchport_mode === 'trunk') return _vlanAllowed(i.trunk_vlans, effectiveVlan)
        return (i.vlan ?? 1) === effectiveVlan
      })
    }

    // Connected routes — interface (including subinterfaces) in same subnet as destination.
    // Subinterfaces are valid L3 exit points; the BFS caller resolves physical connectivity
    // via the parent interface.
    for (const iface of device.interfaces) {
      if (iface.status !== 'up' || !iface.ip || !iface.subnet_mask) continue
      const ifNet = networkAddress(iface.ip, iface.subnet_mask)
      const dstNet = networkAddress(dstIp, iface.subnet_mask)
      if (ifNet === dstNet) exits.push(iface)
    }
    if (exits.length > 0) return exits

    // Static routes — longest-prefix match
    let bestRoute = null
    let bestLen = -1
    for (const route of device.routing_table) {
      const dstNet = networkAddress(dstIp, route.mask)
      if (dstNet === route.network) {
        const len = maskToPrefixLen(route.mask)
        if (len > bestLen) { bestLen = len; bestRoute = route }
      }
    }

    if (!bestRoute) return exits

    if (bestRoute.exit_interface) {
      const ei = device.getInterface(bestRoute.exit_interface)
      if (ei) exits.push(ei)
      return exits
    }

    // Resolve next-hop to an exit interface via connected route lookup (physical + subinterfaces)
    for (const iface of device.interfaces) {
      if (iface.status !== 'up' || !iface.ip || !iface.subnet_mask) continue
      const ifNet = networkAddress(iface.ip, iface.subnet_mask)
      const nhNet = networkAddress(bestRoute.next_hop, iface.subnet_mask)
      if (ifNet === nhNet) exits.push(iface)
    }

    return exits
  }

  _findDeviceByIp(ip) {
    for (const dev of this.devices.values()) {
      for (const iface of dev.interfaces) {
        if (iface.ip === ip && iface.status === 'up') return dev
      }
    }
    return null
  }

  _resolveIface(ifaceId) {
    const colonIdx = ifaceId.indexOf(':')
    if (colonIdx === -1) return null
    const devId = ifaceId.slice(0, colonIdx)
    const ifName = ifaceId.slice(colonIdx + 1)
    const device = this.devices.get(devId)
    return device ? device.getInterface(ifName) : null
  }

  _getDeviceByIfaceId(ifaceId) {
    const colonIdx = ifaceId.indexOf(':')
    if (colonIdx === -1) return null
    return this.devices.get(ifaceId.slice(0, colonIdx)) || null
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────────

// Reconstruct the device-ID list from a findPath state chain.
function _rebuildPath(key, states) {
  const path = []
  let cur = key
  while (cur !== null) {
    const { parentKey, deviceId } = states.get(cur)
    path.unshift(deviceId)
    cur = parentKey
  }
  return path
}

// When a packet enters a switch from an L3 device (router) via a trunk with unknown VLAN
// context (no subinterface config), determine the VLAN by finding the access port on this
// switch that is directly connected to the device owning dstIp.
// Returns the VLAN number if dstIp is directly attached via an access port, else null.
// With null, BFS falls back to traversing trunk ports only — never bypassing access isolation.
function _resolveAccessVlan(switchDevice, dstIp, topology) {
  for (const dev of topology.devices.values()) {
    for (const iface of dev.interfaces) {
      if (iface.ip !== dstIp || iface.status !== 'up' || !iface.connected_to) continue
      const colonIdx = iface.connected_to.indexOf(':')
      if (colonIdx === -1) continue
      if (iface.connected_to.slice(0, colonIdx) !== switchDevice.id) continue
      const switchPort = switchDevice.getInterface(iface.connected_to.slice(colonIdx + 1))
      if (switchPort && switchPort.switchport_mode !== 'trunk') return switchPort.vlan ?? 1
    }
  }
  return null
}

// Determine the 802.1Q VLAN context at the start of a BFS path.
// Returns null for L3 devices (routers, PCs) — no VLAN constraint.
// Returns the SVI's VLAN when the source is a switch SVI (management ping).
function _getStartVlan(srcDevice, srcIp) {
  if (srcDevice.type !== 'switch' || !srcIp) return null
  const svi = srcDevice.interfaces.find(i => i.svi && i.ip === srcIp && i.status === 'up')
  return svi ? svi.vlan : null
}

// Check whether vlanId is permitted on a trunk port.
// trunkVlans may be null/undefined (all), 'all', or a Cisco-style list like '1,10,20-30'.
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

// Recalculate status for all no-shutdown SVIs based on whether their VLAN has
// an active port. An SVI for VLAN N comes up only when:
//   • an access port in VLAN N is up, OR
//   • a trunk port carrying VLAN N is up
// Mirrors the same helper in CLIEngine.js — keep both in sync.
function _refreshSvis(device) {
  for (const iface of device.interfaces) {
    if (!iface.svi || iface.status === 'admin_down') continue
    const vlanId = iface.vlan
    iface.status = device.interfaces.some(i => {
      if (i.svi || i.status !== 'up') return false
      if (i.switchport_mode === 'trunk') return _vlanAllowed(i.trunk_vlans, vlanId)
      return (i.vlan ?? 1) === vlanId
    }) ? 'up' : 'down'
  }
}

// Determine whether a same-subnet ping failure from srcDevice is caused by VLAN
// isolation at a directly connected switch.  Returns true only when we can
// positively prove that a switch VLAN boundary blocks the frame.
// Called only when src thinks dst is local (same subnet).
// Also handles ROAS case: dstIp on a router subinterface connected via access port
// (the physical link carries a mismatched VLAN relative to srcVlan).
function _checkVlanIsolation(srcDevice, srcIp, dstIp, topology) {
  for (const srcIface of srcDevice.interfaces) {
    if (!srcIface.connected_to) continue
    const sw = topology._getDeviceByIfaceId(srcIface.connected_to)
    if (!sw || sw.type !== 'switch') continue
    const swPort = topology._resolveIface(srcIface.connected_to)
    if (!swPort || swPort.svi) continue
    const srcVlan = swPort.switchport_mode === 'trunk' ? null : (swPort.vlan ?? 1)
    if (srcVlan === null) continue  // trunk — can't determine single VLAN

    // Find the switch port toward the destination.
    // For subinterfaces: physical connectivity is via the parent interface.
    for (const dev of topology.devices.values()) {
      for (const iface of dev.interfaces) {
        if (iface.ip !== dstIp) continue
        const physConnected = iface.connected_to ??
          (iface.parent
            ? dev.interfaces.find(p => p.name === iface.parent)?.connected_to
            : null)
        if (!physConnected) continue
        const dstSw = topology._getDeviceByIfaceId(physConnected)
        if (!dstSw || dstSw !== sw) continue
        const dstSwPort = topology._resolveIface(physConnected)
        if (!dstSwPort || dstSwPort.svi) continue
        // Trunk port carries all VLANs — no isolation on trunk
        if (dstSwPort.switchport_mode === 'trunk') continue
        const dstVlan = dstSwPort.vlan ?? 1
        if (srcVlan !== dstVlan) return true  // VLAN boundary confirmed
      }
    }
  }
  return false
}

// Returns true when ip is in an RFC 1918 private address range.
// Private addresses are not globally routable — NAT is required to reach the internet.
// Ranges: 10.0.0.0/8 · 172.16.0.0/12 · 192.168.0.0/16
function _isRfc1918(ip) {
  const n = ipToNum(ip)
  return (
    (n & 0xFF000000) >>> 0 === 0x0A000000 ||  // 10.0.0.0/8
    (n & 0xFFF00000) >>> 0 === 0xAC100000 ||  // 172.16.0.0/12
    (n & 0xFFFF0000) >>> 0 === 0xC0A80000      // 192.168.0.0/16
  )
}

// Returns true when srcIp matches an ACL entry (standard named-bits wildcard matching).
function _natAclMatches(acl, srcIp) {
  const ipN = ipToNum(srcIp)
  for (const entry of (acl.entries ?? [])) {
    if (!entry.permit) continue
    const netN  = ipToNum(entry.network)
    const wildN = ipToNum(entry.wildcard)
    // Bits where wildcard=0 MUST match; wildcard=1 are don't-care.
    if (((ipN ^ netN) & ~wildN) >>> 0 === 0) return true
  }
  return false
}

// Check whether a NAT overload rule on routerDevice covers srcIp egressing outsideIface
// and arriving from ingressIface.  Returns the WAN (inside_global) IP or null.
// ingressIface is the router interface the packet arrived on.  When null (router-sourced
// traffic), the ip-nat-inside ingress check is skipped — the router's own WAN IP is
// public, so it never reaches the RFC 1918 gate in the first place.
function _resolveNat(routerDevice, outsideIface, srcIp, ingressIface) {
  if (!outsideIface.nat_outside) return null
  // Real IOS only translates traffic that entered on an `ip nat inside` interface.
  if (ingressIface != null && !ingressIface.nat_inside) return null
  for (const rule of (routerDevice.nat_rules ?? [])) {
    if (rule.outside_interface !== outsideIface.name) continue
    const acl = (routerDevice.nat_acls ?? []).find(a => a.id === rule.acl_id)
    if (!acl) continue
    if (_natAclMatches(acl, srcIp)) return outsideIface.ip  // WAN IP is inside_global
  }
  return null
}

// Well-known service name → { protocol, port }.
// Protocol: 'tcp' | 'udp' | 'icmp'.  Port: null for ICMP (no destination-port concept).
// Ports are real IANA-assigned well-known values — accuracy is the whole point.
const NAMED_SERVICES = {
  HTTP:   { protocol: 'tcp', port: 80 },
  HTTPS:  { protocol: 'tcp', port: 443 },
  SSH:    { protocol: 'tcp', port: 22 },
  DNS:    { protocol: 'udp', port: 53 },
  FTP:    { protocol: 'tcp', port: 21 },
  TELNET: { protocol: 'tcp', port: 23 },
  RDP:    { protocol: 'tcp', port: 3389 },
  SMTP:   { protocol: 'tcp', port: 25 },
}

// Resolve a service string to { protocol, port }.
// Accepts: 'any' | 'icmp' | named-service (HTTPS) | proto/port (tcp/443 udp/53).
// Unknown strings fall back to 'any' so legacy rules stored without a service field
// remain fully permissive — backward-compatible, no silent breakage.
function _parseService(str) {
  if (!str || str.toLowerCase() === 'any') return { protocol: 'any', port: null }
  const upper = str.toUpperCase()
  if (NAMED_SERVICES[upper]) return NAMED_SERVICES[upper]
  if (upper === 'ICMP') return { protocol: 'icmp', port: null }
  const slash = str.indexOf('/')
  if (slash !== -1) {
    const proto = str.slice(0, slash).toLowerCase()
    const port  = parseInt(str.slice(slash + 1), 10)
    if ((proto === 'tcp' || proto === 'udp') && !isNaN(port) && port > 0 && port <= 65535)
      return { protocol: proto, port }
  }
  return { protocol: 'any', port: null }
}

// Returns true when ruleServiceStr matches the flow described by flowService
// ({ protocol, port }).  Rule 'any' matches everything.  A specific protocol
// must exactly match; port must match when the rule specifies one (ICMP has no port).
function _matchService(ruleServiceStr, flowService) {
  const parsed = _parseService(ruleServiceStr)
  if (parsed.protocol === 'any') return true
  if (parsed.protocol !== flowService.protocol) return false
  if (parsed.port === null) return true  // icmp-rule: protocol match is sufficient
  return parsed.port === (flowService.port ?? null)
}

// Walk the firewall's ordered rule list (first-match, default-deny).
// Returns true if the packet is PERMITTED, false if DENIED or no rule matches.
// Zones are compared case-insensitively; src/dst 'any' matches all IPs;
// service is matched by _matchService (protocol + destination port).
function _evaluateFirewallRules(device, fromZone, toZone, srcIp, dstIp, service) {
  for (const rule of (device.fw_rules ?? [])) {
    if (rule.enabled === false) continue  // disabled rules are skipped entirely
    if (rule.fromZone.toUpperCase() !== fromZone.toUpperCase()) continue
    if (rule.toZone.toUpperCase()   !== toZone.toUpperCase())   continue
    if (!_fwMatchAddr(rule.src, srcIp)) continue
    if (!_fwMatchAddr(rule.dst, dstIp)) continue
    if (!_matchService(rule.service ?? 'any', service)) continue
    // First match wins
    return { allowed: rule.action === 'permit', ruleId: rule.id ?? null }
  }
  return { allowed: false, ruleId: null }  // implicit default-deny
}

// Address match for firewall rules.
// 'any' → match all; exact IP; CIDR 'x.x.x.x/prefix' subnet.
function _fwMatchAddr(ruleAddr, ip) {
  if (!ruleAddr || ruleAddr === 'any') return true
  if (!ip) return false
  if (ruleAddr === ip) return true
  if (ruleAddr.includes('/')) {
    const [net, prefix] = ruleAddr.split('/')
    const maskStr = _prefixLenToMask(parseInt(prefix, 10))
    return networkAddress(ip, maskStr) === networkAddress(net, maskStr)
  }
  return false
}

// Convert /prefix-length integer to dotted-decimal mask string.
function _prefixLenToMask(prefix) {
  if (prefix <= 0)  return '0.0.0.0'
  if (prefix >= 32) return '255.255.255.255'
  const n = ~((1 << (32 - prefix)) - 1) >>> 0
  return [(n >>> 24) & 0xFF, (n >>> 16) & 0xFF, (n >>> 8) & 0xFF, n & 0xFF].join('.')
}

// Build the standardised checkPing result object.
// failureReason enum: 'no_route' | 'host_no_gateway' | 'gateway_unreachable' |
//   'subnet_mismatch' | 'admin_down' | 'link_down' | 'no_return_path' |
//   'vlan_isolated' | 'ip_conflict' | 'duplex_mismatch' | 'nat_required' |
//   'blocked_by_firewall'
function _pingResult(reachable, failureReason, failurePoint) {
  return {
    reachable,
    degraded:      false,
    sent:          5,
    received:      reachable ? 5 : 0,
    lossPct:       reachable ? 0 : 100,
    rttMs:         reachable ? 2 : 0,
    failureReason: reachable ? null : (failureReason ?? 'no_route'),
    failurePoint:  reachable ? null : (failurePoint  ?? null),
  }
}
