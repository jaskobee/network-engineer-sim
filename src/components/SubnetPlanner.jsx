import { useState, useLayoutEffect, useRef, useId, Fragment } from 'react'
import { createPortal } from 'react-dom'
import {
  parseNetwork, classifyNetwork, divide, join, layoutPlan, encodeTree, decodeTree,
  pathKey, LEAF,
} from '../engine/subnetPlanner.js'
import { IconClose } from './icons.jsx'

// Subnet planner — a sandbox tool for laying out an address plan before building it.
//
// Start from one network, divide any subnet into its two halves, join halves back. Every
// row is a subnet you could put on a VLAN or a link; the "Join" columns show the larger
// blocks (summary routes) the subnets add up to. All the math lives in
// engine/subnetPlanner.js; this window only draws it. It writes nothing to any device —
// it is paper, not configuration.

const STORE_KEY = 'netsim_subnet_planner'
const DEFAULT = { network: '192.168.0.0', prefix: 16, code: '0', notes: {}, wildcard: false }
const WIDTH = 1240

function load() {
  try {
    const s = JSON.parse(localStorage.getItem(STORE_KEY) ?? 'null')
    const p = s && parseNetwork(s.network, String(s.prefix))
    if (!p?.ok || p.adjusted) return DEFAULT
    return {
      network: p.network, prefix: p.prefix,
      code: decodeTree(s.code, 32 - p.prefix) ? s.code : '0',
      notes: s.notes && typeof s.notes === 'object' ? s.notes : {},
      wildcard: !!s.wildcard,
    }
  } catch {
    return DEFAULT
  }
}

function save(state) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)) } catch { /* private window: keep it in memory */ }
}

const fmt = n => n.toLocaleString('en-US')

export default function SubnetPlanner({ onClose }) {
  return createPortal(<PlannerWindow onClose={onClose} />, document.body)
}

// ── Window frame ──────────────────────────────────────────────────────────────

function PlannerWindow({ onClose }) {
  const winRef = useRef(null)
  const dragRef = useRef(null)
  const [pos, setPos] = useState(() => ({ x: Math.max(8, (window.innerWidth - WIDTH) / 2), y: 72 }))

  // Keep the window on screen as it grows with the table or the browser is resized.
  useLayoutEffect(() => {
    const el = winRef.current
    if (!el) return
    const keepOnScreen = () => setPos(p => {
      const x = Math.max(8, Math.min(window.innerWidth  - el.offsetWidth  - 8, p.x))
      const y = Math.max(8, Math.min(window.innerHeight - el.offsetHeight - 8, p.y))
      return x === p.x && y === p.y ? p : { x, y }
    })
    keepOnScreen()
    el.focus({ preventScroll: true })
    const ro = new ResizeObserver(keepOnScreen)
    ro.observe(el)
    window.addEventListener('resize', keepOnScreen)
    return () => { ro.disconnect(); window.removeEventListener('resize', keepOnScreen) }
  }, [])

  function startDrag(e) {
    if (e.button !== 0 || e.target.closest('button')) return
    e.currentTarget.setPointerCapture(e.pointerId)
    dragRef.current = { mx: e.clientX, my: e.clientY, px: pos.x, py: pos.y }
  }
  function onDrag(e) {
    const d = dragRef.current
    if (!d) return
    setPos({
      x: Math.max(96 - WIDTH, Math.min(window.innerWidth - 96, d.px + e.clientX - d.mx)),
      y: Math.max(0, Math.min(window.innerHeight - 44, d.py + e.clientY - d.my)),
    })
  }
  function endDrag() { dragRef.current = null }

  return (
    <div
      ref={winRef}
      className="float-win subnet-planner"
      role="dialog"
      aria-modal="false"
      aria-label="Subnet planner"
      tabIndex={-1}
      style={{ left: pos.x, top: pos.y, width: WIDTH }}
      onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }}
      onMouseDown={e => e.stopPropagation()}
      onContextMenu={e => e.stopPropagation()}
    >
      <div className="float-win-title" onPointerDown={startDrag} onPointerMove={onDrag} onPointerUp={endDrag} onPointerCancel={endDrag}>
        <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'baseline', gap: 10 }}>
          <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--ink)' }}>Subnet planner</span>
          <span style={{ fontSize: 13.5, color: 'var(--ink-3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            Divide a network into subnets, join them back into summaries
          </span>
        </div>
        <button className="btn ghost icon" onClick={onClose} title="Close" aria-label="Close" style={{ width: 28, height: 28 }}>
          <IconClose size={15} />
        </button>
      </div>
      <div className="float-win-body">
        <Planner />
      </div>
    </div>
  )
}

// ── The planner ───────────────────────────────────────────────────────────────

function Planner() {
  const uid = useId()
  const [state, setState] = useState(load)
  const [form, setForm] = useState(() => ({ address: state.network, mask: String(state.prefix) }))
  const [formError, setFormError] = useState(null)       // { field, error }
  const [adjusted, setAdjusted] = useState(null)         // { from, to } after Apply
  const [hover, setHover] = useState(null)               // path key of the block under the pointer

  const { network, prefix, notes, wildcard } = state
  const tree = decodeTree(state.code, 32 - prefix) ?? LEAF
  const { root, rows, columns } = layoutPlan(network, prefix, tree)
  const space = classifyNetwork(network, prefix)

  function update(patch) {
    setState(s => {
      const next = { ...s, ...patch }
      save(next)
      return next
    })
  }
  const setTree = t => update({ code: encodeTree(t) })

  function apply(e) {
    e.preventDefault()
    const p = parseNetwork(form.address, form.mask)
    if (!p.ok) { setFormError(p); return }
    setFormError(null)
    setAdjusted(p.adjusted ? { from: p.adjusted.from, to: `${p.network}/${p.prefix}` } : null)
    setForm({ address: p.network, mask: String(p.prefix) })
    if (p.network !== network || p.prefix !== prefix) update({ network: p.network, prefix: p.prefix, code: '0' })
  }

  const hovered = r => hover !== null && pathKey(r.path).startsWith(hover)

  return (
    <>
      <form onSubmit={apply} className="sp-form">
        <label htmlFor={`${uid}-a`} className="field-label" style={{ paddingTop: 0 }}>Network address</label>
        <input id={`${uid}-a`} className="input" style={{ width: 170 }} spellCheck={false} autoComplete="off"
          value={form.address} placeholder="192.168.0.0"
          aria-invalid={formError?.field === 'address' || undefined}
          onChange={e => setForm(f => ({ ...f, address: e.target.value }))} />
        <label htmlFor={`${uid}-m`} className="field-label" style={{ paddingTop: 0 }}>Mask</label>
        <input id={`${uid}-m`} className="input" style={{ width: 150 }} spellCheck={false} autoComplete="off"
          value={form.mask} placeholder="/24 or 255.255.255.0"
          aria-invalid={formError?.field === 'mask' || undefined}
          onChange={e => setForm(f => ({ ...f, mask: e.target.value }))} />
        <button type="submit" className="btn primary">Update</button>
        <button type="button" className="btn" disabled={!tree.kids} onClick={() => setTree(LEAF)}
          title={`Join everything back into ${root.cidr}`}>Reset</button>
        <label className="opt" style={{ marginLeft: 'auto', fontSize: 14 }}>
          <input type="checkbox" checked={wildcard} onChange={e => update({ wildcard: e.target.checked })} />
          Wildcard masks
        </label>
      </form>

      {formError && <div className="field-error" style={{ marginTop: 6 }}>{formError.error}</div>}
      {adjusted && (
        <div className="sp-note" style={{ marginTop: 6 }}>
          <i className="led amber" />
          <span>
            <span className="mono">{adjusted.from}</span> has host bits set for this mask. The network it
            belongs to is <span className="mono">{adjusted.to}</span>, so that is what's planned below.
          </span>
        </div>
      )}

      <div className="sp-summary">
        <span className="mono" style={{ color: 'var(--ink)', fontWeight: 700 }}>{root.cidr}</span>
        <span>{fmt(root.addresses)} addresses</span>
        <span>{rows.length} subnet{rows.length === 1 ? '' : 's'}</span>
        <SpaceNote space={space} />
      </div>

      <div className="sp-scroll">
        <table className="sp-table">
          <thead>
            <tr>
              <th>Subnet</th>
              <th>Mask</th>
              {wildcard && <th title="The inverse of the mask, used by IOS ACLs and OSPF network statements">Wildcard</th>}
              <th>Usable range</th>
              <th>Broadcast</th>
              <th className="num">Hosts</th>
              <th style={{ width: '100%' }}>Label</th>
              <th />
              <th colSpan={columns} className="sp-join-head" title="Click a block to join the subnets under it into one">Join</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => {
              const s = r.subnet
              const halves = r.halves
              return (
                <tr key={pathKey(r.path)} className={hovered(r) ? 'sp-hl' : undefined}>
                  <td className="mono sp-cidr">{s.cidr}</td>
                  <td className="mono">{s.mask}</td>
                  {wildcard && <td className="mono">{s.wildcard}</td>}
                  <td className="mono">{s.first === s.last ? s.first : `${s.first} – ${s.last}`}</td>
                  <td className="mono">
                    {s.broadcast ?? (
                      <span className="dim" title={s.prefix === 31
                        ? 'A /31 is a point-to-point link (RFC 3021): both addresses are usable and there is no broadcast.'
                        : 'A /32 is a single host address (a loopback or host route): no broadcast.'}>
                        none ({s.prefix === 31 ? 'RFC 3021' : 'host'})
                      </span>
                    )}
                  </td>
                  <td className="mono num" title={`${fmt(s.addresses)} addresses${s.prefix <= 30 ? ' minus the network and broadcast address' : ''}`}>
                    {fmt(s.hosts)}
                  </td>
                  <td>
                    <input className="input sp-label" placeholder="e.g. VLAN 10 Sales" aria-label={`Label for ${s.cidr}`}
                      value={notes[s.cidr] ?? ''} maxLength={60}
                      onChange={e => {
                        const next = { ...notes }
                        if (e.target.value) next[s.cidr] = e.target.value
                        else delete next[s.cidr]
                        update({ notes: next })
                      }} />
                  </td>
                  <td>
                    <button className="btn sp-divide" disabled={!halves}
                      title={halves ? `Split into ${halves[0]} and ${halves[1]}` : 'A /32 is a single address and cannot be divided'}
                      onClick={() => setTree(divide(tree, r.path, prefix))}>Divide</button>
                  </td>
                  <td colSpan={r.ownColSpan} className="sp-join sp-own">/{s.prefix}</td>
                  {r.blocks.map(b => (
                    <td key={pathKey(b.path)} rowSpan={b.rowSpan} className="sp-join">
                      <button
                        title={`Join into ${b.summary.cidr} (${b.summary.mask}) — the summary of the ${b.rowSpan} subnets beside it`}
                        onPointerEnter={() => setHover(pathKey(b.path))}
                        onPointerLeave={() => setHover(null)}
                        onFocus={() => setHover(pathKey(b.path))}
                        onBlur={() => setHover(null)}
                        onClick={() => { setHover(null); setTree(join(tree, b.path)) }}
                      >/{b.prefix}</button>
                    </td>
                  ))}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="sp-foot">
        Host counts leave out the network and broadcast address; a /31 point-to-point link uses both
        of its addresses (RFC 3021). Each Join block is also the summary route that covers the subnets
        beside it. Nothing here configures a device — use the terminal to put the plan on your gear.
      </div>
    </>
  )
}

// What kind of address space the network is in, and what that means for a LAN plan.
function SpaceNote({ space }) {
  let led = ''
  let text
  switch (space.kind) {
    case 'private':
      led = 'green'
      text = <>{space.name}. Not routed on the internet: hosts here need NAT to reach it.</>
      break
    case 'documentation':
      text = <>{space.name}. Reserved for examples and labs, never used on the real internet.</>
      break
    case 'benchmark':
      text = <>{space.name}. Reserved for lab testing of network devices.</>
      break
    case 'shared':
      led = 'amber'
      text = <>{space.name}. Meant for ISPs, not for a customer LAN.</>
      break
    case 'special':
      led = 'amber'
      text = <>{space.name}. Not for addressing hosts.</>
      break
    case 'mixed':
      led = 'amber'
      text = <>Spans special-purpose blocks ({space.blocks.map((b, i) => <Fragment key={b}>{i ? ', ' : ''}<span className="mono">{b}</span></Fragment>)}).</>
      break
    default:
      led = 'amber'
      text = <>Public address space: use it only if it is assigned to you. For a LAN use 10.0.0.0/8, 172.16.0.0/12 or 192.168.0.0/16 (RFC 1918).</>
  }
  return <span className="sp-note"><i className={`led ${led}`} /><span>{text}</span></span>
}
