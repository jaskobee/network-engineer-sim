/**
 * Host network settings — the model behind the "Configure GUI" window for end
 * hosts (pc, server, phone, laptop) and behind the inspector's quick address edit.
 *
 * The GUI never writes device state. It READS an adapter (readAdapter), turns
 * the form into real commands — iproute2 / dhclient on Linux hosts, netsh / ipconfig
 * on a Windows laptop (planApply) — and runs them through the SAME CLI engine the
 * terminal uses (applyPlan → exec). So the GUI can never reach a state the CLI can't,
 * every rejection is the engine's own, and `ip addr` / `ipconfig` always agree with
 * what the window shows. Each OS keeps its own idioms: nothing Linux is ever emitted
 * for a Windows laptop, or the reverse.
 *
 * Why only hosts: routers, switches and firewalls are CLI devices (firewalls also have
 * their own web console); a second configuration surface for their command set would
 * have to be kept in lockstep with `show running-config`.
 *
 * Pure JS — no React/DOM imports (engine rule 1).
 */
import {
  isValidIp, isValidMask, isHostAddress,
  networkAddress, broadcastAddress, maskToPrefixLen, ipToNum,
} from '../models/ipUtils.js'
import { effectiveDnsServers, dnsSource } from '../models/dns.js'

// Device types that get the window. Routers, switches and firewalls are CLI devices.
export const HOST_GUI_TYPES = new Set(['pc', 'server', 'phone', 'laptop'])

export function supportsHostGui(device) {
  return !!device && HOST_GUI_TYPES.has(device.type)
}

// Which shell the machine runs: only a laptop set to Windows is not Linux.
export function osOf(device) {
  return device?.type === 'laptop' && device.os_type === 'windows' ? 'windows' : 'linux'
}

// Ethernet0/1 → eth1 (same mapping the Linux shell prints).
export function linuxName(ifaceName) {
  const m = /Ethernet0\/(\d+)$/i.exec(ifaceName ?? '')
  return m ? `eth${m[1]}` : String(ifaceName ?? '').toLowerCase()
}

// The adapter's name as its own shell prints it: eth1 on Linux, Ethernet1 on Windows.
export function adapterName(device, ifaceName) {
  if (osOf(device) === 'windows') {
    const m = /Ethernet(\d+)\/(\d+)$/i.exec(ifaceName ?? '')
    return m ? `Ethernet${m[2]}` : String(ifaceName ?? '')
  }
  return linuxName(ifaceName)
}

// /24 → 255.255.255.0 (format conversion only — the validity rules live in ipUtils).
export function prefixToMask(prefix) {
  const n = typeof prefix === 'number' ? prefix : parseInt(prefix, 10)
  if (!Number.isInteger(n) || n < 0 || n > 32 || String(prefix).trim() !== String(n)) return null
  const m = n === 0 ? 0 : (0xffffffff << (32 - n)) >>> 0
  return numToIp(m)
}

function numToIp(n) {
  return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff].join('.')
}

function defaultRoute(device) {
  return device.routing_table.find(r => r.network === '0.0.0.0' && r.mask === '0.0.0.0') ?? null
}

function onLink(ip, mask, other) {
  return !!ip && !!mask && isValidIp(other) && networkAddress(other, mask) === networkAddress(ip, mask)
}

// ── Reading ───────────────────────────────────────────────────────────────────

/**
 * The network facts the window teaches next to a valid address/mask pair.
 * /31 (RFC 3021) has two usable addresses and no broadcast; /32 is a single host.
 */
export function subnetFacts(ip, mask) {
  if (!isValidIp(ip) || !isValidMask(mask)) return null
  const prefix = maskToPrefixLen(mask)
  const network = networkAddress(ip, mask)
  const netNum = ipToNum(network)
  const lastNum = (netNum | (~ipToNum(mask) >>> 0)) >>> 0
  const hostBits = 32 - prefix
  if (prefix === 32) return { prefix, hostBits, network, first: ip, last: ip, broadcast: null, hosts: 1 }
  if (prefix === 31) return { prefix, hostBits, network, first: network, last: numToIp(lastNum), broadcast: null, hosts: 2 }
  // 2^hostBits addresses in the subnet, minus the network address and the broadcast address.
  return {
    prefix, hostBits, network,
    first: numToIp(netNum + 1),
    last: numToIp(lastNum - 1),
    broadcast: broadcastAddress(ip, mask),
    hosts: 2 ** hostBits - 2,
  }
}

/**
 * Snapshot of one adapter as the window shows it. `mode` mirrors what the shell
 * itself can tell apart: a DHCP lease ('dhcp'), a manual address ('manual'), or
 * neither ('none').
 */
export function readAdapter(topology, device, ifaceName) {
  const iface = device.getInterface(ifaceName)
  if (!iface) return null
  const ip = iface.ip ?? null
  const mask = iface.subnet_mask ?? null
  const mode = ip ? (iface.dhcp_assigned ? 'dhcp' : 'manual') : 'none'

  // The default route belongs to whichever adapter's subnet contains its next hop —
  // the same rule the kernel uses to pick `dev` for it.
  const route = defaultRoute(device)
  const gateway = route && onLink(ip, mask, route.next_hop) ? route.next_hop : null

  let remote = null
  if (iface.connected_to) {
    const i = iface.connected_to.indexOf(':')
    const remoteDev = topology?.devices?.get(iface.connected_to.slice(0, i))
    remote = { hostname: remoteDev?.hostname ?? iface.connected_to.slice(0, i), port: iface.connected_to.slice(i + 1) }
  }

  return {
    ifaceName: iface.name,
    os: osOf(device),
    label: adapterName(device, iface.name),
    status: iface.status,               // 'up' | 'down' | 'admin_down'
    enabled: iface.status !== 'admin_down',
    remote,
    mode, ip, mask,
    prefix: mask ? maskToPrefixLen(mask) : null,
    gateway,
    // Name servers the host asks, in order, and where they came from ('static' | 'dhcp' | 'none').
    dnsServers: effectiveDnsServers(device),
    dnsMode: dnsSource(device),
    dnsStatic: [...(device.dns_servers ?? [])],
    dnsDhcp: [...(device.dhcp_dns_servers ?? [])],   // what the lease supplies — what "automatic" would use
    facts: subnetFacts(ip, mask),
  }
}

/** Form values for an adapter. The manual fields are empty unless a manual address is set. */
export function formFromAdapter(a) {
  const manual = a.mode === 'manual'
  const staticDns = a.dnsStatic ?? []
  return {
    mode: manual ? 'manual' : 'dhcp',
    ip: manual ? a.ip : '',
    mask: manual ? a.mask : '',
    gateway: manual ? (a.gateway ?? '') : '',
    // DNS is set apart from the address: 'auto' = whatever the DHCP lease supplies (nothing, on a
    // manual address); 'manual' = the preferred / alternate servers typed below.
    dnsMode: staticDns.length ? 'manual' : 'auto',
    dns1: staticDns[0] ?? '',
    dns2: staticDns[1] ?? '',
  }
}

export function sameForm(a, b) {
  const t = v => (v ?? '').trim()
  return a.mode === b.mode && t(a.ip) === t(b.ip) && t(a.mask) === t(b.mask) && t(a.gateway) === t(b.gateway) &&
    (a.dnsMode ?? 'auto') === (b.dnsMode ?? 'auto') && t(a.dns1) === t(b.dns1) && t(a.dns2) === t(b.dns2)
}

// ── Validation ────────────────────────────────────────────────────────────────

/**
 * Field-level problems with a manual form, in the words a learner needs. The
 * engine still has the last word (applyPlan surfaces its message if it refuses).
 * Returns {} when the form is valid.
 */
export function validateManual(topology, device, form, ifaceName) {
  const errors = {}
  const ip = form.ip.trim(), mask = form.mask.trim(), gw = form.gateway.trim()

  if (!ip) errors.ip = 'Enter an IPv4 address, for example 192.168.10.10.'
  else if (!isValidIp(ip)) errors.ip = 'That is not a valid IPv4 address — four numbers from 0 to 255 separated by dots.'

  if (!mask) errors.mask = 'Enter a subnet mask, for example 255.255.255.0.'
  else if (!isValidIp(mask)) errors.mask = 'Enter the mask in dotted form, for example 255.255.255.0.'
  else if (!isValidMask(mask)) errors.mask = 'That is not a valid mask — its 1-bits must be one unbroken run from the left.'

  if (!errors.ip && !errors.mask) {
    if (!isHostAddress(ip, mask)) {
      const net = networkAddress(ip, mask)
      const prefix = maskToPrefixLen(mask)
      errors.ip = ip === net
        ? `${ip} is the network address of ${net}/${prefix}, so it can't be given to a host.`
        : `${ip} is the broadcast address of ${net}/${prefix}, so it can't be given to a host.`
    } else {
      const other = [...topology.devices.values()].find(d => d !== device && d.interfaces.some(i => i.ip === ip))
      if (other) errors.ip = `${ip} is already in use by ${other.hostname}.`
    }
  }

  if (gw) {
    if (!isValidIp(gw)) errors.gateway = 'That is not a valid IPv4 address.'
    else if (!errors.ip && !errors.mask) {
      if (!onLink(ip, mask, gw)) {
        errors.gateway = `The gateway must be on the same subnet as the host (${networkAddress(ip, mask)}/${maskToPrefixLen(mask)}).`
      } else if (gw === ip) {
        errors.gateway = "The gateway can't be the host's own address."
      } else if (!isHostAddress(gw, mask)) {
        errors.gateway = `${gw} is the ${gw === networkAddress(gw, mask) ? 'network' : 'broadcast'} address of this subnet, so it can't be a gateway.`
      } else if (ifaceName && osOf(device) === 'linux') {
        // A NetSim host has ONE default route (real Linux can hold several, by metric).
        // Don't let one adapter silently take over the gateway that another one is using.
        const route = defaultRoute(device)
        const owner = route && route.next_hop !== gw && !onLink(ip, mask, route.next_hop)
          ? device.interfaces.find(i => i.name !== ifaceName && onLink(i.ip, i.subnet_mask, route.next_hop))
          : null
        if (owner) errors.gateway = `${linuxName(owner.name)} already uses ${route.next_hop} as the default gateway. A NetSim host has one default route, so clear that one first.`
      }
    }
  }
  return errors
}

// ── Planning ──────────────────────────────────────────────────────────────────

/**
 * Turn the form into the exact terminal commands that produce it.
 * Returns { errors, commands }. Commands are empty when there is nothing to do
 * (including when errors are present).
 */
export function planApply(topology, device, ifaceName, form) {
  const cur = readAdapter(topology, device, ifaceName)
  if (!cur) return { errors: {}, commands: [] }
  const ip = cur.os === 'windows'
    ? planApplyWindows(topology, device, ifaceName, form, cur)
    : planApplyLinux(topology, device, ifaceName, form, cur)
  // A form without DNS fields (the inspector's quick address edit) leaves DNS alone.
  const dns = form.dnsMode === undefined ? { errors: {}, commands: [] } : planDns(form, cur)
  const errors = { ...ip.errors, ...dns.errors }
  if (Object.keys(errors).length) return { errors, commands: [] }
  return { errors: {}, commands: [...ip.commands, ...dns.commands] }
}

/**
 * Name servers, apart from the address. 'auto' drops what was set by hand so the lease's servers
 * apply again (`resolvectl revert` / `netsh … set dns … dhcp`); 'manual' sets the preferred server
 * and, if given, an alternate — the pair CCNA teaches; Windows takes them as `set dns` (preferred)
 * then `add dns … index=2` (alternate), systemd-resolved as one list.
 */
export function validateDns(form) {
  const errors = {}
  if (form.dnsMode !== 'manual') return errors
  const d1 = (form.dns1 ?? '').trim(), d2 = (form.dns2 ?? '').trim()
  if (!d1 && !d2) errors.dns1 = 'Enter the preferred DNS server, or choose "Obtain DNS server address automatically".'
  else if (!d1) errors.dns1 = 'Enter a preferred DNS server before the alternate one.'
  else if (!isValidIp(d1)) errors.dns1 = 'That is not a valid IPv4 address — four numbers from 0 to 255 separated by dots.'
  if (d2 && !isValidIp(d2)) errors.dns2 = 'That is not a valid IPv4 address — four numbers from 0 to 255 separated by dots.'
  else if (d1 && d2 && d1 === d2) errors.dns2 = 'The alternate server is the same as the preferred one — it would never help.'
  return errors
}

function planDns(form, cur) {
  const errors = validateDns(form)
  if (Object.keys(errors).length) return { errors, commands: [] }
  const windows = cur.os === 'windows'
  const q = `"${cur.label}"`
  if (form.dnsMode !== 'manual') {
    if (!cur.dnsStatic.length) return { errors: {}, commands: [] }
    return { errors: {}, commands: [windows ? `netsh interface ip set dns ${q} dhcp` : `resolvectl revert ${cur.label}`] }
  }
  const servers = [form.dns1.trim(), (form.dns2 ?? '').trim()].filter(Boolean)
  if (servers.join(' ') === cur.dnsStatic.join(' ')) return { errors: {}, commands: [] }
  if (!windows) return { errors: {}, commands: [`resolvectl dns ${cur.label} ${servers.join(' ')}`] }
  return {
    errors: {},
    commands: [
      `netsh interface ip set dns ${q} static ${servers[0]}`,
      ...(servers[1] ? [`netsh interface ip add dns ${q} ${servers[1]} index=2`] : []),
    ],
  }
}

// Windows: `netsh … set address` replaces the whole IPv4 configuration in one command
// (address, gateway, any lease), so there is no ordering to get wrong.
function planApplyWindows(topology, device, ifaceName, form, cur) {
  const q = `"${cur.label}"`
  if (form.mode === 'dhcp') {
    // Already DHCP-enabled with a lease → nothing to do (netsh says so itself).
    return { errors: {}, commands: cur.mode === 'dhcp' ? [] : [`netsh interface ip set address ${q} dhcp`] }
  }
  const errors = validateManual(topology, device, form, ifaceName)
  if (Object.keys(errors).length) return { errors, commands: [] }
  const ip = form.ip.trim(), mask = form.mask.trim(), gw = form.gateway.trim()
  const unchanged = cur.mode === 'manual' && cur.ip === ip && cur.mask === mask && (cur.gateway ?? '') === gw
  if (unchanged) return { errors: {}, commands: [] }
  return { errors: {}, commands: [`netsh interface ip set address ${q} static ${ip} ${mask}${gw ? ` ${gw}` : ''}`] }
}

function planApplyLinux(topology, device, ifaceName, form, cur) {
  const dev = cur.label
  const route = defaultRoute(device)
  // The default route this adapter is currently serving (its gateway is on our subnet).
  const routeOwned = !!route && onLink(cur.ip, cur.mask, route.next_hop)
  const commands = []

  // Command order follows what real Linux needs:
  //  - deleting an interface's last address flushes the routes via it, so a route delete
  //    must come BEFORE `ip addr del` (after it: "RTNETLINK answers: No such process");
  //  - adding a default route while one exists fails ("File exists"), so replacing one is
  //    a `del` then an `add`.
  if (form.mode === 'dhcp') {
    // DHCP only answers over a live link, and the shell keeps no "DHCP mode" to come
    // back to — so switching now would throw the manual address away and then fail.
    if (cur.mode === 'manual' && cur.status !== 'up') {
      return {
        errors: { link: "DHCP can't answer while the adapter has no link, and switching now would discard the manual address. Bring the link up first." },
        commands: [],
      }
    }
    if (cur.mode === 'manual') {
      if (routeOwned) commands.push('ip route del default')
      commands.push(`ip addr del ${cur.ip}/${cur.prefix} dev ${dev}`)
    }
    // Already holding a lease → nothing to do. dhclient stays resident, so a second run
    // is refused by the shell anyway.
    if (cur.mode !== 'dhcp') commands.push(`dhclient ${dev}`)
    return { errors: {}, commands }
  }

  const errors = validateManual(topology, device, form, ifaceName)
  if (Object.keys(errors).length) return { errors, commands: [] }

  const ip = form.ip.trim(), mask = form.mask.trim(), gw = form.gateway.trim()
  const prefix = maskToPrefixLen(mask)
  const addrChanged = cur.mode !== 'manual' || cur.ip !== ip || cur.mask !== mask

  // Is there a default route standing when the gateway step runs?
  let routeLive = !!route && cur.mode !== 'none'
  if (cur.mode === 'dhcp' && route?.dhcp_assigned) routeLive = false        // the release takes it along
  if (cur.mode === 'manual' && addrChanged && routeOwned) routeLive = false // so does deleting the address

  // The kernel only accepts a gateway over an enabled adapter ("Nexthop has invalid
  // gateway" otherwise) — say so up front instead of failing half-way through.
  if (gw && (!routeLive || route.next_hop !== gw) && cur.status === 'admin_down') {
    return {
      errors: { gateway: 'Turn the adapter on first — a gateway route can only be added while the adapter is enabled.' },
      commands: [],
    }
  }

  if (cur.mode === 'dhcp') {
    commands.push(`dhclient -r ${dev}`)             // manual addressing starts by giving the lease back
  } else if (cur.mode === 'manual' && addrChanged) {
    if (routeOwned && !gw) commands.push('ip route del default')   // being cleared: say so, before the address goes
    commands.push(`ip addr del ${cur.ip}/${cur.prefix} dev ${dev}`)
  }
  if (addrChanged) commands.push(`ip addr add ${ip}/${prefix} dev ${dev}`)

  if (gw) {
    if (routeLive && route.next_hop !== gw) { commands.push('ip route del default'); routeLive = false }
    if (!routeLive) commands.push(`ip route add default via ${gw}`)
  } else if (routeLive && onLink(ip, mask, route.next_hop)) {
    commands.push('ip route del default')
  }
  return { errors: {}, commands }
}

/**
 * Give the lease back and ask again. Null unless a lease is held AND the link is up: with
 * no link the request would fail after the release had already thrown the address away.
 * Linux: dhclient -r, dhclient (dhclient stays resident, so the release comes first).
 * Windows: ipconfig /renew keeps the address, as the real one does.
 */
export function planRenew(topology, device, ifaceName) {
  const cur = readAdapter(topology, device, ifaceName)
  if (!cur || cur.mode !== 'dhcp' || cur.status !== 'up') return null
  return cur.os === 'windows'
    ? ['ipconfig /renew']
    : [`dhclient -r ${cur.label}`, `dhclient ${cur.label}`]
}

/** The adapter's on/off switch — `ip link set eth0 up|down` / `netsh interface set interface … admin=…`. */
export function planLink(device, ifaceName, enable) {
  const iface = device.getInterface(ifaceName)
  if (!iface) return []
  if (osOf(device) === 'windows') {
    return [`netsh interface set interface name="${adapterName(device, iface.name)}" admin=${enable ? 'enabled' : 'disabled'}`]
  }
  return [`ip link set ${linuxName(iface.name)} ${enable ? 'up' : 'down'}`]
}

/** Take the adapter's address away entirely (a lease is released, a manual address deleted). */
export function planClear(topology, device, ifaceName) {
  const cur = readAdapter(topology, device, ifaceName)
  if (!cur || cur.mode === 'none') return []
  if (cur.os === 'windows') {
    return cur.mode === 'dhcp' ? ['ipconfig /release'] : [`netsh interface ip delete address "${cur.label}" ${cur.ip}`]
  }
  if (cur.mode === 'dhcp') return [`dhclient -r ${cur.label}`]
  const route = defaultRoute(device)
  const cmds = []
  if (route && onLink(cur.ip, cur.mask, route.next_hop)) cmds.push('ip route del default')   // before the address goes
  cmds.push(`ip addr del ${cur.ip}/${cur.prefix} dev ${cur.label}`)
  return cmds
}

/**
 * The inspector's "click the address, type a new one" edit, as a manual form: only the
 * address and prefix are being changed, so the gateway stays if it is still reachable on
 * the new subnet and goes if it is not (a gateway must be inside the host's own subnet).
 */
export function planQuickAddress(topology, device, ifaceName, ip, prefix) {
  const mask = prefixToMask(prefix)
  if (!mask) return { errors: { ip: 'Prefix length must be a number from 0 to 32.' }, commands: [] }
  const cur = readAdapter(topology, device, ifaceName)
  if (!cur) return { errors: {}, commands: [] }
  const address = String(ip).trim()
  const gateway = cur.gateway && onLink(address, mask, cur.gateway) ? cur.gateway : ''
  return planApply(topology, device, ifaceName, { mode: 'manual', ip: address, mask, gateway })
}

// ── Running ───────────────────────────────────────────────────────────────────

// `ip …` and `netsh … set interface` are silent on success, like the real tools; netsh
// set/delete address answers "Ok."; DHCP requests are judged by the state they leave
// behind rather than by parsing their chatter.
const IS_DHCP_REQUEST = cmd => /^dhclient (?!-r)/.test(cmd) || cmd === 'ipconfig /renew' || /^netsh interface ip set address .* dhcp$/.test(cmd)

function succeeded(device, ifaceName, cmd, output) {
  const iface = device.getInterface(ifaceName)
  if (cmd.startsWith('dhclient -r') || cmd === 'ipconfig /release') return !!iface && !iface.ip
  if (IS_DHCP_REQUEST(cmd)) return !!iface && !!iface.ip && iface.dhcp_assigned === true
  if (cmd.startsWith('netsh interface ip ')) return output.length === 1 && output[0] === 'Ok.'
  return output.length === 0
}

/**
 * Run commands one at a time through `exec(cmd) → string[]` (the CLI engine),
 * stopping at the first that fails. Returns
 * { ok, headline, steps: [{ cmd, output, ok }] } — `headline` is what to call the outcome:
 * "Applied", "Not applied", or "No DHCP lease" when the step that failed was a DHCP request
 * (the setting took; the network just didn't answer).
 */
export function applyPlan(exec, device, ifaceName, commands) {
  const steps = []
  for (const cmd of commands) {
    const output = exec(cmd) ?? []
    const ok = succeeded(device, ifaceName, cmd, output)
    steps.push({ cmd, output, ok })
    if (!ok) return { ok: false, headline: IS_DHCP_REQUEST(cmd) ? 'No DHCP lease' : 'Not applied', steps }
  }
  return { ok: true, headline: 'Applied', steps }
}
