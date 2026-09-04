/**
 * BrowserPanel — network-gated browser inside the Admin Laptop.
 *
 * IMPORTANT (see docs/ADMIN_LAPTOP_AND_TOOLS.md):
 *   "If the laptop is a floating panel that always works, the lesson is deleted."
 *
 * Every navigation is checked against the real engine:
 *   topology.checkPing(laptopIp, targetIp, { protocol: 'tcp', port: 443 })
 *
 * Only if that passes does the web UI render. Otherwise the correct browser error
 * page is shown — blocked by firewall = ERR_CONNECTION_TIMED_OUT (silent drop),
 * not routable / no gateway / vlan_isolated = same, unreachable = same.
 *
 * "Reached host, no web management listener" → ERR_CONNECTION_REFUSED (Phase 2:
 *   once services[] is modelled this will be explicit. For now: firewall/router
 *   devices are assumed to have a management listener on tcp/443; other device
 *   types return a REFUSED error).
 */

import { useState, useRef } from 'react'
import { useGame } from '../state/GameContext.jsx'
import FirewallWebUI from './FirewallWebUI.jsx'

// ── Reachability check ────────────────────────────────────────────────────────
const MGMT_SERVICE = { protocol: 'tcp', port: 443 }

function checkAccess(topology, laptopIp, targetIp) {
  if (!laptopIp)   return { ok: false, reason: 'no_laptop_ip' }
  if (!targetIp)   return { ok: false, reason: 'no_target'    }
  const result = topology.checkPing(laptopIp, targetIp, MGMT_SERVICE)
  if (result.reachable) return { ok: true }
  return { ok: false, reason: result.failureReason ?? 'no_route' }
}

// ── IP lookup helpers ──────────────────────────────────────────────────────────
function findDeviceByIp(devices, ip) {
  for (const dev of devices) {
    for (const iface of (dev.interfaces ?? [])) {
      if (iface.ip === ip) return dev
    }
  }
  return null
}

function getLaptopIp(laptopDevice) {
  if (!laptopDevice) return null
  for (const iface of (laptopDevice.interfaces ?? [])) {
    if (iface.ip) return iface.ip
  }
  return null
}

// ── Quick address-bar suggestions (device IPs) ────────────────────────────────
function getDeviceIps(devices) {
  const list = []
  for (const dev of devices) {
    if (dev.type === 'laptop') continue  // skip self
    for (const iface of (dev.interfaces ?? [])) {
      if (iface.ip) list.push({ ip: iface.ip, label: `${dev.name ?? dev.hostname} (${iface.name})`, dev })
    }
  }
  return list
}

// ── Error pages ───────────────────────────────────────────────────────────────

function LaptopNotConfiguredPage({ laptopDevice }) {
  const hasLaptop = !!laptopDevice
  const powered   = laptopDevice?.powered
  return (
    <div style={{ padding: 40, fontFamily: 'monospace', textAlign: 'center', color: '#9ab' }}>
      <div style={{ fontSize: 40, marginBottom: 16 }}>🔌</div>
      <div style={{ fontSize: 18, fontWeight: 700, color: '#e08050', marginBottom: 8 }}>
        Admin Laptop — Not on network
      </div>
      <div style={{ fontSize: 11, color: '#668', maxWidth: 420, margin: '0 auto', lineHeight: 1.8 }}>
        {!hasLaptop && 'No laptop device found. Accept a mission or clear the sandbox to create one.'}
        {hasLaptop && !powered && (
          <>
            The laptop (<strong style={{ color: '#9ab' }}>{laptopDevice.hostname}</strong>) is powered off.<br />
            Right-click it on the floorplan and select <strong>Power On</strong>.
          </>
        )}
        {hasLaptop && powered && (
          <>
            The laptop is powered on but has no IP address.<br />
            Open its terminal and run <code style={{ color: '#8eda8e' }}>ip addr add &lt;IP&gt;/&lt;prefix&gt; dev Ethernet0/0</code><br />
            or <code style={{ color: '#8eda8e' }}>dhclient Ethernet0/0</code>, then set a default gateway.
          </>
        )}
      </div>
      <div style={{ marginTop: 20, fontSize: 9, color: '#334', lineHeight: 1.7 }}>
        The browser uses the laptop's real IP to check reachability via the engine.<br />
        If the engine says "no route", so does the browser.
      </div>
    </div>
  )
}

function ErrorPage({ url, reason, failurePoint }) {
  const isFirewallBlock = reason === 'blocked_by_firewall'
  const title = 'ERR_CONNECTION_TIMED_OUT'

  const hint = {
    blocked_by_firewall: `A firewall policy silently dropped the TCP/443 connection.${failurePoint ? ` (dropped at: ${failurePoint})` : ''}\nCheck the firewall rules — a PERMIT from-zone … to-zone … service HTTPS rule is needed.`,
    no_route:            'No route to host. Check that the laptop has a default gateway configured.',
    host_no_gateway:     'The laptop has no default gateway. Add one with: ip route add default via <gateway-ip>',
    vlan_isolated:       'The laptop is in a different VLAN and there is no inter-VLAN routing path.',
    admin_down:          'An interface along the path is administratively shut down.',
    link_down:           'A cable is missing or a device is powered off along the path.',
    nat_required:        'NAT is required but not configured for this path.',
  }[reason] ?? `Engine failure reason: ${reason}`

  return (
    <div style={{ padding: 40, fontFamily: 'sans-serif', textAlign: 'center', color: '#9ab' }}>
      <div style={{ fontSize: 40, marginBottom: 16 }}>🚫</div>
      <div style={{ fontSize: 18, fontWeight: 700, color: '#cc4444', marginBottom: 6 }}>
        This site can't be reached
      </div>
      <div style={{ fontSize: 13, color: '#778', marginBottom: 6 }}>
        <strong style={{ fontFamily: 'monospace' }}>{url}</strong>
      </div>
      <div style={{ fontSize: 12, fontFamily: 'monospace', background: '#0a1520', marginBottom: 16,
        display: 'inline-block', padding: '4px 12px', borderRadius: 4, color: '#cc8888' }}>
        {title}
      </div>
      <div style={{ marginTop: 16, fontSize: 11, color: '#445', maxWidth: 420,
        margin: '16px auto 0', lineHeight: 1.7, textAlign: 'left',
        background: '#0a1520', border: '1px solid #1a2a3e', borderRadius: 6, padding: 16 }}>
        <strong style={{ color: isFirewallBlock ? '#e08050' : '#668' }}>
          {isFirewallBlock ? '⛔ Blocked by firewall' : '🔌 Network unreachable'}
        </strong>
        <br />
        {hint.split('\n').map((line, i) => <span key={i}>{line}<br /></span>)}
      </div>
      <div style={{ marginTop: 16, fontSize: 9, color: '#334' }}>
        The browser called topology.checkPing(laptopIp, {url}, tcp/443) — engine returned: <em>{reason}</em>
      </div>
    </div>
  )
}

function RefusedPage({ url }) {
  return (
    <div style={{ padding: 40, fontFamily: 'sans-serif', textAlign: 'center', color: '#9ab' }}>
      <div style={{ fontSize: 40, marginBottom: 16 }}>🚧</div>
      <div style={{ fontSize: 18, fontWeight: 700, color: '#cc8844', marginBottom: 6 }}>
        This site can't be reached
      </div>
      <div style={{ fontSize: 12, color: '#778', marginBottom: 16 }}>
        <strong style={{ fontFamily: 'monospace' }}>{url}</strong>
      </div>
      <div style={{ fontSize: 12, fontFamily: 'monospace', background: '#0a1520',
        display: 'inline-block', padding: '4px 12px', borderRadius: 4, color: '#cc8844' }}>
        ERR_CONNECTION_REFUSED
      </div>
      <div style={{ marginTop: 16, fontSize: 11, color: '#445', maxWidth: 420,
        margin: '16px auto 0', lineHeight: 1.7, textAlign: 'left',
        background: '#0a1520', border: '1px solid #1a2a3e', borderRadius: 6, padding: 16 }}>
        <strong style={{ color: '#668' }}>TCP connection refused (port 443)</strong><br />
        The host is reachable but nothing is listening on port 443.<br />
        This device type does not have a web management interface.<br />
        <span style={{ color: '#334', fontSize: 9 }}>
          (Phase 2: services[] will make this explicit per-device)
        </span>
      </div>
    </div>
  )
}

// ── Device info page (for routers — basic management) ─────────────────────────
function DeviceInfoPage({ device }) {
  return (
    <div style={{ padding: 24, fontFamily: 'monospace', color: '#9ab' }}>
      <div style={{ fontSize: 18, fontWeight: 700, color: '#4a90e2', marginBottom: 4 }}>
        {device.hostname}
      </div>
      <div style={{ fontSize: 11, color: '#668', marginBottom: 20 }}>
        {device.type.toUpperCase()} — management interface
      </div>
      <table style={{ fontSize: 11, borderCollapse: 'collapse', width: '100%', maxWidth: 600 }}>
        <thead>
          <tr>
            {['Interface', 'IP Address', 'Mask', 'Status'].map(h => (
              <th key={h} style={thStyle}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {(device.interfaces ?? []).map(iface => (
            <tr key={iface.name}>
              <td style={tdStyle}>{iface.name}</td>
              <td style={tdStyle}>{iface.ip ?? '—'}</td>
              <td style={tdStyle}>{iface.subnet_mask ?? '—'}</td>
              <td style={{ ...tdStyle, color: iface.status === 'up' ? '#6f6' : iface.status === 'admin_down' ? '#f66' : '#668' }}>
                {iface.status === 'up' ? 'up/up' : iface.status === 'admin_down' ? 'admin-down' : 'down'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ marginTop: 24, fontSize: 10, color: '#334', fontStyle: 'italic' }}>
        Use the CLI terminal (right-click on floorplan) to configure this device.
      </div>
    </div>
  )
}

// ── Suggestions dropdown ──────────────────────────────────────────────────────
function Suggestions({ items, onSelect }) {
  if (!items.length) return null
  return (
    <div style={{
      position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 100,
      background: '#0d1a2a', border: '1px solid #2a3a4e', borderTop: 'none',
      borderRadius: '0 0 4px 4px', maxHeight: 200, overflowY: 'auto',
    }}>
      {items.map(({ ip, label }) => (
        <div
          key={ip + label}
          onMouseDown={() => onSelect(ip)}
          style={{ padding: '5px 12px', fontSize: 11, cursor: 'pointer', color: '#9ab' }}
          onMouseEnter={e => e.currentTarget.style.background = '#1a2a3e'}
          onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
        >
          <span style={{ fontFamily: 'monospace', color: '#4a90e2', marginRight: 8 }}>{ip}</span>
          <span style={{ color: '#556', fontSize: 10 }}>{label}</span>
        </div>
      ))}
    </div>
  )
}

// ── BrowserPanel ──────────────────────────────────────────────────────────────
export default function BrowserPanel() {
  const { devices, topology, laptopDevice, tick } = useGame()

  const [addressBar,  setAddressBar]  = useState('')
  const [currentUrl,  setCurrentUrl]  = useState('')
  const [pageState,   setPageState]   = useState(null)   // { type, device?, reason?, failurePoint? }
  const [history,     setHistory]     = useState([])
  const [histIdx,     setHistIdx]     = useState(-1)
  const [showSuggest, setShowSuggest] = useState(false)
  const inputRef = useRef(null)

  const laptopIp = getLaptopIp(laptopDevice)
  const allIps   = getDeviceIps(devices)
  const suggestions = addressBar
    ? allIps.filter(e => e.ip.startsWith(addressBar) || e.label.toLowerCase().includes(addressBar.toLowerCase()))
    : allIps.slice(0, 8)

  function navigate(rawUrl) {
    const url = rawUrl.trim().replace(/^https?:\/\//i, '')
    if (!url) return
    setAddressBar(url)
    setCurrentUrl(url)
    setShowSuggest(false)
    inputRef.current?.blur()

    // Push to history
    setHistory(h => {
      const trimmed = h.slice(0, histIdx + 1)
      return [...trimmed, url]
    })
    setHistIdx(i => i + 1)

    // Resolve the target device
    const targetDevice = findDeviceByIp(devices, url)

    // Check network reachability (the core lesson)
    const access = checkAccess(topology, laptopIp, url)
    if (!access.ok) {
      setPageState({ type: 'error', url, reason: access.reason })
      return
    }

    if (!targetDevice) {
      // Reachable IP but no device at that address in our topology
      // (could be internet — which shouldn't be reachable via tcp/443 without special config)
      setPageState({ type: 'error', url, reason: 'no_route' })
      return
    }

    // Device found and reachable. Does it have a web management interface?
    if (targetDevice.type === 'firewall') {
      setPageState({ type: 'firewall', device: targetDevice })
    } else if (targetDevice.type === 'router') {
      setPageState({ type: 'router', device: targetDevice })
    } else {
      // Device is reachable but has no web management listener
      setPageState({ type: 'refused', url })
    }
  }

  function goBack() {
    if (histIdx > 0) {
      const next = histIdx - 1
      setHistIdx(next)
      navigate(history[next])
    }
  }
  function goForward() {
    if (histIdx < history.length - 1) {
      const next = histIdx + 1
      setHistIdx(next)
      navigate(history[next])
    }
  }

  function renderPage() {
    if (!currentUrl) {
      return (
        <div style={{ padding: 40, textAlign: 'center', color: '#334', fontFamily: 'monospace' }}>
          <div style={{ fontSize: 32, marginBottom: 16 }}>🌐</div>
          <div style={{ fontSize: 12, color: '#4a6', marginBottom: 6 }}>
            {laptopIp
              ? <>Laptop IP: <strong style={{ color: '#9ab' }}>{laptopIp}</strong></>
              : <span style={{ color: '#664' }}>⚠ Laptop has no IP — configure it on the floorplan first</span>
            }
          </div>
          <div style={{ fontSize: 11, color: '#446', marginBottom: 24 }}>
            Type a device IP address in the address bar to open its management interface.
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center' }}>
            {allIps.slice(0, 8).map(({ ip, label }) => (
              <button
                key={ip}
                onClick={() => navigate(ip)}
                style={{ padding: '6px 12px', fontSize: 10, background: '#0d1a2a',
                  color: '#4a90e2', border: '1px solid #1a2a3e', borderRadius: 4, cursor: 'pointer' }}
              >
                {ip}
                <span style={{ color: '#446', marginLeft: 4, fontSize: 9 }}>{label}</span>
              </button>
            ))}
          </div>
        </div>
      )
    }

    if (!laptopIp) return <LaptopNotConfiguredPage laptopDevice={laptopDevice} />

    switch (pageState?.type) {
      case 'error':    return <ErrorPage url={pageState.url} reason={pageState.reason} failurePoint={pageState.failurePoint} />
      case 'refused':  return <RefusedPage url={pageState.url} />
      case 'firewall': return <FirewallWebUI device={pageState.device} />
      case 'router':   return <DeviceInfoPage device={pageState.device} />
      default:         return null
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#0a0f18' }}>

      {/* ── Chrome-style toolbar ──────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px',
        background: '#0d1520', borderBottom: '1px solid #1a2a3e', flexShrink: 0 }}>

        <button onClick={goBack}    disabled={histIdx <= 0}               style={navBtn(histIdx <= 0)}>‹</button>
        <button onClick={goForward} disabled={histIdx >= history.length - 1} style={navBtn(histIdx >= history.length - 1)}>›</button>

        {/* Laptop IP status pill */}
        <span style={{
          fontSize: 9, padding: '2px 6px', borderRadius: 3, fontFamily: 'monospace', flexShrink: 0,
          background: laptopIp ? '#0a1e0a' : '#1e0a0a',
          color:      laptopIp ? '#5a8a5a' : '#8a3a3a',
          border: `1px solid ${laptopIp ? '#1a3a1a' : '#3a1a1a'}`,
        }}>
          {laptopIp ? `🖥 ${laptopIp}` : '🖥 not configured'}
        </span>

        <div style={{ flex: 1, position: 'relative' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6,
            background: '#111c2a', border: '1px solid #2a3a4e', borderRadius: 16, padding: '3px 12px' }}>
            <span style={{ fontSize: 10, color: pageState?.type === 'firewall' || pageState?.type === 'router' ? '#5a8' : '#445' }}>
              {pageState?.type === 'firewall' || pageState?.type === 'router' ? '🔒' : '🌐'}
            </span>
            <input
              ref={inputRef}
              type="text"
              value={addressBar}
              onChange={e => { setAddressBar(e.target.value); setShowSuggest(true) }}
              onKeyDown={e => e.key === 'Enter' && navigate(addressBar)}
              onFocus={() => setShowSuggest(true)}
              onBlur={() => setTimeout(() => setShowSuggest(false), 150)}
              placeholder="Enter device IP (e.g. 10.1.0.1)…"
              style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none',
                fontSize: 11, color: '#9ab', fontFamily: 'monospace' }}
            />
            {addressBar && (
              <button onMouseDown={() => { setAddressBar(''); inputRef.current?.focus() }}
                style={{ background: 'none', border: 'none', color: '#446', cursor: 'pointer', fontSize: 12, padding: 0 }}>✕</button>
            )}
          </div>

          {showSuggest && suggestions.length > 0 && (
            <Suggestions items={suggestions} onSelect={navigate} />
          )}
        </div>

        <button onClick={() => currentUrl && navigate(currentUrl)} style={navBtn(false)} title="Reload">↻</button>
      </div>

      {/* ── Page area ────────────────────────────────────────────────────── */}
      <div style={{ flex: 1, overflowY: 'auto', background: '#0a0f18', color: '#c8d8e8' }}>
        {renderPage()}
      </div>
    </div>
  )
}

// ── Style helpers ─────────────────────────────────────────────────────────────
const thStyle = {
  padding: '5px 10px', textAlign: 'left', fontSize: 10,
  color: '#668', borderBottom: '1px solid #1a2a3e', fontWeight: 700,
}
const tdStyle = {
  padding: '4px 10px', fontSize: 11, borderBottom: '1px solid #0d1520', fontFamily: 'monospace',
}
function navBtn(disabled) {
  return {
    padding: '2px 8px', fontSize: 14, background: 'transparent',
    color: disabled ? '#223' : '#9ab', border: '1px solid #1a2a3e',
    borderRadius: 4, cursor: disabled ? 'default' : 'pointer',
  }
}
