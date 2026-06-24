import { useState } from 'react'
import { useGame } from '../state/GameContext.jsx'
import { maskToPrefixLen, isValidIp, isHostAddress, networkAddress, broadcastAddress } from '../models/ipUtils.js'

export default function DeviceInspector() {
  const {
    selectedDeviceId, getDevice, devices, topology,
    connectInterfaces, disconnectInterface, refresh,
  } = useGame()

  const [fromIface, setFromIface] = useState('')
  const [toIface,   setToIface]   = useState('')
  const [editingIp, setEditingIp] = useState(null)  // { ifaceName, ip, prefix }
  const [ipError,   setIpError]   = useState(null)  // validation error shown inline

  const device = selectedDeviceId ? getDevice(selectedDeviceId) : null

  if (!device) {
    return (
      <div className="panel" style={{ height: '100%' }}>
        <h3 style={{ margin: '0 0 8px', fontSize: '13px', color: '#4a90e2' }}>Inspector</h3>
        <p style={{ color: '#444', fontSize: '12px' }}>Click a device on the floorplan</p>
      </div>
    )
  }

  function handleCable() {
    if (!fromIface || !toIface) return
    connectInterfaces(fromIface, toIface)
    setFromIface('')
    setToIface('')
  }

  function startEditIp(iface) {
    const prefix = iface.subnet_mask ? maskToPrefixLen(iface.subnet_mask) : 24
    setEditingIp({ ifaceName: iface.name, ip: iface.ip || '', prefix: String(prefix) })
  }

  function cancelEditIp() {
    setEditingIp(null)
    setIpError(null)
  }

  function applyEditIp() {
    if (!editingIp) return
    const iface = device.getInterface(editingIp.ifaceName)
    if (!iface) { setEditingIp(null); return }

    const ip = editingIp.ip.trim()
    const prefixNum = parseInt(editingIp.prefix, 10)

    if (!ip) {
      iface.ip = null
      iface.subnet_mask = null
      setIpError(null)
      refresh()
      setEditingIp(null)
      return
    }

    if (!isValidIp(ip) || isNaN(prefixNum) || prefixNum < 0 || prefixNum > 32) {
      setIpError('Invalid IP address or prefix length')
      return
    }

    const n    = prefixNum === 0 ? 0 : (0xffffffff << (32 - prefixNum)) >>> 0
    const mask = [n >>> 24, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff].join('.')

    if (!isHostAddress(ip, mask)) {
      const net   = networkAddress(ip, mask)
      const bcast = broadcastAddress(ip, mask)
      if (ip === net)   { setIpError(`${ip} is the network address — not assignable to a host`); return }
      if (ip === bcast) { setIpError(`${ip} is the broadcast address — not assignable to a host`); return }
      setIpError('Invalid host address for this prefix length')
      return
    }

    const dup = topology && [...topology.devices.values()].find(d =>
      d !== device && d.interfaces.some(i => i.ip === ip)
    )
    if (dup) {
      setIpError(`${ip} is already assigned to ${dup.hostname}`)
      return
    }

    setIpError(null)
    iface.ip          = ip
    iface.subnet_mask = mask
    refresh()
    setEditingIp(null)
  }

  // All free physical interface IDs across every placed device, excluding this device's own ports.
  // SVIs (Vlan*) are virtual and cannot be physically cabled — exclude them.
  const remoteIfaceOptions = devices.flatMap(d =>
    d.interfaces
      .filter(i => !i.connected_to && !i.svi)
      .map(i => ({ id: `${d.id}:${i.name}`, label: `${d.hostname} — ${i.name}` }))
  ).filter(o => !o.id.startsWith(device.id + ':'))

  return (
    <div className="panel" style={{ height: '100%', overflow: 'auto' }}>
      <h3 style={{ margin: '0 0 6px', fontSize: '13px', color: '#4a90e2' }}>
        {device.hostname}
        <span style={{ color: '#555', fontWeight: 'normal', marginLeft: 6 }}>{device.model}</span>
      </h3>

      {/* Interface table */}
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px', marginBottom: 10 }}>
        <thead>
          <tr style={{ color: '#555', borderBottom: '1px solid #1a1a2e' }}>
            <th style={{ textAlign: 'left', padding: '2px 4px', fontWeight: 'normal', whiteSpace: 'nowrap' }}>Interface</th>
            <th style={{ textAlign: 'left', padding: '2px 4px', fontWeight: 'normal', whiteSpace: 'nowrap' }}>IP / Prefix</th>
            <th style={{ textAlign: 'left', padding: '2px 4px', fontWeight: 'normal', whiteSpace: 'nowrap' }}>Status</th>
            <th style={{ textAlign: 'left', padding: '2px 4px', fontWeight: 'normal', whiteSpace: 'nowrap' }}>Connected to</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {device.interfaces.map(iface => {
            const cidr        = iface.ip ? `${iface.ip}/${maskToPrefixLen(iface.subnet_mask)}` : null
            const isEditRow   = editingIp?.ifaceName === iface.name
            const isCLIActive = device.active_interface === iface.name &&
              (device.config_mode === 'interface_config' || device.config_mode === 'subif_config')

            return (
              <tr key={iface.name} style={{
                borderBottom: '1px solid #0d0d1a',
                background: isCLIActive ? 'rgba(80,250,123,0.06)' : undefined,
                boxShadow: isCLIActive ? 'inset 2px 0 0 #50fa7b' : undefined,
              }}>
                <td style={{ padding: '3px 4px', fontFamily: 'monospace', color: isCLIActive ? '#50fa7b' : '#ccc', whiteSpace: 'nowrap' }}>
                  {isCLIActive && (
                    <span title="Currently selected in CLI" style={{ color: '#50fa7b', marginRight: 4, fontSize: 10 }}>▶</span>
                  )}
                  {iface.name}
                  {iface.description && (
                    <div style={{ fontSize: 9, color: '#4a6a9a', fontStyle: 'italic', fontFamily: 'sans-serif', marginTop: 1 }}>
                      {iface.description}
                    </div>
                  )}
                </td>
                <td style={{ padding: '2px 4px', fontFamily: 'monospace', whiteSpace: 'nowrap' }}>
                  {isEditRow ? (
                    <div style={{ display: 'flex', gap: 3, alignItems: 'center' }}>
                      <input
                        autoFocus
                        value={editingIp.ip}
                        onChange={e => setEditingIp(p => ({ ...p, ip: e.target.value }))}
                        onKeyDown={e => { if (e.key === 'Enter') applyEditIp(); if (e.key === 'Escape') cancelEditIp() }}
                        placeholder="x.x.x.x"
                        style={{
                          width: 90, fontSize: 10, padding: '1px 3px',
                          background: '#07070d', color: '#f8f8f2',
                          border: '1px solid #4a90e2', borderRadius: 2,
                          fontFamily: 'monospace',
                        }}
                      />
                      <span style={{ color: '#555', fontSize: 10 }}>/</span>
                      <input
                        value={editingIp.prefix}
                        onChange={e => setEditingIp(p => ({ ...p, prefix: e.target.value }))}
                        onKeyDown={e => { if (e.key === 'Enter') applyEditIp(); if (e.key === 'Escape') cancelEditIp() }}
                        style={{
                          width: 30, fontSize: 10, padding: '1px 3px',
                          background: '#07070d', color: '#f8f8f2',
                          border: '1px solid #4a90e2', borderRadius: 2,
                          fontFamily: 'monospace',
                        }}
                      />
                      <button className="btn-small" onClick={applyEditIp}
                        style={{ fontSize: 9, padding: '1px 4px', background: '#1a3060' }}>✓</button>
                      <button className="btn-small" onClick={cancelEditIp}
                        style={{ fontSize: 9, padding: '1px 4px', background: '#3a1a1a' }}>✕</button>
                    </div>
                  ) : device.type === 'switch' && !iface.name.startsWith('Vlan') ? (
                    <span
                      title="L2 switchport — no IP. Use 'interface vlan <id>' for management IP."
                      style={{ color: '#222244', cursor: 'not-allowed' }}
                    >
                      —
                    </span>
                  ) : (
                    <span
                      title="Click to edit IP"
                      onClick={() => startEditIp(iface)}
                      style={{
                        color: cidr ? '#f8f8f2' : '#333355',
                        cursor: 'pointer',
                        borderBottom: '1px dashed #2a2a50',
                        paddingBottom: 1,
                      }}
                    >
                      {cidr || '—'}
                    </span>
                  )}
                </td>
                <td style={{ padding: '3px 4px', color: _statusColor(iface.status), whiteSpace: 'nowrap' }}>
                  {iface.status}
                </td>
                <td style={{ padding: '3px 4px', fontSize: '10px', color: '#666', whiteSpace: 'nowrap' }}>
                  {iface.connected_to
                    ? _connectedLabel(iface.connected_to, devices)
                    : <span style={{ color: '#2a2a3a' }}>—</span>}
                </td>
                <td style={{ padding: '3px 4px' }}>
                  {iface.connected_to && (
                    <button
                      className="btn-small"
                      style={{ fontSize: '10px', padding: '1px 5px', background: '#3a1a1a' }}
                      onClick={() => disconnectInterface(`${device.id}:${iface.name}`)}
                    >
                      ✕
                    </button>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>

      {ipError && (
        <div style={{ fontSize: 10, color: '#ff5555', marginBottom: 4, padding: '2px 4px', background: '#1a0a0a', borderRadius: 2 }}>
          ⚠ {ipError}
        </div>
      )}
      <div style={{ fontSize: 9, color: '#2a2a50', marginBottom: 8 }}>
        {device.type === 'switch'
          ? 'Switchports are L2 only. Use the CLI to configure SVIs (interface vlan <id>).'
          : 'Click an IP address to edit it. Leave blank to clear.'}
      </div>

      {/* Cable connection controls */}
      <div style={{ borderTop: '1px solid #1a1a2e', paddingTop: 8 }}>
        <div style={{ fontSize: '11px', color: '#666', marginBottom: 4 }}>Add cable</div>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
          <select
            value={fromIface}
            onChange={e => setFromIface(e.target.value)}
            style={selectStyle}
          >
            <option value=''>This device port…</option>
            {device.interfaces
              .filter(i => !i.connected_to && !i.svi)
              .map(i => (
                <option key={i.name} value={`${device.id}:${i.name}`}>{i.name}</option>
              ))}
          </select>

          <span style={{ color: '#333' }}>↔</span>

          <select
            value={toIface}
            onChange={e => setToIface(e.target.value)}
            style={selectStyle}
          >
            <option value=''>Remote port…</option>
            {remoteIfaceOptions.map(o => (
              <option key={o.id} value={o.id}>{o.label}</option>
            ))}
          </select>

          <button
            className="btn-small"
            disabled={!fromIface || !toIface}
            onClick={handleCable}
          >
            Cable
          </button>
        </div>
      </div>
    </div>
  )
}

const selectStyle = {
  fontSize: '11px',
  background: '#0d0d1a',
  color: '#e0e0e0',
  border: '1px solid #1a1a3e',
  padding: '2px 4px',
  borderRadius: '3px',
  flex: '1',
  minWidth: 0,
}

function _connectedLabel(connectedTo, devices) {
  const colonIdx = connectedTo.indexOf(':')
  if (colonIdx === -1) return connectedTo
  const devId  = connectedTo.slice(0, colonIdx)
  const ifName = connectedTo.slice(colonIdx + 1)
  const remote = devices.find(d => d.id === devId)
  return remote
    ? `${ifName} [${remote.hostname}]`
    : ifName
}

function _statusColor(status) {
  if (status === 'up')         return '#50fa7b'
  if (status === 'admin_down') return '#44475a'
  return '#ffb86c'
}
