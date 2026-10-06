/**
 * IPv4 CIDR arithmetic for Azure address spaces (docs/AZURE_ACCURACY.md A1–A3a).
 * Builds on src/core/ipUtils — the same subnet math the on-prem track teaches; only
 * Azure's extra rules (five reserved addresses, blocked ranges) live here.
 */
import { isValidIp, ipToNum } from '../core/ipUtils.js'

const numToIp = n => [n >>> 24, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff].join('.')
const blockSize = prefix => 2 ** (32 - prefix)

/**
 * Parse "10.0.0.0/16" → { cidr, prefix, start, end } (start/end as numbers), or null when
 * malformed. The address must be the block's network address: "10.0.0.5/24" is refused
 * rather than silently rounded down (PHASE_1A §6a — Azure's exact handling not verified).
 */
export function parseCidr(cidr) {
  if (typeof cidr !== 'string') return null
  const m = /^(\d{1,3}(?:\.\d{1,3}){3})\/(\d{1,2})$/.exec(cidr.trim())
  if (!m || !isValidIp(m[1])) return null
  const prefix = Number(m[2])
  if (prefix < 0 || prefix > 32) return null
  const start = ipToNum(m[1])
  if (start % blockSize(prefix) !== 0) return null
  return { cidr: `${m[1]}/${prefix}`, prefix, start, end: start + blockSize(prefix) - 1 }
}

export const overlaps = (a, b) => a.start <= b.end && b.start <= a.end
export const contains = (outer, inner) => outer.start <= inner.start && inner.end <= outer.end

/** A2: the smallest IPv4 subnet is /29 and the largest /2. */
export const SUBNET_MIN_PREFIX = 2
export const SUBNET_MAX_PREFIX = 29

/** A3a: ranges that can't be added to a virtual network. */
export const BLOCKED_RANGES = Object.freeze([
  '224.0.0.0/4', '255.255.255.255/32', '127.0.0.0/8', '169.254.0.0/16', '168.63.129.16/32',
].map(parseCidr))

/** A3a: RFC 1918 plus RFC 6598 (treated as private in Azure). Anything else gets a warning. */
export const PRIVATE_RANGES = Object.freeze([
  '10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '100.64.0.0/10',
].map(parseCidr))

export function blockedRangeHit(block) {
  return BLOCKED_RANGES.find(b => overlaps(b, block)) ?? null
}

export function isPrivateBlock(block) {
  return PRIVATE_RANGES.some(p => contains(p, block))
}

/**
 * A1: Azure reserves the first four addresses and the last in every subnet —
 * network, default gateway (.1), two Azure DNS mappings (.2, .3), and broadcast.
 */
export function reservedAddresses(block) {
  return [block.start, block.start + 1, block.start + 2, block.start + 3, block.end].map(numToIp)
}

/** Usable host addresses: 2^(32−prefix) − 5. */
export function usableCount(block) {
  return Math.max(0, blockSize(block.prefix) - 5)
}

export function isReserved(block, ip) {
  return reservedAddresses(block).includes(ip)
}

export function containsIp(block, ip) {
  if (!isValidIp(ip)) return false
  const n = ipToNum(ip)
  return block.start <= n && n <= block.end
}

/** NIC page (L3): a dynamic address is "the next available address" in the subnet. */
export function nextFreeAddress(block, used) {
  for (let n = block.start + 4; n < block.end; n++) {
    const ip = numToIp(n)
    if (!used.includes(ip)) return ip
  }
  return null
}
