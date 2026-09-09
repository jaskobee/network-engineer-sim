import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { Device, createIspDevice, createAdminLaptop, deviceFromSave, setIdCounter } from '../models/Device.js'
import { Topology } from '../models/Topology.js'
import { CLIEngine } from '../models/CLIEngine.js'
import { PCCLIEngine } from '../models/PCCLIEngine.js'
import { WindowsCLIEngine } from '../models/WindowsCLIEngine.js'
import { serialize, saveToStorage, loadFromStorage, deserialize, exportToFile } from '../utils/saveLoad.js'
import { playPurchase, playMissionComplete, playSave, playCableDisconnect, playCableConnect } from '../utils/sounds.js'
import { MISSIONS } from '../data/missions.js'
import { buildMission005Scaffold } from '../data/mission005scaffold.js'
import { getMissionMeta, resolveMissionRoles } from '../engine/missionEngine.js'
import { computeRefund } from '../engine/economy.js'
import { markResetting, isResetting } from '../utils/resetGuard.js'

const GameContext = createContext(null)

const DIFFICULTY_KEY = 'netsim_v1_difficulty'

function _loadDifficulty() {
  return localStorage.getItem(DIFFICULTY_KEY) || 'beginner'
}

// Try loading saved state once at module load (not inside component to avoid double-load in StrictMode)
let _bootstrapSave = null
try {
  const raw = loadFromStorage()
  if (raw) _bootstrapSave = deserialize(raw)
} catch { _bootstrapSave = null }

// Auto-naming prefixes for sandbox devices (R1, SW1, PC1, SRV1, ISP1 …)
const SB_PREFIX = { router: 'R', switch: 'SW', pc: 'PC', server: 'SRV', phone: 'PHN', isp: 'ISP' }

export function GameProvider({ children }) {
  const boot = _bootstrapSave

  // ── Mission topology & engines ─────────────────────────────────────────────
  const topologyRef = useRef(null)
  if (!topologyRef.current) topologyRef.current = boot?.topology ?? new Topology()

  const [difficulty, setDifficultyState] = useState(_loadDifficulty)

  const engineRef    = useRef(null)
  const pcEngineRef  = useRef(null)
  const winEngineRef = useRef(null)
  if (!engineRef.current)    engineRef.current    = new CLIEngine(topologyRef.current, difficulty)
  if (!pcEngineRef.current)  pcEngineRef.current  = new PCCLIEngine(topologyRef.current, difficulty)
  if (!winEngineRef.current) winEngineRef.current = new WindowsCLIEngine(topologyRef.current, difficulty)

  // ── Client topologies (persistent, one per client — see career/progression
  // plan). Populated lazily in acceptMission() the first time a client-based
  // mission (one with a MissionDefinition.clientId) is accepted; reused as-is
  // — never cleared — for that client's follow-up missions. `topologyRef`
  // above stays the single always-fresh, disposable topology used by the 5
  // legacy missions (unchanged). Restored from `boot.clientTopologies` (each
  // gets its own fresh engine instances bound to the restored Topology,
  // mirroring acceptMission's first-time bootstrap) so a client's network
  // survives a page reload.
  const clientTopologiesRef = useRef(null)
  if (!clientTopologiesRef.current) {
    const map = new Map()
    for (const [clientId, saved] of (boot?.clientTopologies ?? new Map())) {
      map.set(clientId, {
        topology: saved.topology,
        engine:    new CLIEngine(saved.topology, difficulty),
        pcEngine:  new PCCLIEngine(saved.topology, difficulty),
        winEngine: new WindowsCLIEngine(saved.topology, difficulty),
      })
    }
    clientTopologiesRef.current = map
  }

  // ── Sandbox topology & engines (fully independent of mission state) ────────
  const sbTopoRef    = useRef(null)
  const sbLaptopIdRef = useRef(null)   // stable ref so we can read the sandbox laptop's ID
  if (!sbTopoRef.current) {
    sbTopoRef.current = new Topology()
    // Add the admin laptop immediately so it's present from the first sandbox session.
    const initLaptop = createAdminLaptop()
    sbTopoRef.current.addDevice(initLaptop)
    sbLaptopIdRef.current = initLaptop.id
  }
  const sbEngineRef    = useRef(null)
  const sbPcEngineRef  = useRef(null)
  const sbWinEngineRef = useRef(null)
  if (!sbEngineRef.current)    sbEngineRef.current    = new CLIEngine(sbTopoRef.current, difficulty)
  if (!sbPcEngineRef.current)  sbPcEngineRef.current  = new PCCLIEngine(sbTopoRef.current, difficulty)
  if (!sbWinEngineRef.current) sbWinEngineRef.current = new WindowsCLIEngine(sbTopoRef.current, difficulty)

  // Counters for auto-naming (R1, R2 …); reset on clearSandbox
  const sbCountersRef = useRef({ router: 0, switch: 0, pc: 0, server: 0, isp: 0 })

  // ── Mission state ──────────────────────────────────────────────────────────
  const [budget,            setBudget]            = useState(boot?.budget            ?? 3000)
  const [inventory,         setInventory]         = useState(boot?.inventory         ?? [])
  const [placements,        setPlacements]        = useState(boot?.placements        ?? {})
  const [completedMissions, setCompletedMissions] = useState(boot?.completedMissions ?? [])
  const [activeMissionId,   setActiveMissionId]   = useState(boot?.activeMissionId   ?? null)
  // Which client's persistent topology is on-screen — see the comment above
  // activeClientEntry's definition for why this is separate from
  // activeMissionId. null for legacy missions and whenever no client mission
  // has ever been accepted this session. Restored from `boot` — without this,
  // a page reload would restore the client's topology data into
  // clientTopologiesRef but have no way to know to actually display it.
  const [activeClientId,    setActiveClientId]    = useState(boot?.activeClientId ?? null)
  // A background contract ticket currently being worked (or null). Unlike
  // activeMissionId this holds the whole object, not just an id — tickets are
  // generated at runtime (see data/serviceTickets.js) and have no static
  // registry to re-look them up from. Restored from `boot` the same way
  // activeMissionId/activeClientId are.
  const [activeTicket,      setActiveTicket]      = useState(boot?.activeTicket ?? null)
  // Freeform floorplan tags ("Server01", "Router", …) — purely cosmetic, never
  // gameplay-enforced. Flat map keyed by label id; each carries its own
  // `scope` (the owning clientId, or 'legacy' for the tutorial missions) so
  // only the tags belonging to whichever floorplan is on-screen ever render —
  // see the `labels` entry in the context value below.
  const [labels,            setLabels]            = useState(boot?.labels ?? {})

  // Floorplan camera — pure view state (never persisted, never gameplay
  // data), shared between Floorplan.jsx (renders the pan + drives it via
  // background click-drag) and App.jsx (needs it to convert an
  // inventory-drop's screen position into the correct world coordinate).
  // Same value for every mode/topology — panning is "where you're currently
  // looking," not something that needs its own memory per client.
  const [panOffset,         setPanOffset]         = useState({ x: 0, y: 0 })

  const [selectedDeviceId,  setSelectedDeviceId]  = useState(null)
  const [tick,              setTick]              = useState(0)
  const [pingAnimations,    setPingAnimations]    = useState([])
  const [terminalSessions,  setTerminalSessions]  = useState([])
  const [activeTerminalId,  setActiveTerminalId]  = useState(null)
  // The terminal is always a floating, draggable window (never docked) —
  // this just tracks whether it's currently shown. terminalOrigin is the
  // screen point (from the triggering right-click) the pop-open animation
  // grows from; it's write-only state read by TerminalPane.
  const [terminalWindowOpen, setTerminalWindowOpen] = useState(false)
  const [terminalOrigin,     setTerminalOrigin]      = useState(null)
  const [wireMode,          setWireMode]          = useState(null)
  const [saveStatus,        setSaveStatus]        = useState(boot ? 'loaded' : null)

  // ── Sandbox state (parallel to mission; never serialised) ──────────────────
  const [mode,               setMode]               = useState('missions')
  const [sbPlacements,       setSbPlacements]       = useState(() =>
    sbLaptopIdRef.current ? { [sbLaptopIdRef.current]: { x: 20, y: 360 } } : {}
  )
  const [sbLabels,           setSbLabels]           = useState({})
  const [sbSelectedDeviceId, setSbSelectedDeviceId] = useState(null)
  const [sbTerminalSessions, setSbTerminalSessions] = useState([])
  const [sbActiveTerminalId, setSbActiveTerminalId] = useState(null)
  const [sbPingAnimations,   setSbPingAnimations]   = useState([])
  const [sbWireMode,         setSbWireMode]         = useState(null)
  const [sbTick,             setSbTick]             = useState(0)

  // Firewall console — device-agnostic; works in both missions and sandbox modes
  const [fwConsoleDeviceId,  setFwConsoleDeviceId]  = useState(null)

  // Admin Laptop — always-available management panel (WireFish + Browser)
  const [adminLaptopOpen, setAdminLaptopOpen] = useState(false)

  // Beginner hint command log — tracks every command typed, PER DEVICE
  // (Map<deviceId, Set<command>>). Device-scoped so a command required on
  // several devices (e.g. "ip link set eth0 up" on PC-1, PC-2, PC-3) only
  // ticks off for the device it was actually run on, not for all of them —
  // and so an unrelated device's command (e.g. the router's "no shutdown")
  // can never falsely tick a different device's checklist line.
  const executedCommandsRef = useRef(new Map())
  function logExecutedCommand(deviceId, cmd) {
    if (!cmd?.trim()) return
    let set = executedCommandsRef.current.get(deviceId)
    if (!set) { set = new Set(); executedCommandsRef.current.set(deviceId, set) }
    set.add(cmd.trim())
  }

  // ── Mode-derived helpers ───────────────────────────────────────────────────
  const isSandbox    = mode === 'sandbox'
  // Which client's topology is currently on-screen. NOT derived from
  // activeMissionId: that clears the instant completeMission() runs, but the
  // player should keep seeing the client's site afterward ("your setup stays
  // up — explore it", per the completion modal) until they start a mission
  // for a different client (or a legacy one). So this is tracked as its own
  // sticky state, set in acceptMission(), and only ever changed there.
  const activeClientEntry = (!isSandbox && activeClientId)
    ? (clientTopologiesRef.current.get(activeClientId) ?? null)
    : null
  // `{ current: ... }` for the client case is a fresh plain object each
  // render, not a persistent ref — fine here since nothing ever assigns to
  // activeTopoRef.current (only reads it); the actual persistent state lives
  // in clientTopologiesRef.
  const activeTopoRef = isSandbox
    ? sbTopoRef
    : (activeClientEntry ? { current: activeClientEntry.topology } : topologyRef)

  // Bump the correct tick.  Mission tick → triggers auto-save.  sbTick → no save.
  function refresh() {
    if (isSandbox) setSbTick(t => t + 1)
    else           setTick(t => t + 1)
  }

  function setDifficulty(d) {
    localStorage.setItem(DIFFICULTY_KEY, d)
    setDifficultyState(d)
    engineRef.current.difficulty     = d
    pcEngineRef.current.difficulty   = d
    winEngineRef.current.difficulty  = d
    sbEngineRef.current.difficulty   = d
    sbPcEngineRef.current.difficulty = d
    sbWinEngineRef.current.difficulty = d
    for (const entry of clientTopologiesRef.current.values()) {
      entry.engine.difficulty    = d
      entry.pcEngine.difficulty  = d
      entry.winEngine.difficulty = d
    }
  }

  // Active device list from whichever topology is current
  const devices = [...activeTopoRef.current.devices.values()]

  function getDevice(id) { return activeTopoRef.current.devices.get(id) || null }

  // ── Auto-save on mission state changes only ────────────────────────────────
  // sbTick is NOT in the dep array, so sandbox activity never triggers a save.
  useEffect(() => {
    if (tick === 0 || isResetting()) return
    const data = serialize(
      topologyRef.current, placements, inventory,
      budget, completedMissions, activeMissionId,
      clientTopologiesRef.current, activeClientId, activeTicket, labels
    )
    saveToStorage(data)
    setSaveStatus('saved')
    playSave()
    const t = setTimeout(() => setSaveStatus(null), 1800)
    return () => clearTimeout(t)
  }, [tick, placements, inventory, budget, completedMissions, activeMissionId, activeClientId, activeTicket, labels])

  // ── Game actions ───────────────────────────────────────────────────────────

  function purchaseDevice(catalogEntry) {
    if (budget < catalogEntry.price) return false
    const device = new Device(catalogEntry)
    // Target whichever topology is actually active (the legacy scratch
    // topology, or the current client's persistent one) — NOT always
    // topologyRef directly, or a purchase made during a client mission would
    // silently land in the wrong topology.
    const targetTopo = activeTopoRef.current
    // Assign a unique hostname so multiple devices of same type are distinguishable
    const countOfType = [...targetTopo.devices.values()]
      .filter(d => d.type === device.type).length
    device.hostname = `${device.type}-${countOfType + 1}`
    targetTopo.addDevice(device)
    setInventory(inv => [...inv, device.id])
    setBudget(b => b - catalogEntry.price)
    setTick(t => t + 1)
    playPurchase()
    return true
  }

  function placeDevice(deviceId, x, y) {
    setPlacements(p => ({ ...p, [deviceId]: { x, y } }))
    setInventory(inv => inv.filter(id => id !== deviceId))
  }

  function movePlacedDevice(deviceId, x, y) {
    if (isSandbox) setSbPlacements(p => ({ ...p, [deviceId]: { x, y } }))
    else           setPlacements(p  => ({ ...p, [deviceId]: { x, y } }))
  }

  function removeFromFloorplan(deviceId) {
    if (isSandbox) {
      // Sandbox: fully delete the device (no inventory concept)
      sbTopoRef.current.removeDevice(deviceId)
      setSbPlacements(p => { const n = { ...p }; delete n[deviceId]; return n })
      setSbTerminalSessions(prev => prev.filter(s => s.deviceId !== deviceId))
    } else {
      setPlacements(p => { const n = { ...p }; delete n[deviceId]; return n })
      setInventory(inv => [...inv, deviceId])
    }
  }

  // ── Floorplan tags ──────────────────────────────────────────────────────────
  // Freeform, purely cosmetic text markers the player can drop anywhere on the
  // floorplan to keep a busy topology organized — never read by the engine or
  // any mission check. `scope` ties a missions-mode label to whichever
  // floorplan it was created on (a clientId, or 'legacy' for the tutorial
  // missions) so switching clients doesn't leak another client's tags onto
  // the current view — mirrors how `placements` entries are implicitly
  // scoped by which topology's devices actually reference them.

  function addLabel(x, y, text = 'Label') {
    const id = `label-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
    const scope = isSandbox ? null : (activeClientId ?? 'legacy')
    const label = { id, x, y, text, scope }
    if (isSandbox) setSbLabels(ls => ({ ...ls, [id]: label }))
    else           setLabels(ls => ({ ...ls, [id]: label }))
    return id
  }

  function moveLabel(labelId, x, y) {
    if (isSandbox) setSbLabels(ls => ls[labelId] ? { ...ls, [labelId]: { ...ls[labelId], x, y } } : ls)
    else           setLabels(ls => ls[labelId] ? { ...ls, [labelId]: { ...ls[labelId], x, y } } : ls)
  }

  function updateLabelText(labelId, text) {
    if (isSandbox) setSbLabels(ls => ls[labelId] ? { ...ls, [labelId]: { ...ls[labelId], text } } : ls)
    else           setLabels(ls => ls[labelId] ? { ...ls, [labelId]: { ...ls[labelId], text } } : ls)
  }

  function removeLabel(labelId) {
    if (isSandbox) setSbLabels(ls => { const n = { ...ls }; delete n[labelId]; return n })
    else           setLabels(ls => { const n = { ...ls }; delete n[labelId]; return n })
  }

  function connectInterfaces(ifaceId1, ifaceId2) {
    activeTopoRef.current.connect(ifaceId1, ifaceId2)
    playCableConnect()
    refresh()
  }

  function disconnectInterface(ifaceId) {
    activeTopoRef.current.disconnect(ifaceId)
    playCableDisconnect()
    refresh()
  }

  // origin: optional {x,y} screen point (the right-click that triggered this)
  // — purely cosmetic, read by TerminalPane to grow the window from that spot.
  function openTerminal(deviceId, origin) {
    const dev = activeTopoRef.current.devices.get(deviceId)
    if (!dev?.powered) return  // device must be powered on
    const setFn        = isSandbox ? setSbTerminalSessions   : setTerminalSessions
    const setActiveFn  = isSandbox ? setSbActiveTerminalId   : setActiveTerminalId
    const setSelectedFn = isSandbox ? setSbSelectedDeviceId  : setSelectedDeviceId
    setSelectedFn(deviceId)
    setTerminalOrigin(origin ?? null)
    setTerminalWindowOpen(true)
    setFn(prev => {
      const existing = prev.find(s => s.deviceId === deviceId)
      if (existing) { setActiveFn(existing.id); return prev }
      const id = `term-${deviceId}`
      setActiveFn(id)
      return [...prev, { id, deviceId }]
    })
  }

  // Fully closes the floating terminal window — ends every open session
  // (mission-mode and sandbox alike, since both share the one window) rather
  // than just hiding it, matching what closing a real terminal app does.
  function closeTerminalWindow() {
    setTerminalSessions([])
    setActiveTerminalId(null)
    setSbTerminalSessions([])
    setSbActiveTerminalId(null)
    setTerminalWindowOpen(false)
  }

  function closeTerminal(sessionId) {
    const setFn       = isSandbox ? setSbTerminalSessions : setTerminalSessions
    const curActiveId = isSandbox ? sbActiveTerminalId    : activeTerminalId
    const setActiveFn = isSandbox ? setSbActiveTerminalId : setActiveTerminalId
    setFn(prev => {
      const next = prev.filter(s => s.id !== sessionId)
      if (curActiveId === sessionId) {
        setActiveFn(next.length > 0 ? next[next.length - 1].id : null)
      }
      return next
    })
  }

  // Shared by acceptMission's client branch, acceptTicket, and viewClient —
  // every path that switches which topology is on screen must clear
  // transient UI state scoped to the PREVIOUS one first. terminalSessions in
  // particular is a flat, unscoped array of {id, deviceId} — a stale tab left
  // over from a different client's topology would crash TerminalPane the
  // next time it rendered (getDevice(deviceId) resolves against whichever
  // topology is CURRENTLY active, so an old id simply won't exist there).
  function resetWorkspaceForSwitch() {
    setInventory([])
    setTerminalSessions([])
    setActiveTerminalId(null)
    setSelectedDeviceId(null)
    setPingAnimations([])
    // Recenter the view so whichever topology is about to show up is actually
    // visible — otherwise a pan left over from a previous client/mission
    // could land the new one off-screen with no visual cue why.
    setPanOffset({ x: 0, y: 0 })
  }

  function acceptMission(missionId) {
    // guard: already on a mission, or already working a background contract
    // ticket — only one topology/checklist can ever be on screen at once.
    if (activeMissionId || activeTicket) return
    const { clientId } = getMissionMeta(missionId)

    if (!clientId) {
      // Legacy path (mission_001-005) — completely unchanged behavior: always
      // a fresh, disposable topology, wiped on every accept.
      topologyRef.current.clearDevices()
      setPlacements({})
      resetWorkspaceForSwitch()
      const isp = createIspDevice()
      topologyRef.current.addDevice(isp)
      const laptop = createAdminLaptop()
      topologyRef.current.addDevice(laptop)
      let initialPlacements = { [isp.id]: { x: 620, y: 20 }, [laptop.id]: { x: 20, y: 360 } }
      // Mission 005: pre-build the completed M004 network so the player only adds the firewall.
      if (missionId === 'mission_005') {
        const { placements: scaffoldPlacements } = buildMission005Scaffold(
          topologyRef.current,
          engineRef.current,
          pcEngineRef.current,
        )
        initialPlacements = { ...initialPlacements, ...scaffoldPlacements }
      }
      setPlacements(initialPlacements)
      setActiveMissionId(missionId)
      setActiveClientId(null)
      setTick(t => t + 1)
      return
    }

    // Client-based mission — persistent per-client topology.
    let entry = clientTopologiesRef.current.get(clientId)
    if (!entry) {
      // First mission ever for this client: fresh topology, same ISP/laptop
      // bootstrap as the legacy path, but never cleared on later missions.
      const topo   = new Topology()
      const eng    = new CLIEngine(topo, difficulty)
      const pcEng  = new PCCLIEngine(topo, difficulty)
      const winEng = new WindowsCLIEngine(topo, difficulty)
      entry = { topology: topo, engine: eng, pcEngine: pcEng, winEngine: winEng }
      clientTopologiesRef.current.set(clientId, entry)

      const isp = createIspDevice()
      topo.addDevice(isp)
      const laptop = createAdminLaptop()
      topo.addDevice(laptop)
      // Merge (not replace) — must not wipe another client's or a legacy
      // mission's placement entries, which may still be sitting in this same
      // flat placements object (harmless: only entries whose deviceId exists
      // in the CURRENTLY active topology are ever rendered).
      setPlacements(p => ({ ...p, [isp.id]: { x: 850, y: 70 }, [laptop.id]: { x: 850, y: 300 } }))
    }
    // else: a follow-up mission for a client that already has a topology —
    // reuse it exactly as-is (devices, cabling, configs all still there).
    // Do NOT clear, and do NOT touch placements — its devices' positions are
    // already there from the previous mission.

    resetWorkspaceForSwitch()
    setActiveMissionId(missionId)
    setActiveClientId(clientId)
    setTick(t => t + 1)
  }

  function completeMission(missionId, reward) {
    const { financialModel } = getMissionMeta(missionId)
    // 'keep' (persistent client infrastructure) never refunds — the hardware
    // is still there, still in use by that client. Everything else (including
    // all 5 legacy missions, which have no financialModel at all) refunds,
    // matching the original behavior exactly.
    const refund = financialModel === 'keep' ? 0 : computeRefund(activeTopoRef.current)
    setCompletedMissions(prev => [...prev, { id: missionId, reward, refund, completedAt: Date.now() }])
    setBudget(b => b + reward + refund)
    playMissionComplete()

    // Leave topology, placements, and terminal sessions intact so the player can
    // review their config. The workspace is cleared when the next mission starts.
    setInventory([])
    setActiveMissionId(null)
    setPingAnimations([])

    setTick(t => t + 1)
  }

  // ── Background contract tickets ─────────────────────────────────────────────
  // Mirrors acceptMission's client-reuse branch only — a ticket's client
  // topology already exists by construction (a ticket only ever comes from an
  // established contract), so there's no first-mission bootstrap path here,
  // and no hardware/refund logic since tickets never involve purchases.

  function acceptTicket(ticket) {
    if (activeMissionId || activeTicket) return
    const entry = clientTopologiesRef.current.get(ticket.clientId)
    if (!entry) return  // shouldn't happen — a ticket only exists for an established client

    resetWorkspaceForSwitch()
    setActiveClientId(ticket.clientId)
    setActiveTicket(ticket)
    setTick(t => t + 1)
  }

  /**
   * Switches the floorplan to an already-established client's persistent
   * network WITHOUT accepting any new work — lets the player freely revisit
   * a client to double-check or fix something. Guarded exactly like
   * accepting new work: only when nothing else is currently in flight (the
   * single-viewport invariant every other mode-switch in this file already
   * relies on). Never constructs a topology — only ever switches to a
   * client that already has one from a prior mission/ticket.
   */
  function viewClient(clientId) {
    if (activeMissionId || activeTicket) return
    if (!clientTopologiesRef.current.get(clientId)) return
    resetWorkspaceForSwitch()
    setActiveClientId(clientId)
    setTick(t => t + 1)
  }

  function completeTicket(reward) {
    // No refund logic (tickets never involve purchases), but the reward is
    // real income — same as completeMission's payout.
    setBudget(b => b + (reward ?? 0))
    setActiveTicket(null)
    setInventory([])
    setPingAnimations([])
    setTick(t => t + 1)
  }

  /**
   * Applies a newly-issued ticket's real topology fault — a single, minimal,
   * legitimate mutation (disconnecting a real cable, clearing a real
   * interface's IP fields) via the same Topology/Device APIs the CLI engines
   * themselves use. Not the planned Act 2 fault-injection mission series
   * (pre-built broken scaffolds) — just enough to make a background ticket's
   * network genuinely broken while it's open, the same way any other mission
   * objective is genuinely unmet until solved.
   */
  function applyTicketFault(ticket) {
    const entry = clientTopologiesRef.current.get(ticket.clientId)
    if (!entry || !ticket.fault) return
    const devices = [...entry.topology.devices.values()]
    const roles = resolveMissionRoles(ticket, devices)
    const device = roles[ticket.fault.role]
    if (!device) return

    if (ticket.fault.type === 'disconnect') {
      const iface = device.interfaces.find(i => i.connected_to)
      if (iface) entry.topology.disconnect(`${device.id}:${iface.name}`)
    } else if (ticket.fault.type === 'clearIp') {
      const iface = device.interfaces.find(i => i.ip)
      if (iface) { iface.ip = null; iface.subnet_mask = null }
    }
    refresh()
  }

  function powerAllDevices() {
    const activePlacements = isSandbox ? sbPlacements : placements
    let changed = false
    for (const dev of activeTopoRef.current.devices.values()) {
      if (activePlacements[dev.id] && !dev.powered) {
        dev.powered = true
        changed = true
      }
    }
    if (changed) refresh()
  }

  function newGame() {
    if (!window.confirm('Start a new game? All progress will be lost.')) return
    // markResetting() FIRST: window.location.reload() doesn't stop JS
    // execution immediately, and other autosave effects (CareerContext's)
    // could otherwise flush a pending write in that gap and put a key right
    // back moments after the sweep clears it. Every autosave effect checks
    // isResetting() and skips its write once this is set — see resetGuard.js.
    markResetting()
    // Sweep every netsim_* key (main save, company, difficulty, tour-seen,
    // laptop prefs, career data, …) — not just the main save — so this is a
    // genuine full reset. A per-key list here would inevitably drift out of
    // sync as new settings get added; the prefix sweep can't.
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith('netsim')) localStorage.removeItem(key)
    }
    window.location.reload()
  }

  function exportSave() {
    exportToFile(topologyRef.current, placements, inventory, budget, completedMissions, activeMissionId, clientTopologiesRef.current, activeClientId, activeTicket, labels)
  }

  function importSave(json) {
    try {
      const data = JSON.parse(json)
      if (data?.version !== 2) throw new Error('Unrecognized save format — was this made by a different version?')

      // Rebuild topology in-place so CLIEngine keeps its reference
      topologyRef.current.clearDevices()
      let maxId = 0
      for (const raw of (data.devices || [])) {
        const num = parseInt(raw.id.replace('dev-', ''), 10)
        if (!isNaN(num) && num > maxId) maxId = num
        topologyRef.current.addDevice(deviceFromSave(raw))
      }

      // Rebuild every client topology wholesale (fresh Topology + fresh
      // engines bound to it) — nothing else holds a long-lived reference to
      // a specific client's old Topology object, so a full replace is safe
      // and simpler than trying to patch existing entries in-place.
      const newClientTopologies = new Map()
      for (const [clientId, saved] of Object.entries(data.clientTopologies ?? {})) {
        const topo = new Topology()
        for (const raw of (saved.devices || [])) {
          const num = parseInt(raw.id.replace('dev-', ''), 10)
          if (!isNaN(num) && num > maxId) maxId = num
          topo.addDevice(deviceFromSave(raw))
        }
        newClientTopologies.set(clientId, {
          topology: topo,
          engine:    new CLIEngine(topo, difficulty),
          pcEngine:  new PCCLIEngine(topo, difficulty),
          winEngine: new WindowsCLIEngine(topo, difficulty),
        })
      }
      clientTopologiesRef.current = newClientTopologies
      setIdCounter(maxId)

      // Restore mission state
      setBudget(data.budget ?? 3000)
      setInventory(data.inventory ?? [])
      setPlacements(data.placements ?? {})
      setCompletedMissions(data.completedMissions ?? [])
      setActiveMissionId(data.activeMissionId ?? null)
      setActiveClientId(data.activeClientId ?? null)
      setActiveTicket(data.activeTicket ?? null)
      setLabels(data.labels ?? {})

      // Clear transient UI state
      setTerminalSessions([])
      setActiveTerminalId(null)
      setSelectedDeviceId(null)
      setPingAnimations([])

      // Persist and signal
      saveToStorage(data)
      setSaveStatus('loaded')
      setTick(t => t + 1)
      return { ok: true }
    } catch (e) {
      return { ok: false, error: e.message }
    }
  }

  // Execute a sequence of CLI commands on a device (used by Firewall Web UI).
  // Runs commands through the real engine — never writes directly to device state.
  // Returns the combined output lines from all commands.
  function executeDeviceCommands(deviceId, cmds) {
    const dev = activeTopoRef.current.devices.get(deviceId)
    if (!dev) return ['Error: device not found']
    const isWindowsLaptop = dev.type === 'laptop' && dev.os_type === 'windows'
    const isLinuxHost     = dev.type === 'pc' || dev.type === 'server' || (dev.type === 'laptop' && !isWindowsLaptop)
    const eng = isWindowsLaptop
      ? (isSandbox ? sbWinEngineRef.current : (activeClientEntry ? activeClientEntry.winEngine : winEngineRef.current))
      : isLinuxHost
        ? (isSandbox ? sbPcEngineRef.current : (activeClientEntry ? activeClientEntry.pcEngine : pcEngineRef.current))
        : (isSandbox ? sbEngineRef.current   : (activeClientEntry ? activeClientEntry.engine   : engineRef.current))
    const out = []
    for (const cmd of cmds) {
      const lines = eng.execute(dev, cmd)
      if (lines?.length) out.push(...lines)
    }
    refresh()
    return out
  }

  // ── Sandbox actions ────────────────────────────────────────────────────────

  function addSandboxDevice(catalogEntry) {
    const device = catalogEntry.type === 'isp'
      ? createIspDevice()
      : new Device(catalogEntry)
    const counters = sbCountersRef.current
    const prefix   = SB_PREFIX[catalogEntry.type] || catalogEntry.type.toUpperCase()
    counters[catalogEntry.type] = (counters[catalogEntry.type] || 0) + 1
    device.hostname = `${prefix}${counters[catalogEntry.type]}`
    device.powered  = true  // sandbox devices start powered on
    sbTopoRef.current.addDevice(device)
    setSbPlacements(p => {
      const placedCount = Object.keys(p).length
      const col = placedCount % 5
      const row = Math.floor(placedCount / 5)
      return { ...p, [device.id]: { x: 30 + col * 130, y: 20 + row * 110 } }
    })
    setSbTick(t => t + 1)
  }

  function clearSandbox() {
    sbTopoRef.current.clearDevices()
    // Re-add the admin laptop to sandbox (always present, like in missions)
    const sbLaptop = createAdminLaptop()
    sbTopoRef.current.addDevice(sbLaptop)
    sbLaptopIdRef.current = sbLaptop.id
    setSbPlacements({ [sbLaptop.id]: { x: 20, y: 360 } })
    setSbTerminalSessions([])
    setSbActiveTerminalId(null)
    setSbSelectedDeviceId(null)
    setSbPingAnimations([])
    setSbWireMode(null)
    sbCountersRef.current = { router: 0, switch: 0, pc: 0, server: 0, phone: 0, isp: 0 }
    setSbTick(t => t + 1)
  }

  // ── Sandbox-direct helpers (always operate on sbTopo regardless of active mode) ──
  // Used by devMode presets so they can run in sandbox even when UI shows missions.

  function sbConnectInterfaces(ifaceId1, ifaceId2) {
    sbTopoRef.current.connect(ifaceId1, ifaceId2)
    playCableConnect()
    setSbTick(t => t + 1)
  }

  // ── Dev actions (only meaningful in DEV mode; safe to expose in prod too) ───

  function devSetBalance(n) {
    setBudget(Number(n) || 0)
    setTick(t => t + 1)
  }

  function devUnlockAllMissions() {
    setCompletedMissions(MISSIONS.map(m => ({ id: m.id, reward: 0, refund: 0 })))
  }

  function devSetActiveMission(missionId) {
    topologyRef.current.clearDevices()
    setPlacements({})
    setInventory([])
    setTerminalSessions([])
    setActiveTerminalId(null)
    setSelectedDeviceId(null)
    setPingAnimations([])
    const isp = createIspDevice()
    topologyRef.current.addDevice(isp)
    setPlacements(p => ({ ...p, [isp.id]: { x: 620, y: 20 } }))
    setActiveMissionId(missionId)
    setActiveClientId(null)
    setMode('missions')
    setTick(t => t + 1)
  }

  function devForceComplete() {
    if (!activeMissionId) return
    const mission = MISSIONS.find(m => m.id === activeMissionId)
    if (mission) completeMission(activeMissionId, mission.reward)
  }

  function devExportSandbox() {
    const devices = []
    for (const dev of sbTopoRef.current.devices.values()) {
      devices.push({
        id: dev.id, type: dev.type, model: dev.model, hostname: dev.hostname,
        config_mode: dev.config_mode, active_interface: dev.active_interface,
        active_dhcp_pool: dev.active_dhcp_pool ?? null,
        active_vlan: dev.active_vlan ?? null,
        powered: dev.powered ?? false,
        interfaces: dev.interfaces.map(i => ({ ...i })),
        routing_table: (dev.routing_table || []).map(r => ({ ...r })),
        vlan_db: { ...(dev.vlan_db || {}) },
        dhcp_pools:       dev.dhcp_pools       ? dev.dhcp_pools.map(p => ({ ...p }))    : undefined,
        dhcp_excluded:    dev.dhcp_excluded    ? dev.dhcp_excluded.map(e => ({ ...e })) : undefined,
        dhcp_bindings:    dev.dhcp_bindings    ? dev.dhcp_bindings.map(b => ({ ...b })) : undefined,
        nat_acls:         dev.nat_acls         ? dev.nat_acls.map(a => ({ ...a, entries: a.entries.map(e => ({ ...e })) })) : undefined,
        nat_rules:        dev.nat_rules        ? dev.nat_rules.map(r => ({ ...r }))        : undefined,
        nat_translations: dev.nat_translations ? dev.nat_translations.map(t => ({ ...t })) : undefined,
        fw_zones:           dev.fw_zones           ? { ...dev.fw_zones }                                    : undefined,
        fw_rules:           dev.fw_rules           ? dev.fw_rules.map(r => ({ ...r }))                     : undefined,
        fw_sessions:        dev.fw_sessions        ? dev.fw_sessions.map(s => ({ ...s }))                  : undefined,
        fw_security_levels: dev.fw_security_levels ? { ...dev.fw_security_levels }                         : undefined,
        fw_log:             dev.fw_log             ? dev.fw_log.map(e => ({ ...e }))                       : undefined,
      })
    }
    return JSON.stringify({ version: 'netsim-dev-v1', devices, placements: sbPlacements }, null, 2)
  }

  function devImportSandbox(json) {
    try {
      const data = JSON.parse(json)
      if (data.version !== 'netsim-dev-v1') throw new Error('Unrecognized format version')
      sbTopoRef.current.clearDevices()
      sbCountersRef.current = { router: 0, switch: 0, pc: 0, server: 0, phone: 0, isp: 0 }
      let maxId = 0
      for (const raw of (data.devices || [])) {
        const num = parseInt(raw.id.replace('dev-', ''), 10)
        if (!isNaN(num) && num > maxId) maxId = num
        sbTopoRef.current.addDevice(deviceFromSave(raw))
      }
      setIdCounter(maxId)
      setSbPlacements(data.placements || {})
      setSbTerminalSessions([])
      setSbActiveTerminalId(null)
      setSbSelectedDeviceId(null)
      setSbPingAnimations([])
      setSbWireMode(null)
      setSbTick(t => t + 1)
      return { ok: true }
    } catch (e) {
      return { ok: false, error: e.message }
    }
  }

  // addPingAnimation: compute path from active topology, push into active ping list
  const addPingAnimation = useCallback((srcIp, dstIp, success) => {
    const topo = activeTopoRef.current
    const path = success ? topo.findPath(srcIp, dstIp) : []

    // Fallback: find device IDs by IP for direct src→dst line when path is empty
    let fallbackSrc = null
    let fallbackDst = null
    if (path.length < 2) {
      for (const dev of topo.devices.values()) {
        if (!fallbackSrc && dev.interfaces.some(i => i.ip === srcIp)) fallbackSrc = dev.id
        if (!fallbackDst && dev.interfaces.some(i => i.ip === dstIp)) fallbackDst = dev.id
        if (fallbackSrc && fallbackDst) break
      }
    }

    const pathDevIds = path.length >= 2
      ? path
      : (fallbackSrc && fallbackDst ? [fallbackSrc, fallbackDst] : [])

    const id = performance.now()
    const setPingFn = isSandbox ? setSbPingAnimations : setPingAnimations
    setPingFn(a => [...a, { id, pathDevIds, success }])
    // Forward:  0→1200ms travel + 600ms fade = done at 1800ms
    // Reply:    departs at 1200ms, 1200ms travel + 600ms fade = done at 3000ms
    setTimeout(() => setPingFn(a => a.filter(p => p.id !== id)), 3300)
    // activeClientId must be a dep alongside isSandbox: activeTopoRef now
    // resolves to a per-client topology keyed on activeClientId (sticky across
    // mission completion — see mode-derived helpers above), so that's what
    // actually determines which topology this callback should target.
    // Omitting it would let this callback stay memoized against whichever
    // client's topology was active when it was last recreated.
  }, [isSandbox, activeClientId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Only the tags belonging to whichever floorplan is currently on-screen —
  // sandbox has its own separate, unscoped set; missions mode filters the
  // flat `labels` map down to the active client's (or 'legacy' for the
  // tutorial missions') own scope, mirroring `placements`' implicit scoping.
  const visibleLabels = isSandbox
    ? sbLabels
    : Object.fromEntries(Object.entries(labels).filter(([, l]) => l.scope === (activeClientId ?? 'legacy')))

  const value = {
    // Mode
    mode, setMode,

    // Active topology (switches transparently based on mode)
    topology:            activeTopoRef.current,
    devices,
    placements:          isSandbox ? sbPlacements       : placements,
    panOffset, setPanOffset,
    labels:              visibleLabels,
    addLabel, moveLabel, updateLabelText, removeLabel,
    selectedDeviceId:    isSandbox ? sbSelectedDeviceId : selectedDeviceId,
    setSelectedDeviceId: isSandbox ? setSbSelectedDeviceId : setSelectedDeviceId,
    wireMode:            isSandbox ? sbWireMode         : wireMode,
    setWireMode:         isSandbox ? setSbWireMode      : setWireMode,
    pingAnimations:      isSandbox ? sbPingAnimations   : pingAnimations,
    engine:              isSandbox ? sbEngineRef.current   : (activeClientEntry ? activeClientEntry.engine    : engineRef.current),
    pcEngine:            isSandbox ? sbPcEngineRef.current  : (activeClientEntry ? activeClientEntry.pcEngine  : pcEngineRef.current),
    winEngine:           isSandbox ? sbWinEngineRef.current : (activeClientEntry ? activeClientEntry.winEngine : winEngineRef.current),
    tick:                isSandbox ? sbTick : tick,

    // Terminal sessions — active mode's list drives the tab bar
    terminalSessions:    isSandbox ? sbTerminalSessions : terminalSessions,
    activeTerminalId:    isSandbox ? sbActiveTerminalId : activeTerminalId,
    setActiveTerminalId: isSandbox ? setSbActiveTerminalId : setActiveTerminalId,
    // All sessions (both modes merged) so TerminalPane can keep xterm instances
    // alive across mode switches via display:none, preserving terminal history.
    allTerminalSessions: [...terminalSessions, ...sbTerminalSessions],

    // Mode-aware actions
    getDevice,
    connectInterfaces,
    disconnectInterface,
    openTerminal,
    closeTerminal,
    movePlacedDevice,
    removeFromFloorplan,
    addPingAnimation,
    powerAllDevices,
    refresh,

    // Sandbox-specific actions
    addSandboxDevice,
    clearSandbox,

    // Sandbox-direct handles — always target sandbox regardless of active mode.
    // Used by devMode preset builders so they work even when UI shows missions.
    sbTopology:         sbTopoRef.current,
    sbEngine:           sbEngineRef.current,
    sbPcEngine:         sbPcEngineRef.current,
    sbWinEngine:        sbWinEngineRef.current,
    sbConnectInterfaces,

    // Dev actions — safe to expose in all builds; DevPanel gates them behind DEV flag.
    devSetBalance, devUnlockAllMissions, devSetActiveMission, devForceComplete,
    devExportSandbox, devImportSandbox,

    // Mission-specific state + actions (meaningless in sandbox; consumers must guard)
    budget, inventory,
    purchaseDevice, placeDevice,
    completedMissions, completeMission,
    activeMissionId, acceptMission,
    saveStatus, newGame, exportSave, importSave,

    // Background contract tickets (see data/serviceTickets.js, engine/contractClock.js)
    activeTicket, acceptTicket, completeTicket, applyTicketFault, viewClient,

    // Firewall console — device-agnostic overlay (missions + sandbox)
    fwConsoleDeviceId,
    openFwConsole:  (id) => setFwConsoleDeviceId(id),
    closeFwConsole: ()   => setFwConsoleDeviceId(null),

    // Admin Laptop — always-visible management panel (WireFish + Browser)
    adminLaptopOpen, setAdminLaptopOpen,

    // Active Job Panel — floating task tracker
    // Beginner command log (ref — reads are always current on each tick-driven render)
    executedCommandsRef, logExecutedCommand,
    // Derived: the laptop device in the active topology (null when no mission started yet)
    laptopDevice: devices.find(d => d.type === 'laptop') ?? null,
    setLaptopOsType: (type) => {
      const laptop = [...activeTopoRef.current.devices.values()].find(d => d.type === 'laptop')
      if (laptop) { laptop.os_type = type; refresh() }
    },
    packetCapture: activeTopoRef.current.packetCapture,
    clearPacketCapture: () => { activeTopoRef.current.clearPacketCapture(); refresh() },
    executeDeviceCommands,

    // Shared across modes
    terminalWindowOpen, setTerminalWindowOpen, terminalOrigin, closeTerminalWindow,
    difficulty, setDifficulty,
    activeClientId,
  }

  return <GameContext.Provider value={value}>{children}</GameContext.Provider>
}

export function useGame() {
  const ctx = useContext(GameContext)
  if (!ctx) throw new Error('useGame must be called inside <GameProvider>')
  return ctx
}
