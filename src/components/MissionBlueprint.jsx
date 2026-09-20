/**
 * Shared blueprint/floor-plan rendering — used by both ActiveJobPanel's
 * in-progress BlueprintModal and MissionBriefModal's pre-accept preview, so
 * the two always render a mission's topology diagram identically.
 */

import { segmentLayout, blueprintLinks } from '../engine/blueprintLayout.js'
import { layoutTopology } from '../engine/topologyGraph.js'

// Drawn from engine/blueprintLayout.js, which owns every size and position — boxes grow to fit their
// (wrapped) text, and each link's label sits on the link itself.
const BP_GLYPHS   = { router: '▣', switch: '▤', pc: '▢', server: '▥', firewall: '▦', phone: '▢' }
// Infrastructure (router/switch/firewall) in signal blue, endpoints grey — colour keeps one meaning.
const BP_COLORS   = { router: '#4da6ff', switch: '#4da6ff', firewall: '#4da6ff', pc: '#8fa7b8', server: '#8fa7b8', phone: '#8fa7b8' }
const BP_FONT     = { fontFamily: 'var(--font-ui)' }

function SegmentBox({ seg }) {
  const L = segmentLayout(seg), x = seg.svgX, y = seg.svgY, cx = x + L.w / 2
  return (
    <g>
      <rect x={x} y={y} width={L.w} height={L.h} rx="5" fill="#0e151b" stroke="#2c3b46" strokeWidth="1.2"/>
      <line x1={x+1} y1={y+L.headerH} x2={x+L.w-1} y2={y+L.headerH} stroke="#202b33" strokeWidth="1"/>
      {L.title.lines.map((t, i) => (
        <text key={`t${i}`} x={cx} y={y+L.title.y+i*15} textAnchor="middle" fontSize="12.5" fontWeight="700" fill="#e8eef2" style={BP_FONT}>{t}</text>
      ))}
      {L.sub.lines.map((t, i) => (
        <text key={`s${i}`} x={cx} y={y+L.sub.y+i*13} textAnchor="middle" fontSize="10.5" fill="#8fa7b8" style={BP_FONT}>{t}</text>
      ))}
      {L.devices.map((d, i) => (
        <text key={i} x={x+10} y={y+d.y} fontSize="11.5" style={BP_FONT}>
          <tspan fill={BP_COLORS[d.type]??'#8fa7b8'}>{BP_GLYPHS[d.type]??'◦'} </tspan>
          {d.lines.map((line, j) => (
            <tspan key={j} x={j === 0 ? undefined : x+10+8} dy={j === 0 ? 0 : 14.5} fill="#b4c2cd">{line}</tspan>
          ))}
        </text>
      ))}
    </g>
  )
}

function SegLink({ link }) {
  const isWan = link.type === 'wan'
  const { rect, text, textX, textY } = link.label
  return (
    <g>
      <line x1={link.x1} y1={link.y1} x2={link.x2} y2={link.y2} stroke={isWan?'#4da6ff':'#5f7a8c'} strokeOpacity={isWan?0.7:1} strokeWidth={isWan?2:1.5} strokeDasharray={isWan?'6,3':'4,2'}/>
      {text && (
        <>
          <rect x={rect.x} y={rect.y} width={rect.w} height={rect.h} rx="3" fill="#0e151b" fillOpacity="0.92"/>
          <text x={textX} y={textY} textAnchor="middle" fontSize="10.5" fill="#9fb3c2" style={BP_FONT}>{text}</text>
        </>
      )}
    </g>
  )
}

// Devices and the cables between them, layered from the router down. `isNew` hardware (bought for THIS
// job) is outlined in the action blue and tagged; everything else is what is already on the floor.
function TopologyDiagram({ topology }) {
  const L = layoutTopology(topology)
  const hasNew = L.nodes.some(n => n.isNew)
  return (
    <svg viewBox={`0 0 ${L.width} ${L.height + (hasNew ? 22 : 0)}`} style={{ width: '100%', height: 'auto', display: 'block' }} role="img" aria-label="Network topology">
      {L.edges.map((e, i) => (
        <path key={i} d={e.d} fill="none" stroke="#5f7a8c" strokeWidth="1.6" strokeLinejoin="round" />
      ))}
      {L.nodes.map(n => {
        const infra = ['router', 'switch', 'firewall', 'isp'].includes(n.type)
        return (
          <g key={n.id}>
            <rect x={n.x} y={n.y} width={n.w} height={n.h} rx="6" fill="#0e151b"
              stroke={n.isNew ? '#4da6ff' : infra ? '#2f6fbd' : '#2c3b46'} strokeWidth={n.isNew ? 1.8 : 1.2} />
            <text x={n.x + 9} y={n.y + 16} fontSize="11.5" style={BP_FONT}>
              <tspan fill={BP_COLORS[n.type] ?? '#8fa7b8'}>{BP_GLYPHS[n.type] ?? '◦'} </tspan>
              {n.lines.map((line, j) => (
                <tspan key={j} x={j === 0 ? undefined : n.x + 9 + 8} dy={j === 0 ? 0 : 14.5} fill="#e8eef2">{line}</tspan>
              ))}
            </text>
            {n.isNew && (
              <g>
                <rect x={n.x + n.w - 32} y={n.y - 11} width="30" height="14" rx="3" fill="#14283a" stroke="#4da6ff" strokeWidth="1" />
                <text x={n.x + n.w - 17} y={n.y - 0.5} textAnchor="middle" fontSize="10.5" fontWeight="700" fill="#4da6ff" style={BP_FONT}>new</text>
              </g>
            )}
          </g>
        )
      })}
      {hasNew && (
        <text x={10} y={L.height + 14} fontSize="10.5" fill="#8fa7b8" style={BP_FONT}>Outlined = new hardware for this job. The rest is already installed.</text>
      )}
    </svg>
  )
}

// Renders a mission's `blueprint` (a device-level topology when it has one, else segments + links +
// notes) as an SVG diagram plus its trailing notes line. Returns null if the mission has no blueprint.
export function MissionBlueprintSvg({ blueprint, notes = true }) {
  if (!blueprint) return null
  return (
    <>
      {blueprint.topology?.nodes?.length > 0 ? (
        <TopologyDiagram topology={blueprint.topology} />
      ) : (
        <svg viewBox={blueprint.svgViewBox??'0 0 400 200'} style={{width:'100%',height:'auto',display:'block'}}>
          {blueprintLinks(blueprint).map((l,i)=><SegLink key={i} link={l}/>)}
          {(blueprint.segments??[]).map(seg=><SegmentBox key={seg.id} seg={seg}/>)}
        </svg>
      )}
      {notes && blueprint.notes && (
        <div style={{fontSize:14,color:'var(--ink-3)',lineHeight:1.55,marginTop:10,paddingTop:10,borderTop:'1px solid var(--rule)'}}>
          {blueprint.notes}
        </div>
      )}
    </>
  )
}

// Renders a mission's `layout` (per-zone subnet/device/note rows) — the plain
// list, no collapsible wrapper (callers that want one, like ActiveJobPanel's
// compact sidebar, wrap this themselves).
export function FloorPlanZoneList({ layout }) {
  if (!layout?.length) return null
  return (
    <>
      {layout.map((row,i)=>(
        <div key={i} style={{marginBottom:i<layout.length-1?10:0,paddingBottom:i<layout.length-1?10:0,borderBottom:i<layout.length-1?'1px solid var(--rule)':'none'}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline',marginBottom:3}}>
            <span style={{fontSize:14.5,fontWeight:600,color:'var(--ink)'}}>{row.zone}</span>
            <span style={{fontSize:12.5,color:'var(--ink-3)',fontFamily:'var(--font-mono)',flexShrink:0,marginLeft:6}}>{row.subnet}</span>
          </div>
          <div style={{fontSize:14,color:'var(--ink-2)',lineHeight:1.5}}>{row.devices}</div>
          {row.note && <div style={{fontSize:13.5,color:'var(--ink-3)',lineHeight:1.5}}>{row.note}</div>}
        </div>
      ))}
    </>
  )
}
