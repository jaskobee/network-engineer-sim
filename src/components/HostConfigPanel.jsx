import { useState, useEffect, useLayoutEffect, useRef, useId } from 'react'
import { useGame } from '../state/GameContext.jsx'
import {
  supportsHostGui, readAdapter, formFromAdapter, sameForm,
  subnetFacts, planApply, planRenew, planLink, applyPlan,
} from '../engine/hostConfig.js'
import { IconClose } from './icons.jsx'

// "Configure GUI" for end hosts (pc / server / phone / laptop).
//
// A form over the machine's own shell, not a second config store: the window reads the
// adapter, turns the form into the real commands (`ip` / `dhclient` on Linux, `netsh` /
// `ipconfig` on a Windows laptop — engine/hostConfig.js) and runs them through the same
// engine the terminal uses. It shows those commands before and after Apply, so the GUI
// doubles as a bridge to the CLI.
//
// Routers, switches and firewalls have no such window on purpose — they are CLI devices
// (firewalls also have their own console).

const TYPE_LABEL = { pc: 'PC', server: 'Server', phone: 'IP phone', laptop: 'Laptop' }
// The prompt each shell would print in front of the commands (the transcript is a real terminal's).
const PROMPT = { linux: '$ ', windows: 'C:\\> ' }
const WIDTH = 520

export default function HostConfigPanel() {
  const { hostConfig, closeHostConfig, getDevice } = useGame()
  const device = hostConfig ? getDevice(hostConfig.deviceId) : null
  const usable = !!device && device.powered && supportsHostGui(device)

  // The window belongs to a running machine: it closes when the device is powered
  // off, removed, or is no longer in the topology on screen (job switch).
  useEffect(() => { if (hostConfig && !usable) closeHostConfig() })
  if (!hostConfig || !usable) return null
  return <ConfigWindow key={hostConfig.deviceId} device={device} origin={hostConfig.origin} onClose={closeHostConfig} />
}

// ── Window frame ──────────────────────────────────────────────────────────────

function ConfigWindow({ device, origin, onClose }) {
  const winRef = useRef(null)
  const dragRef = useRef(null)
  // Opens just to the right of the click so the device being configured stays in view
  // (the layout effect below pulls it back on screen if that would overflow).
  const [pos, setPos] = useState(() => ({
    x: origin ? origin.x + 36 : 160,
    y: origin ? origin.y - 24 : 100,
  }))
  const [ifaceName, setIfaceName] = useState(device.interfaces[0].name)
  const { topology } = useGame()

  // Keep the whole window on screen — on open, and again whenever it changes size (the
  // transcript grows it after Apply, so a window opened low on the screen would
  // otherwise push Apply off the bottom) or the browser is resized. Also takes focus so
  // Esc works straight away and the dialog is announced.
  useLayoutEffect(() => {
    const el = winRef.current
    if (!el) return
    const keepOnScreen = () => setPos(p => {
      const x = Math.max(8, Math.min(window.innerWidth  - el.offsetWidth  - 8, p.x))
      const y = Math.max(8, Math.min(window.innerHeight - el.offsetHeight - 8, p.y))
      return x === p.x && y === p.y ? p : { x, y }
    })
    keepOnScreen()
    el.focus({ preventScroll: true })
    const ro = new ResizeObserver(keepOnScreen)
    ro.observe(el)
    window.addEventListener('resize', keepOnScreen)
    return () => { ro.disconnect(); window.removeEventListener('resize', keepOnScreen) }
  }, [])

  function startDrag(e) {
    if (e.button !== 0 || e.target.closest('button')) return
    e.currentTarget.setPointerCapture(e.pointerId)
    dragRef.current = { mx: e.clientX, my: e.clientY, px: pos.x, py: pos.y }
  }
  function onDrag(e) {
    const d = dragRef.current
    if (!d) return
    // Let it travel anywhere, but never lose the title bar off-screen.
    setPos({
      x: Math.max(96 - WIDTH, Math.min(window.innerWidth - 96, d.px + e.clientX - d.mx)),
      y: Math.max(0, Math.min(window.innerHeight - 44, d.py + e.clientY - d.my)),
    })
  }
  function endDrag() { dragRef.current = null }

  const multi = device.interfaces.length > 1

  return (
    <div
      ref={winRef}
      className="float-win"
      role="dialog"
      aria-modal="false"
      aria-label={`Network settings for ${device.hostname}`}
      tabIndex={-1}
      style={{
        left: pos.x, top: pos.y,
        transformOrigin: origin ? `${origin.x - pos.x}px ${origin.y - pos.y}px` : '15% 100%',
      }}
      onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }}
      onMouseDown={e => e.stopPropagation()}
      onContextMenu={e => e.stopPropagation()}
    >
      <div className="float-win-title" onPointerDown={startDrag} onPointerMove={onDrag} onPointerUp={endDrag} onPointerCancel={endDrag}>
        <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'baseline', gap: 10 }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 15.5, fontWeight: 700, color: 'var(--ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {device.hostname}
          </span>
          <span style={{ fontSize: 13.5, color: 'var(--ink-3)', whiteSpace: 'nowrap' }}>
            {TYPE_LABEL[device.type] ?? 'Host'} · Network settings
          </span>
        </div>
        <button className="btn ghost icon" onClick={onClose} title="Close" aria-label="Close" style={{ width: 28, height: 28 }}>
          <IconClose size={15} />
        </button>
      </div>

      <div className="float-win-body">
        {multi && (
          <div role="tablist" aria-label="Network adapters" style={{ display: 'flex', gap: 2, marginBottom: 6, borderBottom: '1px solid var(--rule)' }}>
            {device.interfaces.map(i => {
              const on = i.name === ifaceName
              const a = readAdapter(topology, device, i.name)
              return (
                <button key={i.name} role="tab" aria-selected={on} className={`utab${on ? ' on' : ''}`} onClick={() => setIfaceName(i.name)}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontFamily: 'var(--font-mono)', fontSize: 14 }}>
                  <i className={`led ${linkView(a).led}`} style={{ width: 7, height: 7 }} />
                  {a.label}
                </button>
              )
            })}
          </div>
        )}
        <AdapterForm key={ifaceName} device={device} ifaceName={ifaceName} />
      </div>
    </div>
  )
}

// ── One adapter ───────────────────────────────────────────────────────────────

// Three link states, as on real gear: up, down (no carrier), and switched off on purpose.
function linkView(a) {
  if (a.status === 'up') {
    return { led: 'green', title: 'Connected', detail: a.remote ? `to ${a.remote.hostname}, port ${a.remote.port}` : '' }
  }
  if (a.status === 'admin_down') {
    return { led: '', title: 'Disabled', detail: 'The adapter is switched off. Turn it on to use it.' }
  }
  return a.remote
    ? { led: 'amber', title: 'No link', detail: `${a.remote.hostname} port ${a.remote.port} isn't up. Check that end.` }
    : { led: 'amber', title: a.os === 'windows' ? 'Network cable unplugged' : 'Cable unplugged', detail: 'Right-click the device and choose Connect Cable.' }
}

function AdapterForm({ device, ifaceName }) {
  const { topology, executeDeviceCommands, logExecutedCommand } = useGame()
  const uid = useId()
  const ids = { ip: `${uid}-ip`, mask: `${uid}-mask`, gw: `${uid}-gw`, dns1: `${uid}-dns1`, dns2: `${uid}-dns2` }
  const refs = { ip: useRef(null), mask: useRef(null), gateway: useRef(null), dns1: useRef(null), dns2: useRef(null) }

  const adapter = readAdapter(topology, device, ifaceName)
  const baseline = formFromAdapter(adapter)
  const baseKey = JSON.stringify(baseline)

  const [form, setForm] = useState(baseline)
  const [touched, setTouched] = useState({})
  const [result, setResult] = useState(null)   // { ok, steps } from the last run

  // If the engine changes underneath us (a command typed in the terminal, a lease
  // arriving) follow it — unless the person has unsaved edits in the form.
  const prevBase = useRef(baseline)
  useEffect(() => {
    const prev = prevBase.current
    prevBase.current = baseline
    setForm(f => (sameForm(f, prev) ? baseline : f))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseKey])

  const plan = planApply(topology, device, ifaceName, form)
  const errors = plan.errors
  const dirty = !sameForm(form, baseline)
  const FIELDS = ['ip', 'mask', 'gateway', 'dns1', 'dns2']
  const fieldErrors = FIELDS.some(k => errors[k])
  const hasWork = plan.commands.length > 0 || fieldErrors
  const dhcp = form.mode === 'dhcp'
  const link = linkView(adapter)
  const prompt = PROMPT[adapter.os]
  const words = adapter.os === 'windows'
    ? { auto: 'Obtain an IP address automatically', manual: 'Use the following IP address', dnsAuto: 'Obtain DNS server address automatically', dnsManual: 'Use the following DNS server addresses' }
    : { auto: 'Obtain automatically (DHCP)', manual: 'Set manually', dnsAuto: 'Obtain DNS servers automatically (DHCP)', dnsManual: 'Set DNS servers manually' }
  const dnsManual = form.dnsMode === 'manual'

  function edit(patch) { setResult(null); setForm(f => ({ ...f, ...patch })) }
  function touch(k) { setTouched(t => (t[k] ? t : { ...t, [k]: true })) }
  const showError = k => touched[k] && errors[k]

  function run(commands) {
    const res = applyPlan(cmd => executeDeviceCommands(device.id, [cmd]), device, ifaceName, commands)
    // What ran fine counts as typed — the beginner hint ticks follow the same log.
    for (const s of res.steps) if (s.ok) logExecutedCommand(device.id, s.cmd)
    setResult(res)
  }

  function submit(e) {
    e.preventDefault()
    setTouched(Object.fromEntries(FIELDS.map(k => [k, true])))
    const bad = FIELDS.find(k => errors[k])
    if (bad) { refs[bad].current?.focus(); return }
    if (plan.commands.length) run(plan.commands)
  }

  function revert() { setResult(null); setTouched({}); setForm(baseline) }

  // In DHCP mode the fields show what the lease gave; otherwise what is being typed.
  const shown = dhcp
    ? { ip: adapter.mode === 'dhcp' ? adapter.ip : '', mask: adapter.mode === 'dhcp' ? adapter.mask : '', gateway: adapter.mode === 'dhcp' ? (adapter.gateway ?? '') : '' }
    : form
  const facts = dhcp ? adapter.facts : subnetFacts(form.ip.trim(), form.mask.trim())
  const leaseHeld = adapter.mode === 'dhcp' && dhcp
  const renew = leaseHeld ? planRenew(topology, device, ifaceName) : null   // null while the link is down

  return (
    <form onSubmit={submit} noValidate>
      {/* Link status + the adapter's on/off switch */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '6px 0 12px' }}>
        <i className={`led ${link.led}`} style={{ width: 11, height: 11 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--ink)', lineHeight: 1.25 }}>
            {link.title} <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13.5, fontWeight: 400, color: 'var(--ink-3)' }}>{adapter.label}</span>
          </div>
          {link.detail && <div style={{ fontSize: 13.5, color: 'var(--ink-3)', lineHeight: 1.4 }}>{link.detail}</div>}
        </div>
        <span style={{ fontSize: 14, color: 'var(--ink-2)' }}>{adapter.enabled ? 'On' : 'Off'}</span>
        <button
          type="button" role="switch" className="switch"
          aria-checked={adapter.enabled} aria-label={`Adapter ${adapter.label}`}
          onClick={() => run(planLink(device, ifaceName, !adapter.enabled))}
        />
      </div>

      <fieldset style={{ border: 0, borderTop: '1px solid var(--rule)', padding: '10px 0 0', margin: 0, minWidth: 0 }}>
        <legend style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink)', padding: '0 8px 0 0', float: 'left', width: '100%', marginBottom: 4 }}>
          IPv4 address
        </legend>
        <label className="opt" style={{ clear: 'both' }}>
          <input type="radio" name={`${uid}-mode`} checked={dhcp} onChange={() => edit({ mode: 'dhcp' })} />
          {words.auto}
        </label>
        <label className="opt">
          <input type="radio" name={`${uid}-mode`} checked={!dhcp} onChange={() => edit({ mode: 'manual' })} />
          {words.manual}
        </label>

        {errors.link && (
          <div role="alert" className="field-error" style={{ gridColumn: 'auto', margin: '4px 0 0' }}>{errors.link}</div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 9, marginTop: 10 }}>
          <Field id={ids.ip} label="IP address" error={showError('ip')}>
            <input
              ref={refs.ip} id={ids.ip} className="input" inputMode="decimal" autoComplete="off" spellCheck={false}
              value={shown.ip} disabled={dhcp} placeholder={dhcp ? 'Assigned by DHCP' : 'e.g. 192.168.10.10'}
              aria-invalid={!!showError('ip')} aria-describedby={showError('ip') ? `${ids.ip}-err` : undefined}
              onChange={e => edit({ ip: e.target.value })} onBlur={() => touch('ip')}
            />
          </Field>

          <Field id={ids.mask} label="Subnet mask" error={showError('mask')}>
            <input
              ref={refs.mask} id={ids.mask} className="input" inputMode="decimal" autoComplete="off" spellCheck={false}
              value={shown.mask} disabled={dhcp} placeholder={dhcp ? 'Assigned by DHCP' : 'e.g. 255.255.255.0'}
              aria-invalid={!!showError('mask')} aria-describedby={showError('mask') ? `${ids.mask}-err` : undefined}
              onChange={e => edit({ mask: e.target.value })} onBlur={() => touch('mask')}
            />
            {facts && <SubnetFacts facts={facts} />}
          </Field>

          <Field id={ids.gw} label="Default gateway" error={showError('gateway')}>
            <input
              ref={refs.gateway} id={ids.gw} className="input" inputMode="decimal" autoComplete="off" spellCheck={false}
              value={shown.gateway} disabled={dhcp} placeholder={dhcp ? 'Assigned by DHCP' : 'Optional'}
              aria-invalid={!!showError('gateway')} aria-describedby={showError('gateway') ? `${ids.gw}-err` : undefined}
              onChange={e => edit({ gateway: e.target.value })} onBlur={() => touch('gateway')}
            />
          </Field>

        </div>
      </fieldset>

      {/* Name servers: asked in order — the preferred one first, the alternate only if it doesn't answer. */}
      <fieldset style={{ border: 0, borderTop: '1px solid var(--rule)', padding: '10px 0 0', margin: '14px 0 0', minWidth: 0 }}>
        <legend style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink)', padding: '0 8px 0 0', float: 'left', width: '100%', marginBottom: 4 }}>
          DNS servers
        </legend>
        <label className="opt" style={{ clear: 'both' }}>
          <input type="radio" name={`${uid}-dns`} checked={!dnsManual} onChange={() => edit({ dnsMode: 'auto' })} />
          {words.dnsAuto}
        </label>
        <label className="opt">
          <input type="radio" name={`${uid}-dns`} checked={dnsManual} onChange={() => edit({ dnsMode: 'manual' })} />
          {words.dnsManual}
        </label>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 9, marginTop: 10 }}>
          <Field id={ids.dns1} label="Preferred DNS server" error={showError('dns1')}>
            <input
              ref={refs.dns1} id={ids.dns1} className="input" inputMode="decimal" autoComplete="off" spellCheck={false}
              value={dnsManual ? form.dns1 : (adapter.dnsDhcp[0] ?? '')} disabled={!dnsManual}
              placeholder={dnsManual ? 'e.g. 8.8.8.8' : 'Assigned by DHCP'}
              aria-invalid={!!showError('dns1')} aria-describedby={showError('dns1') ? `${ids.dns1}-err` : undefined}
              onChange={e => edit({ dns1: e.target.value })} onBlur={() => touch('dns1')}
            />
          </Field>
          <Field id={ids.dns2} label="Alternate DNS server" error={showError('dns2')}>
            <input
              ref={refs.dns2} id={ids.dns2} className="input" inputMode="decimal" autoComplete="off" spellCheck={false}
              value={dnsManual ? form.dns2 : (adapter.dnsDhcp[1] ?? '')} disabled={!dnsManual}
              placeholder={dnsManual ? 'Optional, e.g. 8.8.4.4' : 'Assigned by DHCP'}
              aria-invalid={!!showError('dns2')} aria-describedby={showError('dns2') ? `${ids.dns2}-err` : undefined}
              onChange={e => edit({ dns2: e.target.value })} onBlur={() => touch('dns2')}
            />
          </Field>
          <div className="field-row">
            <span />
            <div className="field-note" style={{ gridColumn: 'auto' }}>
              {dnsManual
                ? 'The preferred server is asked first. The alternate is only asked if the preferred one does not answer.'
                : adapter.dnsDhcp.length
                  ? 'These come from the DHCP lease.'
                  : dhcp
                    ? 'No DNS server yet — the DHCP lease has not supplied one.'
                    : 'No DNS server. With a manual address there is no DHCP lease to supply one.'}
            </div>
          </div>
        </div>
      </fieldset>

      {/* Commands: what Apply will run, then what it ran. */}
      <div style={{ marginTop: 14 }}>
        {result ? <Result result={result} prompt={prompt} /> : plan.commands.length > 0 && <Preview commands={plan.commands} prompt={prompt} />}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 14 }}>
        {leaseHeld && (
          <button
            type="button" className="btn ghost" disabled={!renew} onClick={() => run(renew)}
            title={renew ? 'Give the lease back and ask the DHCP server again' : 'Renewing needs a working link'}
          >
            Renew lease
          </button>
        )}
        <span style={{ flex: 1 }} />
        <button type="button" className="btn ghost" onClick={revert} disabled={!dirty && !result}>Revert</button>
        <button type="submit" className="btn primary" disabled={!hasWork} style={{ padding: '6px 22px' }}>Apply</button>
      </div>
    </form>
  )
}

function Field({ id, label, error, children }) {
  return (
    <div className="field-row">
      <label className="field-label" htmlFor={id}>{label}</label>
      <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
        {children}
        {error && <div id={`${id}-err`} className="field-error" style={{ gridColumn: 'auto' }}>{error}</div>}
      </div>
    </div>
  )
}

// The subnet arithmetic the mission briefs expect a learner to be able to do by hand.
function SubnetFacts({ facts }) {
  const bcast = facts.broadcast ?? (facts.prefix === 32 ? 'none (single host)' : 'none (point-to-point, RFC 3021)')
  return (
    <dl style={{
      display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '1px 12px', margin: '2px 0 0',
      fontFamily: 'var(--font-mono)', fontSize: 13, lineHeight: 1.5,
    }}>
      <FactRow k="Prefix" v={`/${facts.prefix}`} />
      <FactRow k="Network" v={facts.network} />
      <FactRow k="Usable" v={facts.first === facts.last ? facts.first : `${facts.first} – ${facts.last}`} />
      <FactRow k="Broadcast" v={bcast} />
      <FactRow k="Hosts" v={hostsMath(facts)} />
    </dl>
  )
}

// The count, with its arithmetic, so the number teaches: a /24 has 2⁸ = 256 addresses, and the network
// and broadcast addresses are reserved — 256 − 2 = 254 usable hosts.
function hostsMath(f) {
  if (f.prefix === 32) return '1 (a single address)'
  if (f.prefix === 31) return '2 (RFC 3021: both usable, no broadcast)'
  return (
    <>
      <span style={{ color: 'var(--ink)' }}>{f.hosts.toLocaleString()}</span>
      <span style={{ fontFamily: 'var(--font-ui)', color: 'var(--ink-3)', fontSize: 13.5 }}>
        {'  '}2<sup>{f.hostBits}</sup> − 2 (network and broadcast)
      </span>
    </>
  )
}

function FactRow({ k, v, extra }) {
  return (
    <>
      <dt style={{ color: 'var(--ink-3)', fontFamily: 'var(--font-ui)', fontSize: 13.5 }}>{k}</dt>
      <dd style={{ margin: 0, color: 'var(--ink-2)' }}>
        {v}{extra && <span style={{ color: 'var(--ink-3)', fontFamily: 'var(--font-ui)', fontSize: 13.5 }}>{'  '}{extra}</span>}
      </dd>
    </>
  )
}

function Preview({ commands, prompt }) {
  return (
    <div>
      <div style={{ fontSize: 13.5, color: 'var(--ink-3)', marginBottom: 4 }}>Terminal equivalent</div>
      <div className="transcript" aria-label="Commands that Apply will run">
        {commands.map(c => <div key={c} className="cmd"><span className="prompt">{prompt}</span>{c}</div>)}
      </div>
    </div>
  )
}

function Result({ result, prompt }) {
  const ok = result.ok
  return (
    <div role={ok ? 'status' : 'alert'}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5, fontSize: 14.5, fontWeight: 700, color: 'var(--ink)' }}>
        <i className={`led ${ok ? 'green' : 'red'}`} style={{ width: 9, height: 9 }} />
        {result.headline ?? (ok ? 'Applied' : 'Not applied')}
      </div>
      <div className={`transcript ${ok ? 'ok' : 'fail'}`}>
        {result.steps.map((s, i) => (
          <div key={i}>
            <div className={`cmd${s.ok ? '' : ' bad'}`}><span className="prompt">{prompt}</span>{s.cmd}</div>
            {s.output.map((line, j) => <div key={j} className="out">{line}</div>)}
          </div>
        ))}
      </div>
    </div>
  )
}
