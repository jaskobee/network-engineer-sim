/**
 * Service ticket templates — small, recurring background maintenance work for
 * an already-contracted client, distinct from a full job-board MissionDefinition:
 * no hardware to buy, reuses the client's *existing* persistent devices, and
 * completes through the same objective DSL (missionEngine.js) missions use.
 *
 * A ticket's `fault` describes a small, legitimate state change GameContext
 * applies to the client's real topology at issuance time (e.g. actually
 * disconnecting a cable via Topology.disconnect(), or clearing an interface's
 * IP fields) — the network is genuinely broken while the ticket is open, the
 * same way a fault-injection mission would be, just smaller in scope. This is
 * NOT the planned Act 2 fault-injection mission series (pre-built broken
 * scaffolds) — just a single, minimal, realistic point fault per ticket.
 */

export const SERVICE_TICKET_TEMPLATES = {
  client_local_shop: [
    {
      id: 'ticket_loose_cable_pc2',
      title: "PC-2's network cable came loose",
      description: 'Sam says the Office PC dropped off the network. Reconnect it to the switch.',
      reward: 60,
      resolution: 'Cable is connected again and service is restored.',
      fault: { type: 'disconnect', role: 'pc2' },
      deviceRoles: {
        switch: { type: 'switch', match: 'first',  label: 'Switch' },
        pc2:    { type: 'pc',     match: 'second', label: 'PC-2 (Office)' },
      },
      objectives: [
        {
          id: 't1',
          label: 'Reconnect PC-2 to the switch',
          hint: 'Right-click the Switch → Connect Cable → click PC-2.',
          condition: { type: 'cabled', roleA: 'switch', roleB: 'pc2' },
        },
      ],
    },
    {
      id: 'ticket_ip_reset_pc3',
      title: 'PC-3 lost its IP address',
      description: 'The Back Room PC somehow lost its network configuration. Reassign it an address in the shop LAN.',
      reward: 60,
      resolution: "PC-3 has its address back and service is restored.",
      fault: { type: 'clearIp', role: 'pc3' },
      deviceRoles: {
        router: { type: 'router', match: 'first', label: 'Router' },
        pc3:    { type: 'pc',     match: 'third', label: 'PC-3 (Back Room)' },
      },
      objectives: [
        {
          id: 't1',
          label: 'Reassign PC-3 an IP in 10.0.10.0/24',
          hint: [
            'On the PC-3 terminal:',
            { role: 'pc3', cmd: 'ip addr add 10.0.10.103/24 dev eth0' },
            { role: 'pc3', cmd: 'ip link set eth0 up' },
          ],
          condition: { type: 'sameSubnet', roleA: 'pc3', roleB: 'router' },
        },
      ],
    },
    {
      id: 'ticket_adapter_off_pc1',
      title: "PC-1's network adapter was switched off",
      description: 'The Register PC cannot reach anything — its network adapter has been disabled. Switch it back on.',
      reward: 60,
      resolution: "PC-1's network adapter is back on and service is restored.",
      fault: { type: 'adminDown', role: 'pc1' },
      deviceRoles: {
        pc1: { type: 'pc', match: 'first', label: 'PC-1 (Register)' },
      },
      objectives: [
        {
          id: 't1',
          label: "Switch PC-1's network adapter back on",
          hint: [
            'On the PC-1 terminal:',
            { role: 'pc1', cmd: 'ip link set eth0 up' },
          ],
          condition: { type: 'interfaceConfigured', role: 'pc1', requires: ['ip', 'notAdminDown'] },
        },
      ],
    },
    {
      id: 'ticket_router_lan_down',
      title: 'The router LAN port was shut down',
      description: "Nobody in the shop can reach the router — its LAN interface has been administratively shut down. Bring it back up.",
      reward: 80,
      resolution: 'The router LAN port is back up and service is restored.',
      fault: { type: 'adminDown', role: 'router', ifaceName: 'GigabitEthernet0/0' },
      deviceRoles: {
        router: { type: 'router', match: 'first', label: 'Router' },
      },
      objectives: [
        {
          id: 't1',
          label: 'Bring the router LAN interface back up',
          hint: [
            'On the Router terminal:',
            'enable', 'configure terminal', 'interface GigabitEthernet0/0', 'no shutdown',
          ],
          condition: { type: 'interfaceConfigured', role: 'router', ifaceName: 'GigabitEthernet0/0', requires: ['ip', 'notAdminDown'] },
        },
      ],
    },
  ],
}

/**
 * A random template for the client — never the same one twice in a row (when there is more than
 * one), so the problems a player sees don't repeat on a loop. `rng` is injectable for tests.
 */
export function pickTicketTemplate(clientId, { lastTemplateId = null, rng = Math.random } = {}) {
  const templates = SERVICE_TICKET_TEMPLATES[clientId]
  if (!templates?.length) return null
  const pool = templates.length > 1 ? templates.filter(t => t.id !== lastTemplateId) : templates
  return pool[Math.floor(rng() * pool.length)]
}

let _ticketIdCounter = 0
export function setTicketIdCounter(n) { if (n > _ticketIdCounter) _ticketIdCounter = n }   // never move backwards

/**
 * Builds a ticket instance from a template. Does NOT apply the fault itself —
 * that requires real topology access CareerContext doesn't have (see
 * GameContext.applyTicketFault, invoked by ContractClockDriver right after a
 * ticket is issued). `slaDurationMs` is passed in rather than imported to keep
 * this module free of any dependency on contractClock's tuning constants.
 */
export function createTicketInstance(clientId, contractId, template, now, slaDurationMs) {
  return {
    id: `ticket-${++_ticketIdCounter}`,
    clientId,
    contractId,
    templateId: template.id,
    title: template.title,
    description: template.description,
    reward: template.reward,
    resolution: template.resolution ?? null,
    fault: template.fault,
    deviceRoles: template.deviceRoles,
    objectives: template.objectives,
    issuedAt: now,
    deadlineAt: now + slaDurationMs,
    pausedMs: 0,
    notifiedStages: [],
    alertsSent: 1,            // the alert raised with the ticket; reminders follow engine/alertSchedule.js
    lastAlertAt: now,
    faultApplied: false,
    status: 'open',
  }
}
