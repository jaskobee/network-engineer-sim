/**
 * Cloud resource model (roadmap Phase 1a) — plain, serialisable state.
 *
 * Azure is desired-state, so the cloud side is a declarative object rather than the
 * on-prem engine's mutable Device graph:
 *
 *   {
 *     tenantId,
 *     managementGroups: { [id]: { id, displayName, parentId } },   // root: id === tenantId, parentId null
 *     subscriptions:    { [subscriptionId]: { id, displayName, parentId } },
 *     resourceGroups:   { [rgId]: { id, name, subscriptionId, location, tags } },
 *     resources:        { [resourceId]: { id, type, name, subscriptionId, resourceGroup, location, tags, properties } },
 *   }
 *
 * Keys are ARM-style IDs (AZURE_ACCURACY O2), so a resource's ID changes when it moves
 * (J9) exactly as in Azure. State changes only through operations.js.
 */

export const TYPES = Object.freeze({
  VIRTUAL_NETWORK: 'Microsoft.Network/virtualNetworks',
  NETWORK_SECURITY_GROUP: 'Microsoft.Network/networkSecurityGroups',
  PUBLIC_IP: 'Microsoft.Network/publicIPAddresses',
  NETWORK_INTERFACE: 'Microsoft.Network/networkInterfaces',
  VIRTUAL_MACHINE: 'Microsoft.Compute/virtualMachines',
  DISK: 'Microsoft.Compute/disks',
  STORAGE_ACCOUNT: 'Microsoft.Storage/storageAccounts',
})

// I1: the root management group's default display name.
export const ROOT_DISPLAY_NAME = 'Tenant root group'

export const managementGroupScope = id => `/providers/Microsoft.Management/managementGroups/${id}`
export const subscriptionScope = subscriptionId => `/subscriptions/${subscriptionId}`
export const resourceGroupId = (subscriptionId, name) => `/subscriptions/${subscriptionId}/resourceGroups/${name}`
export const resourceId = (subscriptionId, resourceGroup, type, name) =>
  `${resourceGroupId(subscriptionId, resourceGroup)}/providers/${type}/${name}`
export const subnetId = (vnetId, name) => `${vnetId}/subnets/${name}`

export function newGuid() {
  return globalThis.crypto.randomUUID()
}

/** A fresh tenant: just the root management group (I1). */
export function createCloudState({ tenantId = newGuid() } = {}) {
  return {
    tenantId,
    managementGroups: { [tenantId]: { id: tenantId, displayName: ROOT_DISPLAY_NAME, parentId: null } },
    subscriptions: {},
    resourceGroups: {},
    resources: {},
  }
}

/**
 * C2: the default rules Azure creates in every NSG. Names copied exactly as the NSG
 * overview page prints them — including Microsoft's inconsistent capitalisation
 * (DenyAllInbound vs DenyAllOutBound). Re-check against `az network nsg rule list
 * --include-default` before showing them as CLI output (AZURE_ACCURACY C2 note).
 */
export const DEFAULT_SECURITY_RULES = Object.freeze([
  { name: 'AllowVNetInBound',              priority: 65000, direction: 'Inbound',  access: 'Allow', protocol: 'Any', source: 'VirtualNetwork',    sourcePorts: '0-65535', destination: 'VirtualNetwork', destinationPorts: '0-65535' },
  { name: 'AllowAzureLoadBalancerInBound', priority: 65001, direction: 'Inbound',  access: 'Allow', protocol: 'Any', source: 'AzureLoadBalancer', sourcePorts: '0-65535', destination: '0.0.0.0/0',      destinationPorts: '0-65535' },
  { name: 'DenyAllInbound',                priority: 65500, direction: 'Inbound',  access: 'Deny',  protocol: 'Any', source: '0.0.0.0/0',         sourcePorts: '0-65535', destination: '0.0.0.0/0',      destinationPorts: '0-65535' },
  { name: 'AllowVnetOutBound',             priority: 65000, direction: 'Outbound', access: 'Allow', protocol: 'Any', source: 'VirtualNetwork',    sourcePorts: '0-65535', destination: 'VirtualNetwork', destinationPorts: '0-65535' },
  { name: 'AllowInternetOutBound',         priority: 65001, direction: 'Outbound', access: 'Allow', protocol: 'Any', source: '0.0.0.0/0',         sourcePorts: '0-65535', destination: 'Internet',       destinationPorts: '0-65535' },
  { name: 'DenyAllOutBound',               priority: 65500, direction: 'Outbound', access: 'Deny',  protocol: 'Any', source: '0.0.0.0/0',         sourcePorts: '0-65535', destination: '0.0.0.0/0',      destinationPorts: '0-65535' },
].map(Object.freeze))

// ── Hierarchy helpers ────────────────────────────────────────────────────────

export const isRoot = (state, mgId) => mgId === state.tenantId

/** Levels below the root: the root is 0, its children 1 … at most 6 (I5). */
export function managementGroupDepth(state, mgId) {
  let depth = 0
  for (let mg = state.managementGroups[mgId]; mg && mg.parentId; mg = state.managementGroups[mg.parentId]) depth++
  return depth
}

export function childManagementGroups(state, mgId) {
  return Object.values(state.managementGroups).filter(mg => mg.parentId === mgId)
}

export function childSubscriptions(state, mgId) {
  return Object.values(state.subscriptions).filter(s => s.parentId === mgId)
}

/** Management-group levels in the subtree rooted at mgId, counting mgId itself as 1. */
export function subtreeHeight(state, mgId) {
  const kids = childManagementGroups(state, mgId)
  return 1 + (kids.length ? Math.max(...kids.map(k => subtreeHeight(state, k.id))) : 0)
}

export function isDescendantOrSelf(state, mgId, ancestorId) {
  for (let id = mgId; id; id = state.managementGroups[id]?.parentId) if (id === ancestorId) return true
  return false
}

// ── Resource lookups ─────────────────────────────────────────────────────────

export const resourcesInGroup = (state, subscriptionId, rgName) =>
  Object.values(state.resources).filter(r => r.subscriptionId === subscriptionId && r.resourceGroup === rgName)

export const resourcesOfType = (state, type) =>
  Object.values(state.resources).filter(r => r.type === type)

/** "…/virtualNetworks/vnet1/subnets/web" → { vnet, subnet } (either may be undefined). */
export function findSubnet(state, id) {
  const cut = id?.lastIndexOf('/subnets/') ?? -1
  if (cut < 0) return {}
  const vnet = state.resources[id.slice(0, cut)]
  const name = id.slice(cut + '/subnets/'.length)
  return { vnet, subnet: vnet?.properties.subnets.find(s => s.name === name) }
}

/** Every private IP already used by a NIC in this subnet. */
export function usedAddressesInSubnet(state, subnetResourceId) {
  return resourcesOfType(state, TYPES.NETWORK_INTERFACE)
    .filter(n => n.properties.subnetId === subnetResourceId)
    .map(n => n.properties.privateIpAddress)
}
