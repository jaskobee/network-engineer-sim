/**
 * Geometry for a mission's "segment" blueprint (subnet boxes joined by links) — pure functions, no
 * React, no DOM. The component (MissionBlueprint.jsx) only draws what this says, and
 * checkBlueprint() lets a test prove a job's diagram is legible: nothing overlaps, nothing is
 * clipped by the viewBox, every label sits clear of the boxes.
 *
 * Text widths are the measured average glyph widths of the app font (Barlow Semi Condensed) at the
 * SVG font sizes, rounded UP a little so text errs on the side of wrapping, never overflowing.
 * Boxes are sized from their content: long titles, subnets and device notes WRAP instead of
 * running out of the box.
 */

export const SEG_W = 155
const PAD_X = 10
const INNER_W = SEG_W - PAD_X * 2
const CH = { title: 5.6, sub: 4.7, dev: 5.0, label: 4.9 }     // px per character: 12.5 bold / 10.5 / 11.5 / 10.5
const LH = { title: 15, sub: 13, dev: 14.5 }
const GLYPH_W = 8                                               // the ▣ ▤ ▢ before a device name
const LABEL_H = 16

function textWidth(text, chPx) { return String(text).length * chPx }

/** Greedy word wrap to `maxPx`; a word wider than the line is kept whole (and reported by the checker). */
export function wrapText(text, maxPx, chPx, maxLines = 4) {
  const words = String(text).trim().split(/\s+/).filter(Boolean)
  const lines = []
  let cur = ''
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w
    if (cur && textWidth(next, chPx) > maxPx) { lines.push(cur); cur = w } else cur = next
  }
  if (cur) lines.push(cur)
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines)
    kept[maxLines - 1] = kept[maxLines - 1].replace(/\s*\S*$/, '') + '…'
    return kept
  }
  return lines.length ? lines : ['']
}

/** Everything needed to draw one segment box: its size, and where each line of text goes (relative to the box). */
export function segmentLayout(seg) {
  const titleLines = wrapText(seg.label ?? '', INNER_W, CH.title, 2)
  const subLines = wrapText(seg.subnet ?? '', INNER_W, CH.sub, 3)
  let y = 9
  const title = { lines: titleLines, y: y + 11 }
  y += titleLines.length * LH.title
  const sub = { lines: subLines, y: y + 10 }
  y += subLines.length * LH.sub + 7
  const headerH = y
  const devices = (seg.devices ?? []).map(d => {
    const lines = wrapText(d.role, INNER_W - GLYPH_W, CH.dev, 3)
    const at = { type: d.type, role: d.role, lines, y: y + 11 }
    y += lines.length * LH.dev + 2
    return at
  })
  return { w: SEG_W, h: y + 8, headerH, title, sub, devices }
}

function link(seg, fromSeg, toSeg, lk) {
  const a = { x: fromSeg.svgX, y: fromSeg.svgY, ...size(fromSeg) }
  const b = { x: toSeg.svgX, y: toSeg.svgY, ...size(toSeg) }
  const horiz = Math.abs((a.x + a.w / 2) - (b.x + b.w / 2)) >= Math.abs((a.y + a.h / 2) - (b.y + b.h / 2))
  let x1, y1, x2, y2
  if (horiz) {
    const [l, r] = a.x <= b.x ? [a, b] : [b, a]
    x1 = l.x + l.w; y1 = l.y + l.h / 2; x2 = r.x; y2 = r.y + r.h / 2
  } else {
    const [t, bt] = a.y <= b.y ? [a, b] : [b, a]
    x1 = t.x + t.w / 2; y1 = t.y + t.h; x2 = bt.x + bt.w / 2; y2 = bt.y
  }
  // The label sits ON the link, at its midpoint, on a dark plate. (Above the higher end, as it used to,
  // put two links into one box on top of each other.)
  const text = lk.label ?? ''
  const w = textWidth(text, CH.label) + 10
  const mx = (x1 + x2) / 2, my = (y1 + y2) / 2
  const rect = horiz
    ? { x: mx - w / 2, y: my - LABEL_H / 2, w, h: LABEL_H }
    : { x: mx + 6, y: my - LABEL_H / 2, w, h: LABEL_H }
  return { x1, y1, x2, y2, horiz, label: { text, rect, textX: rect.x + w / 2, textY: rect.y + LABEL_H - 4.5 } }
}
const size = seg => { const l = segmentLayout(seg); return { w: l.w, h: l.h } }

/** All links, geometry included, keyed the way the component draws them. Links to unknown segments are dropped. */
export function blueprintLinks(blueprint) {
  const segMap = Object.fromEntries((blueprint.segments ?? []).map(s => [s.id, s]))
  return (blueprint.links ?? []).map(lk => {
    const a = segMap[lk.from], b = segMap[lk.to]
    return a && b ? { ...link(null, a, b, lk), type: lk.type, raw: lk } : null
  }).filter(Boolean)
}

export function parseViewBox(vb = '0 0 400 200') {
  const [x, y, w, h] = String(vb).trim().split(/\s+/).map(Number)
  return { x, y, w, h }
}

const overlaps = (a, b, m = 0) => a.x < b.x + b.w + m && b.x < a.x + a.w + m && a.y < b.y + b.h + m && b.y < a.y + a.h + m

/**
 * What is wrong with this diagram, in words a mission author can act on. An empty array means it is
 * legible: no boxes overlap, everything is inside the viewBox, no label touches a box or another label.
 */
export function checkBlueprint(blueprint) {
  const problems = []
  const vb = parseViewBox(blueprint.svgViewBox)
  const segs = (blueprint.segments ?? []).map(s => ({ id: s.id, x: s.svgX, y: s.svgY, ...size(s), layout: segmentLayout(s) }))

  for (const s of segs) {
    if (s.x < vb.x || s.y < vb.y || s.x + s.w > vb.x + vb.w || s.y + s.h > vb.y + vb.h) {
      problems.push(`"${s.id}" is outside the viewBox (${s.x},${s.y} ${s.w}×${Math.round(s.h)} in ${blueprint.svgViewBox})`)
    }
    const words = [s.layout.title.lines, s.layout.sub.lines, ...s.layout.devices.map(d => d.lines)].flat().join(' ').split(/\s+/)
    if (words.some(w => textWidth(w, CH.dev) > INNER_W)) problems.push(`"${s.id}" has a word too long for the box`)
  }
  for (let i = 0; i < segs.length; i++) for (let j = i + 1; j < segs.length; j++) {
    if (overlaps(segs[i], segs[j], 4)) problems.push(`"${segs[i].id}" and "${segs[j].id}" overlap`)
  }

  const links = blueprintLinks(blueprint)
  for (const lk of blueprint.links ?? []) {
    if (!segs.some(s => s.id === lk.from) || !segs.some(s => s.id === lk.to)) problems.push(`link "${lk.label}" joins a segment that does not exist`)
  }
  links.forEach((l, i) => {
    const r = l.label.rect
    if (l.label.text && (r.x < vb.x || r.y < vb.y || r.x + r.w > vb.x + vb.w || r.y + r.h > vb.y + vb.h)) problems.push(`the label "${l.label.text}" is outside the viewBox`)
    if (!l.label.text) return
    for (const s of segs) if (overlaps(r, s, 1)) problems.push(`the label "${l.label.text}" runs into "${s.id}" — widen the gap between the boxes`)
    for (let j = i + 1; j < links.length; j++) if (links[j].label.text && overlaps(r, links[j].label.rect, 2)) problems.push(`the labels "${l.label.text}" and "${links[j].label.text}" overlap`)
  })
  return problems
}
