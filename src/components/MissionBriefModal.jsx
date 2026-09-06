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

function Stars({ n }) {
  const max = 5
  const filled = Math.max(0, Math.min(n ?? 0, max))
  return (
    <span style={{ color: '#ffb86c', fontSize: 12 }}>
      {'★'.repeat(filled)}{'☆'.repeat(max - filled)}
    </span>
  )
}

function Row({ label, children }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '6px 0', borderBottom: '1px solid #0d1128' }}>
      <span style={{ fontSize: 10, color: '#3a5a8a', letterSpacing: 0.5, flexShrink: 0 }}>{label}</span>
      <span style={{ fontSize: 11, color: '#c0c8e0', textAlign: 'right' }}>{children}</span>
    </div>
  )
}

function Section({ title, children }) {
  return (
    <div style={{ marginTop: 16 }}>
      <div style={{ fontSize: 9, color: '#4a90e2', fontWeight: 700, letterSpacing: 1.5, marginBottom: 8 }}>{title}</div>
      {children}
    </div>
  )
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
      style={{ position: 'fixed', inset: 0, zIndex: 2500, background: 'rgba(0,0,0,0.82)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
      onClick={onClose}
    >
      <div
        style={{
          background: '#0a0f1e', border: '1px solid #1e3a6a', borderRadius: 12,
          width: 480, maxWidth: '95vw', maxHeight: '88vh', overflowY: 'auto',
          boxShadow: '0 20px 80px rgba(0,0,0,0.7)',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ padding: '20px 24px 16px', borderBottom: '1px solid #14203a', display: 'flex', gap: 14, alignItems: 'flex-start' }}>
          <span style={{ fontSize: 34, lineHeight: 1.1 }}>{mission.avatar}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 9, color: '#3a5a8a', fontWeight: 700, letterSpacing: 2, marginBottom: 3 }}>MISSION BRIEF</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#e0e6f0' }}>{mission.title}</div>
            <div style={{ fontSize: 11, color: '#5a7aa8', marginTop: 2 }}>{mission.client}</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: '1px solid #1a2a40', color: '#3a4a60', cursor: 'pointer', borderRadius: 4, padding: '3px 9px', fontSize: 12, flexShrink: 0 }}>✕</button>
        </div>

        <div style={{ padding: '16px 24px 24px' }}>
          {/* Key facts */}
          <Row label="DIFFICULTY"><Stars n={mission.difficulty} /></Row>
          {mission.estimatedDuration && <Row label="ESTIMATED DURATION">{mission.estimatedDuration}</Row>}
          <Row label="PAYMENT">
            <span style={{ color: '#50fa7b', fontWeight: 700, fontFamily: 'monospace' }}>${mission.reward?.toLocaleString()}</span>
            {mission.optionalObjectiveBonus > 0 && (
              <span style={{ color: '#8ab4d4', marginLeft: 6 }}>(+${mission.optionalObjectiveBonus} bonus)</span>
            )}
          </Row>
          {requiredRep > 0 && (
            <Row label="REPUTATION REQUIRED">
              <span style={{ color: repMet ? '#50fa7b' : '#ff5555' }}>{requiredRep}{!repMet && ' — not yet met'}</span>
            </Row>
          )}
          {mission.contractOutcome && (
            <Row label="POTENTIAL CONTRACT">
              <span style={{ color: '#ffb86c' }}>Ongoing support agreement on completion</span>
            </Row>
          )}

          {/* Description */}
          <div style={{ fontSize: 12, color: '#8090b8', lineHeight: 1.6, marginTop: 14 }}>
            {mission.description}
          </div>

          {/* Required knowledge */}
          {knowledge.length > 0 && (
            <Section title="REQUIRED KNOWLEDGE">
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {knowledge.map((k, i) => (
                  <span key={i} style={{ fontSize: 10, color: '#4a90e2', background: '#0a1528', border: '1px solid #1a3060', borderRadius: 3, padding: '3px 8px' }}>
                    {k}
                  </span>
                ))}
              </div>
            </Section>
          )}

          {/* Hardware needed */}
          {hw.length > 0 && (
            <Section title="HARDWARE NEEDED">
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {hw.map((h, i) => (
                  <span key={i} style={{ fontSize: 10, color: '#8ab4d4', background: '#0a1528', border: '1px solid #1a3060', borderRadius: 3, padding: '3px 8px' }}>
                    {h.label}
                  </span>
                ))}
              </div>
            </Section>
          )}

          {/* Topology preview — no spoilers, just the target shape */}
          {mission.blueprint && (
            <Section title="NETWORK TOPOLOGY">
              <div style={{ background: '#050a16', border: '1px solid #14203a', borderRadius: 6, padding: 10 }}>
                <MissionBlueprintSvg blueprint={mission.blueprint} />
              </div>
            </Section>
          )}
          {mission.layout && (
            <Section title="FLOOR PLAN">
              <FloorPlanZoneList layout={mission.layout} />
            </Section>
          )}

          {/* Objectives — labels only, never conditions/hints */}
          <Section title="OBJECTIVES">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {requiredTasks.map((t, i) => (
                <div key={t.id} style={{ display: 'flex', gap: 8, fontSize: 11, color: '#8090b8' }}>
                  <span style={{ color: '#3a5a8a', fontFamily: 'monospace', flexShrink: 0 }}>{i + 1}.</span>
                  {t.label}
                </div>
              ))}
            </div>
          </Section>
          {optionalTasks.length > 0 && (
            <Section title="🎁 OPTIONAL OBJECTIVES">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {optionalTasks.map(t => (
                  <div key={t.id} style={{ fontSize: 11, color: '#ffb86c' }}>{t.label}</div>
                ))}
              </div>
            </Section>
          )}

          {/* Actions */}
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 24 }}>
            <button
              onClick={onClose}
              style={{ padding: '9px 20px', fontSize: 12, fontWeight: 600, background: 'transparent', color: '#556', border: '1px solid #1a2a40', borderRadius: 6, cursor: 'pointer' }}
            >
              Not Yet
            </button>
            <button
              onClick={onStart}
              disabled={!repMet}
              style={{
                padding: '9px 26px', fontSize: 13, fontWeight: 700, letterSpacing: 0.5,
                background: repMet ? '#2a5298' : '#1a2030', color: repMet ? '#e0e0e0' : '#445',
                border: 'none', borderRadius: 6, cursor: repMet ? 'pointer' : 'not-allowed',
              }}
            >
              START JOB
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
