import { useState, useEffect, useRef } from 'react'
import { useGame } from '../state/GameContext.jsx'

const NAMED_SERVICES = ['any', 'icmp', 'HTTP', 'HTTPS', 'SSH', 'DNS', 'FTP', 'TELNET', 'RDP', 'SMTP']
const SERVICE_LABEL  = { any: 'ANY', icmp: 'ICMP', HTTP: 'HTTP/80', HTTPS: 'HTTPS/443', SSH: 'SSH/22', DNS: 'DNS/53', FTP: 'FTP/21', TELNET: 'TELNET/23', RDP: 'RDP/3389', SMTP: 'SMTP/25' }

// ── Top-level overlay ─────────────────────────────────────────────────────────

export default function FirewallConsole({ deviceId, onClose }) {
  const { getDevice, tick } = useGame()
  // Re-read device on every tick so rule additions/deletions reflect immediately.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const device = getDevice(deviceId)
  const [tab, setTab] = useState('policy')

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  if (!device) { onClose(); return null }

  // Management IP gate: firewall must have at least one interface with an IP configured.
  const mgmtIface = device.interfaces.find(i => i.ip)
  if (!mgmtIface) {
    return (
      <Overlay onClose={onClose}>
        <GateScreen hostname={device.hostname} onClose={onClose} />
      </Overlay>
    )
  }

  const mgmtIp    = mgmtIface.ip
  const mgmtUp    = mgmtIface.status === 'up'
  const ruleCount = (device.fw_rules ?? []).length
  const denyCount = (device.fw_log ?? []).filter(e => e.verdict === 'deny').length

  return (
    <Overlay onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>

        {/* ── Header ── */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12,
          padding: '10px 16px', background: '#060b14',
          borderBottom: '1px solid #ff6b3540', flexShrink: 0,
        }}>
          {/* Shield icon */}
          <svg width="28" height="28" viewBox="0 0 28 28">
            <path d="M14 2 L24 6 L24 15 Q24 22 14 26 Q4 22 4 15 L4 6 Z" fill="#0d1a30" stroke="#ff6b35" strokeWidth="1.5"/>
            <line x1="14" y1="9" x2="14" y2="21" stroke="#ff6b35" strokeWidth="1.2" opacity="0.8"/>
            <line x1="8"  y1="15" x2="20" y2="15" stroke="#ff6b35" strokeWidth="1.2" opacity="0.8"/>
          </svg>

          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#e0e0e0', fontFamily: 'monospace' }}>
              {device.hostname}
              <span style={{ fontSize: 10, color: '#555', fontWeight: 400, marginLeft: 8 }}>{device.model}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 2 }}>
              <span style={{ fontSize: 10, color: '#aaa', fontFamily: 'monospace' }}>
                Mgmt: {mgmtIp}
              </span>
              <StatusChip up={mgmtUp} label={mgmtUp ? 'ONLINE' : 'LINK DOWN'} />
            </div>
          </div>

          {/* Summary pills */}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <Pill label={`${ruleCount} rules`} color="#4a90e2" />
            {denyCount > 0 && <Pill label={`${denyCount} denied`} color="#ff5555" />}
          </div>

          <button
            onClick={onClose}
            style={{
              background: 'none', border: 'none', color: '#555', fontSize: 18,
              cursor: 'pointer', lineHeight: 1, padding: '2px 4px', flexShrink: 0,
            }}
            onMouseEnter={e => { e.currentTarget.style.color = '#ff5555' }}
            onMouseLeave={e => { e.currentTarget.style.color = '#555' }}
            title="Close (Esc)"
          >×</button>
        </div>

        {/* ── Tab bar ── */}
        <div style={{
          display: 'flex', background: '#07090f',
          borderBottom: '1px solid #1a1a3e', flexShrink: 0,
        }}>
          {[
            { id: 'policy', label: 'POLICY' },
            { id: 'zones',  label: 'ZONES' },
            { id: 'logs',   label: 'LOGS' + (denyCount > 0 ? ` (${denyCount} denied)` : '') },
          ].map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              style={{
                padding: '8px 20px', border: 'none', cursor: 'pointer',
                fontSize: 11, fontWeight: 700, letterSpacing: 0.8,
                background: tab === t.id ? '#0d1226' : 'transparent',
                color: tab === t.id ? '#ff6b35' : '#444',
                borderBottom: tab === t.id ? '2px solid #ff6b35' : '2px solid transparent',
              }}
            >{t.label}</button>
          ))}
        </div>

        {/* ── Tab content ── */}
        <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          {tab === 'policy' && <PolicyTab device={device} />}
          {tab === 'zones'  && <ZonesTab  device={device} />}
          {tab === 'logs'   && <LogsTab   device={device} />}
        </div>
      </div>
    </Overlay>
  )
}

// ── Overlay wrapper ───────────────────────────────────────────────────────────

function Overlay({ children, onClose }) {
  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 800,
        background: 'rgba(0,0,0,0.72)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: '92vw', maxWidth: 980, height: '82vh',
          background: '#0d1226',
          border: '1px solid #ff6b3550',
          borderRadius: 10, overflow: 'hidden',
          boxShadow: '0 12px 60px rgba(0,0,0,0.85)',
          display: 'flex', flexDirection: 'column',
        }}
        onClick={e => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  )
}

// ── Management-IP gate ────────────────────────────────────────────────────────

function GateScreen({ hostname, onClose }) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      height: '100%', gap: 16, padding: 32, textAlign: 'center',
      background: '#0d1226',
    }}>
      <svg width="52" height="52" viewBox="0 0 28 28" style={{ opacity: 0.35 }}>
        <path d="M14 2 L24 6 L24 15 Q24 22 14 26 Q4 22 4 15 L4 6 Z" fill="none" stroke="#ff6b35" strokeWidth="2"/>
        <text x="14" y="19" textAnchor="middle" fill="#ff6b35" fontSize="12" fontFamily="monospace">?</text>
      </svg>
      <div style={{ fontSize: 13, fontWeight: 700, color: '#555', letterSpacing: 1 }}>
        MANAGEMENT INTERFACE NOT CONFIGURED
      </div>
      <div style={{ fontSize: 11, color: '#333355', maxWidth: 380, lineHeight: 1.7 }}>
        <strong style={{ color: '#4a4a70' }}>{hostname}</strong> has no IP address on any interface.
        Configure a management IP via the CLI first:
      </div>
      <pre style={{
        background: '#060b14', border: '1px solid #1a1a3e',
        borderRadius: 6, padding: '10px 20px', fontSize: 11,
        fontFamily: 'monospace', color: '#8be9fd', textAlign: 'left', lineHeight: 1.8,
      }}>{`${hostname}# conf t
${hostname}(config)# interface GigabitEthernet0/0
${hostname}(config-if)# nameif INSIDE
${hostname}(config-if)# ip address 10.0.0.1 255.255.255.0
${hostname}(config-if)# no shutdown`}</pre>
      <div style={{ fontSize: 10, color: '#2a2a50', marginTop: 8 }}>
        Press Esc or click outside to close
      </div>
    </div>
  )
}

// ── POLICY tab ────────────────────────────────────────────────────────────────

function PolicyTab({ device }) {
  const { refresh } = useGame()
  const [showAdd, setShowAdd] = useState(false)
  const rules    = device.fw_rules ?? []
  const zones    = [...new Set(Object.values(device.fw_zones ?? {}))].sort()

  function moveUp(idx) {
    if (idx === 0) return
    const next = [...rules]
    ;[next[idx - 1], next[idx]] = [next[idx], next[idx - 1]]
    device.fw_rules = next
    refresh()
  }

  function moveDown(idx) {
    if (idx === rules.length - 1) return
    const next = [...rules]
    ;[next[idx], next[idx + 1]] = [next[idx + 1], next[idx]]
    device.fw_rules = next
    refresh()
  }

  function deleteRule(id) {
    device.fw_rules   = (device.fw_rules ?? []).filter(r => r.id !== id)
    device.fw_sessions = []  // changing rules invalidates established sessions (same as CLI)
    refresh()
  }

  function toggleRule(id) {
    const rule = (device.fw_rules ?? []).find(r => r.id === id)
    if (!rule) return
    rule.enabled = rule.enabled === false ? true : false
    device.fw_sessions = []  // toggling a rule changes effective policy; invalidate sessions
    refresh()
  }

  function addRule(rule) {
    if (!device.fw_rules) device.fw_rules = []
    const nextId = device.fw_rules.length > 0
      ? Math.max(...device.fw_rules.map(r => r.id)) + 1 : 1
    device.fw_rules.push({ id: nextId, enabled: true, ...rule })
    device.fw_sessions = []  // new rule may open flows that were previously blocked
    setShowAdd(false)
    refresh()
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Toolbar */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '8px 14px', background: '#080f1e',
        borderBottom: '1px solid #0d0d20', flexShrink: 0,
      }}>
        <span style={{ fontSize: 10, color: '#3a3a60', letterSpacing: 0.5 }}>
          {rules.length === 0 ? 'No rules — all traffic blocked by implicit default-deny'
            : `${rules.length} rule${rules.length !== 1 ? 's' : ''} — first match wins · implicit deny at bottom`}
        </span>
        <button
          onClick={() => setShowAdd(s => !s)}
          style={{
            padding: '5px 14px', fontSize: 11, fontWeight: 700,
            background: showAdd ? '#1a3060' : '#0a2040',
            color: '#4a90e2', border: '1px solid #2a4080',
            borderRadius: 4, cursor: 'pointer', letterSpacing: 0.5,
          }}
          onMouseEnter={e => { e.currentTarget.style.background = '#1a3060' }}
          onMouseLeave={e => { e.currentTarget.style.background = showAdd ? '#1a3060' : '#0a2040' }}
        >+ ADD RULE</button>
      </div>

      {/* Add-rule form */}
      {showAdd && (
        <AddRuleForm zones={zones} onAdd={addRule} onCancel={() => setShowAdd(false)} />
      )}

      {/* Rule table */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {/* Column headers */}
        <div style={{
          display: 'grid', gridTemplateColumns: '36px 1fr 1fr 1fr 1fr 100px 80px 54px 70px',
          padding: '5px 12px', fontSize: 9, color: '#333355',
          letterSpacing: 0.6, fontWeight: 700, background: '#07090f',
          borderBottom: '1px solid #0d0d20', position: 'sticky', top: 0, zIndex: 1,
        }}>
          <span>#</span>
          <span>FROM ZONE</span>
          <span>TO ZONE</span>
          <span>SOURCE</span>
          <span>DESTINATION</span>
          <span>SERVICE</span>
          <span>ACTION</span>
          <span>ENABLED</span>
          <span />
        </div>

        {/* Rule rows */}
        {rules.map((rule, idx) => (
          <RuleRow
            key={rule.id}
            rule={rule}
            idx={idx}
            total={rules.length}
            onUp={() => moveUp(idx)}
            onDown={() => moveDown(idx)}
            onDelete={() => deleteRule(rule.id)}
            onToggle={() => toggleRule(rule.id)}
          />
        ))}

        {/* Implicit default-deny */}
        <div style={{
          display: 'grid', gridTemplateColumns: '36px 1fr 1fr 1fr 1fr 100px 80px 54px 70px',
          padding: '8px 12px', borderTop: rules.length > 0 ? '1px dashed #1a1a30' : 'none',
          opacity: 0.45, userSelect: 'none',
        }}>
          <span style={{ fontSize: 10, color: '#444', fontFamily: 'monospace' }}>{rules.length + 1}</span>
          <span style={{ fontSize: 10, color: '#444' }}>ANY</span>
          <span style={{ fontSize: 10, color: '#444' }}>ANY</span>
          <span style={{ fontSize: 10, color: '#444' }}>any</span>
          <span style={{ fontSize: 10, color: '#444' }}>any</span>
          <span style={{ fontSize: 10, color: '#444' }}>ANY</span>
          <span>
            <ActionBadge action="deny" />
          </span>
          <span />
          <span style={{ fontSize: 9, color: '#333', fontStyle: 'italic', alignSelf: 'center' }}>implicit</span>
        </div>

        {rules.length === 0 && (
          <div style={{ padding: '24px 16px', fontSize: 11, color: '#2a2a50', textAlign: 'center', lineHeight: 1.8 }}>
            No rules configured. All traffic is blocked by the implicit default-deny.<br/>
            Add a rule above to permit traffic between zones.
          </div>
        )}
      </div>
    </div>
  )
}

function RuleRow({ rule, idx, total, onUp, onDown, onDelete, onToggle }) {
  const [hover, setHover] = useState(false)
  const enabled = rule.enabled !== false
  return (
    <div
      style={{
        display: 'grid', gridTemplateColumns: '36px 1fr 1fr 1fr 1fr 100px 80px 54px 70px',
        padding: '7px 12px', alignItems: 'center',
        background: hover ? '#0a0f20' : (idx % 2 === 0 ? '#0b1020' : '#09101e'),
        borderBottom: '1px solid #0d0d1a',
        opacity: enabled ? 1 : 0.38,
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <span style={{ fontSize: 10, color: '#333355', fontFamily: 'monospace' }}>{rule.id}</span>
      <ZoneBadge zone={rule.fromZone} />
      <ZoneBadge zone={rule.toZone} />
      <span style={{ fontSize: 11, color: '#8888aa', fontFamily: 'monospace' }}>{rule.src || 'any'}</span>
      <span style={{ fontSize: 11, color: '#8888aa', fontFamily: 'monospace' }}>{rule.dst || 'any'}</span>
      <span style={{ fontSize: 11, color: '#8be9fd', fontFamily: 'monospace' }}>
        {SERVICE_LABEL[rule.service] ?? rule.service ?? 'ANY'}
      </span>
      <ActionBadge action={rule.action} />
      {/* Enable/disable toggle */}
      <button
        onClick={onToggle}
        title={enabled ? 'Disable rule (rule stays but is skipped)' : 'Enable rule'}
        style={{
          background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px',
          fontSize: 14, lineHeight: 1,
          color: enabled ? '#50fa7b' : '#333355',
          transition: 'color 0.1s',
        }}
        onMouseEnter={e => { e.currentTarget.style.color = enabled ? '#ff5555' : '#50fa7b' }}
        onMouseLeave={e => { e.currentTarget.style.color = enabled ? '#50fa7b' : '#333355' }}
      >{enabled ? '●' : '○'}</button>
      <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end', opacity: hover ? 1 : 0, transition: 'opacity 0.1s' }}>
        <RowBtn title="Move up"   disabled={idx === 0}           onClick={onUp}>↑</RowBtn>
        <RowBtn title="Move down" disabled={idx === total - 1}   onClick={onDown}>↓</RowBtn>
        <RowBtn title="Delete rule" onClick={onDelete} danger>✕</RowBtn>
      </div>
    </div>
  )
}

function AddRuleForm({ zones, onAdd, onCancel }) {
  const [form, setForm] = useState({
    fromZone: zones[0] ?? '',
    toZone:   zones[1] ?? zones[0] ?? '',
    src:      'any',
    dst:      'any',
    service:  'any',
    action:   'permit',
  })
  const [error, setError] = useState(null)

  function set(k, v) { setForm(f => ({ ...f, [k]: v })); setError(null) }

  function submit(e) {
    e.preventDefault()
    if (!form.fromZone || !form.toZone) { setError('Both zones are required'); return }
    if (form.fromZone === form.toZone)  { setError('From and To zones must differ'); return }
    onAdd({ ...form, src: form.src.trim() || 'any', dst: form.dst.trim() || 'any' })
  }

  const inputStyle = {
    background: '#060b14', border: '1px solid #1a2a50', borderRadius: 3,
    color: '#d0d0d0', fontSize: 11, fontFamily: 'monospace',
    padding: '4px 8px', width: '100%', boxSizing: 'border-box',
  }
  const selStyle = { ...inputStyle, cursor: 'pointer' }

  return (
    <form
      onSubmit={submit}
      style={{
        background: '#07091a', borderBottom: '1px solid #1a1a3e',
        padding: '12px 16px', flexShrink: 0,
      }}
    >
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr 140px 100px', gap: 8, marginBottom: 8 }}>
        <div>
          <FieldLabel>From Zone</FieldLabel>
          {zones.length > 0 ? (
            <select value={form.fromZone} onChange={e => set('fromZone', e.target.value)} style={selStyle}>
              {zones.map(z => <option key={z} value={z}>{z}</option>)}
            </select>
          ) : (
            <input value={form.fromZone} onChange={e => set('fromZone', e.target.value)} placeholder="INSIDE" style={inputStyle} />
          )}
        </div>
        <div>
          <FieldLabel>To Zone</FieldLabel>
          {zones.length > 0 ? (
            <select value={form.toZone} onChange={e => set('toZone', e.target.value)} style={selStyle}>
              {zones.map(z => <option key={z} value={z}>{z}</option>)}
            </select>
          ) : (
            <input value={form.toZone} onChange={e => set('toZone', e.target.value)} placeholder="OUTSIDE" style={inputStyle} />
          )}
        </div>
        <div>
          <FieldLabel>Source</FieldLabel>
          <input value={form.src} onChange={e => set('src', e.target.value)} placeholder="any" style={inputStyle} />
        </div>
        <div>
          <FieldLabel>Destination</FieldLabel>
          <input value={form.dst} onChange={e => set('dst', e.target.value)} placeholder="any" style={inputStyle} />
        </div>
        <div>
          <FieldLabel>Service</FieldLabel>
          <select value={form.service} onChange={e => set('service', e.target.value)} style={selStyle}>
            {NAMED_SERVICES.map(s => (
              <option key={s} value={s}>{SERVICE_LABEL[s] ?? s}</option>
            ))}
          </select>
        </div>
        <div>
          <FieldLabel>Action</FieldLabel>
          <select value={form.action} onChange={e => set('action', e.target.value)} style={selStyle}>
            <option value="permit">PERMIT</option>
            <option value="deny">DENY</option>
          </select>
        </div>
      </div>

      {error && <div style={{ fontSize: 11, color: '#ff5555', marginBottom: 6 }}>⚠ {error}</div>}

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button type="button" onClick={onCancel} style={{
          padding: '4px 14px', fontSize: 11, background: 'transparent',
          color: '#444', border: '1px solid #222240', borderRadius: 3, cursor: 'pointer',
        }}>Cancel</button>
        <button type="submit" style={{
          padding: '4px 18px', fontSize: 11, fontWeight: 700,
          background: '#1a3060', color: '#4a90e2',
          border: '1px solid #2a4080', borderRadius: 3, cursor: 'pointer',
        }}>Add Rule</button>
      </div>
    </form>
  )
}

// ── ZONES tab ─────────────────────────────────────────────────────────────────

function ZonesTab({ device }) {
  const { refresh } = useGame()
  const ZONE_NAMES = ['INSIDE', 'OUTSIDE', 'DMZ']

  function setZone(ifaceName, zone) {
    if (!device.fw_zones) device.fw_zones = {}
    if (!zone) {
      delete device.fw_zones[ifaceName]
    } else {
      device.fw_zones[ifaceName] = zone
      if (!device.fw_security_levels) device.fw_security_levels = {}
      device.fw_security_levels[ifaceName] = zone === 'INSIDE' ? 100 : zone === 'DMZ' ? 50 : 0
    }
    device.fw_sessions = []  // zone changes invalidate existing sessions
    refresh()
  }

  const STATUS_COLOR = { up: '#50fa7b', down: '#ffb86c', admin_down: '#333355' }
  const STATUS_LABEL = { up: 'up/up', down: 'down/down', admin_down: 'admin down' }

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '0' }}>
      {/* Column headers */}
      <div style={{
        display: 'grid', gridTemplateColumns: '180px 100px 1fr 160px 120px',
        padding: '6px 14px', fontSize: 9, color: '#333355',
        letterSpacing: 0.6, fontWeight: 700, background: '#07090f',
        borderBottom: '1px solid #0d0d20', position: 'sticky', top: 0, zIndex: 1,
      }}>
        <span>INTERFACE</span>
        <span>IP ADDRESS</span>
        <span>STATUS</span>
        <span>ZONE</span>
        <span>SEC LEVEL</span>
      </div>

      {device.interfaces.filter(i => !i.parent).map(iface => {
        const zone     = device.fw_zones?.[iface.name] ?? ''
        const secLevel = device.fw_security_levels?.[iface.name] ?? null
        const statusC  = STATUS_COLOR[iface.status] ?? '#555'
        const statusL  = STATUS_LABEL[iface.status] ?? iface.status

        return (
          <div
            key={iface.name}
            style={{
              display: 'grid', gridTemplateColumns: '180px 100px 1fr 160px 120px',
              padding: '9px 14px', borderBottom: '1px solid #0d0d1a',
              alignItems: 'center',
            }}
          >
            <span style={{ fontSize: 11, color: '#6a9ad4', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {iface.name.replace('GigabitEthernet', 'Gi').replace('FastEthernet', 'Fa')}
            </span>
            <span style={{ fontSize: 11, color: iface.ip ? '#d0d0d0' : '#333355', fontFamily: 'monospace' }}>
              {iface.ip ?? '—'}
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{ width: 6, height: 6, borderRadius: '50%', background: statusC, flexShrink: 0 }} />
              <span style={{ fontSize: 10, color: statusC }}>{statusL}</span>
            </div>
            <div style={{ display: 'flex', gap: 4 }}>
              {['', ...ZONE_NAMES].map(z => (
                <button
                  key={z || 'none'}
                  onClick={() => setZone(iface.name, z)}
                  style={{
                    padding: '3px 8px', fontSize: 9, fontWeight: 700, letterSpacing: 0.5,
                    border: `1px solid ${zone === z ? zoneColor(z) : '#1a1a30'}`,
                    borderRadius: 3, cursor: 'pointer',
                    background: zone === z ? zoneColor(z) + '22' : 'transparent',
                    color: zone === z ? zoneColor(z) : '#333355',
                  }}
                >{z || 'NONE'}</button>
              ))}
            </div>
            <span style={{ fontSize: 10, color: '#555', fontFamily: 'monospace' }}>
              {secLevel !== null ? secLevel : '—'}
            </span>
          </div>
        )
      })}

      <div style={{ padding: '12px 14px', fontSize: 10, color: '#2a2a50', borderTop: '1px solid #0d0d20', lineHeight: 1.8 }}>
        Assign each interface to a zone to enable policy enforcement.
        Traffic crossing zone boundaries is checked against the POLICY rules.<br/>
        Security levels are informational only (not enforced — use explicit rules).
      </div>
    </div>
  )
}

// ── LOGS tab ──────────────────────────────────────────────────────────────────

function LogsTab({ device }) {
  const { refresh, tick } = useGame()
  const bottomRef = useRef(null)
  const log       = [...(device.fw_log ?? [])].reverse()  // newest first

  const VERDICT_COLOR = { permit: '#50fa7b', deny: '#ff5555', session: '#8be9fd' }
  const VERDICT_LABEL = { permit: 'PERMIT', deny: 'DENY', session: 'SESSION' }

  function clearLog() {
    device.fw_log = []
    refresh()
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Toolbar */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '6px 14px', background: '#080f1e',
        borderBottom: '1px solid #0d0d20', flexShrink: 0,
      }}>
        <span style={{ fontSize: 10, color: '#333355' }}>
          {log.length === 0 ? 'No traffic logged yet — run a ping to see firewall decisions here'
            : `${log.length} event${log.length !== 1 ? 's' : ''} — newest first`}
        </span>
        {log.length > 0 && (
          <button
            onClick={clearLog}
            style={{
              padding: '3px 10px', fontSize: 10, fontWeight: 700,
              background: 'transparent', color: '#555',
              border: '1px solid #222240', borderRadius: 3, cursor: 'pointer',
            }}
            onMouseEnter={e => { e.currentTarget.style.color = '#ff5555'; e.currentTarget.style.borderColor = '#3a1010' }}
            onMouseLeave={e => { e.currentTarget.style.color = '#555';    e.currentTarget.style.borderColor = '#222240' }}
          >CLEAR LOG</button>
        )}
      </div>

      {/* Column headers */}
      {log.length > 0 && (
        <div style={{
          display: 'grid', gridTemplateColumns: '80px 1fr 1fr 90px 80px 80px 80px',
          padding: '5px 14px', fontSize: 9, color: '#333355',
          letterSpacing: 0.6, fontWeight: 700, background: '#07090f',
          borderBottom: '1px solid #0d0d20', flexShrink: 0,
        }}>
          <span>TIME</span>
          <span>SOURCE</span>
          <span>DESTINATION</span>
          <span>SERVICE</span>
          <span>FROM</span>
          <span>TO</span>
          <span>VERDICT</span>
        </div>
      )}

      {/* Log rows */}
      <div style={{ flex: 1, overflowY: 'auto', fontFamily: 'monospace' }}>
        {log.length === 0 && (
          <div style={{ padding: '36px 16px', textAlign: 'center', color: '#2a2a50', fontSize: 11, lineHeight: 1.8 }}>
            No traffic logged yet.<br/>
            Ping through this firewall and the policy decisions will appear here.
          </div>
        )}
        {log.map((entry, i) => {
          const d   = new Date(entry.ts)
          const ts  = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`
          const svc = entry.protocol === 'icmp' ? 'ICMP'
            : entry.port ? `${entry.protocol?.toUpperCase()}/${entry.port}`
            : (entry.protocol?.toUpperCase() ?? 'ANY')
          const vc  = VERDICT_COLOR[entry.verdict] ?? '#888'
          const vl  = VERDICT_LABEL[entry.verdict] ?? entry.verdict
          return (
            <div
              key={i}
              style={{
                display: 'grid', gridTemplateColumns: '80px 1fr 1fr 90px 80px 80px 80px',
                padding: '5px 14px', fontSize: 10,
                borderBottom: '1px solid #080c18',
                background: entry.verdict === 'deny' ? '#1a030300' : 'transparent',
              }}
            >
              <span style={{ color: '#3a3a60' }}>{ts}</span>
              <span style={{ color: '#aaaacc', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.srcIp}</span>
              <span style={{ color: '#aaaacc', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.dstIp}</span>
              <span style={{ color: '#6a8ac4' }}>{svc}</span>
              <ZoneBadge zone={entry.fromZone} small />
              <ZoneBadge zone={entry.toZone} small />
              <span style={{ color: vc, fontWeight: 700, fontSize: 9, letterSpacing: 0.5 }}>{vl}</span>
            </div>
          )
        })}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}

// ── Small shared UI atoms ─────────────────────────────────────────────────────

function ZoneBadge({ zone, small }) {
  if (!zone) return <span style={{ fontSize: small ? 9 : 10, color: '#333355' }}>—</span>
  const c = zoneColor(zone)
  return (
    <span style={{
      fontSize: small ? 9 : 10, fontWeight: 700, letterSpacing: 0.4,
      color: c, background: c + '18',
      padding: '1px 5px', borderRadius: 3, border: `1px solid ${c}33`,
      display: 'inline-block',
    }}>{zone}</span>
  )
}

function ActionBadge({ action }) {
  const isPermit = action === 'permit'
  return (
    <span style={{
      fontSize: 9, fontWeight: 700, letterSpacing: 0.5,
      color: isPermit ? '#50fa7b' : '#ff5555',
      background: isPermit ? '#0a2010' : '#1a0505',
      padding: '2px 7px', borderRadius: 3,
      border: `1px solid ${isPermit ? '#1a4a20' : '#3a1010'}`,
      display: 'inline-block',
    }}>{isPermit ? 'ALLOW' : 'DENY'}</span>
  )
}

function StatusChip({ up, label }) {
  return (
    <span style={{
      fontSize: 8, fontWeight: 700, letterSpacing: 0.5,
      padding: '1px 5px', borderRadius: 3,
      background: up ? '#0a2a10' : '#2a1010',
      color: up ? '#50fa7b' : '#ff5555',
      border: `1px solid ${up ? '#1a4a20' : '#4a1a1a'}`,
    }}>{label}</span>
  )
}

function Pill({ label, color }) {
  return (
    <span style={{
      fontSize: 9, fontWeight: 700, letterSpacing: 0.3,
      color, background: color + '15',
      padding: '2px 7px', borderRadius: 10, border: `1px solid ${color}30`,
    }}>{label}</span>
  )
}

function FieldLabel({ children }) {
  return <div style={{ fontSize: 9, color: '#3a3a60', fontWeight: 700, letterSpacing: 0.5, marginBottom: 3 }}>{children}</div>
}

function RowBtn({ children, onClick, disabled, danger, title }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        width: 20, height: 20, padding: 0,
        background: 'none', border: 'none',
        color: disabled ? '#222240' : danger ? '#ff5555' : '#445',
        cursor: disabled ? 'default' : 'pointer', fontSize: 11, lineHeight: 1,
        borderRadius: 3,
      }}
      onMouseEnter={e => { if (!disabled) e.currentTarget.style.color = danger ? '#ff5555' : '#8888bb' }}
      onMouseLeave={e => { e.currentTarget.style.color = disabled ? '#222240' : danger ? '#ff5555' : '#445' }}
    >{children}</button>
  )
}

function zoneColor(zone) {
  if (!zone) return '#555'
  const z = zone.toUpperCase()
  if (z === 'INSIDE')  return '#50fa7b'
  if (z === 'OUTSIDE') return '#ff5555'
  if (z === 'DMZ')     return '#ffb86c'
  return '#8be9fd'
}
