import { useDraggable } from '@dnd-kit/core'
import { useGame } from '../state/GameContext.jsx'

let _fallbackCounter = 0

export default function Inventory() {
  const { inventory, devices, placeDevice, panOffset } = useGame()
  const inventoryDevices = inventory.map(id => devices.find(d => d.id === id)).filter(Boolean)

  function handlePlace(deviceId) {
    const col = _fallbackCounter % 4
    const row = Math.floor(_fallbackCounter / 4)
    _fallbackCounter++
    // Anchor the grid to whatever part of the world is currently visible
    // (-panOffset), not a fixed world coordinate — on an endless canvas, a
    // fixed spot could be scrolled off-screen with no clue where it landed.
    placeDevice(deviceId, -panOffset.x + 60 + col * 150, -panOffset.y + 60 + row * 110)
  }

  return (
    <div style={{ flex: 1, padding: '10px 12px' }}>
      {inventoryDevices.length === 0 ? (
        <p style={{ color: 'var(--ink-3)', fontSize: 14.5, lineHeight: 1.5 }}>
          Nothing in inventory. Buy devices from the Shop, then place them on the map.
        </p>
      ) : (
        <>
          <p style={{ color: 'var(--ink-3)', fontSize: 13.5, marginBottom: 8 }}>Drag onto the map, or press Place.</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {inventoryDevices.map(device => (
              <DraggableItem key={device.id} device={device} onPlace={handlePlace} />
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function DraggableItem({ device, onPlace }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: device.id,
    data: { type: 'inventory', deviceId: device.id },
  })

  return (
    <div
      ref={setNodeRef}
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: 8,
        padding: '7px 8px 7px 12px',
        background: 'var(--surface-raised)',
        border: '1px solid var(--rule)',
        borderRadius: 8,
        opacity: isDragging ? 0.4 : 1,
        transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
        cursor: 'grab',
        touchAction: 'none',
      }}
      {...listeners}
      {...attributes}
    >
      <div style={{ minWidth: 0 }}>
        <span style={{ fontSize: 14, fontFamily: 'var(--font-mono)', color: 'var(--ink)' }}>{device.hostname}</span>
        <span style={{ fontSize: 13.5, color: 'var(--ink-3)', marginLeft: 8 }}>{device.type}</span>
      </div>
      {/* onPointerDown stops the drag from starting when clicking the button */}
      <button
        className="btn"
        style={{ padding: '3px 12px' }}
        onPointerDown={e => e.stopPropagation()}
        onClick={e => { e.stopPropagation(); onPlace(device.id) }}
      >
        Place
      </button>
    </div>
  )
}
