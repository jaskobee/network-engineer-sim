import { useGame } from '../state/GameContext.jsx'
import { playPowerOn, playPowerOff } from '../utils/sounds.js'

export default function ContextMenu({ x, y, deviceId, onClose }) {
  const { getDevice, setSelectedDeviceId, openTerminal, openFwConsole, removeFromFloorplan, refresh, setWireMode, closeTerminal, terminalSessions, topology } = useGame()
  const device = getDevice(deviceId)
  if (!device) return null

  const isPowered = !!device.powered

  // ISP is mission infrastructure — show a minimal informational menu only
  if (device.type === 'isp') {
    return (
      <div
        style={{
          position: 'fixed', left: x, top: y, zIndex: 1000,
          background: '#16213e', border: '1px solid #00bcd4', borderRadius: 4,
          minWidth: 200, boxShadow: '0 6px 20px rgba(0,0,0,0.6)',
          overflow: 'hidden', userSelect: 'none',
        }}
        onMouseDown={e => e.stopPropagation()}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ padding: '6px 12px 4px', borderBottom: '1px solid #1a1a3e' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ fontSize: 12, color: '#00bcd4', fontWeight: 600 }}>ISP / Internet</div>
            <div style={{
              fontSize: 8, fontWeight: 700, letterSpacing: 0.5,
              padding: '1px 5px', borderRadius: 3,
              background: '#0a2a2a', color: '#00bcd4', border: '1px solid #1a4a4a',
            }}>ONLINE</div>
          </div>
          <div style={{ fontSize: 10, color: '#555', marginTop: 2 }}>WAN uplink — 203.0.113.1/30</div>
        </div>
        <div style={{ padding: '8px 12px', fontSize: 11, color: '#444', lineHeight: 1.6 }}>
          Connect your router's WAN port here,<br/>
          then add a default route to reach<br/>
          the internet (ping 8.8.8.8).
        </div>
        <Divider />
        <Item label="Connect Cable" icon="🔌" onClick={() => { setWireMode({ srcDeviceId: deviceId }); onClose() }} accent />
      </div>
    )
  }

  function handleOpenTerminal() { openTerminal(deviceId); setSelectedDeviceId(deviceId); onClose() }

  function powerOn() {
    device.powered = true
    // Interfaces stay admin_down — player must "no shutdown" each one explicitly
    playPowerOn()
    refresh(); onClose()
  }

  function powerOff() {
    device.powered = false
    for (const iface of device.interfaces) {
      // Drop peer interface to 'down' (no carrier) so show ip int brief is correct on the peer
      if (iface.connected_to) {
        const remIface = topology._resolveIface(iface.connected_to)
        if (remIface && remIface.status === 'up') remIface.status = 'down'
      }
      iface.status = 'admin_down'
    }
    // Close the terminal session for this device if one is open
    const session = terminalSessions.find(s => s.deviceId === deviceId)
    if (session) closeTerminal(session.id)
    playPowerOff()
    refresh(); onClose()
  }

  function remove() { removeFromFloorplan(deviceId); setSelectedDeviceId(null); onClose() }

  function connectCable() {
    setWireMode({ srcDeviceId: deviceId })
    onClose()
  }

  return (
    <div
      style={{
        position: 'fixed', left: x, top: y, zIndex: 1000,
        background: '#16213e', border: '1px solid #2a5298', borderRadius: 4,
        minWidth: 190, boxShadow: '0 6px 20px rgba(0,0,0,0.6)',
        overflow: 'hidden', userSelect: 'none',
      }}
      onMouseDown={e => e.stopPropagation()}
      onClick={e => e.stopPropagation()}
    >
      <MenuHeader label={device.hostname} sub={device.model} isPowered={isPowered} />
      <Divider />
      {!isPowered ? (
        <Item label="Power On" icon="⚡" onClick={powerOn} accent />
      ) : (
        <>
          <Item label="Open Terminal" icon="⌨" onClick={handleOpenTerminal} />
          {device.type === 'firewall' && (
            <Item label="Open Firewall Console" icon="🛡" onClick={() => { openFwConsole(deviceId); onClose() }} />
          )}
          <Item label="Connect Cable" icon="🔌" onClick={connectCable} accent />
          <Divider />
          <Item label="Power Off" icon="○" onClick={powerOff} />
        </>
      )}
      <Divider />
      <Item label="Remove from Floorplan" icon="✕" onClick={remove} danger />
    </div>
  )
}

function MenuHeader({ label, sub, isPowered }) {
  return (
    <div style={{ padding: '6px 12px 4px', borderBottom: '1px solid #1a1a3e' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <div style={{ fontSize: 12, color: '#4a90e2', fontWeight: 600 }}>{label}</div>
        <div style={{
          fontSize: 8, fontWeight: 700, letterSpacing: 0.5,
          padding: '1px 5px', borderRadius: 3,
          background: isPowered ? '#0a2a10' : '#2a1010',
          color: isPowered ? '#50fa7b' : '#ff5555',
          border: `1px solid ${isPowered ? '#1a4a20' : '#4a1a1a'}`,
        }}>
          {isPowered ? 'ON' : 'OFF'}
        </div>
      </div>
      <div style={{ fontSize: 10, color: '#555' }}>{sub}</div>
    </div>
  )
}

function Item({ label, icon, onClick, danger, accent }) {
  const color = danger ? '#ff5555' : accent ? '#50fa7b' : '#d0d0d0'
  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '6px 12px', fontSize: 12, color, cursor: 'pointer',
      }}
      onMouseEnter={e => { e.currentTarget.style.background = danger ? '#2a1010' : accent ? '#0a2010' : '#1a3060' }}
      onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
      onClick={onClick}
    >
      <span style={{ fontSize: 10, width: 14, textAlign: 'center', color: '#666' }}>{icon}</span>
      {label}
    </div>
  )
}

function Divider() {
  return <div style={{ height: 1, background: '#0d1020', margin: '2px 0' }} />
}
