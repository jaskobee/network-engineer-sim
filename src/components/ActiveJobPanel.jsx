import { useState, useRef, useEffect } from 'react'
import { useGame } from '../state/GameContext.jsx'
import { useCareer } from '../state/CareerContext.jsx'
import { findMissionById } from '../data/missionDefinitions/index.js'
import { getMissionRuntime, getMissionMeta, resolveMissionRoles, buildRuntimeFromDefinition } from '../engine/missionEngine.js'
import { computeRefund } from '../engine/economy.js'
import { CONTRACT_TYPES } from '../data/contracts.js'
import { MissionBlueprintSvg, FloorPlanZoneList } from './MissionBlueprint.jsx'
import { MissionProgressBar, MissionTaskRows } from './MissionTaskList.jsx'

// ── Completion modal ──────────────────────────────────────────────────────────
//
// A staged reveal: reward → (client missions only) reputation gained →
// (only if the mission offers one) a contract offer the player can accept or
// skip. Driven by local phase state rather than the live activeMission, since
// collecting the reward clears activeMissionId immediately (GameContext) —
// the modal must keep showing itself through the later phases regardless.

function CompletionModal({ mission, refund, onCollect, onAcceptContract, onFinish }) {
  const [phase, setPhase] = useState('reward') // 'reward' | 'reputation' | 'contract'
  const [outcome, setOutcome] = useState(null)
  const skills = mission.taught ?? []
  const total  = mission.reward + (refund || 0)

  function handleCollect() {
    const result = onCollect() // null for legacy missions; career outcome object for client missions
    if (result) {
      setOutcome(result)
      setPhase('reputation')
    } else {
      onFinish()
    }
  }

  function handleReputationContinue() {
    if (outcome?.hasContractOffer) setPhase('contract')
    else onFinish()
  }

  function handleAcceptContract() {
    onAcceptContract()
    onFinish()
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 2000,
      background: 'rgba(0,0,0,0.75)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{
        background: '#0d1226', border: '2px solid #50fa7b', borderRadius: 12,
        padding: '32px 36px', maxWidth: 440, width: '90%',
        boxShadow: '0 0 60px #50fa7b30', textAlign: 'center',
      }}>
        {phase === 'reward' && (
          <>
            <div style={{ fontSize: 48, marginBottom: 8 }}>{mission.avatar}</div>
            <div style={{ fontSize: 11, color: '#50fa7b', fontWeight: 700, letterSpacing: 2, marginBottom: 8 }}>MISSION COMPLETE</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#e0e0e0', marginBottom: 4 }}>{mission.title}</div>
            <div style={{ fontSize: 11, color: '#555', marginBottom: 20 }}>{mission.client} is happy with your work.</div>
            {skills.length > 0 && (
              <div style={{ background: '#070d1a', borderRadius: 8, padding: '14px 16px', textAlign: 'left', marginBottom: 20 }}>
                <div style={{ fontSize: 10, color: '#4a90e2', fontWeight: 700, letterSpacing: 1, marginBottom: 8 }}>WHAT YOU CONFIGURED</div>
                {skills.map((s, i) => (
                  <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginBottom: 5 }}>
                    <span style={{ color: '#50fa7b', fontSize: 12, marginTop: 1 }}>✓</span>
                    <span style={{ fontSize: 12, color: '#c0c0c0' }}>{s}</span>
                  </div>
                ))}
              </div>
            )}
            <div style={{ background: '#070d1a', borderRadius: 8, padding: '12px 16px', marginBottom: 24, textAlign: 'left' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={{ fontSize: 11, color: '#555' }}>Job payout</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: '#50fa7b', fontFamily: 'monospace' }}>+${mission.reward.toLocaleString()}</span>
              </div>
              {refund > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span style={{ fontSize: 11, color: '#555' }}>Equipment returned</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: '#4a90e2', fontFamily: 'monospace' }}>+${refund.toLocaleString()}</span>
                </div>
              )}
              <div style={{ height: 1, background: '#1a2a40', margin: '8px 0' }} />
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 12, color: '#888', fontWeight: 700 }}>TOTAL</span>
                <span style={{ fontSize: 20, fontWeight: 700, color: '#50fa7b', fontFamily: 'monospace' }}>+${total.toLocaleString()}</span>
              </div>
            </div>
            <button
              onClick={handleCollect}
              style={{ background: '#50fa7b', color: '#0a0a0f', border: 'none', borderRadius: 6, padding: '10px 32px', fontSize: 14, fontWeight: 700, cursor: 'pointer', letterSpacing: 1 }}
              onMouseEnter={e => { e.currentTarget.style.background = '#40ea6b' }}
              onMouseLeave={e => { e.currentTarget.style.background = '#50fa7b' }}
            >COLLECT REWARD</button>
            <div style={{ fontSize: 10, color: '#2a2a40', marginTop: 12 }}>Your setup stays up — explore it, then accept the next job when ready.</div>
          </>
        )}

        {phase === 'reputation' && outcome && (
          <>
            <div style={{ fontSize: 40, marginBottom: 8 }}>📈</div>
            <div style={{ fontSize: 11, color: '#8ab4d4', fontWeight: 700, letterSpacing: 2, marginBottom: 8 }}>REPUTATION EARNED</div>
            <div style={{ fontSize: 30, fontWeight: 700, color: '#50fa7b', fontFamily: 'monospace', marginBottom: 4 }}>
              +{outcome.reputationGained}
            </div>
            <div style={{ fontSize: 13, color: '#c0c0c0', marginBottom: 24 }}>
              You are now: <strong style={{ color: '#8ab4d4' }}>{outcome.tierLabel}</strong>
            </div>
            <button
              onClick={handleReputationContinue}
              style={{ background: '#2a5298', color: '#e0e0e0', border: 'none', borderRadius: 6, padding: '10px 32px', fontSize: 14, fontWeight: 700, cursor: 'pointer', letterSpacing: 1 }}
              onMouseEnter={e => { e.currentTarget.style.background = '#3a6ab8' }}
              onMouseLeave={e => { e.currentTarget.style.background = '#2a5298' }}
            >CONTINUE</button>
          </>
        )}

        {phase === 'contract' && (
          <>
            <div style={{ fontSize: 40, marginBottom: 8 }}>📋</div>
            <div style={{ fontSize: 11, color: '#ffb86c', fontWeight: 700, letterSpacing: 2, marginBottom: 8 }}>CONTRACT OFFER</div>
            <div style={{ fontSize: 14, color: '#c0c0c0', marginBottom: 16 }}>
              {mission.client} wants to keep working with you.
            </div>
            {(() => {
              const def = CONTRACT_TYPES[mission.contractOutcome?.type]
              if (!def) return null
              return (
                <div style={{ background: '#070d1a', borderRadius: 8, padding: '14px 16px', textAlign: 'left', marginBottom: 24 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: '#e0e0e0' }}>{def.label}</span>
                    <span style={{ fontSize: 15, fontWeight: 700, color: '#50fa7b', fontFamily: 'monospace' }}>${def.amountPerMonth}/mo</span>
                  </div>
                  {def.services.map((s, i) => (
                    <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginBottom: 4 }}>
                      <span style={{ color: '#4a90e2', fontSize: 11 }}>•</span>
                      <span style={{ fontSize: 11, color: '#8090b0' }}>{s}</span>
                    </div>
                  ))}
                </div>
              )
            })()}
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
              <button
                onClick={onFinish}
                style={{ padding: '10px 20px', fontSize: 12, fontWeight: 600, background: 'transparent', color: '#556', border: '1px solid #1a2a40', borderRadius: 6, cursor: 'pointer' }}
              >Not Right Now</button>
              <button
                onClick={handleAcceptContract}
                style={{ background: '#50fa7b', color: '#0a0a0f', border: 'none', borderRadius: 6, padding: '10px 28px', fontSize: 13, fontWeight: 700, cursor: 'pointer', letterSpacing: 0.5 }}
              >ACCEPT CONTRACT</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

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
    activeMissionId, activeTicket, difficulty,
    completedMissions, completeMission, completeTicket: completeTicketGame,
    executedCommandsRef,
  } = useGame()
  const { clients, completeClientMission, acceptContractOffer, completeTicket: completeTicketCareer } = useCareer()

  void tick

  const [minimized,     setMinimized]     = useState(false)
  const [blueprintOpen, setBlueprintOpen] = useState(false)
  // Default/clamped x leaves room for the 46px Career rail (App.jsx's
  // RAIL_WIDTH) at the right edge, so the panel never starts on top of it —
  // it's the one icon that must always stay reachable.
  const [pos,           setPos]           = useState({ x: Math.max(0, window.innerWidth - 424), y: 56 })

  const dragging  = useRef(false)
  const dragStart = useRef(null)

  // A background contract ticket is a lighter-weight stand-in for a mission —
  // same checklist rendering, no blueprint/floor-plan/prerequisite chrome.
  const activeMission = activeMissionId ? findMissionById(activeMissionId) : null
  const isTicket = !activeMissionId && !!activeTicket
  const isClaimed = activeMission ? completedMissions.some(c => c.id === activeMission.id) : false
  // hasActiveJob can go false mid-flow (completeMission() clears activeMissionId
  // immediately on collect) while the reward->reputation->contract modal still
  // has phases left to show — completionSnapshot below is what keeps the modal
  // alive through that, independent of the live activeMissionId.
  const hasActiveJob = (!!activeMission && !isClaimed) || isTicket

  const displaySubject = activeMission ?? activeTicket
  const missionEntry = activeMission ? getMissionRuntime(activeMission.id)
    : isTicket ? buildRuntimeFromDefinition(activeTicket) : null
  const tasks        = missionEntry?.tasks ?? []
  const checks       = missionEntry ? missionEntry.checkFn(devices, placements, topology) : {}
  const passed       = tasks.filter(t => !!checks[t.id]).length
  const allTasksDone = tasks.length > 0 && passed === tasks.length
  const diagFacts    = (missionEntry?.diagnoseFn && difficulty === 'beginner')
    ? missionEntry.diagnoseFn(devices, placements, topology, checks) : {}
  const resolvedRoles = hasActiveJob ? resolveMissionRoles(displaySubject, devices) : {}

  // 'keep' missions (persistent client infrastructure) never refund — must
  // match GameContext.completeMission's own financialModel check exactly (it
  // reuses this same computeRefund()), or this preview would show an
  // "Equipment returned" line the actual budget update never applies.
  const pendingRefund = (activeMission && getMissionMeta(activeMission.id).financialModel === 'keep')
    ? 0
    : computeRefund(topology)
  const showModal = allTasksDone && activeMission && !isClaimed

  // Completion modal survives past collect (which clears activeMissionId) by
  // snapshotting the mission/refund locally the moment the modal is due to
  // show, rather than re-deriving them from the (soon-to-be-cleared) live state.
  const [completionSnapshot, setCompletionSnapshot] = useState(null)
  useEffect(() => {
    if (showModal && completionSnapshot?.mission.id !== activeMission?.id) {
      setCompletionSnapshot({ mission: activeMission, refund: pendingRefund })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showModal, activeMission?.id])

  if (!hasActiveJob && !completionSnapshot) return null

  function handleCollectReward() {
    const { mission } = completionSnapshot
    completeMission(mission.id, mission.reward)
    const meta = getMissionMeta(mission.id)
    if (!meta.clientId) return null
    const { reputationGained, newReputation, tierLabel } = completeClientMission(mission)
    return {
      reputationGained, newReputation, tierLabel,
      hasContractOffer: !!mission.contractOutcome && !clients[meta.clientId]?.currentContractId,
    }
  }

  function handleAcceptContract() {
    const { mission } = completionSnapshot
    const meta = getMissionMeta(mission.id)
    acceptContractOffer(meta.clientId, mission)
  }

  function handleCompleteTicket() {
    completeTicketCareer(activeTicket, Date.now())
    completeTicketGame(activeTicket.reward)
  }

  function onDragStart(e) {
    dragging.current = true
    dragStart.current = { mx: e.clientX, my: e.clientY, px: pos.x, py: pos.y }
    function onMove(ev) {
      if (!dragging.current) return
      setPos({
        x: Math.max(0, Math.min(window.innerWidth  - 406, dragStart.current.px + ev.clientX - dragStart.current.mx)),
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
      {completionSnapshot && (
        <CompletionModal
          mission={completionSnapshot.mission}
          refund={completionSnapshot.refund}
          onCollect={handleCollectReward}
          onAcceptContract={handleAcceptContract}
          onFinish={() => setCompletionSnapshot(null)}
        />
      )}

      {hasActiveJob && (
      <>
      {blueprintOpen && activeMission && <BlueprintModal mission={activeMission} onClose={() => setBlueprintOpen(false)} />}

      <div style={{
        position: 'fixed', left: pos.x, top: pos.y, zIndex: 1500,
        width: 360, background: '#07091a',
        border: '1px solid #2260c8', borderRadius: 10,
        boxShadow: '0 12px 48px #00000095, 0 0 0 1px #1a3a6a10',
        display: 'flex', flexDirection: 'column',
        maxHeight: minimized ? 'none' : 'calc(100vh - 72px)',
        userSelect: 'none',
      }}>

        {/* ── Title bar / drag handle ──
            No "close" button — with the active job's checklist no longer
            duplicated anywhere else (see MissionPanel/CareerDock), minimize
            is the only "get out of the way" affordance, so a job in progress
            is never fully unreachable. */}
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
          <span style={{ fontSize: 22, lineHeight: 1, flexShrink: 0 }}>{activeMission ? activeMission.avatar : '🔧'}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 8, color: '#3a6aaa', letterSpacing: 2, fontWeight: 700, textTransform: 'uppercase' }}>
              {isTicket ? 'Contract Ticket' : 'Active Job'}
            </div>
            <div title={displaySubject.title} style={{ fontSize: 13, fontWeight: 700, color: '#c4d4ec', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 1 }}>
              {displaySubject.title}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 5, alignItems: 'center', flexShrink: 0 }}>
            {activeMission?.blueprint && !minimized && iconBtn('◈', () => setBlueprintOpen(true), 'View blueprint')}
            {iconBtn(minimized ? '▲' : '▼', () => setMinimized(v => !v), minimized ? 'Expand' : 'Minimise')}
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
                  ${displaySubject.reward.toLocaleString()}
                </span>
              </div>
              {/* Segmented progress bar */}
              <MissionProgressBar tasks={tasks} checks={checks} />
            </div>

            {/* Floor plan */}
            {activeMission?.layout && <FloorPlanBrief layout={activeMission.layout} />}

            {/* Task list */}
            <div style={{ flex: 1 }}>
              <MissionTaskRows
                tasks={tasks} checks={checks} difficulty={difficulty}
                diagFacts={diagFacts} executedCommands={executedCommandsRef.current}
                resolvedRoles={resolvedRoles}
              />
            </div>

            {/* Routine ticket work uses a plain inline "mark complete" button
                instead of the staged reward->reputation->contract modal —
                that flow is mission-only. */}
            {isTicket && allTasksDone && (
              <div style={{ padding: '4px 14px 14px', flexShrink: 0 }}>
                <button
                  onClick={handleCompleteTicket}
                  style={{
                    width: '100%', padding: '10px 0', fontSize: 12, fontWeight: 700, letterSpacing: 0.5,
                    background: '#50fa7b', color: '#0a0a0f', border: 'none', borderRadius: 6, cursor: 'pointer',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = '#40ea6b' }}
                  onMouseLeave={e => { e.currentTarget.style.background = '#50fa7b' }}
                >MARK TICKET COMPLETE — +${activeTicket.reward}</button>
              </div>
            )}

          </div>
        )}

      </div>
      </>
      )}
    </>
  )
}
