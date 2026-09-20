import { useState, useRef, useEffect } from 'react'
import { useGame } from '../state/GameContext.jsx'
import { useCareer } from '../state/CareerContext.jsx'
import { findMissionById } from '../data/missionDefinitions/index.js'
import { getMissionRuntime, getMissionMeta, resolveMissionRoles, buildRuntimeFromDefinition } from '../engine/missionEngine.js'
import { computeRefund } from '../engine/economy.js'
import { CONTRACT_TYPES } from '../data/contracts.js'
import { MissionBlueprintSvg, FloorPlanZoneList } from './MissionBlueprint.jsx'
import { MissionProgressBar, MissionTaskRows } from './MissionTaskList.jsx'
import { IconChevronDown, IconChevronUp, IconDiagram } from './icons.jsx'

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
        background: 'var(--surface-panel)', border: '1px solid #2f9a68', borderRadius: 14,
        padding: '32px 36px', maxWidth: 440, width: '90%',
        boxShadow: '0 0 0 1px #0b0f11, 0 24px 70px rgba(0,0,0,.65), 0 0 60px #3ee08f18', textAlign: 'center',
      }}>
        {phase === 'reward' && (
          <>
            <div style={{ fontSize: 48, marginBottom: 8 }}>{mission.avatar}</div>
            <div style={{ fontSize: 15, color: '#3ee08f', fontWeight: 700, marginBottom: 6 }}>Mission complete</div>
            <div style={{ fontSize: 21, fontWeight: 700, color: '#e8eef2', marginBottom: 4 }}>{mission.title}</div>
            <div style={{ fontSize: 14, color: '#738ea2', marginBottom: 20 }}>{mission.client} is happy with your work.</div>
            {skills.length > 0 && (
              <div style={{ background: '#081119', borderRadius: 8, padding: '14px 16px', textAlign: 'left', marginBottom: 20 }}>
                <div style={{ fontSize: 14, color: 'var(--ink-2)', fontWeight: 600, marginBottom: 8 }}>What you configured</div>
                {skills.map((s, i) => (
                  <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginBottom: 5 }}>
                    <span style={{ color: '#3ee08f', fontSize: 14.5, marginTop: 1 }}>✓</span>
                    <span style={{ fontSize: 14.5, color: '#b8c1c8' }}>{s}</span>
                  </div>
                ))}
              </div>
            )}
            <div style={{ background: '#081119', borderRadius: 8, padding: '12px 16px', marginBottom: 24, textAlign: 'left' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={{ fontSize: 14, color: '#738ea2' }}>Job payout</span>
                <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink)' }}>+${mission.reward.toLocaleString()}</span>
              </div>
              {refund > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span style={{ fontSize: 14, color: '#738ea2' }}>Equipment returned</span>
                  <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink)' }}>+${refund.toLocaleString()}</span>
                </div>
              )}
              <div style={{ height: 1, background: '#212c34', margin: '8px 0' }} />
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 14.5, color: '#738ea2', fontWeight: 700 }}>Total</span>
                <span style={{ fontSize: 24, fontWeight: 700, color: '#3ee08f' }}>+${total.toLocaleString()}</span>
              </div>
            </div>
            <button
              onClick={handleCollect}
              style={{ background: '#3ee08f', color: '#0b0f11', border: 'none', borderRadius: 6, padding: '10px 32px', fontSize: 17, fontWeight: 700, cursor: 'pointer' }}
              onMouseEnter={e => { e.currentTarget.style.background = '#48e290' }}
              onMouseLeave={e => { e.currentTarget.style.background = '#3ee08f' }}
            >Collect reward</button>
            <div style={{ fontSize: 13, color: '#7091a6', marginTop: 12 }}>Your setup stays up — explore it, then accept the next job when ready.</div>
          </>
        )}

        {phase === 'reputation' && outcome && (
          <>
            <div style={{ fontSize: 40, marginBottom: 8 }}>📈</div>
            <div style={{ fontSize: 15, color: 'var(--ink-2)', fontWeight: 600, marginBottom: 6 }}>Reputation earned</div>
            <div style={{ fontSize: 36, fontWeight: 700, color: '#3ee08f', marginBottom: 4 }}>
              +{outcome.reputationGained}
            </div>
            <div style={{ fontSize: 15.5, color: '#b8c1c8', marginBottom: 24 }}>
              You are now: <strong style={{ color: '#8ab3d4' }}>{outcome.tierLabel}</strong>
            </div>
            <button
              onClick={handleReputationContinue}
              style={{ background: '#2f6fbd', color: '#e8eef2', border: 'none', borderRadius: 6, padding: '10px 32px', fontSize: 17, fontWeight: 700, cursor: 'pointer' }}
              onMouseEnter={e => { e.currentTarget.style.background = '#3f7fcf' }}
              onMouseLeave={e => { e.currentTarget.style.background = '#2f6fbd' }}
            >Continue</button>
          </>
        )}

        {phase === 'contract' && (
          <>
            <div style={{ fontSize: 40, marginBottom: 8 }}>📋</div>
            <div style={{ fontSize: 15, color: '#ffb42e', fontWeight: 700, marginBottom: 6 }}>Contract offer</div>
            <div style={{ fontSize: 16.5, color: '#b8c1c8', marginBottom: 16 }}>
              {mission.client} wants to keep working with you.
            </div>
            {(() => {
              const def = CONTRACT_TYPES[mission.contractOutcome?.type]
              if (!def) return null
              return (
                <div style={{ background: '#081119', borderRadius: 8, padding: '14px 16px', textAlign: 'left', marginBottom: 24 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
                    <span style={{ fontSize: 15.5, fontWeight: 700, color: '#e8eef2' }}>{def.label}</span>
                    <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--ink)' }}>${def.amountPerMonth}/mo</span>
                  </div>
                  {def.services.map((s, i) => (
                    <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginBottom: 4 }}>
                      <span style={{ color: '#4da6ff', fontSize: 14 }}>•</span>
                      <span style={{ fontSize: 14, color: '#8099b0' }}>{s}</span>
                    </div>
                  ))}
                </div>
              )
            })()}
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
              <button
                onClick={onFinish}
                style={{ padding: '10px 20px', fontSize: 14.5, fontWeight: 600, background: 'transparent', color: '#738fa2', border: '1px solid #212c34', borderRadius: 6, cursor: 'pointer' }}
              >Not right now</button>
              <button
                onClick={handleAcceptContract}
                style={{ background: '#3ee08f', color: '#0b0f11', border: 'none', borderRadius: 6, padding: '10px 28px', fontSize: 16, fontWeight: 700, cursor: 'pointer' }}
              >Accept contract</button>
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
      <div style={{background:'#0a121a',border:'1px solid #1f3e5b',borderRadius:10,padding:'18px 20px',maxWidth:460,width:'90vw',boxShadow:'0 0 60px #224e7820'}} onClick={e=>e.stopPropagation()}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:12}}>
          <div>
            <div style={{fontSize:13.5,color:'var(--ink-3)',fontWeight:600,marginBottom:2}}>Network blueprint</div>
            <div style={{fontSize:15.5,fontWeight:700,color:'#b0c1d0'}}>{mission.title}</div>
          </div>
          <button onClick={onClose} style={{background:'none',border:'1px solid #212c34',color:'#7291a6',cursor:'pointer',borderRadius:4,padding:'2px 8px',fontSize:14.5}}>✕</button>
        </div>
        <MissionBlueprintSvg blueprint={mission.blueprint} />
        <div style={{textAlign:'center',marginTop:14}}>
          <button onClick={onClose} style={{background:'#0e1a26',border:'1px solid #23405b',color:'#718fa5',padding:'7px 24px',borderRadius:5,fontSize:14,fontWeight:700,cursor:'pointer'}}
            onMouseEnter={e=>{e.currentTarget.style.color='#5a96c8';e.currentTarget.style.borderColor='#30567a'}}
            onMouseLeave={e=>{e.currentTarget.style.color='#718fa5';e.currentTarget.style.borderColor='#23405b'}}
          >Got it</button>
        </div>
      </div>
    </div>
  )
}

// ── Floor plan brief ──────────────────────────────────────────────────────────

function FloorPlanBrief({ layout }) {
  const [open, setOpen] = useState(false)
  return (
    <div style={{margin:'0 12px 8px',borderRadius:5,overflow:'hidden',border:'1px solid #171f24'}}>
      <button onClick={()=>setOpen(v=>!v)} style={{width:'100%',display:'flex',justifyContent:'space-between',alignItems:'center',padding:'6px 10px',background:'#091119',border:'none',cursor:'pointer'}}
        onMouseEnter={e=>{e.currentTarget.style.background='#11171c'}} onMouseLeave={e=>{e.currentTarget.style.background='#091119'}}>
        <span style={{display:'flex',alignItems:'center',gap:6,fontSize:14,fontWeight:600,color:'var(--ink-2)'}}>{open?<IconChevronUp size={15}/>:<IconChevronDown size={15}/>} Floor plan</span>
        <span style={{fontSize:13,color:'var(--ink-3)'}}>{open?'Hide zones':'Show zones'}</span>
      </button>
      {open && (
        <div style={{background:'#081018',padding:'10px 10px 6px'}}>
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
      <button className="btn ghost icon" onClick={onClick} title={title} aria-label={title} style={{ flexShrink: 0 }}>
        {label}
      </button>
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
        width: 380, background: 'var(--surface-panel)',
        border: '1px solid var(--rule-strong)', borderRadius: 12,
        boxShadow: '0 16px 56px rgba(0,0,0,.6), 0 0 0 1px #0b0f11',
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
            background: 'var(--surface-raised)',
            borderBottom: minimized ? 'none' : '1px solid var(--rule)',
            borderRadius: minimized ? 12 : '12px 12px 0 0',
            flexShrink: 0,
          }}
        >
          <span style={{ fontSize: 25, lineHeight: 1, flexShrink: 0 }}>{activeMission ? activeMission.avatar : '🔧'}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, color: 'var(--ink-3)', fontWeight: 600 }}>
              {isTicket ? 'Contract ticket' : 'Active job'}
            </div>
            <div title={displaySubject.title} style={{ fontSize: 17, fontWeight: 700, color: 'var(--ink)', lineHeight: 1.2, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', marginTop: 1 }}>
              {displaySubject.title}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 5, alignItems: 'center', flexShrink: 0 }}>
            {activeMission?.blueprint && !minimized && iconBtn(<IconDiagram size={16} />, () => setBlueprintOpen(true), 'View blueprint')}
            {iconBtn(minimized ? <IconChevronUp size={16} /> : <IconChevronDown size={16} />, () => setMinimized(v => !v), minimized ? 'Expand' : 'Minimise')}
          </div>
        </div>

        {/* ── Body ── */}
        {!minimized && (
          <div style={{ overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column' }}>

            {/* Progress header */}
            <div style={{ padding: '12px 14px 10px', flexShrink: 0, borderBottom: '1px solid var(--rule)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <span style={{ fontSize: 17, fontWeight: 700, color: allTasksDone ? '#3ee08f' : 'var(--ink)' }}>
                    {passed}/{tasks.length}
                  </span>
                  <span style={{ fontSize: 14, color: 'var(--ink-3)' }}>tasks complete</span>
                </div>
                <span style={{ fontSize: 17, fontWeight: 700, color: 'var(--ink)' }}>
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
                    width: '100%', padding: '10px 0', fontSize: 15.5, fontWeight: 700,
                    background: '#3ee08f', color: '#0b0f11', border: 'none', borderRadius: 6, cursor: 'pointer',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = '#48e290' }}
                  onMouseLeave={e => { e.currentTarget.style.background = '#3ee08f' }}
                >Mark ticket complete — +${activeTicket.reward}</button>
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
