import { useEffect, useRef, useState } from 'react'
import { useGame } from '../state/GameContext.jsx'
import { useCareer } from '../state/CareerContext.jsx'
import { MISSIONS } from '../data/missions.js'
import { findMissionById } from '../data/missionDefinitions/index.js'
import { useJobBoard } from '../state/useJobBoard.js'
import { getMissionRuntime } from '../engine/missionEngine.js'
import CompanyDashboard from './CompanyDashboard.jsx'
import MissionBriefModal from './MissionBriefModal.jsx'
import ActiveContractsPanel from './ActiveContractsPanel.jsx'
import DifficultyBars from './DifficultyBars.jsx'
import { IconChevronDown, IconChevronUp } from './icons.jsx'

// ── Job card ──────────────────────────────────────────────────────────────────

function JobCard({ mission, busy, isNew, declined, onOpenBrief }) {
  const hw = mission.hardware ?? []
  return (
    <div style={{
      margin: '0 0 10px',
      background: 'var(--surface-raised)',
      border: `1px solid ${isNew ? 'var(--signal-strong)' : 'var(--rule)'}`,
      borderRadius: 10,
      overflow: 'hidden',
      transition: 'border-color 0.15s',
    }}
      onMouseEnter={e => { if (!isNew) e.currentTarget.style.borderColor = 'var(--rule-strong)' }}
      onMouseLeave={e => { if (!isNew) e.currentTarget.style.borderColor = 'var(--rule)' }}
    >
      <div style={{ padding: '12px 14px 0', display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <span style={{ fontSize: 28, lineHeight: 1.1, flexShrink: 0 }}>{mission.avatar}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 16.5, fontWeight: 700, color: 'var(--ink)', lineHeight: 1.2 }}>{mission.title}</div>
          <div style={{ fontSize: 13.5, color: 'var(--ink-3)', marginTop: 2, display: 'flex', alignItems: 'center', gap: 8 }}>
            {mission.client}
            {isNew && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: 'var(--signal)', fontWeight: 600 }}><i className="led blue" style={{ width: 7, height: 7 }} />New</span>}
            {declined && <span style={{ color: 'var(--ink-3)' }}>Declined for now</span>}
          </div>
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 5 }}>
          <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--ink)' }}>${mission.reward.toLocaleString()}</div>
          <DifficultyBars level={mission.difficulty} />
        </div>
      </div>

      <div style={{ padding: '8px 14px 12px' }}>
        <p style={{ fontSize: 14.5, color: 'var(--ink-2)', lineHeight: 1.5, margin: 0 }}>{mission.description}</p>
        {hw.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
            {hw.map((h, i) => (
              <span key={i} style={{
                fontSize: 13, color: 'var(--ink-2)', background: 'var(--surface-well)',
                padding: '2px 8px', borderRadius: 4, border: '1px solid var(--rule)',
              }}>{h.label}</span>
            ))}
          </div>
        )}
        <button className="btn" onClick={onOpenBrief} style={{ width: '100%', marginTop: 12, padding: '7px 0' }}>
          View job
        </button>
        {busy && (
          <div style={{ fontSize: 13.5, color: 'var(--ink-3)', marginTop: 7 }}>You can start it once your current job is done.</div>
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
    <div style={{ borderBottom: '1px solid var(--rule)' }}>
      <div
        onClick={() => setExpanded(e => !e)}
        style={{ padding: '9px 14px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10 }}
        onMouseEnter={e => { e.currentTarget.style.background = 'var(--surface-raised)' }}
        onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
      >
        <i className="led green" />
        <span style={{ fontSize: 18.5 }}>{mission.avatar}</span>
        <div style={{ flex: 1, minWidth: 0, fontSize: 14.5, color: 'var(--ink-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {mission.title}
        </div>
        <div style={{ fontSize: 13.5, color: 'var(--ink-3)' }}>+${mission.reward.toLocaleString()}</div>
        <span style={{ color: 'var(--ink-3)', display: 'flex' }}>{expanded ? <IconChevronUp size={15} /> : <IconChevronDown size={15} />}</span>
      </div>
      {expanded && tasks.length > 0 && (
        <div style={{ background: 'var(--surface-well)', borderTop: '1px solid var(--rule)', padding: '4px 0' }}>
          {tasks.map(task => (
            <div key={task.id} style={{ padding: '4px 14px 4px 44px', display: 'flex', gap: 9, alignItems: 'center' }}>
              <i className="led green" style={{ width: 7, height: 7 }} />
              <span style={{ fontSize: 14, color: 'var(--ink-3)' }}>{task.label}</span>
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
  const { reputation, resolveJobOffer } = useCareer()
  const { clientJobs, legacyJobs, all: jobBoardMissions, pendingIds, jobOffers } = useJobBoard()

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

  // ── Job board: ONLY jobs that are available now (engine/jobBoard.js). Locked and future jobs are not
  // shown — there will be many more jobs, and a wall of greyed-out ones is just noise. Client jobs
  // (the career story) lead; the tutorial missions are a separate, secondary group.
  const clientCards = clientJobs
  const legacyCards = legacyJobs
  const busy = !!activeMission || isTicketActive

  // Looking at a new job is answering the news: it stops being "new" (and stops counting on the Career badge).
  function openBrief(m) {
    if (pendingIds.includes(m.id)) resolveJobOffer(m.id, 'seen')
    setBriefMission(m)
  }

  return (
    <>
      {briefMission && (
        <MissionBriefModal
          mission={briefMission}
          reputation={reputation}
          onClose={() => setBriefMission(null)}
          onStart={() => { acceptMission(briefMission.id); setBriefMission(null) }}
          startBlockedReason={busy ? 'Finish your current job first.' : ''}
        />
      )}

      <div style={{
        display: 'flex', flexDirection: 'column', height: '100%',
        background: 'var(--surface-ground)',
        overflow: 'hidden',
      }}>

        <CompanyDashboard />
        <ActiveContractsPanel onNavigateAway={onNavigateAway} />

        {/* ── Header ── */}
        <div style={{ padding: '14px 16px 14px', borderBottom: '1px solid var(--rule)', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 8 }}>
            <div>
              <div style={{ fontSize: 13.5, color: 'var(--ink-3)' }}>Balance</div>
              <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--ink)', lineHeight: 1.1 }}>${budget.toLocaleString()}</div>
              {totalEarned > 0 && (
                <div style={{ fontSize: 13.5, color: 'var(--ink-3)', marginTop: 3 }}>${totalEarned.toLocaleString()} earned from jobs</div>
              )}
            </div>
            {!allDone && (
              <button
                className="btn ghost"
                onClick={() => setJobBoardOpen(v => !v)}
                aria-expanded={jobBoardOpen}
                style={{ padding: '4px 8px' }}
              >
                Job board {jobBoardOpen ? <IconChevronUp size={15} /> : <IconChevronDown size={15} />}
              </button>
            )}
          </div>
        </div>

        {/* ── All done state ── */}
        {allDone && (
          <div style={{ padding: '28px 14px', textAlign: 'center', flexShrink: 0 }}>
            <div style={{ fontSize: 40, marginBottom: 10 }}>🏆</div>
            <div style={{ fontSize: 17, fontWeight: 700, color: '#3ee08f', marginBottom: 6 }}>All jobs complete</div>
            <div style={{ fontSize: 14.5, color: 'var(--ink-3)' }}>You&apos;re a certified Network Engineer.</div>
          </div>
        )}

        {/* ── Job board: available jobs only (collapsible) ──────────────────
            Client jobs (the active career story) always lead; legacy tutorial
            missions are a clearly separate, secondary group underneath — so
            a client's own next job never gets buried under unrelated ones. */}
        {jobBoardOpen && (
          <div style={{ flex: 1, overflowY: 'auto', padding: '14px 14px 6px' }}>
            {!allDone && clientCards.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 15, color: 'var(--ink-2)', fontWeight: 600, marginBottom: 10 }}>
                  {activeMission ? 'Your upcoming work' : 'Your clients'}
                </div>
                {clientCards.map(m => (
                  <JobCard
                    key={m.id} mission={m} busy={busy}
                    isNew={pendingIds.includes(m.id)} declined={jobOffers[m.id]?.status === 'declined'}
                    onOpenBrief={() => openBrief(m)}
                  />
                ))}
              </div>
            )}

            {!allDone && legacyCards.length > 0 && (
              <>
                <div style={{ fontSize: 15, color: 'var(--ink-2)', fontWeight: 600, marginBottom: 10 }}>
                  Tutorial missions
                </div>
                {legacyCards.map(m => (
                  <JobCard
                    key={m.id} mission={m} busy={busy}
                    isNew={pendingIds.includes(m.id)} declined={jobOffers[m.id]?.status === 'declined'}
                    onOpenBrief={() => openBrief(m)}
                  />
                ))}
              </>
            )}

            {!allDone && jobBoardMissions.length === 0 && (
              <div style={{ padding: '22px 8px', textAlign: 'center', color: 'var(--ink-3)', fontSize: 14.5, lineHeight: 1.5 }}>
                <div style={{ color: 'var(--ink-2)', fontWeight: 600, marginBottom: 4 }}>No jobs waiting right now</div>
                {activeMission ? 'Finish your current job — new work shows up here as it becomes available.' : 'New jobs appear here as you finish work and build your reputation.'}
              </div>
            )}
          </div>
        )}

        {/* ── Archive: completed missions — collapsed by default, it's
            history the player can open on demand, not something that needs
            to sit on screen the whole time. ── */}
        {completedMissions.length > 0 && (
          <div style={{ borderTop: '1px solid var(--rule)', flexShrink: 0 }}>
            <button
              className="btn ghost"
              onClick={() => setCompletedJobsOpen(v => !v)}
              aria-expanded={completedJobsOpen}
              style={{ width: '100%', justifyContent: 'space-between', borderRadius: 0, padding: '9px 14px' }}
            >
              <span>Completed jobs ({completedMissions.length})</span>
              {completedJobsOpen ? <IconChevronUp size={15} /> : <IconChevronDown size={15} />}
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
