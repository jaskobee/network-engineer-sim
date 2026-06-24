import { useState, useEffect, useRef } from 'react'
import { useDraggable, useDroppable } from '@dnd-kit/core'
import { useGame } from '../state/GameContext.jsx'
import ContextMenu from './ContextMenu.jsx'
import { maskToPrefixLen } from '../models/ipUtils.js'

const W = 108
const H = 90

// ICMP timing constants — must stay in sync with GameContext.jsx cleanup timeout
const PING_TRAVEL_MS = 1200
const PING_FADE_MS   = 600

function center(placement) {
  return { x: placement.x + W / 2, y: placement.y + H / 2 }
}

// ── SVG device icons ──────────────────────────────────────────────────────────

function RouterIcon() {
  return (
    <svg viewBox="0 0 54 38" width="54" height="38" style={{ display: 'block', margin: '0 auto' }}>
      <rect x="2" y="10" width="50" height="20" rx="3" fill="#0d1a40" stroke="#4a90e2" strokeWidth="1.4"/>
      {[10, 18, 26, 34].map(x => (
        <rect key={x} x={x} y="17" width="5" height="6" rx="1" fill="#1a3060" stroke="#2a6abf" strokeWidth="0.8"/>
      ))}
      <circle cx="45" cy="20" r="2.5" fill="#50fa7b"/>
      <line x1="12" y1="10" x2="9"  y2="2"  stroke="#2a5298" strokeWidth="1.5" strokeLinecap="round"/>
      <line x1="42" y1="10" x2="45" y2="2"  stroke="#2a5298" strokeWidth="1.5" strokeLinecap="round"/>
      <circle cx="9"  cy="2" r="1.5" fill="#4a90e2"/>
      <circle cx="45" cy="2" r="1.5" fill="#4a90e2"/>
    </svg>
  )
}

function SwitchIcon() {
  return (
    <svg viewBox="0 0 54 22" width="54" height="22" style={{ display: 'block', margin: '0 auto' }}>
      <rect x="1" y="2" width="52" height="18" rx="2" fill="#0d1a40" stroke="#4a90e2" strokeWidth="1.4"/>
      {[5, 10, 15, 20, 25, 30, 35, 40].map(x => (
        <rect key={x} x={x} y="6" width="4" height="10" rx="0.8" fill="#1a3060" stroke="#2a6abf" strokeWidth="0.6"/>
      ))}
      <circle cx="49" cy="11" r="2" fill="#50fa7b"/>
    </svg>
  )
}

function PCIcon() {
  return (
    <svg viewBox="0 0 48 42" width="48" height="42" style={{ display: 'block', margin: '0 auto' }}>
      <rect x="2" y="2" width="44" height="30" rx="3" fill="#0d1a40" stroke="#4a90e2" strokeWidth="1.4"/>
      <rect x="5" y="5" width="38" height="22" rx="1.5" fill="#060d20"/>
      <rect x="9" y="11" width="6"  height="1.5" rx="0.5" fill="#4a90e2" opacity="0.7"/>
      <rect x="9" y="14" width="14" height="1.5" rx="0.5" fill="#2a5298" opacity="0.5"/>
      <rect x="9" y="17" width="10" height="1.5" rx="0.5" fill="#2a5298" opacity="0.5"/>
      <rect x="21" y="32" width="6"  height="5" fill="#1a3060"/>
      <rect x="13" y="37" width="22" height="3" rx="1.5" fill="#1a3060" stroke="#2a5298" strokeWidth="0.8"/>
    </svg>
  )
}

function ServerIcon() {
  return (
    <svg viewBox="0 0 48 44" width="48" height="44" style={{ display: 'block', margin: '0 auto' }}>
      {[0, 14, 28].map((y, i) => (
        <g key={y}>
          <rect x="2" y={y + 2} width="44" height="11" rx="1.5" fill="#0d1a40" stroke="#4a90e2" strokeWidth="1.2"/>
          {[6, 13, 20, 27].map(x => (
            <rect key={x} x={x} y={y + 5} width="5" height="5" rx="0.5" fill="#131d3a" stroke="#2a4080" strokeWidth="0.5"/>
          ))}
          <circle cx="41" cy={y + 7.5} r="2" fill={i === 0 ? '#50fa7b' : i === 1 ? '#ffb86c' : '#50fa7b'}/>
        </g>
      ))}
    </svg>
  )
}

function PhoneIcon() {
  return (
    <svg viewBox="0 0 48 48" width="48" height="48" style={{ display: 'block', margin: '0 auto' }}>
      {/* Phone body */}
      <rect x="8" y="10" width="32" height="28" rx="3" fill="#0d1a40" stroke="#ff79c6" strokeWidth="1.4"/>
      {/* Screen */}
      <rect x="11" y="13" width="26" height="14" rx="1.5" fill="#060d20"/>
      {/* Screen glow lines (idle display) */}
      <rect x="14" y="16" width="12" height="1.5" rx="0.5" fill="#ff79c6" opacity="0.6"/>
      <rect x="14" y="19" width="8"  height="1.5" rx="0.5" fill="#a020d0" opacity="0.4"/>
      {/* Keypad dots */}
      {[0,1,2].map(col => [0,1,2].map(row => (
        <circle key={`${col}-${row}`}
          cx={16 + col * 7} cy={31 + row * 4} r="1.2"
          fill="#ff79c6" opacity="0.5"/>
      )))}
      {/* Power LED */}
      <circle cx="40" cy="14" r="2" fill="#50fa7b"/>
    </svg>
  )
}

function FirewallIcon() {
  return (
    <svg viewBox="0 0 54 46" width="54" height="46" style={{ display: 'block', margin: '0 auto' }}>
      {/* Chassis */}
      <rect x="2" y="10" width="50" height="22" rx="3" fill="#0d1a40" stroke="#ff6b35" strokeWidth="1.4"/>
      {/* Status LEDs */}
      <circle cx="45" cy="21" r="2.5" fill="#50fa7b"/>
      <circle cx="40" cy="21" r="2" fill="#ffb86c"/>
      {/* Shield emblem */}
      <path d="M27 14 L34 17 L34 23 Q34 27 27 30 Q20 27 20 23 L20 17 Z" fill="#0a1530" stroke="#ff6b35" strokeWidth="1.2"/>
      <line x1="27" y1="18" x2="27" y2="27" stroke="#ff6b35" strokeWidth="1" opacity="0.7"/>
      <line x1="22" y1="22" x2="32" y2="22" stroke="#ff6b35" strokeWidth="1" opacity="0.7"/>
      {/* Ports */}
      {[7, 11, 15].map(x => (
        <rect key={x} x={x} y="17" width="3" height="8" rx="0.5" fill="#1a3060" stroke="#2a4080" strokeWidth="0.5"/>
      ))}
      {/* Antennas */}
      <line x1="10" y1="10" x2="8"  y2="3"  stroke="#ff6b35" strokeWidth="1.2" strokeLinecap="round" opacity="0.6"/>
      <line x1="44" y1="10" x2="46" y2="3"  stroke="#ff6b35" strokeWidth="1.2" strokeLinecap="round" opacity="0.6"/>
    </svg>
  )
}

function IspIcon() {
  return (
    <svg viewBox="0 0 54 42" width="54" height="42" style={{ display: 'block', margin: '0 auto' }}>
      <circle cx="27" cy="21" r="17" fill="#040d1a" stroke="#00bcd4" strokeWidth="1.5"/>
      <ellipse cx="27" cy="21" rx="17" ry="7" fill="none" stroke="#00bcd4" strokeWidth="0.8" opacity="0.45"/>
      <ellipse cx="27" cy="21" rx="8" ry="17" fill="none" stroke="#00bcd4" strokeWidth="0.8" opacity="0.45"/>
      <line x1="10" y1="21" x2="44" y2="21" stroke="#00bcd4" strokeWidth="0.8" opacity="0.45"/>
      <line x1="27" y1="4" x2="27" y2="38" stroke="#00bcd4" strokeWidth="0.8" opacity="0.45"/>
      <circle cx="27" cy="4" r="2" fill="#00bcd4" opacity="0.9"/>
    </svg>
  )
}

const ICONS = { router: RouterIcon, switch: SwitchIcon, pc: PCIcon, server: ServerIcon, phone: PhoneIcon, firewall: FirewallIcon, isp: IspIcon }

// ── Device hover tooltip ──────────────────────────────────────────────────────

function DeviceTooltip({ device, x, y }) {
  const STATUS_COLOR = { up: '#50fa7b', down: '#ffb86c', admin_down: '#333355' }
  const STATUS_LABEL = { up: 'up', down: 'down', admin_down: 'admin down' }
  const flipLeft = x > window.innerWidth - 280
  return (
    <div style={{
      position: 'fixed', left: flipLeft ? x - 280 : x,
      top: Math.min(y, window.innerHeight - 220),
      zIndex: 500, background: '#10182e', border: '1px solid #2a5298',
      borderRadius: 6, minWidth: 256, maxWidth: 300,
      boxShadow: '0 6px 24px rgba(0,0,0,0.7)', pointerEvents: 'none', userSelect: 'none',
    }}>
      <div style={{ padding: '7px 12px 5px', borderBottom: '1px solid #1a2a50' }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: '#4a90e2', fontFamily: 'monospace' }}>
          {device.hostname}
        </div>
        <div style={{ fontSize: 10, color: '#555', marginTop: 1 }}>{device.model} — {device.type}</div>
      </div>
      <div style={{ padding: '4px 0 6px' }}>
        <div style={{
          display: 'grid', gridTemplateColumns: '1fr 1fr auto',
          padding: '2px 12px', fontSize: 9, color: '#3a3a60',
          fontFamily: 'monospace', letterSpacing: 0.5, marginBottom: 2,
        }}>
          <span>INTERFACE</span><span>IP</span><span>STATUS</span>
        </div>
        {device.interfaces.map(iface => (
          <div key={iface.name} style={{
            display: 'grid', gridTemplateColumns: '1fr 1fr auto',
            padding: '2px 12px', fontSize: 10, fontFamily: 'monospace',
            background: iface.status === 'up' ? '#0a1520' : 'transparent',
          }}>
            <span style={{ color: '#6a9ad4', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {iface.name.replace('GigabitEthernet', 'Gi').replace('FastEthernet', 'Fa').replace('Ethernet', 'Eth')}
            </span>
            <span style={{ color: iface.ip ? '#d0d0d0' : '#333355' }}>
              {iface.ip ? `${iface.ip}/${maskToPrefixLen(iface.subnet_mask)}` : '—'}
            </span>
            <span style={{ color: STATUS_COLOR[iface.status] || '#555', fontSize: 9 }}>
              {STATUS_LABEL[iface.status] || iface.status}
            </span>
          </div>
        ))}
      </div>
      <div style={{ padding: '4px 12px 6px', borderTop: '1px solid #111a30' }}>
        <span style={{ fontSize: 9, color: '#3a3a60' }}>
          {device.interfaces.filter(i => i.connected_to).length} cable(s) connected
          {' · '}{device.interfaces.filter(i => i.status === 'up').length} port(s) up
        </span>
      </div>
    </div>
  )
}

// ── Port picker modal ─────────────────────────────────────────────────────────

function PortPicker({ srcDevice, dstDevice, onConnect, onCancel }) {
  const srcFree = srcDevice.interfaces.filter(i => !i.connected_to)
  const dstFree = dstDevice.interfaces.filter(i => !i.connected_to)
  const [srcPort, setSrcPort] = useState(srcFree[0]?.name ?? '')
  const [dstPort, setDstPort] = useState(dstFree[0]?.name ?? '')

  const noSrc = srcFree.length === 0
  const noDst = dstFree.length === 0

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1500,
      background: 'rgba(0,0,0,0.6)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }} onClick={onCancel}>
      <div
        style={{
          background: '#0d1226', border: '1px solid #2a5298', borderRadius: 10,
          padding: '24px 28px', minWidth: 320, boxShadow: '0 8px 40px rgba(0,0,0,0.7)',
        }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ fontSize: 11, color: '#4a90e2', fontWeight: 700, letterSpacing: 1.5, marginBottom: 16 }}>
          CONNECT CABLE
        </div>

        {(noSrc || noDst) ? (
          <>
            <div style={{ color: '#ff5555', fontSize: 12, marginBottom: 16 }}>
              No free ports on <strong>{noSrc ? srcDevice.hostname : dstDevice.hostname}</strong>.
            </div>
            <button
              style={{
                padding: '6px 18px', background: '#1a1a3e', color: '#888',
                border: '1px solid #2a2a4a', borderRadius: 4, cursor: 'pointer', fontSize: 12,
              }}
              onClick={onCancel}
            >
              Cancel
            </button>
          </>
        ) : (
          <>
            <PortRow label={srcDevice.hostname} ports={srcFree} value={srcPort} onChange={setSrcPort} />
            <div style={{ textAlign: 'center', color: '#2a5298', fontSize: 18, margin: '8px 0' }}>↕</div>
            <PortRow label={dstDevice.hostname} ports={dstFree} value={dstPort} onChange={setDstPort} />

            <div style={{ display: 'flex', gap: 8, marginTop: 20, justifyContent: 'flex-end' }}>
              <button
                style={{
                  padding: '6px 16px', background: 'transparent', color: '#666',
                  border: '1px solid #2a2a4a', borderRadius: 4, cursor: 'pointer', fontSize: 12,
                }}
                onMouseEnter={e => { e.currentTarget.style.color = '#d0d0d0' }}
                onMouseLeave={e => { e.currentTarget.style.color = '#666' }}
                onClick={onCancel}
              >
                Cancel
              </button>
              <button
                style={{
                  padding: '6px 20px', background: '#2a5298', color: '#e0e0e0',
                  border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 12, fontWeight: 700,
                }}
                onMouseEnter={e => { e.currentTarget.style.background = '#3a6ab8' }}
                onMouseLeave={e => { e.currentTarget.style.background = '#2a5298' }}
                onClick={() => onConnect(
                  srcDevice.id + ':' + srcPort,
                  dstDevice.id + ':' + dstPort,
                )}
              >
                Connect
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function PortRow({ label, ports, value, onChange }) {
  return (
    <div style={{ marginBottom: 4 }}>
      <div style={{ fontSize: 10, color: '#4a90e2', marginBottom: 4, fontFamily: 'monospace' }}>{label}</div>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        style={{
          width: '100%', background: '#07070d', color: '#e0e0e0',
          border: '1px solid #2a5298', borderRadius: 4, padding: '4px 8px',
          fontSize: 12, fontFamily: 'monospace',
        }}
      >
        {ports.map(p => (
          <option key={p.name} value={p.name}>{p.name}</option>
        ))}
      </select>
    </div>
  )
}

// ── Per-device draggable node ─────────────────────────────────────────────────

function DeviceNode({ device, placement, isSelected, onSelect, onCtxMenu, onHover, onLeave, wireMode, onWireConnect }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: device.id,
    data: { type: 'placed', deviceId: device.id },
    disabled: !!wireMode,
  })

  const Icon      = ICONS[device.type] || (() => null)
  const isPowered = !!device.powered
  const hasUp     = device.interfaces.some(i => i.status === 'up')
  const isWireSrc = wireMode?.srcDeviceId === device.id
  const isIsp     = device.type === 'isp'

  const borderColor = isIsp       ? (isWireSrc ? '#f1fa8c' : isSelected ? '#00e5ff' : '#00bcd4')
    : isWireSrc      ? '#f1fa8c'
    : !isPowered     ? '#1a1a2a'
    : isSelected     ? '#4a90e2'
    : hasUp          ? '#1e5c3a'
    : '#1a1a3e'

  const style = {
    position: 'absolute',
    left: placement.x + (transform?.x ?? 0),
    top:  placement.y + (transform?.y ?? 0),
    width: W, height: H,
    opacity: isDragging ? 0.4 : isPowered ? 1 : 0.55,
    cursor: wireMode
      ? (isWireSrc ? 'not-allowed' : 'crosshair')
      : isDragging ? 'grabbing' : 'grab',
    zIndex: isSelected ? 10 : 5,
    userSelect: 'none',
    touchAction: 'none',
  }

  function handleClick(e) {
    e.stopPropagation()
    if (wireMode && !isWireSrc) { onWireConnect(device.id); return }
    if (!wireMode) onSelect()
  }

  function handleCtxMenu(e) {
    e.preventDefault(); e.stopPropagation()
    if (!wireMode) onCtxMenu(e)
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...(wireMode ? {} : { ...listeners, ...attributes })}
      onClick={handleClick}
      onContextMenu={handleCtxMenu}
      onMouseEnter={e => onHover(e.clientX, e.clientY)}
      onMouseLeave={onLeave}
    >
      <div style={{
        width: '100%', height: '100%',
        background: isWireSrc ? '#1c1a08' : isSelected ? '#12254a' : '#0d1226',
        border: `2px solid ${borderColor}`,
        borderRadius: 6,
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        justifyContent: 'center', gap: 2,
        boxShadow: isWireSrc
          ? '0 0 12px #f1fa8c40'
          : isSelected ? '0 0 10px #4a90e240' : 'none',
        padding: '4px 0',
      }}>
        <div style={{ opacity: isPowered ? 1 : 0.4 }}>
          <Icon />
        </div>
        <div style={{ fontSize: 11, fontFamily: 'monospace', color: isPowered ? '#d0d0d0' : '#3a3a5a', marginTop: 2 }}>
          {device.hostname}
        </div>
        {isIsp ? (
          <div style={{ fontSize: 9, color: '#00bcd4', letterSpacing: 1.5, fontWeight: 700, marginTop: 2 }}>
            INTERNET
          </div>
        ) : !isPowered ? (
          <div style={{ fontSize: 9, color: '#ff5555', letterSpacing: 0.5, fontWeight: 700, opacity: 0.7 }}>
            OFFLINE — right-click to power on
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 3, marginTop: 1 }}>
            {device.interfaces.slice(0, 8).map(iface => (
              <div
                key={iface.name}
                title={`${iface.name}: ${iface.status}${iface.ip ? ' ' + iface.ip : ''}`}
                style={{
                  width: 6, height: 6, borderRadius: '50%',
                  background: iface.status === 'up' ? '#50fa7b'
                    : iface.status === 'admin_down' ? '#2a2a40' : '#ffb86c',
                }}
              />
            ))}
            {device.interfaces.length > 8 && (
              <span style={{ fontSize: 9, color: '#555', lineHeight: '6px' }}>+{device.interfaces.length - 8}</span>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Cable + ping layers ───────────────────────────────────────────────────────

// Cable health states:
//   up         — both ends up: solid blue
//   down       — connected but link not established (run no shutdown / ip link set up): amber dashed
//   admin_down — at least one end is administratively shut: near-invisible grey dashed
function _cableState(iface, remoteIface) {
  if (iface.status === 'up' && remoteIface?.status === 'up') return 'up'
  if (iface.status === 'admin_down' || remoteIface?.status === 'admin_down') return 'admin_down'
  return 'down'
}

function CableLayer({ devices, placements }) {
  const seen = new Set()
  const cables = []
  for (const dev of devices) {
    if (!placements[dev.id]) continue
    for (const iface of dev.interfaces) {
      if (!iface.connected_to) continue
      const key = [dev.id + ':' + iface.name, iface.connected_to].sort().join('|')
      if (seen.has(key)) continue
      seen.add(key)
      const remoteDevId  = iface.connected_to.slice(0, iface.connected_to.indexOf(':'))
      const remoteIfName = iface.connected_to.slice(iface.connected_to.indexOf(':') + 1)
      const remoteDev    = devices.find(d => d.id === remoteDevId)
      if (!remoteDev || !placements[remoteDevId]) continue
      const remoteIface = remoteDev.getInterface(remoteIfName)
      const state = _cableState(iface, remoteIface)
      const { x: x1, y: y1 } = center(placements[dev.id])
      const { x: x2, y: y2 } = center(placements[remoteDevId])
      cables.push({ key, x1, y1, x2, y2, state })
    }
  }
  return (
    <>
      {cables.map(c => (
        <line
          key={c.key} x1={c.x1} y1={c.y1} x2={c.x2} y2={c.y2}
          stroke={c.state === 'up' ? '#2a5298' : c.state === 'down' ? '#c05800' : '#161625'}
          strokeWidth={c.state === 'up' ? 2.5 : 2}
          strokeDasharray={c.state === 'up' ? undefined : '6 3'}
          strokeOpacity={c.state === 'admin_down' ? 0.45 : 1}
          strokeLinecap="round"
        />
      ))}
    </>
  )
}

function PingLayer({ pingAnimations, placements }) {
  return pingAnimations.flatMap(ping => {
    const waypoints = (ping.pathDevIds || [])
      .map(devId => placements[devId])
      .filter(Boolean)
      .map(p => center(p))
    if (waypoints.length < 2) return []
    const fwd = <PingDot key={`${ping.id}-fwd`} waypoints={waypoints} success={ping.success} startTime={ping.id} isReply={false} />
    if (!ping.success) return [fwd]
    // ICMP Echo Reply departs the destination the moment the request arrives (PING_TRAVEL_MS).
    const rev = <PingDot key={`${ping.id}-ret`} waypoints={[...waypoints].reverse()} success={true} startTime={ping.id + PING_TRAVEL_MS} isReply={true} />
    return [fwd, rev]
  })
}

function PingDot({ waypoints, success, startTime, isReply }) {
  const [state, setState] = useState({ x: waypoints[0].x, y: waypoints[0].y, opacity: 1 })
  const rafRef = useRef()

  useEffect(() => {
    const TOTAL_MS = PING_TRAVEL_MS + PING_FADE_MS
    const segs     = waypoints.length - 1

    function frame() {
      const elapsed = performance.now() - startTime
      // startTime may be in the future (return packet waits for request to arrive)
      if (elapsed < 0) {
        rafRef.current = requestAnimationFrame(frame)
        return
      }

      const tTotal  = Math.min(elapsed / TOTAL_MS, 1)
      const tTravel = Math.min(elapsed / PING_TRAVEL_MS, 1)

      // Which segment of the path are we on?
      const segFrac = tTravel * segs
      const segIdx  = Math.min(Math.floor(segFrac), segs - 1)
      const segT    = segFrac - segIdx
      const p1      = waypoints[segIdx]
      const p2      = waypoints[segIdx + 1]

      const x       = p1.x + (p2.x - p1.x) * segT
      const y       = p1.y + (p2.y - p1.y) * segT
      const opacity = tTravel >= 1
        ? Math.max(0, 1 - (elapsed - PING_TRAVEL_MS) / PING_FADE_MS)
        : 1

      setState({ x, y, opacity })
      if (tTotal < 1) rafRef.current = requestAnimationFrame(frame)
    }

    rafRef.current = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(rafRef.current)
  }, [startTime]) // eslint-disable-line react-hooks/exhaustive-deps

  // Echo Request: green. Echo Reply: cyan — visually distinct so the return path is obvious.
  const color = !success ? '#ff5555' : isReply ? '#8be9fd' : '#50fa7b'
  return (
    <g>
      <circle cx={state.x} cy={state.y} r={9}  fill={color} opacity={state.opacity * 0.25}/>
      <circle cx={state.x} cy={state.y} r={5}  fill={color} opacity={state.opacity}/>
    </g>
  )
}

// ── Wire-mode overlay (live dashed line + pulsing rings) ──────────────────────

function WireLayer({ wireMode, placements, mousePos, wireHoverDeviceId }) {
  if (!wireMode) return null
  const srcP = placements[wireMode.srcDeviceId]
  if (!srcP) return null
  const { x: sx, y: sy } = center(srcP)
  const dstP = wireHoverDeviceId ? placements[wireHoverDeviceId] : null
  const { x: ex, y: ey } = dstP ? center(dstP) : mousePos
  return (
    <>
      {/* Pulsing ring on source */}
      <circle cx={sx} cy={sy} r="52" fill="none" stroke="#f1fa8c" strokeWidth="2">
        <animate attributeName="r" values="44;58;44" dur="1.2s" repeatCount="indefinite"/>
        <animate attributeName="opacity" values="0.6;0.1;0.6" dur="1.2s" repeatCount="indefinite"/>
      </circle>
      {/* Pulsing ring on hover target */}
      {dstP && (
        <circle cx={ex} cy={ey} r="52" fill="none" stroke="#50fa7b" strokeWidth="2">
          <animate attributeName="r" values="44;58;44" dur="1.2s" repeatCount="indefinite"/>
          <animate attributeName="opacity" values="0.6;0.1;0.6" dur="1.2s" repeatCount="indefinite"/>
        </circle>
      )}
      {/* Live dashed wire */}
      <line
        x1={sx} y1={sy} x2={ex} y2={ey}
        stroke="#4a90e2" strokeWidth="2" strokeDasharray="8 5"
        strokeLinecap="round" opacity="0.8"
      />
    </>
  )
}

// ── Main Floorplan ────────────────────────────────────────────────────────────

export default function Floorplan() {
  const {
    devices, placements, selectedDeviceId, setSelectedDeviceId,
    pingAnimations, wireMode, setWireMode, connectInterfaces, getDevice,
    powerAllDevices,
  } = useGame()

  const [ctxMenu,          setCtxMenu]          = useState(null)
  const [hovered,          setHovered]          = useState(null) // { device, clientX, clientY }
  const [wireHoverDevId,   setWireHoverDevId]   = useState(null)
  const [portPicker,       setPortPicker]       = useState(null) // { srcDeviceId, dstDeviceId }
  const [mousePos,         setMousePos]         = useState({ x: 0, y: 0 })
  const floorplanRef = useRef(null)

  // Close context menu on any mousedown outside it (bubbling phase).
  // Using a document listener instead of a z-index overlay means underlying elements
  // (including the xterm textarea) receive their pointerdown first and stay focusable.
  useEffect(() => {
    if (!ctxMenu) return
    function onMouseDown() { setCtxMenu(null) }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [ctxMenu])

  const placed = devices.filter(d => placements[d.id])
  const { isOver, setNodeRef } = useDroppable({ id: 'floorplan' })

  // Combine droppable ref + local ref
  function setRefs(el) {
    floorplanRef.current = el
    setNodeRef(el)
  }

  // Escape cancels wire mode
  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') { setWireMode(null); setPortPicker(null) }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [setWireMode])

  function handleMouseMove(e) {
    if (!wireMode || !floorplanRef.current) return
    const rect = floorplanRef.current.getBoundingClientRect()
    setMousePos({ x: e.clientX - rect.left, y: e.clientY - rect.top })
  }

  function handleBackgroundClick() {
    setSelectedDeviceId(null)
    if (wireMode) { setWireMode(null); return }
    setCtxMenu(null)
  }

  function attemptWireConnect(dstDeviceId) {
    if (!wireMode) return
    const srcDev = getDevice(wireMode.srcDeviceId)
    const dstDev = getDevice(dstDeviceId)
    if (!srcDev || !dstDev) { setWireMode(null); return }
    const srcFree = srcDev.interfaces.filter(i => !i.connected_to)
    const dstFree = dstDev.interfaces.filter(i => !i.connected_to)
    setWireMode(null)
    if (srcFree.length === 1 && dstFree.length === 1) {
      connectInterfaces(srcDev.id + ':' + srcFree[0].name, dstDev.id + ':' + dstFree[0].name)
    } else {
      setPortPicker({ srcDeviceId: srcDev.id, dstDeviceId: dstDev.id })
    }
  }

  function handlePortPickerConnect(ifaceId1, ifaceId2) {
    connectInterfaces(ifaceId1, ifaceId2)
    setPortPicker(null)
  }

  function handleHover(device, clientX, clientY) {
    setHovered({ device, clientX, clientY })
    if (wireMode && device.id !== wireMode.srcDeviceId) setWireHoverDevId(device.id)
  }

  function handleLeave() {
    setHovered(null)
    setWireHoverDevId(null)
  }

  return (
    <div
      ref={setRefs}
      style={{
        position: 'relative', flex: 1, overflow: 'hidden',
        background: '#0d0d1a',
        backgroundImage: 'radial-gradient(circle, #151530 1px, transparent 1px)',
        backgroundSize: '28px 28px',
        outline: isOver ? '2px solid #2a5298' : 'none',
        outlineOffset: -2,
        cursor: wireMode ? 'crosshair' : 'default',
      }}
      onClick={handleBackgroundClick}
      onContextMenu={e => e.preventDefault()}
      onMouseMove={handleMouseMove}
    >
      {/* Cable layer */}
      <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 1 }}>
        <CableLayer devices={placed} placements={placements} />
      </svg>

      {/* Device nodes */}
      {placed.map(device => (
        <DeviceNode
          key={device.id}
          device={device}
          placement={placements[device.id]}
          isSelected={device.id === selectedDeviceId}
          onSelect={() => setSelectedDeviceId(device.id)}
          onCtxMenu={e => setCtxMenu({ x: e.clientX, y: e.clientY, deviceId: device.id })}
          onHover={(cx, cy) => handleHover(device, cx, cy)}
          onLeave={handleLeave}
          wireMode={wireMode}
          onWireConnect={attemptWireConnect}
        />
      ))}

      {/* Wire mode overlay */}
      <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 15 }}>
        <WireLayer
          wireMode={wireMode}
          placements={placements}
          mousePos={mousePos}
          wireHoverDeviceId={wireHoverDevId}
        />
      </svg>

      {/* Ping animation layer */}
      <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 20 }}>
        <PingLayer pingAnimations={pingAnimations} placements={placements} />
      </svg>

      {placed.length === 0 && !wireMode && (
        <div style={{
          position: 'absolute', top: '50%', left: '50%',
          transform: 'translate(-50%,-50%)',
          color: '#1e1e35', fontSize: 14, textAlign: 'center', pointerEvents: 'none',
        }}>
          <div style={{ fontSize: 52, marginBottom: 10 }}>◈</div>
          Buy devices, then drag from Inventory or click <strong style={{ color: '#252545' }}>Place</strong>
        </div>
      )}

      {/* Power All On button — shown when any placed non-ISP device is offline */}
      {placed.some(d => !d.powered && d.type !== 'isp') && !wireMode && (
        <div style={{ position: 'absolute', top: 10, right: 10, zIndex: 50 }}>
          <button
            style={{
              padding: '5px 12px', fontSize: 10, fontWeight: 700, letterSpacing: 0.5,
              background: '#0d1a00', color: '#50fa7b',
              border: '1px solid #1e4400', borderRadius: 4, cursor: 'pointer',
              boxShadow: '0 2px 8px rgba(0,0,0,0.5)',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = '#162800' }}
            onMouseLeave={e => { e.currentTarget.style.background = '#0d1a00' }}
            onClick={e => { e.stopPropagation(); powerAllDevices() }}
          >
            Power All On
          </button>
        </div>
      )}

      {/* Wire mode hint banner */}
      {wireMode && (
        <div style={{
          position: 'absolute', top: 10, left: '50%', transform: 'translateX(-50%)',
          background: '#0d1226', border: '1px solid #4a90e2', borderRadius: 6,
          padding: '6px 16px', fontSize: 11, color: '#4a90e2',
          pointerEvents: 'none', zIndex: 50, letterSpacing: 0.5,
          boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
        }}>
          Click a device to connect — <span style={{ color: '#555' }}>Esc to cancel</span>
        </div>
      )}

      {/* Context menu */}
      {ctxMenu && (
        <ContextMenu x={ctxMenu.x} y={ctxMenu.y} deviceId={ctxMenu.deviceId} onClose={() => setCtxMenu(null)} />
      )}

      {/* Hover tooltip */}
      {hovered && !ctxMenu && (
        <DeviceTooltip device={hovered.device} x={hovered.clientX + 16} y={hovered.clientY - 40} />
      )}

      {/* Port picker modal */}
      {portPicker && (
        <PortPicker
          srcDevice={getDevice(portPicker.srcDeviceId)}
          dstDevice={getDevice(portPicker.dstDeviceId)}
          onConnect={handlePortPickerConnect}
          onCancel={() => setPortPicker(null)}
        />
      )}
    </div>
  )
}
