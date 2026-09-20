/**
 * MissionBriefModal — the job screen, in two tabs: **Brief** (what the job is) and **Topology**
 * (how the network is meant to look — the blueprint and floor plan). Shown before a job is
 * accepted, and again from the active-job panel so the topology is always one click away.
 * Pass `onStart` to offer "Start job"; leave it off for a view-only screen.
 * Works for BOTH legacy missions (missions.js) and declarative
 * client missions (missionDefinitions/) since it reads only the fields both
 * shapes already share (title/client/avatar/difficulty/reward/description/
 * hardware/blueprint/layout) plus getMissionRuntime() for the objective list —
 * never a mission's raw checkFn/condition internals, so nothing here can leak
 * the solution.
 */
import { useState } from 'react'
import { getMissionRuntime } from '../engine/missionEngine.js'
import { MissionBlueprintSvg, FloorPlanZoneList } from './MissionBlueprint.jsx'
import DifficultyBars from './DifficultyBars.jsx'
import { IconClose } from './icons.jsx'

function Row({ label, children }) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12,
      padding: '8px 0', borderBottom: '1px solid var(--rule)',
    }}>
      <span style={{ fontSize: 14.5, color: 'var(--ink-3)', flexShrink: 0 }}>{label}</span>
      <span style={{ fontSize: 15, color: 'var(--ink)', textAlign: 'right' }}>{children}</span>
    </div>
  )
}

function Section({ title, children }) {
  return (
    <div style={{ marginTop: 20 }}>
      <div style={{ fontSize: 16, color: 'var(--ink)', fontWeight: 700, marginBottom: 8 }}>{title}</div>
      {children}
    </div>
  )
}

const chip = {
  fontSize: 13.5, color: 'var(--ink-2)', background: 'var(--surface-well)',
  border: '1px solid var(--rule)', borderRadius: 4, padding: '3px 9px',
}

export default function MissionBriefModal({ mission, reputation, onClose, onStart, initialTab = 'brief', startBlockedReason = '' }) {
  const [tab, setTab] = useState(initialTab)
  const runtime = getMissionRuntime(mission.id)
  const requiredTasks = runtime?.tasks ?? []
  const optionalTasks = runtime?.optionalTasks ?? []
  const knowledge = mission.requiredKnowledge ?? mission.taught ?? []
  const requiredRep = mission.requiredReputation ?? 0
  const repMet = (reputation ?? 0) >= requiredRep
  const hw = mission.hardware ?? []
  const hasTopology = !!(mission.blueprint || mission.layout?.length)
  const canStart = !!onStart && repMet && !startBlockedReason

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 2500, background: 'rgba(4,8,11,0.78)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
      onClick={onClose}
    >
      <div
        role="dialog" aria-modal="true" aria-label={`Mission brief: ${mission.title}`}
        style={{
          background: 'var(--surface-panel)', border: '1px solid var(--rule-strong)', borderRadius: 14,
          width: 580, maxWidth: '95vw', maxHeight: '88vh', display: 'flex', flexDirection: 'column', overflow: 'hidden',
          boxShadow: 'var(--shadow-float)',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ padding: '20px 24px 12px', display: 'flex', gap: 14, alignItems: 'flex-start', flexShrink: 0 }}>
          <span style={{ fontSize: 36, lineHeight: 1.1 }}>{mission.avatar}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, color: 'var(--ink-3)', marginBottom: 2 }}>Job details</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--ink)', lineHeight: 1.15 }}>{mission.title}</div>
            <div style={{ fontSize: 15, color: 'var(--ink-3)', marginTop: 3 }}>{mission.client}</div>
          </div>
          <button className="btn ghost icon" onClick={onClose} title="Close" aria-label="Close"><IconClose size={17} /></button>
        </div>

        {/* Tabs — the topology is a first-class part of a job, not something buried in the brief */}
        <div role="tablist" aria-label="Job details" style={{ display: 'flex', gap: 2, padding: '0 24px', borderBottom: '1px solid var(--rule)', flexShrink: 0 }}>
          {[['brief', 'Brief'], ['topology', 'Topology']].map(([id, label]) => (
            <button key={id} role="tab" id={`job-tab-${id}`} aria-selected={tab === id} aria-controls={`job-panel-${id}`}
              className={`utab${tab === id ? ' on' : ''}`} onClick={() => setTab(id)}>
              {label}
            </button>
          ))}
        </div>

        <div role="tabpanel" id={`job-panel-${tab}`} aria-labelledby={`job-tab-${tab}`} style={{ padding: '14px 24px 20px', overflowY: 'auto', flex: 1, minHeight: 0 }}>
        {tab === 'brief' ? (<>
          {/* Key facts */}
          <Row label="Difficulty"><DifficultyBars level={mission.difficulty} /></Row>
          {mission.estimatedDuration && <Row label="Estimated duration">{mission.estimatedDuration}</Row>}
          <Row label="Payment">
            <span style={{ fontWeight: 700 }}>${mission.reward?.toLocaleString()}</span>
            {mission.optionalObjectiveBonus > 0 && (
              <span style={{ color: 'var(--ink-3)', marginLeft: 6 }}>(+${mission.optionalObjectiveBonus} bonus)</span>
            )}
          </Row>
          {requiredRep > 0 && (
            <Row label="Reputation required">
              <span style={{ color: repMet ? '#3ee08f' : '#ff6259' }}>{requiredRep}{!repMet && ' — not yet met'}</span>
            </Row>
          )}
          {mission.contractOutcome && (
            <Row label="Potential contract">
              <span style={{ color: 'var(--led-amber)' }}>Ongoing support agreement on completion</span>
            </Row>
          )}

          {/* Description */}
          <p style={{ fontSize: 15.5, color: 'var(--ink-2)', lineHeight: 1.55, marginTop: 16 }}>
            {mission.description}
          </p>

          {/* Required knowledge */}
          {knowledge.length > 0 && (
            <Section title="What you should know">
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {knowledge.map((k, i) => <span key={i} style={chip}>{k}</span>)}
              </div>
            </Section>
          )}

          {/* Hardware needed */}
          {hw.length > 0 && (
            <Section title="Hardware needed">
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {hw.map((h, i) => <span key={i} style={chip}>{h.label}</span>)}
              </div>
            </Section>
          )}

          {/* Objectives — labels only, never conditions/hints */}
          <Section title="Objectives">
            <ol style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 6 }}>
              {requiredTasks.map((t, i) => (
                <li key={t.id} style={{ display: 'flex', gap: 10, fontSize: 15, color: 'var(--ink-2)', lineHeight: 1.4 }}>
                  <span style={{ color: 'var(--ink-3)', flexShrink: 0, minWidth: 16, textAlign: 'right' }}>{i + 1}</span>
                  {t.label}
                </li>
              ))}
            </ol>
          </Section>
          {optionalTasks.length > 0 && (
            <Section title="Bonus objectives">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {optionalTasks.map(t => (
                  <div key={t.id} style={{ fontSize: 15, color: 'var(--ink-2)', display: 'flex', gap: 9, alignItems: 'baseline' }}>
                    <i className="led amber" style={{ width: 7, height: 7 }} />
                    {t.label}
                  </div>
                ))}
              </div>
            </Section>
          )}

          {hasTopology && (
            <p style={{ fontSize: 14, color: 'var(--ink-3)', marginTop: 18 }}>
              The network diagram and floor plan are on the <button className="btn ghost" onClick={() => setTab('topology')} style={{ padding: '0 6px', display: 'inline', fontSize: 14, color: 'var(--signal)' }}>Topology</button> tab.
            </p>
          )}
        </>) : (
          <TopologyTab mission={mission} />
        )}
        </div>

        {/* Actions — the same on both tabs, so "Start job" is never a scroll away */}
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', alignItems: 'center', padding: '12px 24px 16px', borderTop: '1px solid var(--rule)', flexShrink: 0 }}>
          {onStart && startBlockedReason && (
            <span style={{ flex: 1, fontSize: 14, color: 'var(--ink-3)' }}>{startBlockedReason}</span>
          )}
          <button className="btn ghost" onClick={onClose} style={{ padding: '9px 18px', fontSize: 15 }}>{onStart ? 'Not yet' : 'Close'}</button>
          {onStart && (
            <button className="btn primary" onClick={onStart} disabled={!canStart} style={{ padding: '9px 26px', fontSize: 16 }}>
              Start job
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// The blueprint (no spoilers — just the target shape), the floor plan, and notes.
function TopologyTab({ mission }) {
  const hasBlueprint = !!mission.blueprint
  const hasLayout = !!mission.layout?.length
  if (!hasBlueprint && !hasLayout) {
    return (
      <div style={{ padding: '28px 8px', textAlign: 'center', color: 'var(--ink-3)', fontSize: 15, lineHeight: 1.5 }}>
        This job has no network diagram yet. Build it from the objectives on the Brief tab.
      </div>
    )
  }
  return (
    <>
      {hasBlueprint && (
        <div>
          <div style={{ fontSize: 16, color: 'var(--ink)', fontWeight: 700, marginBottom: 8 }}>Network topology</div>
          <div style={{ background: 'var(--surface-well)', border: '1px solid var(--rule)', borderRadius: 8, padding: 12 }}>
            <MissionBlueprintSvg blueprint={mission.blueprint} />
          </div>
        </div>
      )}
      {hasLayout && (
        <Section title="Floor plan">
          <FloorPlanZoneList layout={mission.layout} />
        </Section>
      )}
    </>
  )
}
