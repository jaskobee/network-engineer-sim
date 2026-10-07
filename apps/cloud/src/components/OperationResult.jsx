/**
 * Shows what happened to the last cloud operation: a refusal (with the rule it broke and a
 * link to the Microsoft Learn page that states it), a not-modelled notice, or warnings on a
 * success. The message text is the simulator's explanation and is labelled as such; a real Azure
 * error code is shown only when the outcome registry carries one.
 */
import { OUTCOMES, OUTCOME } from '../azure/outcomes.js'
import { ruleSource } from '../azure/ruleSources.js'

function Learn({ ruleId }) {
  const src = ruleSource(ruleId)
  if (!src) return null
  return (
    <a className="op-learn" href={src.url} target="_blank" rel="noreferrer">
      Learn more: {src.title}
    </a>
  )
}

export default function OperationResult({ result, onDismiss }) {
  if (!result) return null
  if (result.ok) {
    if (!result.warnings?.length) return null
    return (
      <div className="op-result warn" role="status">
        {result.warnings.map((w, i) => (
          <p key={i}><i className="led amber" />{w.message} <Learn ruleId={w.ruleId} /></p>
        ))}
        <button className="btn ghost" onClick={onDismiss}>Dismiss</button>
      </div>
    )
  }
  const notModelled = result.outcome === OUTCOME.NOT_MODELLED
  const armCode = OUTCOMES[result.outcome]?.armCode
  return (
    <div className={`op-result ${notModelled ? 'warn' : 'fail'}`} role="alert">
      <p>
        <i className={`led ${notModelled ? 'amber' : 'red'}`} />
        <strong>{notModelled ? 'Not modelled yet' : 'Azure would refuse this'}</strong>
        {armCode && <code className="op-code">{armCode}</code>}
      </p>
      <p>{result.message}</p>
      <p className="op-meta">
        <span>Simulator's explanation{result.ruleId ? ` · rule ${result.ruleId}` : ''}</span>
        <Learn ruleId={result.ruleId} />
      </p>
      <button className="btn ghost" onClick={onDismiss}>Dismiss</button>
    </div>
  )
}
