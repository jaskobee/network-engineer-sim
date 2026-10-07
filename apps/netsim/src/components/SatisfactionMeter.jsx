export default function SatisfactionMeter({ value }) {
  const color = value >= 70 ? '#3ee08f' : value >= 35 ? '#ffb42e' : '#ff6259'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{ width: 64, height: 5, borderRadius: 3, background: 'var(--rule-strong)', overflow: 'hidden' }}>
        <div style={{ width: `${Math.max(0, Math.min(100, value))}%`, height: '100%', background: color }} />
      </div>
      <span style={{ fontSize: 13, fontWeight: 600, color, minWidth: 34, textAlign: 'right' }}>{Math.round(value)}%</span>
    </div>
  )
}
