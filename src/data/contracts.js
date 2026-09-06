/**
 * Contract type registry — recurring-revenue offers tied to a client.
 *
 * A contract is distinct from a one-time mission `reward`: it's ongoing income
 * a client agrees to pay after a mission establishes it (mission.contractOutcome).
 */

export const CONTRACT_TYPES = {
  'monthly-support': {
    type: 'monthly-support',
    label: 'Network Support & Maintenance',
    amountPerMonth: 500,
    services: [
      'Network troubleshooting',
      'Basic configuration',
      'Device support',
      'Network maintenance',
    ],
  },
}

let _contractIdCounter = 0
export function setContractIdCounter(n) { _contractIdCounter = n }

/**
 * Creates a contract instance from a contractOutcome descriptor
 * (e.g. mission.contractOutcome = { type: 'monthly-support' }).
 */
export function createContract({ clientId, contractType, startedAtMissionId }) {
  const def = CONTRACT_TYPES[contractType]
  if (!def) return null
  return {
    id: `contract-${++_contractIdCounter}`,
    clientId,
    type: def.type,
    label: def.label,
    amountPerMonth: def.amountPerMonth,
    startedAtMissionId,
    active: true,
  }
}
