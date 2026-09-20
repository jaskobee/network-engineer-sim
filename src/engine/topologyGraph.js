/**
 * A job's device-level topology — the routers, switches and PCs and the cables between them — laid out as
 * layers (the router at the top, what hangs off it below). Pure functions, no React, no DOM.
 *
 * Authored on a mission as
 *   blueprint.topology = { nodes: [{ id, label, type }], cables: [[idA, idB], …], newNodes?: [id, …] }
 * where `id`s are the mission's `deviceRoles` keys. checkTopology() ties it back to the mission so the picture
 * cannot drift from the job: every node is a real role of the same device type, every cable the objectives
 * ask for is drawn, and nothing is left floating.
 */
import { wrapText } from './blueprintLayout.js'

const NODE_W = 112
const GAP_X = 16
const GAP_Y = 46
const MARGIN = 10
const LINE_H = 14.5
const CH = 5.3                 // px per character at 11.5px, rounded up so labels wrap rather than spill
const MAX_ROW = 3              // wider than this and the picture is scaled down until its text is unreadable
const PITCH = NODE_W + GAP_X
const ROOT_TYPES = ['router', 'firewall', 'isp']

function nodeHeight(lines) { return 14 + lines * LINE_H }

/**
 * n nodes over as few rows as possible, as evenly as possible: up to MAX_ROW across; a bigger layer uses just two
 * (wider) rows rather than three, because with three there is no way to run every cable down a gap. (5 → 3 + 2,
 * 6 → 3 + 3, 8 → 4 + 4.) A very large layer degrades to smaller text rather than tangled cables.
 */
function rowSizes(n) {
  const rows = n <= MAX_ROW * 2 ? Math.ceil(n / MAX_ROW) : n <= 12 ? 2 : Math.ceil(n / 6)
  const base = Math.floor(n / rows), extra = n % rows
  return Array.from({ length: rows }, (_, i) => base + (i < extra ? 1 : 0))
}

/**
 * Layers by distance from the root (the first router / firewall / ISP, else the first node). A layer with
 * more than MAX_ROW devices wraps onto further rows, each shifted half a device sideways so the cable that
 * drops to it runs down the gap between the devices above. Returns
 * { nodes: [{ id, label, type, isNew, lines, x, y, w, h }],
 *   edges: [{ a, b, x1, y1, x2, y2, d }], width, height } — `d` is the right-angle path to draw.
 */
export function layoutTopology(topology) {
  const nodes = topology.nodes ?? []
  const cables = topology.cables ?? []
  if (nodes.length === 0) return { nodes: [], edges: [], width: 0, height: 0 }

  const adj = new Map(nodes.map(n => [n.id, []]))
  for (const [a, b] of cables) { adj.get(a)?.push(b); adj.get(b)?.push(a) }

  const root = nodes.find(n => ROOT_TYPES.includes(n.type)) ?? nodes[0]
  const depth = new Map([[root.id, 0]])
  const queue = [root.id]
  while (queue.length) {
    const id = queue.shift()
    for (const nb of adj.get(id) ?? []) if (!depth.has(nb)) { depth.set(nb, depth.get(id) + 1); queue.push(nb) }
  }
  // anything not reachable from the root is still drawn — on its own last row
  const last = Math.max(...depth.values())
  for (const n of nodes) if (!depth.has(n.id)) depth.set(n.id, last + 1)

  const layers = []
  for (const n of nodes) (layers[depth.get(n.id)] ??= []).push(n)

  // 1. rows (a layer may become several), with x measured from a common centre line at 0. A further row of the
  //    same layer is offset (0 or half a device) so none of its devices sits directly under one above it — the
  //    cable that drops to it then runs down a gap instead of through a device.
  const placed = new Map()
  let y = MARGIN
  for (const layer of layers.filter(Boolean)) {
    const above = []                       // devices already placed in THIS layer
    let at = 0
    for (const size of rowSizes(layer.length)) {
      const items = layer.slice(at, at + size).map(n => ({ n, lines: wrapText(n.label, NODE_W - 24, CH, 2) }))
      at += size
      const rowW = items.length * PITCH - GAP_X
      const startFor = shift => shift - rowW / 2
      const clear = shift => items.every((_, i) => {
        const cx = startFor(shift) + i * PITCH + NODE_W / 2
        return above.every(a => cx <= a.x || cx >= a.x + NODE_W)
      })
      const shift = [0, PITCH / 2, -PITCH / 2].find(clear) ?? 0
      const rowH = Math.max(...items.map(i => nodeHeight(i.lines.length)))
      let x = startFor(shift)
      for (const { n, lines } of items) {
        const p = { id: n.id, label: n.label, type: n.type, isNew: (topology.newNodes ?? []).includes(n.id), lines, x, y, w: NODE_W, h: nodeHeight(lines.length) }
        placed.set(n.id, p); above.push(p)
        x += PITCH
      }
      y += rowH + GAP_Y
    }
  }
  const height = y - GAP_Y + MARGIN

  // 2. normalise x so the drawing starts at the margin
  const minX = Math.min(...[...placed.values()].map(n => n.x))
  const maxX = Math.max(...[...placed.values()].map(n => n.x + n.w))
  for (const n of placed.values()) n.x += MARGIN - minX
  const width = maxX - minX + MARGIN * 2

  // 3. cables: same row side to side; otherwise a right-angle "bus" — down from the upper device, across, down into the lower
  const edges = cables.map(([a, b]) => {
    const A = placed.get(a), B = placed.get(b)
    if (!A || !B) return null
    if (A.y === B.y) {
      const [l, r] = A.x <= B.x ? [A, B] : [B, A]
      const x1 = l.x + l.w, y1 = l.y + l.h / 2, x2 = r.x, y2 = r.y + r.h / 2
      return { a, b, x1, y1, x2, y2, d: `M${x1} ${y1} L${x2} ${y2}` }
    }
    const [t, bt] = A.y < B.y ? [A, B] : [B, A]
    const x1 = t.x + t.w / 2, y1 = t.y + t.h, x2 = bt.x + bt.w / 2, y2 = bt.y
    const bus = y1 + GAP_Y / 2
    return { a, b, x1, y1, x2, y2, d: `M${x1} ${y1} V${bus} H${x2} V${y2}` }
  }).filter(Boolean)

  return { nodes: [...placed.values()], edges, width, height }
}

/** Every `cabled` condition an objective tree asks for, as [roleA, roleB] pairs (a `not` asks for nothing). */
export function cabledPairs(objectives) {
  const out = []
  const walk = c => {
    if (!c) return
    if (c.type === 'cabled') out.push([c.roleA, c.roleB])
    else if (c.type === 'and' || c.type === 'or') (c.conditions ?? []).forEach(walk)
  }
  for (const o of objectives ?? []) walk(o.condition)
  return out
}

const key = (a, b) => [a, b].sort().join('|')

/** What is wrong with a mission's topology, as sentences an author can act on. [] means it matches the job. */
export function checkTopology(mission) {
  const t = mission.blueprint?.topology
  if (!t) return []
  const problems = []
  const roles = mission.deviceRoles ?? {}
  const ids = new Set()
  for (const n of t.nodes ?? []) {
    if (ids.has(n.id)) problems.push(`node "${n.id}" is listed twice`)
    ids.add(n.id)
    if (!roles[n.id]) {
      if (!n.existing) problems.push(`node "${n.id}" is not one of the mission's deviceRoles (mark hardware from an earlier job \`existing: true\`)`)
    } else if (roles[n.id].type !== n.type) problems.push(`node "${n.id}" is a ${n.type} here but a ${roles[n.id].type} in deviceRoles`)
  }
  const drawn = new Set()
  for (const [a, b] of t.cables ?? []) {
    if (!ids.has(a) || !ids.has(b)) { problems.push(`cable ${a}–${b} joins a node that is not drawn`); continue }
    if (drawn.has(key(a, b))) problems.push(`cable ${a}–${b} is drawn twice`)
    drawn.add(key(a, b))
  }
  for (const [a, b] of cabledPairs(mission.objectives)) {
    if (!drawn.has(key(a, b))) problems.push(`the job asks for a cable ${a}–${b} that the topology does not draw`)
  }
  for (const id of t.newNodes ?? []) if (!ids.has(id)) problems.push(`newNodes lists "${id}", which is not drawn`)
  // nothing floating: every node reachable from the first
  if (ids.size > 1) {
    const adj = new Map([...ids].map(i => [i, []]))
    for (const [a, b] of t.cables ?? []) { adj.get(a)?.push(b); adj.get(b)?.push(a) }
    const seen = new Set([t.nodes[0].id]); const q = [t.nodes[0].id]
    while (q.length) for (const nb of adj.get(q.shift()) ?? []) if (!seen.has(nb)) { seen.add(nb); q.push(nb) }
    for (const i of ids) if (!seen.has(i)) problems.push(`node "${i}" is not cabled to anything`)
  }
  return problems
}
