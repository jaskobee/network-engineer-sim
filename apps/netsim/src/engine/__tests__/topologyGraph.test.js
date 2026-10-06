/**
 * The device-level topology (engine/topologyGraph.js) and its tie to the job it illustrates:
 *   G1 - layered layout: root on top, children below, nothing overlapping, all cables drawn
 *   G2 - checkTopology catches a picture that has drifted from the job
 *   G3 - every real job's topology matches its own deviceRoles and cabling objectives
 */
import { describe, it, expect } from 'vitest'
import { layoutTopology, cabledPairs, checkTopology } from '../topologyGraph.js'
import { MISSION_DEFINITIONS } from '../../data/missionDefinitions/index.js'

const shop = {
  nodes: [
    { id: 'router', label: 'Router', type: 'router' }, { id: 'switch', label: 'Switch', type: 'switch' },
    { id: 'pc1', label: 'PC-1', type: 'pc' }, { id: 'pc2', label: 'PC-2', type: 'pc' }, { id: 'pc3', label: 'PC-3', type: 'pc' },
  ],
  cables: [['router', 'switch'], ['switch', 'pc1'], ['switch', 'pc2'], ['switch', 'pc3']],
}
const overlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

describe('G1 — layout', () => {
  const L = layoutTopology(shop)
  const at = id => L.nodes.find(n => n.id === id)

  it('the router is on top, the switch below it, the PCs below that', () => {
    expect(at('router').y).toBeLessThan(at('switch').y)
    expect(at('switch').y).toBeLessThan(at('pc1').y)
    expect(at('pc1').y).toBe(at('pc2').y)
    expect(at('pc2').y).toBe(at('pc3').y)
  })
  it('each layer is centred over the widest one', () => {
    const cx = n => n.x + n.w / 2
    expect(cx(at('router'))).toBeCloseTo(L.width / 2, 5)
    expect(cx(at('pc2'))).toBeCloseTo(L.width / 2, 5)
  })
  it('no two devices overlap and everything is inside the drawing', () => {
    for (let i = 0; i < L.nodes.length; i++) {
      const n = L.nodes[i]
      expect(n.x).toBeGreaterThanOrEqual(0); expect(n.y).toBeGreaterThanOrEqual(0)
      expect(n.x + n.w).toBeLessThanOrEqual(L.width); expect(n.y + n.h).toBeLessThanOrEqual(L.height)
      for (let j = i + 1; j < L.nodes.length; j++) expect(overlap(n, L.nodes[j])).toBe(false)
    }
  })
  it('every cable is drawn, from the bottom of the upper device to the top of the lower one', () => {
    expect(L.edges).toHaveLength(4)
    const e = L.edges.find(e => e.a === 'router' && e.b === 'switch')
    expect(e.y1).toBe(at('router').y + at('router').h)
    expect(e.y2).toBe(at('switch').y)
  })
  const star = n => ({ nodes: [{ id: 'sw', label: 'Switch', type: 'switch' }, ...Array.from({ length: n }, (_, i) => ({ id: `p${i}`, label: `PC-${i}`, type: 'pc' }))], cables: Array.from({ length: n }, (_, i) => ['sw', `p${i}`]) })
  const rowsOf = M => { const byRow = {}; for (const n of M.nodes.filter(n => n.id !== 'sw')) (byRow[n.y] ??= []).push(n); return Object.values(byRow) }

  it('a wide layer wraps onto further rows — never more than three devices across up to six — so the text stays readable', () => {
    for (const n of [4, 5, 6]) {
      const M = layoutTopology(star(n))
      expect(rowsOf(M).length).toBe(n <= 3 ? 1 : 2)
      for (const row of rowsOf(M)) expect(row.length).toBeLessThanOrEqual(3)
      // the SVG is shown ~508px wide, so it is scaled UP and 11.5px text stays ≥ 12.5px
      expect(M.width).toBeLessThanOrEqual(508 / 1.087)
    }
  })
  it('rows split evenly (5 → 3 + 2, 8 → 4 + 4)', () => {
    expect(rowsOf(layoutTopology(star(5))).map(r => r.length).sort()).toEqual([2, 3])
    expect(rowsOf(layoutTopology(star(8))).map(r => r.length)).toEqual([4, 4])
  })
  it('no two devices overlap, whatever the size', () => {
    for (const n of [2, 3, 4, 5, 6, 7, 8, 12]) {
      const M = layoutTopology(star(n))
      for (let i = 0; i < M.nodes.length; i++) for (let j = i + 1; j < M.nodes.length; j++) expect(overlap(M.nodes[i], M.nodes[j])).toBe(false)
    }
  })
  it('a cable never runs through a device it does not join (drops land in the gaps) — for every layer size up to twelve', () => {
    for (const n of [3, 4, 5, 6, 7, 8, 9, 12]) {
      const M = layoutTopology(star(n))
      for (const e of M.edges) {
        const busY = e.y1 + 23
        for (const node of M.nodes) {
          if (node.id === e.a || node.id === e.b) continue
          const inX = e.x2 > node.x && e.x2 < node.x + node.w
          const inY = node.y < e.y2 && node.y + node.h > busY
          expect(inX && inY, `n=${n}: cable ${e.a}–${e.b} runs through ${node.id}`).toBe(false)
        }
      }
    }
  })
  it('cables are right-angle paths that start at the upper device and end at the lower one', () => {
    const e = layoutTopology(shop).edges.find(e => e.a === 'switch' && e.b === 'pc1')
    expect(e.d).toMatch(/^M[\d.]+ [\d.]+ V[\d.]+ H[\d.]+ V[\d.]+$/)
  })
  it('a firewall or ISP is the root when there is one; unreachable devices are still drawn', () => {
    const L2 = layoutTopology({ nodes: [{ id: 'pc', label: 'PC', type: 'pc' }, { id: 'fw', label: 'FW', type: 'firewall' }, { id: 'x', label: 'Loose', type: 'pc' }], cables: [['pc', 'fw']] })
    expect(L2.nodes.find(n => n.id === 'fw').y).toBeLessThan(L2.nodes.find(n => n.id === 'pc').y)
    expect(L2.nodes).toHaveLength(3)
  })
  it('long names wrap to two lines and the box grows', () => {
    const L3 = layoutTopology({ nodes: [{ id: 'a', label: 'A very long device name here', type: 'pc' }], cables: [] })
    expect(L3.nodes[0].lines.length).toBe(2)
    expect(L3.nodes[0].h).toBeGreaterThan(layoutTopology({ nodes: [{ id: 'a', label: 'PC', type: 'pc' }], cables: [] }).nodes[0].h)
  })
  it('new nodes are marked', () => {
    expect(layoutTopology({ ...shop, newNodes: ['pc3'] }).nodes.find(n => n.id === 'pc3').isNew).toBe(true)
  })
  it('an empty topology is an empty drawing', () => {
    expect(layoutTopology({})).toEqual({ nodes: [], edges: [], width: 0, height: 0 })
  })
})

describe('G2 — the checker', () => {
  const mission = over => ({
    deviceRoles: { router: { type: 'router' }, switch: { type: 'switch' }, pc1: { type: 'pc' } },
    objectives: [{ id: 't', condition: { type: 'and', conditions: [{ type: 'cabled', roleA: 'router', roleB: 'switch' }, { type: 'cabled', roleA: 'switch', roleB: 'pc1' }] } }],
    blueprint: { topology: { nodes: [{ id: 'router', label: 'R', type: 'router' }, { id: 'switch', label: 'S', type: 'switch' }, { id: 'pc1', label: 'P', type: 'pc' }], cables: [['router', 'switch'], ['switch', 'pc1']] } },
    ...over,
  })
  it('a matching picture has no problems', () => { expect(checkTopology(mission())).toEqual([]) })
  it('cabledPairs finds cables nested in and/or and ignores not', () => {
    const pairs = cabledPairs([{ condition: { type: 'and', conditions: [{ type: 'cabled', roleA: 'a', roleB: 'b' }, { type: 'or', conditions: [{ type: 'cabled', roleA: 'c', roleB: 'd' }] }, { type: 'not', condition: { type: 'cabled', roleA: 'x', roleB: 'y' } }] } }])
    expect(pairs).toEqual([['a', 'b'], ['c', 'd']])
  })
  it('flags a cable the job asks for that the picture omits', () => {
    const m = mission(); m.blueprint.topology.cables = [['router', 'switch']]
    expect(checkTopology(m).join()).toMatch(/asks for a cable switch–pc1/)
    expect(checkTopology(m).join()).toMatch(/not cabled to anything/)
  })
  it('flags a node that is not a role, a wrong type, a duplicate cable and an unknown new node', () => {
    const m = mission(); const t = m.blueprint.topology
    t.nodes.push({ id: 'ghost', label: 'G', type: 'pc' }); t.nodes[2].type = 'server'; t.cables.push(['router', 'switch']); t.newNodes = ['nope']
    const p = checkTopology(m).join('\n')
    expect(p).toMatch(/"ghost" is not one of the mission's deviceRoles/)
    expect(p).toMatch(/"pc1" is a server here but a pc/)
    expect(p).toMatch(/drawn twice/)
    expect(p).toMatch(/newNodes lists "nope"/)
  })
  it('hardware from an earlier job may be marked existing instead of being a role', () => {
    const m = mission(); m.blueprint.topology.nodes.push({ id: 'old', label: 'Old', type: 'pc', existing: true }); m.blueprint.topology.cables.push(['switch', 'old'])
    expect(checkTopology(m)).toEqual([])
  })
})

describe('G3 — every real job\'s topology matches the job', () => {
  const jobs = Object.values(MISSION_DEFINITIONS).filter(m => m.blueprint?.topology)
  it('the client jobs have one', () => { expect(jobs.length).toBeGreaterThanOrEqual(2) })
  for (const m of jobs) it(`${m.id} — ${m.title}`, () => { expect(checkTopology(m)).toEqual([]) })
})
