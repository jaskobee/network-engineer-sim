/**
 * Every rule a refusal or warning can cite links to the Microsoft Learn page that states it.
 *
 * RS1  each rule ID used in operations.js has a source
 * RS2  every source is a learn.microsoft.com page
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ruleSource, RULE_IDS_WITH_SOURCES } from '../ruleSources.js'

const src = fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../operations.js'), 'utf8')
// refuse(OUTCOME.X, 'I5', …) and { ruleId: 'A3a', … }
const used = [...new Set([
  ...[...src.matchAll(/refuse\(OUTCOME\.[A-Z_]+,\s*'([A-Za-z0-9]+)'/g)].map(m => m[1]),
  ...[...src.matchAll(/ruleId:\s*'([A-Za-z0-9]+)'/g)].map(m => m[1]),
])]

describe('rule sources', () => {
  it('RS1: the scan finds the rules operations.js cites (guards a broken scan)', () => {
    expect(used).toEqual(expect.arrayContaining(['I5', 'A3', 'A3a', 'L2', 'J9', 'K2', 'N1']))
  })
  it('RS1: every cited rule has a Microsoft Learn source', () => {
    expect(used.filter(id => !ruleSource(id))).toEqual([])
  })
  it('RS2: all sources are learn.microsoft.com pages', () => {
    for (const id of RULE_IDS_WITH_SOURCES) expect(ruleSource(id).url).toMatch(/^https:\/\/learn\.microsoft\.com\//)
    expect(ruleSource(null)).toBe(null)
  })
})
