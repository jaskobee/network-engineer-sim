import { useState, useRef } from 'react'
import { useGame } from '../state/GameContext.jsx'
import { MISSIONS } from '../data/missions.js'
import { MISSION_TASKS } from '../data/missionTasks.js'

// ── Blueprint modal ───────────────────────────────────────────────────────────

const BP_HEADER_H = 40
const BP_DEVICE_H = 17
const BP_PAD_B    = 10
const BP_SEG_W    = 155
const BP_GLYPHS   = { router: '▣', switch: '▤', pc: '▢', server: '▥' }
const BP_COLORS   = { router: '#4a90e2', switch: '#50fa7b', pc: '#8090c0', server: '#ffb86c' }

function bpSegH(devices) { return BP_HEADER_H + (devices?.length ?? 0) * BP_DEVICE_H + BP_PAD_B }

function SegmentBox({ seg }) {
  const h = bpSegH(seg.devices), cx = seg.svgX + BP_SEG_W / 2
  return (
    <g>
      <rect x={seg.svgX} y={seg.svgY} width={BP_SEG_W} height={h} rx="5" fill="#07101e" stroke="#1a3868" strokeWidth="1.2"/>
      <line x1={seg.svgX+1} y1={seg.svgY+BP_HEADER_H} x2={seg.svgX+BP_SEG_W-1} y2={seg.svgY+BP_HEADER_H} stroke="#0f1e3a" strokeWidth="1"/>
      <text x={cx} y={seg.svgY+16} textAnchor="middle" fontSize="10" fontWeight="700" fill="#5a9ae0" fontFamily="'Segoe UI',system-ui,sans-serif">{seg.label}</text>
      <text x={cx} y={seg.svgY+30} textAnchor="middle" fontSize="8" fill="#243a6a" fontFamily="monospace">{seg.subnet}</text>
      {(seg.devices??[]).map((d,i)=>(
        <text key={i} x={seg.svgX+10} y={seg.svgY+BP_HEADER_H+i*BP_DEVICE_H+13} fontSize="9" fontFamily="'Segoe UI',system-ui,sans-serif">
          <tspan fill={BP_COLORS[d.type]??'#555'}>{BP_GLYPHS[d.type]??'◦'} </tspan>
          <tspan fill="#5a6a90">{d.role}</tspan>
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
      <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={isWan?'#2a5080':'#1a4a30'} strokeWidth={isWan?2:1.5} strokeDasharray={isWan?'6,3':'4,2'}/>
      <text x={labelX} y={labelY} textAnchor={labelAnchor} fontSize="8" fill={isWan?'#3a6090':'#2a5040'} fontFamily="monospace">{link.label}</text>
    </g>
  )
}

function BlueprintModal({ mission, onClose }) {
  const bp = mission.blueprint; if (!bp) return null
  const segMap = Object.fromEntries((bp.segments??[]).map(s=>[s.id,s]))
  return (
    <div style={{position:'fixed',inset:0,zIndex:2000,background:'rgba(0,0,0,0.88)',display:'flex',alignItems:'center',justifyContent:'center'}} onClick={onClose}>
      <div style={{background:'#080d1c',border:'1px solid #1a3060',borderRadius:10,padding:'18px 20px',maxWidth:460,width:'90vw',boxShadow:'0 0 60px #1a3a8020'}} onClick={e=>e.stopPropagation()}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:12}}>
          <div>
            <div style={{fontSize:9,color:'#3a5a8a',fontWeight:700,letterSpacing:2,marginBottom:2}}>NETWORK BLUEPRINT</div>
            <div style={{fontSize:13,fontWeight:700,color:'#b0bcd0'}}>{mission.title}</div>
          </div>
          <button onClick={onClose} style={{background:'none',border:'1px solid #1a2a40',color:'#3a4a60',cursor:'pointer',borderRadius:4,padding:'2px 8px',fontSize:12}}>✕</button>
        </div>
        <svg viewBox={bp.svgViewBox??'0 0 400 200'} style={{width:'100%',height:'auto',display:'block'}}>
          {(bp.links??[]).map((l,i)=><SegLink key={i} link={l} segMap={segMap}/>)}
          {(bp.segments??[]).map(seg=><SegmentBox key={seg.id} seg={seg}/>)}
        </svg>
        {bp.notes && <div style={{fontSize:10,color:'#3a4a70',lineHeight:1.55,marginTop:10,paddingTop:10,borderTop:'1px solid #0d1630'}}>{bp.notes}</div>}
        <div style={{textAlign:'center',marginTop:14}}>
          <button onClick={onClose} style={{background:'#0c1628',border:'1px solid #1e3a60',color:'#3a6898',padding:'7px 24px',borderRadius:5,fontSize:11,fontWeight:700,cursor:'pointer'}}
            onMouseEnter={e=>{e.currentTarget.style.color='#5a90c8';e.currentTarget.style.borderColor='#2a5080'}}
            onMouseLeave={e=>{e.currentTarget.style.color='#3a6898';e.currentTarget.style.borderColor='#1e3a60'}}
          >GOT IT</button>
        </div>
      </div>
    </div>
  )
}

// ── Floor plan brief ──────────────────────────────────────────────────────────

function FloorPlanBrief({ layout }) {
  const [open, setOpen] = useState(false)
  return (
    <div style={{margin:'0 12px 8px',borderRadius:5,overflow:'hidden',border:'1px solid #141428'}}>
      <button onClick={()=>setOpen(v=>!v)} style={{width:'100%',display:'flex',justifyContent:'space-between',alignItems:'center',padding:'6px 10px',background:'#08091a',border:'none',cursor:'pointer'}}
        onMouseEnter={e=>{e.currentTarget.style.background='#0c0e20'}} onMouseLeave={e=>{e.currentTarget.style.background='#08091a'}}>
        <span style={{fontSize:9,fontWeight:700,letterSpacing:1,color:'#3a4a7a'}}>{open?'▴':'▾'} FLOOR PLAN</span>
        <span style={{fontSize:9,color:'#252545'}}>{open?'collapse':'show zones'}</span>
      </button>
      {open && (
        <div style={{background:'#06081a',padding:'10px 10px 6px'}}>
          {layout.map((row,i)=>(
            <div key={i} style={{marginBottom:i<layout.length-1?10:0,paddingBottom:i<layout.length-1?10:0,borderBottom:i<layout.length-1?'1px solid #0f1128':'none'}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline',marginBottom:3}}>
                <span style={{fontSize:10,fontWeight:700,color:'#5a90e2',letterSpacing:0.3}}>{row.zone}</span>
                <span style={{fontSize:9,color:'#2a4a7a',fontFamily:'monospace',flexShrink:0,marginLeft:6}}>{row.subnet}</span>
              </div>
              <div style={{fontSize:10,color:'#4a4a80',lineHeight:1.5}}>{row.devices}</div>
              {row.note && <div style={{fontSize:9,color:'#2a3a5a',lineHeight:1.5,fontStyle:'italic'}}>{row.note}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Task rows ─────────────────────────────────────────────────────────────────

function DoneTask({ task, num }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12,
      padding: '10px 14px', borderBottom: '1px solid #080c12',
      background: '#04090a',
    }}>
      <div style={{
        width: 26, height: 26, borderRadius: '50%', flexShrink: 0,
        background: '#071510', border: '2px solid #1a5a20',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <span style={{ fontSize: 12, color: '#2a8a30', lineHeight: 1 }}>✓</span>
      </div>
      <span style={{ fontSize: 12, color: '#1d4a20', textDecoration: 'line-through', lineHeight: 1.4, flex: 1 }}>
        {task.label}
      </span>
    </div>
  )
}

function UpcomingTask({ task, num }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12,
      padding: '10px 14px', borderBottom: '1px solid #090910', opacity: 0.3,
    }}>
      <div style={{
        width: 26, height: 26, borderRadius: '50%', flexShrink: 0,
        background: '#09091a', border: '1.5px solid #1a1a30',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <span style={{ fontSize: 10, color: '#2a2a4a', fontFamily: 'monospace', fontWeight: 700 }}>{num}</span>
      </div>
      <span style={{ fontSize: 12, color: '#3a3a60', lineHeight: 1.4, flex: 1 }}>
        {task.label}
      </span>
    </div>
  )
}

function ActiveTask({ task, num, difficulty, diagLines, executedCommands }) {
  const [showDiag, setShowDiag] = useState(false)

  const isBeginnerMode = difficulty === 'beginner'
  const hintArr    = Array.isArray(task.hint) ? task.hint : (task.hint ? [task.hint] : [])
  const actionText = hintArr[0] ?? null
  const cliItems   = hintArr.slice(1)   // mix of '# comment' lines and actual commands
  const hasCli     = isBeginnerMode && cliItems.length > 0
  const hasDiag    = isBeginnerMode && diagLines?.length > 0

  return (
    <div style={{
      margin: '10px 10px 8px',
      background: '#060e1e',
      border: '2px solid #2a68d8',
      borderRadius: 8,
      boxShadow: '0 0 24px #2a68d815, 0 2px 12px #00000060',
    }}>
      {/* Step number + task label */}
      <div style={{ padding: '13px 13px 10px', display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <div style={{
          width: 30, height: 30, borderRadius: '50%', flexShrink: 0, marginTop: 1,
          background: '#0c1e40', border: '2px solid #3a78e8',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 0 10px #3a78e820',
        }}>
          <span style={{ fontSize: 12, color: '#5a98f8', fontFamily: 'monospace', fontWeight: 700 }}>{num}</span>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 8, fontWeight: 700, letterSpacing: 2, color: '#3a78d8', marginBottom: 5 }}>CURRENT TASK</div>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#d8eaff', lineHeight: 1.45 }}>{task.label}</div>
        </div>
      </div>

      {/* Action hint (beginner) */}
      {isBeginnerMode && actionText && (
        <div style={{ margin: '0 13px 10px', padding: '7px 10px', background: '#050c1c', borderRadius: 5, borderLeft: '3px solid #1a3a7a' }}>
          <div style={{ fontSize: 11, color: '#5a88c8', lineHeight: 1.6 }}>{actionText}</div>
        </div>
      )}

      {/* Beginner: command to-do checklist — always visible, ticks off as commands are typed */}
      {hasCli && (
        <div style={{ margin: '0 13px 10px', background: '#050d1c', border: '1px solid #1a3060', borderRadius: 5, overflow: 'hidden' }}>
          <div style={{ padding: '5px 10px 3px', fontSize: 8, fontWeight: 700, letterSpacing: 1.5, color: '#2a4a7a', borderBottom: '1px solid #0d1e38' }}>
            COMMANDS TO TYPE
          </div>
          {cliItems.map((cmd, i) => {
            const isComment = cmd.startsWith('# ')
            if (isComment) {
              return (
                <div key={i} style={{ fontSize: 9, fontFamily: 'monospace', color: '#2a3a5a', lineHeight: 1.6, padding: '4px 10px 0', fontStyle: 'italic' }}>
                  {cmd.slice(2)}
                </div>
              )
            }
            const done = executedCommands.has(cmd)
            return (
              <div key={i} style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '4px 10px',
                background: done ? '#031008' : 'transparent',
                borderBottom: i < cliItems.length - 1 ? '1px solid #0a1528' : 'none',
              }}>
                <div style={{
                  width: 16, height: 16, borderRadius: '50%', flexShrink: 0,
                  background: done ? '#0a2510' : '#080d1e',
                  border: `1.5px solid ${done ? '#2a6a30' : '#1a2a50'}`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  {done && <span style={{ fontSize: 9, color: '#3aaa40', lineHeight: 1 }}>✓</span>}
                </div>
                <span style={{
                  fontSize: 11, fontFamily: 'monospace', lineHeight: 1.6, flex: 1,
                  color: done ? '#2a6a30' : '#5a8ad8',
                  textDecoration: done ? 'line-through' : 'none',
                  opacity: done ? 0.7 : 1,
                }}>
                  {cmd}
                </span>
              </div>
            )
          })}
        </div>
      )}

      {/* Non-beginner note */}
      {!isBeginnerMode && (
        <div style={{ padding: '0 13px 10px', fontSize: 11, color: '#2a3a5a', fontStyle: 'italic' }}>
          {difficulty === 'networkEngineer' ? 'No hints. Use your knowledge.' : 'Type "help" in the terminal for guidance.'}
        </div>
      )}

      {/* Troubleshoot button */}
      {hasDiag && (
        <div style={{ padding: '0 13px 10px' }}>
          <button onClick={() => setShowDiag(v => !v)} style={{
            padding: '3px 10px', fontSize: 9, fontWeight: 700, letterSpacing: 0.4, cursor: 'pointer', borderRadius: 4,
            background: showDiag ? '#2a1400' : '#120800', color: showDiag ? '#ffb86c' : '#7a4a10',
            border: `1px solid ${showDiag ? '#5a3000' : '#3a1800'}`,
          }}>{showDiag ? '▴' : '▾'} TROUBLESHOOT</button>
        </div>
      )}

      {/* Troubleshoot block */}
      {hasDiag && showDiag && (
        <div style={{ margin: '0 13px 10px', padding: '8px 10px', background: '#120800', border: '1px solid #3a1800', borderRadius: 4 }}>
          {diagLines.map((line, i) => (
            <div key={i} style={{ fontSize: 10, fontFamily: 'monospace', lineHeight: 1.7, color: line.startsWith('  ') ? '#5a9ae2' : '#ffb86c', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
              {line.startsWith('  ') ? line : `▸ ${line}`}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Panel root ────────────────────────────────────────────────────────────────

export default function ActiveJobPanel() {
  const {
    devices, placements, topology, tick,
    activeMissionId, difficulty,
    setActiveJobPanelOpen,
    completedMissions,
    executedCommandsRef,
  } = useGame()

  void tick

  const [minimized,     setMinimized]     = useState(false)
  const [blueprintOpen, setBlueprintOpen] = useState(false)
  const [pos,           setPos]           = useState({ x: Math.max(0, window.innerWidth - 378), y: 56 })

  const dragging  = useRef(false)
  const dragStart = useRef(null)

  const activeMission = MISSIONS.find(m => m.id === activeMissionId) ?? null
  if (!activeMission) return null

  const isClaimed = completedMissions.some(c => c.id === activeMission.id)
  if (isClaimed) return null

  const missionEntry = MISSION_TASKS[activeMission.id]
  const tasks        = missionEntry?.tasks ?? []
  const checks       = missionEntry ? missionEntry.checkFn(devices, placements, topology) : {}
  const passed       = tasks.filter(t => !!checks[t.id]).length
  const allTasksDone = tasks.length > 0 && passed === tasks.length
  const diagFacts    = (missionEntry?.diagnoseFn && difficulty === 'beginner')
    ? missionEntry.diagnoseFn(devices, placements, topology, checks) : {}

  function onDragStart(e) {
    dragging.current = true
    dragStart.current = { mx: e.clientX, my: e.clientY, px: pos.x, py: pos.y }
    function onMove(ev) {
      if (!dragging.current) return
      setPos({
        x: Math.max(0, Math.min(window.innerWidth  - 360, dragStart.current.px + ev.clientX - dragStart.current.mx)),
        y: Math.max(0, Math.min(window.innerHeight - 60,  dragStart.current.py + ev.clientY - dragStart.current.my)),
      })
    }
    function onUp() {
      dragging.current = false
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup',   onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup',   onUp)
    e.preventDefault()
  }

  function iconBtn(label, onClick, title) {
    return (
      <button onClick={onClick} title={title} style={{
        background:'none', border:'1px solid #1a2a40', color:'#3a5a7a', cursor:'pointer',
        borderRadius:4, padding:'2px 8px', fontSize:11, lineHeight:1.4, flexShrink:0,
      }}
        onMouseEnter={e=>{e.currentTarget.style.color='#6a9ad4';e.currentTarget.style.borderColor='#2a5298'}}
        onMouseLeave={e=>{e.currentTarget.style.color='#3a5a7a';e.currentTarget.style.borderColor='#1a2a40'}}
      >{label}</button>
    )
  }

  // Compute step numbers globally across all tasks
  let stepNum = 0
  const taskStepNums = tasks.map(t => { if (!checks[t.id]) { stepNum++; return stepNum } return null })
  // Re-number for clean display: done tasks get their ordinal, active/upcoming continue
  const ordinals = tasks.map((_, i) => i + 1)

  return (
    <>
      {blueprintOpen && <BlueprintModal mission={activeMission} onClose={() => setBlueprintOpen(false)} />}

      <div style={{
        position: 'fixed', left: pos.x, top: pos.y, zIndex: 1500,
        width: 360, background: '#07091a',
        border: '1px solid #2260c8', borderRadius: 10,
        boxShadow: '0 12px 48px #00000095, 0 0 0 1px #1a3a6a10',
        display: 'flex', flexDirection: 'column',
        maxHeight: minimized ? 'none' : 'calc(100vh - 72px)',
        userSelect: 'none',
      }}>

        {/* ── Title bar / drag handle ── */}
        <div
          onMouseDown={onDragStart}
          style={{
            padding: '10px 12px',
            cursor: 'grab',
            display: 'flex', alignItems: 'center', gap: 10,
            background: '#060818',
            borderBottom: minimized ? 'none' : '1px solid #152045',
            borderRadius: minimized ? 10 : '10px 10px 0 0',
            flexShrink: 0,
          }}
        >
          <span style={{ fontSize: 22, lineHeight: 1, flexShrink: 0 }}>{activeMission.avatar}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 8, color: '#3a6aaa', letterSpacing: 2, fontWeight: 700, textTransform: 'uppercase' }}>Active Job</div>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#c4d4ec', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 1 }}>
              {activeMission.title}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 5, alignItems: 'center', flexShrink: 0 }}>
            {activeMission.blueprint && !minimized && iconBtn('◈', () => setBlueprintOpen(true), 'View blueprint')}
            {iconBtn(minimized ? '▲' : '▼', () => setMinimized(v => !v), minimized ? 'Expand' : 'Minimise')}
            {iconBtn('✕', () => setActiveJobPanelOpen(false), 'Close')}
          </div>
        </div>

        {/* ── Body ── */}
        {!minimized && (
          <div style={{ overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column' }}>

            {/* Progress header */}
            <div style={{ padding: '12px 14px 10px', flexShrink: 0, borderBottom: '1px solid #0d0f1e' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <span style={{ fontSize: 14, fontWeight: 700, color: allTasksDone ? '#50fa7b' : '#4a90e2', fontFamily: 'monospace' }}>
                    {passed}/{tasks.length}
                  </span>
                  <span style={{ fontSize: 10, color: '#2a3a5a' }}>tasks complete</span>
                </div>
                <span style={{ fontSize: 14, fontWeight: 700, color: '#50fa7b', fontFamily: 'monospace' }}>
                  ${activeMission.reward.toLocaleString()}
                </span>
              </div>
              {/* Segmented progress bar */}
              <div style={{ display: 'flex', gap: 3, height: 5 }}>
                {tasks.map((t, i) => (
                  <div key={t.id} style={{
                    flex: 1, borderRadius: 3,
                    background: checks[t.id] ? '#2a8a30'
                      : (!checks[t.id] && (i === 0 || checks[tasks[i-1]?.id])) ? '#2a60c8'
                      : '#0f1228',
                    transition: 'background 0.3s ease',
                  }} />
                ))}
              </div>
            </div>

            {/* Floor plan */}
            {activeMission.layout && <FloorPlanBrief layout={activeMission.layout} />}

            {/* Task list */}
            <div style={{ flex: 1 }}>
              {tasks.map((task, i) => {
                const isChecked   = !!checks[task.id]
                const prevChecked = i === 0 || !!checks[tasks[i - 1].id]
                const isActive    = !isChecked && prevChecked
                const num         = ordinals[i]
                if (isChecked) return <DoneTask     key={task.id} task={task} num={num} />
                if (isActive)  return <ActiveTask   key={task.id} task={task} num={num} difficulty={difficulty} diagLines={diagFacts[task.id] ?? null} executedCommands={executedCommandsRef.current} />
                return             <UpcomingTask key={task.id} task={task} num={num} />
              })}
              {allTasksDone && (
                <div style={{ padding: '16px 14px', textAlign: 'center' }}>
                  <div style={{ fontSize: 12, color: '#50fa7b', fontWeight: 700, letterSpacing: 1 }}>ALL TASKS COMPLETE</div>
                  <div style={{ fontSize: 10, color: '#2a4a2a', marginTop: 4 }}>Collect your reward from the completion screen</div>
                </div>
              )}
            </div>

          </div>
        )}

      </div>
    </>
  )
}
