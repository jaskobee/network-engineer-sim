/**
 * Shared mission task-progress rendering — used by both the floating
 * ActiveJobPanel (near the floorplan) and MissionPanel's job board sidebar,
 * so the full step-by-step checklist is always visible somewhere on screen
 * and never depends on a player noticing a small "view tasks" button.
 */
import { useState } from 'react'

// ── Task rows ─────────────────────────────────────────────────────────────────

function DoneTask({ task }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12,
      padding: '10px 14px', borderBottom: '1px solid #080c12',
      background: '#04090a',
    }}>
      <div style={{
        width: 26, height: 26, borderRadius: '50%', flexShrink: 0,
        background: '#071510', border: '2px solid #1a5a20',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <span style={{ fontSize: 12, color: '#2a8a30', lineHeight: 1 }}>✓</span>
      </div>
      <span style={{ fontSize: 12, color: '#1d4a20', textDecoration: 'line-through', lineHeight: 1.4, flex: 1 }}>
        {task.label}
      </span>
    </div>
  )
}

function UpcomingTask({ task, num }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12,
      padding: '10px 14px', borderBottom: '1px solid #090910', opacity: 0.3,
    }}>
      <div style={{
        width: 26, height: 26, borderRadius: '50%', flexShrink: 0,
        background: '#09091a', border: '1.5px solid #1a1a30',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <span style={{ fontSize: 10, color: '#2a2a4a', fontFamily: 'monospace', fontWeight: 700 }}>{num}</span>
      </div>
      <span style={{ fontSize: 12, color: '#3a3a60', lineHeight: 1.4, flex: 1 }}>
        {task.label}
      </span>
    </div>
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

function ActiveTask({ task, num, difficulty, diagLines, executedCommands, resolvedRoles }) {
  const [showDiag, setShowDiag] = useState(false)

  const isBeginnerMode = difficulty === 'beginner'
  const hintArr    = Array.isArray(task.hint) ? task.hint : (task.hint ? [task.hint] : [])
  const actionText = hintArr[0] ?? null
  const cliItems   = hintArr.slice(1)   // mix of '# comment' strings and command strings/{role,cmd} objects
  const hasCli     = isBeginnerMode && cliItems.length > 0
  const hasDiag    = isBeginnerMode && diagLines?.length > 0

  return (
    <div style={{
      margin: '10px 10px 8px',
      background: '#060e1e',
      border: '2px solid #2a68d8',
      borderRadius: 8,
      boxShadow: '0 0 24px #2a68d815, 0 2px 12px #00000060',
    }}>
      {/* Step number + task label */}
      <div style={{ padding: '13px 13px 10px', display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <div style={{
          width: 30, height: 30, borderRadius: '50%', flexShrink: 0, marginTop: 1,
          background: '#0c1e40', border: '2px solid #3a78e8',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 0 10px #3a78e820',
        }}>
          <span style={{ fontSize: 12, color: '#5a98f8', fontFamily: 'monospace', fontWeight: 700 }}>{num}</span>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 8, fontWeight: 700, letterSpacing: 2, color: '#3a78d8', marginBottom: 5 }}>CURRENT TASK</div>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#d8eaff', lineHeight: 1.45 }}>{task.label}</div>
        </div>
      </div>

      {/* Action hint (beginner) */}
      {isBeginnerMode && actionText && (
        <div style={{ margin: '0 13px 10px', padding: '7px 10px', background: '#050c1c', borderRadius: 5, borderLeft: '3px solid #1a3a7a' }}>
          <div style={{ fontSize: 11, color: '#5a88c8', lineHeight: 1.6 }}>{actionText}</div>
        </div>
      )}

      {/* Beginner: command to-do checklist — always visible, ticks off as commands are typed */}
      {hasCli && (
        <div style={{ margin: '0 13px 10px', background: '#050d1c', border: '1px solid #1a3060', borderRadius: 5, overflow: 'hidden' }}>
          <div style={{ padding: '5px 10px 3px', fontSize: 8, fontWeight: 700, letterSpacing: 1.5, color: '#2a4a7a', borderBottom: '1px solid #0d1e38' }}>
            COMMANDS TO TYPE
          </div>
          {cliItems.map((item, i) => {
            const isComment = typeof item === 'string' && item.startsWith('# ')
            if (isComment) {
              return (
                <div key={i} style={{ fontSize: 9, fontFamily: 'monospace', color: '#2a3a5a', lineHeight: 1.6, padding: '4px 10px 0', fontStyle: 'italic' }}>
                  {item.slice(2)}
                </div>
              )
            }
            const cmd  = typeof item === 'string' ? item : item.cmd
            const done = isCommandDone(item, executedCommands, resolvedRoles)
            return (
              <div key={i} style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '4px 10px',
                background: done ? '#031008' : 'transparent',
                borderBottom: i < cliItems.length - 1 ? '1px solid #0a1528' : 'none',
              }}>
                <div style={{
                  width: 16, height: 16, borderRadius: '50%', flexShrink: 0,
                  background: done ? '#0a2510' : '#080d1e',
                  border: `1.5px solid ${done ? '#2a6a30' : '#1a2a50'}`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  {done && <span style={{ fontSize: 9, color: '#3aaa40', lineHeight: 1 }}>✓</span>}
                </div>
                <span style={{
                  fontSize: 11, fontFamily: 'monospace', lineHeight: 1.6, flex: 1,
                  color: done ? '#2a6a30' : '#5a8ad8',
                  textDecoration: done ? 'line-through' : 'none',
                  opacity: done ? 0.7 : 1,
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
        <div style={{ padding: '0 13px 10px', fontSize: 11, color: '#2a3a5a', fontStyle: 'italic' }}>
          {difficulty === 'networkEngineer' ? 'No hints. Use your knowledge.' : 'Type "help" in the terminal for guidance.'}
        </div>
      )}

      {/* Troubleshoot button */}
      {hasDiag && (
        <div style={{ padding: '0 13px 10px' }}>
          <button onClick={() => setShowDiag(v => !v)} style={{
            padding: '3px 10px', fontSize: 9, fontWeight: 700, letterSpacing: 0.4, cursor: 'pointer', borderRadius: 4,
            background: showDiag ? '#2a1400' : '#120800', color: showDiag ? '#ffb86c' : '#7a4a10',
            border: `1px solid ${showDiag ? '#5a3000' : '#3a1800'}`,
          }}>{showDiag ? '▴' : '▾'} TROUBLESHOOT</button>
        </div>
      )}

      {/* Troubleshoot block */}
      {hasDiag && showDiag && (
        <div style={{ margin: '0 13px 10px', padding: '8px 10px', background: '#120800', border: '1px solid #3a1800', borderRadius: 4 }}>
          {diagLines.map((line, i) => (
            <div key={i} style={{ fontSize: 10, fontFamily: 'monospace', lineHeight: 1.7, color: line.startsWith('  ') ? '#5a9ae2' : '#ffb86c', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
              {line.startsWith('  ') ? line : `▸ ${line}`}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Progress bar ──────────────────────────────────────────────────────────────

export function MissionProgressBar({ tasks, checks }) {
  return (
    <div style={{ display: 'flex', gap: 3, height: 5 }}>
      {tasks.map((t, i) => (
        <div key={t.id} style={{
          flex: 1, borderRadius: 3,
          background: checks[t.id] ? '#2a8a30'
            : (!checks[t.id] && (i === 0 || checks[tasks[i - 1]?.id])) ? '#2a60c8'
            : '#0f1228',
          transition: 'background 0.3s ease',
        }} />
      ))}
    </div>
  )
}

// ── Full ordered task list ────────────────────────────────────────────────────

export function MissionTaskRows({ tasks, checks, difficulty, diagFacts, executedCommands, resolvedRoles }) {
  const allTasksDone = tasks.length > 0 && tasks.every(t => !!checks[t.id])
  const ordinals = tasks.map((_, i) => i + 1)
  return (
    <div>
      {tasks.map((task, i) => {
        const isChecked   = !!checks[task.id]
        const prevChecked = i === 0 || !!checks[tasks[i - 1].id]
        const isActive    = !isChecked && prevChecked
        const num         = ordinals[i]
        if (isChecked) return <DoneTask     key={task.id} task={task} num={num} />
        if (isActive)  return <ActiveTask   key={task.id} task={task} num={num} difficulty={difficulty} diagLines={diagFacts?.[task.id] ?? null} executedCommands={executedCommands} resolvedRoles={resolvedRoles} />
        return             <UpcomingTask key={task.id} task={task} num={num} />
      })}
      {allTasksDone && (
        <div style={{ padding: '16px 14px', textAlign: 'center' }}>
          <div style={{ fontSize: 12, color: '#50fa7b', fontWeight: 700, letterSpacing: 1 }}>ALL TASKS COMPLETE</div>
          <div style={{ fontSize: 10, color: '#2a4a2a', marginTop: 4 }}>Collect your reward from the completion screen</div>
        </div>
      )}
    </div>
  )
}
