import { useState } from 'react'
import { useGame } from '../state/GameContext.jsx'
import { maskToPrefixLen } from '../models/ipUtils.js'
import { planAddressEdit, runAddressPlan } from '../engine/interfaceAddress.js'
import ConfigSummary from './ConfigSummary.jsx'
import { IconCheck, IconClose } from './icons.jsx'

export default function DeviceInspector() {
  const {
    selectedDeviceId, getDevice, devices, topology,
    connectInterfaces, disconnectInterface, executeDeviceCommands, logExecutedCommand,
  } = useGame()

  const [fromIface, setFromIface] = useState('')
  const [toIface,   setToIface]   = useState('')
  const [editingIp, setEditingIp] = useState(null)  // { ifaceName, ip, prefix }
  const [ipError,   setIpError]   = useState(null)  // validation error shown inline
  const [tab,       setTab]       = useState('interfaces') // 'interfaces' | 'summary'

  const device = selectedDeviceId ? getDevice(selectedDeviceId) : null

  if (!device) {
    return (
      <div className="panel" style={{ height: '100%' }}>
        <h3 style={{ fontSize: 17, fontWeight: 700, color: 'var(--ink)', marginBottom: 4 }}>Inspector</h3>
        <p style={{ color: 'var(--ink-3)', fontSize: 14.5 }}>Select a device on the floorplan to see its interfaces and config.</p>
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

  // A quick edit still goes through the CLI engines (engine/interfaceAddress.js): ip / dhclient
  // or netsh on a host, real IOS on a router — so every check the terminal makes applies here
  // too, and a leased host hands its lease back instead of keeping a stale flag.
  function applyEditIp() {
    if (!editingIp) return
    const iface = device.getInterface(editingIp.ifaceName)
    if (!iface) { setEditingIp(null); return }

    const plan = planAddressEdit(topology, device, iface.name, editingIp.ip, editingIp.prefix)
    const problem = Object.values(plan.errors)[0]
    if (problem) { setIpError(problem); return }

    if (plan.commands.length) {
      const res = runAddressPlan(cmd => executeDeviceCommands(device.id, [cmd]), device, iface.name, plan)
      for (const s of res.steps) if (s.ok) logExecutedCommand(device.id, s.cmd)   // counts as typed, like the Configure GUI
      if (!res.ok) {
        const said = res.steps.at(-1).output.map(l => String(l).replace(/^%\s*/, '').trim()).filter(Boolean).join(' ')
        setIpError(said || 'The device refused that address.')
        return
      }
    }
    setIpError(null)
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
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 4 }}>
        <h3 style={{ fontSize: 18, fontWeight: 700, color: 'var(--ink)' }}>{device.hostname}</h3>
        <span style={{ fontSize: 14, color: 'var(--ink-3)' }}>{device.model}</span>
      </div>

      {/* Interfaces / Config Summary tabs */}
      <div role="tablist" style={{ display: 'flex', gap: 2, marginBottom: 8, borderBottom: '1px solid var(--rule)' }}>
        {[['interfaces', 'Interfaces'], ['summary', 'Config summary']].map(([id, label]) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={`utab${tab === id ? ' on' : ''}`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'summary' ? (
        <ConfigSummary device={device} />
      ) : (
      <>
      {/* Interface table */}
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13.5, marginBottom: 10 }}>
        <thead>
          <tr style={{ color: 'var(--ink-3)', borderBottom: '1px solid var(--rule)' }}>
            {['Interface', 'IP / Prefix', 'Status', 'Connected to'].map(h => (
              <th key={h} style={{ textAlign: 'left', padding: '4px 8px', fontWeight: 600, whiteSpace: 'nowrap' }}>{h}</th>
            ))}
            <th />
          </tr>
        </thead>
        <tbody>
          {device.interfaces.map(iface => {
            const cidr        = iface.ip ? `${iface.ip}/${maskToPrefixLen(iface.subnet_mask)}` : null
            const isEditRow   = editingIp?.ifaceName === iface.name
            const isCLIActive = device.active_interface === iface.name &&
              (device.config_mode === 'interface_config' || device.config_mode === 'subif_config')
            const st = _status(iface.status)

            return (
              <tr key={iface.name} style={{
                borderBottom: '1px solid var(--rule)',
                background: isCLIActive ? 'rgba(62,224,143,0.06)' : undefined,
                boxShadow: isCLIActive ? 'inset 2px 0 0 #3ee08f' : undefined,
              }}>
                <td style={{ padding: '5px 8px', fontFamily: 'var(--font-mono)', fontSize: 13, color: isCLIActive ? '#3ee08f' : 'var(--ink)', whiteSpace: 'nowrap' }}>
                  {isCLIActive && (
                    <span title="Currently selected in CLI" style={{ color: '#3ee08f', marginRight: 5, fontSize: 11 }}>▶</span>
                  )}
                  {iface.name}
                  {iface.description && (
                    <div style={{ fontSize: 13, color: 'var(--ink-3)', fontStyle: 'italic', fontFamily: 'var(--font-ui)', marginTop: 1 }}>
                      {iface.description}
                    </div>
                  )}
                </td>
                <td style={{ padding: '3px 8px', fontFamily: 'var(--font-mono)', fontSize: 13, whiteSpace: 'nowrap' }}>
                  {isEditRow ? (
                    <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                      <input
                        autoFocus
                        value={editingIp.ip}
                        onChange={e => setEditingIp(p => ({ ...p, ip: e.target.value }))}
                        onKeyDown={e => { if (e.key === 'Enter') applyEditIp(); if (e.key === 'Escape') cancelEditIp() }}
                        placeholder="x.x.x.x"
                        aria-label="IP address"
                        style={ipInputStyle(112)}
                      />
                      <span style={{ color: 'var(--ink-3)' }}>/</span>
                      <input
                        value={editingIp.prefix}
                        onChange={e => setEditingIp(p => ({ ...p, prefix: e.target.value }))}
                        onKeyDown={e => { if (e.key === 'Enter') applyEditIp(); if (e.key === 'Escape') cancelEditIp() }}
                        aria-label="Prefix length"
                        style={ipInputStyle(40)}
                      />
                      <button className="btn icon" onClick={applyEditIp} title="Apply" aria-label="Apply" style={{ width: 26, height: 26 }}><IconCheck size={14} /></button>
                      <button className="btn ghost icon" onClick={cancelEditIp} title="Cancel" aria-label="Cancel" style={{ width: 26, height: 26 }}><IconClose size={14} /></button>
                    </div>
                  ) : device.type === 'isp' ? (
                    <span title="The ISP is mission infrastructure — its address can't be edited." style={{ color: 'var(--ink)' }}>
                      {cidr || '—'}
                    </span>
                  ) : device.type === 'switch' && !iface.name.startsWith('Vlan') ? (
                    <span
                      title="L2 switchport — no IP. Use 'interface vlan <id>' for management IP."
                      style={{ color: 'var(--ink-3)', cursor: 'not-allowed' }}
                    >
                      —
                    </span>
                  ) : (
                    <span
                      title="Click to edit IP"
                      onClick={() => startEditIp(iface)}
                      style={{
                        color: cidr ? 'var(--ink)' : 'var(--ink-3)',
                        cursor: 'pointer',
                        borderBottom: '1px dashed var(--rule-strong)',
                        paddingBottom: 1,
                      }}
                    >
                      {cidr || '—'}
                    </span>
                  )}
                </td>
                <td style={{ padding: '5px 8px', whiteSpace: 'nowrap' }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: st.text }}>
                    <i className={`led ${st.led}`} style={{ width: 7, height: 7 }} />
                    {st.label}
                  </span>
                </td>
                <td style={{ padding: '5px 8px', fontFamily: 'var(--font-mono)', fontSize: 12.5, color: 'var(--ink-2)', whiteSpace: 'nowrap' }}>
                  {iface.connected_to
                    ? _connectedLabel(iface.connected_to, devices)
                    : <span style={{ color: 'var(--ink-3)' }}>—</span>}
                </td>
                <td style={{ padding: '3px 8px', textAlign: 'right' }}>
                  {iface.connected_to && (
                    <button
                      className="btn ghost icon"
                      style={{ width: 24, height: 24 }}
                      title="Unplug cable"
                      aria-label={`Unplug cable on ${iface.name}`}
                      onClick={() => disconnectInterface(`${device.id}:${iface.name}`)}
                    >
                      <IconClose size={13} />
                    </button>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>

      {ipError && (
        <div role="alert" style={{ fontSize: 14, color: '#ff8078', marginBottom: 6, padding: '5px 10px', background: '#211412', border: '1px solid #4a2521', borderRadius: 6 }}>
          {ipError}
        </div>
      )}
      <div style={{ fontSize: 13.5, color: 'var(--ink-3)', marginBottom: 10 }}>
        {device.type === 'switch'
          ? 'Switchports are L2 only. Use the CLI to configure SVIs (interface vlan <id>).'
          : device.type === 'isp'
            ? 'The ISP is mission infrastructure — its address is fixed.'
            : 'Click an IP address to edit it. Leave blank to clear.'}
      </div>

      {/* Cable connection controls */}
      <div style={{ borderTop: '1px solid var(--rule)', paddingTop: 10 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink-2)', marginBottom: 6 }}>Add cable</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <select
            value={fromIface}
            onChange={e => setFromIface(e.target.value)}
            aria-label="This device port"
            style={selectStyle}
          >
            <option value=''>This device port…</option>
            {device.interfaces
              .filter(i => !i.connected_to && !i.svi)
              .map(i => (
                <option key={i.name} value={`${device.id}:${i.name}`}>{i.name}</option>
              ))}
          </select>

          <span style={{ color: 'var(--ink-3)' }}>↔</span>

          <select
            value={toIface}
            onChange={e => setToIface(e.target.value)}
            aria-label="Remote port"
            style={selectStyle}
          >
            <option value=''>Remote port…</option>
            {remoteIfaceOptions.map(o => (
              <option key={o.id} value={o.id}>{o.label}</option>
            ))}
          </select>

          <button
            className="btn"
            disabled={!fromIface || !toIface}
            onClick={handleCable}
            style={{ padding: '4px 14px' }}
          >
            Cable
          </button>
        </div>
      </div>
      </>
      )}
    </div>
  )
}

const selectStyle = {
  fontSize: 13.5,
  background: 'var(--surface-well)',
  color: 'var(--ink)',
  border: '1px solid var(--rule-strong)',
  padding: '5px 8px',
  borderRadius: 6,
  flex: '1',
  minWidth: 0,
}

const ipInputStyle = width => ({
  width, fontSize: 13, padding: '3px 6px',
  background: 'var(--surface-well)', color: 'var(--ink)',
  border: '1px solid var(--signal)', borderRadius: 4,
  fontFamily: 'var(--font-mono)',
})

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

// Three distinct states, as on real gear: up/up, down (layer 1 problem) and
// administratively down (shutdown on purpose) — never collapsed into one look.
function _status(status) {
  if (status === 'up')         return { led: 'green', label: 'up',                   text: 'var(--ink)' }
  if (status === 'admin_down') return { led: '',      label: 'administratively down', text: 'var(--ink-3)' }
  return                              { led: 'amber', label: 'down',                 text: '#ffb42e' }
}
