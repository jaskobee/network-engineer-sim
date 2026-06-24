import { deviceCatalog } from '../data/deviceCatalog.js'
import { useGame } from '../state/GameContext.jsx'

const TYPE_ICONS = { router: '📡', switch: '🔀', pc: '💻', server: '🗄️', phone: '📞' }
const TYPE_COLOR = { router: '#4a90e2', switch: '#8be9fd', pc: '#50fa7b', server: '#ffb86c', phone: '#ff79c6' }

export default function Shop() {
  const { budget, purchaseDevice, inventory, devices } = useGame()

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Balance bar */}
      <div style={{
        padding: '10px 12px 8px', borderBottom: '1px solid #1a1a3e',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0,
      }}>
        <span style={{ fontSize: 10, color: '#555', letterSpacing: 0.5 }}>AVAILABLE BUDGET</span>
        <span style={{ fontSize: 16, fontWeight: 700, color: '#50fa7b', fontFamily: 'monospace' }}>
          ${budget.toLocaleString()}
        </span>
      </div>

      {/* Device cards */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 8px 12px' }}>
        {deviceCatalog.map(entry => {
          const canAfford = budget >= entry.price
          const owned     = devices.filter(d => d.model === entry.model).length
          const inInv     = inventory.filter(id => {
            const d = devices.find(dd => dd.id === id)
            return d?.model === entry.model
          }).length
          const color = TYPE_COLOR[entry.type] || '#4a90e2'
          return (
            <div
              key={entry.model}
              style={{
                marginBottom: 8,
                background: '#0a0f1e',
                border: `1px solid ${canAfford ? '#1a3060' : '#0d0d20'}`,
                borderRadius: 8,
                overflow: 'hidden',
                opacity: canAfford ? 1 : 0.6,
                transition: 'border-color 0.15s',
              }}
            >
              {/* Card header */}
              <div style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '10px 12px 8px',
                borderBottom: '1px solid #0d0d20',
                background: canAfford ? '#0d1328' : '#090910',
              }}>
                <div style={{
                  fontSize: 24, width: 40, height: 40, display: 'flex',
                  alignItems: 'center', justifyContent: 'center',
                  background: '#060d20', borderRadius: 6,
                  border: `1px solid ${canAfford ? color + '44' : '#1a1a2e'}`,
                }}>
                  {TYPE_ICONS[entry.type] || '📦'}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: canAfford ? '#d0d0d0' : '#555', marginBottom: 2 }}>
                    {entry.displayName}
                  </div>
                  <div style={{ fontSize: 10, color: '#444', lineHeight: 1.3 }}>
                    {entry.description}
                  </div>
                </div>
              </div>

              {/* Card body */}
              <div style={{ padding: '7px 12px 10px' }}>
                {/* Specs row */}
                <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
                  <Chip label={entry.portCount + ' ports'} color={color} />
                  <Chip label={entry.type} color={color} />
                  {owned > 0 && (
                    <Chip label={`owned: ${owned} (${inInv} in inv)`} color="#50fa7b" />
                  )}
                </div>

                {/* Price + buy */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{
                    fontSize: 15, fontWeight: 700, fontFamily: 'monospace',
                    color: canAfford ? '#f8f8f2' : '#333',
                  }}>
                    ${entry.price.toLocaleString()}
                  </span>
                  <button
                    onClick={() => purchaseDevice(entry)}
                    disabled={!canAfford}
                    style={{
                      padding: '5px 16px', fontSize: 11, fontWeight: 700,
                      background: canAfford ? '#2a5298' : '#1a1a2e',
                      color: canAfford ? '#e0e0e0' : '#333',
                      border: 'none', borderRadius: 4, cursor: canAfford ? 'pointer' : 'not-allowed',
                      letterSpacing: 0.5, transition: 'background 0.15s',
                    }}
                    onMouseEnter={e => { if (canAfford) e.currentTarget.style.background = '#3a6ab8' }}
                    onMouseLeave={e => { if (canAfford) e.currentTarget.style.background = '#2a5298' }}
                  >
                    BUY
                  </button>
                </div>

                {!canAfford && (
                  <div style={{ fontSize: 10, color: '#3a1a1a', marginTop: 4 }}>
                    Need ${(entry.price - budget).toLocaleString()} more
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function Chip({ label, color }) {
  return (
    <span style={{
      fontSize: 9, fontFamily: 'monospace',
      color, background: color + '18',
      padding: '2px 6px', borderRadius: 3,
      border: `1px solid ${color}33`,
      letterSpacing: 0.3,
    }}>
      {label}
    </span>
  )
}
