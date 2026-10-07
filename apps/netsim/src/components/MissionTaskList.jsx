/**
 * Shared mission task-progress rendering — used by both the floating
 * ActiveJobPanel (near the floorplan) and MissionPanel's job board sidebar,
 * so the full step-by-step checklist is always visible somewhere on screen
 * and never depends on a player noticing a small "view tasks" button.
 *
 * Progress is drawn as a patch cable: one port LED per task, with the cable lit
 * up to the step you're on. (Styles: .step in index.css.)
 */
import { useState } from 'react'

// ── Step wrapper (LED + cable segments) ───────────────────────────────────────

function Step({ state, first, last, prevDone, children }) {
  const cls = ['step', first && 'first', last && 'last', prevDone && 'lit-above', state === 'done' && 'lit-below']
    .filter(Boolean).join(' ')
  const ledCls = state === 'done' ? 'green' : state === 'active' ? 'blue breathe' : ''
  return (
    <div className={cls}>
      <i className={`led step-led ${ledCls}`} />
      <div className="step-body">{children}</div>
    </div>
  )
}

// ── Task rows ─────────────────────────────────────────────────────────────────

function DoneTask({ task, ...pos }) {
  return (
    <Step state="done" {...pos}>
      <span style={{ fontSize: 14.5, color: 'var(--ink-3)', lineHeight: 1.4 }}>{task.label}</span>
    </Step>
  )
}

function UpcomingTask({ task, ...pos }) {
  return (
    <Step state="todo" {...pos}>
      <span style={{ fontSize: 14.5, color: 'var(--ink-2)', lineHeight: 1.4 }}>{task.label}</span>
    </Step>
  )
}

// A hint command is either a plain string (legacy shape — ticks off if that
// exact text was typed on ANY device, matching the original behavior every
// existing mission relies on) or `{ role, cmd }` (ticks off only if `cmd` was
// typed on the SPECIFIC device that role resolves to). The object form is what
// makes a multi-device task (e.g. "bring up eth0" on three different PCs)
// track each device independently, instead of one PC's command falsely
// checking off the same line for the other two.
function isCommandDone(item, executedCommands, resolvedRoles) {
  if (typeof item === 'string') {
    for (const set of executedCommands.values()) if (set.has(item)) return true
    return false
  }
  const deviceId = resolvedRoles?.[item.role]?.id
  return !!deviceId && !!executedCommands.get(deviceId)?.has(item.cmd)
}

function ActiveTask({ task, difficulty, diagLines, executedCommands, resolvedRoles, ...pos }) {
  const [showDiag, setShowDiag] = useState(false)

  const isBeginnerMode = difficulty === 'beginner'
  const hintArr    = Array.isArray(task.hint) ? task.hint : (task.hint ? [task.hint] : [])
  const actionText = hintArr[0] ?? null
  const cliItems   = hintArr.slice(1)   // mix of '# comment' strings and command strings/{role,cmd} objects
  const hasCli     = isBeginnerMode && cliItems.length > 0
  const hasDiag    = isBeginnerMode && diagLines?.length > 0

  return (
    <Step state="active" {...pos}>
      <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--ink)', lineHeight: 1.35 }}>{task.label}</div>

      {/* Action hint (beginner) */}
      {isBeginnerMode && actionText && (
        <p style={{ margin: '6px 0 0', fontSize: 14.5, color: 'var(--ink-2)', lineHeight: 1.55 }}>{actionText}</p>
      )}

      {/* Beginner: command to-do checklist — always visible, ticks off as commands are typed */}
      {hasCli && (
        <div style={{
          margin: '10px 0 0', background: 'var(--surface-well)',
          border: '1px solid var(--rule)', borderRadius: 6, overflow: 'hidden',
        }}>
          <div style={{ padding: '6px 10px', fontSize: 13, fontWeight: 600, color: 'var(--ink-3)', borderBottom: '1px solid var(--rule)' }}>
            Commands to type
          </div>
          {cliItems.map((item, i) => {
            const isComment = typeof item === 'string' && item.startsWith('# ')
            if (isComment) {
              return (
                <div key={i} style={{ fontSize: 12.5, fontFamily: 'var(--font-mono)', color: 'var(--ink-3)', lineHeight: 1.6, padding: '6px 10px 0' }}>
                  {item.slice(2)}
                </div>
              )
            }
            const cmd  = typeof item === 'string' ? item : item.cmd
            const done = isCommandDone(item, executedCommands, resolvedRoles)
            return (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '5px 10px' }}>
                <i className={`led ${done ? 'green' : ''}`} style={{ width: 8, height: 8 }} />
                <span style={{
                  fontSize: 13, fontFamily: 'var(--font-mono)', lineHeight: 1.5, flex: 1,
                  color: done ? 'var(--ink-3)' : 'var(--ink)',
                  wordBreak: 'break-word',
                }}>
                  {cmd}
                </span>
              </div>
            )
          })}
        </div>
      )}

      {/* Non-beginner note */}
      {!isBeginnerMode && (
        <p style={{ margin: '6px 0 0', fontSize: 14, color: 'var(--ink-3)' }}>
          {difficulty === 'networkEngineer' ? 'No hints. Use your knowledge.' : 'Type "help" in the terminal for guidance.'}
        </p>
      )}

      {/* Troubleshoot */}
      {hasDiag && (
        <button
          className="btn"
          onClick={() => setShowDiag(v => !v)}
          aria-expanded={showDiag}
          style={{ marginTop: 10, padding: '3px 10px', fontSize: 13, color: 'var(--led-amber)', borderColor: showDiag ? '#6b4a10' : 'var(--rule-strong)' }}
        >
          {showDiag ? 'Hide troubleshooting' : 'Troubleshoot'}
        </button>
      )}

      {hasDiag && showDiag && (
        <div style={{ marginTop: 8, padding: '8px 10px', background: '#1d1608', border: '1px solid #4a3812', borderRadius: 6 }}>
          {diagLines.map((line, i) => (
            <div key={i} style={{
              fontSize: 12.5, fontFamily: 'var(--font-mono)', lineHeight: 1.7,
              color: line.startsWith('  ') ? 'var(--ink-2)' : 'var(--led-amber)',
              whiteSpace: 'pre-wrap', wordBreak: 'break-word',
            }}>
              {line.startsWith('  ') ? line : `▸ ${line}`}
            </div>
          ))}
        </div>
      )}
    </Step>
  )
}

// ── Progress bar ──────────────────────────────────────────────────────────────

export function MissionProgressBar({ tasks, checks }) {
  return (
    <div style={{ display: 'flex', gap: 3, height: 4 }}>
      {tasks.map((t, i) => (
        <div key={t.id} style={{
          flex: 1, borderRadius: 2,
          background: checks[t.id] ? 'var(--led-green)'
            : (!checks[t.id] && (i === 0 || checks[tasks[i - 1]?.id])) ? 'var(--signal)'
            : 'var(--rule-strong)',
          transition: 'background 0.3s ease',
        }} />
      ))}
    </div>
  )
}

// ── Full ordered task list ────────────────────────────────────────────────────

export function MissionTaskRows({ tasks, checks, difficulty, diagFacts, executedCommands, resolvedRoles }) {
  const allTasksDone = tasks.length > 0 && tasks.every(t => !!checks[t.id])
  return (
    <div style={{ paddingTop: 4 }}>
      {tasks.map((task, i) => {
        const isChecked   = !!checks[task.id]
        const prevChecked = i === 0 || !!checks[tasks[i - 1].id]
        const isActive    = !isChecked && prevChecked
        const pos = { first: i === 0, last: i === tasks.length - 1, prevDone: i > 0 && !!checks[tasks[i - 1].id] }
        if (isChecked) return <DoneTask     key={task.id} task={task} {...pos} />
        if (isActive)  return <ActiveTask   key={task.id} task={task} {...pos} difficulty={difficulty} diagLines={diagFacts?.[task.id] ?? null} executedCommands={executedCommands} resolvedRoles={resolvedRoles} />
        return             <UpcomingTask key={task.id} task={task} {...pos} />
      })}
      {allTasksDone && (
        <div style={{ padding: '10px 16px 16px', display: 'flex', alignItems: 'center', gap: 10 }}>
          <i className="led green" />
          <div>
            <div style={{ fontSize: 15, color: 'var(--led-green)', fontWeight: 700 }}>All tasks complete</div>
            <div style={{ fontSize: 13.5, color: 'var(--ink-3)', marginTop: 1 }}>Collect your reward from the completion screen</div>
          </div>
        </div>
      )}
    </div>
  )
}
