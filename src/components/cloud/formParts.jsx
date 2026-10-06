/**
 * Small building blocks shared by the cloud views' portal-style forms and detail panels.
 */

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

export function DangerButton({ label, confirm, onConfirm }) {
  return (
    <div className="mv-danger">
      <button className="btn danger" type="button" onClick={() => { if (window.confirm(confirm)) onConfirm() }}>{label}</button>
    </div>
  )
}
