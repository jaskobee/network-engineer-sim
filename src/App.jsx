import { useEffect, useRef, useState } from 'react'
import { DndContext, DragOverlay, PointerSensor, useSensor, useSensors } from '@dnd-kit/core'
import { GameProvider, useGame } from './state/GameContext.jsx'
import { CareerProvider, useCareer } from './state/CareerContext.jsx'
import { useAuth } from './state/AuthContext.jsx'
import LoginPage from './components/LoginPage.jsx'
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
import AdminLaptop from './components/AdminLaptop.jsx'
import ActiveJobPanel from './components/ActiveJobPanel.jsx'
import ContractClockDriver from './components/ContractClockDriver.jsx'

export default function App() {
  const { user } = useAuth()
  if (!user) return <LoginPage />
  return (
    <GameProvider>
      <CareerProvider>
        <AppContent />
      </CareerProvider>
    </GameProvider>
  )
}

// ── Resizable dividers ────────────────────────────────────────────────────────

function VerticalResizeDivider({ onDelta }) {
  const dragRef = useRef(null)
  const cbRef   = useRef(onDelta)
  cbRef.current = onDelta

  function onMouseDown(e) {
    dragRef.current = e.clientY
    function onMove(ev) {
      if (dragRef.current === null) return
      cbRef.current(ev.clientY - dragRef.current)
      dragRef.current = ev.clientY
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
      style={{ height: 5, flexShrink: 0, cursor: 'row-resize', background: '#0d0d1a',
        borderTop: '1px solid #1a1a3e', borderBottom: '1px solid #1a1a3e' }}
      onMouseEnter={e => { e.currentTarget.style.background = '#2a5298' }}
      onMouseLeave={e => { e.currentTarget.style.background = '#0d0d1a' }}
      title="Drag to resize"
    />
  )
}

// ── Left icon rail + slide-in dock (Shop/Inventory) ──────────────────────────
//
// Shop/Inventory don't need to sit on screen the whole time — they're only
// needed while shopping/placing, not while working a mission. An icon rail
// (always present, minimal footprint) triggers a dock that slides in over
// the floorplan and closes again, reclaiming floorplan width by default.

const RAIL_WIDTH = 46
const DOCK_WIDTH = 210
const CAREER_DOCK_WIDTH = 260

function MenuButton({ children, onClick, danger }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'block', width: '100%', textAlign: 'left',
        padding: '6px 8px', fontSize: 11, fontWeight: 700, letterSpacing: 0.3,
        background: 'transparent', color: danger ? '#ff5555' : '#4a90e2',
        border: 'none', borderRadius: 4, cursor: 'pointer',
      }}
      onMouseEnter={e => { e.currentTarget.style.background = danger ? '#2a1010' : '#111122' }}
      onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
    >
      {children}
    </button>
  )
}

function RailButton({ icon, label, active, onClick }) {
  return (
    <button
      onClick={onClick}
      title={label}
      style={{
        width: 34, height: 34, display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 17, background: active ? '#1a2e4a' : 'transparent',
        border: `1px solid ${active ? '#2a5298' : 'transparent'}`,
        borderRadius: 6, cursor: 'pointer', transition: 'all 0.15s',
      }}
      onMouseEnter={e => { if (!active) e.currentTarget.style.background = '#111122' }}
      onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent' }}
    >
      {icon}
    </button>
  )
}

// Shared click-catcher for both docks — spans the whole middle zone between
// the two 46px rails (never the rails themselves, so an icon click always
// reaches its RailButton) and closes *both* docks, not just whichever one's
// catcher happens to be on top, so a background click reliably clears the
// screen even if both were somehow open at once on a narrow viewport.
function DockClickCatcher({ onClose }) {
  return (
    <div onClick={onClose} style={{ position: 'absolute', top: 0, bottom: 0, left: RAIL_WIDTH, right: RAIL_WIDTH, zIndex: 29 }} />
  )
}

function ShopInventoryDock({ openPanel, onClose }) {
  if (!openPanel) return null
  return (
    <div style={{
      position: 'absolute', top: 0, bottom: 0, left: RAIL_WIDTH, width: DOCK_WIDTH, zIndex: 30,
      background: '#0d0d1a', borderRight: '1px solid #1a1a3e',
      display: 'flex', flexDirection: 'column',
      boxShadow: '6px 0 24px rgba(0,0,0,0.5)',
    }}>
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '8px 12px', borderBottom: '1px solid #1a1a3e', flexShrink: 0,
      }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: '#4a90e2', letterSpacing: 1.5 }}>
          {openPanel === 'shop' ? 'SHOP' : 'INVENTORY'}
        </span>
        <button
          onClick={onClose}
          style={{ background: 'none', border: 'none', color: '#555', cursor: 'pointer', fontSize: 14, padding: '0 4px' }}
          onMouseEnter={e => { e.currentTarget.style.color = '#e0e0e0' }}
          onMouseLeave={e => { e.currentTarget.style.color = '#555' }}
        >✕</button>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
        {openPanel === 'shop' ? <Shop /> : <Inventory />}
      </div>
    </div>
  )
}

// ── Right icon rail + slide-in dock (Career) ─────────────────────────────────
//
// Mirrors ShopInventoryDock exactly, anchored to the opposite edge: Company
// Dashboard / Client Networks / Job Board / Completed Jobs don't need to sit
// on screen the whole time either — the active job's own checklist lives in
// the always-visible floating ActiveJobPanel instead, so this dock is purely
// for browsing/managing career state on demand.

function CareerDock({ open, onClose, children }) {
  if (!open) return null
  return (
    <div style={{
      position: 'absolute', top: 0, bottom: 0, right: RAIL_WIDTH, width: CAREER_DOCK_WIDTH, zIndex: 30,
      background: '#0d0d1a', borderLeft: '1px solid #1a1a3e',
      display: 'flex', flexDirection: 'column',
      boxShadow: '-6px 0 24px rgba(0,0,0,0.5)',
    }}>
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '8px 12px', borderBottom: '1px solid #1a1a3e', flexShrink: 0,
      }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: '#4a90e2', letterSpacing: 1.5 }}>CAREER</span>
        <button
          onClick={onClose}
          style={{ background: 'none', border: 'none', color: '#555', cursor: 'pointer', fontSize: 14, padding: '0 4px' }}
          onMouseEnter={e => { e.currentTarget.style.color = '#e0e0e0' }}
          onMouseLeave={e => { e.currentTarget.style.color = '#555' }}
        >✕</button>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
        {children}
      </div>
    </div>
  )
}

// ── Main app  ──────────────────────────────────────────────────────────────────

// ── Collision helpers (device tile: 108×90, 10px gap) ────────────────────────

const DEV_W = 108
const DEV_H = 90
const DEV_GAP = 10

function wouldOverlap(x, y, excludeId, placements) {
  for (const [id, pos] of Object.entries(placements)) {
    if (id === excludeId) continue
    if (Math.abs(x - pos.x) < DEV_W + DEV_GAP && Math.abs(y - pos.y) < DEV_H + DEV_GAP) return true
  }
  return false
}

function findFreePosition(x, y, placements, excludeId) {
  if (!wouldOverlap(x, y, excludeId, placements)) return { x, y }
  const step = DEV_W + DEV_GAP
  for (let ring = 1; ring <= 8; ring++) {
    for (let dx = -ring; dx <= ring; dx++) {
      for (let dy = -ring; dy <= ring; dy++) {
        if (Math.abs(dx) !== ring && Math.abs(dy) !== ring) continue
        // No lower clamp — the floorplan is an unbounded canvas, so a
        // negative world coordinate (reached by panning) is perfectly valid.
        const nx = x + dx * step
        const ny = y + dy * step
        if (!wouldOverlap(nx, ny, excludeId, placements)) return { x: nx, y: ny }
      }
    }
  }
  return { x, y }
}

// ── One-time Admin Laptop intro modal ─────────────────────────────────────────

function LaptopIntroModal({ onClose }) {
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 2100,
      background: 'rgba(0,0,0,0.82)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{
        background: '#080d1c', border: '1px solid #2a5298', borderRadius: 10,
        padding: '28px 30px', maxWidth: 420, width: '90vw',
        boxShadow: '0 8px 60px #00000090',
      }}>
        <div style={{ fontSize: 36, textAlign: 'center', marginBottom: 12 }}>🖥</div>
        <div style={{ fontSize: 15, fontWeight: 700, color: '#c8d4e8', textAlign: 'center', marginBottom: 12 }}>
          You have an Admin Laptop
        </div>
        <p style={{ fontSize: 12, color: '#6a80a0', lineHeight: 1.75, marginBottom: 14 }}>
          The <strong style={{ color: '#4a90e2' }}>Admin Laptop</strong> is a real device on your network.
          It starts uncabled and unpowered — you need to plug it into your router and give it an IP address
          before it can reach anything.
        </p>
        <div style={{
          background: '#060c1a', borderRadius: 6, padding: '12px 14px',
          border: '1px solid #1a2a4a', marginBottom: 16,
        }}>
          <div style={{ fontSize: 9, color: '#3a6090', fontWeight: 700, letterSpacing: 1.5, marginBottom: 10 }}>WHAT IT CAN DO</div>
          {[
            ['💻', 'CLI', 'Real Linux or Windows networking commands — ip addr, ping, netsh, route'],
            ['🐟', 'WireFish', 'Inspect packets flowing through your network'],
            ['🌐', 'Browser', 'Access device web UIs once management is configured'],
          ].map(([icon, name, desc]) => (
            <div key={name} style={{ display: 'flex', gap: 10, marginBottom: 8, alignItems: 'flex-start' }}>
              <span style={{ fontSize: 14, flexShrink: 0, marginTop: 1 }}>{icon}</span>
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#8090b0' }}>{name}</div>
                <div style={{ fontSize: 10, color: '#3a4a6a', lineHeight: 1.5 }}>{desc}</div>
              </div>
            </div>
          ))}
        </div>
        <p style={{ fontSize: 11, color: '#3a4a6a', lineHeight: 1.65, marginBottom: 20 }}>
          Click <strong style={{ color: '#5a90c8' }}>🖥 ADMIN LAPTOP</strong> in the top bar to open it.
          The <strong style={{ color: '#5a90c8' }}>GUIDE</strong> tab walks you through cabling, IP setup, and first steps.
        </p>
        <button
          onClick={onClose}
          style={{
            width: '100%', padding: '10px 0', fontSize: 13, fontWeight: 700,
            background: '#1a3a5c', color: '#4a90e2',
            border: '1px solid #2a5298', borderRadius: 6, cursor: 'pointer', letterSpacing: 0.5,
          }}
          onMouseEnter={e => { e.currentTarget.style.background = '#2a5298'; e.currentTarget.style.color = '#e0e0e0' }}
          onMouseLeave={e => { e.currentTarget.style.background = '#1a3a5c'; e.currentTarget.style.color = '#4a90e2' }}
        >GOT IT — LET&apos;S START</button>
      </div>
    </div>
  )
}

// ── Main app  ──────────────────────────────────────────────────────────────────

function AppContent() {
  const { user, logout } = useAuth()
  const { devices, placements, placeDevice, movePlacedDevice, saveStatus, newGame, exportSave, importSave, difficulty, setDifficulty, mode, setMode, fwConsoleDeviceId, closeFwConsole, adminLaptopOpen, setAdminLaptopOpen, activeMissionId, activeTicket, panOffset } = useGame()
  const { company, createCompany, notifications } = useCareer()
  const unreadNotifications = notifications.filter(n => !n.read).length
  const importInputRef = useRef(null)
  const [activeDragId,     setActiveDragId]     = useState(null)
  const [inspectorHeight,  setInspectorHeight]  = useState(220)
  const [openPanel,        setOpenPanel]        = useState(null) // 'shop' | 'inventory' | null
  const [careerOpen,       setCareerOpen]       = useState(false)
  const [settingsMenuOpen, setSettingsMenuOpen] = useState(false)
  const settingsMenuRef = useRef(null)
  const [showTour,         setShowTour]         = useState(() => !hasSeenTour())
  const [devPanelOpen,     setDevPanelOpen]     = useState(false)
  const [laptopIntroOpen,  setLaptopIntroOpen]  = useState(false)
  const prevMissionIdRef = useRef(null)
  const prevJobActiveRef = useRef(null)

  function closeAllDocks() {
    setOpenPanel(null)
    setCareerOpen(false)
  }

  // Show the Admin Laptop intro once when the player accepts their first ever mission
  useEffect(() => {
    if (activeMissionId && !prevMissionIdRef.current) {
      if (!localStorage.getItem('netsim_laptop_intro_seen')) {
        setLaptopIntroOpen(true)
      }
    }
    prevMissionIdRef.current = activeMissionId
  }, [activeMissionId])

  // Close the Career dock the instant a job is accepted — browsing naturally
  // ends the moment one is picked, mirroring MissionPanel's own jobBoardOpen
  // auto-collapse. The floorplan + floating ActiveJobPanel take over from here.
  useEffect(() => {
    const jobActive = !!(activeMissionId || activeTicket)
    if (jobActive && !prevJobActiveRef.current) setCareerOpen(false)
    prevJobActiveRef.current = jobActive
  }, [activeMissionId, activeTicket])

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

  // Close the ⚙ settings menu on any click outside it
  useEffect(() => {
    if (!settingsMenuOpen) return
    function onMouseDown(e) {
      if (!settingsMenuRef.current?.contains(e.target)) setSettingsMenuOpen(false)
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [settingsMenuOpen])

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }))

  function handleDragStart(event) { setActiveDragId(event.active.id) }

  function handleDragEnd(event) {
    setActiveDragId(null)
    const { active, over, delta } = event
    if (!over) return
    const data = active.data.current
    if (data?.type === 'inventory' && over.id === 'floorplan') {
      const translated = active.rect.current?.translated
      // over.rect is the floorplan viewport's on-screen box (never itself
      // transformed — only its content wrapper pans), so translated-minus-that
      // gives a viewport-relative pixel position; subtracting panOffset
      // converts it into the world coordinate the panned content is actually
      // using. No lower clamp — negative world coordinates are valid once
      // you've panned into that territory.
      const rawX = translated ? Math.round(translated.left - over.rect.left - panOffset.x) : 80
      const rawY = translated ? Math.round(translated.top  - over.rect.top  - panOffset.y) : 80
      const { x, y } = findFreePosition(rawX, rawY, placements, null)
      placeDevice(data.deviceId, x, y)
    } else if (data?.type === 'placed') {
      const cur = placements[data.deviceId]
      if (cur) {
        // delta is a screen-space pointer movement, independent of any pan
        // offset, so it applies to the world coordinate unchanged.
        const nx = Math.round(cur.x + delta.x)
        const ny = Math.round(cur.y + delta.y)
        if (!wouldOverlap(nx, ny, data.deviceId, placements)) {
          movePlacedDevice(data.deviceId, nx, ny)
        }
        // else: no-op — device snaps back to its original position
      }
    }
  }

  const activeDevice  = activeDragId ? devices.find(d => d.id === activeDragId) : null

  return (
    <>
    {showTour && <WelcomeModal onDone={(diff, name, avatar) => { setDifficulty(diff); createCompany(name, avatar); setShowTour(false) }} />}
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div className="app-layout">
        <header className="app-header">
          <span className="app-title">NETSIM</span>
          <span className="app-subtitle">Network Engineer Simulator</span>
          {company && (
            <span
              title="Your company"
              style={{
                marginLeft: 10, fontSize: 11, fontWeight: 700, color: '#8ab4d4',
                display: 'flex', alignItems: 'center', gap: 5,
                borderLeft: '1px solid #1a1a3e', paddingLeft: 10,
              }}
            >
              <span style={{ fontSize: 13 }}>{company.avatar}</span>
              {company.name}
            </span>
          )}
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

          {/* Admin Laptop toggle */}
          <button
            onClick={() => setAdminLaptopOpen(o => !o)}
            title="Admin Laptop — Wireshark + Browser + Inbox"
            style={{
              position: 'relative',
              marginLeft: 16,
              padding: '3px 12px', fontSize: 10, fontWeight: 700, letterSpacing: 0.5,
              background: adminLaptopOpen ? '#1a3a5c' : 'transparent',
              color: adminLaptopOpen ? '#4a90e2' : '#4a5568',
              border: `1px solid ${adminLaptopOpen ? '#2a5298' : '#1a1a3e'}`,
              borderRadius: 3, cursor: 'pointer',
              transition: 'all 0.15s',
            }}
            onMouseEnter={e => { if (!adminLaptopOpen) { e.currentTarget.style.color = '#4a90e2'; e.currentTarget.style.borderColor = '#2a3a5c' } }}
            onMouseLeave={e => { if (!adminLaptopOpen) { e.currentTarget.style.color = '#4a5568'; e.currentTarget.style.borderColor = '#1a1a3e' } }}
          >
            🖥 ADMIN LAPTOP
            {unreadNotifications > 0 && (
              <span style={{
                position: 'absolute', top: -6, right: -6,
                minWidth: 15, height: 15, borderRadius: 8, padding: '0 3px',
                background: '#ff5555', color: '#fff', fontSize: 9, fontWeight: 700,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                border: '1px solid #0a0a0f',
              }}>{unreadNotifications > 9 ? '9+' : unreadNotifications}</span>
            )}
          </button>

          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
            {/* Save indicator */}
            {saveStatus === 'saved' && (
              <span style={{ fontSize: 10, color: '#50fa7b', opacity: 0.8 }}>✓ Saved</span>
            )}
            {saveStatus === 'loaded' && (
              <span style={{ fontSize: 10, color: '#4a90e2', opacity: 0.7 }}>↺ Restored</span>
            )}
            <input
              ref={importInputRef}
              type="file"
              accept=".json"
              style={{ display: 'none' }}
              onChange={e => {
                const file = e.target.files?.[0]
                if (!file) return
                const reader = new FileReader()
                reader.onload = ev => {
                  const result = importSave(ev.target.result)
                  if (!result.ok) alert(`Import failed: ${result.error}`)
                }
                reader.readAsText(file)
                e.target.value = ''
              }}
            />

            {/* Settings menu — Export/Import/Difficulty/New Game are occasional
                setup actions, not moment-to-moment ones, so they're tucked
                behind one button instead of sitting in the header permanently. */}
            <div ref={settingsMenuRef} style={{ position: 'relative' }}>
              <button
                onClick={() => setSettingsMenuOpen(o => !o)}
                title="Settings"
                style={{
                  padding: '3px 9px', fontSize: 13,
                  background: settingsMenuOpen ? '#1a2e4a' : 'transparent',
                  color: settingsMenuOpen ? '#4a90e2' : '#4a5568',
                  border: `1px solid ${settingsMenuOpen ? '#2a5298' : '#1a1a3e'}`,
                  borderRadius: 3, cursor: 'pointer',
                }}
              >⚙</button>
              {settingsMenuOpen && (
                <div style={{
                  position: 'absolute', top: '100%', right: 0, marginTop: 6,
                  background: '#0d0d1a', border: '1px solid #1a1a3e', borderRadius: 6,
                  padding: 8, zIndex: 200, minWidth: 190,
                  boxShadow: '0 10px 30px rgba(0,0,0,0.6)',
                }}>
                  <MenuButton onClick={() => { exportSave(); setSettingsMenuOpen(false) }}>⬇ Export Save</MenuButton>
                  <MenuButton onClick={() => { importInputRef.current?.click(); setSettingsMenuOpen(false) }}>⬆ Import Save</MenuButton>

                  <div style={{ fontSize: 8, color: '#445', letterSpacing: 0.5, margin: '8px 0 4px' }}>DIFFICULTY</div>
                  <select
                    value={difficulty}
                    onChange={e => setDifficulty(e.target.value)}
                    style={{
                      width: '100%', fontSize: 10, fontWeight: 700,
                      background: '#07070d', color: difficulty === 'beginner' ? '#50fa7b' : difficulty === 'advanced' ? '#ffb86c' : '#ff5555',
                      border: '1px solid #1a1a3e', borderRadius: 3, padding: '4px 6px',
                      cursor: 'pointer', letterSpacing: 0.3, marginBottom: 8,
                    }}
                  >
                    <option value="beginner">BEGINNER</option>
                    <option value="advanced">ADVANCED</option>
                    <option value="networkEngineer">NETWORK ENGINEER</option>
                  </select>

                  <div style={{ borderTop: '1px solid #1a1a3e', margin: '4px 0 8px' }} />
                  <MenuButton danger onClick={() => { setSettingsMenuOpen(false); newGame() }}>NEW GAME</MenuButton>
                </div>
              )}
            </div>

            {/* Session info + logout */}
            <span style={{
              fontSize: 9, color: user?.role === 'admin' ? '#ffb86c' : '#4a90e2',
              letterSpacing: 1, borderLeft: '1px solid #1a1a3e', paddingLeft: 8,
            }}>
              {user?.displayName?.toUpperCase()}
            </span>
            <button
              onClick={logout}
              style={{
                padding: '3px 10px', fontSize: 10, fontWeight: 700,
                background: 'transparent', color: '#555',
                border: '1px solid #1a1a3e', borderRadius: 3, cursor: 'pointer', letterSpacing: 0.5,
              }}
              onMouseEnter={e => { e.currentTarget.style.color = '#e0e0e0'; e.currentTarget.style.borderColor = '#333' }}
              onMouseLeave={e => { e.currentTarget.style.color = '#555';    e.currentTarget.style.borderColor = '#1a1a3e' }}
              title="Sign out"
            >
              SIGN OUT
            </button>
          </div>
        </header>

        <div className="app-body">
          {/* Wrapper holding both rails + floorplan together, so the
              Shop/Inventory dock and the Career dock (positioned inside it)
              can each overlay the floorplan from their own edge without
              being clipped by either sidebar's own overflow — structural
              guarantee rather than a hand-computed pixel offset. */}
          <div style={{ position: 'relative', display: 'flex', flex: 1, minWidth: 0 }}>
            {/* Left rail: spawn palette in sandbox (unchanged), icon-only Shop/Inventory triggers in missions */}
            <aside className="sidebar-left" style={{ width: mode === 'sandbox' ? 210 : RAIL_WIDTH }}>
              {mode === 'sandbox' ? (
                <SandboxPalette />
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, paddingTop: 10 }}>
                  <RailButton icon="🛒" label="Shop" active={openPanel === 'shop'}
                    onClick={() => setOpenPanel(p => p === 'shop' ? null : 'shop')} />
                  <RailButton icon="📦" label="Inventory" active={openPanel === 'inventory'}
                    onClick={() => setOpenPanel(p => p === 'inventory' ? null : 'inventory')} />
                </div>
              )}
            </aside>

            {mode === 'missions' && (openPanel || careerOpen) && (
              <DockClickCatcher onClose={closeAllDocks} />
            )}
            {mode === 'missions' && (
              <ShopInventoryDock openPanel={openPanel} onClose={() => setOpenPanel(null)} />
            )}

            <main className="main-area" style={{ flexDirection: 'column' }}>
              {/* Floorplan — fills remaining height */}
              <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                <Floorplan />
              </div>

              {/* Vertical divider between floorplan and inspector */}
              <VerticalResizeDivider onDelta={d => setInspectorHeight(h => Math.max(120, Math.min(560, h - d)))} />

              {/* Device inspector — docked full-width along the bottom */}
              <div style={{
                height: inspectorHeight, flexShrink: 0,
                overflowY: 'auto', overflowX: 'auto',
                borderTop: '1px solid #1a1a3e',
              }}>
                <DeviceInspector />
              </div>
            </main>

            {/* Right rail: Career icon in missions mode, existing Sandbox placeholder unchanged */}
            <aside className="sidebar-right" style={{ width: mode === 'sandbox' ? 260 : RAIL_WIDTH }}>
              {mode === 'missions' ? (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, paddingTop: 10 }}>
                  <RailButton icon="💼" label="Career" active={careerOpen}
                    onClick={() => setCareerOpen(v => !v)} />
                </div>
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

            {mode === 'missions' && (
              <CareerDock open={careerOpen} onClose={() => setCareerOpen(false)}>
                <MissionPanel onNavigateAway={() => setCareerOpen(false)} />
              </CareerDock>
            )}
          </div>
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

    {laptopIntroOpen && (
      <LaptopIntroModal onClose={() => { localStorage.setItem('netsim_laptop_intro_seen', '1'); setLaptopIntroOpen(false) }} />
    )}
    {fwConsoleDeviceId && (
      <FirewallConsole deviceId={fwConsoleDeviceId} onClose={closeFwConsole} />
    )}
    {adminLaptopOpen && (
      <AdminLaptop onClose={() => setAdminLaptopOpen(false)} />
    )}
    <ActiveJobPanel />
    <ContractClockDriver />
    <TerminalPane />
    {import.meta.env.DEV && (
      <DevPanel open={devPanelOpen} onClose={() => setDevPanelOpen(false)} />
    )}
    </>
  )
}
