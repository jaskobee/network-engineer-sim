import { useEffect, useRef, useState } from 'react'
import { useGame } from '../state/GameContext.jsx'
import { useCareer } from '../state/CareerContext.jsx'
import { MISSIONS } from '../data/missions.js'
import { MISSION_DEFINITIONS, findMissionById } from '../data/missionDefinitions/index.js'
import { getMissionRuntime, getMissionMeta } from '../engine/missionEngine.js'
import { computeRefund } from '../engine/economy.js'
import { CONTRACT_TYPES } from '../data/contracts.js'
import CompanyDashboard from './CompanyDashboard.jsx'
import MissionBriefModal from './MissionBriefModal.jsx'
import { MissionProgressBar, MissionTaskRows } from './MissionTaskList.jsx'

// ── Helpers ───────────────────────────────────────────────────────────────────

function Stars({ n }) {
  const max = 5
  const filled = Math.max(0, Math.min(n ?? 0, max))
  return (
    <span style={{ color: '#ffb86c', fontSize: 10 }}>
      {'★'.repeat(filled)}{'☆'.repeat(max - filled)}
    </span>
  )
}

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

// ── Job card ──────────────────────────────────────────────────────────────────

function JobCard({ mission, unlocked, lockedReason, onOpenBrief }) {
  const hw = mission.hardware ?? []
  return (
    <div style={{
      margin: '0 0 12px',
      background: '#0a0f1e',
      border: `1px solid ${unlocked ? '#1e3a6a' : '#0d0d20'}`,
      borderRadius: 8,
      overflow: 'hidden',
      opacity: unlocked ? 1 : 0.45,
      transition: 'border-color 0.15s',
    }}
      onMouseEnter={e => { if (unlocked) e.currentTarget.style.borderColor = '#2a5298' }}
      onMouseLeave={e => { if (unlocked) e.currentTarget.style.borderColor = '#1e3a6a' }}
    >
      {/* Card header */}
      <div style={{ padding: '12px 14px 8px', display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <span style={{ fontSize: 28, lineHeight: 1.1, flexShrink: 0 }}>{mission.avatar}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#c8d0e0', marginBottom: 2 }}>{mission.title}</div>
          <div style={{ fontSize: 10, color: '#3a4a6a' }}>{mission.client}</div>
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#50fa7b', fontFamily: 'monospace' }}>
            ${mission.reward.toLocaleString()}
          </div>
          <Stars n={mission.difficulty} />
        </div>
      </div>

      {/* Description + hardware tags */}
      <div style={{ padding: '0 14px 12px', borderTop: '1px solid #0d0d20' }}>
        <div style={{ fontSize: 11, color: unlocked ? '#4a5a8a' : '#22223a', lineHeight: 1.65, marginTop: 8, marginBottom: hw.length > 0 ? 8 : 0 }}>
          {unlocked ? mission.description : `🔒 ${lockedReason}`}
        </div>
        {hw.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: unlocked ? 10 : 0 }}>
            {hw.map((h, i) => (
              <span key={i} style={{
                fontSize: 9, fontFamily: 'monospace',
                color: unlocked ? '#4a90e2' : '#222244',
                background: unlocked ? '#0a1528' : '#0a0a14',
                padding: '2px 7px', borderRadius: 3,
                border: `1px solid ${unlocked ? '#1a3060' : '#1a1a30'}`,
              }}>{h.label}</span>
            ))}
          </div>
        )}
        {unlocked && (
          <button
            onClick={onOpenBrief}
            style={{
              width: '100%', padding: '8px 0', fontSize: 12, fontWeight: 700,
              background: '#0f1e3a', color: '#4a90e2',
              border: '1px solid #2a5298', borderRadius: 5, cursor: 'pointer',
              letterSpacing: 0.5, transition: 'all 0.15s',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = '#1e3a6a'; e.currentTarget.style.color = '#e0e0e0' }}
            onMouseLeave={e => { e.currentTarget.style.background = '#0f1e3a'; e.currentTarget.style.color = '#4a90e2' }}
          >VIEW JOB</button>
        )}
      </div>
    </div>
  )
}

// ── Archived completed mission ─────────────────────────────────────────────────

function ArchivedMission({ mission }) {
  const [expanded, setExpanded] = useState(false)
  const tasks = getMissionRuntime(mission.id)?.tasks ?? []
  return (
    <div style={{ borderBottom: '1px solid #0d0d1a' }}>
      <div
        onClick={() => setExpanded(e => !e)}
        style={{ padding: '8px 14px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}
        onMouseEnter={e => { e.currentTarget.style.background = '#0a0f1a' }}
        onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
      >
        <span style={{ fontSize: 16 }}>{mission.avatar}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 10, color: '#50fa7b', fontWeight: 700 }}>✓ COMPLETE</div>
          <div style={{ fontSize: 11, color: '#2a6a2a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{mission.title}</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
          <div style={{ fontSize: 11, color: '#2a6a2a', fontFamily: 'monospace' }}>+${mission.reward.toLocaleString()}</div>
          <span style={{ fontSize: 9, color: '#2a2a50' }}>{expanded ? '▲' : '▼'}</span>
        </div>
      </div>
      {expanded && tasks.length > 0 && (
        <div style={{ background: '#070a10', borderTop: '1px solid #0d0d1a' }}>
          {tasks.map(task => (
            <div key={task.id} style={{ padding: '5px 14px 5px 36px', borderBottom: '1px solid #0a0a12', display: 'flex', gap: 8, alignItems: 'center' }}>
              <span style={{ fontSize: 10, color: '#1a5a1a' }}>✓</span>
              <span style={{ fontSize: 11, color: '#1a5a1a', textDecoration: 'line-through' }}>{task.label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Panel root ────────────────────────────────────────────────────────────────

export default function MissionPanel() {
  const {
    devices, placements, topology, budget, tick,
    completedMissions, completeMission,
    activeMissionId, acceptMission,
    difficulty,
    activeJobPanelOpen, setActiveJobPanelOpen,
    executedCommandsRef,
  } = useGame()
  const { reputation, clients, completeClientMission, acceptContractOffer } = useCareer()

  void tick

  // Auto-collapse the job board list when a mission becomes active, and
  // auto-reopen it when one finishes — otherwise a newly-unlocked follow-up
  // job (the whole payoff of completing one) stays hidden behind a collapsed
  // list the player has no reason to think to reopen.
  const [jobBoardOpen, setJobBoardOpen] = useState(true)
  const prevMissionIdRef = useRef(activeMissionId)
  useEffect(() => {
    if (activeMissionId && !prevMissionIdRef.current) setJobBoardOpen(false)
    if (!activeMissionId && prevMissionIdRef.current) setJobBoardOpen(true)
    prevMissionIdRef.current = activeMissionId
  }, [activeMissionId])

  // Mission Brief modal — shown on card click, before a job is actually accepted
  const [briefMission, setBriefMission] = useState(null)

  const activeMission   = findMissionById(activeMissionId)
  const allDone         = completedMissions.length === MISSIONS.length
  const totalEarned     = completedMissions.reduce((s, m) => s + m.reward, 0)

  // Check task completion for the completion modal trigger
  const missionEntry = activeMission ? getMissionRuntime(activeMission.id) : null
  const tasks        = missionEntry?.tasks ?? []
  const checks       = missionEntry ? missionEntry.checkFn(devices, placements, topology) : {}
  const passed       = tasks.filter(t => !!checks[t.id]).length
  const allTasksDone = tasks.length > 0 && passed === tasks.length
  const isClaimed    = activeMission ? completedMissions.some(c => c.id === activeMission.id) : false
  const showModal    = allTasksDone && activeMission && !isClaimed
  const diagFacts     = (missionEntry?.diagnoseFn && difficulty === 'beginner')
    ? missionEntry.diagnoseFn(devices, placements, topology, checks) : {}

  // 'keep' missions (persistent client infrastructure) never refund — must
  // match GameContext.completeMission's own financialModel check exactly (it
  // reuses this same computeRefund()), or this preview would show an
  // "Equipment returned" line the actual budget update never applies.
  const pendingRefund = (activeMission && getMissionMeta(activeMission.id).financialModel === 'keep')
    ? 0
    : computeRefund(topology)

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

  // ── Job board sourcing: legacy MISSIONS (linear prerequisite chain) merged
  // with declarative client missions (sourced from each client's own
  // availableFutureMissionIds, gated by reputation instead of a prerequisite).
  const legacyCards = MISSIONS.filter(m =>
    !completedMissions.some(c => c.id === m.id) && m.id !== activeMissionId
  )
  const clientCards = Object.values(clients).flatMap(client =>
    client.availableFutureMissionIds
      .map(id => MISSION_DEFINITIONS[id])
      .filter(m => m && !completedMissions.some(c => c.id === m.id) && m.id !== activeMissionId)
  )
  const jobBoardMissions = [...legacyCards, ...clientCards]

  function unlockInfo(m) {
    if (m.clientId) {
      const met = reputation >= (m.requiredReputation ?? 0)
      return { unlocked: met && !activeMission, lockedReason: met ? '' : `Requires ${m.requiredReputation} reputation` }
    }
    const prereqDone = m.prerequisite ? completedMissions.some(c => c.id === m.prerequisite) : true
    return { unlocked: prereqDone && !activeMission, lockedReason: 'Complete the previous job first' }
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

      {briefMission && (
        <MissionBriefModal
          mission={briefMission}
          reputation={reputation}
          onClose={() => setBriefMission(null)}
          onStart={() => { acceptMission(briefMission.id); setBriefMission(null) }}
        />
      )}

      <div style={{
        display: 'flex', flexDirection: 'column', height: '100%',
        background: '#09091a', borderLeft: '1px solid #1a1a3e',
        overflow: 'hidden',
      }}>

        <CompanyDashboard />

        {/* ── Header ── */}
        <div style={{ padding: '14px 16px 12px', borderBottom: '1px solid #1a1a3e', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <div style={{ fontSize: 9, color: '#3a5a8a', fontWeight: 700, letterSpacing: 2.5 }}>JOB BOARD</div>
            {!allDone && (
              <button
                onClick={() => setJobBoardOpen(v => !v)}
                style={{
                  fontSize: 9, fontWeight: 700, letterSpacing: 0.5, cursor: 'pointer',
                  background: 'transparent', border: '1px solid #1a2a4a',
                  borderRadius: 3, padding: '2px 8px',
                  color: jobBoardOpen ? '#4a90e2' : '#3a5a8a',
                }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = '#2a5298'; e.currentTarget.style.color = '#4a90e2' }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = '#1a2a4a'; e.currentTarget.style.color = jobBoardOpen ? '#4a90e2' : '#3a5a8a' }}
              >
                JOBS {jobBoardOpen ? '▲' : '▼'}
              </button>
            )}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
            <div>
              <div style={{ fontSize: 9, color: '#2a3a5a', marginBottom: 2 }}>balance</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: '#50fa7b', fontFamily: 'monospace' }}>
                ${budget.toLocaleString()}
              </div>
            </div>
            {totalEarned > 0 && (
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 9, color: '#2a3a5a', marginBottom: 2 }}>total earned</div>
                <div style={{ fontSize: 13, color: '#2a6a2a', fontFamily: 'monospace' }}>
                  +${totalEarned.toLocaleString()}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ── Active job: full task checklist, always visible ──────────────
            Previously this was a one-line status bar behind a "VIEW TASKS"
            button — easy to miss, and the floating panel it opened could be
            dragged off-screen or closed. The full step-by-step list (what
            beginner mode needs most) now lives right here, impossible to lose. */}
        {activeMission && (
          <div style={{ borderBottom: '1px solid #1a3060', flexShrink: 0, maxHeight: '52vh', overflowY: 'auto' }}>
            <div style={{
              padding: '10px 14px 8px',
              background: '#080d1a',
              display: 'flex', alignItems: 'center', gap: 10,
            }}>
              <span style={{ fontSize: 18, flexShrink: 0 }}>{activeMission.avatar}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 9, color: allTasksDone ? '#50fa7b' : '#3a6090', letterSpacing: 1, fontWeight: 700 }}>
                  {allTasksDone ? 'READY TO COLLECT' : 'IN PROGRESS'}
                </div>
                <div title={activeMission.title} style={{ fontSize: 12, fontWeight: 700, color: '#c0ccdc', lineHeight: 1.35, overflowWrap: 'break-word' }}>
                  {activeMission.title}
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, flexShrink: 0 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: allTasksDone ? '#50fa7b' : '#4a90e2', fontFamily: 'monospace' }}>{passed}/{tasks.length}</span>
                <button
                  onClick={() => setActiveJobPanelOpen(o => !o)}
                  title="Pop out a movable copy of this checklist near the floorplan"
                  style={{
                    padding: '2px 8px', fontSize: 8, fontWeight: 700, letterSpacing: 0.5,
                    background: activeJobPanelOpen ? '#1a3a5c' : 'transparent',
                    color: activeJobPanelOpen ? '#4a90e2' : '#2a4a6a',
                    border: `1px solid ${activeJobPanelOpen ? '#2a5298' : '#1a3060'}`,
                    borderRadius: 3, cursor: 'pointer',
                  }}
                >POP OUT ◈</button>
              </div>
            </div>
            <div style={{ padding: '2px 14px 10px' }}>
              <MissionProgressBar tasks={tasks} checks={checks} />
            </div>
            <MissionTaskRows
              tasks={tasks} checks={checks} difficulty={difficulty}
              diagFacts={diagFacts} executedCommands={executedCommandsRef.current}
            />
          </div>
        )}

        {/* ── All done state ── */}
        {allDone && (
          <div style={{ padding: '28px 14px', textAlign: 'center', flexShrink: 0 }}>
            <div style={{ fontSize: 40, marginBottom: 10 }}>🏆</div>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#50fa7b', marginBottom: 6 }}>All Jobs Complete!</div>
            <div style={{ fontSize: 11, color: '#2a4a2a' }}>You&apos;re a certified Network Engineer.</div>
          </div>
        )}

        {/* ── Job board: available + locked (collapsible) ──────────────────
            Client jobs (the active career story) always lead; legacy tutorial
            missions are a clearly separate, secondary group underneath — so
            a client's own next job never gets buried under unrelated ones. */}
        {jobBoardOpen && (
          <div style={{ flex: 1, overflowY: 'auto', padding: '14px 14px 6px' }}>
            {!allDone && clientCards.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 9, color: '#2a2a50', letterSpacing: 1.5, fontWeight: 700, marginBottom: 10 }}>
                  {activeMission ? 'YOUR UPCOMING WORK' : 'YOUR CLIENTS'}
                </div>
                {clientCards.map(m => {
                  const { unlocked, lockedReason } = unlockInfo(m)
                  return (
                    <JobCard
                      key={m.id}
                      mission={m}
                      unlocked={unlocked}
                      lockedReason={lockedReason}
                      onOpenBrief={() => setBriefMission(m)}
                    />
                  )
                })}
              </div>
            )}

            {!allDone && legacyCards.length > 0 && (
              <>
                <div style={{ fontSize: 9, color: '#2a2a50', letterSpacing: 1.5, fontWeight: 700, marginBottom: 10 }}>
                  TUTORIAL MISSIONS
                </div>
                {legacyCards.map(m => {
                  const { unlocked, lockedReason } = unlockInfo(m)
                  return (
                    <JobCard
                      key={m.id}
                      mission={m}
                      unlocked={unlocked}
                      lockedReason={lockedReason}
                      onOpenBrief={() => setBriefMission(m)}
                    />
                  )
                })}
              </>
            )}

            {!activeMission && !allDone && jobBoardMissions.length === 0 && (
              <div style={{ padding: '20px 0', textAlign: 'center', color: '#2a2a50', fontSize: 12 }}>
                All jobs accepted!
              </div>
            )}
          </div>
        )}

        {/* ── Archive: completed missions ── */}
        {completedMissions.length > 0 && (
          <div style={{ borderTop: '1px solid #1a1a3e', flexShrink: 0 }}>
            <div style={{ padding: '6px 14px 2px', fontSize: 9, color: '#1a3a1a', letterSpacing: 1, fontWeight: 700 }}>
              COMPLETED JOBS
            </div>
            {completedMissions.map(c => {
              const m = findMissionById(c.id)
              return m ? <ArchivedMission key={c.id} mission={{ ...m, reward: c.reward }} /> : null
            })}
          </div>
        )}
      </div>
    </>
  )
}
