/**
 * Sign-in illustration: a region holding a virtual network with two subnets — drawn in the
 * design tokens, not with Microsoft's icons (those only ever stand for the service they name).
 */
export default function CloudHero() {
  return (
    <svg width="220" height="128" viewBox="0 0 220 128" role="img" aria-label="A region containing a virtual network with two subnets">
      <rect x="1" y="1" width="218" height="126" rx="12" fill="var(--surface-panel)" stroke="var(--rule-strong)" strokeDasharray="5 4" />
      <rect x="18" y="18" width="184" height="92" rx="9" fill="var(--surface-raised)" stroke="var(--signal-strong)" />
      {[32, 116].map(x => (
        <g key={x}>
          <rect x={x} y="34" width="72" height="60" rx="7" fill="var(--surface-well)" stroke="var(--rule-strong)" />
          <circle cx={x + 22} cy="64" r="4" fill="var(--led-green)" />
          <circle cx={x + 50} cy="64" r="4" fill={x === 32 ? 'var(--led-green)' : 'var(--led-off)'} />
        </g>
      ))}
    </svg>
  )
}
