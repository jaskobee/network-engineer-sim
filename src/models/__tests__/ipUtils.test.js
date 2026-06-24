import { describe, it, expect } from 'vitest'
import {
  isValidIp, isValidMask, maskToPrefixLen, networkAddress,
  broadcastAddress, isHostAddress, ipToNum,
} from '../ipUtils.js'

// ── isValidIp ─────────────────────────────────────────────────────────────────

describe('isValidIp', () => {
  it.each([
    ['192.168.1.1'],
    ['0.0.0.0'],
    ['255.255.255.255'],
    ['10.0.0.1'],
    ['172.16.0.1'],
  ])('accepts valid IP %s', (ip) => {
    expect(isValidIp(ip)).toBe(true)
  })

  it.each([
    ['256.0.0.1',    'octet > 255'],
    ['192.168.1',    'only 3 octets'],
    ['192.168.1.1.1','5 octets'],
    ['192.168.1.-1', 'negative octet'],
    ['192.168.01.1', 'leading zero'],
    ['192.168.1.abc','non-numeric'],
    ['',             'empty string'],
    ['192.168.1. 1', 'space in octet'],
  ])('rejects %s (%s)', (ip) => {
    expect(isValidIp(ip)).toBe(false)
  })

  it('rejects non-string input', () => {
    expect(isValidIp(null)).toBe(false)
    expect(isValidIp(undefined)).toBe(false)
    expect(isValidIp(192)).toBe(false)
  })
})

// ── isValidMask ───────────────────────────────────────────────────────────────

describe('isValidMask', () => {
  it.each([
    ['0.0.0.0',         '/0'],
    ['128.0.0.0',       '/1'],
    ['255.0.0.0',       '/8'],
    ['255.255.0.0',     '/16'],
    ['255.255.255.0',   '/24'],
    ['255.255.255.128', '/25'],
    ['255.255.255.252', '/30'],
    ['255.255.255.254', '/31'],
    ['255.255.255.255', '/32'],
  ])('accepts contiguous mask %s (%s)', (mask) => {
    expect(isValidMask(mask)).toBe(true)
  })

  it.each([
    ['255.0.255.0',     'discontiguous (holes)'],
    ['255.255.0.255',   'discontiguous (inverted end)'],
    ['128.255.255.255', 'discontiguous (leading hole)'],
    ['0.255.255.255',   'discontiguous (all after)'],
  ])('rejects discontiguous mask %s (%s)', (mask) => {
    expect(isValidMask(mask)).toBe(false)
  })

  it('rejects a non-IP string as mask', () => {
    expect(isValidMask('not-a-mask')).toBe(false)
  })
})

// ── maskToPrefixLen ───────────────────────────────────────────────────────────

describe('maskToPrefixLen — round-trip /0 through /32', () => {
  const PREFIX_TO_MASK = [
    [0,  '0.0.0.0'],
    [1,  '128.0.0.0'],
    [8,  '255.0.0.0'],
    [16, '255.255.0.0'],
    [24, '255.255.255.0'],
    [25, '255.255.255.128'],
    [30, '255.255.255.252'],
    [31, '255.255.255.254'],
    [32, '255.255.255.255'],
  ]

  it.each(PREFIX_TO_MASK)('/%i → %s → /%i', (pfx, mask) => {
    expect(maskToPrefixLen(mask)).toBe(pfx)
  })
})

// ── networkAddress ────────────────────────────────────────────────────────────

describe('networkAddress', () => {
  it.each([
    ['192.168.1.10',  '255.255.255.0',   '192.168.1.0'],
    ['192.168.1.200', '255.255.255.128', '192.168.1.128'],
    ['10.0.0.2',      '255.255.255.252', '10.0.0.0'],
    ['172.16.5.17',   '255.255.0.0',    '172.16.0.0'],
    ['0.0.0.1',       '0.0.0.0',        '0.0.0.0'],
    ['255.255.255.255','255.255.255.255','255.255.255.255'],
  ])('networkAddress(%s, %s) = %s', (ip, mask, expected) => {
    expect(networkAddress(ip, mask)).toBe(expected)
  })
})

// ── broadcastAddress ──────────────────────────────────────────────────────────

describe('broadcastAddress', () => {
  it.each([
    ['192.168.1.10',  '255.255.255.0',   '192.168.1.255'],
    ['192.168.1.10',  '255.255.255.128', '192.168.1.127'],
    ['10.0.0.1',      '255.255.255.252', '10.0.0.3'],
    ['10.0.0.2',      '255.255.255.252', '10.0.0.3'],
    ['0.0.0.0',       '0.0.0.0',        '255.255.255.255'],
  ])('broadcastAddress(%s, %s) = %s', (ip, mask, expected) => {
    expect(broadcastAddress(ip, mask)).toBe(expected)
  })
})

// ── isHostAddress ─────────────────────────────────────────────────────────────

describe('isHostAddress', () => {
  describe('/24 subnet (192.168.1.0/24)', () => {
    const mask = '255.255.255.0'
    it('rejects the network address', () => expect(isHostAddress('192.168.1.0',   mask)).toBe(false))
    it('rejects the broadcast address', () => expect(isHostAddress('192.168.1.255', mask)).toBe(false))
    it('accepts first usable host',   () => expect(isHostAddress('192.168.1.1',   mask)).toBe(true))
    it('accepts last usable host',    () => expect(isHostAddress('192.168.1.254', mask)).toBe(true))
  })

  describe('/30 subnet (10.0.0.0/30)', () => {
    const mask = '255.255.255.252'
    it('rejects the network address',   () => expect(isHostAddress('10.0.0.0', mask)).toBe(false))
    it('rejects the broadcast address', () => expect(isHostAddress('10.0.0.3', mask)).toBe(false))
    it('accepts .1',                    () => expect(isHostAddress('10.0.0.1', mask)).toBe(true))
    it('accepts .2',                    () => expect(isHostAddress('10.0.0.2', mask)).toBe(true))
  })

  describe('/31 (RFC 3021) — both addresses are usable', () => {
    const mask = '255.255.255.254'
    it('accepts .0 (would be network for /32)', () => expect(isHostAddress('10.0.0.0', mask)).toBe(true))
    it('accepts .1 (would be broadcast for /32)', () => expect(isHostAddress('10.0.0.1', mask)).toBe(true))
  })

  describe('/32 — single host route', () => {
    const mask = '255.255.255.255'
    it('accepts the single address', () => expect(isHostAddress('192.168.1.1', mask)).toBe(true))
  })

  describe('/25 boundary — correct side of the 128 split', () => {
    const mask = '255.255.255.128'
    it('rejects 192.168.1.0 (network)',   () => expect(isHostAddress('192.168.1.0',   mask)).toBe(false))
    it('accepts 192.168.1.1',             () => expect(isHostAddress('192.168.1.1',   mask)).toBe(true))
    it('accepts 192.168.1.126',           () => expect(isHostAddress('192.168.1.126', mask)).toBe(true))
    it('rejects 192.168.1.127 (broadcast)', () => expect(isHostAddress('192.168.1.127', mask)).toBe(false))
    it('rejects 192.168.1.128 (network of upper half)', () => expect(isHostAddress('192.168.1.128', mask)).toBe(false))
    it('accepts 192.168.1.129',           () => expect(isHostAddress('192.168.1.129', mask)).toBe(true))
    it('rejects 192.168.1.255 (broadcast upper)', () => expect(isHostAddress('192.168.1.255', mask)).toBe(false))
  })

  it('rejects a discontiguous mask', () => {
    expect(isHostAddress('192.168.1.1', '255.0.255.0')).toBe(false)
  })
})
