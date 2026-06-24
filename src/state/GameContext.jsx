import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { Device, createIspDevice, deviceFromSave, setIdCounter } from '../models/Device.js'
import { Topology } from '../models/Topology.js'
import { CLIEngine } from '../models/CLIEngine.js'
import { PCCLIEngine } from '../models/PCCLIEngine.js'
import { serialize, saveToStorage, loadFromStorage, deserialize, deleteSave } from '../utils/saveLoad.js'
import { playPurchase, playMissionComplete, playSave, playCableDisconnect, playCableConnect } from '../utils/sounds.js'
import { deviceCatalog } from '../data/deviceCatalog.js'
import { MISSIONS } from '../data/missions.js'
import { buildMission005Scaffold } from '../data/mission005scaffold.js'

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

  const engineRef   = useRef(null)
  const pcEngineRef = useRef(null)
  if (!engineRef.current)   engineRef.current   = new CLIEngine(topologyRef.current, difficulty)
  if (!pcEngineRef.current) pcEngineRef.current = new PCCLIEngine(topologyRef.current, difficulty)

  // ── Sandbox topology & engines (fully independent of mission state) ────────
  const sbTopoRef    = useRef(null)
  if (!sbTopoRef.current) sbTopoRef.current = new Topology()
  const sbEngineRef   = useRef(null)
  const sbPcEngineRef = useRef(null)
  if (!sbEngineRef.current)   sbEngineRef.current   = new CLIEngine(sbTopoRef.current, difficulty)
  if (!sbPcEngineRef.current) sbPcEngineRef.current = new PCCLIEngine(sbTopoRef.current, difficulty)

  // Counters for auto-naming (R1, R2 …); reset on clearSandbox
  const sbCountersRef = useRef({ router: 0, switch: 0, pc: 0, server: 0, isp: 0 })

  // ── Mission state ──────────────────────────────────────────────────────────
  const [budget,            setBudget]            = useState(boot?.budget            ?? 3000)
  const [inventory,         setInventory]         = useState(boot?.inventory         ?? [])
  const [placements,        setPlacements]        = useState(boot?.placements        ?? {})
  const [completedMissions, setCompletedMissions] = useState(boot?.completedMissions ?? [])
  const [activeMissionId,   setActiveMissionId]   = useState(boot?.activeMissionId   ?? null)

  const [selectedDeviceId,  setSelectedDeviceId]  = useState(null)
  const [tick,              setTick]              = useState(0)
  const [pingAnimations,    setPingAnimations]    = useState([])
  const [terminalSessions,  setTerminalSessions]  = useState([])
  const [activeTerminalId,  setActiveTerminalId]  = useState(null)
  const [terminalFloating,  setTerminalFloating]  = useState(false)
  const [wireMode,          setWireMode]          = useState(null)
  const [saveStatus,        setSaveStatus]        = useState(boot ? 'loaded' : null)

  // ── Sandbox state (parallel to mission; never serialised) ──────────────────
  const [mode,               setMode]               = useState('missions')
  const [sbPlacements,       setSbPlacements]       = useState({})
  const [sbSelectedDeviceId, setSbSelectedDeviceId] = useState(null)
  const [sbTerminalSessions, setSbTerminalSessions] = useState([])
  const [sbActiveTerminalId, setSbActiveTerminalId] = useState(null)
  const [sbPingAnimations,   setSbPingAnimations]   = useState([])
  const [sbWireMode,         setSbWireMode]         = useState(null)
  const [sbTick,             setSbTick]             = useState(0)

  // Firewall console — device-agnostic; works in both missions and sandbox modes
  const [fwConsoleDeviceId,  setFwConsoleDeviceId]  = useState(null)

  // ── Mode-derived helpers ───────────────────────────────────────────────────
  const isSandbox    = mode === 'sandbox'
  const activeTopoRef = isSandbox ? sbTopoRef : topologyRef

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
    sbEngineRef.current.difficulty   = d
    sbPcEngineRef.current.difficulty = d
  }

  // Active device list from whichever topology is current
  const devices = [...activeTopoRef.current.devices.values()]

  function getDevice(id) { return activeTopoRef.current.devices.get(id) || null }

  // ── Auto-save on mission state changes only ────────────────────────────────
  // sbTick is NOT in the dep array, so sandbox activity never triggers a save.
  useEffect(() => {
    if (tick === 0) return
    const data = serialize(
      topologyRef.current, placements, inventory,
      budget, completedMissions, activeMissionId
    )
    saveToStorage(data)
    setSaveStatus('saved')
    playSave()
    const t = setTimeout(() => setSaveStatus(null), 1800)
    return () => clearTimeout(t)
  }, [tick, placements, inventory, budget, completedMissions, activeMissionId])

  // ── Game actions ───────────────────────────────────────────────────────────

  function purchaseDevice(catalogEntry) {
    if (budget < catalogEntry.price) return false
    const device = new Device(catalogEntry)
    // Assign a unique hostname so multiple devices of same type are distinguishable
    const countOfType = [...topologyRef.current.devices.values()]
      .filter(d => d.type === device.type).length
    device.hostname = `${device.type}-${countOfType + 1}`
    topologyRef.current.addDevice(device)
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

  function openTerminal(deviceId) {
    const dev = activeTopoRef.current.devices.get(deviceId)
    if (!dev?.powered) return  // device must be powered on
    const setFn        = isSandbox ? setSbTerminalSessions   : setTerminalSessions
    const setActiveFn  = isSandbox ? setSbActiveTerminalId   : setActiveTerminalId
    const setSelectedFn = isSandbox ? setSbSelectedDeviceId  : setSelectedDeviceId
    setSelectedFn(deviceId)
    setFn(prev => {
      const existing = prev.find(s => s.deviceId === deviceId)
      if (existing) { setActiveFn(existing.id); return prev }
      const id = `term-${deviceId}`
      setActiveFn(id)
      return [...prev, { id, deviceId }]
    })
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

  function acceptMission(missionId) {
    if (activeMissionId) return  // guard: already on a mission (double-click protection)
    // Clear any leftover workspace from the previous mission before starting fresh
    topologyRef.current.clearDevices()
    setPlacements({})
    setInventory([])
    setTerminalSessions([])
    setActiveTerminalId(null)
    setSelectedDeviceId(null)
    setPingAnimations([])
    // Auto-place a pre-configured ISP device in the top-right of the floorplan.
    const isp = createIspDevice()
    topologyRef.current.addDevice(isp)
    let initialPlacements = { [isp.id]: { x: 620, y: 20 } }
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
    setTick(t => t + 1)
  }

  function completeMission(missionId, reward) {
    // Refund the purchase cost of all player-bought devices
    const refund = [...topologyRef.current.devices.values()].reduce((sum, d) => {
      if (d.type === 'isp') return sum
      const entry = deviceCatalog.find(e => e.model === d.model)
      return sum + (entry?.price ?? 0)
    }, 0)
    setCompletedMissions(prev => [...prev, { id: missionId, reward, refund }])
    setBudget(b => b + reward + refund)
    playMissionComplete()

    // Leave topology, placements, and terminal sessions intact so the player can
    // review their config. The workspace is cleared when the next mission starts.
    setInventory([])
    setActiveMissionId(null)
    setPingAnimations([])

    setTick(t => t + 1)
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
    deleteSave()
    window.location.reload()
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
    setSbPlacements({})
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
  }, [isSandbox]) // eslint-disable-line react-hooks/exhaustive-deps

  const value = {
    // Mode
    mode, setMode,

    // Active topology (switches transparently based on mode)
    topology:            activeTopoRef.current,
    devices,
    placements:          isSandbox ? sbPlacements       : placements,
    selectedDeviceId:    isSandbox ? sbSelectedDeviceId : selectedDeviceId,
    setSelectedDeviceId: isSandbox ? setSbSelectedDeviceId : setSelectedDeviceId,
    wireMode:            isSandbox ? sbWireMode         : wireMode,
    setWireMode:         isSandbox ? setSbWireMode      : setWireMode,
    pingAnimations:      isSandbox ? sbPingAnimations   : pingAnimations,
    engine:              isSandbox ? sbEngineRef.current   : engineRef.current,
    pcEngine:            isSandbox ? sbPcEngineRef.current : pcEngineRef.current,
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
    sbConnectInterfaces,

    // Dev actions — safe to expose in all builds; DevPanel gates them behind DEV flag.
    devSetBalance, devUnlockAllMissions, devSetActiveMission, devForceComplete,
    devExportSandbox, devImportSandbox,

    // Mission-specific state + actions (meaningless in sandbox; consumers must guard)
    budget, inventory,
    purchaseDevice, placeDevice,
    completedMissions, completeMission,
    activeMissionId, acceptMission,
    saveStatus, newGame,

    // Firewall console — device-agnostic overlay (missions + sandbox)
    fwConsoleDeviceId,
    openFwConsole:  (id) => setFwConsoleDeviceId(id),
    closeFwConsole: ()   => setFwConsoleDeviceId(null),

    // Shared across modes
    terminalFloating, setTerminalFloating,
    difficulty, setDifficulty,
  }

  return <GameContext.Provider value={value}>{children}</GameContext.Provider>
}

export function useGame() {
  const ctx = useContext(GameContext)
  if (!ctx) throw new Error('useGame must be called inside <GameProvider>')
  return ctx
}
