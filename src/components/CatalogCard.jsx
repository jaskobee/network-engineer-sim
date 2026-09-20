import { DEVICE_ICONS } from './DeviceIcons.jsx'

// One catalog row for hardware — shared by the Shop (priced) and the Sandbox
// palette (free). Specs stay neutral: colour is reserved for state, so a firewall
// isn't red and a PC isn't green just because of its category.
export default function CatalogCard({ entry, price, shortfall = 0, canAfford = true, owned = 0, inInventory = 0, actionLabel, onAction }) {
  const Icon = DEVICE_ICONS[entry.type]
  return (
    <div style={{
      marginBottom: 8, background: 'var(--surface-raised)',
      border: '1px solid var(--rule)', borderRadius: 8,
      padding: 10, opacity: canAfford ? 1 : 0.7,
    }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <div style={{
          width: 64, height: 50, flexShrink: 0, display: 'grid', placeItems: 'center',
          background: 'var(--surface-well)', border: '1px solid var(--rule)', borderRadius: 6,
        }}>
          {Icon ? <Icon /> : null}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15.5, fontWeight: 700, color: 'var(--ink)', lineHeight: 1.2 }}>{entry.displayName}</div>
          <div style={{ fontSize: 13.5, color: 'var(--ink-3)', lineHeight: 1.3, marginTop: 2 }}>{entry.description}</div>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10 }}>
        <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--ink-3)' }}>
          <span>{entry.portCount} {entry.portCount === 1 ? 'port' : 'ports'}</span>
          {owned > 0 && (
            <>
              <span aria-hidden="true">·</span>
              <i className="led green" style={{ width: 7, height: 7 }} />
              <span>{owned} owned{inInventory > 0 ? `, ${inInventory} unplaced` : ''}</span>
            </>
          )}
        </div>
        {price != null && (
          <span style={{ fontSize: 17, fontWeight: 700, color: canAfford ? 'var(--ink)' : 'var(--ink-3)' }}>
            ${price.toLocaleString()}
          </span>
        )}
        <button className="btn primary" style={{ padding: '4px 14px' }} onClick={onAction} disabled={!canAfford}>
          {actionLabel}
        </button>
      </div>

      {!canAfford && (
        <div style={{ fontSize: 13, color: 'var(--led-amber)', marginTop: 6 }}>
          Need ${shortfall.toLocaleString()} more
        </div>
      )}
    </div>
  )
}
