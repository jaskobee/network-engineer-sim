/**
 * DEV / QA PANEL — only rendered when import.meta.env.DEV is true.
 *
 * Gate:  Vite strips this entire component in production builds.
 * Toggle: Ctrl+Shift+D (wired in App.jsx).
 * Banner: persistent "⚠ DEV MODE" label in the header while open.
 *
 * Tabs:
 *   MISSIONS  — jump to any mission, unlock all, set balance, force-complete
 *   PRESETS   — apply a working or broken topology preset
 *   INSPECTOR — live view of all sandbox devices (interfaces, routes, DHCP)
 *   SMOKE     — run the foundation smoke test suite and report pass/fail
 *   UTILS     — force refresh, export/import sandbox JSON
 */

import { useState, useRef } from 'react'
import { useGame } from '../state/GameContext.jsx'
import { MISSIONS } from '../data/missions.js'
import { PRESETS, buildPreset } from '../devMode/presets.js'
import { runSmokeTests } from '../devMode/smokeTests.js'

// ── Shared micro-styles ───────────────────────────────────────────────────────

const S = {
  btn: (color = '#4a90e2') => ({
    padding: '4px 12px', fontSize: 10, fontWeight: 700,
    background: color + '22', color, border: `1px solid ${color}66`,
    borderRadius: 3, cursor: 'pointer', letterSpacing: 0.5,
  }),
  dangerBtn: {
    padding: '4px 12px', fontSize: 10, fontWeight: 700,
    background: '#ff555522', color: '#ff5555', border: '1px solid #ff555566',
    borderRadius: 3, cursor: 'pointer', letterSpacing: 0.5,
  },
  label: { fontSize: 9, color: '#555', letterSpacing: 0.5, marginBottom: 3, display: 'block' },
  input: {
    width: '100%', background: '#07070d', color: '#c0c0e0',
    border: '1px solid #1a1a3e', borderRadius: 3, padding: '4px 6px',
    fontSize: 11, fontFamily: 'monospace',
  },
  select: {
    width: '100%', background: '#07070d', color: '#c0c0e0',
    border: '1px solid #1a1a3e', borderRadius: 3, padding: '4px 6px',
    fontSize: 11,
  },
  row: { display: 'flex', gap: 6, alignItems: 'center', marginBottom: 8 },
  section: { marginBottom: 14 },
  sectionTitle: { fontSize: 9, color: '#4a90e2', fontWeight: 700, letterSpacing: 1, marginBottom: 6 },
  mono: { fontFamily: 'monospace', fontSize: 10 },
}

// ── Tab: MISSIONS ─────────────────────────────────────────────────────────────

function MissionsTab() {
  const {
    activeMissionId, completedMissions, budget, mode,
    devSetBalance, devUnlockAllMissions, devSetActiveMission, devForceComplete,
  } = useGame()
  const [jumpId, setJumpId]       = useState(MISSIONS[0].id)
  const [balance, setBalance]     = useState('99999')
  const [msg, setMsg]             = useState(null)

  function notify(text) { setMsg(text); setTimeout(() => setMsg(null), 2500) }

  return (
    <div>
      <div style={S.section}>
        <div style={S.sectionTitle}>JUMP TO MISSION</div>
        <div style={S.row}>
          <select value={jumpId} onChange={e => setJumpId(e.target.value)} style={{ ...S.select, flex: 1 }}>
            {MISSIONS.map(m => (
              <option key={m.id} value={m.id}>{m.id} — {m.title}</option>
            ))}
          </select>
          <button
            style={S.btn()}
            onClick={() => { devSetActiveMission(jumpId); notify(`Jumped to ${jumpId}`) }}
          >GO</button>
        </div>
        <div style={{ fontSize: 9, color: '#444', lineHeight: 1.5 }}>
          Skips prerequisite gate. Clears current workspace and places ISP.
        </div>
      </div>

      <div style={S.section}>
        <div style={S.sectionTitle}>UNLOCK ALL MISSIONS</div>
        <div style={S.row}>
          <button style={S.btn('#50fa7b')} onClick={() => { devUnlockAllMissions(); notify('All missions unlocked') }}>
            UNLOCK ALL
          </button>
          <span style={{ fontSize: 9, color: '#333360' }}>
            Marks all as completed (reward=$0 to signal dev action)
          </span>
        </div>
      </div>

      <div style={S.section}>
        <div style={S.sectionTitle}>SET BALANCE</div>
        <div style={S.row}>
          <input
            type="number"
            value={balance}
            onChange={e => setBalance(e.target.value)}
            style={{ ...S.input, width: 90 }}
          />
          <button style={S.btn()} onClick={() => { devSetBalance(balance); notify(`Balance set to $${balance}`) }}>
            SET
          </button>
          <span style={{ fontSize: 9, color: '#444' }}>current: ${budget}</span>
        </div>
      </div>

      <div style={S.section}>
        <div style={S.sectionTitle}>FORCE COMPLETE</div>
        <div style={S.row}>
          <button
            style={activeMissionId ? S.dangerBtn : { ...S.dangerBtn, opacity: 0.4, cursor: 'not-allowed' }}
            disabled={!activeMissionId}
            onClick={() => {
              if (!activeMissionId) return
              devForceComplete()
              notify(`Force-completed ${activeMissionId}`)
            }}
          >
            FORCE COMPLETE
          </button>
          <span style={{ fontSize: 9, color: '#444' }}>
            {activeMissionId ? `active: ${activeMissionId}` : 'no active mission'}
          </span>
        </div>
        <div style={{ fontSize: 9, color: '#333360' }}>
          Triggers reward + unlock flow without solving tasks.
        </div>
      </div>

      <div style={{ fontSize: 9, color: '#444', borderTop: '1px solid #1a1a3e', paddingTop: 8 }}>
        Mode: <span style={{ color: '#e0e0e0' }}>{mode}</span> ·
        Completed: <span style={{ color: '#e0e0e0' }}>{completedMissions.length}/{MISSIONS.length}</span>
      </div>

      {msg && (
        <div style={{ marginTop: 8, padding: '4px 8px', background: '#1a4a1a', color: '#50fa7b', fontSize: 10, borderRadius: 3 }}>
          ✓ {msg}
        </div>
      )}
    </div>
  )
}

// ── Tab: PRESETS ──────────────────────────────────────────────────────────────

function PresetsTab() {
  const ctx = useGame()
  const [selectedId, setSelectedId]   = useState(PRESETS[0].id)
  const [result, setResult]           = useState(null)
  const [applying, setApplying]       = useState(false)

  const selected = PRESETS.find(p => p.id === selectedId)

  function apply() {
    setApplying(true)
    setResult(null)
    try {
      const r = buildPreset(selectedId, ctx)
      ctx.refresh()
      setResult(r)
    } catch (e) {
      setResult({ type: 'error', message: e.message })
    } finally {
      setApplying(false)
    }
  }

  function resultColor(r) {
    if (!r) return '#444'
    if (r.type === 'error') return '#ff5555'
    if (r.type === 'ping')  return r.reachable ? '#50fa7b' : '#ffb86c'
    if (r.type === 'dhcp')  return r.assigned  ? '#50fa7b' : '#ffb86c'
    return '#444'
  }

  function resultLabel(r) {
    if (!r) return ''
    if (r.type === 'error') return `ERROR: ${r.message}`
    if (r.type === 'ping') {
      return r.reachable
        ? `✓ ping ${r.src} → ${r.dst} reachable`
        : `✗ ping ${r.src} → ${r.dst} FAILED — ${r.failureReason}${r.failurePoint ? ` @ ${r.failurePoint}` : ''}`
    }
    if (r.type === 'dhcp') {
      return r.assigned
        ? `✓ DHCP assigned ${r.assignedIp}`
        : `✗ DHCP failed — ${r.failureReason}`
    }
    return JSON.stringify(r)
  }

  const working = PRESETS.filter(p => p.category === 'working')
  const broken  = PRESETS.filter(p => p.category === 'broken')

  return (
    <div>
      <div style={S.section}>
        <div style={S.sectionTitle}>SELECT PRESET</div>

        <div style={{ marginBottom: 6 }}>
          <div style={{ fontSize: 9, color: '#50fa7b', marginBottom: 3 }}>▶ WORKING</div>
          {working.map(p => (
            <label key={p.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 6, marginBottom: 4, cursor: 'pointer' }}>
              <input type="radio" name="preset" value={p.id} checked={selectedId === p.id} onChange={() => setSelectedId(p.id)} />
              <span style={{ fontSize: 10, color: selectedId === p.id ? '#e0e0e0' : '#888' }}>{p.label}</span>
            </label>
          ))}
        </div>

        <div>
          <div style={{ fontSize: 9, color: '#ffb86c', marginBottom: 3 }}>✗ BROKEN (should fail)</div>
          {broken.map(p => (
            <label key={p.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 6, marginBottom: 4, cursor: 'pointer' }}>
              <input type="radio" name="preset" value={p.id} checked={selectedId === p.id} onChange={() => setSelectedId(p.id)} />
              <span style={{ fontSize: 10, color: selectedId === p.id ? '#e0e0e0' : '#888' }}>
                {p.label}
                {p.expectedFailure && <span style={{ color: '#ff555588', marginLeft: 4 }}>({p.expectedFailure})</span>}
              </span>
            </label>
          ))}
        </div>
      </div>

      {selected && (
        <div style={{ fontSize: 9, color: '#444', marginBottom: 10, lineHeight: 1.6 }}>
          {selected.description}
        </div>
      )}

      <button style={{ ...S.btn('#4a90e2'), opacity: applying ? 0.5 : 1 }} onClick={apply} disabled={applying}>
        {applying ? 'BUILDING…' : '▶ APPLY PRESET'}
      </button>
      <span style={{ fontSize: 9, color: '#333360', marginLeft: 8 }}>Switches to Sandbox · clears existing topology</span>

      {result && (
        <div style={{
          marginTop: 10, padding: '6px 8px', background: '#0a0f1e',
          border: `1px solid ${resultColor(result)}44`, borderRadius: 4,
          fontSize: 10, color: resultColor(result), fontFamily: 'monospace', lineHeight: 1.5,
        }}>
          {resultLabel(result)}
        </div>
      )}
    </div>
  )
}

// ── Tab: INSPECTOR ────────────────────────────────────────────────────────────

function InspectorTab() {
  const { sbTopology, topology, mode, tick } = useGame()   // tick triggers re-render
  const [showTopo, setShowTopo] = useState('sandbox')

  const topo = showTopo === 'sandbox' ? sbTopology : topology
  const devices = [...topo.devices.values()]

  const [pingSrc, setPingSrc] = useState('')
  const [pingDst, setPingDst] = useState('')
  const [pingResult, setPingResult] = useState(null)

  function runPing() {
    if (!pingSrc || !pingDst) return
    const r = topo.checkPing(pingSrc.trim(), pingDst.trim())
    setPingResult(r)
  }

  return (
    <div>
      <div style={{ ...S.row, marginBottom: 10 }}>
        <span style={{ fontSize: 9, color: '#555' }}>TOPOLOGY:</span>
        {(['sandbox', 'missions']).map(t => (
          <button
            key={t}
            onClick={() => setShowTopo(t)}
            style={{
              ...S.btn(showTopo === t ? '#4a90e2' : '#333360'),
              padding: '3px 8px',
            }}
          >{t.toUpperCase()}</button>
        ))}
        <span style={{ fontSize: 9, color: '#333360', marginLeft: 4 }}>{devices.length} device{devices.length !== 1 ? 's' : ''}</span>
      </div>

      {/* Ping check */}
      <div style={{ ...S.section, background: '#07070d', padding: 8, borderRadius: 4, border: '1px solid #1a1a3e' }}>
        <div style={S.sectionTitle}>PING CHECK</div>
        <div style={S.row}>
          <input placeholder="src IP" value={pingSrc} onChange={e => setPingSrc(e.target.value)}
            style={{ ...S.input, width: 110 }} />
          <span style={{ color: '#444', fontSize: 12 }}>→</span>
          <input placeholder="dst IP" value={pingDst} onChange={e => setPingDst(e.target.value)}
            style={{ ...S.input, width: 110 }} />
          <button style={S.btn()} onClick={runPing}>CHECK</button>
        </div>
        {pingResult && (
          <div style={{ fontSize: 10, fontFamily: 'monospace', color: pingResult.reachable ? '#50fa7b' : '#ffb86c', marginTop: 4 }}>
            {pingResult.reachable
              ? `✓ reachable`
              : `✗ ${pingResult.failureReason}${pingResult.failurePoint ? ` @ ${pingResult.failurePoint}` : ''}`}
          </div>
        )}
      </div>

      {/* Device list */}
      <div style={{ marginTop: 8 }}>
        {devices.length === 0 && (
          <div style={{ fontSize: 10, color: '#333360', textAlign: 'center', padding: 16 }}>
            No devices in {showTopo} topology
          </div>
        )}
        {devices.map(dev => <DeviceCard key={dev.id} dev={dev} />)}
      </div>
    </div>
  )
}

function DeviceCard({ dev }) {
  const [open, setOpen] = useState(false)
  const routeCount = (dev.routing_table || []).length
  const dhcpCount  = (dev.dhcp_bindings || []).length

  return (
    <div style={{ marginBottom: 6, border: '1px solid #1a1a3e', borderRadius: 4, background: '#07070d' }}>
      <div
        onClick={() => setOpen(o => !o)}
        style={{
          padding: '5px 8px', cursor: 'pointer', display: 'flex', gap: 8, alignItems: 'center',
          borderBottom: open ? '1px solid #1a1a3e' : 'none',
        }}
      >
        <span style={{ fontSize: 9, color: open ? '#4a90e2' : '#444' }}>{open ? '▾' : '▸'}</span>
        <span style={{ fontSize: 10, fontWeight: 700, color: '#c0c0e0', fontFamily: 'monospace' }}>
          {dev.hostname}
        </span>
        <span style={{ fontSize: 9, color: '#444' }}>{dev.type}</span>
        <span style={{ fontSize: 9, color: dev.powered ? '#50fa7b' : '#555', marginLeft: 'auto' }}>
          {dev.powered ? 'ON' : 'OFF'}
        </span>
      </div>

      {open && (
        <div style={{ padding: '6px 8px', fontSize: 10 }}>
          {/* Interfaces */}
          <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 6 }}>
            <thead>
              <tr style={{ color: '#444', fontSize: 9 }}>
                <th style={{ textAlign: 'left', paddingBottom: 3 }}>Interface</th>
                <th style={{ textAlign: 'left' }}>IP / Mask</th>
                <th style={{ textAlign: 'left' }}>Status</th>
                <th style={{ textAlign: 'left' }}>VLAN / Mode</th>
              </tr>
            </thead>
            <tbody>
              {dev.interfaces.map(iface => (
                <tr key={iface.name} style={{ borderTop: '1px solid #0d0d20' }}>
                  <td style={{ padding: '2px 4px 2px 0', fontFamily: 'monospace', color: '#8888cc', fontSize: 9 }}>
                    {iface.name}
                  </td>
                  <td style={{ padding: '2px 4px 2px 0', fontFamily: 'monospace', color: '#c0c0e0', fontSize: 9 }}>
                    {iface.ip ? `${iface.ip}/${iface.subnet_mask ?? '?'}` : '—'}
                  </td>
                  <td style={{ padding: '2px 4px 2px 0', fontSize: 9,
                    color: iface.status === 'up' ? '#50fa7b' : iface.status === 'admin_down' ? '#ff5555' : '#ffb86c' }}>
                    {iface.status}
                  </td>
                  <td style={{ padding: '2px 0', fontSize: 9, color: '#555' }}>
                    {iface.vlan != null ? `VLAN${iface.vlan}` : ''}
                    {iface.switchport_mode ? ` ${iface.switchport_mode}` : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Routing table */}
          {routeCount > 0 && (
            <div style={{ marginBottom: 6 }}>
              <div style={{ fontSize: 9, color: '#555', marginBottom: 2 }}>ROUTES ({routeCount})</div>
              {dev.routing_table.map((rt, i) => (
                <div key={i} style={{ fontFamily: 'monospace', fontSize: 9, color: '#8be9fd' }}>
                  {rt.network}/{rt.mask} via {rt.next_hop ?? rt.exit_interface ?? '?'}
                </div>
              ))}
            </div>
          )}

          {/* DHCP bindings */}
          {dhcpCount > 0 && (
            <div>
              <div style={{ fontSize: 9, color: '#555', marginBottom: 2 }}>DHCP BINDINGS ({dhcpCount})</div>
              {dev.dhcp_bindings.map((b, i) => (
                <div key={i} style={{ fontFamily: 'monospace', fontSize: 9, color: '#ffb86c' }}>
                  {b.ip} — {b.client_id} [{b.pool_name}]
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Tab: SMOKE TESTS ──────────────────────────────────────────────────────────

function SmokeTab() {
  const ctx = useGame()
  const [results, setResults]   = useState(null)
  const [running, setRunning]   = useState(false)

  function run() {
    setRunning(true)
    setResults(null)
    // Yield to React so "RUNNING…" renders before synchronous test loop blocks
    setTimeout(() => {
      try {
        const r = runSmokeTests(ctx)
        setResults(r)
      } catch (e) {
        setResults([{ id: '!', name: 'Runner error', pass: false, detail: e.message }])
      } finally {
        setRunning(false)
      }
    }, 0)
  }

  const passed = results?.filter(r => r.pass).length ?? 0
  const total  = results?.length ?? 0

  return (
    <div>
      <div style={{ marginBottom: 10, fontSize: 9, color: '#444', lineHeight: 1.6 }}>
        Runs every foundation smoke test (T1–T6b) against the real engine.
        <br />
        <span style={{ color: '#ff555588' }}>⚠ Clears sandbox · destroys current topology</span>
      </div>

      <button style={{ ...S.btn('#8be9fd'), opacity: running ? 0.5 : 1 }} onClick={run} disabled={running}>
        {running ? '⏳ RUNNING…' : '▶ RUN ALL SMOKE TESTS'}
      </button>

      {results && (
        <div style={{ marginTop: 10 }}>
          <div style={{
            fontSize: 10, fontWeight: 700, marginBottom: 8,
            color: passed === total ? '#50fa7b' : '#ffb86c',
          }}>
            {passed}/{total} passed
          </div>
          {results.map(r => (
            <div
              key={r.id}
              style={{
                padding: '5px 8px', marginBottom: 4, borderRadius: 3,
                background: r.pass ? '#0a2010' : '#200a0a',
                border: `1px solid ${r.pass ? '#50fa7b33' : '#ff555533'}`,
              }}
            >
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: r.detail ? 2 : 0 }}>
                <span style={{ fontSize: 12, lineHeight: 1 }}>{r.pass ? '✓' : '✗'}</span>
                <span style={{ fontSize: 10, fontWeight: 700, color: r.pass ? '#50fa7b' : '#ff5555' }}>
                  {r.name}
                </span>
              </div>
              {r.detail && (
                <div style={{ fontSize: 9, color: '#888', fontFamily: 'monospace', paddingLeft: 20, marginTop: 2 }}>
                  {r.detail}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Tab: UTILS ────────────────────────────────────────────────────────────────

function UtilsTab() {
  const { refresh, devExportSandbox, devImportSandbox, setMode } = useGame()
  const [importText, setImportText] = useState('')
  const [importMsg, setImportMsg]   = useState(null)
  const [copyMsg, setCopyMsg]       = useState(false)

  function doExport() {
    const json = devExportSandbox()
    navigator.clipboard?.writeText(json).then(() => {
      setCopyMsg(true); setTimeout(() => setCopyMsg(false), 1800)
    }).catch(() => {
      // Fallback: open in new tab
      const blob = new Blob([json], { type: 'application/json' })
      const url  = URL.createObjectURL(blob)
      window.open(url, '_blank')
      setTimeout(() => URL.revokeObjectURL(url), 5000)
    })
  }

  function doImport() {
    if (!importText.trim()) return
    setMode('sandbox')
    const result = devImportSandbox(importText.trim())
    setImportMsg(result.ok ? '✓ Imported' : `✗ ${result.error}`)
    setTimeout(() => setImportMsg(null), 2500)
    if (result.ok) setImportText('')
  }

  return (
    <div>
      <div style={S.section}>
        <div style={S.sectionTitle}>FORCE REFRESH</div>
        <button style={S.btn()} onClick={refresh}>↻ REFRESH</button>
        <span style={{ fontSize: 9, color: '#333360', marginLeft: 8 }}>Bumps the active tick counter</span>
      </div>

      <div style={S.section}>
        <div style={S.sectionTitle}>EXPORT SANDBOX</div>
        <div style={{ fontSize: 9, color: '#444', marginBottom: 6, lineHeight: 1.5 }}>
          Serialises sandbox topology + placements to JSON.
          Copies to clipboard (or opens in new tab if clipboard unavailable).
        </div>
        <button style={S.btn('#50fa7b')} onClick={doExport}>
          {copyMsg ? '✓ COPIED' : '⬆ EXPORT JSON'}
        </button>
      </div>

      <div style={S.section}>
        <div style={S.sectionTitle}>IMPORT SANDBOX</div>
        <div style={{ fontSize: 9, color: '#444', marginBottom: 6, lineHeight: 1.5 }}>
          Paste JSON exported from a previous session. Switches to sandbox and
          replaces current topology.
        </div>
        <textarea
          value={importText}
          onChange={e => setImportText(e.target.value)}
          placeholder='Paste exported JSON here…'
          style={{
            ...S.input, height: 80, resize: 'vertical', display: 'block', marginBottom: 6,
          }}
        />
        <button style={S.btn('#8be9fd')} onClick={doImport}>⬇ IMPORT</button>
        {importMsg && (
          <span style={{
            marginLeft: 8, fontSize: 10,
            color: importMsg.startsWith('✓') ? '#50fa7b' : '#ff5555',
          }}>{importMsg}</span>
        )}
      </div>
    </div>
  )
}

// ── Root panel ────────────────────────────────────────────────────────────────

const TABS = [
  { id: 'missions',  label: 'MISSIONS'  },
  { id: 'presets',   label: 'PRESETS'   },
  { id: 'inspector', label: 'INSPECTOR' },
  { id: 'smoke',     label: 'SMOKE'     },
  { id: 'utils',     label: 'UTILS'     },
]

export default function DevPanel({ open, onClose }) {
  // Hard gate: never render in production builds
  if (!import.meta.env.DEV) return null
  if (!open) return null

  return <DevPanelInner onClose={onClose} />
}

// Separate inner component so hooks always run in the same render tree shape
function DevPanelInner({ onClose }) {
  const [tab, setTab] = useState('missions')

  return (
    <div className="dev-panel">
      {/* Header */}
      <div className="dev-panel-header">
        <span className="dev-panel-title">⚙ DEV PANEL</span>
        <button className="dev-panel-close" onClick={onClose} title="Close (Ctrl+Shift+D)">✕</button>
      </div>

      {/* Tabs */}
      <div className="dev-panel-tabs">
        {TABS.map(t => (
          <button
            key={t.id}
            className={`dev-tab-btn${tab === t.id ? ' active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Body */}
      <div className="dev-panel-body">
        {tab === 'missions'  && <MissionsTab />}
        {tab === 'presets'   && <PresetsTab />}
        {tab === 'inspector' && <InspectorTab />}
        {tab === 'smoke'     && <SmokeTab />}
        {tab === 'utils'     && <UtilsTab />}
      </div>
    </div>
  )
}
