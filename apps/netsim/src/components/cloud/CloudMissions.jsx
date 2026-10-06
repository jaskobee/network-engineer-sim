/**
 * Cloud missions UI (PHASE_1A step 6): the mission list, the active mission's brief and
 * objectives (each with a hint), the rules it teaches with their Microsoft Learn pages, and
 * the debrief once it's complete. Progress comes from CloudContext — derived from the
 * mission's tenant, never stored.
 */
import { useCloud } from '../../state/CloudContext.jsx'
import { CLOUD_MISSIONS } from '../../cloud/missions/index.js'
import { ruleSource } from '../../cloud/ruleSources.js'

/** One LED per objective — lit green when done. */
export function ObjectiveLeds({ objectives }) {
  return (
    <span className="cm-leds" aria-hidden="true">
      {objectives.map(o => <i key={o.id} className={`led${o.done ? ' green' : ''}`} />)}
    </span>
  )
}

/** Always-visible strip while a mission runs, on every Cloud tab. */
export function MissionBar({ onOpen }) {
  const { mission } = useCloud()
  if (!mission) return null
  const { def, progress } = mission
  return (
    <div className="cm-bar" role="status">
      <span className="cm-bar-title">
        Mission: <strong>{def.title}</strong> · working in {def.client}&apos;s tenant
      </span>
      <ObjectiveLeds objectives={progress.objectives} />
      <span className="mono">{progress.doneCount}/{progress.total}</span>
      {progress.complete && <span className="cm-done">Complete</span>}
      <button className="btn" onClick={onOpen}>Brief &amp; tasks</button>
    </div>
  )
}

function ActiveMission() {
  const { mission, startMission, leaveMission } = useCloud()
  const { def, progress } = mission
  return (
    <section className="cloud-card cm-active" aria-label={`Mission: ${def.title}`}>
      <p className="cm-client">{def.client}</p>
      <h2>{def.title}</h2>
      {def.brief.map((p, i) => <p key={i} className="cm-brief">{p}</p>)}

      <h3>Tasks</h3>
      <ol className="cm-objectives">
        {progress.objectives.map(o => (
          <li key={o.id} className={o.done ? 'done' : undefined}>
            <i className={`led${o.done ? ' green' : ''}`} />
            <div>
              <span>{o.text}</span>
              {!o.done && <details><summary>Hint</summary><p>{o.hint}</p></details>}
            </div>
          </li>
        ))}
      </ol>

      {progress.complete && (
        <div className="cm-debrief">
          <h3><i className="led green" /> Mission complete</h3>
          <ul>{def.debrief.map((d, i) => <li key={i}>{d}</li>)}</ul>
        </div>
      )}

      <h3>Rules this mission teaches</h3>
      <ul className="cm-learn">
        {def.learn.map(id => {
          const src = ruleSource(id)
          return <li key={id}><span className="mono">{id}</span> <a href={src.url} target="_blank" rel="noreferrer">{src.title}</a></li>
        })}
      </ul>

      <div className="cm-actions">
        {progress.complete
          ? <button className="btn primary" onClick={leaveMission}>Finish and return to the sandbox</button>
          : <>
              <button className="btn" onClick={() => { if (window.confirm('Restart this mission from its starting state?')) startMission(def.id) }}>Restart mission</button>
              <button className="btn danger" onClick={() => { if (window.confirm('Leave this mission? Its progress is discarded; your sandbox is kept.')) leaveMission() }}>Leave mission</button>
            </>}
      </div>
    </section>
  )
}

export default function CloudMissions({ onStarted }) {
  const { mission, completedMissions, startMission } = useCloud()

  function start(id) {
    if (mission && !window.confirm(`Leave "${mission.def.title}" and start this mission? Its progress is discarded.`)) return
    startMission(id)
    onStarted?.()
  }

  return (
    <div className="cloud-inner">
      {mission && <ActiveMission />}
      <section className="cloud-card" aria-label="Missions">
        <h2>Missions</h2>
        <p className="mv-note">
          Each mission is a customer&apos;s own tenant, set up the way you&apos;d find it — with the subscriptions they already
          have. Your sandbox stays as it is while you work.
        </p>
        <ul className="cm-list">
          {CLOUD_MISSIONS.map(m => {
            const active = mission?.def.id === m.id
            const doneBefore = completedMissions.includes(m.id)
            return (
              <li key={m.id}>
                <div>
                  <strong>{m.title}</strong>
                  <span className="cm-status">
                    {active ? <><i className="led blue" />In progress</> : doneBefore ? <><i className="led green" />Completed</> : 'Not started'}
                  </span>
                  <p>{m.summary}</p>
                </div>
                {!active && <button className="btn primary" onClick={() => start(m.id)}>{doneBefore ? 'Play again' : 'Start'}</button>}
              </li>
            )
          })}
        </ul>
      </section>
    </div>
  )
}
