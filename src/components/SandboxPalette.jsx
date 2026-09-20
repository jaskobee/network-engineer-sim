import { deviceCatalog } from '../data/deviceCatalog.js'
import { useGame } from '../state/GameContext.jsx'
import CatalogCard from './CatalogCard.jsx'

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
        padding: '10px 12px 10px 14px', borderBottom: '1px solid var(--rule)',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0,
      }}>
        <div>
          <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--ink)' }}>Sandbox</div>
          <div style={{ fontSize: 13, color: 'var(--ink-3)' }}>
            {devices.length} device{devices.length !== 1 ? 's' : ''} on canvas
          </div>
        </div>
        <button className="btn danger" style={{ padding: '3px 10px', fontSize: 13 }} onClick={handleClear}>Clear</button>
      </div>

      {/* Device cards */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '10px 10px 14px' }}>
        {[...deviceCatalog, ISP_CATALOG_ENTRY].map(entry => (
          <CatalogCard key={entry.model} entry={entry} actionLabel="Add" onAction={() => addSandboxDevice(entry)} />
        ))}
      </div>

      {/* Hints */}
      <div style={{
        padding: '10px 14px', borderTop: '1px solid var(--rule)',
        fontSize: 13, color: 'var(--ink-3)', lineHeight: 1.55, flexShrink: 0,
      }}>
        Devices start powered on. Right-click a device to open its terminal.
        No budget, no missions — full CLI with accurate L2/L3 rules.
      </div>
    </div>
  )
}
