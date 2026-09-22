/**
 * Subnet planner (sandbox tool) — the divide/join table.
 *
 * SP1 - reading input: CIDR in one field, prefix or dotted mask, host bits, bad masks
 * SP2 - subnet facts per row: range, broadcast, hosts, wildcard; /31 (RFC 3021) and /32
 * SP3 - divide / join: halves in address order, no gaps or overlaps, /32 can't divide
 * SP4 - join cells: each summary block starts on its first subnet's row and spans its rows
 * SP5 - encode / decode round trip; malformed codes are refused
 * SP6 - address space classification (RFC 1918, RFC 5737, RFC 6598, special blocks)
 */
import { describe, it, expect } from 'vitest'
import {
  parseNetwork, classifyNetwork, divide, join, layoutPlan, encodeTree, decodeTree,
  describeSubnet, LEAF,
} from '../subnetPlanner.js'
import { ipToNum } from '../../models/ipUtils.js'

// Divide along a list of paths, in order.
function plan(rootPrefix, ...paths) {
  return paths.reduce((t, p) => divide(t, p, rootPrefix), LEAF)
}
const cidrs = l => l.rows.map(r => r.subnet.cidr)

describe('SP1 reading input', () => {
  it('takes a prefix length with or without a slash', () => {
    expect(parseNetwork('192.168.0.0', '16')).toEqual({ ok: true, network: '192.168.0.0', prefix: 16, adjusted: null })
    expect(parseNetwork('192.168.0.0', '/16').prefix).toBe(16)
  })
  it('takes a dotted mask', () => {
    expect(parseNetwork('10.0.0.0', '255.255.252.0')).toMatchObject({ ok: true, prefix: 22 })
  })
  it('takes CIDR in the address field', () => {
    expect(parseNetwork('172.16.0.0/12', '')).toMatchObject({ ok: true, network: '172.16.0.0', prefix: 12 })
  })
  it('works on the network an address with host bits belongs to, and says so', () => {
    expect(parseNetwork('192.168.1.77', '24')).toEqual({
      ok: true, network: '192.168.1.0', prefix: 24, adjusted: { from: '192.168.1.77' },
    })
  })
  it('refuses a discontiguous mask', () => {
    const r = parseNetwork('10.0.0.0', '255.0.255.0')
    expect(r).toMatchObject({ ok: false, field: 'mask' })
    expect(r.error).toMatch(/not a valid mask/)
  })
  it('refuses bad addresses and prefix lengths', () => {
    expect(parseNetwork('192.168.1.256', '24')).toMatchObject({ ok: false, field: 'address' })
    expect(parseNetwork('192.168.01.0', '24')).toMatchObject({ ok: false, field: 'address' })
    expect(parseNetwork('192.168.1', '24')).toMatchObject({ ok: false, field: 'address' })
    expect(parseNetwork('192.168.1.0', '33')).toMatchObject({ ok: false, field: 'mask' })
    expect(parseNetwork('192.168.1.0', '')).toMatchObject({ ok: false, field: 'mask' })
  })
})

describe('SP2 subnet facts', () => {
  it('a /26: network, usable range, broadcast, 62 hosts, wildcard', () => {
    expect(describeSubnet(ipToNum('192.168.1.64'), 26)).toEqual({
      cidr: '192.168.1.64/26', network: '192.168.1.64', prefix: 26,
      mask: '255.255.255.192', wildcard: '0.0.0.63',
      first: '192.168.1.65', last: '192.168.1.126', broadcast: '192.168.1.127',
      hosts: 62, addresses: 64,
    })
  })
  it('a /30 point-to-point link has 2 hosts and a broadcast', () => {
    expect(describeSubnet(ipToNum('10.0.0.4'), 30)).toMatchObject({ first: '10.0.0.5', last: '10.0.0.6', broadcast: '10.0.0.7', hosts: 2 })
  })
  it('a /31 (RFC 3021) uses both addresses and has no broadcast', () => {
    expect(describeSubnet(ipToNum('10.0.0.4'), 31)).toMatchObject({ first: '10.0.0.4', last: '10.0.0.5', broadcast: null, hosts: 2 })
  })
  it('a /32 is one host', () => {
    expect(describeSubnet(ipToNum('10.0.0.4'), 32)).toMatchObject({ first: '10.0.0.4', last: '10.0.0.4', broadcast: null, hosts: 1, wildcard: '0.0.0.0' })
  })
  it('a /16 has 65534 hosts', () => {
    expect(describeSubnet(ipToNum('192.0.0.0'), 16).hosts).toBe(65534)
  })
})

describe('SP3 divide and join', () => {
  it('dividing a /24 gives the lower and upper /25 in address order', () => {
    const l = layoutPlan('192.168.1.0', 24, plan(24, []))
    expect(cidrs(l)).toEqual(['192.168.1.0/25', '192.168.1.128/25'])
  })

  it('VLSM: /24 → /25 + two /26 + /27s, contiguous with no gaps or overlaps', () => {
    const t = plan(24, [], [1], [1, 1])
    const l = layoutPlan('192.168.1.0', 24, t)
    expect(cidrs(l)).toEqual(['192.168.1.0/25', '192.168.1.128/26', '192.168.1.192/27', '192.168.1.224/27'])
    let next = ipToNum('192.168.1.0')
    for (const r of l.rows) {
      expect(ipToNum(r.subnet.network)).toBe(next)
      next += r.subnet.addresses
    }
    expect(next).toBe(ipToNum('192.168.2.0'))
  })

  it('the example from the brief: 192.0.0.0/16 divided into /17s and /18s', () => {
    const l = layoutPlan('192.0.0.0', 16, plan(16, [], [0], [1]))
    expect(cidrs(l)).toEqual(['192.0.0.0/18', '192.0.64.0/18', '192.0.128.0/18', '192.0.192.0/18'])
  })

  it('a /32 cannot be divided', () => {
    const t = plan(31, [])
    expect(divide(t, [0], 31)).toBe(t)
    expect(layoutPlan('10.0.0.0', 31, t).rows.map(r => r.subnet.cidr)).toEqual(['10.0.0.0/32', '10.0.0.1/32'])
  })

  it('dividing an already divided node or a missing path changes nothing', () => {
    const t = plan(24, [])
    expect(divide(t, [], 24)).toBe(t)
    expect(divide(t, [0, 0], 24)).toBe(t)
  })

  it('joining collapses everything under the node', () => {
    const t = plan(24, [], [1], [1, 1])
    expect(cidrs(layoutPlan('192.168.1.0', 24, join(t, [1])))).toEqual(['192.168.1.0/25', '192.168.1.128/25'])
    expect(join(t, [])).toBe(LEAF)
    expect(join(t, [0])).toBe(t)   // a leaf: nothing to join
  })

  it('divides from the top of the address space without overflow', () => {
    const l = layoutPlan('0.0.0.0', 0, plan(0, [], [1]))
    expect(cidrs(l)).toEqual(['0.0.0.0/1', '128.0.0.0/2', '192.0.0.0/2'])
    expect(l.rows[2].subnet.broadcast).toBe('255.255.255.255')
  })
})

describe('SP4 join cells', () => {
  it('each summary starts on its first subnet and spans the subnets it covers', () => {
    // /24 → [ /25 | /25 → [ /26 | /26 → [/27, /27] ] ]
    const l = layoutPlan('192.168.1.0', 24, plan(24, [], [1], [1, 1]))
    expect(l.columns).toBe(4)
    const view = l.rows.map(r => ({
      own: [r.subnet.prefix, r.ownColSpan],
      blocks: r.blocks.map(b => [b.summary.cidr, b.rowSpan]),
    }))
    expect(view).toEqual([
      { own: [25, 3], blocks: [['192.168.1.0/24', 4]] },
      { own: [26, 2], blocks: [['192.168.1.128/25', 3]] },
      { own: [27, 1], blocks: [['192.168.1.192/26', 2]] },
      { own: [27, 1], blocks: [] },
    ])
  })

  it('a row can start several blocks, smallest first', () => {
    const l = layoutPlan('10.0.0.0', 8, plan(8, [], [0], [0, 0]))
    expect(l.rows[0].blocks.map(b => b.summary.cidr)).toEqual(['10.0.0.0/10', '10.0.0.0/9', '10.0.0.0/8'])
    expect(l.rows[0].blocks.map(b => b.rowSpan)).toEqual([2, 3, 4])
  })

  it('an undivided network is one row with no summaries', () => {
    const l = layoutPlan('10.0.0.0', 8, LEAF)
    expect(l.columns).toBe(1)
    expect(l.rows).toHaveLength(1)
    expect(l.rows[0]).toMatchObject({ ownColSpan: 1, blocks: [] })
  })
})

describe('SP5 encode / decode', () => {
  it('round-trips', () => {
    const t = plan(24, [], [1], [1, 1], [0])
    expect(encodeTree(t)).toBe('110010100')
    expect(encodeTree(decodeTree(encodeTree(t)))).toBe(encodeTree(t))
    expect(encodeTree(LEAF)).toBe('0')
  })
  it('refuses malformed codes and trees deeper than the address space allows', () => {
    expect(decodeTree('')).toBeNull()
    expect(decodeTree('1')).toBeNull()
    expect(decodeTree('000')).toBeNull()
    expect(decodeTree('10x')).toBeNull()
    expect(decodeTree('100', 0)).toBeNull()     // a /32 root can't be divided
    expect(decodeTree('100', 1)).not.toBeNull()
  })
})

describe('SP6 address space', () => {
  it('names the RFC 1918 private ranges', () => {
    expect(classifyNetwork('192.168.10.0', 24)).toMatchObject({ kind: 'private', usable: true })
    expect(classifyNetwork('172.31.0.0', 16)).toMatchObject({ kind: 'private' })
    expect(classifyNetwork('10.0.0.0', 8)).toMatchObject({ kind: 'private' })
  })
  it('172.32.0.0 is outside 172.16.0.0/12 and is public', () => {
    expect(classifyNetwork('172.32.0.0', 16)).toEqual({ kind: 'public' })
  })
  it('documentation, CGNAT and non-host blocks', () => {
    expect(classifyNetwork('203.0.113.0', 30)).toMatchObject({ kind: 'documentation' })
    expect(classifyNetwork('100.64.0.0', 10)).toMatchObject({ kind: 'shared' })
    expect(classifyNetwork('169.254.0.0', 16)).toMatchObject({ kind: 'special', usable: false })
    expect(classifyNetwork('239.1.1.0', 24)).toMatchObject({ kind: 'special', usable: false })
    expect(classifyNetwork('127.0.0.0', 8)).toMatchObject({ kind: 'special', usable: false })
  })
  it('a network spanning special blocks lists them', () => {
    expect(classifyNetwork('192.0.0.0', 16)).toEqual({ kind: 'mixed', blocks: ['192.0.0.0/24', '192.0.2.0/24'] })
    expect(classifyNetwork('172.0.0.0', 8)).toEqual({ kind: 'mixed', blocks: ['172.16.0.0/12'] })
  })
})
