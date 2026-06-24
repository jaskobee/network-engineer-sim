import { useDraggable } from '@dnd-kit/core'
import { useGame } from '../state/GameContext.jsx'

let _fallbackCounter = 0

export default function Inventory() {
  const { inventory, devices, placeDevice } = useGame()
  const inventoryDevices = inventory.map(id => devices.find(d => d.id === id)).filter(Boolean)

  function handlePlace(deviceId) {
    const col = _fallbackCounter % 4
    const row = Math.floor(_fallbackCounter / 4)
    _fallbackCounter++
    placeDevice(deviceId, 60 + col * 150, 60 + row * 110)
  }

  return (
    <div className="panel" style={{ flex: 1 }}>
      <h3 style={{ margin: '0 0 8px', fontSize: 13, color: '#4a90e2' }}>Inventory</h3>
      {inventoryDevices.length === 0 ? (
        <p style={{ color: '#444', fontSize: 12, margin: 0 }}>Empty — buy devices from the shop</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {inventoryDevices.map(device => (
            <DraggableItem key={device.id} device={device} onPlace={handlePlace} />
          ))}
        </div>
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
        padding: '5px 0',
        borderBottom: '1px solid #1a1a2e',
        opacity: isDragging ? 0.4 : 1,
        transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
        cursor: 'grab',
        touchAction: 'none',
      }}
      {...listeners}
      {...attributes}
    >
      <div>
        <span style={{ fontSize: 12, fontFamily: 'monospace' }}>{device.hostname}</span>
        <span style={{ fontSize: 11, color: '#555', marginLeft: 6 }}>({device.type})</span>
      </div>
      {/* onPointerDown stops the drag from starting when clicking the button */}
      <button
        className="btn-small"
        onPointerDown={e => e.stopPropagation()}
        onClick={e => { e.stopPropagation(); onPlace(device.id) }}
      >
        Place
      </button>
    </div>
  )
}
