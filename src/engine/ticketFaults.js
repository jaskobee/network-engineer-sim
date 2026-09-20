/**
 * The real state change behind a service ticket — pure, no React. GameContext calls this on the
 * client's persistent topology when a ticket is issued; tests call it on a hand-built one.
 *
 * A fault is genuine misconfigured state made through the same APIs the CLI uses (rules:
 * .claude/rules/missions.md #8) — never a flag the ping logic special-cases.
 *   disconnect — pull the cable from the role's first cabled interface
 *   clearIp    — remove the role's first address (the ticket asks only for re-addressing)
 *   adminDown  — switch an interface off (Topology.setInterfaceAdmin): `ifaceName` if given,
 *                otherwise the first cabled interface. The peer loses carrier, the IP stays.
 */
import { resolveMissionRoles } from './missionEngine.js'

export function applyTicketFault(topology, ticket) {
  if (!ticket?.fault) return false
  const roles = resolveMissionRoles(ticket, [...topology.devices.values()])
  const device = roles[ticket.fault.role]
  if (!device) return false

  if (ticket.fault.type === 'disconnect') {
    const iface = device.interfaces.find(i => i.connected_to)
    if (!iface) return false
    topology.disconnect(`${device.id}:${iface.name}`)
    return true
  }
  if (ticket.fault.type === 'clearIp') {
    const iface = device.interfaces.find(i => i.ip)
    if (!iface) return false
    iface.ip = null
    iface.subnet_mask = null
    iface.dhcp_assigned = false
    return true
  }
  if (ticket.fault.type === 'adminDown') {
    const iface = ticket.fault.ifaceName
      ? device.getInterface(ticket.fault.ifaceName)
      : device.interfaces.find(i => i.connected_to)
    if (!iface) return false
    topology.setInterfaceAdmin(`${device.id}:${iface.name}`, false)
    return true
  }
  return false
}
