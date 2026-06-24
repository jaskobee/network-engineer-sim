let _idCounter = 0

export function setIdCounter(n) { if (n > _idCounter) _idCounter = n }

// Reconstruct a Device from a save snapshot without calling the constructor
export function deviceFromSave(raw) {
  const d = Object.create(Device.prototype)
  Object.assign(d, {
    id: raw.id,
    type: raw.type,
    model: raw.model,
    hostname: raw.hostname,
    config_mode: raw.config_mode,
    active_interface: raw.active_interface,
    active_dhcp_pool: raw.active_dhcp_pool ?? null,
    interfaces: raw.interfaces.map(i => ({
      helper_addresses: [],
      dhcp_assigned: false,
      ...i,
    })),
    routing_table: (raw.routing_table || []).map(r => ({ ...r })),
    vlan_db: { ...(raw.vlan_db || {}) },
    powered: raw.powered ?? false,
    active_vlan: raw.active_vlan ?? null,
    dns_server: raw.dns_server ?? null,
    dhcp_pools:       raw.type === 'router' ? (raw.dhcp_pools       || []).map(p => ({ ...p })) : undefined,
    dhcp_excluded:    raw.type === 'router' ? (raw.dhcp_excluded    || []).map(e => ({ ...e })) : undefined,
    dhcp_bindings:    raw.type === 'router' ? (raw.dhcp_bindings    || []).map(b => ({ ...b })) : undefined,
    nat_acls:         (raw.type === 'router' || raw.type === 'firewall') ? (raw.nat_acls         || []).map(a => ({ ...a, entries: (a.entries || []).map(e => ({ ...e })) })) : undefined,
    nat_rules:        (raw.type === 'router' || raw.type === 'firewall') ? (raw.nat_rules        || []).map(r => ({ ...r })) : undefined,
    nat_translations: (raw.type === 'router' || raw.type === 'firewall') ? (raw.nat_translations || []).map(t => ({ ...t })) : undefined,
    fw_zones:           raw.type === 'firewall' ? { ...(raw.fw_zones           || {}) } : undefined,
    fw_rules:           raw.type === 'firewall' ? (raw.fw_rules           || []).map(r => ({ ...r })) : undefined,
    fw_sessions:        raw.type === 'firewall' ? (raw.fw_sessions        || []).map(s => ({ ...s })) : undefined,
    fw_security_levels: raw.type === 'firewall' ? { ...(raw.fw_security_levels || {}) } : undefined,
    fw_log:             raw.type === 'firewall' ? (raw.fw_log             || []).map(e => ({ ...e })) : undefined,
  })
  return d
}

export function createInterface(name) {
  return {
    name,
    description: null,       // free-form label set by `description <text>` in IOS
    ip: null,
    subnet_mask: null,
    status: 'admin_down',    // 'up' | 'down' | 'admin_down'
    connected_to: null,      // composite id "devId:ifName" of the remote interface, or null
    vlan: null,
    helper_addresses: [],    // IOS `ip helper-address` list (router interfaces only)
    dhcp_assigned: false,    // true when IP was assigned by DHCP (for release)
    nat_inside: false,       // IOS `ip nat inside`  — traffic entering from this side is translated
    nat_outside: false,      // IOS `ip nat outside` — traffic exits toward the internet here
  }
}

// Expand abbreviated interface names to their canonical Cisco full form.
// Handles subinterface notation: "gi0/0.10" → "GigabitEthernet0/0.10"
// e.g. "gi0/0" -> "GigabitEthernet0/0", "fa0/1" -> "FastEthernet0/1"
export function normalizeIfName(name) {
  if (!name) return name
  const n = name.trim()
  const lower = n.toLowerCase()

  // "vlan 1", "vlan1", "Vlan1" → "Vlan1"
  const vlanMatch = n.match(/^vlan\s*(\d+)$/i)
  if (vlanMatch) return `Vlan${vlanMatch[1]}`

  const prefixMap = [
    { prefixes: ['gigabitethernet', 'gigabit', 'gig', 'gi', 'g'], full: 'GigabitEthernet' },
    { prefixes: ['fastethernet', 'fast', 'fa', 'f'], full: 'FastEthernet' },
    { prefixes: ['ethernet', 'eth', 'et', 'e'], full: 'Ethernet' },
    { prefixes: ['loopback', 'loop', 'lo'], full: 'Loopback' },
  ]

  for (const { prefixes, full } of prefixMap) {
    // Longest match first to avoid 'g' matching before 'gi'
    const sorted = [...prefixes].sort((a, b) => b.length - a.length)
    for (const p of sorted) {
      if (lower.startsWith(p)) {
        const rest = n.slice(p.length)
        // rest must be empty or start with a digit (handles "0/0" and "0/0.10")
        if (rest === '' || /^\d/.test(rest)) {
          return full + rest
        }
      }
    }
  }
  return n
}

// Extract the parent physical interface name from a subinterface name.
// "GigabitEthernet0/0.10" → "GigabitEthernet0/0", "Gi0/0.20" → "GigabitEthernet0/0"
// Returns null if the name is not a subinterface.
export function getParentIfName(name) {
  const norm = normalizeIfName(name)
  if (!norm) return null
  const dot = norm.lastIndexOf('.')
  if (dot === -1) return null
  // Ensure something exists after the dot (subinterface number)
  const sub = norm.slice(dot + 1)
  if (!/^\d+$/.test(sub)) return null
  return norm.slice(0, dot)
}

// Create a subinterface object (router-on-a-stick logical L3 interface).
// Subinterfaces share their parent's physical cable — connected_to is always null.
// Effective status is derived by refreshSubifs(); never set directly.
export function createSubinterface(name, parentName) {
  return {
    name,
    parent: parentName,   // canonical parent interface name
    description: null,    // free-form label set by `description <text>` in IOS
    vlanTag: null,         // set by "encapsulation dot1Q <vlan>" — null until set
    native: false,         // true when "encapsulation dot1Q <vlan> native"
    ip: null,
    subnet_mask: null,
    sub_shutdown: false,   // true when individually shut via "shutdown" in subif config
    status: 'down',        // derived — updated by refreshSubifs()
    connected_to: null,    // always null; physical connectivity via parent
  }
}

// Recompute status for all subinterfaces on a device.
// Call after any change to a physical interface state or encapsulation.
// Rules (invariant 8):
//   - individually shut → 'admin_down'
//   - parent admin_down or parent down → 'down'
//   - no encapsulation (vlanTag null) → 'down'
//   - parent up + encapsulation set + not shut → 'up'
export function refreshSubifs(device) {
  for (const iface of device.interfaces) {
    if (!iface.parent) continue
    if (iface.sub_shutdown) { iface.status = 'admin_down'; continue }
    const parent = device.interfaces.find(i => i.name === iface.parent)
    if (!parent || parent.status !== 'up') { iface.status = 'down'; continue }
    iface.status = iface.vlanTag !== null ? 'up' : 'down'
  }
}

// Factory for the pre-placed ISP/internet device that appears in every mission.
// The device is pre-powered, pre-configured, and cannot be purchased from the shop.
export function createIspDevice() {
  const d = Object.create(Device.prototype)
  Object.assign(d, {
    id: `dev-${++_idCounter}`,
    type: 'isp',
    model: 'ISP-CLOUD',
    hostname: 'isp',
    config_mode: 'user_exec',
    active_interface: null,
    powered: true,
    interfaces: [{
      name: 'WAN0/0',
      ip: '203.0.113.1',
      subnet_mask: '255.255.255.252',
      status: 'up',
      connected_to: null,
      vlan: null,
      helper_addresses: [],
      dhcp_assigned: false,
    }],
    routing_table: [],
    vlan_db: {},
    dns_server: null,
  })
  return d
}

export class Device {
  constructor({ type, model, portCount, portPrefix, portStart = 0 }) {
    this.id = `dev-${++_idCounter}`
    this.type = type
    this.model = model
    this.hostname = model.toLowerCase().replace(/[^a-z0-9-]/g, '-')
    this.config_mode = 'user_exec' // user_exec | priv_exec | global_config | interface_config | dhcp_pool_config
    this.active_interface = null   // name of the interface currently in interface_config mode
    this.active_dhcp_pool = null   // name of pool currently in dhcp_pool_config mode
    this.powered = false           // must be explicitly powered on before use
    this.interfaces = []
    this.routing_table = []  // [{ network, mask, next_hop, dhcp_assigned? }]
    this.vlan_db = {}        // vlan_id -> { name }
    this.dns_server = null   // set by DHCP on PC/server; null when not configured/released

    // DHCP server state — only populated on router devices
    if (type === 'router') {
      this.dhcp_pools      = []   // [{ name, network, mask, default_router, dns_server, lease_days, lease_hours, lease_mins }]
      this.dhcp_excluded   = []   // [{ start, end }]  — excluded IP ranges
      this.dhcp_bindings   = []   // [{ ip, client_id, pool_name, lease_expires }]
      // NAT state — only populated on router devices
      this.nat_acls        = []   // [{ id: number, entries: [{ permit: bool, network, wildcard }] }]
      this.nat_rules       = []   // [{ acl_id: number, outside_interface: string, overload: true }]
      this.nat_translations = []  // [{ inside_local: ip, inside_global: ip }] — populated by checkPing
    }

    // Stateful firewall state — only populated on firewall devices
    if (type === 'firewall') {
      this.fw_zones            = {}  // { ifaceName: zoneName } — 'INSIDE'|'OUTSIDE'|'DMZ'|custom
      this.fw_rules            = []  // ordered: [{ id, action, fromZone, toZone, src, dst, service }]
      this.fw_sessions         = []  // [{ srcIp, dstIp, protocol, port }] — populated by checkPing
      this.fw_security_levels  = {}  // { ifaceName: 0-100 } — informational; not enforced by engine
      this.fw_log              = []  // [{ ts, srcIp, dstIp, protocol, port, fromZone, toZone, verdict, ruleId }]
      // NAT/PAT — ASA 5506-X supports overload exactly like a router; same fields/engine
      this.nat_acls         = []   // [{ id: number, entries: [{ permit, network, wildcard }] }]
      this.nat_rules        = []   // [{ acl_id, outside_interface, overload }]
      this.nat_translations = []   // [{ inside_local, inside_global }] — populated by checkPing
    }

    for (let i = 0; i < portCount; i++) {
      const iface = createInterface(`${portPrefix}${portStart + i}`)
      if (type === 'switch') {
        // Physical switchports: default access VLAN 1, mode access, and start DOWN (no cable).
        // status 'down' means "no cable/carrier" — distinct from 'admin_down' which is set
        // only by an explicit `shutdown` command and is sticky across cable events.
        iface.vlan = 1
        iface.switchport_mode = 'access'
        iface.status = 'down'
      }
      this.interfaces.push(iface)
    }
  }

  getInterface(name) {
    if (!name) return null
    const norm = normalizeIfName(name).toLowerCase()
    return this.interfaces.find(iface => iface.name.toLowerCase() === norm) || null
  }
}
