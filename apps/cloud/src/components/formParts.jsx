/**
 * Small building blocks shared by the cloud views' portal-style forms and detail panels.
 */
import { useState } from 'react'

export function Field({ label, hint, children }) {
  return (
    <label className="mv-field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  )
}

/** rows: [label, value, mono?] */
export function Facts({ rows }) {
  return (
    <dl className="cloud-facts">
      {rows.filter(Boolean).map(([k, v, mono]) => [
        <dt key={`${k}-t`}>{k}</dt>,
        <dd key={`${k}-d`} className={mono ? 'mono' : undefined}>{v}</dd>,
      ])}
    </dl>
  )
}

export function Form({ title, onSubmit, submit, children }) {
  return (
    <form className="mv-form" onSubmit={e => { e.preventDefault(); onSubmit() }}>
      {title && <h3>{title}</h3>}
      {children}
      <div><button className="btn primary" type="submit">{submit}</button></div>
    </form>
  )
}

export function Select({ value, onChange, options, empty }) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)}>
      {empty !== undefined && <option value="">{empty}</option>}
      {options.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
    </select>
  )
}

/**
 * The portal's Review + create step. `submit(operation, args, summary)` validates with a dry run
 * of the same pure operation (nothing is applied): a refusal goes to `report` — "Validation
 * failed" — and the form stays; a pass opens the review. Only Create applies the operation.
 */
export function useReview(cloud, report) {
  const [pending, setPending] = useState(null)   // { operation, args, summary, warnings }
  function submit(operation, args, summary) {
    const validation = operation(cloud, args)
    if (!validation.ok) { report(validation); return }
    report(null)
    setPending({ operation, args, summary, warnings: validation.warnings ?? [] })
  }
  return { pending, submit, back: () => setPending(null) }
}

/** "Validation passed", any warnings, the summary, then Back / Create. `create` returns the operation result. */
export function ReviewStep({ review, create }) {
  const { pending } = review
  return (
    <div className="nv-review">
      <p className="nv-valid"><i className="led green" />Validation passed</p>
      {pending.warnings.map((w, i) => <p key={i} className="mv-note"><i className="led amber" /> {w.message}</p>)}
      <Facts rows={pending.summary} />
      <div className="nv-review-actions">
        <button className="btn" type="button" onClick={review.back}>Back</button>
        <button className="btn primary" type="button" onClick={() => { if (create(pending.operation, pending.args).ok) review.back() }}>Create</button>
      </div>
    </div>
  )
}

export function DangerButton({ label, confirm, onConfirm }) {
  return (
    <div className="mv-danger">
      <button className="btn danger" type="button" onClick={() => { if (window.confirm(confirm)) onConfirm() }}>{label}</button>
    </div>
  )
}
