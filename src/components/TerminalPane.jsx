import { useEffect, useRef, useState } from 'react'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { useGame } from '../state/GameContext.jsx'
import { isValidIp, resolveHostname } from '../models/ipUtils.js'

// Atkinson Hyperlegible Mono keeps 0/O and 1/l/I distinct — which matters when the
// text on screen is an IP address or a command a learner has to retype exactly.
const TERM_FALLBACK_FONT = 'Cascadia Code, Consolas, "Courier New", monospace'
const TERM_FONT = `"Atkinson Hyperlegible Mono", ${TERM_FALLBACK_FONT}`

const PC_TYPES = new Set(['pc', 'server', 'phone', 'laptop'])

// ── Main pane ─────────────────────────────────────────────────────────────────

const DEFAULT_SIZE = { w: 800, h: 360 }

export default function TerminalPane() {
  const {
    terminalSessions, allTerminalSessions, activeTerminalId, setActiveTerminalId, closeTerminal,
    terminalWindowOpen, terminalOrigin, closeTerminalWindow,
  } = useGame()

  const [floatPos, setFloatPos]   = useState({ x: 140, y: 80 })
  const [floatSize, setFloatSize] = useState(DEFAULT_SIZE)
  const [minimized, setMinimized] = useState(false)

  const dragRef   = useRef(null)
  const resizeRef = useRef(null)
  // Closing fully unmounts the window (see the early `return null` below), so
  // every open is already a fresh mount — the CSS `animation` on containerStyle
  // replays automatically without any manual key/class bookkeeping. This ref
  // just distinguishes "just opened" (reposition near the click) from "another
  // tab opened while already open" (leave the window where the player put it).
  const wasOpenRef = useRef(false)

  useEffect(() => {
    function onMove(e) {
      if (dragRef.current) {
        const { mx, my, px, py } = dragRef.current
        setFloatPos({ x: px + e.clientX - mx, y: py + e.clientY - my })
      }
      if (resizeRef.current) {
        const { mx, my, w0, h0 } = resizeRef.current
        setFloatSize({
          w: Math.max(380, w0 + e.clientX - mx),
          h: Math.max(180, h0 + e.clientY - my),
        })
      }
    }
    function onUp() { dragRef.current = null; resizeRef.current = null }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    return () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
  }, [])

  // On each open, anchor the window near the click that triggered it (if we
  // have one) so the pop-in animation visibly grows out from that device —
  // then never move it again until the next open.
  useEffect(() => {
    if (terminalWindowOpen && !wasOpenRef.current) {
      setMinimized(false)
      if (terminalOrigin) {
        const w = floatSize.w, h = floatSize.h
        setFloatPos({
          x: Math.max(8, Math.min(window.innerWidth  - w - 8, terminalOrigin.x - w / 4)),
          y: Math.max(8, Math.min(window.innerHeight - h - 8, terminalOrigin.y - h / 4)),
        })
      }
    }
    wasOpenRef.current = terminalWindowOpen
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [terminalWindowOpen])

  if (!terminalWindowOpen) return null

  // transform-origin for the grow animation: the click point, expressed
  // relative to the window's own top-left corner. Falls back to growing from
  // the bottom-left (roughly where the Admin Laptop shortcut lives) if we
  // don't have a click point (e.g. reopened programmatically).
  const originStyle = terminalOrigin
    ? `${terminalOrigin.x - floatPos.x}px ${terminalOrigin.y - floatPos.y}px`
    : '15% 100%'

  const containerStyle = {
    position: 'fixed', left: floatPos.x, top: floatPos.y,
    width: floatSize.w, height: minimized ? 'auto' : floatSize.h,
    zIndex: 1600, borderRadius: 8, overflow: 'hidden',   // above the floating job panel (1500): a window you just opened is never underneath it
    boxShadow: '0 8px 40px rgba(0,0,0,0.8)', border: '1px solid #2f6fbd',
    display: 'flex', flexDirection: 'column', background: '#0b0f11',
    transformOrigin: originStyle,
    animation: 'terminal-pop-in 340ms cubic-bezier(0.16, 1, 0.3, 1) both',
  }

  function startDrag(e) {
    dragRef.current = { mx: e.clientX, my: e.clientY, px: floatPos.x, py: floatPos.y }
    e.preventDefault()
  }

  function startResize(e) {
    resizeRef.current = { mx: e.clientX, my: e.clientY, w0: floatSize.w, h0: floatSize.h }
    e.preventDefault(); e.stopPropagation()
  }

  return (
    <div style={containerStyle}>
      {/* Tab bar / drag handle */}
      <div
        style={{
          display: 'flex', alignItems: 'stretch',
          background: '#090c0f', borderBottom: '1px solid #202b33',
          flexShrink: 0, overflowX: 'auto', overflowY: 'hidden', minHeight: 32,
          cursor: 'grab', userSelect: 'none',
        }}
        onMouseDown={startDrag}
      >
        {terminalSessions.length === 0 ? (
          <div style={{ padding: '6px 14px', fontSize: 14, color: '#728fa5', fontStyle: 'italic', alignSelf: 'center' }}>
            Right-click a device → Open Terminal
          </div>
        ) : (
          terminalSessions.map(session => (
            <TermTab
              key={session.id}
              session={session}
              isActive={session.id === activeTerminalId}
              onSelect={() => setActiveTerminalId(session.id)}
              onClose={() => closeTerminal(session.id)}
            />
          ))
        )}
        <div
          style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', padding: '0 8px', gap: 6, flexShrink: 0 }}
          onMouseDown={e => e.stopPropagation()}
        >
          <button
            title={minimized ? 'Expand terminal' : 'Minimize terminal'}
            onClick={() => setMinimized(m => !m)}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: '#7490a2', fontSize: 15.5, lineHeight: 1, padding: '2px 4px',
            }}
            onMouseEnter={e => { e.currentTarget.style.color = '#ffb42e' }}
            onMouseLeave={e => { e.currentTarget.style.color = '#7490a2' }}
          >
            {minimized ? '▲' : '▼'}
          </button>
          <button
            title="Close terminal"
            onClick={closeTerminalWindow}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: '#7490a2', fontSize: 16.5, lineHeight: 1, padding: '2px 4px',
            }}
            onMouseEnter={e => { e.currentTarget.style.color = '#ff6259' }}
            onMouseLeave={e => { e.currentTarget.style.color = '#7490a2' }}
          >
            ✕
          </button>
        </div>
      </div>

      {/* Terminal windows — ALL sessions (both modes) stay mounted so xterm
          instances survive MISSIONS↔SANDBOX switches; only the active one is visible. */}
      {!minimized && (
        <div style={{ flex: 1, position: 'relative', minHeight: 0 }}>
          {allTerminalSessions.length === 0 ? (
            <div style={{
              height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: '#7191a8', fontFamily: 'var(--font-mono)', fontSize: 13,
            }}>
              No terminals open
            </div>
          ) : (
            allTerminalSessions.map(session => (
              <div key={session.id} style={{
                position: 'absolute', inset: 0,
                display: session.id === activeTerminalId ? 'block' : 'none',
              }}>
                <TermSession session={session} isActive={session.id === activeTerminalId} />
              </div>
            ))
          )}
        </div>
      )}

      {/* Resize corner */}
      {!minimized && (
        <div
          onMouseDown={startResize}
          style={{
            position: 'absolute', right: 0, bottom: 0, width: 14, height: 14,
            cursor: 'se-resize',
            background: 'linear-gradient(135deg, transparent 50%, #2f6fbd 50%)',
            zIndex: 10,
          }}
        />
      )}
    </div>
  )
}

// ── Tab button ────────────────────────────────────────────────────────────────

function TermTab({ session, isActive, onSelect, onClose }) {
  const { getDevice } = useGame()
  const device = getDevice(session.deviceId)
  const label = device?.hostname ?? '—'
  const typeColor = device?.type === 'router' ? '#4da6ff'
    : device?.type === 'switch' ? '#66d4ea'
    : device?.type === 'firewall' ? '#ff8a4a'
    : '#3ee08f'
  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: 5,
        padding: '0 10px 0 12px',
        borderRight: '1px solid #202b33',
        borderBottom: isActive ? '2px solid #4da6ff' : '2px solid transparent',
        background: isActive ? '#0b0f11' : 'transparent',
        cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap', minWidth: 0,
      }}
      onMouseDown={e => e.stopPropagation()}
      onClick={onSelect}
    >
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: typeColor, flexShrink: 0 }} />
      <span style={{ fontSize: 12.5, fontFamily: 'var(--font-mono)', color: isActive ? '#d9e2e8' : '#738ea2' }}>
        {label}
      </span>
      <span
        style={{ fontSize: 15.5, color: '#7491a4', cursor: 'pointer', lineHeight: 1, padding: '0 2px', flexShrink: 0 }}
        onMouseEnter={e => { e.currentTarget.style.color = '#ff6259' }}
        onMouseLeave={e => { e.currentTarget.style.color = '#7491a4' }}
        onClick={e => { e.stopPropagation(); onClose() }}
        title="Close"
      >×</span>
    </div>
  )
}

// ── Individual terminal session ───────────────────────────────────────────────

function TermSession({ session, isActive }) {
  const { getDevice, engine, pcEngine, winEngine, topology, placements, addPingAnimation, refresh, logExecutedCommand, closeTerminal, closeTerminalWindow, allTerminalSessions } = useGame()

  const containerRef    = useRef(null)
  const xtermRef        = useRef(null)
  const fitAddonRef     = useRef(null)
  const inputRef        = useRef('')
  const cursorRef       = useRef(0)        // position within input string
  const historyRef      = useRef([])       // past commands
  const histIdxRef      = useRef(-1)       // -1 = not navigating history
  const savedLineRef    = useRef('')       // preserved in-progress line during history nav
  const pingCancelRef   = useRef(null)

  const placementsRef           = useRef(placements)
  const addPingAnimationRef     = useRef(addPingAnimation)
  const refreshRef              = useRef(refresh)
  const logExecutedCommandRef   = useRef(logExecutedCommand)
  const closeTerminalRef        = useRef(closeTerminal)
  const closeTerminalWindowRef  = useRef(closeTerminalWindow)
  const sessionCountRef         = useRef(allTerminalSessions.length)
  useEffect(() => {
    placementsRef.current           = placements
    addPingAnimationRef.current     = addPingAnimation
    refreshRef.current              = refresh
    logExecutedCommandRef.current   = logExecutedCommand
    closeTerminalRef.current        = closeTerminal
    closeTerminalWindowRef.current  = closeTerminalWindow
    sessionCountRef.current         = allTerminalSessions.length
  })

  useEffect(() => {
    if (isActive && fitAddonRef.current) {
      requestAnimationFrame(() => {
        fitAddonRef.current?.fit()
        xtermRef.current?.focus()
      })
    }
  }, [isActive])

  useEffect(() => {
    if (!containerRef.current || xtermRef.current) return
    const device = getDevice(session.deviceId)
    if (!device) return

    const isPC      = PC_TYPES.has(device.type)
    const isWindows = device.type === 'laptop' && device.os_type === 'windows'
    const eng       = isWindows ? winEngine : (isPC ? pcEngine : engine)

    const term = new XTerm({
      cursorBlink: true,
      fontFamily: TERM_FALLBACK_FONT,
      fontSize: 13, lineHeight: 1.25, convertEol: true,
      theme: {
        background: '#0b0f11', foreground: '#e8eef2',
        cursor: '#4da6ff', cursorAccent: '#0b0f11',
        green: '#3ee08f', yellow: '#ffb42e', red: '#ff6259',
        blue: '#4da6ff', cyan: '#66d4ea', white: '#eef3f6',
        brightBlack: '#6283a4',
      },
    })

    const fitAddon = new FitAddon()
    fitAddonRef.current = fitAddon
    term.loadAddon(fitAddon)
    term.open(containerRef.current)
    requestAnimationFrame(() => fitAddon.fit())
    xtermRef.current = term

    // xterm measures its cell size from the font at creation time, so start on the
    // system stack and switch to the app's mono once it has actually loaded —
    // changing the family string makes xterm re-measure, then we refit.
    document.fonts.load('13px "Atkinson Hyperlegible Mono"').then(() => {
      if (xtermRef.current !== term) return
      try { term.options.fontFamily = TERM_FONT; fitAddon.fit() } catch { /* terminal was disposed */ }
    }).catch(() => {})

    term.writeln(`\r\n\x1b[36mConnected to ${device.hostname} (${device.model})\x1b[0m`)
    term.writeln(`\x1b[90m${isWindows
      ? "Windows CMD — 'help' for commands, Tab to complete"
      : isPC
        ? "Linux shell — 'help' for commands, Tab to complete"
        : "IOS simulator — '?' for commands, Tab to complete"}\x1b[0m\r\n`)
    term.write(eng.getPrompt(device) + ' ')

    function prompt() { return eng.getPrompt(device) + ' ' }

    function writePrompt() {
      term.write('\r\n' + prompt())
      inputRef.current  = ''
      cursorRef.current = 0
    }

    // Redraws prompt + current input and repositions cursor
    function redrawLine() {
      const p   = prompt()
      const inp = inputRef.current
      const cur = cursorRef.current
      term.write('\r' + p + inp + '\x1b[K')
      if (cur < inp.length) term.write('\x1b[' + (inp.length - cur) + 'D')
    }

    term.onData(data => {
      // ── Ping in progress: only Ctrl-C allowed ───────────────────────────
      if (pingCancelRef.current) {
        if (data === '\x03') {
          pingCancelRef.current()
          pingCancelRef.current = null
          term.writeln('\r\n^C')
          writePrompt()
        }
        return
      }

      if (data === '\r') {
        // ── Enter ─────────────────────────────────────────────────────────
        const line = inputRef.current.trimEnd()
        const hist = historyRef.current
        if (line && hist[hist.length - 1] !== line) hist.push(line)
        histIdxRef.current  = -1
        savedLineRef.current = ''
        inputRef.current  = ''
        cursorRef.current = 0
        term.write('\r\n')
        if (!line) { writePrompt(); return }
        logExecutedCommandRef.current(device.id, line.trim())

        const tokens = line.trim().split(/\s+/)

        // ── exit ──────────────────────────────────────────────────────────
        // On a PC/server/phone/laptop shell, 'exit' always ends the session
        // (real bash/cmd.exe behavior). On a router/switch, 'exit' is a real
        // IOS command that just pops one config-mode level (interface config
        // → global config → priv exec → user exec) — it only actually ends
        // the session at user exec, the top level, matching a real device
        // dropping the connection. Any other mode falls through to the
        // normal engine dispatch below so mode navigation is unaffected.
        if (tokens[0].toLowerCase() === 'exit') {
          const endsSession = isPC || isWindows || device.config_mode === 'user_exec'
          if (endsSession) {
            term.writeln(isWindows ? 'Logging off.' : isPC ? 'logout' : '')
            setTimeout(() => {
              if (sessionCountRef.current <= 1) closeTerminalWindowRef.current()
              else closeTerminalRef.current(session.id)
            }, 400)
            return
          }
        }

        const isPingCmd  = tokens[0].toLowerCase() === 'ping' && tokens.length >= 2
        const pingTarget = isPingCmd ? tokens[tokens.length - 1] : null
        // Resolve hostname to IP for both animation and topology checks
        const resolvedPingTarget = pingTarget && !isValidIp(pingTarget)
          ? (resolveHostname(pingTarget) ?? null)
          : pingTarget

        if (pingTarget && resolvedPingTarget && isValidIp(resolvedPingTarget)) {
          // ── Async ping (IP or resolved hostname) ───────────────────────
          if (resolvedPingTarget !== pingTarget) {
            term.writeln(`Translating "${pingTarget}"... [OK] (${resolvedPingTarget})`)
          }
          // onDoneFired guards against a race: if executePingAsync fires onDone
          // synchronously (immediate fail / early-exit), pingCancelRef.current = cancel
          // below would overwrite the null that onDone already set, locking the terminal.
          let onDoneFired = false
          const cancel = eng.executePingAsync(device, resolvedPingTarget, {
            onStart: lines => lines.forEach(l => term.writeln(l)),
            onPacket: (i, reachable, _tgt, srcIp, failureReason, ttl, rtt) => {
              const pktSrcIp = srcIp ?? device.interfaces.find(f => f.status === 'up' && f.ip)?.ip
              if (isWindows) {
                if (reachable) {
                  const ms = rtt != null ? `${Math.max(1, Math.round(rtt))}ms` : '<1ms'
                  term.writeln(`\x1b[32mReply from ${resolvedPingTarget}: bytes=32 time=${ms} TTL=${ttl ?? 128}\x1b[0m`)
                } else {
                  term.writeln(`\x1b[31mRequest timed out.\x1b[0m`)
                }
              } else if (isPC) {
                if (reachable) {
                  const fromLabel = resolvedPingTarget !== pingTarget
                    ? `${pingTarget} (${resolvedPingTarget})`
                    : pingTarget
                  term.writeln(`\x1b[32m64 bytes from ${fromLabel}: icmp_seq=${i + 1} ttl=${ttl ?? 64} time=${rtt != null ? rtt.toFixed(3) : '?'} ms\x1b[0m`)
                } else {
                  // "Network is unreachable" cases are handled by early-exit in executePingAsync
                  // and never reach onPacket, so here we always show the ICMP error variant.
                  term.writeln(`\x1b[31mFrom ${pktSrcIp ?? ''} icmp_seq=${i + 1} Destination Host Unreachable\x1b[0m`)
                }
              } else {
                term.write(reachable ? '\x1b[32m!\x1b[0m' : '\x1b[31m.\x1b[0m')
              }
              if (pktSrcIp) {
                addPingAnimationRef.current(pktSrcIp, resolvedPingTarget, reachable)
              }
            },
            onDone: (lines, success) => {
              onDoneFired = true
              lines.forEach(l => term.writeln(l))
              pingCancelRef.current = null
              // Record that the user actually ran a ping (needed for mission task checks)
              if (success) {
                const srcIp = device.interfaces.find(i => i.status === 'up' && i.ip)?.ip
                if (srcIp) topology.logPing(srcIp, resolvedPingTarget)
              }
              refreshRef.current()
              writePrompt()
            },
          })
          if (!onDoneFired) pingCancelRef.current = cancel

        } else {
          // ── Synchronous command ────────────────────────────────────────
          const out = eng.execute(device, line)
          for (const l of out) {
            if (l === '\x1b[2J\x1b[H') term.clear()
            else term.writeln(l)
          }
          refreshRef.current()
          writePrompt()
        }

      } else if (data === '\x1b[A') {
        // ── Arrow Up — history back ────────────────────────────────────
        const hist = historyRef.current
        if (hist.length === 0) return
        if (histIdxRef.current === -1) {
          savedLineRef.current = inputRef.current
          histIdxRef.current   = hist.length - 1
        } else if (histIdxRef.current > 0) {
          histIdxRef.current--
        }
        inputRef.current  = hist[histIdxRef.current]
        cursorRef.current = inputRef.current.length
        redrawLine()

      } else if (data === '\x1b[B') {
        // ── Arrow Down — history forward ───────────────────────────────
        if (histIdxRef.current === -1) return
        histIdxRef.current++
        if (histIdxRef.current >= historyRef.current.length) {
          histIdxRef.current   = -1
          inputRef.current     = savedLineRef.current
        } else {
          inputRef.current = historyRef.current[histIdxRef.current]
        }
        cursorRef.current = inputRef.current.length
        redrawLine()

      } else if (data === '\x1b[D') {
        // ── Arrow Left ────────────────────────────────────────────────
        if (cursorRef.current > 0) {
          cursorRef.current--
          term.write('\x1b[D')
        }

      } else if (data === '\x1b[C') {
        // ── Arrow Right ───────────────────────────────────────────────
        if (cursorRef.current < inputRef.current.length) {
          cursorRef.current++
          term.write('\x1b[C')
        }

      } else if (data === '\x1b[H' || data === '\x01') {
        // ── Home / Ctrl+A — cursor to start ───────────────────────────
        if (cursorRef.current > 0) {
          term.write('\x1b[' + cursorRef.current + 'D')
          cursorRef.current = 0
        }

      } else if (data === '\x1b[F' || data === '\x05') {
        // ── End / Ctrl+E — cursor to end ──────────────────────────────
        const dist = inputRef.current.length - cursorRef.current
        if (dist > 0) {
          term.write('\x1b[' + dist + 'C')
          cursorRef.current = inputRef.current.length
        }

      } else if (data === '\x0b') {
        // ── Ctrl+K — kill to end of line ──────────────────────────────
        inputRef.current = inputRef.current.slice(0, cursorRef.current)
        term.write('\x1b[K')

      } else if (data === '\x15') {
        // ── Ctrl+U — kill entire line ─────────────────────────────────
        inputRef.current  = ''
        cursorRef.current = 0
        redrawLine()

      } else if (data === '\x17') {
        // ── Ctrl+W — kill word before cursor ──────────────────────────
        let i = cursorRef.current
        while (i > 0 && inputRef.current[i - 1] === ' ') i--
        while (i > 0 && inputRef.current[i - 1] !== ' ') i--
        inputRef.current  = inputRef.current.slice(0, i) + inputRef.current.slice(cursorRef.current)
        cursorRef.current = i
        redrawLine()

      } else if (data === '\x0c') {
        // ── Ctrl+L — clear screen ─────────────────────────────────────
        term.clear()
        term.write(prompt() + inputRef.current)
        if (cursorRef.current < inputRef.current.length) {
          term.write('\x1b[' + (inputRef.current.length - cursorRef.current) + 'D')
        }

      } else if (data === '\x1b[3~') {
        // ── Delete — delete char at cursor ────────────────────────────
        if (cursorRef.current < inputRef.current.length) {
          inputRef.current = inputRef.current.slice(0, cursorRef.current) +
            inputRef.current.slice(cursorRef.current + 1)
          term.write('\x1b[P')
        }

      } else if (data === '\x7f' || data === '\b') {
        // ── Backspace — delete char before cursor ─────────────────────
        if (cursorRef.current > 0) {
          inputRef.current = inputRef.current.slice(0, cursorRef.current - 1) +
            inputRef.current.slice(cursorRef.current)
          cursorRef.current--
          term.write('\x1b[D\x1b[P')
        }

      } else if (data === '\x03') {
        // ── Ctrl-C ────────────────────────────────────────────────────
        inputRef.current  = ''
        cursorRef.current = 0
        histIdxRef.current = -1
        term.write('^C')
        writePrompt()

      } else if (data === '\t') {
        // ── Tab completion ─────────────────────────────────────────────
        const result = eng.complete(device, inputRef.current)
        if (result.newInput !== inputRef.current) {
          inputRef.current  = result.newInput
          cursorRef.current = result.newInput.length
          redrawLine()
        }
        if (result.completions.length > 1) {
          term.write('\r\n  \x1b[90m' + result.completions.join('   ') + '\x1b[0m')
          term.write('\r\n' + prompt() + inputRef.current)
          if (cursorRef.current < inputRef.current.length) {
            term.write('\x1b[' + (inputRef.current.length - cursorRef.current) + 'D')
          }
        } else if (result.completions.length === 0 && result.newInput === inputRef.current) {
          term.write('\x07')
        }

      } else if (data.charCodeAt(0) >= 32 && data.charCodeAt(0) < 127) {
        // ── Printable character — insert at cursor ─────────────────────
        const inp = inputRef.current
        const cur = cursorRef.current
        inputRef.current = inp.slice(0, cur) + data + inp.slice(cur)
        cursorRef.current++
        if (cur === inp.length) {
          term.write(data)
        } else {
          term.write(data + inp.slice(cur) + '\x1b[' + (inp.length - cur) + 'D')
        }
      }
    })

    // Right-click pastes clipboard text at the cursor position
    const el = containerRef.current
    async function handleContextMenu(e) {
      e.preventDefault()
      if (pingCancelRef.current) return
      try {
        const text = await navigator.clipboard.readText()
        if (!text) return
        const pasted = text.replace(/\r\n/g, '\n').split('\n')[0]
        if (!pasted) return
        const inp = inputRef.current
        const cur = cursorRef.current
        inputRef.current  = inp.slice(0, cur) + pasted + inp.slice(cur)
        cursorRef.current += pasted.length
        redrawLine()
      } catch { /* clipboard access denied — silently ignore */ }
    }
    el.addEventListener('contextmenu', handleContextMenu)

    // Refit xterm whenever the container is resized (panel divider drag, float resize)
    const ro = new ResizeObserver(() => {
      if (fitAddonRef.current) requestAnimationFrame(() => fitAddonRef.current?.fit())
    })
    ro.observe(el)

    return () => {
      ro.disconnect()
      el.removeEventListener('contextmenu', handleContextMenu)
      pingCancelRef.current?.()
      if (xtermRef.current) {
        xtermRef.current.dispose()
        xtermRef.current  = null
        fitAddonRef.current = null
      }
    }
  }, [session.deviceId]) // eslint-disable-line react-hooks/exhaustive-deps

  return <div ref={containerRef} style={{ height: '100%', background: '#0b0f11' }} onClick={() => xtermRef.current?.focus()} />
}
