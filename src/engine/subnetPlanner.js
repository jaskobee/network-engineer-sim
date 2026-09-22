/**
 * Subnet planner — the model behind the sandbox's "Subnet planner" window: start from
 * one network, divide any subnet into two halves, join halves back together.
 *
 * The plan is a binary tree. Each node is a subnet; dividing a /n gives two /n+1
 * children (the lower half and the upper half of its addresses), and joining collapses
 * a node back to one subnet. Every leaf is a row in the table. Because a node only ever
 * splits into its own two halves, every plan is a valid VLSM layout with no overlaps and
 * no gaps, and every internal node is a summary route (aggregate) that covers exactly
 * the subnets under it.
 *
 * Subnet math comes from ipUtils / hostConfig.subnetFacts, so the planner agrees with
 * what the shells accept: /31 has two usable addresses and no broadcast (RFC 3021),
 * /32 is a single host.
 *
 * Pure JS — no React/DOM imports (engine rule 1).
 */
import { isValidIp, isValidMask, maskToPrefixLen, ipToNum } from '../models/ipUtils.js'
import { subnetFacts, prefixToMask } from './hostConfig.js'

// ── Addresses ─────────────────────────────────────────────────────────────────

export function numToIp(n) {
  return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff].join('.')
}

function maskNum(prefix) {
  return prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0
}

/** Number of addresses in a /prefix (2^(32-prefix)); a /0 is 4294967296. */
export function blockSize(prefix) {
  return 2 ** (32 - prefix)
}

/**
 * Read what the person typed. The address may carry its own prefix ("10.0.0.0/8"); the
 * mask may be a prefix length ("24" or "/24") or a dotted mask ("255.255.255.0").
 *
 * An address with host bits set is not refused — the planner works on the network it
 * belongs to and says so (`adjusted`), the way `ip route` would teach it: the network of
 * 192.168.1.77/24 is 192.168.1.0.
 *
 * → { ok: true, network, prefix, adjusted: null | { from } }
 * → { ok: false, field: 'address' | 'mask', error }
 */
export function parseNetwork(addressText, maskText) {
  let addr = String(addressText ?? '').trim()
  let mask = String(maskText ?? '').trim()
  const slash = addr.indexOf('/')
  if (slash !== -1) {
    if (mask === '') mask = addr.slice(slash)
    addr = addr.slice(0, slash).trim()
  }

  if (addr === '') return { ok: false, field: 'address', error: 'Enter a network address, for example 192.168.10.0.' }
  if (!isValidIp(addr)) {
    return { ok: false, field: 'address', error: 'An IPv4 address is four numbers from 0 to 255 separated by dots, with no leading zeros.' }
  }

  let prefix
  const m = /^\/?\s*(\d{1,2})$/.exec(mask)
  if (mask === '') {
    return { ok: false, field: 'mask', error: 'Enter a mask: a prefix length like /24 or a dotted mask like 255.255.255.0.' }
  } else if (m) {
    prefix = parseInt(m[1], 10)
    if (prefix > 32) return { ok: false, field: 'mask', error: 'A prefix length is 0 to 32.' }
  } else if (isValidIp(mask)) {
    if (!isValidMask(mask)) {
      return { ok: false, field: 'mask', error: `${mask} is not a valid mask: a mask is all ones followed by all zeros (255.255.255.0 is valid, 255.0.255.0 is not).` }
    }
    prefix = maskToPrefixLen(mask)
  } else {
    return { ok: false, field: 'mask', error: 'Enter a prefix length like /24 or a dotted mask like 255.255.255.0.' }
  }

  const network = numToIp((ipToNum(addr) & maskNum(prefix)) >>> 0)
  return { ok: true, network, prefix, adjusted: network === addr ? null : { from: addr } }
}

// ── Address space ────────────────────────────────────────────────────────────

// Special-purpose IPv4 blocks worth knowing (RFC 6890 registry, the ones a network
// engineer meets). `usable: false` = not for addressing hosts on a LAN.
export const SPECIAL_BLOCKS = [
  { network: '0.0.0.0',     prefix: 8,  kind: 'special',       name: '"This network" (RFC 1122)',             usable: false },
  { network: '10.0.0.0',    prefix: 8,  kind: 'private',       name: 'Private (RFC 1918)',                    usable: true },
  { network: '100.64.0.0',  prefix: 10, kind: 'shared',        name: 'Shared address space for carrier-grade NAT (RFC 6598)', usable: true },
  { network: '127.0.0.0',   prefix: 8,  kind: 'special',       name: 'Loopback (RFC 1122)',                   usable: false },
  { network: '169.254.0.0', prefix: 16, kind: 'special',       name: 'Link-local, self-assigned (RFC 3927)',  usable: false },
  { network: '172.16.0.0',  prefix: 12, kind: 'private',       name: 'Private (RFC 1918)',                    usable: true },
  { network: '192.0.0.0',   prefix: 24, kind: 'special',       name: 'IETF protocol assignments (RFC 6890)',  usable: false },
  { network: '192.0.2.0',   prefix: 24, kind: 'documentation', name: 'Documentation, TEST-NET-1 (RFC 5737)',  usable: true },
  { network: '192.168.0.0', prefix: 16, kind: 'private',       name: 'Private (RFC 1918)',                    usable: true },
  { network: '198.18.0.0',  prefix: 15, kind: 'benchmark',     name: 'Benchmarking (RFC 2544)',               usable: true },
  { network: '198.51.100.0',prefix: 24, kind: 'documentation', name: 'Documentation, TEST-NET-2 (RFC 5737)',  usable: true },
  { network: '203.0.113.0', prefix: 24, kind: 'documentation', name: 'Documentation, TEST-NET-3 (RFC 5737)',  usable: true },
  { network: '224.0.0.0',   prefix: 4,  kind: 'special',       name: 'Multicast (RFC 5771)',                  usable: false },
  { network: '240.0.0.0',   prefix: 4,  kind: 'special',       name: 'Reserved (RFC 1112), includes 255.255.255.255 broadcast', usable: false },
]

function contains(outerNet, outerPrefix, innerNet, innerPrefix) {
  return innerPrefix >= outerPrefix &&
    ((ipToNum(innerNet) & maskNum(outerPrefix)) >>> 0) === ipToNum(outerNet)
}

/**
 * What kind of address space a network is in.
 * → { kind, name, usable } for a network inside one special block,
 * → { kind: 'mixed', blocks: [...] } for a network that spans special blocks (e.g. 192.0.0.0/8),
 * → { kind: 'public' } otherwise.
 */
export function classifyNetwork(network, prefix) {
  const inside = SPECIAL_BLOCKS.find(b => contains(b.network, b.prefix, network, prefix))
  if (inside) return { kind: inside.kind, name: inside.name, usable: inside.usable }
  const spanned = SPECIAL_BLOCKS.filter(b => contains(network, prefix, b.network, b.prefix))
  if (spanned.length) return { kind: 'mixed', blocks: spanned.map(b => `${b.network}/${b.prefix}`) }
  return { kind: 'public' }
}

// ── The plan tree ─────────────────────────────────────────────────────────────
//
// A node is { kids: null } (a subnet in use) or { kids: [lower, upper] } (divided).
// A node is addressed by its path from the root: an array of 0 (lower half) / 1 (upper).

export const LEAF = Object.freeze({ kids: null })

function at(tree, path) {
  let n = tree
  for (const b of path) {
    if (!n?.kids) return null
    n = n.kids[b]
  }
  return n
}

function replaceAt(tree, path, fn) {
  if (path.length === 0) return fn(tree)
  const [b, ...rest] = path
  if (!tree.kids) return tree
  const kids = tree.kids.slice()
  kids[b] = replaceAt(kids[b], rest, fn)
  return { kids }
}

/** Split the subnet at `path` into its two halves. A /32 cannot be divided. */
export function divide(tree, path, rootPrefix) {
  const node = at(tree, path)
  if (!node || node.kids || rootPrefix + path.length >= 32) return tree
  return replaceAt(tree, path, () => ({ kids: [LEAF, LEAF] }))
}

/** Join everything under `path` back into one subnet. */
export function join(tree, path) {
  const node = at(tree, path)
  if (!node || !node.kids) return tree
  return replaceAt(tree, path, () => LEAF)
}

/** Pre-order bit string: '1' = divided, '0' = in use. The root alone is '0'. */
export function encodeTree(tree) {
  return tree.kids ? '1' + encodeTree(tree.kids[0]) + encodeTree(tree.kids[1]) : '0'
}

/** Inverse of encodeTree; null for a string that is not a complete tree within `maxDepth`. */
export function decodeTree(code, maxDepth = 32) {
  if (typeof code !== 'string' || !/^[01]+$/.test(code)) return null
  let i = 0
  function read(depth) {
    if (i >= code.length) throw new Error('short')
    if (code[i++] === '0') return LEAF
    if (depth >= maxDepth) throw new Error('deep')
    return { kids: [read(depth + 1), read(depth + 1)] }
  }
  try {
    const tree = read(0)
    return i === code.length ? tree : null
  } catch {
    return null
  }
}

// ── Table layout ─────────────────────────────────────────────────────────────

/** Everything the table shows about one subnet. */
export function describeSubnet(netNum, prefix) {
  const network = numToIp(netNum)
  const mask = prefixToMask(prefix)
  const f = subnetFacts(network, mask)
  return {
    cidr: `${network}/${prefix}`,
    network,
    prefix,
    mask,
    wildcard: numToIp((~maskNum(prefix)) >>> 0),
    first: f.first,
    last: f.last,
    broadcast: f.broadcast,   // null on /31 and /32
    hosts: f.hosts,
    addresses: blockSize(prefix),
  }
}

/**
 * Lay the plan out as table rows, top to bottom in address order.
 *
 * Each row is one subnet in use, plus the "join" cells that start on that row: the
 * subnet's own cell, then one cell for every larger block (summary) whose first subnet
 * this is, smallest block first. A cell spans (`rowSpan`) all the rows its block covers;
 * `colSpan` lines the cells up so each column holds one prefix length.
 *
 * Each row also carries `halves`: the two subnets Divide would make (null for a /32).
 *
 * → { root, rows, columns } where root describes the whole network and columns is the
 *   number of join columns (deepest level + 1).
 */
export function layoutPlan(rootNetwork, rootPrefix, tree) {
  const rootNum = ipToNum(rootNetwork)
  const rows = []
  let maxDepth = 0
  let pending = []   // blocks, outermost first, waiting for their first row

  function leafCount(n) { return n.kids ? leafCount(n.kids[0]) + leafCount(n.kids[1]) : 1 }

  function walk(node, netNum, depth, path) {
    const prefix = rootPrefix + depth
    if (node.kids) {
      pending.push({ path, prefix, rowSpan: leafCount(node), depth, summary: describeSubnet(netNum, prefix) })
      walk(node.kids[0], netNum, depth + 1, [...path, 0])
      walk(node.kids[1], (netNum + blockSize(prefix + 1)) >>> 0, depth + 1, [...path, 1])
      return
    }
    maxDepth = Math.max(maxDepth, depth)
    const blocks = pending.reverse()   // smallest (deepest) block first
    pending = []
    const halves = prefix < 32
      ? [describeSubnet(netNum, prefix + 1).cidr, describeSubnet((netNum + blockSize(prefix + 1)) >>> 0, prefix + 1).cidr]
      : null
    rows.push({ path, depth, subnet: describeSubnet(netNum, prefix), blocks, halves })
  }
  walk(tree, rootNum, 0, [])

  const columns = maxDepth + 1
  for (const r of rows) {
    r.ownColSpan = columns - r.depth
  }
  return { root: describeSubnet(rootNum, rootPrefix), rows, columns }
}

/** Key for a path, e.g. [0, 1, 1] → "011" (the root is ""). */
export function pathKey(path) {
  return path.join('')
}
