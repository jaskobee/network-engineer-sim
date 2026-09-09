/**
 * Small building blocks shared between AdminLaptop.jsx's tabs and
 * AdminDashboardTab.jsx — pulled out to a sibling module (rather than
 * exported from AdminLaptop.jsx and imported back) so the two don't form a
 * circular import, since AdminLaptop.jsx also renders AdminDashboardTab.
 */

export function Section({ title, children }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ fontSize: 9, color: '#4a90e2', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8, borderBottom: '1px solid #1a2a3e', paddingBottom: 4 }}>{title}</div>
      {children}
    </div>
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
