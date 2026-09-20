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
    <div style={{ padding: 40, fontFamily: 'var(--font-mono)', textAlign: 'center', color: '#99acbb' }}>
      <div style={{ fontSize: 40, marginBottom: 16 }}>🔌</div>
      <div style={{ fontSize: 21, fontWeight: 700, color: '#e08050', marginBottom: 8 }}>
        Admin Laptop — Not on network
      </div>
      <div style={{ fontSize: 14, color: '#7e8c9e', maxWidth: 420, margin: '0 auto', lineHeight: 1.8 }}>
        {!hasLaptop && 'No laptop device found. Accept a mission or clear the sandbox to create one.'}
        {hasLaptop && !powered && (
          <>
            The laptop (<strong style={{ color: '#99acbb' }}>{laptopDevice.hostname}</strong>) is powered off.<br />
            Right-click it on the floorplan and select <strong>Power On</strong>.
          </>
        )}
        {hasLaptop && powered && (
          <>
            The laptop is powered on but has no IP address.<br />
            Open its terminal and run <code style={{ color: '#92d6b2' }}>ip addr add &lt;IP&gt;/&lt;prefix&gt; dev Ethernet0/0</code><br />
            or <code style={{ color: '#92d6b2' }}>dhclient Ethernet0/0</code>, then set a default gateway.
          </>
        )}
      </div>
      <div style={{ marginTop: 20, fontSize: 12, color: '#7291a6', lineHeight: 1.7 }}>
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
    <div style={{ padding: 40, fontFamily: 'var(--font-ui)', textAlign: 'center', color: '#99acbb' }}>
      <div style={{ fontSize: 40, marginBottom: 16 }}>🚫</div>
      <div style={{ fontSize: 21, fontWeight: 700, color: '#d76c6c', marginBottom: 6 }}>
        This site can't be reached
      </div>
      <div style={{ fontSize: 15.5, color: '#7590a3', marginBottom: 6 }}>
        <strong style={{ fontFamily: 'var(--font-mono)' }}>{url}</strong>
      </div>
      <div style={{ fontSize: 13, fontFamily: 'var(--font-mono)', background: '#0c151e', marginBottom: 16,
        display: 'inline-block', padding: '4px 12px', borderRadius: 4, color: '#cc8888' }}>
        {title}
      </div>
      <div style={{ marginTop: 16, fontSize: 14, color: '#7490a2', maxWidth: 420,
        margin: '16px auto 0', lineHeight: 1.7, textAlign: 'left',
        background: '#0c151e', border: '1px solid #202b33', borderRadius: 6, padding: 16 }}>
        <strong style={{ color: isFirewallBlock ? '#e08050' : '#7e8c9e' }}>
          {isFirewallBlock ? '⛔ Blocked by firewall' : '🔌 Network unreachable'}
        </strong>
        <br />
        {hint.split('\n').map((line, i) => <span key={i}>{line}<br /></span>)}
      </div>
      <div style={{ marginTop: 16, fontSize: 12, color: '#7291a6' }}>
        The browser called topology.checkPing(laptopIp, {url}, tcp/443) — engine returned: <em>{reason}</em>
      </div>
    </div>
  )
}

function RefusedPage({ url }) {
  return (
    <div style={{ padding: 40, fontFamily: 'var(--font-ui)', textAlign: 'center', color: '#99acbb' }}>
      <div style={{ fontSize: 40, marginBottom: 16 }}>🚧</div>
      <div style={{ fontSize: 21, fontWeight: 700, color: '#cc8844', marginBottom: 6 }}>
        This site can't be reached
      </div>
      <div style={{ fontSize: 14.5, color: '#7590a3', marginBottom: 16 }}>
        <strong style={{ fontFamily: 'var(--font-mono)' }}>{url}</strong>
      </div>
      <div style={{ fontSize: 13, fontFamily: 'var(--font-mono)', background: '#0c151e',
        display: 'inline-block', padding: '4px 12px', borderRadius: 4, color: '#cc8844' }}>
        ERR_CONNECTION_REFUSED
      </div>
      <div style={{ marginTop: 16, fontSize: 14, color: '#7490a2', maxWidth: 420,
        margin: '16px auto 0', lineHeight: 1.7, textAlign: 'left',
        background: '#0c151e', border: '1px solid #202b33', borderRadius: 6, padding: 16 }}>
        <strong style={{ color: '#7e8c9e' }}>TCP connection refused (port 443)</strong><br />
        The host is reachable but nothing is listening on port 443.<br />
        This device type does not have a web management interface.<br />
        <span style={{ color: '#7291a6', fontSize: 12 }}>
          (Phase 2: services[] will make this explicit per-device)
        </span>
      </div>
    </div>
  )
}

// ── Device info page (for routers — basic management) ─────────────────────────
function DeviceInfoPage({ device }) {
  return (
    <div style={{ padding: 24, fontFamily: 'var(--font-mono)', color: '#99acbb' }}>
      <div style={{ fontSize: 21, fontWeight: 700, color: '#4da6ff', marginBottom: 4 }}>
        {device.hostname}
      </div>
      <div style={{ fontSize: 14, color: '#7e8c9e', marginBottom: 20 }}>
        {device.type.toUpperCase()} — management interface
      </div>
      <table style={{ fontSize: 14, borderCollapse: 'collapse', width: '100%', maxWidth: 600 }}>
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
              <td style={{ ...tdStyle, color: iface.status === 'up' ? '#6ef7ae' : iface.status === 'admin_down' ? '#ff6666' : '#7e8c9e' }}>
                {iface.status === 'up' ? 'up/up' : iface.status === 'admin_down' ? 'admin-down' : 'down'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ marginTop: 24, fontSize: 13, color: '#7291a6', fontStyle: 'italic' }}>
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
      background: '#0f1c28', border: '1px solid #2b3a45', borderTop: 'none',
      borderRadius: '0 0 4px 4px', maxHeight: 200, overflowY: 'auto',
    }}>
      {items.map(({ ip, label }) => (
        <div
          key={ip + label}
          onMouseDown={() => onSelect(ip)}
          style={{ padding: '5px 12px', fontSize: 14, cursor: 'pointer', color: '#99acbb' }}
          onMouseEnter={e => e.currentTarget.style.background = '#202b33'}
          onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
        >
          <span style={{ fontFamily: 'var(--font-mono)', color: '#4da6ff', marginRight: 8 }}>{ip}</span>
          <span style={{ color: '#738fa2', fontSize: 13 }}>{label}</span>
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
        <div style={{ padding: 40, textAlign: 'center', color: '#7291a6', fontFamily: 'var(--font-mono)' }}>
          <div style={{ fontSize: 32, marginBottom: 16 }}>🌐</div>
          <div style={{ fontSize: 14.5, color: '#49a574', marginBottom: 6 }}>
            {laptopIp
              ? <>Laptop IP: <strong style={{ color: '#99acbb' }}>{laptopIp}</strong></>
              : <span style={{ color: '#8e8e5f' }}>⚠ Laptop has no IP — configure it on the floorplan first</span>
            }
          </div>
          <div style={{ fontSize: 14, color: '#7090a6', marginBottom: 24 }}>
            Type a device IP address in the address bar to open its management interface.
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center' }}>
            {allIps.slice(0, 8).map(({ ip, label }) => (
              <button
                key={ip}
                onClick={() => navigate(ip)}
                style={{ padding: '6px 12px', fontSize: 13, background: '#0f1c28',
                  color: '#4da6ff', border: '1px solid #202b33', borderRadius: 4, cursor: 'pointer' }}
              >
                {ip}
                <span style={{ color: '#7090a6', marginLeft: 4, fontSize: 12 }}>{label}</span>
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
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#0e1316' }}>

      {/* ── Chrome-style toolbar ──────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px',
        background: '#12181c', borderBottom: '1px solid #202b33', flexShrink: 0 }}>

        <button onClick={goBack}    disabled={histIdx <= 0}               style={navBtn(histIdx <= 0)}>‹</button>
        <button onClick={goForward} disabled={histIdx >= history.length - 1} style={navBtn(histIdx >= history.length - 1)}>›</button>

        {/* Laptop IP status pill */}
        <span style={{
          fontSize: 11.5, padding: '2px 6px', borderRadius: 3, fontFamily: 'var(--font-mono)', flexShrink: 0,
          background: laptopIp ? '#0d1c15' : '#1d0d0c',
          color:      laptopIp ? '#66977e' : '#c57575',
          border: `1px solid ${laptopIp ? '#1d3328' : '#341d1c'}`,
        }}>
          {laptopIp ? `🖥 ${laptopIp}` : '🖥 not configured'}
        </span>

        <div style={{ flex: 1, position: 'relative' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6,
            background: '#161e24', border: '1px solid #2b3a45', borderRadius: 16, padding: '3px 12px' }}>
            <span style={{ fontSize: 13, color: pageState?.type === 'firewall' || pageState?.type === 'router' ? '#59a67d' : '#7490a2' }}>
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
                fontSize: 12.5, color: '#99acbb', fontFamily: 'var(--font-mono)' }}
            />
            {addressBar && (
              <button onMouseDown={() => { setAddressBar(''); inputRef.current?.focus() }}
                style={{ background: 'none', border: 'none', color: '#7090a6', cursor: 'pointer', fontSize: 14.5, padding: 0 }}>✕</button>
            )}
          </div>

          {showSuggest && suggestions.length > 0 && (
            <Suggestions items={suggestions} onSelect={navigate} />
          )}
        </div>

        <button onClick={() => currentUrl && navigate(currentUrl)} style={navBtn(false)} title="Reload">↻</button>
      </div>

      {/* ── Page area ────────────────────────────────────────────────────── */}
      <div style={{ flex: 1, overflowY: 'auto', background: '#0e1316', color: '#c8d9e8' }}>
        {renderPage()}
      </div>
    </div>
  )
}

// ── Style helpers ─────────────────────────────────────────────────────────────
const thStyle = {
  padding: '5px 10px', textAlign: 'left', fontSize: 13,
  color: '#7e8c9e', borderBottom: '1px solid #202b33', fontWeight: 700,
}
const tdStyle = {
  padding: '4px 10px', fontSize: 12.5, borderBottom: '1px solid #12181c', fontFamily: 'var(--font-mono)',
}
function navBtn(disabled) {
  return {
    padding: '2px 8px', fontSize: 16.5, background: 'transparent',
    color: disabled ? '#7190a7' : '#99acbb', border: '1px solid #202b33',
    borderRadius: 4, cursor: disabled ? 'default' : 'pointer',
  }
}
