import { useGame } from '../state/GameContext.jsx'
import { playPowerOn, playPowerOff } from '../utils/sounds.js'
import { supportsHostGui } from '../engine/hostConfig.js'
import { IconPower, IconPlug, IconShield, IconTerminal, IconWindow, IconClose } from './icons.jsx'

const MENU = {
  position: 'fixed', zIndex: 5000,   // menus always come over everything else (windows 1600, dialogs 2500+)
  background: 'var(--surface-raised)', border: '1px solid var(--rule-strong)', borderRadius: 8,
  boxShadow: 'var(--shadow-float)', overflow: 'hidden', userSelect: 'none', padding: '4px 0',
}

export default function ContextMenu({ x, y, deviceId, onClose }) {
  const { getDevice, setSelectedDeviceId, openTerminal, openFwConsole, openHostConfig, removeFromFloorplan, refresh, setWireMode, closeTerminal, terminalSessions, topology } = useGame()
  const device = getDevice(deviceId)
  if (!device) return null

  const isPowered = !!device.powered

  // ISP is mission infrastructure — show a minimal informational menu only
  if (device.type === 'isp') {
    return (
      <div
        style={{ ...MENU, left: x, top: y, minWidth: 220 }}
        onMouseDown={e => e.stopPropagation()}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ padding: '6px 12px 4px', borderBottom: '1px solid #202b33' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ fontSize: 16, color: 'var(--ink)', fontWeight: 700 }}>ISP / Internet</div>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--ink-3)' }}>
              <i className="led green" style={{ width: 7, height: 7 }} /> Online
            </span>
          </div>
          <div style={{ fontSize: 13.5, color: 'var(--ink-3)', marginTop: 2 }}>WAN uplink — 203.0.113.1/30</div>
        </div>
        <div style={{ padding: '8px 12px', fontSize: 14.5, color: 'var(--ink-2)', lineHeight: 1.5, maxWidth: 260 }}>
          Connect your router&apos;s WAN port here, then add a default route to reach the internet (ping 8.8.8.8).
        </div>
        <Divider />
        <Item label="Connect Cable" icon={<IconPlug size={16} />} onClick={() => { setWireMode({ srcDeviceId: deviceId }); onClose() }} accent />
      </div>
    )
  }

  function handleOpenTerminal() { openTerminal(deviceId, { x, y }); setSelectedDeviceId(deviceId); onClose() }
  function handleConfigureGui()  { openHostConfig(deviceId, { x, y }); setSelectedDeviceId(deviceId); onClose() }

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
      style={{ ...MENU, left: x, top: y, minWidth: 220 }}
      onMouseDown={e => e.stopPropagation()}
      onClick={e => e.stopPropagation()}
    >
      <MenuHeader label={device.hostname} sub={device.model} isPowered={isPowered} />
      <Divider />
      {!isPowered ? (
        <Item label="Power On" icon={<IconPower size={16} />} onClick={powerOn} accent />
      ) : (
        <>
          <Item label="Open Terminal" icon={<IconTerminal size={16} />} onClick={handleOpenTerminal} />
          {supportsHostGui(device) && (
            <Item label="Configure GUI" icon={<IconWindow size={16} />} onClick={handleConfigureGui} />
          )}
          {device.type === 'firewall' && (
            <Item label="Open Firewall Console" icon={<IconShield size={16} />} onClick={() => { openFwConsole(deviceId); onClose() }} />
          )}
          <Item label="Connect Cable" icon={<IconPlug size={16} />} onClick={connectCable} accent />
          <Divider />
          <Item label="Power Off" icon={<IconPower size={16} />} onClick={powerOff} />
        </>
      )}
      <Divider />
      <Item label="Remove from Floorplan" icon={<IconClose size={16} />} onClick={remove} danger />
    </div>
  )
}

function MenuHeader({ label, sub, isPowered }) {
  return (
    <div style={{ padding: '6px 12px 6px', borderBottom: '1px solid var(--rule)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
        <div style={{ fontSize: 16, color: 'var(--ink)', fontWeight: 700 }}>{label}</div>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--ink-3)' }}>
          <i className={`led ${isPowered ? 'green' : ''}`} style={{ width: 7, height: 7 }} />
          {isPowered ? 'On' : 'Off'}
        </span>
      </div>
      <div style={{ fontSize: 13.5, color: 'var(--ink-3)' }}>{sub}</div>
    </div>
  )
}

function Item({ label, icon, onClick, danger, accent }) {
  const color = danger ? 'var(--led-red)' : accent ? 'var(--signal)' : 'var(--ink)'
  return (
    <div
      role="menuitem"
      tabIndex={0}
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '7px 12px', fontSize: 15, color, cursor: 'pointer',
      }}
      onMouseEnter={e => { e.currentTarget.style.background = danger ? '#2a1714' : 'var(--surface-hover)' }}
      onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick() } }}
      onClick={onClick}
    >
      <span style={{ width: 16, display: 'grid', placeItems: 'center', color: 'var(--ink-3)' }}>{icon}</span>
      {label}
    </div>
  )
}

function Divider() {
  return <div style={{ height: 1, background: 'var(--rule)', margin: '4px 0' }} />
}
