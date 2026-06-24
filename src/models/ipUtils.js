export function isValidIp(ip) {
  if (typeof ip !== 'string') return false
  const parts = ip.split('.')
  if (parts.length !== 4) return false
  return parts.every(p => {
    const n = parseInt(p, 10)
    return !isNaN(n) && n >= 0 && n <= 255 && String(n) === p
  })
}

export function ipToNum(ip) {
  return ip.split('.').reduce((acc, octet) => ((acc << 8) | parseInt(octet, 10)) >>> 0, 0)
}

export function networkAddress(ip, mask) {
  if (!isValidIp(ip) || !isValidIp(mask)) return ip
  const net = (ipToNum(ip) & ipToNum(mask)) >>> 0
  return [net >>> 24, (net >>> 16) & 0xff, (net >>> 8) & 0xff, net & 0xff].join('.')
}

export function maskToPrefixLen(mask) {
  if (!mask) return 0
  let n = ipToNum(mask)
  let count = 0
  while (n & 0x80000000) {
    count++
    n = (n << 1) >>> 0
  }
  return count
}

// Returns true only for contiguous-1-bit subnet masks (e.g. 255.255.255.0).
// Rejects discontiguous masks like 255.0.255.0 exactly as real IOS does.
export function isValidMask(mask) {
  if (!isValidIp(mask)) return false
  const inv = (~ipToNum(mask)) >>> 0  // invert: valid masks become 0...01...1
  return (inv & (inv + 1)) === 0      // true only when inv is a contiguous run of 1s
}

// Directed broadcast address for the subnet containing ip/mask.
export function broadcastAddress(ip, mask) {
  if (!isValidIp(ip) || !isValidIp(mask)) return ip
  const n = (ipToNum(ip) | (~ipToNum(mask))) >>> 0
  return [(n >>> 24), (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff].join('.')
}

// Returns true when ip is a valid host address for the given mask.
// Rejects the network address (all host bits 0) and broadcast (all host bits 1).
// /31 (RFC 3021) and /32 are exceptions — both addresses are usable host addresses.
export function isHostAddress(ip, mask) {
  if (!isValidIp(ip) || !isValidMask(mask)) return false
  if (maskToPrefixLen(mask) >= 31) return true   // /31 RFC 3021 and /32 host routes
  return ip !== networkAddress(ip, mask) && ip !== broadcastAddress(ip, mask)
}

// Static DNS map for simulated internet hostname resolution.
const _DNS_MAP = {
  'google.com':       '8.8.8.8',
  'www.google.com':   '8.8.8.8',
  'dns.google':       '8.8.8.8',
  'cloudflare.com':   '1.1.1.1',
  'one.one.one.one':  '1.1.1.1',
  'github.com':       '140.82.121.4',
  'youtube.com':      '142.250.80.46',
  'reddit.com':       '151.101.65.140',
  'amazon.com':       '205.251.242.103',
}

export function resolveHostname(name) {
  if (!name || typeof name !== 'string') return null
  return _DNS_MAP[name.toLowerCase()] ?? null
}
