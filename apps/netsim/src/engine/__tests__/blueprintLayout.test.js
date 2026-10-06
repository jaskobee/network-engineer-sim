/**
 * Every job's blueprint is legible — checked by geometry, for every mission that has one (and, because
 * it walks the registries, for every job added later):
 *   B1 - the layout module wraps text and sizes boxes from their content
 *   B2 - links carry their label at the link's midpoint, on a plate, so two links into one box cannot collide
 *   B3 - checkBlueprint flags overlaps, clipping, labels on boxes and unknown links
 *   B4 - every real mission's blueprint passes it
 */
import { describe, it, expect } from 'vitest'
import { wrapText, segmentLayout, blueprintLinks, checkBlueprint, parseViewBox, SEG_W } from '../blueprintLayout.js'
import { MISSIONS } from '../../data/missions.js'
import { MISSION_DEFINITIONS } from '../../data/missionDefinitions/index.js'

const seg = (over = {}) => ({ id: 'a', label: 'LAN', subnet: '10.0.0.0/24', devices: [{ role: 'PC', type: 'pc' }], svgX: 8, svgY: 8, ...over })

describe('B1 — text wraps, boxes grow', () => {
  it('wrapText breaks on words and never exceeds the width', () => {
    const lines = wrapText('alpha beta gamma delta epsilon', 60, 5)
    expect(lines.length).toBeGreaterThan(1)
    for (const l of lines) expect(l.length * 5).toBeLessThanOrEqual(60 + 30)   // a word may only overshoot by its own length
    expect(lines.join(' ')).toBe('alpha beta gamma delta epsilon')
  })
  it('a long device note wraps onto more lines, making the box taller — not wider', () => {
    const short = segmentLayout(seg())
    const long = segmentLayout(seg({ devices: [{ role: 'R1  (ROAS + DHCP + NAT overload, 10.0.0.1)', type: 'router' }] }))
    expect(long.w).toBe(SEG_W)
    expect(long.h).toBeGreaterThan(short.h)
    expect(long.devices[0].lines.length).toBeGreaterThan(1)
  })
  it('a long subnet line wraps instead of running out of the box', () => {
    const l = segmentLayout(seg({ subnet: '10.0.0.0/30 link  •  VLANs 192.168.10–40.0/24 behind R1' }))
    expect(l.sub.lines.length).toBeGreaterThan(1)
  })
  it('text beyond the line limit is truncated with an ellipsis', () => {
    expect(wrapText('a '.repeat(200), 60, 5, 2).at(-1)).toMatch(/…$/)
  })
})

describe('B2 — link labels', () => {
  const bp = {
    svgViewBox: '0 0 420 240',
    segments: [seg({ id: 'l1', svgX: 8, svgY: 20 }), seg({ id: 'l2', svgX: 8, svgY: 140 }), seg({ id: 'r', svgX: 257, svgY: 20 })],
    links: [{ from: 'l1', to: 'r', label: 'one' }, { from: 'l2', to: 'r', label: 'two' }],
  }
  it('two links into the same box get labels in different places', () => {
    const [a, b] = blueprintLinks(bp)
    expect(a.label.rect.y).not.toBeCloseTo(b.label.rect.y, 0)
    expect(checkBlueprint(bp)).toEqual([])
  })
  it('the label is centred on the link', () => {
    const [a] = blueprintLinks(bp)
    expect(a.label.rect.x + a.label.rect.w / 2).toBeCloseTo((a.x1 + a.x2) / 2, 5)
  })
  it('links to unknown segments are dropped from the drawing', () => {
    expect(blueprintLinks({ segments: [seg()], links: [{ from: 'a', to: 'nope', label: 'x' }] })).toEqual([])
  })
})

describe('B3 — the checker', () => {
  it('flags overlapping boxes', () => {
    expect(checkBlueprint({ svgViewBox: '0 0 400 200', segments: [seg({ id: 'a' }), seg({ id: 'b', svgX: 60 })], links: [] }).join()).toMatch(/overlap/)
  })
  it('flags a box outside the viewBox', () => {
    expect(checkBlueprint({ svgViewBox: '0 0 100 100', segments: [seg()], links: [] }).join()).toMatch(/outside the viewBox/)
  })
  it('flags a label that runs into a box (gap too narrow)', () => {
    const p = checkBlueprint({
      svgViewBox: '0 0 400 200',
      segments: [seg({ id: 'a', svgX: 8 }), seg({ id: 'b', svgX: 190 })],     // 27px gap
      links: [{ from: 'a', to: 'b', label: 'a very long link label' }],
    })
    expect(p.join()).toMatch(/runs into/)
  })
  it('flags two labels on top of each other', () => {
    const p = checkBlueprint({
      svgViewBox: '0 0 420 240',
      segments: [seg({ id: 'a', svgX: 8, svgY: 20 }), seg({ id: 'b', svgX: 257, svgY: 20 })],
      links: [{ from: 'a', to: 'b', label: 'first' }, { from: 'b', to: 'a', label: 'second' }],
    })
    expect(p.join()).toMatch(/overlap/)
  })
  it('flags a link to a segment that does not exist', () => {
    expect(checkBlueprint({ svgViewBox: '0 0 400 200', segments: [seg()], links: [{ from: 'a', to: 'ghost', label: 'x' }] }).join()).toMatch(/does not exist/)
  })
  it('parseViewBox has a sensible default', () => {
    expect(parseViewBox(undefined)).toEqual({ x: 0, y: 0, w: 400, h: 200 })
  })
})

describe('B4 — every real job\'s blueprint is legible', () => {
  const jobs = [...MISSIONS, ...Object.values(MISSION_DEFINITIONS)].filter(m => m.blueprint?.segments?.length)
  it('there are blueprints to check', () => { expect(jobs.length).toBeGreaterThanOrEqual(4) })
  for (const m of jobs) {
    it(`${m.id} — ${m.title}`, () => { expect(checkBlueprint(m.blueprint)).toEqual([]) })
  }
})
