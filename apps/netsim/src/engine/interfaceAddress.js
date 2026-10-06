/**
 * The inspector's quick address edit ("click an address, type a new one, Enter") — routed
 * through the CLI engines like every other GUI write, instead of setting fields directly.
 *
 * It used to assign iface.ip / iface.subnet_mask straight onto the device. That skipped every
 * check the CLI makes (overlapping subnets on a router, a duplicate address, a network or
 * broadcast address), left `dhcp_assigned` stale on a leased host, and never touched the
 * default gateway. Now:
 *
 *   hosts (pc / server / phone / laptop) → the same planner as the Configure GUI window
 *                                          (engine/hostConfig.js): ip / dhclient on Linux,
 *                                          netsh / ipconfig on a Windows laptop
 *   routers, firewalls, switch SVIs      → real IOS: interface <name> / ip address … / no ip address
 *   the ISP                              → not editable: it is mission infrastructure
 *
 * Pure JS — no React/DOM imports (engine rule 1).
 */
import { supportsHostGui, planQuickAddress, planClear, applyPlan, prefixToMask } from './hostConfig.js'

const iosSteps = (ifaceName, line) => ['enable', 'configure terminal', `interface ${ifaceName}`, line, 'end']

/**
 * Plan the edit. `ipText` blank means "clear the address". Returns
 * { kind: 'host' | 'ios' | 'none', errors: { ip? }, commands }.
 */
export function planAddressEdit(topology, device, ifaceName, ipText, prefixText) {
  const ip = String(ipText ?? '').trim()

  if (device.type === 'isp') {
    return { kind: 'none', errors: { ip: "The ISP is mission infrastructure — its address can't be edited." }, commands: [] }
  }

  if (supportsHostGui(device)) {
    const commands = ip
      ? null
      : planClear(topology, device, ifaceName)
    if (commands) return { kind: 'host', errors: {}, commands }
    return { kind: 'host', ...planQuickAddress(topology, device, ifaceName, ip, prefixText) }
  }

  // Network devices speak IOS. The engine is the arbiter of what is valid.
  const iface = device.getInterface(ifaceName)
  if (!iface) return { kind: 'ios', errors: {}, commands: [] }
  if (!ip) {
    return { kind: 'ios', errors: {}, commands: iface.ip ? iosSteps(iface.name, 'no ip address') : [] }
  }
  const mask = prefixToMask(prefixText)
  if (!mask) return { kind: 'ios', errors: { ip: 'Prefix length must be a number from 0 to 32.' }, commands: [] }
  if (iface.ip === ip && iface.subnet_mask === mask) return { kind: 'ios', errors: {}, commands: [] }
  return { kind: 'ios', errors: {}, commands: iosSteps(iface.name, `ip address ${ip} ${mask}`) }
}

/**
 * Run a plan through `exec(cmd) → string[]`. Returns { ok, headline, steps } like
 * hostConfig.applyPlan. An IOS edit runs in its own CLI session: whatever mode the device's
 * terminal was sitting in (interface config, DHCP pool, …) is put back afterwards, so the
 * prompt the player sees doesn't change under them.
 */
export function runAddressPlan(exec, device, ifaceName, plan) {
  if (plan.kind === 'host') return applyPlan(exec, device, ifaceName, plan.commands)

  const keep = {
    config_mode: device.config_mode,
    active_interface: device.active_interface,
    active_dhcp_pool: device.active_dhcp_pool,
    active_vlan: device.active_vlan,
  }
  device.config_mode = 'user_exec'
  const steps = []
  try {
    for (const cmd of plan.commands) {
      const output = exec(cmd) ?? []
      const ok = !output.some(l => String(l).startsWith('%'))   // IOS errors start with %
      steps.push({ cmd, output, ok })
      if (!ok) return { ok: false, headline: 'Not applied', steps }
    }
    return { ok: true, headline: 'Applied', steps }
  } finally {
    Object.assign(device, keep)
  }
}
