/**
 * Small, pure checks cloud missions are written with. Each reads a tenant (apps/cloud/src/azure/model.js
 * state) and never changes it, so mission progress is always derived from what the player
 * actually built — never stored separately.
 */
import { TYPES, resourceGroupId, resourceId, subnetId } from '../model.js'

const same = (a, b) => (a ?? '').trim().toLowerCase() === (b ?? '').trim().toLowerCase()

/** A management group with this ID exists, with this display name, under this parent. */
export function managementGroupIs(t, id, { displayName, parentId }) {
  const mg = t.managementGroups[id]
  return !!mg && mg.parentId === parentId && (!displayName || same(mg.displayName, displayName))
}

export const subscriptionUnder = (t, subscriptionId, parentId) => t.subscriptions[subscriptionId]?.parentId === parentId

export function resourceGroupIs(t, subscriptionId, name, location) {
  const g = t.resourceGroups[resourceGroupId(subscriptionId, name)]
  return !!g && (!location || g.location === location)
}

export const resourceAt = (t, subscriptionId, rg, type, name) => t.resources[resourceId(subscriptionId, rg, type, name)] ?? null

export const subnetOf = (vnet, name) => vnet?.properties.subnets.find(s => s.name === name) ?? null

export { subnetId, TYPES }

/** Does an NSG port field ("*", "443", "80,443", "400-500") include this port? */
export function portsInclude(ports, port) {
  if (ports === '*' || ports === 'Any') return true
  return String(ports).split(',').some(part => {
    const [lo, hi = lo] = part.trim().split('-').map(Number)
    return lo <= port && port <= hi
  })
}

/** An inbound Allow rule for TCP (or Any) whose destination ports include `port`. */
export function allowsInbound(nsg, port) {
  return !!nsg && nsg.properties.securityRules.some(r =>
    r.direction === 'Inbound' && r.access === 'Allow' && ['TCP', 'Any'].includes(r.protocol) && portsInclude(r.destinationPorts, port))
}
