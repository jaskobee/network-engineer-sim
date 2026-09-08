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
  ],
}

export function pickTicketTemplate(clientId) {
  const templates = SERVICE_TICKET_TEMPLATES[clientId]
  if (!templates?.length) return null
  return templates[Math.floor(Math.random() * templates.length)]
}

let _ticketIdCounter = 0
export function setTicketIdCounter(n) { _ticketIdCounter = n }

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
    fault: template.fault,
    deviceRoles: template.deviceRoles,
    objectives: template.objectives,
    issuedAt: now,
    deadlineAt: now + slaDurationMs,
    pausedMs: 0,
    notifiedStages: [],
    faultApplied: false,
    status: 'open',
  }
}
