import { useState, useRef } from 'react'
import { useGame } from '../state/GameContext.jsx'
import { findMissionById } from '../data/missionDefinitions/index.js'
import { getMissionRuntime } from '../engine/missionEngine.js'
import { MissionBlueprintSvg, FloorPlanZoneList } from './MissionBlueprint.jsx'
import { MissionProgressBar, MissionTaskRows } from './MissionTaskList.jsx'

// ── Blueprint modal ───────────────────────────────────────────────────────────

function BlueprintModal({ mission, onClose }) {
  if (!mission.blueprint) return null
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
        <MissionBlueprintSvg blueprint={mission.blueprint} />
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
          <FloorPlanZoneList layout={layout} />
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

  const activeMission = findMissionById(activeMissionId)
  if (!activeMission) return null

  const isClaimed = completedMissions.some(c => c.id === activeMission.id)
  if (isClaimed) return null

  const missionEntry = getMissionRuntime(activeMission.id)
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
            <div title={activeMission.title} style={{ fontSize: 13, fontWeight: 700, color: '#c4d4ec', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 1 }}>
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
              <MissionProgressBar tasks={tasks} checks={checks} />
            </div>

            {/* Floor plan */}
            {activeMission.layout && <FloorPlanBrief layout={activeMission.layout} />}

            {/* Task list */}
            <div style={{ flex: 1 }}>
              <MissionTaskRows
                tasks={tasks} checks={checks} difficulty={difficulty}
                diagFacts={diagFacts} executedCommands={executedCommandsRef.current}
              />
            </div>

          </div>
        )}

      </div>
    </>
  )
}
