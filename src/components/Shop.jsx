import { deviceCatalog } from '../data/deviceCatalog.js'
import { useGame } from '../state/GameContext.jsx'
import CatalogCard from './CatalogCard.jsx'

export default function Shop() {
  const { budget, purchaseDevice, inventory, devices } = useGame()

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Balance */}
      <div style={{
        padding: '12px 14px', borderBottom: '1px solid var(--rule)',
        display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexShrink: 0,
      }}>
        <span style={{ fontSize: 14, color: 'var(--ink-3)' }}>Available budget</span>
        <span style={{ fontSize: 21, fontWeight: 700, color: 'var(--ink)' }}>${budget.toLocaleString()}</span>
      </div>

      {/* Device cards */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '10px 10px 14px' }}>
        {deviceCatalog.map(entry => {
          const owned = devices.filter(d => d.model === entry.model).length
          const inInv = inventory.filter(id => devices.find(dd => dd.id === id)?.model === entry.model).length
          const canAfford = budget >= entry.price
          return (
            <CatalogCard
              key={entry.model}
              entry={entry}
              price={entry.price}
              shortfall={entry.price - budget}
              canAfford={canAfford}
              owned={owned}
              inInventory={inInv}
              actionLabel="Buy"
              onAction={() => purchaseDevice(entry)}
            />
          )
        })}
      </div>
    </div>
  )
}
