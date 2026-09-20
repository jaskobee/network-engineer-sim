/**
 * Small building blocks shared between AdminLaptop.jsx's tabs and
 * AdminDashboardTab.jsx — pulled out to a sibling module (rather than
 * exported from AdminLaptop.jsx and imported back) so the two don't form a
 * circular import, since AdminLaptop.jsx also renders AdminDashboardTab.
 */

export function Section({ title, children }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{
        fontSize: 15, fontWeight: 600, color: 'var(--ink)', marginBottom: 8,
        borderBottom: '1px solid var(--rule)', paddingBottom: 6,
      }}>{title}</div>
      {children}
    </div>
  )
}

// A dashboard tile: title (+ optional right-aligned note) over its content.
export function Card({ title, note, children, style }) {
  return (
    <section style={{
      background: 'var(--surface-panel)', border: '1px solid var(--rule)', borderRadius: 10,
      padding: '14px 16px', minWidth: 0, ...style,
    }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, marginBottom: 12 }}>
        <h3 style={{ fontSize: 15.5, fontWeight: 600, color: 'var(--ink)' }}>{title}</h3>
        {note && <span style={{ fontSize: 13.5, color: 'var(--ink-3)' }}>{note}</span>}
      </header>
      {children}
    </section>
  )
}

export function relativeTime(ms) {
  const diff = Date.now() - ms
  const mins = Math.floor(diff / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}
