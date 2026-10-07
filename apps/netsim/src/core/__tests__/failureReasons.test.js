/**
 * failureReason registry (apps/netsim/src/core/failureReasons.js).
 *
 * R1  REASON constants and the registry agree, codes are unique and frozen
 * R2  every reason any existing test expects is in the registry
 * R3  the engine emits reasons only through REASON.* — no string literal left at an
 *     emission site in apps/netsim/src/onprem or apps/netsim/src/guest
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { REASON, FAILURE_REASONS, isKnownFailureReason } from '../failureReasons.js'

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (/\.(js|jsx)$/.test(e.name)) out.push(p)
  }
  return out
}

const SNAKE = /['"]([a-z]+(?:_[a-z]+)+)['"]/g
const literals = line => [...line.matchAll(SNAKE)].map(m => m[1])

describe('R1 — registry shape', () => {
  it('REASON values and registry keys are the same set of codes', () => {
    expect(Object.values(REASON).sort()).toEqual(Object.keys(FAILURE_REASONS).sort())
  })

  it('every entry is { code, domain: onprem, source, description } and frozen', () => {
    for (const [code, entry] of Object.entries(FAILURE_REASONS)) {
      expect(entry.code).toBe(code)
      expect(entry.domain).toBe('onprem')
      expect(['path', 'dns']).toContain(entry.source)
      expect(entry.description.length).toBeGreaterThan(10)
      expect(Object.isFrozen(entry)).toBe(true)
    }
    expect(Object.isFrozen(FAILURE_REASONS)).toBe(true)
    expect(Object.isFrozen(REASON)).toBe(true)
  })

  it('keeps the exact strings the engine has always emitted', () => {
    expect(REASON).toEqual({
      NO_ROUTE: 'no_route', ADMIN_DOWN: 'admin_down', LINK_DOWN: 'link_down',
      VLAN_ISOLATED: 'vlan_isolated', SUBNET_MISMATCH: 'subnet_mismatch',
      HOST_NO_GATEWAY: 'host_no_gateway', NO_RETURN_PATH: 'no_return_path',
      NAT_REQUIRED: 'nat_required', BLOCKED_BY_FIREWALL: 'blocked_by_firewall',
      DNS_NO_SERVER: 'dns_no_server', DNS_UNREACHABLE: 'dns_unreachable',
      DNS_REFUSED: 'dns_refused', DNS_NXDOMAIN: 'dns_nxdomain',
    })
  })

  it('isKnownFailureReason accepts registered codes only', () => {
    expect(isKnownFailureReason('no_route')).toBe(true)
    expect(isKnownFailureReason('gateway_unreachable')).toBe(false)   // planned, not emitted
    expect(isKnownFailureReason('toString')).toBe(false)
  })
})

describe('R2 — every reason the test suite expects is registered', () => {
  // A line that talks about `failureReason` contributes every snake_case literal on it;
  // a line that talks about a plain `reason` contributes only dns_* literals (the DHCP
  // client has its own `reason` values, which are not path/DNS failure reasons).
  const expected = new Set()
  for (const file of walk(SRC).filter(f => f.includes(`${path.sep}__tests__${path.sep}`))) {
    if (file.endsWith('failureReasons.test.js')) continue
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      if (/failureReason/.test(line)) literals(line).forEach(c => expected.add(c))
      else if (/\breason\b/.test(line)) literals(line).filter(c => c.startsWith('dns_')).forEach(c => expected.add(c))
    }
  }

  it('the scan finds the reasons the suite is known to assert (guards a broken scan)', () => {
    for (const c of ['no_route', 'no_return_path', 'vlan_isolated', 'blocked_by_firewall', 'nat_required', 'dns_nxdomain'])
      expect(expected).toContain(c)
  })

  it('none of them is missing from the registry', () => {
    expect([...expected].filter(c => !isKnownFailureReason(c))).toEqual([])
  })
})

describe('R3 — the engine emits reasons only through REASON', () => {
  const EMISSION = [
    /_pingResult\([^,]+,\s*[^,]*['"][a-z_]+['"]/,     // _pingResult(false, 'no_route', …)
    /failureReason:\s*[^,}]*['"][a-z_]+['"]/,        // { failureReason: 'nat_required' }
    /\breason:\s*[^,}]*['"]dns_[a-z_]+['"]/,         // { reason: 'dns_nxdomain' }
  ]
  it('no reason literal at an emission site in apps/netsim/src/onprem or apps/netsim/src/guest', () => {
    const bad = []
    for (const area of ['onprem', 'guest']) {
      for (const file of walk(path.join(SRC, area)).filter(f => !f.includes('__tests__'))) {
        fs.readFileSync(file, 'utf8').split(/\r?\n/).forEach((line, i) => {
          if (!line.trim().startsWith('//') && EMISSION.some(re => re.test(line)))
            bad.push(`${area}/${path.basename(file)}:${i + 1}: ${line.trim()}`)
        })
      }
    }
    expect(bad).toEqual([])
  })
})
