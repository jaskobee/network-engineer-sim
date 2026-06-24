/**
 * DHCP exchange engine — implements the logical DORA flow per DHCP invariants.
 *
 * SIMPLIFICATIONS (documented, not bugs):
 *   - Client-ID: uses "devId:ifaceName" as a stable stand-in for a real MAC/DUID.
 *     Real DHCP uses MAC address or RFC 4361 DUID.  Documented here so students know.
 *   - Lease expiry: lease_expires is stored as "Infinite" for all bindings.
 *     Real lease timers (T1/T2/expiry) are not simulated.  The `lease` command
 *     stores duration for display only.
 *   - DNS: a single dns-server IP is applied to device.dns_server.
 *     Real DHCP can carry multiple DNS servers (option 6).
 */

import { isValidIp, ipToNum, networkAddress } from './ipUtils.js'

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Perform DHCP DORA exchange for clientIface on clientDevice.
 * Returns { success: true, ip, mask, gateway, dns } on success,
 *         { success: false, reason, message } on failure.
 *
 * Invariants enforced:
 *   - clientIface must be UP (Inv 1)
 *   - Broadcasts don't cross routers without ip helper-address (Inv 2)
 *   - Relay uses existing routing (checkPing) — honored here (Inv 4)
 *   - Pool selection uses giaddr subnet for relayed requests (Inv 5)
 *   - Address never conflicts with excluded/gateway/bound IPs (Inv 6)
 *   - No server / no pool / exhausted pool → failure, no fake address (Inv 9)
 */
export function performDHCP(topology, clientDevice, clientIface) {
  if (!clientIface) return { success: false, reason: 'no_iface', message: 'Interface not found' }
  if (clientIface.status !== 'up') {
    return { success: false, reason: 'link_down', message: 'Interface is not up — run: ip link set <if> up' }
  }
  if (!clientIface.connected_to) {
    return { success: false, reason: 'no_link', message: 'Interface is not connected to any device' }
  }

  // Walk the L2 broadcast domain to find router interfaces on the same segment.
  // A router interface terminates the broadcast domain (it won't forward broadcasts further).
  const connectedIface = topology._resolveIface(clientIface.connected_to)
  const connectedDev   = topology._getDeviceByIfaceId(clientIface.connected_to)
  const startVlan      = _arrivalVlan(connectedDev, connectedIface)
  const routerIfaces   = _l2RouterIfaces(topology, clientIface.connected_to, startVlan)

  // ── Try local DHCP server (router on same segment with matching pool) ──────
  for (const { device: rDev, iface: rIface } of routerIfaces) {
    if (!rDev.dhcp_pools?.length || !rIface.ip) continue
    const pool = _findLocalPool(rDev, rIface.ip)
    if (!pool) continue
    const ip = _selectAddress(rDev, pool, rIface.ip)
    if (ip === null) return { success: false, reason: 'pool_exhausted', message: 'DHCP pool has no available addresses' }
    _recordBinding(rDev, ip, clientDevice, clientIface, pool.name)
    return { success: true, ip, mask: pool.mask, gateway: pool.default_router, dns: pool.dns_server }
  }

  // ── Try relay (ip helper-address on a router interface on same segment) ────
  for (const { device: rDev, iface: rIface } of routerIfaces) {
    if (!rIface.helper_addresses?.length || !rIface.ip) continue
    const giaddr = rIface.ip   // relay agent address (Inv 3)

    for (const serverIp of rIface.helper_addresses) {
      // Relay reachability: relay→server AND server→relay must be routable (Inv 4)
      const reach = topology.checkPing(giaddr, serverIp)
      if (!reach.reachable) continue

      const serverDev = topology._findDeviceByIp(serverIp)
      if (!serverDev?.dhcp_pools?.length) continue

      // Pool selection by giaddr subnet (Inv 5)
      const pool = _findPoolByGiaddr(serverDev, giaddr)
      if (!pool) continue

      const ip = _selectAddress(serverDev, pool, giaddr)
      if (ip === null) return { success: false, reason: 'pool_exhausted', message: 'DHCP pool has no available addresses' }
      _recordBinding(serverDev, ip, clientDevice, clientIface, pool.name)
      return { success: true, ip, mask: pool.mask, gateway: pool.default_router, dns: pool.dns_server }
    }
  }

  return { success: false, reason: 'no_server', message: 'No DHCPOFFERS received' }
}

/**
 * Release a DHCP lease: clear ip/mask/gateway/dns on the client and remove
 * the server-side binding.
 * Returns { released: true, ip } or { released: false, message }.
 */
export function releaseDHCP(topology, clientDevice, clientIface) {
  if (!clientIface) return { released: false, message: 'Interface not found' }
  const ip = clientIface.ip
  if (!ip || !clientIface.dhcp_assigned) {
    return { released: false, message: 'No DHCP lease to release on this interface' }
  }

  // Remove the binding from whichever router holds it
  for (const dev of topology.devices.values()) {
    if (!dev.dhcp_bindings?.length) continue
    const idx = dev.dhcp_bindings.findIndex(b => b.ip === ip)
    if (idx >= 0) { dev.dhcp_bindings.splice(idx, 1); break }
  }

  // Clear client interface address
  clientIface.ip           = null
  clientIface.subnet_mask  = null
  clientIface.dhcp_assigned = false

  // Remove the default gateway route that was injected by DHCP
  clientDevice.routing_table = clientDevice.routing_table.filter(r => !r.dhcp_assigned)

  // Clear DNS
  clientDevice.dns_server = null

  return { released: true, ip }
}

// ── Private helpers ────────────────────────────────────────────────────────────

/**
 * BFS from startIfaceId through L2 devices (switches) only.
 * Returns all router interfaces reachable without crossing another router.
 * Broadcast boundary: stops at any router (they don't flood broadcasts forward).
 */
function _l2RouterIfaces(topology, startIfaceId, startVlan) {
  const results = []
  const visited = new Set()
  const queue   = [{ ifaceId: startIfaceId, vlan: startVlan }]

  while (queue.length > 0) {
    const { ifaceId, vlan } = queue.shift()
    if (!ifaceId) continue
    const visitKey = `${ifaceId}:${vlan}`
    if (visited.has(visitKey)) continue
    visited.add(visitKey)

    const dev   = topology._getDeviceByIfaceId(ifaceId)
    const iface = topology._resolveIface(ifaceId)
    if (!dev || !iface || iface.status !== 'up') continue

    if (dev.type === 'router') {
      if (iface.ip) {
        // Normal case: physical interface has an IP (direct-attach DHCP server)
        results.push({ device: dev, iface })
      } else if (vlan !== null) {
        // ROAS: physical parent is a trunk carrier with no IP; find the subinterface
        // whose encapsulation dot1Q matches the arriving VLAN tag.
        for (const subif of dev.interfaces) {
          if (subif.parent === iface.name && subif.vlanTag === vlan &&
              subif.ip && subif.status === 'up') {
            results.push({ device: dev, iface: subif })
          }
        }
      }
      // Don't traverse through the router — it's a broadcast boundary
      continue
    }

    if (dev.type === 'switch') {
      // Determine effective VLAN for the frame arriving on this port
      const arrVlan = iface.switchport_mode === 'trunk' ? vlan : (iface.vlan ?? 1)

      for (const swPort of dev.interfaces) {
        if (swPort === iface || swPort.svi || !swPort.connected_to || swPort.status !== 'up') continue
        if (swPort.switchport_mode === 'trunk') {
          if (arrVlan !== null && !_vlanAllowed(swPort.trunk_vlans, arrVlan)) continue
          queue.push({ ifaceId: swPort.connected_to, vlan: arrVlan })
        } else {
          const portVlan = swPort.vlan ?? 1
          if (arrVlan !== null && portVlan !== arrVlan) continue
          queue.push({ ifaceId: swPort.connected_to, vlan: null })
        }
      }
    }
    // PCs/servers/ISP on the segment: ignore for server-discovery purposes
  }

  return results
}

/**
 * Determine the VLAN a frame arrives with on connectedIface (from the client's
 * connected_to port).  Returns null for non-switch devices or trunk ports
 * (VLAN is unknown / carries all VLANs).
 */
function _arrivalVlan(connectedDev, connectedIface) {
  if (!connectedDev || connectedDev.type !== 'switch') return null
  if (connectedIface?.switchport_mode === 'trunk') return null
  return connectedIface?.vlan ?? 1
}

// Find a pool on rDev whose network matches the subnet of routerIp (local service case).
function _findLocalPool(rDev, routerIfaceIp) {
  for (const pool of rDev.dhcp_pools) {
    if (!pool.network || !pool.mask) continue
    if (networkAddress(routerIfaceIp, pool.mask) === pool.network) return pool
  }
  return null
}

// Find a pool on serverDev where giaddr falls in the pool's subnet (relay case).
function _findPoolByGiaddr(serverDev, giaddr) {
  for (const pool of serverDev.dhcp_pools) {
    if (!pool.network || !pool.mask) continue
    if (networkAddress(giaddr, pool.mask) === pool.network) return pool
  }
  return null
}

/**
 * Select the first free host address from pool, skipping:
 *   (a) excluded ranges, (b) the relay/gateway IP, (c) any server interface IPs,
 *   (d) already-bound IPs.
 * Returns null if pool is exhausted.
 */
function _selectAddress(serverDev, pool, gatewayIp) {
  const netNum   = ipToNum(pool.network)
  const maskNum  = ipToNum(pool.mask)
  const hostBits = (~maskNum) >>> 0
  const bcastNum = (netNum | hostBits) >>> 0

  for (let n = netNum + 1; n < bcastNum; n++) {
    const ip = _numToIp(n)

    if (_isExcluded(serverDev.dhcp_excluded, n))                 continue
    if (ip === gatewayIp)                                        continue
    if (serverDev.interfaces.some(i => i.ip === ip))            continue
    if (serverDev.dhcp_bindings.some(b => b.ip === ip))         continue

    return ip
  }
  return null
}

function _recordBinding(serverDev, ip, clientDevice, clientIface, poolName) {
  const clientId = `${clientDevice.id}:${clientIface.name}`
  serverDev.dhcp_bindings.push({
    ip,
    client_id:     clientId,
    pool_name:     poolName,
    lease_expires: 'Infinite',  // simplification — no real timer
  })
}

function _isExcluded(excludedRanges, ipNum) {
  if (!excludedRanges?.length) return false
  for (const e of excludedRanges) {
    if (ipNum >= ipToNum(e.start) && ipNum <= ipToNum(e.end)) return true
  }
  return false
}

function _numToIp(n) {
  return [(n >>> 24), (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff].join('.')
}

// Mirror of _vlanAllowed from Topology.js — must stay in sync.
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
