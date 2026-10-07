// Difficulty drawn as signal-strength bars — the more bars, the harder the job.
export default function DifficultyBars({ level = 1, max = 4 }) {
  const total = Math.max(max, level ?? 0)
  const filled = Math.max(0, Math.min(level ?? 0, total))
  return (
    <span
      role="img"
      aria-label={`Difficulty ${filled} of ${total}`}
      title={`Difficulty ${filled} of ${total}`}
      style={{ display: 'inline-flex', alignItems: 'flex-end', gap: 2, height: 14 }}
    >
      {Array.from({ length: total }, (_, i) => (
        <i key={i} style={{
          display: 'block', width: 3, height: 4 + i * 3, borderRadius: 1,
          background: i < filled ? 'var(--ink-2)' : 'var(--rule-strong)',
        }} />
      ))}
    </span>
  )
}
