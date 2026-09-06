/**
 * Client registry — persistent client entities for the career/progression layer.
 *
 * Distinct from the 5 legacy missions (missions.js), which use a bare `client` string
 * and no persistent entity at all. Clients here own a topology across multiple
 * missions, can offer a contract, and track satisfaction/reputation over time.
 *
 * CLIENT_TEMPLATES is static data (like deviceCatalog.js) — createClientInstance()
 * produces the mutable per-save record that lives in CareerContext state.
 */

export const CLIENT_TEMPLATES = [
  {
    id: 'client_local_shop',
    companyName: "Sam's Corner Store",
    industry: 'retail',
    avatar: '🏪',
    description: "A friend's small corner shop — the player's very first client.",
    // First mission offered once this client exists. Later missions unlock via
    // each mission's own `followUpMissionIds` as they're completed.
    initialMissionIds: ['mission_local_shop_1'],
  },
]

export function findClientTemplate(templateId) {
  return CLIENT_TEMPLATES.find(c => c.id === templateId) ?? null
}

export function createClientInstance(templateId) {
  const template = findClientTemplate(templateId)
  if (!template) return null
  return {
    id: template.id,
    companyName: template.companyName,
    industry: template.industry,
    avatar: template.avatar,
    reputationRelationship: 0,
    topologyId: template.id,
    currentContractId: null,
    completedMissionIds: [],
    availableFutureMissionIds: [...template.initialMissionIds],
    satisfaction: 100,
    revenueTotal: 0,
    growthStage: 0,
  }
}
