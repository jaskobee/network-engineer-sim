/**
 * Shared blueprint/floor-plan rendering — used by both ActiveJobPanel's
 * in-progress BlueprintModal and MissionBriefModal's pre-accept preview, so
 * the two always render a mission's topology diagram identically.
 */

const BP_HEADER_H = 40
const BP_DEVICE_H = 17
const BP_PAD_B    = 10
const BP_SEG_W    = 155
const BP_GLYPHS   = { router: '▣', switch: '▤', pc: '▢', server: '▥' }
// Infrastructure (router/switch) in signal blue, endpoints grey — colour keeps one meaning.
const BP_COLORS   = { router: '#4da6ff', switch: '#4da6ff', pc: '#8fa7b8', server: '#8fa7b8' }
const BP_FONT     = { fontFamily: 'var(--font-ui)' }

function bpSegH(devices) { return BP_HEADER_H + (devices?.length ?? 0) * BP_DEVICE_H + BP_PAD_B }

function SegmentBox({ seg }) {
  const h = bpSegH(seg.devices), cx = seg.svgX + BP_SEG_W / 2
  return (
    <g>
      <rect x={seg.svgX} y={seg.svgY} width={BP_SEG_W} height={h} rx="5" fill="#0e151b" stroke="#2c3b46" strokeWidth="1.2"/>
      <line x1={seg.svgX+1} y1={seg.svgY+BP_HEADER_H} x2={seg.svgX+BP_SEG_W-1} y2={seg.svgY+BP_HEADER_H} stroke="#202b33" strokeWidth="1"/>
      <text x={cx} y={seg.svgY+17} textAnchor="middle" fontSize="12.5" fontWeight="700" fill="#e8eef2" style={BP_FONT}>{seg.label}</text>
      <text x={cx} y={seg.svgY+32} textAnchor="middle" fontSize="10.5" fill="#8fa7b8" style={BP_FONT}>{seg.subnet}</text>
      {(seg.devices??[]).map((d,i)=>(
        <text key={i} x={seg.svgX+10} y={seg.svgY+BP_HEADER_H+i*BP_DEVICE_H+13} fontSize="11.5" style={BP_FONT}>
          <tspan fill={BP_COLORS[d.type]??'#8fa7b8'}>{BP_GLYPHS[d.type]??'◦'} </tspan>
          <tspan fill="#b4c2cd">{d.role}</tspan>
        </text>
      ))}
    </g>
  )
}

function SegLink({ link, segMap }) {
  const fromSeg = segMap[link.from], toSeg = segMap[link.to]
  if (!fromSeg||!toSeg) return null
  const fromH=bpSegH(fromSeg.devices), toH=bpSegH(toSeg.devices)
  const isHoriz = Math.abs((fromSeg.svgX+BP_SEG_W/2)-(toSeg.svgX+BP_SEG_W/2)) >= Math.abs((fromSeg.svgY+fromH/2)-(toSeg.svgY+toH/2))
  let x1,y1,x2,y2,labelX,labelY,labelAnchor
  if (isHoriz) {
    const [l,r] = fromSeg.svgX<=toSeg.svgX ? [fromSeg,toSeg] : [toSeg,fromSeg]
    const lH=bpSegH(l.devices), rH=bpSegH(r.devices)
    x1=l.svgX+BP_SEG_W; y1=l.svgY+lH/2; x2=r.svgX; y2=r.svgY+rH/2
    labelX=(x1+x2)/2; labelY=Math.min(y1,y2)-5; labelAnchor='middle'
  } else {
    const [t,b] = fromSeg.svgY<=toSeg.svgY ? [fromSeg,toSeg] : [toSeg,fromSeg]
    const tH=bpSegH(t.devices)
    x1=t.svgX+BP_SEG_W/2; y1=t.svgY+tH; x2=b.svgX+BP_SEG_W/2; y2=b.svgY
    labelX=x1+10; labelY=(y1+y2)/2+4; labelAnchor='start'
  }
  const isWan=link.type==='wan'
  return (
    <g>
      <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={isWan?'#4da6ff':'#5f7a8c'} strokeOpacity={isWan?0.7:1} strokeWidth={isWan?2:1.5} strokeDasharray={isWan?'6,3':'4,2'}/>
      <text x={labelX} y={labelY} textAnchor={labelAnchor} fontSize="10.5" fill="#9fb3c2" style={BP_FONT}>{link.label}</text>
    </g>
  )
}

// Renders a mission's `blueprint` (segments + links + notes) as an SVG diagram
// plus its trailing notes line. Returns null if the mission has no blueprint.
export function MissionBlueprintSvg({ blueprint, notes = true }) {
  if (!blueprint) return null
  const segMap = Object.fromEntries((blueprint.segments??[]).map(s=>[s.id,s]))
  return (
    <>
      <svg viewBox={blueprint.svgViewBox??'0 0 400 200'} style={{width:'100%',height:'auto',display:'block'}}>
        {(blueprint.links??[]).map((l,i)=><SegLink key={i} link={l} segMap={segMap}/>)}
        {(blueprint.segments??[]).map(seg=><SegmentBox key={seg.id} seg={seg}/>)}
      </svg>
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
