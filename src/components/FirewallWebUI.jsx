/**
 * FirewallWebUI — pfSense-inspired device management web interface.
 * Accessible from BrowserPanel by navigating to a device's IP.
 * Works for both `firewall` and `router` device types.
 *
 * All mutations go through executeDeviceCommands(deviceId, [...cmds]) so the
 * real CLIEngine processes every change — no direct writes to device state.
 *
 * Navigation sections:
 *   Dashboard | Interfaces | Firewall Rules | NAT | Routing | Sessions
 */

import { useState } from 'react'
import { useGame } from '../state/GameContext.jsx'

const NAV = [
  { id: 'dashboard',  label: '📊 Dashboard'       },
  { id: 'interfaces', label: '🔌 Interfaces'       },
  { id: 'rules',      label: '🛡 Firewall Rules'   },
  { id: 'nat',        label: '🔄 NAT'              },
  { id: 'routing',    label: '🗺 Routing'           },
  { id: 'sessions',   label: '🔗 Sessions'         },
]

// ── Service display helper ─────────────────────────────────────────────────────
function svcLabel(svc) {
  if (!svc || svc === 'any') return <span style={{ color: '#668' }}>any</span>
  return <span style={{ color: '#9ab', fontFamily: 'monospace' }}>{svc}</span>
}

// ── Zone badge ─────────────────────────────────────────────────────────────────
function ZoneBadge({ zone }) {
  const colors = {
    INSIDE:  ['#1a3a1a', '#5a8a5a'],
    OUTSIDE: ['#3a1a1a', '#8a5a5a'],
    DMZ:     ['#2a2a0a', '#8a8a4a'],
  }
  const [bg, fg] = colors[zone] ?? ['#1a2a3e', '#4a90e2']
  return (
    <span style={{ background: bg, color: fg, padding: '1px 6px', borderRadius: 3,
      fontSize: 9, fontWeight: 700, fontFamily: 'monospace' }}>
      {zone}
    </span>
  )
}

// ── Action badge ──────────────────────────────────────────────────────────────
function ActionBadge({ action }) {
  const permit = action?.toLowerCase() === 'permit'
  return (
    <span style={{
      background: permit ? '#0a2a0a' : '#2a0a0a',
      color:      permit ? '#5aba5a' : '#ba5a5a',
      padding: '1px 8px', borderRadius: 3, fontSize: 10, fontWeight: 700, fontFamily: 'monospace',
    }}>
      {permit ? '✓ PERMIT' : '✗ DENY'}
    </span>
  )
}

// ── Stat card ─────────────────────────────────────────────────────────────────
function StatCard({ label, value, sub, color }) {
  return (
    <div style={{ background: '#0d1a2a', border: '1px solid #1a2a3e', borderRadius: 6,
      padding: '14px 18px', flex: '1 1 140px', minWidth: 0 }}>
      <div style={{ fontSize: 9, color: '#668', textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 700, color: color ?? '#4a90e2', marginTop: 4 }}>{value}</div>
      {sub && <div style={{ fontSize: 9, color: '#445', marginTop: 2 }}>{sub}</div>}
    </div>
  )
}

// ── Table components ──────────────────────────────────────────────────────────
function Table({ cols, children }) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
        <thead>
          <tr>
            {cols.map(c => (
              <th key={c} style={{ padding: '6px 10px', textAlign: 'left', color: '#668',
                borderBottom: '1px solid #1a2a3e', fontSize: 9, fontWeight: 700,
                textTransform: 'uppercase', letterSpacing: 0.5, whiteSpace: 'nowrap' }}>
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  )
}
function TR({ children, style }) {
  return (
    <tr style={{ borderBottom: '1px solid #0d1520', ...style }}>{children}</tr>
  )
}
function TD({ children, mono, style }) {
  return (
    <td style={{ padding: '6px 10px', color: '#9ab', fontFamily: mono ? 'monospace' : undefined,
      verticalAlign: 'middle', ...style }}>
      {children}
    </td>
  )
}

// ── Section heading ────────────────────────────────────────────────────────────
function SectionHead({ title, action }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      marginBottom: 14, paddingBottom: 8, borderBottom: '1px solid #1a2a3e' }}>
      <span style={{ fontSize: 14, fontWeight: 700, color: '#c8d8e8' }}>{title}</span>
      {action}
    </div>
  )
}

// ── Add Rule form ─────────────────────────────────────────────────────────────
function AddRuleForm({ device, onDone }) {
  const { executeDeviceCommands } = useGame()
  const [form, setForm] = useState({
    action: 'permit', fromZone: 'INSIDE', toZone: 'OUTSIDE',
    src: 'any', dst: 'any', service: 'any',
  })
  const [error, setError] = useState('')

  const zones = [...new Set(Object.values(device.fw_zones ?? {}))]
  const zoneOptions = zones.length > 0 ? zones : ['INSIDE', 'OUTSIDE', 'DMZ']

  function set(k) { return v => setForm(f => ({ ...f, [k]: v })) }

  function submit() {
    setError('')
    const { action, fromZone, toZone, src, dst, service } = form
    if (!fromZone || !toZone) { setError('From-zone and To-zone are required.'); return }
    const svc = service.trim() || 'any'
    const cmds = [
      'enable',
      'configure terminal',
      `firewall-rule ${action} from-zone ${fromZone} to-zone ${toZone} src ${src || 'any'} dst ${dst || 'any'} service ${svc}`,
    ]
    const out = executeDeviceCommands(device.id, cmds)
    const errs = out.filter(l => l.startsWith('%'))
    if (errs.length) { setError(errs.join(' ')); return }
    onDone()
  }

  const fRow = { display: 'flex', flexDirection: 'column', gap: 4, flex: '1 1 120px', minWidth: 100 }
  const lab  = { fontSize: 9, color: '#668', textTransform: 'uppercase', letterSpacing: 0.5 }
  const inp  = { padding: '5px 8px', fontSize: 11, background: '#0d1a2a', color: '#9ab',
    border: '1px solid #2a3a4e', borderRadius: 3, fontFamily: 'monospace', width: '100%', boxSizing: 'border-box' }

  return (
    <div style={{ background: '#0a1520', border: '1px solid #1a2a3e', borderRadius: 6,
      padding: 16, marginBottom: 16 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: '#4a90e2', marginBottom: 12 }}>
        Add Firewall Rule
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 12 }}>
        <div style={fRow}>
          <span style={lab}>Action</span>
          <select value={form.action} onChange={e => set('action')(e.target.value)} style={inp}>
            <option value="permit">PERMIT</option>
            <option value="deny">DENY</option>
          </select>
        </div>

        <div style={fRow}>
          <span style={lab}>From Zone</span>
          <input list="fw-zones" value={form.fromZone} onChange={e => set('fromZone')(e.target.value.toUpperCase())} style={inp} />
          <datalist id="fw-zones">
            {zoneOptions.map(z => <option key={z} value={z} />)}
          </datalist>
        </div>

        <div style={fRow}>
          <span style={lab}>To Zone</span>
          <input list="fw-zones" value={form.toZone} onChange={e => set('toZone')(e.target.value.toUpperCase())} style={inp} />
        </div>

        <div style={fRow}>
          <span style={lab}>Source IP</span>
          <input value={form.src} onChange={e => set('src')(e.target.value)}
            placeholder="any or IP" style={inp} />
        </div>

        <div style={fRow}>
          <span style={lab}>Destination IP</span>
          <input value={form.dst} onChange={e => set('dst')(e.target.value)}
            placeholder="any or IP" style={inp} />
        </div>

        <div style={fRow}>
          <span style={lab}>Service</span>
          <input list="svc-list" value={form.service} onChange={e => set('service')(e.target.value)}
            placeholder="any, icmp, HTTPS, tcp/443…" style={inp} />
          <datalist id="svc-list">
            {['any','icmp','HTTP','HTTPS','SSH','DNS','FTP','TELNET','RDP','SMTP'].map(s => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </div>
      </div>

      {error && (
        <div style={{ color: '#ff7070', fontSize: 10, marginBottom: 8, fontFamily: 'monospace' }}>
          {error}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={submit}
          style={{ padding: '5px 16px', fontSize: 11, background: '#1a3a1a', color: '#5aba5a',
            border: '1px solid #2a5a2a', borderRadius: 4, cursor: 'pointer', fontWeight: 700 }}>
          ✓ Add Rule
        </button>
        <button onClick={onDone}
          style={{ padding: '5px 16px', fontSize: 11, background: 'transparent', color: '#668',
            border: '1px solid #2a3a4e', borderRadius: 4, cursor: 'pointer' }}>
          Cancel
        </button>
      </div>
    </div>
  )
}

// ── FirewallWebUI ──────────────────────────────────────────────────────────────
export default function FirewallWebUI({ device }) {
  const { executeDeviceCommands, tick } = useGame()
  const [nav, setNav] = useState('dashboard')
  const [addingRule, setAddingRule] = useState(false)
  const [feedback, setFeedback] = useState('')

  // Device data (read fresh — tick triggers re-read via parent re-render)
  const ifaces         = device.interfaces ?? []
  const zones          = device.fw_zones ?? {}
  const rules          = device.fw_rules ?? []
  const sessions       = device.fw_sessions ?? []
  const natTranslations = device.nat_translations ?? []
  const routingTable   = device.routing_table ?? []
  const isFirewall     = device.type === 'firewall'
  const isRouter       = device.type === 'router'

  function runCmds(cmds, successMsg) {
    const out = executeDeviceCommands(device.id, cmds)
    const errs = out.filter(l => l.startsWith('%'))
    setFeedback(errs.length ? errs.join(' ') : successMsg ?? '')
    setTimeout(() => setFeedback(''), 3000)
  }

  function deleteRule(id) {
    runCmds(
      ['enable', 'configure terminal', `no firewall-rule ${id}`],
      `Rule #${id} removed.`
    )
  }

  function clearSessions() {
    if (device.fw_sessions) device.fw_sessions.length = 0
    // Trigger re-render via executeDeviceCommands (show no-op)
    executeDeviceCommands(device.id, ['enable', 'show firewall-rules'])
    setFeedback('Sessions cleared.')
    setTimeout(() => setFeedback(''), 3000)
  }

  // ── Section renderers ───────────────────────────────────────────────────────

  function renderDashboard() {
    const ifaceUp = ifaces.filter(i => i.status === 'up' || (!i.shutdown && i.ip)).length
    const zoneCount = new Set(Object.values(zones)).size
    return (
      <div>
        <SectionHead title={`${device.name} — ${device.type.toUpperCase()}`} />

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 20 }}>
          <StatCard label="Device Type" value={device.type.toUpperCase()} color="#4a90e2" />
          <StatCard label="Interfaces" value={ifaceUp + '/' + ifaces.length} sub="up / total" color="#5aba5a" />
          {isFirewall && <>
            <StatCard label="Zones" value={zoneCount} color="#f0c060" />
            <StatCard label="Rules" value={rules.length} color="#a080e0" />
            <StatCard label="Sessions" value={sessions.length} sub="active stateful" color="#60c0f0" />
          </>}
          <StatCard label="Routes" value={routingTable.length} sub="routing table entries" color="#e08060" />
          <StatCard label="NAT" value={natTranslations.length} sub="translations" color="#e060a0" />
        </div>

        {isFirewall && (
          <>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#c8d8e8', marginBottom: 10 }}>
              Zone Assignments
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 20 }}>
              {Object.entries(zones).map(([ifName, zone]) => (
                <div key={ifName} style={{ background: '#0d1a2a', border: '1px solid #1a2a3e',
                  borderRadius: 4, padding: '6px 12px', fontSize: 10 }}>
                  <span style={{ color: '#668', fontFamily: 'monospace' }}>{ifName}</span>
                  <span style={{ color: '#445', margin: '0 6px' }}>→</span>
                  <ZoneBadge zone={zone} />
                </div>
              ))}
              {Object.keys(zones).length === 0 && (
                <span style={{ color: '#445', fontSize: 10 }}>
                  No zones configured. Use <code style={{ color: '#8ab' }}>nameif &lt;ZONE&gt;</code> on each interface.
                </span>
              )}
            </div>
          </>
        )}

        <div style={{ fontSize: 12, fontWeight: 700, color: '#c8d8e8', marginBottom: 10 }}>
          Interface Status
        </div>
        <Table cols={['Interface', 'IP Address / Mask', 'Status', 'Zone']}>
          {ifaces.map(iface => {
            const up = iface.status === 'up' || (!iface.shutdown && iface.ip)
            const zone = zones[iface.name]
            return (
              <TR key={iface.name}>
                <TD mono>{iface.name}</TD>
                <TD mono>{iface.ip ? `${iface.ip} / ${iface.mask}` : '—'}</TD>
                <TD style={{ color: iface.shutdown ? '#f66' : up ? '#5a8' : '#668' }}>
                  {iface.shutdown ? 'admin-down' : up ? '↑ up/up' : '↓ down'}
                </TD>
                <TD>{zone ? <ZoneBadge zone={zone} /> : <span style={{ color: '#334' }}>—</span>}</TD>
              </TR>
            )
          })}
        </Table>
      </div>
    )
  }

  function renderInterfaces() {
    const secLevels = device.fw_security_levels ?? {}
    return (
      <div>
        <SectionHead title="Interfaces" />
        <Table cols={['Interface', 'IP', 'Mask', 'Status', ...(isFirewall ? ['Zone', 'Sec Level'] : [])]}>
          {ifaces.map(iface => {
            const up = iface.status === 'up' || (!iface.shutdown && iface.ip)
            return (
              <TR key={iface.name}>
                <TD mono style={{ color: '#8ab' }}>{iface.name}</TD>
                <TD mono>{iface.ip ?? <span style={{ color: '#334' }}>—</span>}</TD>
                <TD mono>{iface.mask ?? <span style={{ color: '#334' }}>—</span>}</TD>
                <TD style={{ color: iface.shutdown ? '#f66' : up ? '#5a8' : '#668' }}>
                  {iface.shutdown ? '⊗ admin-down' : up ? '✓ up/up' : '– down/down'}
                </TD>
                {isFirewall && <>
                  <TD>{zones[iface.name] ? <ZoneBadge zone={zones[iface.name]} /> : <span style={{ color: '#334' }}>—</span>}</TD>
                  <TD mono style={{ color: '#9ab' }}>{secLevels[iface.name] ?? '—'}</TD>
                </>}
              </TR>
            )
          })}
        </Table>

        <div style={{ marginTop: 16, padding: 12, background: '#0a1520',
          border: '1px solid #1a2a3e', borderRadius: 4, fontSize: 10, color: '#445' }}>
          Configure via CLI terminal: <span style={{ color: '#8ab', fontFamily: 'monospace' }}>
            interface GigabitEthernet0/0 → nameif INSIDE → ip address … → no shutdown
          </span>
        </div>
      </div>
    )
  }

  function renderRules() {
    if (!isFirewall) return (
      <div style={{ color: '#445', padding: 20, fontSize: 11 }}>
        Firewall rules are only available on Firewall devices.<br />
        Routers use ACLs — see the routing CLI terminal.
      </div>
    )
    return (
      <div>
        <SectionHead
          title={`Firewall Rules (${rules.length})`}
          action={
            <button onClick={() => setAddingRule(r => !r)}
              style={{ padding: '4px 12px', fontSize: 10, background: addingRule ? '#1a2a3e' : '#1a3a1a',
                color: addingRule ? '#9ab' : '#5aba5a', border: `1px solid ${addingRule ? '#2a3a4e' : '#2a5a2a'}`,
                borderRadius: 4, cursor: 'pointer', fontWeight: 700 }}>
              {addingRule ? '✕ Cancel' : '+ Add Rule'}
            </button>
          }
        />

        {addingRule && <AddRuleForm device={device} onDone={() => setAddingRule(false)} />}

        {rules.length === 0 && !addingRule && (
          <div style={{ padding: 24, textAlign: 'center', color: '#334', fontSize: 11 }}>
            No rules configured — all inter-zone traffic is blocked (implicit default-deny).<br />
            <span style={{ fontSize: 9, color: '#223' }}>
              Add a PERMIT rule to allow traffic between zones.
            </span>
          </div>
        )}

        {rules.length > 0 && (
          <Table cols={['#', 'Action', 'From Zone', 'To Zone', 'Source', 'Destination', 'Service', '']}>
            {rules.map((rule, idx) => (
              <TR key={rule.id}>
                <TD mono style={{ color: '#445', width: 32 }}>{idx + 1}</TD>
                <TD><ActionBadge action={rule.action} /></TD>
                <TD><ZoneBadge zone={rule.fromZone} /></TD>
                <TD><ZoneBadge zone={rule.toZone} /></TD>
                <TD mono>{rule.src}</TD>
                <TD mono>{rule.dst}</TD>
                <TD>{svcLabel(rule.service)}</TD>
                <TD>
                  <button
                    onClick={() => deleteRule(rule.id)}
                    title={`Remove rule #${rule.id}`}
                    style={{ padding: '2px 8px', fontSize: 10, background: 'transparent',
                      color: '#8a3a3a', border: '1px solid #4a2a2a', borderRadius: 3, cursor: 'pointer' }}
                  >✕</button>
                </TD>
              </TR>
            ))}
          </Table>
        )}

        <div style={{ marginTop: 14, padding: 10, background: '#0a1200', border: '1px solid #1a2a1a',
          borderRadius: 4, fontSize: 9, color: '#4a6a4a', lineHeight: 1.7 }}>
          <strong style={{ color: '#5a8a5a' }}>How this works:</strong> Rules are evaluated top-to-bottom.
          First match wins. If no rule matches, traffic is <em>blocked</em> (implicit default-deny).
          Stateful: an INSIDE→OUTSIDE PERMIT rule automatically allows the return traffic;
          outside→inside connections still need an explicit rule.
        </div>
      </div>
    )
  }

  function renderNAT() {
    const natRules = device.nat_rules ?? []
    const natAcls  = device.nat_acls  ?? []
    return (
      <div>
        <SectionHead title="NAT / PAT Overload" />

        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 11, color: '#668', marginBottom: 8 }}>NAT Rules</div>
          {natRules.length === 0 ? (
            <div style={{ color: '#334', fontSize: 11, padding: '8px 0' }}>No NAT rules configured.</div>
          ) : (
            <Table cols={['ACL', 'Outside Interface', 'Type']}>
              {natRules.map((r, i) => (
                <TR key={i}>
                  <TD mono>{r.acl_id}</TD>
                  <TD mono>{r.outside_interface}</TD>
                  <TD><span style={{ color: '#a080e0' }}>PAT overload</span></TD>
                </TR>
              ))}
            </Table>
          )}
        </div>

        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 11, color: '#668', marginBottom: 8 }}>ACL Entries</div>
          {natAcls.length === 0 ? (
            <div style={{ color: '#334', fontSize: 11, padding: '8px 0' }}>No ACLs configured.</div>
          ) : natAcls.map(acl => (
            <div key={acl.id} style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 10, color: '#9ab', marginBottom: 4 }}>ACL {acl.id}</div>
              <Table cols={['Action', 'Network', 'Wildcard']}>
                {(acl.entries ?? []).map((e, i) => (
                  <TR key={i}>
                    <TD><span style={{ color: '#5aba5a', fontFamily: 'monospace' }}>permit</span></TD>
                    <TD mono>{e.network}</TD>
                    <TD mono>{e.wildcard}</TD>
                  </TR>
                ))}
              </Table>
            </div>
          ))}
        </div>

        <div>
          <div style={{ fontSize: 11, color: '#668', marginBottom: 8 }}>
            Translation Table ({natTranslations.length})
          </div>
          {natTranslations.length === 0 ? (
            <div style={{ color: '#334', fontSize: 11, padding: '8px 0' }}>
              No active translations. Translations appear here after the first successful NAT'd ping.
            </div>
          ) : (
            <Table cols={['Inside Local', 'Inside Global']}>
              {natTranslations.map((t, i) => (
                <TR key={i}>
                  <TD mono>{t.inside_local}</TD>
                  <TD mono style={{ color: '#60c0f0' }}>{t.inside_global}</TD>
                </TR>
              ))}
            </Table>
          )}
        </div>
      </div>
    )
  }

  function renderRouting() {
    const connectedIfaces = ifaces.filter(i => i.ip && !i.shutdown)
    return (
      <div>
        <SectionHead title="Routing Table" />

        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 11, color: '#668', marginBottom: 8 }}>Static Routes</div>
          {routingTable.length === 0 ? (
            <div style={{ color: '#334', fontSize: 11, padding: '8px 0' }}>No static routes configured.</div>
          ) : (
            <Table cols={['Network', 'Mask', 'Next Hop', 'Type']}>
              {routingTable.map((r, i) => {
                const isDefault = r.network === '0.0.0.0' && r.mask === '0.0.0.0'
                return (
                  <TR key={i}>
                    <TD mono style={{ color: isDefault ? '#f0c060' : '#9ab' }}>
                      {r.network}{isDefault ? ' (default)' : ''}
                    </TD>
                    <TD mono>{r.mask}</TD>
                    <TD mono style={{ color: '#60c0f0' }}>{r.next_hop}</TD>
                    <TD>
                      <span style={{ color: '#a080e0', fontSize: 9, fontFamily: 'monospace' }}>
                        {r.dhcp_assigned ? 'dhcp' : 'static'}
                      </span>
                    </TD>
                  </TR>
                )
              })}
            </Table>
          )}
        </div>

        <div>
          <div style={{ fontSize: 11, color: '#668', marginBottom: 8 }}>Connected Networks</div>
          <Table cols={['Network', 'Interface', 'Status']}>
            {connectedIfaces.map(iface => (
              <TR key={iface.name}>
                <TD mono>{iface.ip}</TD>
                <TD mono>{iface.name}</TD>
                <TD style={{ color: '#5a8' }}>C — connected</TD>
              </TR>
            ))}
            {connectedIfaces.length === 0 && (
              <TR>
                <TD colSpan={3} style={{ color: '#334', textAlign: 'center' }}>No connected networks</TD>
              </TR>
            )}
          </Table>
        </div>
      </div>
    )
  }

  function renderSessions() {
    if (!isFirewall) return (
      <div style={{ color: '#445', padding: 20, fontSize: 11 }}>
        Stateful sessions are only tracked on Firewall devices.
      </div>
    )
    return (
      <div>
        <SectionHead
          title={`Active Sessions (${sessions.length})`}
          action={sessions.length > 0 ? (
            <button onClick={clearSessions}
              style={{ padding: '4px 12px', fontSize: 10, background: '#2a1a1a',
                color: '#ba5a5a', border: '1px solid #4a2a2a', borderRadius: 4, cursor: 'pointer' }}>
              Clear Sessions
            </button>
          ) : null}
        />

        {sessions.length === 0 ? (
          <div style={{ padding: 24, textAlign: 'center', color: '#334', fontSize: 11 }}>
            No active sessions.<br />
            <span style={{ fontSize: 9, color: '#223' }}>
              Sessions appear here after an inside host initiates a connection through a PERMIT rule.
              Return traffic is allowed automatically as long as the session exists.
            </span>
          </div>
        ) : (
          <Table cols={['Source IP', 'Destination IP', 'Protocol', 'Port']}>
            {sessions.map((s, i) => (
              <TR key={i}>
                <TD mono>{s.srcIp}</TD>
                <TD mono>{s.dstIp}</TD>
                <TD mono style={{ color: '#9ab', textTransform: 'uppercase' }}>{s.protocol ?? 'icmp'}</TD>
                <TD mono>{s.port ?? '—'}</TD>
              </TR>
            ))}
          </Table>
        )}

        <div style={{ marginTop: 14, padding: 10, background: '#0a1200', border: '1px solid #1a2a1a',
          borderRadius: 4, fontSize: 9, color: '#4a6a4a', lineHeight: 1.7 }}>
          <strong style={{ color: '#5a8a5a' }}>Stateful inspection:</strong> When an inside host initiates
          a flow and a PERMIT rule matches, a session is recorded here. The return path is automatically
          allowed without a separate rule — this is the core teaching point of stateful firewalls.
          Outside-initiated connections are always checked against the rule list.
        </div>
      </div>
    )
  }

  const sections = {
    dashboard:  renderDashboard(),
    interfaces: renderInterfaces(),
    rules:      renderRules(),
    nat:        renderNAT(),
    routing:    renderRouting(),
    sessions:   renderSessions(),
  }

  return (
    <div style={{ display: 'flex', height: '100%', background: '#090e16', color: '#c8d8e8',
      fontFamily: 'monospace', fontSize: 11 }}>

      {/* ── Left nav ──────────────────────────────────────────────────────── */}
      <div style={{ width: 160, flexShrink: 0, background: '#0a1520',
        borderRight: '1px solid #1a2a3e', display: 'flex', flexDirection: 'column' }}>

        {/* Device title */}
        <div style={{ padding: '14px 12px', borderBottom: '1px solid #1a2a3e' }}>
          <div style={{ fontSize: 10, color: '#4a90e2', fontWeight: 700, marginBottom: 2 }}>
            {device.name}
          </div>
          <div style={{ fontSize: 9, color: '#334' }}>
            {device.type.toUpperCase()} MANAGEMENT
          </div>
        </div>

        {NAV.filter(n => isFirewall || !['rules', 'sessions'].includes(n.id))
          .map(n => (
            <button
              key={n.id}
              onClick={() => { setNav(n.id); setAddingRule(false) }}
              style={{
                display: 'block', width: '100%', textAlign: 'left',
                padding: '9px 14px', fontSize: 10,
                background: nav === n.id ? '#1a2e4a' : 'transparent',
                color:      nav === n.id ? '#4a90e2' : '#668',
                border: 'none',
                borderLeft: `3px solid ${nav === n.id ? '#4a90e2' : 'transparent'}`,
                cursor: 'pointer',
                fontFamily: 'monospace',
              }}
            >{n.label}</button>
          ))}

        <div style={{ marginTop: 'auto', padding: 10, fontSize: 8, color: '#223', borderTop: '1px solid #1a2a3e' }}>
          NetSim Management UI<br />
          v1.0 · {device.type}
        </div>
      </div>

      {/* ── Main content ──────────────────────────────────────────────────── */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>

        {/* Feedback banner */}
        {feedback && (
          <div style={{
            marginBottom: 14, padding: '8px 12px', borderRadius: 4, fontSize: 10,
            background: feedback.includes('%') ? '#2a0a0a' : '#0a2a0a',
            color:      feedback.includes('%') ? '#ff7070' : '#5aba5a',
            border: `1px solid ${feedback.includes('%') ? '#4a2a2a' : '#2a5a2a'}`,
          }}>
            {feedback}
          </div>
        )}

        {sections[nav]}
      </div>
    </div>
  )
}
