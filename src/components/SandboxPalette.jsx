import { deviceCatalog } from '../data/deviceCatalog.js'
import { useGame } from '../state/GameContext.jsx'

const TYPE_ICONS = { router: '📡', switch: '🔀', pc: '💻', server: '🗄️', phone: '📞', firewall: '🛡️', isp: '🌐' }
const TYPE_COLOR = { router: '#4a90e2', switch: '#8be9fd', pc: '#50fa7b', server: '#ffb86c', phone: '#ff79c6', firewall: '#ff6b35', isp: '#00bcd4' }

const ISP_CATALOG_ENTRY = {
  type: 'isp',
  model: 'ISP-CLOUD',
  displayName: 'ISP / Internet',
  portCount: 1,
  description: 'TEST-NET-3 WAN uplink — 203.0.113.1/30 (RFC 5737)',
}

export default function SandboxPalette() {
  const { addSandboxDevice, clearSandbox, devices } = useGame()

  function handleClear() {
    if (devices.length === 0 || window.confirm('Clear all sandbox devices?')) clearSandbox()
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header */}
      <div style={{
        padding: '10px 12px 8px', borderBottom: '1px solid #1a1a3e',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0,
      }}>
        <span style={{ fontSize: 10, color: '#555', letterSpacing: 0.5 }}>SANDBOX DEVICES</span>
        <button
          onClick={handleClear}
          style={{
            padding: '3px 10px', fontSize: 9, fontWeight: 700,
            background: 'transparent', color: '#ff5555',
            border: '1px solid #3a1010', borderRadius: 3, cursor: 'pointer', letterSpacing: 0.5,
          }}
          onMouseEnter={e => { e.currentTarget.style.background = '#2a1010' }}
          onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
        >
          CLEAR
        </button>
      </div>

      {devices.length > 0 && (
        <div style={{ padding: '4px 12px', fontSize: 9, color: '#444', borderBottom: '1px solid #0d0d20' }}>
          {devices.length} device{devices.length !== 1 ? 's' : ''} on canvas
        </div>
      )}

      {/* Device cards */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 8px 12px' }}>
        {[...deviceCatalog, ISP_CATALOG_ENTRY].map(entry => {
          const color = TYPE_COLOR[entry.type] || '#4a90e2'
          return (
            <div
              key={entry.model}
              style={{
                marginBottom: 8, background: '#0a0f1e',
                border: '1px solid #1a3060', borderRadius: 8, overflow: 'hidden',
              }}
            >
              {/* Card header */}
              <div style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '10px 12px 8px', borderBottom: '1px solid #0d0d20',
                background: '#0d1328',
              }}>
                <div style={{
                  fontSize: 24, width: 40, height: 40, display: 'flex',
                  alignItems: 'center', justifyContent: 'center',
                  background: '#060d20', borderRadius: 6,
                  border: `1px solid ${color}44`,
                }}>
                  {TYPE_ICONS[entry.type] || '📦'}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#d0d0d0', marginBottom: 2 }}>
                    {entry.displayName}
                  </div>
                  <div style={{ fontSize: 10, color: '#444', lineHeight: 1.3 }}>
                    {entry.description}
                  </div>
                </div>
              </div>

              {/* Card body */}
              <div style={{ padding: '7px 12px 10px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{
                  fontSize: 9, fontFamily: 'monospace',
                  color, background: color + '18',
                  padding: '2px 6px', borderRadius: 3,
                  border: `1px solid ${color}33`,
                }}>
                  {entry.portCount} ports · {entry.type}
                </span>
                <button
                  onClick={() => addSandboxDevice(entry)}
                  style={{
                    padding: '5px 16px', fontSize: 11, fontWeight: 700,
                    background: '#1a3060', color: '#e0e0e0',
                    border: 'none', borderRadius: 4, cursor: 'pointer', letterSpacing: 0.5,
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = '#2a5298' }}
                  onMouseLeave={e => { e.currentTarget.style.background = '#1a3060' }}
                >
                  ADD
                </button>
              </div>
            </div>
          )
        })}
      </div>

      {/* Hints */}
      <div style={{
        padding: '8px 12px', borderTop: '1px solid #0d0d20',
        fontSize: 9, color: '#2a2a50', lineHeight: 1.6, flexShrink: 0,
      }}>
        Devices start powered on. Right-click → Open Terminal.<br/>
        No budget · No missions · Full CLI + accurate L2/L3 rules.
      </div>
    </div>
  )
}
