/**
 * failureReason registry — every reason code the engine emits today.
 *
 * Two families:
 *   source 'path'  → PathResult.failureReason from Topology.checkPing (see pathResult.js)
 *   source 'dns'   → resolveName().reason from the DNS resolver (onprem/dns.js)
 *
 * The emitted VALUES are a contract: tests, mission checks, dev presets and the
 * capture panel all match on these exact strings. Never rename a code; add a new one.
 * Engine code refers to them through REASON (e.g. REASON.NO_ROUTE) instead of string
 * literals, so every code has exactly one spelling and one description.
 *
 * Not listed: codes that are only planned (gateway_unreachable, ip_conflict,
 * duplex_mismatch — STATUS "Next up") and the DHCP client's own `reason` values
 * (link_down / no_link / pool_exhausted / no_server), which are a separate result type.
 *
 * Pure data — core imports nothing (apps/netsim/src/core/__tests__/architecture.test.js A1).
 */

const ENTRIES = [
  // ── path: Topology.checkPing ───────────────────────────────────────────────
  { key: 'NO_ROUTE', code: 'no_route', source: 'path',
    description: 'No forwarding entry for the destination somewhere on the path (no matching route and no default route), or no physical path at all.' },
  { key: 'ADMIN_DOWN', code: 'admin_down', source: 'path',
    description: 'The source interface is administratively down (IOS shutdown, ip link set down, adapter disabled).' },
  { key: 'LINK_DOWN', code: 'link_down', source: 'path',
    description: 'The source interface is enabled but has no carrier: no cable, or the peer is off or shut.' },
  { key: 'VLAN_ISOLATED', code: 'vlan_isolated', source: 'path',
    description: 'The destination is only reachable across a VLAN boundary with no Layer 3 device routing between the VLANs.' },
  { key: 'SUBNET_MISMATCH', code: 'subnet_mismatch', source: 'path',
    description: 'IP/mask mismatch between hosts: the source treats the destination as off-subnet while the destination\'s own mask puts the source on-link.' },
  { key: 'HOST_NO_GATEWAY', code: 'host_no_gateway', source: 'path',
    description: 'Off-subnet destination and the host has no default gateway reachable over a connected network.' },
  { key: 'NO_RETURN_PATH', code: 'no_return_path', source: 'path',
    description: 'The request reaches the destination but the reply has no route back (one-way routing).' },
  { key: 'NAT_REQUIRED', code: 'nat_required', source: 'path',
    description: 'An RFC 1918 source would leave toward the ISP without NAT translation.' },
  { key: 'BLOCKED_BY_FIREWALL', code: 'blocked_by_firewall', source: 'path',
    description: 'Zone-based firewall policy dropped the flow (explicit deny, or no matching permit — implicit default-deny).' },

  // ── dns: resolveName ───────────────────────────────────────────────────────
  { key: 'DNS_NO_SERVER', code: 'dns_no_server', source: 'dns',
    description: 'The host has no name server configured (none set by hand, none from a DHCP lease).' },
  { key: 'DNS_UNREACHABLE', code: 'dns_unreachable', source: 'dns',
    description: 'No query/answer got through to any configured name server (path, NAT, firewall, dead adapter, or the address is not a DNS server).' },
  { key: 'DNS_REFUSED', code: 'dns_refused', source: 'dns',
    description: 'A configured server is reachable but nothing listens on UDP/53.' },
  { key: 'DNS_NXDOMAIN', code: 'dns_nxdomain', source: 'dns',
    description: 'A reachable name server answered authoritatively: no such name.' },
]

/** Engine-facing constants: REASON.NO_ROUTE === 'no_route'. */
export const REASON = Object.freeze(Object.fromEntries(ENTRIES.map(e => [e.key, e.code])))

/** Registry keyed by code: { code, domain, source, description }. */
export const FAILURE_REASONS = Object.freeze(Object.fromEntries(ENTRIES.map(e => [
  e.code,
  Object.freeze({ code: e.code, domain: 'onprem', source: e.source, description: e.description }),
])))

export function isKnownFailureReason(code) {
  return Object.prototype.hasOwnProperty.call(FAILURE_REASONS, code)
}
