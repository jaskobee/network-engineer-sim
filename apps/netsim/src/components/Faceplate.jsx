// An 8-port switch faceplate — the one image that is unmistakably this product.
// The amber LED is the only thing that moves (activity blink).
export default function Faceplate() {
  const leds = ['green', 'green', 'green', 'amber', null, null, null, null]
  const fill = { green: '#3ee08f', amber: '#ffb42e' }
  return (
    <svg viewBox="0 0 240 48" width="240" height="48" aria-hidden="true" focusable="false" style={{ display: 'block' }}>
      <rect x="1" y="1" width="238" height="46" rx="7" fill="#141a1f" stroke="#2c3b46" />
      {leds.map((c, i) => {
        const x = 16 + i * 26
        return (
          <g key={i}>
            <rect x={x} y="21" width="18" height="16" rx="2.5" fill="#090c0f" stroke="#2c3b46" />
            <rect x={x + 5} y="28" width="8" height="5" rx="1" fill="#1a232a" />
            {c && <circle cx={x + 9} cy="12" r="5" fill={fill[c]} opacity="0.18" />}
            <circle className={c === 'amber' ? 'led-blink' : undefined} cx={x + 9} cy="12" r="2.5" fill={c ? fill[c] : '#2c3b46'} />
          </g>
        )
      })}
      <circle cx="226" cy="12" r="2.5" fill="#4da6ff" />
    </svg>
  )
}
