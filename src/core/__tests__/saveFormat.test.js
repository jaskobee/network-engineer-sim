/**
 * Save-format versioning (src/core/saveFormat.js) — roadmap §3.5, Phase 0 step 5.
 *
 * V1  a file without schemaVersion is schemaVersion 1
 * V2  a node without domain is on-prem
 * V3  only 'onprem' is a valid domain until cloud arrives
 */
import { describe, it, expect } from 'vitest'
import { SCHEMA_VERSION, DOMAINS, DEFAULT_DOMAIN, schemaVersionOf, domainOf } from '../saveFormat.js'

describe('V1 — schemaVersion', () => {
  it('current schema is 1', () => expect(SCHEMA_VERSION).toBe(1))
  it('a pre-Phase-0 file (no field) reads as 1', () => {
    expect(schemaVersionOf({ version: 2, devices: [] })).toBe(1)
    expect(schemaVersionOf(null)).toBe(1)
  })
  it('an explicit value is kept', () => expect(schemaVersionOf({ schemaVersion: 1 })).toBe(1))
})

describe('V2 — domain', () => {
  it('a node without domain is on-prem', () => {
    expect(domainOf({ id: 'dev-1', type: 'pc' })).toBe('onprem')
    expect(domainOf(undefined)).toBe('onprem')
  })
  it('an explicit domain is kept', () => expect(domainOf({ domain: 'onprem' })).toBe('onprem'))
})

describe('V3 — known domains', () => {
  it('only onprem exists in Phase 0, and it is the default', () => {
    expect(DOMAINS).toEqual(['onprem'])
    expect(DEFAULT_DOMAIN).toBe('onprem')
    expect(Object.isFrozen(DOMAINS)).toBe(true)
  })
})
