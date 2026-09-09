/**
 * Small horizontal client-satisfaction bar — extracted out of
 * ActiveContractsPanel.jsx so the Admin Laptop dashboard can show the same
 * real per-client happiness data without duplicating this component.
 */
export default function SatisfactionMeter({ value }) {
  const color = value >= 70 ? '#50fa7b' : value >= 35 ? '#ffb86c' : '#ff5555'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <div style={{ width: 56, height: 5, borderRadius: 3, background: '#0d0d20', overflow: 'hidden' }}>
        <div style={{ width: `${Math.max(0, Math.min(100, value))}%`, height: '100%', background: color }} />
      </div>
      <span style={{ fontSize: 9, color, fontFamily: 'monospace' }}>{Math.round(value)}%</span>
    </div>
  )
}
