/**
 * MissionBriefModal — professional job intake screen shown before a mission
 * is accepted. Works for BOTH legacy missions (missions.js) and declarative
 * client missions (missionDefinitions/) since it reads only the fields both
 * shapes already share (title/client/avatar/difficulty/reward/description/
 * hardware/blueprint/layout) plus getMissionRuntime() for the objective list —
 * never a mission's raw checkFn/condition internals, so nothing here can leak
 * the solution.
 */
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

export default function MissionBriefModal({ mission, reputation, onClose, onStart }) {
  const runtime = getMissionRuntime(mission.id)
  const requiredTasks = runtime?.tasks ?? []
  const optionalTasks = runtime?.optionalTasks ?? []
  const knowledge = mission.requiredKnowledge ?? mission.taught ?? []
  const requiredRep = mission.requiredReputation ?? 0
  const repMet = (reputation ?? 0) >= requiredRep
  const hw = mission.hardware ?? []

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 2500, background: 'rgba(4,8,11,0.78)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
      onClick={onClose}
    >
      <div
        role="dialog" aria-modal="true" aria-label={`Mission brief: ${mission.title}`}
        style={{
          background: 'var(--surface-panel)', border: '1px solid var(--rule-strong)', borderRadius: 14,
          width: 520, maxWidth: '95vw', maxHeight: '88vh', overflowY: 'auto',
          boxShadow: 'var(--shadow-float)',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ padding: '20px 24px 16px', borderBottom: '1px solid var(--rule)', display: 'flex', gap: 14, alignItems: 'flex-start' }}>
          <span style={{ fontSize: 36, lineHeight: 1.1 }}>{mission.avatar}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, color: 'var(--ink-3)', marginBottom: 2 }}>Mission brief</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--ink)', lineHeight: 1.15 }}>{mission.title}</div>
            <div style={{ fontSize: 15, color: 'var(--ink-3)', marginTop: 3 }}>{mission.client}</div>
          </div>
          <button className="btn ghost icon" onClick={onClose} title="Close" aria-label="Close"><IconClose size={17} /></button>
        </div>

        <div style={{ padding: '14px 24px 24px' }}>
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

          {/* Topology preview — no spoilers, just the target shape */}
          {mission.blueprint && (
            <Section title="Network topology">
              <div style={{ background: 'var(--surface-well)', border: '1px solid var(--rule)', borderRadius: 8, padding: 10 }}>
                <MissionBlueprintSvg blueprint={mission.blueprint} />
              </div>
            </Section>
          )}
          {mission.layout && (
            <Section title="Floor plan">
              <FloorPlanZoneList layout={mission.layout} />
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

          {/* Actions */}
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 26 }}>
            <button className="btn ghost" onClick={onClose} style={{ padding: '9px 18px', fontSize: 15 }}>Not yet</button>
            <button className="btn primary" onClick={onStart} disabled={!repMet} style={{ padding: '9px 26px', fontSize: 16 }}>
              Start job
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
