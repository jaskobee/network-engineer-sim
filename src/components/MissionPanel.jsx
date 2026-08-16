import { useState, useEffect, useRef } from 'react'
import { useGame } from '../state/GameContext.jsx'
import { MISSIONS } from '../data/missions.js'
import { MISSION_TASKS } from '../data/missionTasks.js'
import { deviceCatalog } from '../data/deviceCatalog.js'

// ── Helpers ───────────────────────────────────────────────────────────────────

// ── Network Blueprint diagram ─────────────────────────────────────────────────

const BP_HEADER_H  = 40
const BP_DEVICE_H  = 17
const BP_PAD_B     = 10
const BP_SEG_W     = 155

const BP_GLYPHS = { router: '▣', switch: '▤', pc: '▢', server: '▥' }
const BP_COLORS = { router: '#4a90e2', switch: '#50fa7b', pc: '#8090c0', server: '#ffb86c' }

function bpSegH(devices) {
  return BP_HEADER_H + (devices?.length ?? 0) * BP_DEVICE_H + BP_PAD_B
}

function SegmentBox({ seg }) {
  const h  = bpSegH(seg.devices)
  const cx = seg.svgX + BP_SEG_W / 2
  return (
    <g>
      <rect
        x={seg.svgX} y={seg.svgY} width={BP_SEG_W} height={h} rx="5"
        fill="#07101e" stroke="#1a3868" strokeWidth="1.2"
      />
      <line
        x1={seg.svgX + 1} y1={seg.svgY + BP_HEADER_H}
        x2={seg.svgX + BP_SEG_W - 1} y2={seg.svgY + BP_HEADER_H}
        stroke="#0f1e3a" strokeWidth="1"
      />
      <text
        x={cx} y={seg.svgY + 16}
        textAnchor="middle" fontSize="10" fontWeight="700" fill="#5a9ae0"
        fontFamily="'Segoe UI', system-ui, sans-serif"
      >
        {seg.label}
      </text>
      <text
        x={cx} y={seg.svgY + 30}
        textAnchor="middle" fontSize="8" fill="#243a6a" fontFamily="monospace"
      >
        {seg.subnet}
      </text>
      {(seg.devices ?? []).map((d, i) => (
        <text
          key={i}
          x={seg.svgX + 10}
          y={seg.svgY + BP_HEADER_H + i * BP_DEVICE_H + 13}
          fontSize="9" fontFamily="'Segoe UI', system-ui, sans-serif"
        >
          <tspan fill={BP_COLORS[d.type] ?? '#555'}>{BP_GLYPHS[d.type] ?? '◦'} </tspan>
          <tspan fill="#5a6a90">{d.role}</tspan>
        </text>
      ))}
    </g>
  )
}

function SegLink({ link, segMap }) {
  const fromSeg = segMap[link.from]
  const toSeg   = segMap[link.to]
  if (!fromSeg || !toSeg) return null

  const fromH  = bpSegH(fromSeg.devices)
  const toH    = bpSegH(toSeg.devices)
  const fromCX = fromSeg.svgX + BP_SEG_W / 2
  const fromCY = fromSeg.svgY + fromH / 2
  const toCX   = toSeg.svgX + BP_SEG_W / 2
  const toCY   = toSeg.svgY + toH / 2
  const isHoriz = Math.abs(toCX - fromCX) >= Math.abs(toCY - fromCY)

  let x1, y1, x2, y2, labelX, labelY, labelAnchor

  if (isHoriz) {
    const [left, right] = fromSeg.svgX <= toSeg.svgX
      ? [fromSeg, toSeg] : [toSeg, fromSeg]
    const lH = bpSegH(left.devices)
    const rH = bpSegH(right.devices)
    x1 = left.svgX + BP_SEG_W; y1 = left.svgY + lH / 2
    x2 = right.svgX;           y2 = right.svgY + rH / 2
    labelX = (x1 + x2) / 2
    labelY = Math.min(y1, y2) - 5
    labelAnchor = 'middle'
  } else {
    const [top, bot] = fromSeg.svgY <= toSeg.svgY
      ? [fromSeg, toSeg] : [toSeg, fromSeg]
    const tH = bpSegH(top.devices)
    x1 = top.svgX + BP_SEG_W / 2; y1 = top.svgY + tH
    x2 = bot.svgX + BP_SEG_W / 2; y2 = bot.svgY
    labelX = x1 + 10; labelY = (y1 + y2) / 2 + 4
    labelAnchor = 'start'
  }

  const isWan = link.type === 'wan'
  return (
    <g>
      <line
        x1={x1} y1={y1} x2={x2} y2={y2}
        stroke={isWan ? '#2a5080' : '#1a4a30'}
        strokeWidth={isWan ? 2 : 1.5}
        strokeDasharray={isWan ? '6,3' : '4,2'}
      />
      <text
        x={labelX} y={labelY}
        textAnchor={labelAnchor} fontSize="8"
        fill={isWan ? '#3a6090' : '#2a5040'}
        fontFamily="monospace"
      >
        {link.label}
      </text>
    </g>
  )
}

function BlueprintModal({ mission, onClose }) {
  const bp = mission.blueprint
  if (!bp) return null
  const segMap = Object.fromEntries((bp.segments ?? []).map(s => [s.id, s]))
  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 1800,
        background: 'rgba(0,0,0,0.88)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: '#080d1c', border: '1px solid #1a3060',
          borderRadius: 10, padding: '18px 20px',
          maxWidth: 460, width: '90vw',
          boxShadow: '0 0 60px #1a3a8020',
        }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: 9, color: '#3a5a8a', fontWeight: 700, letterSpacing: 2, marginBottom: 2 }}>
              NETWORK BLUEPRINT
            </div>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#b0bcd0' }}>{mission.title}</div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'none', border: '1px solid #1a2a40',
              color: '#3a4a60', cursor: 'pointer',
              borderRadius: 4, padding: '2px 8px', fontSize: 12, lineHeight: 1.4,
            }}
          >
            ✕
          </button>
        </div>

        <svg
          viewBox={bp.svgViewBox ?? '0 0 400 200'}
          style={{ width: '100%', height: 'auto', display: 'block' }}
        >
          {(bp.links ?? []).map((link, i) => (
            <SegLink key={i} link={link} segMap={segMap} />
          ))}
          {(bp.segments ?? []).map(seg => (
            <SegmentBox key={seg.id} seg={seg} />
          ))}
        </svg>

        {bp.notes && (
          <div style={{
            fontSize: 10, color: '#3a4a70', lineHeight: 1.55,
            marginTop: 10, paddingTop: 10, borderTop: '1px solid #0d1630',
          }}>
            {bp.notes}
          </div>
        )}

        <div style={{ textAlign: 'center', marginTop: 14 }}>
          <button
            onClick={onClose}
            style={{
              background: '#0c1628', border: '1px solid #1e3a60',
              color: '#3a6898', padding: '7px 24px',
              borderRadius: 5, fontSize: 11, fontWeight: 700,
              cursor: 'pointer', letterSpacing: 0.5,
            }}
            onMouseEnter={e => { e.currentTarget.style.color = '#5a90c8'; e.currentTarget.style.borderColor = '#2a5080' }}
            onMouseLeave={e => { e.currentTarget.style.color = '#3a6898'; e.currentTarget.style.borderColor = '#1e3a60' }}
          >
            GOT IT
          </button>
        </div>
      </div>
    </div>
  )
}

function Stars({ n }) {
  const max = 5
  const filled = Math.max(0, Math.min(n ?? 0, max))
  return (
    <span style={{ color: '#ffb86c', fontSize: 10 }}>
      {'★'.repeat(filled)}{'☆'.repeat(max - filled)}
    </span>
  )
}

// ── Completion modal ──────────────────────────────────────────────────────────

function CompletionModal({ mission, refund, onCollect }) {
  const skills = mission.taught ?? []
  const total = mission.reward + (refund || 0)
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 2000,
      background: 'rgba(0,0,0,0.75)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{
        background: '#0d1226', border: '2px solid #50fa7b', borderRadius: 12,
        padding: '32px 36px', maxWidth: 440, width: '90%',
        boxShadow: '0 0 60px #50fa7b30', textAlign: 'center',
      }}>
        <div style={{ fontSize: 48, marginBottom: 8 }}>{mission.avatar}</div>
        <div style={{ fontSize: 11, color: '#50fa7b', fontWeight: 700, letterSpacing: 2, marginBottom: 8 }}>
          MISSION COMPLETE
        </div>
        <div style={{ fontSize: 18, fontWeight: 700, color: '#e0e0e0', marginBottom: 4 }}>
          {mission.title}
        </div>
        <div style={{ fontSize: 11, color: '#555', marginBottom: 20 }}>
          {mission.client} is happy with your work.
        </div>
        <div style={{
          background: '#070d1a', borderRadius: 8, padding: '14px 16px',
          textAlign: 'left', marginBottom: 20,
        }}>
          <div style={{ fontSize: 10, color: '#4a90e2', fontWeight: 700, letterSpacing: 1, marginBottom: 8 }}>
            WHAT YOU CONFIGURED
          </div>
          {skills.map((s, i) => (
            <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginBottom: 5 }}>
              <span style={{ color: '#50fa7b', fontSize: 12, marginTop: 1 }}>✓</span>
              <span style={{ fontSize: 12, color: '#c0c0c0' }}>{s}</span>
            </div>
          ))}
        </div>
        <div style={{ background: '#070d1a', borderRadius: 8, padding: '12px 16px', marginBottom: 24, textAlign: 'left' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
            <span style={{ fontSize: 11, color: '#555' }}>Job payout</span>
            <span style={{ fontSize: 13, fontWeight: 700, color: '#50fa7b', fontFamily: 'monospace' }}>+${mission.reward.toLocaleString()}</span>
          </div>
          {refund > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ fontSize: 11, color: '#555' }}>Equipment returned</span>
              <span style={{ fontSize: 13, fontWeight: 700, color: '#4a90e2', fontFamily: 'monospace' }}>+${refund.toLocaleString()}</span>
            </div>
          )}
          <div style={{ height: 1, background: '#1a2a40', margin: '8px 0' }} />
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 12, color: '#888', fontWeight: 700 }}>TOTAL</span>
            <span style={{ fontSize: 20, fontWeight: 700, color: '#50fa7b', fontFamily: 'monospace' }}>+${total.toLocaleString()}</span>
          </div>
        </div>
        <button
          onClick={onCollect}
          style={{
            background: '#50fa7b', color: '#0a0a0f',
            border: 'none', borderRadius: 6, padding: '10px 32px',
            fontSize: 14, fontWeight: 700, cursor: 'pointer', letterSpacing: 1,
          }}
          onMouseEnter={e => { e.currentTarget.style.background = '#40ea6b' }}
          onMouseLeave={e => { e.currentTarget.style.background = '#50fa7b' }}
        >
          COLLECT REWARD
        </button>
        <div style={{ fontSize: 10, color: '#2a2a40', marginTop: 12 }}>
          Your setup stays up — explore it, then accept the next job when ready.
        </div>
      </div>
    </div>
  )
}

// ── Floor plan brief (mission 004 and any future multi-zone missions) ────────

function FloorPlanBrief({ layout }) {
  const [open, setOpen] = useState(false)
  return (
    <div style={{ margin: '0 14px 6px', borderRadius: 4, overflow: 'hidden', border: '1px solid #1a1a3e' }}>
      <button
        onClick={() => setOpen(v => !v)}
        style={{
          width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '5px 10px', background: '#090d1c', border: 'none', cursor: 'pointer',
        }}
        onMouseEnter={e => { e.currentTarget.style.background = '#0d1228' }}
        onMouseLeave={e => { e.currentTarget.style.background = '#090d1c' }}
      >
        <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: 1, color: '#3a4a7a' }}>
          {open ? '▴' : '▾'} FLOOR PLAN
        </span>
        <span style={{ fontSize: 9, color: '#2a2a50' }}>{open ? 'collapse' : 'show layout'}</span>
      </button>
      {open && (
        <div style={{ background: '#07091a', padding: '10px 10px 6px' }}>
          {layout.map((row, i) => (
            <div key={i} style={{
              marginBottom: i < layout.length - 1 ? 10 : 0,
              paddingBottom: i < layout.length - 1 ? 10 : 0,
              borderBottom: i < layout.length - 1 ? '1px solid #0f1128' : 'none',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 3 }}>
                <span style={{ fontSize: 10, fontWeight: 700, color: '#5a90e2', letterSpacing: 0.3 }}>{row.zone}</span>
                <span style={{ fontSize: 9, color: '#2a4a7a', fontFamily: 'monospace', flexShrink: 0, marginLeft: 6 }}>{row.subnet}</span>
              </div>
              <div style={{ fontSize: 10, color: '#4a4a80', lineHeight: 1.5, marginBottom: row.note ? 3 : 0 }}>
                {row.devices}
              </div>
              {row.note && (
                <div style={{ fontSize: 9, color: '#2a3a5a', lineHeight: 1.5, fontStyle: 'italic' }}>
                  {row.note}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Task tiers: done / active / upcoming ─────────────────────────────────────

function DoneTask({ task }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8,
      padding: '4px 14px', borderBottom: '1px solid #0a0a10',
    }}>
      <span style={{ fontSize: 10, color: '#1a5a1a', flexShrink: 0 }}>✓</span>
      <span style={{
        fontSize: 11, color: '#1e4a1e', textDecoration: 'line-through',
        lineHeight: 1.3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {task.label}
      </span>
    </div>
  )
}

function UpcomingTask({ task }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8,
      padding: '4px 14px', borderBottom: '1px solid #0a0a10', opacity: 0.3,
    }}>
      <span style={{ fontSize: 9, color: '#2a2a4a', flexShrink: 0 }}>○</span>
      <span style={{
        fontSize: 11, color: '#3a3a60', lineHeight: 1.3,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {task.label}
      </span>
    </div>
  )
}

function ActiveTask({ task, difficulty, diagLines }) {
  const [showDiag, setShowDiag] = useState(false)
  const [showHint, setShowHint] = useState(false)

  const isBeginnerMode = difficulty === 'beginner'
  const hintArr    = Array.isArray(task.hint) ? task.hint : (task.hint ? [task.hint] : [])
  const actionText = hintArr[0] ?? null
  const cliCmds    = hintArr.slice(1)
  const hasCli     = isBeginnerMode && cliCmds.length > 0
  const hasDiag    = isBeginnerMode && diagLines?.length > 0

  return (
    <div style={{
      margin: '8px 10px 6px',
      background: '#080d1c',
      border: '1px solid #2a5298',
      borderRadius: 6,
      boxShadow: '0 0 18px #4a90e21a',
    }}>
      {/* NOW badge + label */}
      <div style={{ padding: '10px 12px 8px' }}>
        <div style={{ marginBottom: 5 }}>
          <span style={{
            fontSize: 8, fontWeight: 700, letterSpacing: 1.2,
            color: '#4a90e2', background: '#0c1628',
            border: '1px solid #1e3a6e', borderRadius: 3,
            padding: '2px 6px',
          }}>▶ NOW</span>
        </div>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#e8e8f0', lineHeight: 1.4 }}>
          {task.label}
        </div>
      </div>

      {/* Action instruction — beginner only */}
      {isBeginnerMode && actionText && (
        <div style={{
          margin: '0 12px 8px', padding: '5px 8px',
          background: '#060b18', borderRadius: 4, border: '1px solid #0f1f3a',
        }}>
          <div style={{ fontSize: 10, color: '#6a9ad4', lineHeight: 1.55 }}>
            {actionText}
          </div>
        </div>
      )}

      {/* Difficulty note — non-beginner */}
      {!isBeginnerMode && (
        <div style={{ padding: '0 12px 8px', fontSize: 10, color: '#2a3a5a', fontStyle: 'italic' }}>
          {difficulty === 'networkEngineer'
            ? 'No hints. Use your knowledge.'
            : 'Type "help" or "man <cmd>" in the terminal for guidance.'}
        </div>
      )}

      {/* Button row */}
      {(hasDiag || hasCli) && (
        <div style={{ padding: '0 12px 8px', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {hasDiag && (
            <button
              onClick={() => setShowDiag(v => !v)}
              style={{
                padding: '2px 7px', fontSize: 9, fontWeight: 700, letterSpacing: 0.4,
                background: showDiag ? '#2a1400' : '#160900',
                color: showDiag ? '#ffb86c' : '#7a4a10',
                border: `1px solid ${showDiag ? '#5a3000' : '#3a1800'}`,
                borderRadius: 3, cursor: 'pointer',
              }}
            >
              {showDiag ? '▴' : '▾'} TROUBLESHOOT
            </button>
          )}
          {hasCli && (
            <button
              onClick={() => setShowHint(v => !v)}
              style={{
                padding: '2px 7px', fontSize: 9, fontWeight: 700, letterSpacing: 0.4,
                background: 'transparent',
                color: showHint ? '#4a90e2' : '#253a60',
                border: `1px solid ${showHint ? '#2a5298' : '#1a2a40'}`,
                borderRadius: 3, cursor: 'pointer',
              }}
            >
              {showHint ? '▴' : '▾'} NEED A HINT?
            </button>
          )}
        </div>
      )}

      {/* Troubleshoot expanded block */}
      {hasDiag && showDiag && (
        <div style={{
          margin: '0 12px 8px', padding: '6px 8px',
          background: '#160900', border: '1px solid #3a1800', borderRadius: 3,
        }}>
          {diagLines.map((line, i) => (
            <div key={i} style={{
              fontSize: 10, fontFamily: 'monospace', lineHeight: 1.65,
              color: line.startsWith('  ') ? '#5a9ae2' : '#ffb86c',
              whiteSpace: 'pre-wrap', wordBreak: 'break-word',
            }}>
              {line.startsWith('  ') ? line : `▸ ${line}`}
            </div>
          ))}
        </div>
      )}

      {/* CLI hint expanded block */}
      {hasCli && showHint && (
        <div style={{
          margin: '0 12px 8px', padding: '6px 8px',
          background: '#07101e', border: '1px solid #1a3060', borderRadius: 3,
        }}>
          {cliCmds.map((cmd, i) => {
            const isComment = cmd.startsWith('# ')
            return (
              <div key={i} style={{
                fontSize: isComment ? 9 : 11,
                fontFamily: 'monospace',
                color: isComment ? '#4a5a7a' : '#4a90e2',
                lineHeight: 1.65,
                paddingLeft: 4,
                marginTop: isComment && i > 0 ? 6 : 0,
              }}>
                {isComment ? cmd.slice(2) : `$ ${cmd}`}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Job card (available / locked missions in the job board) ───────────────────

function JobCard({ mission, unlocked, onAccept }) {
  const hw = mission.hardware ?? []
  return (
    <div style={{
      margin: '8px 12px',
      background: '#0a0f1e',
      border: `1px solid ${unlocked ? '#1a3060' : '#0d0d20'}`,
      borderRadius: 6, overflow: 'hidden', opacity: unlocked ? 1 : 0.5,
    }}>
      <div style={{ padding: '8px 12px 6px', display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <span style={{ fontSize: 22, lineHeight: 1.2 }}>{mission.avatar}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#c0c0c0', marginBottom: 2 }}>{mission.title}</div>
          <div style={{ fontSize: 10, color: '#444' }}>{mission.client}</div>
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#50fa7b', fontFamily: 'monospace' }}>
            ${mission.reward.toLocaleString()}
          </div>
          <Stars n={mission.difficulty} />
        </div>
      </div>
      <div style={{ padding: '4px 12px 8px', borderTop: '1px solid #0d0d20' }}>
        <div style={{ fontSize: 10, color: unlocked ? '#3a3a60' : '#22223a', lineHeight: 1.6, marginBottom: 6 }}>
          {unlocked ? mission.description : '🔒 Complete previous job first'}
        </div>
        {hw.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: unlocked ? 8 : 0 }}>
            {hw.map((h, i) => (
              <span key={i} style={{
                fontSize: 9, fontFamily: 'monospace',
                color: unlocked ? '#4a90e2' : '#222244',
                background: unlocked ? '#0a1528' : '#0a0a14',
                padding: '1px 6px', borderRadius: 3,
                border: `1px solid ${unlocked ? '#1a3060' : '#1a1a30'}`,
              }}>
                {h.label}
              </span>
            ))}
          </div>
        )}
        {unlocked && (
          <button
            onClick={onAccept}
            style={{
              width: '100%', padding: '6px 0', fontSize: 11, fontWeight: 700,
              background: '#1a3060', color: '#4a90e2',
              border: '1px solid #2a5298', borderRadius: 4, cursor: 'pointer',
              letterSpacing: 0.5, transition: 'all 0.15s',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = '#2a5298'; e.currentTarget.style.color = '#e0e0e0' }}
            onMouseLeave={e => { e.currentTarget.style.background = '#1a3060'; e.currentTarget.style.color = '#4a90e2' }}
          >
            ACCEPT JOB
          </button>
        )}
      </div>
    </div>
  )
}

// ── Archived completed mission (expandable) ───────────────────────────────────

function ArchivedMission({ mission }) {
  const [expanded, setExpanded] = useState(false)
  const missionEntry = MISSION_TASKS[mission.id]
  const tasks = missionEntry?.tasks ?? []

  return (
    <div style={{ borderBottom: '1px solid #0d0d1a' }}>
      <div
        onClick={() => setExpanded(e => !e)}
        style={{
          padding: '8px 14px', cursor: 'pointer',
          display: 'flex', alignItems: 'center', gap: 8,
        }}
        onMouseEnter={e => { e.currentTarget.style.background = '#0a0f1a' }}
        onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
      >
        <span style={{ fontSize: 16 }}>{mission.avatar}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 10, color: '#50fa7b', fontWeight: 700 }}>✓ COMPLETE</div>
          <div style={{ fontSize: 11, color: '#2a6a2a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {mission.title}
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
          <div style={{ fontSize: 11, color: '#2a6a2a', fontFamily: 'monospace' }}>
            +${mission.reward.toLocaleString()}
          </div>
          <span style={{ fontSize: 9, color: '#2a2a50' }}>{expanded ? '▲' : '▼'}</span>
        </div>
      </div>
      {expanded && tasks.length > 0 && (
        <div style={{ background: '#070a10', borderTop: '1px solid #0d0d1a' }}>
          {tasks.map(task => (
            <div key={task.id} style={{
              padding: '5px 14px 5px 36px', borderBottom: '1px solid #0a0a12',
              display: 'flex', gap: 8, alignItems: 'center',
            }}>
              <span style={{ fontSize: 10, color: '#1a5a1a' }}>✓</span>
              <span style={{ fontSize: 11, color: '#1a5a1a', textDecoration: 'line-through' }}>{task.label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Panel root ────────────────────────────────────────────────────────────────

export default function MissionPanel() {
  const {
    devices, placements, topology, budget, tick,
    completedMissions, completeMission,
    activeMissionId, acceptMission,
    difficulty,
  } = useGame()

  void tick  // re-evaluate task checks on every tick

  const activeMission   = MISSIONS.find(m => m.id === activeMissionId) ?? null
  const allDone         = completedMissions.length === MISSIONS.length
  const totalEarned     = completedMissions.reduce((s, m) => s + m.reward, 0)

  const [blueprintOpen, setBlueprintOpen] = useState(false)
  const prevMissionIdRef = useRef(null)

  // Auto-show blueprint once when a new mission with one is accepted
  useEffect(() => {
    if (activeMissionId !== prevMissionIdRef.current) {
      prevMissionIdRef.current = activeMissionId
      const m = MISSIONS.find(ms => ms.id === activeMissionId)
      setBlueprintOpen(!!(m?.blueprint))
    }
  }, [activeMissionId])

  // Compute task completion for the active mission
  const missionEntry = activeMission ? MISSION_TASKS[activeMission.id] : null
  const tasks        = missionEntry?.tasks ?? []
  const checks       = missionEntry ? missionEntry.checkFn(devices, placements, topology) : {}
  const checkValues  = tasks.map(t => !!checks[t.id])
  // Diagnostic hints: computed only in beginner mode (calls checkPing internally for t9)
  const diagFacts    = (missionEntry?.diagnoseFn && difficulty === 'beginner')
    ? missionEntry.diagnoseFn(devices, placements, topology, checks)
    : {}
  const passed       = checkValues.filter(Boolean).length
  const allTasksDone = tasks.length > 0 && passed === tasks.length
  const isClaimed    = activeMission
    ? completedMissions.some(c => c.id === activeMission.id)
    : false
  const showModal    = allTasksDone && activeMission && !isClaimed

  // Equipment refund shown in the completion modal (actual refund applied in completeMission)
  // ISP is mission infrastructure — it's not counted as purchased equipment
  const pendingRefund = [...topology.devices.values()].reduce((sum, d) => {
    if (d.type === 'isp') return sum
    const entry = deviceCatalog.find(e => e.model === d.model)
    return sum + (entry?.price ?? 0)
  }, 0)

  // Job board: missions that aren't active and aren't completed
  const jobBoardMissions = MISSIONS.filter(m =>
    !completedMissions.some(c => c.id === m.id) && m.id !== activeMissionId
  )

  return (
    <>
      {showModal && (
        <CompletionModal
          mission={activeMission}
          refund={pendingRefund}
          onCollect={() => completeMission(activeMission.id, activeMission.reward)}
        />
      )}
      {blueprintOpen && activeMission && (
        <BlueprintModal mission={activeMission} onClose={() => setBlueprintOpen(false)} />
      )}

      <div style={{
        display: 'flex', flexDirection: 'column', height: '100%',
        background: '#0d0d1a', borderLeft: '1px solid #1a1a3e', overflow: 'auto',
      }}>
        {/* Header */}
        <div style={{ padding: '10px 14px 8px', borderBottom: '1px solid #1a1a3e', flexShrink: 0 }}>
          <div style={{ fontSize: 10, color: '#4a90e2', fontWeight: 700, letterSpacing: 2, marginBottom: 6 }}>
            JOB BOARD
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ fontSize: 10, color: '#555' }}>balance</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: '#50fa7b', fontFamily: 'monospace' }}>
                ${budget.toLocaleString()}
              </div>
            </div>
            {totalEarned > 0 && (
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 10, color: '#555' }}>total earned</div>
                <div style={{ fontSize: 12, color: '#2a6a2a', fontFamily: 'monospace' }}>
                  +${totalEarned.toLocaleString()}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* All missions completed trophy state */}
        {allDone && (
          <div style={{ padding: '20px 14px', textAlign: 'center' }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>🏆</div>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#50fa7b', marginBottom: 4 }}>
              All Jobs Complete!
            </div>
            <div style={{ fontSize: 11, color: '#555' }}>
              You&apos;re a certified Network Engineer.
            </div>
          </div>
        )}

        {/* Active mission task list */}
        {activeMission && (
          <>
            <div style={{ padding: '8px 14px 0' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <span style={{ fontSize: 20 }}>{activeMission.avatar}</span>
                <div>
                  <div style={{ fontSize: 11, color: '#555', marginBottom: 1 }}>ACTIVE JOB</div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#e0e0e0' }}>{activeMission.title}</div>
                </div>
                <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#50fa7b', fontFamily: 'monospace' }}>
                    ${activeMission.reward.toLocaleString()}
                  </div>
                  <Stars n={activeMission.difficulty} />
                </div>
              </div>
              {activeMission.blueprint && (
                <div style={{ marginBottom: 5 }}>
                  <button
                    onClick={() => setBlueprintOpen(true)}
                    style={{
                      fontSize: 9, padding: '3px 9px',
                      background: '#070c1a', border: '1px solid #1a3060',
                      color: '#3a6090', borderRadius: 3, cursor: 'pointer',
                      letterSpacing: 0.5, fontWeight: 700,
                    }}
                    onMouseEnter={e => { e.currentTarget.style.color = '#4a7ab0'; e.currentTarget.style.borderColor = '#2a5298' }}
                    onMouseLeave={e => { e.currentTarget.style.color = '#3a6090'; e.currentTarget.style.borderColor = '#1a3060' }}
                  >
                    ◈ VIEW BLUEPRINT
                  </button>
                </div>
              )}
              <div style={{ marginBottom: 6 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                  <span style={{ fontSize: 9, color: '#555' }}>PROGRESS</span>
                  <span style={{ fontSize: 9, color: allTasksDone ? '#50fa7b' : '#4a90e2' }}>
                    {passed}/{tasks.length} tasks
                  </span>
                </div>
                <div style={{ height: 3, background: '#1a1a2e', borderRadius: 2, overflow: 'hidden' }}>
                  <div style={{
                    height: '100%',
                    width: tasks.length ? `${(passed / tasks.length) * 100}%` : '0%',
                    background: allTasksDone ? '#50fa7b' : '#4a90e2',
                    transition: 'width 0.4s ease',
                  }} />
                </div>
              </div>
            </div>
            {activeMission.layout && <FloorPlanBrief layout={activeMission.layout} />}
            <div style={{ borderTop: '1px solid #1a1a3e' }}>
              {tasks.map((task, i) => {
                const isChecked   = !!checks[task.id]
                const prevChecked = i === 0 || !!checks[tasks[i - 1].id]
                const isActive    = !isChecked && prevChecked
                if (isChecked) return <DoneTask key={task.id} task={task} />
                if (isActive)  return <ActiveTask key={task.id} task={task} difficulty={difficulty} diagLines={diagFacts[task.id] ?? null} />
                return <UpcomingTask key={task.id} task={task} />
              })}
            </div>
          </>
        )}

        {/* Job board: available and locked upcoming missions */}
        {!allDone && jobBoardMissions.length > 0 && (
          <div style={{ borderTop: activeMission ? '1px solid #1a1a3e' : 'none', paddingTop: 4 }}>
            <div style={{ padding: '6px 14px 2px', fontSize: 9, color: '#2a2a50', letterSpacing: 1, fontWeight: 700 }}>
              {activeMission ? 'UPCOMING JOBS' : 'AVAILABLE JOBS'}
            </div>
            {jobBoardMissions.map(m => {
              const prereqDone = m.prerequisite
                ? completedMissions.some(c => c.id === m.prerequisite)
                : true
              return (
                <JobCard
                  key={m.id}
                  mission={m}
                  unlocked={prereqDone && !activeMission}
                  onAccept={() => acceptMission(m.id)}
                />
              )
            })}
          </div>
        )}

        {/* No active mission and nothing in job board yet - welcome hint */}
        {!activeMission && !allDone && jobBoardMissions.length === 0 && (
          <div style={{ padding: '20px 14px', textAlign: 'center', color: '#2a2a50', fontSize: 12 }}>
            All jobs accepted!
          </div>
        )}

        {/* Archive: completed missions (expandable) */}
        {completedMissions.length > 0 && (
          <div style={{ borderTop: '1px solid #1a1a3e', marginTop: 'auto' }}>
            <div style={{ padding: '6px 14px 2px', fontSize: 9, color: '#1a3a1a', letterSpacing: 1, fontWeight: 700 }}>
              COMPLETED JOBS
            </div>
            {completedMissions.map(c => {
              const m = MISSIONS.find(ms => ms.id === c.id)
              return m ? <ArchivedMission key={c.id} mission={{ ...m, reward: c.reward }} /> : null
            })}
          </div>
        )}
      </div>
    </>
  )
}
