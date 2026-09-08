import { useEffect, useRef, useState } from 'react'
import { useGame } from '../state/GameContext.jsx'
import { useCareer } from '../state/CareerContext.jsx'
import { MISSIONS } from '../data/missions.js'
import { MISSION_DEFINITIONS, findMissionById } from '../data/missionDefinitions/index.js'
import { getMissionRuntime } from '../engine/missionEngine.js'
import CompanyDashboard from './CompanyDashboard.jsx'
import MissionBriefModal from './MissionBriefModal.jsx'
import ActiveContractsPanel from './ActiveContractsPanel.jsx'

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

export default function MissionPanel({ onNavigateAway }) {
  const {
    completedMissions,
    activeMissionId, acceptMission,
    activeTicket,
    budget,
  } = useGame()
  const { reputation, clients } = useCareer()

  // Auto-collapse the job board list when a mission becomes active, and
  // auto-reopen it when one finishes — otherwise a newly-unlocked follow-up
  // job (the whole payoff of completing one) stays hidden behind a collapsed
  // list the player has no reason to think to reopen. Initialized from the
  // live activeMissionId (not just `true`) since this component now mounts
  // fresh each time the Career dock opens, possibly mid-mission.
  const [jobBoardOpen, setJobBoardOpen] = useState(!activeMissionId)
  // Completed jobs are history, not something needed moment-to-moment —
  // collapsed by default, unlike the job board above.
  const [completedJobsOpen, setCompletedJobsOpen] = useState(false)
  const prevMissionIdRef = useRef(activeMissionId)
  useEffect(() => {
    if (activeMissionId && !prevMissionIdRef.current) setJobBoardOpen(false)
    if (!activeMissionId && prevMissionIdRef.current) setJobBoardOpen(true)
    prevMissionIdRef.current = activeMissionId
  }, [activeMissionId])

  // Mission Brief modal — shown on card click, before a job is actually accepted
  const [briefMission, setBriefMission] = useState(null)

  const activeMission   = findMissionById(activeMissionId)
  const isTicketActive  = !activeMissionId && !!activeTicket
  const allDone         = completedMissions.length === MISSIONS.length
  const totalEarned     = completedMissions.reduce((s, m) => s + m.reward, 0)

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
    const somethingActive = !!activeMission || isTicketActive
    if (m.clientId) {
      const met = reputation >= (m.requiredReputation ?? 0)
      return { unlocked: met && !somethingActive, lockedReason: met ? '' : `Requires ${m.requiredReputation} reputation` }
    }
    const prereqDone = m.prerequisite ? completedMissions.some(c => c.id === m.prerequisite) : true
    return { unlocked: prereqDone && !somethingActive, lockedReason: 'Complete the previous job first' }
  }

  return (
    <>
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
        <ActiveContractsPanel onNavigateAway={onNavigateAway} />

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

        {/* ── Archive: completed missions — collapsed by default, it's
            history the player can open on demand, not something that needs
            to sit on screen the whole time. ── */}
        {completedMissions.length > 0 && (
          <div style={{ borderTop: '1px solid #1a1a3e', flexShrink: 0 }}>
            <button
              onClick={() => setCompletedJobsOpen(v => !v)}
              style={{
                width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '6px 14px', background: 'transparent', border: 'none', cursor: 'pointer',
                fontSize: 9, color: '#1a3a1a', letterSpacing: 1, fontWeight: 700,
              }}
              onMouseEnter={e => { e.currentTarget.style.color = '#2a5a2a' }}
              onMouseLeave={e => { e.currentTarget.style.color = '#1a3a1a' }}
            >
              <span>COMPLETED JOBS ({completedMissions.length})</span>
              <span>{completedJobsOpen ? '▲' : '▼'}</span>
            </button>
            {completedJobsOpen && completedMissions.map(c => {
              const m = findMissionById(c.id)
              return m ? <ArchivedMission key={c.id} mission={{ ...m, reward: c.reward }} /> : null
            })}
          </div>
        )}
      </div>
    </>
  )
}
