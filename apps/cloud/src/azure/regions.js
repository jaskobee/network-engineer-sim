/**
 * The regions Cloud Engineer offers (docs/cloud/PHASE_1A_CLOUD_SECTION.md §6, decision 2).
 * Real Azure region names; a deliberately short list. Availability zones and per-region
 * service availability (e.g. which regions support ZRS/GZRS, AZURE_ACCURACY.md M1 note)
 * are not modelled in Phase 1a — every listed region is treated as offering everything.
 */
export const REGIONS = Object.freeze([
  Object.freeze({ name: 'westeurope',    displayName: 'West Europe' }),
  Object.freeze({ name: 'northeurope',   displayName: 'North Europe' }),
  Object.freeze({ name: 'swedencentral', displayName: 'Sweden Central' }),
  Object.freeze({ name: 'eastus',        displayName: 'East US' }),
  Object.freeze({ name: 'westus2',       displayName: 'West US 2' }),
])

export function isRegion(name) {
  return REGIONS.some(r => r.name === name)
}

export function regionDisplayName(name) {
  return REGIONS.find(r => r.name === name)?.displayName ?? name
}
