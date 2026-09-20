/**
 * DNS resolver — pure headless core (no React/DOM). See docs/DNS_DESIGN.md.
 *
 * A name resolves only if the asking device really can:
 *   1. has at least one name server configured (by hand, or handed out by DHCP),
 *   2. gets a UDP/53 query to that server along a path real hardware would forward — both
 *      directions, through NAT and firewalls (`Topology.checkPing` with a udp/53 service), and
 *   3. finds something listening there that knows the name.
 * The four ways that fails are four different symptoms (`reason`), so a learner can tell them
 * apart: `dns_no_server`, `dns_unreachable`, `dns_refused`, `dns_nxdomain`.
 *
 * Nothing here writes device state; callers (the three shells) turn the result into
 * OS-worded output. The only side effects are the ones a real query has anyway:
 * `checkPing` records NAT translations / firewall sessions, and callers may ask for a packet
 * capture (`capture: true`) so WireFish shows the UDP/53 exchange.
 *
 * PHASE 1 SCOPE: the only DNS servers that answer are the public recursive resolvers below
 * (reached through the ISP). A LAN device at a configured server address answers "refused" —
 * DNS service on servers and routers arrives in phase 2.
 *
 * SIMPLIFICATIONS (documented, not bugs): no cache and no TTLs (a name is looked up every time),
 * A records only, no recursion depth, no TCP fallback, no source ports (same 4-tuple
 * simplification as the firewall).
 */
import { isValidIp } from './ipUtils.js'

/** What a DNS query looks like to the firewall: UDP, destination port 53. */
export const DNS_SERVICE = Object.freeze({ protocol: 'udp', port: 53 })

/**
 * The simulated public internet's zone — what a public recursive resolver knows.
 * (Pre-existing sim data, moved here from ipUtils: these are the hostnames the sim's
 * "internet" hosts answer to.)
 */
export const PUBLIC_ZONE = Object.freeze({
  'google.com':       '8.8.8.8',
  'www.google.com':   '8.8.8.8',
  'dns.google':       '8.8.8.8',
  'cloudflare.com':   '1.1.1.1',
  'one.one.one.one':  '1.1.1.1',
  'github.com':       '140.82.121.4',
  'youtube.com':      '142.250.80.46',
  'reddit.com':       '151.101.65.140',
  'amazon.com':       '205.251.242.103',
})

/** Public recursive resolvers and the name their address reverse-resolves to. */
export const PUBLIC_RESOLVERS = Object.freeze({
  '8.8.8.8':  'dns.google',
  '8.8.4.4':  'dns.google',
  '1.1.1.1':  'one.one.one.one',
  '1.0.0.1':  'one.one.one.one',
  '9.9.9.9':  'dns9.quad9.net',
})

/** Lower-case, no trailing root dot — how names are compared. */
export function normalizeName(name) {
  return String(name ?? '').trim().toLowerCase().replace(/\.$/, '')
}

/**
 * The name servers a device actually asks, in order: the ones configured by hand win over
 * the ones a DHCP lease supplied (a static DNS setting overrides the lease, as on Windows
 * "Use the following DNS server addresses" and on `resolvectl dns`).
 */
export function effectiveDnsServers(device) {
  const manual = device?.dns_servers ?? []
  return [...(manual.length ? manual : (device?.dhcp_dns_servers ?? []))]
}

/** Where the effective list came from: 'static' | 'dhcp' | 'none'. */
export function dnsSource(device) {
  if ((device?.dns_servers ?? []).length) return 'static'
  if ((device?.dhcp_dns_servers ?? []).length) return 'dhcp'
  return 'none'
}

/** What a resolver's address reverse-resolves to (what Windows nslookup prints as `Server:`). */
export function reverseName(ip) {
  return PUBLIC_RESOLVERS[ip] ?? null
}

// The default source address for a host's query: the first adapter that is up with an address.
function _hostSrcIp(device) {
  return device.interfaces.find(i => i.status === 'up' && i.ip)?.ip ?? null
}

/**
 * Ask ONE server. Returns
 *   { server, srcIp, outcome, ip?, authoritative?, failureReason?, failurePoint? }
 * where outcome is:
 *   'answered'    the server knows the name (`ip`)
 *   'nxdomain'    the server answered: no such name — an authoritative "no"
 *   'unreachable' the query never got there and back (`failureReason` says why)
 *   'refused'     it got there but nothing is listening on UDP/53 (ICMP port unreachable)
 *   'no_answer'   it got there, but the address is not a DNS server — silence, a timeout
 *   'no_source'   the device has no usable interface to send from
 */
export function queryServer(topology, device, serverIp, name, { srcIpFor, capture = false } = {}) {
  const srcIp = srcIpFor ? srcIpFor(device, serverIp) : _hostSrcIp(device)
  if (!srcIp) return { server: serverIp, srcIp: null, outcome: 'no_source' }

  const path = topology.checkPing(srcIp, serverIp, DNS_SERVICE)
  if (capture) topology.recordCapture(srcIp, serverIp, path, DNS_SERVICE)
  if (!path.reachable) {
    return { server: serverIp, srcIp, outcome: 'unreachable', failureReason: path.failureReason, failurePoint: path.failurePoint }
  }

  // A device of ours owns the address. Phase 2 will look for its DNS service here; until a
  // device can run one, nothing is listening on UDP/53 — a real host answers with ICMP port unreachable.
  if (topology._findDeviceByIp(serverIp)) return { server: serverIp, srcIp, outcome: 'refused' }

  // Off the LAN: a public resolver answers from the public zone; any other internet address
  // is not a DNS server, so the query simply goes unanswered.
  if (PUBLIC_RESOLVERS[serverIp]) {
    const ip = PUBLIC_ZONE[normalizeName(name)]
    return ip
      ? { server: serverIp, srcIp, outcome: 'answered', ip, authoritative: false }
      : { server: serverIp, srcIp, outcome: 'nxdomain' }
  }
  return { server: serverIp, srcIp, outcome: 'no_answer' }
}

/**
 * Resolve `name` the way the device's own resolver would.
 *
 * Returns { ok, ip, reason, name, servers, server, authoritative, tried, literal?, local? }:
 *   - an IP address is returned as-is (`literal`), `localhost` resolves locally (`local`) —
 *     neither needs a name server;
 *   - otherwise each configured server is tried IN ORDER. An unreachable or refusing server
 *     is skipped; a server that answers "no such name" ends the search (an authoritative no);
 *   - `reason` when !ok: 'dns_no_server' | 'dns_unreachable' | 'dns_refused' | 'dns_nxdomain'.
 *
 * opts: srcIpFor(device, serverIp) picks the source address (routers use the egress interface);
 *       capture: record the UDP/53 exchange in the packet capture;
 *       localNames: names the OS answers itself, before any DNS (default ['localhost'] — Linux and
 *       Windows have it in their hosts file; IOS has no such name unless `ip host` defines it).
 */
export function resolveName(topology, device, name, opts = {}) {
  const asked = normalizeName(name)
  const base = { name: asked, servers: [], tried: [], server: null, authoritative: false }

  if (isValidIp(asked)) return { ...base, ok: true, ip: asked, reason: null, literal: true }
  if ((opts.localNames ?? ['localhost']).includes(asked)) return { ...base, ok: true, ip: '127.0.0.1', reason: null, local: true }

  const servers = effectiveDnsServers(device)
  if (!servers.length) return { ...base, ok: false, ip: null, reason: 'dns_no_server' }

  const tried = []
  for (const server of servers) {
    const q = queryServer(topology, device, server, asked, opts)
    tried.push(q)
    if (q.outcome === 'answered') {
      return { ...base, servers, tried, ok: true, ip: q.ip, reason: null, server, authoritative: q.authoritative }
    }
    if (q.outcome === 'nxdomain') {
      return { ...base, servers, tried, ok: false, ip: null, reason: 'dns_nxdomain', server }
    }
  }
  const refused = tried.every(t => t.outcome === 'refused')
  return { ...base, servers, tried, ok: false, ip: null, reason: refused ? 'dns_refused' : 'dns_unreachable' }
}
