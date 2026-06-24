import { useEffect, useRef, useState } from 'react'
import { DndContext, DragOverlay, PointerSensor, useSensor, useSensors } from '@dnd-kit/core'
import { GameProvider, useGame } from './state/GameContext.jsx'
import Floorplan from './components/Floorplan.jsx'
import Inventory from './components/Inventory.jsx'
import Shop from './components/Shop.jsx'
import DeviceInspector from './components/DeviceInspector.jsx'
import TerminalPane from './components/TerminalPane.jsx'
import MissionPanel from './components/MissionPanel.jsx'
import SandboxPalette from './components/SandboxPalette.jsx'
import WelcomeModal, { hasSeenTour } from './components/WelcomeModal.jsx'
import DevPanel from './components/DevPanel.jsx'
import FirewallConsole from './components/FirewallConsole.jsx'

export default function App() {
  return (
    <GameProvider>
      <AppContent />
    </GameProvider>
  )
}

// ── Resizable divider ─────────────────────────────────────────────────────────

function ResizeDivider({ onDelta }) {
  const dragRef   = useRef(null)
  const cbRef     = useRef(onDelta)
  cbRef.current   = onDelta

  function onMouseDown(e) {
    dragRef.current = e.clientX
    function onMove(ev) {
      if (dragRef.current === null) return
      cbRef.current(ev.clientX - dragRef.current)
      dragRef.current = ev.clientX
    }
    function onUp() {
      dragRef.current = null
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    e.preventDefault()
  }

  return (
    <div
      onMouseDown={onMouseDown}
      style={{ width: 5, flexShrink: 0, cursor: 'col-resize', background: '#0d0d1a',
        borderLeft: '1px solid #1a1a3e', borderRight: '1px solid #1a1a3e' }}
      onMouseEnter={e => { e.currentTarget.style.background = '#2a5298' }}
      onMouseLeave={e => { e.currentTarget.style.background = '#0d0d1a' }}
      title="Drag to resize"
    />
  )
}

// ── Sidebar tabs ──────────────────────────────────────────────────────────────

function SidebarTabs({ active, onChange }) {
  const tabs = [
    { id: 'shop',      label: 'SHOP' },
    { id: 'inventory', label: 'INVENTORY' },
  ]
  return (
    <div style={{ display: 'flex', borderBottom: '1px solid #1a1a3e', background: '#07070d', flexShrink: 0 }}>
      {tabs.map(t => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          style={{
            flex: 1, padding: '7px 4px', border: 'none', cursor: 'pointer',
            background: active === t.id ? '#111122' : 'transparent',
            color: active === t.id ? '#4a90e2' : '#444',
            fontSize: 10, fontWeight: 700, letterSpacing: 1,
            borderBottom: active === t.id ? '2px solid #4a90e2' : '2px solid transparent',
          }}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}

// ── Main app ──────────────────────────────────────────────────────────────────

function AppContent() {
  const { devices, placements, placeDevice, movePlacedDevice, terminalFloating, saveStatus, newGame, difficulty, setDifficulty, mode, setMode, terminalSessions, fwConsoleDeviceId, closeFwConsole } = useGame()
  const [activeDragId,    setActiveDragId]    = useState(null)
  const [inspectorWidth,  setInspectorWidth]  = useState(260)
  const [leftTab,         setLeftTab]         = useState('shop')
  const [showTour,        setShowTour]        = useState(() => !hasSeenTour())
  const [devPanelOpen,    setDevPanelOpen]    = useState(false)

  // Ctrl+Shift+D toggles dev panel (only active in DEV builds)
  useEffect(() => {
    if (!import.meta.env.DEV) return
    function onKey(e) {
      if (e.ctrlKey && e.shiftKey && e.key === 'D') {
        e.preventDefault()
        setDevPanelOpen(o => !o)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  // When the first terminal opens, widen the inspector enough to show full interface names
  const prevSessionCountRef = useRef(0)
  useEffect(() => {
    if (prevSessionCountRef.current === 0 && terminalSessions.length > 0) {
      setInspectorWidth(w => Math.max(w, 460))
    }
    prevSessionCountRef.current = terminalSessions.length
  }, [terminalSessions.length])

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }))

  function handleDragStart(event) { setActiveDragId(event.active.id) }

  function handleDragEnd(event) {
    setActiveDragId(null)
    const { active, over, delta } = event
    if (!over) return
    const data = active.data.current
    if (data?.type === 'inventory' && over.id === 'floorplan') {
      const translated = active.rect.current?.translated
      const x = translated ? Math.max(10, Math.round(translated.left - over.rect.left)) : 80
      const y = translated ? Math.max(10, Math.round(translated.top  - over.rect.top))  : 80
      placeDevice(data.deviceId, x, y)
    } else if (data?.type === 'placed') {
      const cur = placements[data.deviceId]
      if (cur) movePlacedDevice(data.deviceId, Math.max(0, Math.round(cur.x + delta.x)), Math.max(0, Math.round(cur.y + delta.y)))
    }
  }

  const activeDevice  = activeDragId ? devices.find(d => d.id === activeDragId) : null
  const noSessions    = terminalSessions.length === 0 && !terminalFloating

  return (
    <>
    {showTour && <WelcomeModal onDone={(diff) => { setDifficulty(diff); setShowTour(false) }} />}
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div className="app-layout">
        <header className="app-header">
          <span className="app-title">NETSIM</span>
          <span className="app-subtitle">Network Engineer Simulator</span>
          {/* Mode toggle */}
          <div style={{ marginLeft: 16, display: 'flex', borderRadius: 4, overflow: 'hidden', border: '1px solid #1a1a3e' }}>
            {(['missions', 'sandbox']).map(m => (
              <button
                key={m}
                onClick={() => setMode(m)}
                style={{
                  padding: '3px 12px', fontSize: 10, fontWeight: 700, letterSpacing: 0.5,
                  border: 'none', cursor: 'pointer',
                  background: mode === m ? '#2a5298' : 'transparent',
                  color: mode === m ? '#e0e0e0' : '#444',
                  transition: 'background 0.15s, color 0.15s',
                }}
              >
                {m === 'missions' ? 'MISSIONS' : 'SANDBOX'}
              </button>
            ))}
          </div>

          {/* DEV MODE — only in dev builds */}
          {import.meta.env.DEV && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 8 }}>
              <button
                onClick={() => setDevPanelOpen(o => !o)}
                title="Toggle Dev Panel (Ctrl+Shift+D)"
                style={{
                  padding: '3px 10px', fontSize: 10, fontWeight: 700, letterSpacing: 0.5,
                  background: devPanelOpen ? '#ff5555' : '#ff555522',
                  color: devPanelOpen ? '#fff' : '#ff5555',
                  border: '1px solid #ff555566', borderRadius: 3, cursor: 'pointer',
                }}
              >DEV</button>
              {devPanelOpen && (
                <span className="dev-mode-banner">⚠ DEV MODE</span>
              )}
            </div>
          )}

          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
            {/* Save indicator */}
            {saveStatus === 'saved' && (
              <span style={{ fontSize: 10, color: '#50fa7b', opacity: 0.8 }}>✓ Saved</span>
            )}
            {saveStatus === 'loaded' && (
              <span style={{ fontSize: 10, color: '#4a90e2', opacity: 0.7 }}>↺ Restored</span>
            )}
            {/* Difficulty selector */}
            <select
              value={difficulty}
              onChange={e => setDifficulty(e.target.value)}
              style={{
                fontSize: 10, fontWeight: 700,
                background: '#0d0d1a', color: difficulty === 'beginner' ? '#50fa7b' : difficulty === 'advanced' ? '#ffb86c' : '#ff5555',
                border: '1px solid #1a1a3e', borderRadius: 3, padding: '3px 6px',
                cursor: 'pointer', letterSpacing: 0.3,
              }}
            >
              <option value="beginner">BEGINNER</option>
              <option value="advanced">ADVANCED</option>
              <option value="networkEngineer">NETWORK ENGINEER</option>
            </select>
            <button
              onClick={newGame}
              style={{
                padding: '3px 10px', fontSize: 10, fontWeight: 700,
                background: 'transparent', color: '#ff5555',
                border: '1px solid #3a1010', borderRadius: 3, cursor: 'pointer', letterSpacing: 0.5,
              }}
              onMouseEnter={e => { e.currentTarget.style.background = '#2a1010' }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
            >
              NEW GAME
            </button>
          </div>
        </header>

        <div className="app-body">
          {/* Left sidebar: spawn palette in sandbox, tabbed shop+inventory in missions */}
          <aside className="sidebar-left">
            {mode === 'sandbox' ? (
              <SandboxPalette />
            ) : (
              <>
                <SidebarTabs active={leftTab} onChange={setLeftTab} />
                <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
                  {leftTab === 'shop'      ? <Shop />      : null}
                  {leftTab === 'inventory' ? <Inventory /> : null}
                </div>
              </>
            )}
          </aside>

          <main className="main-area">
            <Floorplan />
            <div className="bottom-panels">
              <div style={{
                width: (terminalFloating || noSessions) ? '100%' : inspectorWidth,
                flexShrink: 0, overflowY: 'auto', overflowX: 'auto',
                borderRight: (terminalFloating || noSessions) ? 'none' : '1px solid #1a1a3e',
              }}>
                <DeviceInspector />
              </div>
              {!terminalFloating && !noSessions && (
                <ResizeDivider onDelta={d => setInspectorWidth(w => Math.max(160, Math.min(520, w + d)))} />
              )}
              <div style={noSessions
                ? { flex: '0 0 0px', overflow: 'hidden', minWidth: 0 }
                : { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }
              }>
                <TerminalPane />
              </div>
            </div>
          </main>

          <aside className="sidebar-right">
            {mode === 'missions' ? (
              <MissionPanel />
            ) : (
              <div style={{ padding: '16px 12px', textAlign: 'center' }}>
                <div style={{ fontSize: 32, marginBottom: 10, opacity: 0.25 }}>🧪</div>
                <div style={{ fontSize: 10, fontWeight: 700, color: '#333360', letterSpacing: 1, marginBottom: 8 }}>
                  SANDBOX MODE
                </div>
                <div style={{ fontSize: 10, color: '#252545', lineHeight: 1.7 }}>
                  Build any topology.<br/>
                  No missions · No budget.<br/>
                  Full CLI accuracy enforced.
                </div>
              </div>
            )}
          </aside>
        </div>
      </div>

      <DragOverlay>
        {activeDevice ? (
          <div style={{
            padding: '5px 12px', background: '#12254a', border: '2px solid #4a90e2',
            borderRadius: 6, color: '#e0e0e0', fontSize: 12, fontFamily: 'monospace',
            opacity: 0.9, boxShadow: '0 4px 16px rgba(0,0,0,0.6)', whiteSpace: 'nowrap',
          }}>
            {activeDevice.hostname}
            <span style={{ color: '#555', marginLeft: 6 }}>({activeDevice.type})</span>
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>

    {fwConsoleDeviceId && (
      <FirewallConsole deviceId={fwConsoleDeviceId} onClose={closeFwConsole} />
    )}
    {import.meta.env.DEV && (
      <DevPanel open={devPanelOpen} onClose={() => setDevPanelOpen(false)} />
    )}
    </>
  )
}
