/**
 * Cloud operations — the ONLY way cloud state changes (roadmap §3.3). Every input surface
 * (canvas forms now, the az CLI later, missions and tests) calls these functions.
 *
 * Each operation is pure: (state, args) →
 *   { ok: true, state: nextState, id, warnings: [{ ruleId, message }] }
 *   { ok: false, outcome, ruleId, message }          ← refuse(), see outcomes.js
 *
 * Rule IDs refer to docs/AZURE_ACCURACY.md; only VERIFIED rules are enforced. Cases the
 * verified spec doesn't cover are refused as `not_modelled` (PHASE_1A_CLOUD_SECTION §6a)
 * instead of guessing what Azure does.
 */
import { OUTCOME, refuse } from './outcomes.js'
import { isRegion, regionDisplayName } from './regions.js'
import {
  managementGroupNameReason, resourceGroupNameReason, virtualNetworkNameReason, subnetNameReason,
  networkInterfaceNameReason, networkSecurityGroupNameReason, publicIpNameReason, securityRuleNameReason,
  diskNameReason, virtualMachineNameReason, storageAccountNameReason, SIMULATED_TAKEN_STORAGE_NAMES,
} from './naming.js'
import {
  parseCidr, overlaps, contains, blockedRangeHit, isPrivateBlock, isReserved, containsIp,
  nextFreeAddress, SUBNET_MIN_PREFIX, SUBNET_MAX_PREFIX,
} from './cidr.js'
import {
  TYPES, newGuid, resourceGroupId, resourceId, subnetId, isRoot, managementGroupDepth,
  childManagementGroups, childSubscriptions, subtreeHeight, isDescendantOrSelf,
  resourcesInGroup, resourcesOfType, findSubnet, usedAddressesInSubnet,
} from './model.js'
import {
  DISK_TYPES, VM_SIZES, OS_TYPES, STORAGE_KINDS, storageEndpoints, SECURITY_RULE_PROTOCOLS,
  SECURITY_RULE_DIRECTIONS, SECURITY_RULE_ACCESS, SERVICE_TAGS, PUBLIC_IP_POOL,
} from './catalog.js'
import { isValidIp } from '@sim/kernel/ipUtils.js'

const MAX_MG_DEPTH = 6                     // I5
const MAX_MANAGEMENT_GROUPS = 10000        // I6
const MAX_RESOURCE_GROUPS = 980            // J8
const MAX_PER_TYPE_PER_GROUP = 800         // J8
const MAX_STORAGE_PER_REGION = 250         // M6

const done = (state, id, warnings = []) => ({ ok: true, state, id, warnings })
const clone = state => structuredClone(state)
const notModelled = what => refuse(OUTCOME.NOT_MODELLED, null, `This simulator doesn't model ${what} yet.`)

// ── Management groups and subscriptions (§I) ───────────────────────────────

export function createManagementGroup(state, { id, displayName, parentId = state.tenantId }) {
  const why = managementGroupNameReason(id)
  if (why) return refuse(OUTCOME.NAME_INVALID, 'I8', `The management group ID ${why}.`)
  if (!displayName?.trim()) return refuse(OUTCOME.INVALID_VALUE, 'I8', 'A management group needs a display name as well as an ID.')
  if (state.managementGroups[id]) return refuse(OUTCOME.NAME_NOT_UNIQUE, 'K', `A management group with the ID "${id}" already exists in this tenant.`)
  if (!state.managementGroups[parentId]) return refuse(OUTCOME.NOT_FOUND, null, 'The parent management group does not exist.')
  if (Object.keys(state.managementGroups).length >= MAX_MANAGEMENT_GROUPS)
    return refuse(OUTCOME.LIMIT_REACHED, 'I6', 'A directory supports 10,000 management groups.')
  if (managementGroupDepth(state, parentId) + 1 > MAX_MG_DEPTH)
    return refuse(OUTCOME.HIERARCHY_TOO_DEEP, 'I5', 'A management group tree supports up to six levels below the root.')
  const next = clone(state)
  next.managementGroups[id] = { id, displayName: displayName.trim(), parentId }
  return done(next, id)
}

/** I1: the display name can change — the root's too ("Tenant root group" is only the default). */
export function renameManagementGroup(state, { id, displayName }) {
  if (!state.managementGroups[id]) return refuse(OUTCOME.NOT_FOUND, null, 'That management group does not exist.')
  if (!displayName?.trim()) return refuse(OUTCOME.INVALID_VALUE, 'I8', 'A management group needs a display name.')
  const next = clone(state)
  next.managementGroups[id].displayName = displayName.trim()
  return done(next, id)
}

export function moveManagementGroup(state, { id, parentId }) {
  if (!state.managementGroups[id]) return refuse(OUTCOME.NOT_FOUND, null, 'That management group does not exist.')
  if (isRoot(state, id)) return refuse(OUTCOME.ROOT_IMMUTABLE, 'I2', 'The root management group can\'t be moved or deleted.')
  if (!state.managementGroups[parentId]) return refuse(OUTCOME.NOT_FOUND, null, 'The target management group does not exist.')
  if (isDescendantOrSelf(state, parentId, id))
    return refuse(OUTCOME.HIERARCHY_CYCLE, 'I4', 'A management group can\'t be moved under itself or one of its own children.')
  if (managementGroupDepth(state, parentId) + subtreeHeight(state, id) > MAX_MG_DEPTH)
    return refuse(OUTCOME.HIERARCHY_TOO_DEEP, 'I5', 'After this move the tree would be more than six levels deep below the root.')
  const next = clone(state)
  next.managementGroups[id].parentId = parentId
  return done(next, id)
}

export function deleteManagementGroup(state, { id }) {
  if (!state.managementGroups[id]) return refuse(OUTCOME.NOT_FOUND, null, 'That management group does not exist.')
  if (isRoot(state, id)) return refuse(OUTCOME.ROOT_IMMUTABLE, 'I2', 'The root management group can\'t be moved or deleted.')
  if (childManagementGroups(state, id).length || childSubscriptions(state, id).length)
    return notModelled('deleting a management group that still has children')
  const next = clone(state)
  delete next.managementGroups[id]
  return done(next, id)
}

/**
 * Add a subscription to the tenant. Real subscriptions come from a billing agreement, not
 * a portal button — missions hand them out; the sandbox labels this as a simulated
 * shortcut (PHASE_1A §6 decision 3). I3: new subscriptions land under the root.
 */
export function addSubscription(state, { id = newGuid(), displayName }) {
  if (!displayName?.trim()) return refuse(OUTCOME.INVALID_VALUE, null, 'A subscription needs a display name.')
  if (state.subscriptions[id]) return refuse(OUTCOME.NAME_NOT_UNIQUE, null, 'That subscription ID already exists.')
  const next = clone(state)
  next.subscriptions[id] = { id, displayName: displayName.trim(), parentId: state.tenantId }
  return done(next, id)
}

/** I4: a subscription has exactly one parent management group. */
export function moveSubscription(state, { id, parentId }) {
  if (!state.subscriptions[id]) return refuse(OUTCOME.NOT_FOUND, null, 'That subscription does not exist.')
  if (!state.managementGroups[parentId]) return refuse(OUTCOME.NOT_FOUND, null, 'The target management group does not exist.')
  const next = clone(state)
  next.subscriptions[id].parentId = parentId
  return done(next, id)
}

// ── Resource groups (§J) ───────────────────────────────────────────────────

export function createResourceGroup(state, { subscriptionId, name, location, tags = {} }) {
  if (!state.subscriptions[subscriptionId]) return refuse(OUTCOME.NOT_FOUND, null, 'That subscription does not exist.')
  const why = resourceGroupNameReason(name)
  if (why) return refuse(OUTCOME.NAME_INVALID, 'K', `The resource group name ${why}.`)
  if (!isRegion(location)) return refuse(OUTCOME.INVALID_VALUE, 'J2', 'A resource group needs a region — it\'s where its metadata is stored.')
  const id = resourceGroupId(subscriptionId, name)
  if (state.resourceGroups[id]) return refuse(OUTCOME.NAME_NOT_UNIQUE, 'K', `This subscription already has a resource group called "${name}".`)
  const groups = Object.values(state.resourceGroups).filter(g => g.subscriptionId === subscriptionId)
  if (groups.length >= MAX_RESOURCE_GROUPS) return refuse(OUTCOME.LIMIT_REACHED, 'J8', 'A subscription supports 980 resource groups.')
  const next = clone(state)
  next.resourceGroups[id] = { id, name, subscriptionId, location, tags: { ...tags } }
  return done(next, id)
}

/** J3: deleting a resource group deletes every resource in it. */
export function deleteResourceGroup(state, { subscriptionId, name }) {
  const id = resourceGroupId(subscriptionId, name)
  if (!state.resourceGroups[id]) return refuse(OUTCOME.NOT_FOUND, null, 'That resource group does not exist.')
  const inside = new Set(resourcesInGroup(state, subscriptionId, name).map(r => r.id))
  const outside = Object.values(state.resources).filter(r => !inside.has(r.id))
  if (outside.some(r => referencesAny(r, inside)))
    return notModelled('deleting a resource group whose resources are still used from another resource group')
  const next = clone(state)
  for (const rid of inside) delete next.resources[rid]
  delete next.resourceGroups[id]
  return done(next, id)
}

// ── Shared checks for resources ────────────────────────────────────────────

function checkPlacement(state, { subscriptionId, resourceGroup, location }) {
  if (!state.subscriptions[subscriptionId]) return refuse(OUTCOME.NOT_FOUND, null, 'That subscription does not exist.')
  if (!state.resourceGroups[resourceGroupId(subscriptionId, resourceGroup)])
    return refuse(OUTCOME.NOT_FOUND, null, 'That resource group does not exist.')
  if (!isRegion(location)) return refuse(OUTCOME.INVALID_VALUE, null, 'Pick one of the offered regions.')
  return null
}

function checkNewResource(state, { subscriptionId, resourceGroup, type, name, nameReason, label }) {
  const why = nameReason(name)
  if (why) return refuse(OUTCOME.NAME_INVALID, 'K', `The ${label} name ${why}.`)
  if (state.resources[resourceId(subscriptionId, resourceGroup, type, name)])
    return refuse(OUTCOME.NAME_NOT_UNIQUE, 'K', `This resource group already has a ${label} called "${name}".`)
  if (resourcesInGroup(state, subscriptionId, resourceGroup).filter(r => r.type === type).length >= MAX_PER_TYPE_PER_GROUP)
    return refuse(OUTCOME.LIMIT_REACHED, 'J8', 'A resource group supports up to 800 instances of a resource type.')
  return null
}

function newResource({ subscriptionId, resourceGroup, location, tags = {} }, type, name, properties) {
  return { id: resourceId(subscriptionId, resourceGroup, type, name), type, name, subscriptionId, resourceGroup, location, tags: { ...tags }, properties }
}

/** Does any string inside r.properties point at one of the ids (or something under them)? */
function referencesAny(r, ids) {
  const hit = v => typeof v === 'string'
    ? [...ids].some(id => v === id || v.startsWith(`${id}/`))
    : v && typeof v === 'object' && Object.values(v).some(hit)
  return hit(r.properties)
}

// ── Virtual networks and subnets (§A) ──────────────────────────────────────

function checkSubnet(vnetProps, { name, addressPrefix }, otherSubnets) {
  const why = subnetNameReason(name)
  if (why) return refuse(OUTCOME.NAME_INVALID, 'K', `The subnet name ${why}.`)
  if (otherSubnets.some(s => s.name === name)) return refuse(OUTCOME.NAME_NOT_UNIQUE, 'K', `This virtual network already has a subnet called "${name}".`)
  const block = parseCidr(addressPrefix)
  if (!block) return refuse(OUTCOME.ADDRESS_INVALID, 'A3', `"${addressPrefix}" isn't a valid CIDR block — write the network address, e.g. 10.0.1.0/24.`)
  if (block.prefix < SUBNET_MIN_PREFIX || block.prefix > SUBNET_MAX_PREFIX)
    return refuse(OUTCOME.SUBNET_SIZE, 'A2', 'The smallest supported subnet is /29 and the largest is /2.')
  if (!vnetProps.addressPrefixes.some(p => contains(parseCidr(p), block)))
    return refuse(OUTCOME.SUBNET_OUTSIDE_VNET, 'A3', `${addressPrefix} isn't inside the virtual network's address space (${vnetProps.addressPrefixes.join(', ')}).`)
  const clash = otherSubnets.find(s => overlaps(parseCidr(s.addressPrefix), block))
  if (clash) return refuse(OUTCOME.SUBNET_OVERLAP, 'A3', `${addressPrefix} overlaps subnet "${clash.name}" (${clash.addressPrefix}). Subnets can't overlap.`)
  return null
}

// B1: subnets in new virtual networks are private — no default outbound access.
const newSubnet = ({ name, addressPrefix }) => ({ name, addressPrefix, networkSecurityGroupId: null, defaultOutboundAccess: false })

export function createVirtualNetwork(state, args) {
  const { name, addressPrefixes = [], subnets = [] } = args
  const placed = checkPlacement(state, args) ?? checkNewResource(state, {
    ...args, type: TYPES.VIRTUAL_NETWORK, nameReason: virtualNetworkNameReason, label: 'virtual network',
  })
  if (placed) return placed
  if (!addressPrefixes.length) return refuse(OUTCOME.INVALID_VALUE, 'A3', 'A virtual network needs an address space.')
  const warnings = []
  const blocks = []
  for (const p of addressPrefixes) {
    const block = parseCidr(p)
    if (!block) return refuse(OUTCOME.ADDRESS_INVALID, 'A3', `"${p}" isn't a valid CIDR block — write the network address, e.g. 10.0.0.0/16.`)
    const hit = blockedRangeHit(block)
    if (hit) return refuse(OUTCOME.ADDRESS_RANGE_BLOCKED, 'A3a', `${p} overlaps ${hit.cidr}, which can't be used in a virtual network.`)
    if (blocks.some(b => overlaps(b, block))) return notModelled('overlapping address ranges inside one virtual network')
    if (!isPrivateBlock(block))
      warnings.push({ ruleId: 'A3a', message: `${p} isn't in RFC 1918 or RFC 6598 private space. Azure allows it, but it "might work but have undesirable side effects".` })
    blocks.push(block)
  }
  const props = { addressPrefixes: blocks.map(b => b.cidr), subnets: [] }
  for (const s of subnets) {
    const bad = checkSubnet(props, s, props.subnets)
    if (bad) return bad
    props.subnets.push(newSubnet({ name: s.name, addressPrefix: parseCidr(s.addressPrefix).cidr }))
  }
  const next = clone(state)
  const vnet = newResource(args, TYPES.VIRTUAL_NETWORK, name, props)
  next.resources[vnet.id] = vnet
  return done(next, vnet.id, warnings)
}

export function addSubnet(state, { vnetId, name, addressPrefix }) {
  const vnet = state.resources[vnetId]
  if (vnet?.type !== TYPES.VIRTUAL_NETWORK) return refuse(OUTCOME.NOT_FOUND, null, 'That virtual network does not exist.')
  const bad = checkSubnet(vnet.properties, { name, addressPrefix }, vnet.properties.subnets)
  if (bad) return bad
  const next = clone(state)
  next.resources[vnetId].properties.subnets.push(newSubnet({ name, addressPrefix: parseCidr(addressPrefix).cidr }))
  return done(next, subnetId(vnetId, name))
}

/** A3: a subnet can be resized only "if no VMs or services are deployed in it". */
export function resizeSubnet(state, { subnetId: id, addressPrefix }) {
  const { vnet, subnet } = findSubnet(state, id)
  if (!subnet) return refuse(OUTCOME.NOT_FOUND, null, 'That subnet does not exist.')
  if (usedAddressesInSubnet(state, id).length)
    return refuse(OUTCOME.SUBNET_IN_USE, 'A3', 'A subnet can only be resized while nothing is deployed in it.')
  const others = vnet.properties.subnets.filter(s => s.name !== subnet.name)
  const bad = checkSubnet(vnet.properties, { name: subnet.name, addressPrefix }, others)
  if (bad) return bad
  const next = clone(state)
  next.resources[vnet.id].properties.subnets.find(s => s.name === subnet.name).addressPrefix = parseCidr(addressPrefix).cidr
  return done(next, id)
}

// ── Network security groups (§C) — stored and shown, evaluated from Phase 2 ─

function checkPorts(ports) {
  if (ports === '*' || ports === 'Any') return true
  return String(ports).split(',').every(part => {
    const m = /^\s*(\d{1,5})(?:-(\d{1,5}))?\s*$/.exec(part)
    if (!m) return false
    const lo = Number(m[1]), hi = Number(m[2] ?? m[1])
    return lo <= hi && hi <= 65535
  })
}

function checkAddressField(value) {
  if (value === '*' || value === 'Any' || SERVICE_TAGS.includes(value)) return null
  if (isValidIp(value) || parseCidr(value)) return null
  return notModelled(`the source/destination "${value}" (supported: Any, an IP address, a CIDR block, or ${SERVICE_TAGS.join(', ')})`)
}

function checkSecurityRule(rule, existing) {
  const why = securityRuleNameReason(rule.name)
  if (why) return refuse(OUTCOME.NAME_INVALID, 'C2', `The rule name ${why}.`)
  if (existing.some(r => r.name === rule.name)) return refuse(OUTCOME.NAME_NOT_UNIQUE, 'C2', `This NSG already has a rule called "${rule.name}".`)
  if (!Number.isInteger(rule.priority) || rule.priority < 100 || rule.priority > 4096)
    return refuse(OUTCOME.INVALID_VALUE, 'C1', 'Custom rule priority must be a number from 100 to 4096 — lower numbers are processed first.')
  if (!SECURITY_RULE_DIRECTIONS.includes(rule.direction)) return refuse(OUTCOME.INVALID_VALUE, 'C1', 'Direction must be Inbound or Outbound.')
  if (!SECURITY_RULE_ACCESS.includes(rule.access)) return refuse(OUTCOME.INVALID_VALUE, 'C1', 'Action must be Allow or Deny.')
  if (!SECURITY_RULE_PROTOCOLS.includes(rule.protocol)) return refuse(OUTCOME.INVALID_VALUE, 'C1', `Protocol must be one of ${SECURITY_RULE_PROTOCOLS.join(', ')}.`)
  if (existing.some(r => r.direction === rule.direction && r.priority === rule.priority))
    return refuse(OUTCOME.INVALID_VALUE, 'C2', `Another ${rule.direction.toLowerCase()} rule already has priority ${rule.priority}. Two rules can't share a priority and direction.`)
  for (const p of [rule.sourcePorts ?? '*', rule.destinationPorts ?? '*'])
    if (!checkPorts(p)) return refuse(OUTCOME.INVALID_VALUE, null, `"${p}" isn't a valid port, port range or list (0–65535).`)
  return checkAddressField(rule.source ?? '*') ?? checkAddressField(rule.destination ?? '*')
}

const normaliseRule = r => ({
  name: r.name, priority: r.priority, direction: r.direction, access: r.access, protocol: r.protocol,
  source: r.source ?? '*', sourcePorts: r.sourcePorts ?? '*', destination: r.destination ?? '*', destinationPorts: r.destinationPorts ?? '*',
})

export function createNetworkSecurityGroup(state, args) {
  const { name, securityRules = [] } = args
  const placed = checkPlacement(state, args) ?? checkNewResource(state, {
    ...args, type: TYPES.NETWORK_SECURITY_GROUP, nameReason: networkSecurityGroupNameReason, label: 'network security group',
  })
  if (placed) return placed
  const rules = []
  for (const r of securityRules) {
    const bad = checkSecurityRule(r, rules)
    if (bad) return bad
    rules.push(normaliseRule(r))
  }
  const next = clone(state)
  // C2: the default rules aren't stored — they always exist and can't be removed (model.DEFAULT_SECURITY_RULES).
  const nsg = newResource(args, TYPES.NETWORK_SECURITY_GROUP, name, { securityRules: rules })
  next.resources[nsg.id] = nsg
  return done(next, nsg.id)
}

export function addSecurityRule(state, { nsgId, rule }) {
  const nsg = state.resources[nsgId]
  if (nsg?.type !== TYPES.NETWORK_SECURITY_GROUP) return refuse(OUTCOME.NOT_FOUND, null, 'That network security group does not exist.')
  const bad = checkSecurityRule(rule, nsg.properties.securityRules)
  if (bad) return bad
  const next = clone(state)
  next.resources[nsgId].properties.securityRules.push(normaliseRule(rule))
  return done(next, `${nsgId}/securityRules/${rule.name}`)
}

/** Associate an NSG with a subnet or a NIC (one NSG per subnet and per NIC). */
export function associateNetworkSecurityGroup(state, { nsgId, targetId }) {
  const nsg = state.resources[nsgId]
  if (nsg?.type !== TYPES.NETWORK_SECURITY_GROUP) return refuse(OUTCOME.NOT_FOUND, null, 'That network security group does not exist.')
  const nic = state.resources[targetId]?.type === TYPES.NETWORK_INTERFACE ? state.resources[targetId] : null
  const { vnet, subnet } = nic ? {} : findSubnet(state, targetId)
  const owner = nic ?? vnet
  if (!owner || (!nic && !subnet)) return refuse(OUTCOME.NOT_FOUND, null, 'Pick a subnet or a network interface.')
  if (owner.location !== nsg.location || owner.subscriptionId !== nsg.subscriptionId)
    return notModelled('associating an NSG with a subnet or NIC in another region or subscription')
  const next = clone(state)
  if (nic) next.resources[nic.id].properties.networkSecurityGroupId = nsgId
  else next.resources[vnet.id].properties.subnets.find(s => s.name === subnet.name).networkSecurityGroupId = nsgId
  return done(next, targetId)
}

// ── Public IP addresses (§N) ───────────────────────────────────────────────

function nextPublicAddress(state) {
  const used = new Set(resourcesOfType(state, TYPES.PUBLIC_IP).map(p => p.properties.ipAddress))
  for (let n = PUBLIC_IP_POOL.first; n <= PUBLIC_IP_POOL.last; n++) {
    const ip = `${PUBLIC_IP_POOL.prefix}${n}`
    if (!used.has(ip)) return ip
  }
  return null
}

export function createPublicIp(state, args) {
  const { name, location, sku = 'Standard', allocationMethod = 'Static', domainNameLabel = null } = args
  const placed = checkPlacement(state, args) ?? checkNewResource(state, {
    ...args, type: TYPES.PUBLIC_IP, nameReason: publicIpNameReason, label: 'public IP address',
  })
  if (placed) return placed
  if (sku === 'Basic') return refuse(OUTCOME.RETIRED, 'N1', 'Basic SKU public IPs were retired on September 30, 2025. Use Standard.')
  if (sku === 'StandardV2') return refuse(OUTCOME.INVALID_VALUE, 'N3', 'Standard v2 public IPs can only be used with the Standard v2 NAT gateway; this simulator offers Standard.')
  if (sku !== 'Standard') return refuse(OUTCOME.INVALID_VALUE, 'N1', 'The SKU must be Standard.')
  if (allocationMethod !== 'Static') return refuse(OUTCOME.INVALID_VALUE, 'N2', 'Standard public IPs are always statically allocated.')
  if (domainNameLabel && resourcesOfType(state, TYPES.PUBLIC_IP).some(p => p.location === location && p.properties.domainNameLabel === domainNameLabel))
    return refuse(OUTCOME.NAME_NOT_UNIQUE, 'N5', `The DNS label "${domainNameLabel}" is already used in this region.`)
  const ipAddress = nextPublicAddress(state)
  if (!ipAddress) return notModelled('more than 245 public IP addresses')
  const next = clone(state)
  const pip = newResource(args, TYPES.PUBLIC_IP, name, {
    sku: 'Standard', allocationMethod: 'Static', ipAddress, ipConfigurationId: null,
    domainNameLabel, fqdn: domainNameLabel ? `${domainNameLabel}.${location}.cloudapp.azure.com` : null,
  })
  next.resources[pip.id] = pip
  return done(next, pip.id)
}

// ── Network interfaces (§L) ────────────────────────────────────────────────

export function createNetworkInterface(state, args) {
  const { name, subscriptionId, location, subnetId: snId, privateIpAllocation = 'Dynamic', privateIpAddress = null,
    publicIpId = null, networkSecurityGroupId = null } = args
  const placed = checkPlacement(state, args) ?? checkNewResource(state, {
    ...args, type: TYPES.NETWORK_INTERFACE, nameReason: networkInterfaceNameReason, label: 'network interface',
  })
  if (placed) return placed
  const { vnet, subnet } = findSubnet(state, snId)
  if (!subnet) return refuse(OUTCOME.NOT_FOUND, null, 'That subnet does not exist.')
  if (vnet.subscriptionId !== subscriptionId)
    return refuse(OUTCOME.SUBSCRIPTION_MISMATCH, 'L2', 'A NIC can only join a virtual network in the same subscription.')
  if (vnet.location !== location)
    return refuse(OUTCOME.REGION_MISMATCH, 'L2', `A NIC can only join a virtual network in the same region — ${vnet.name} is in ${regionDisplayName(vnet.location)}.`)

  const block = parseCidr(subnet.addressPrefix)
  const used = usedAddressesInSubnet(state, snId)
  let ip
  if (privateIpAllocation === 'Dynamic') {
    ip = nextFreeAddress(block, used)
    if (!ip) return refuse(OUTCOME.LIMIT_REACHED, 'A1', `Subnet ${subnet.name} has no free addresses left (Azure keeps five of every subnet).`)
  } else if (privateIpAllocation === 'Static') {
    if (!containsIp(block, privateIpAddress))
      return refuse(OUTCOME.ADDRESS_INVALID, 'L3', `A static address must come from the subnet's range (${subnet.addressPrefix}).`)
    if (isReserved(block, privateIpAddress))
      return refuse(OUTCOME.ADDRESS_RESERVED, 'A1', `${privateIpAddress} is reserved — Azure keeps the first four addresses and the last one in every subnet.`)
    if (used.includes(privateIpAddress)) return refuse(OUTCOME.ADDRESS_IN_USE, 'L3', `${privateIpAddress} is already used by another NIC.`)
    ip = privateIpAddress
  } else {
    return refuse(OUTCOME.INVALID_VALUE, 'L3', 'Private IP assignment is Dynamic or Static.')
  }

  if (publicIpId) {
    const pip = state.resources[publicIpId]
    if (pip?.type !== TYPES.PUBLIC_IP) return refuse(OUTCOME.NOT_FOUND, null, 'That public IP address does not exist.')
    if (pip.properties.ipConfigurationId) return notModelled('sharing one public IP address between resources')
    if (pip.location !== location || pip.subscriptionId !== subscriptionId)
      return notModelled('a public IP address from another region or subscription')
  }
  if (networkSecurityGroupId) {
    const nsg = state.resources[networkSecurityGroupId]
    if (nsg?.type !== TYPES.NETWORK_SECURITY_GROUP) return refuse(OUTCOME.NOT_FOUND, null, 'That network security group does not exist.')
    if (nsg.location !== location || nsg.subscriptionId !== subscriptionId)
      return notModelled('an NSG from another region or subscription')
  }

  const next = clone(state)
  const nic = newResource(args, TYPES.NETWORK_INTERFACE, name, {
    subnetId: snId, privateIpAllocation, privateIpAddress: ip, publicIpId, networkSecurityGroupId,
    virtualMachineId: null,
    ipForwarding: false,   // L5: off by default
  })
  next.resources[nic.id] = nic
  if (publicIpId) next.resources[publicIpId].properties.ipConfigurationId = nic.id
  return done(next, nic.id)
}

// ── Managed disks and virtual machines (§L) ────────────────────────────────

export function createDisk(state, args) {
  const { name, diskType, redundancy = 'LRS', sizeGiB } = args
  const placed = checkPlacement(state, args) ?? checkNewResource(state, {
    ...args, type: TYPES.DISK, nameReason: diskNameReason, label: 'disk',
  })
  if (placed) return placed
  const kind = DISK_TYPES[diskType]
  if (!kind) return refuse(OUTCOME.INVALID_VALUE, 'L7', `Disk type must be one of ${Object.values(DISK_TYPES).map(d => d.displayName).join(', ')}.`)
  if (!['LRS', 'ZRS'].includes(redundancy)) return refuse(OUTCOME.INVALID_VALUE, 'L8', 'Managed disks are LRS or ZRS.')
  if (redundancy === 'ZRS' && diskType === 'UltraDisk') return refuse(OUTCOME.INVALID_VALUE, 'L8', 'Ultra Disks don\'t support ZRS — they\'re LRS only.')
  if (redundancy === 'ZRS' && !['PremiumSSD', 'StandardSSD'].includes(diskType)) return notModelled(`ZRS for ${kind.displayName}`)
  if (!Number.isInteger(sizeGiB) || sizeGiB < 1 || sizeGiB > kind.maxGiB)
    return refuse(OUTCOME.INVALID_VALUE, 'L7', `${kind.displayName} disks are 1–${kind.maxGiB.toLocaleString('en-US')} GiB.`)
  const next = clone(state)
  const disk = newResource(args, TYPES.DISK, name, { diskType, redundancy, sizeGiB, managedBy: null })
  next.resources[disk.id] = disk
  return done(next, disk.id)
}

export function createVirtualMachine(state, args) {
  const { name, subscriptionId, location, osType, size, image = null, osDisk = {}, networkInterfaceIds = [], dataDiskIds = [] } = args
  if (!OS_TYPES.includes(osType)) return refuse(OUTCOME.INVALID_VALUE, 'K1', 'Pick Linux or Windows — the name rules differ.')
  const placed = checkPlacement(state, args) ?? checkNewResource(state, {
    ...args, type: TYPES.VIRTUAL_MACHINE, nameReason: n => virtualMachineNameReason(n, osType), label: `${osType} virtual machine`,
  })
  if (placed) return placed
  if (!VM_SIZES.includes(size)) return refuse(OUTCOME.INVALID_VALUE, null, `Pick one of the offered sizes: ${VM_SIZES.join(', ')}.`)
  if (!networkInterfaceIds.length) return refuse(OUTCOME.NIC_REQUIRED, 'L1', 'A virtual machine always has at least one network interface.')
  for (const nicId of networkInterfaceIds) {
    const nic = state.resources[nicId]
    if (nic?.type !== TYPES.NETWORK_INTERFACE) return refuse(OUTCOME.NOT_FOUND, null, 'That network interface does not exist.')
    if (nic.properties.virtualMachineId) return notModelled('attaching a NIC that is already attached to another VM')
    if (nic.subscriptionId !== subscriptionId)
      return refuse(OUTCOME.SUBSCRIPTION_MISMATCH, 'L2', `The VM must be in the same subscription as its NIC ${nic.name}.`)
    if (nic.location !== location)
      return refuse(OUTCOME.REGION_MISMATCH, 'L2', `The VM must be in the same region as its NIC ${nic.name} (${regionDisplayName(nic.location)}).`)
  }
  const os = DISK_TYPES[osDisk.diskType]
  if (!os) return refuse(OUTCOME.INVALID_VALUE, 'L7', 'Pick an OS disk type.')
  if (!os.osCapable) return refuse(OUTCOME.DISK_NOT_OS_CAPABLE, 'L7', `${os.displayName} can't be used as an OS disk — use Premium SSD, Standard SSD or Standard HDD.`)
  const osSize = osDisk.sizeGiB ?? 128
  if (!Number.isInteger(osSize) || osSize < 1 || osSize > os.maxGiB) return refuse(OUTCOME.INVALID_VALUE, 'L7', `${os.displayName} disks are 1–${os.maxGiB.toLocaleString('en-US')} GiB.`)
  for (const diskId of dataDiskIds) {
    const disk = state.resources[diskId]
    if (disk?.type !== TYPES.DISK) return refuse(OUTCOME.NOT_FOUND, null, 'That disk does not exist.')
    if (disk.properties.managedBy) return notModelled('attaching a disk that is already attached to another VM')
    if (disk.location !== location || disk.subscriptionId !== subscriptionId) return notModelled('a data disk from another region or subscription')
  }
  const warnings = osDisk.diskType === 'StandardHDD'
    ? [{ ruleId: 'L7', message: 'Standard HDD as an OS disk is being retired on September 8, 2028.' }]
    : []
  const next = clone(state)
  const vm = newResource(args, TYPES.VIRTUAL_MACHINE, name, {
    osType, image, size, osDisk: { diskType: osDisk.diskType, sizeGiB: osSize },
    networkInterfaceIds: [...networkInterfaceIds], dataDiskIds: [...dataDiskIds],
  })
  next.resources[vm.id] = vm
  for (const nicId of networkInterfaceIds) next.resources[nicId].properties.virtualMachineId = vm.id
  for (const diskId of dataDiskIds) next.resources[diskId].properties.managedBy = vm.id
  return done(next, vm.id, warnings)
}

/**
 * The portal's "Create a virtual machine" flow (Basics → Disks → Networking → Review +
 * create): the wizard creates the VM's network interface — and, if asked, a Standard public
 * IP — together with the VM. NIC page: "The portal does create a NIC with default settings
 * and a public IP address when you create a VM." Everything is validated before anything is
 * deployed, so a refusal leaves the tenant untouched (all or nothing).
 *
 * The extra resources are named `<vm>-nic` and `<vm>-ip` — names this simulator makes up; the portal picks
 * its own. createVirtualMachine (existing NICs) stays for the CLI/PowerShell-style path.
 */
export function deployVirtualMachine(state, args) {
  const { name, osType, subnetId: snId, publicIp = 'none', networkSecurityGroupId = null, dataDiskIds = [], ...rest } = args
  // The VM's own rules first, so a bad VM name is reported as such (not as a NIC-name problem).
  if (!OS_TYPES.includes(osType)) return refuse(OUTCOME.INVALID_VALUE, 'K1', 'Pick an image — Linux or Windows decides the name rules.')
  const why = virtualMachineNameReason(name, osType)
  if (why) return refuse(OUTCOME.NAME_INVALID, 'K', `The ${osType} virtual machine name ${why}.`)
  if (!['none', 'new'].includes(publicIp)) return refuse(OUTCOME.INVALID_VALUE, 'N4', 'Public IP is "None" or "Create new".')
  const placement = { subscriptionId: rest.subscriptionId, resourceGroup: rest.resourceGroup, location: rest.location, tags: rest.tags }

  let s = state
  let publicIpId = null
  if (publicIp === 'new') {
    const pip = createPublicIp(s, { ...placement, name: `${name}-ip` })
    if (!pip.ok) return pip
    s = pip.state
    publicIpId = pip.id
  }
  const nic = createNetworkInterface(s, { ...placement, name: `${name}-nic`, subnetId: snId, publicIpId, networkSecurityGroupId })
  if (!nic.ok) return nic
  const vm = createVirtualMachine(nic.state, { ...rest, name, osType, networkInterfaceIds: [nic.id], dataDiskIds })
  if (!vm.ok) return vm
  return done(vm.state, vm.id, vm.warnings)
}

// ── Storage accounts (§M) ──────────────────────────────────────────────────

function checkStorageNetwork(publicNetworkAccess, defaultAction) {
  if (publicNetworkAccess === 'SecuredByPerimeter') return notModelled('network security perimeters')
  if (!['Enabled', 'Disabled'].includes(publicNetworkAccess)) return refuse(OUTCOME.INVALID_VALUE, 'M4', 'Public network access is Enabled or Disabled.')
  if (!['Allow', 'Deny'].includes(defaultAction)) return refuse(OUTCOME.INVALID_VALUE, 'M4', 'The default network action is Allow or Deny.')
  return null
}

export function createStorageAccount(state, args) {
  const { name, subscriptionId, location, kind = 'StorageV2', redundancy, publicNetworkAccess = 'Enabled', defaultAction = 'Allow' } = args
  const placed = checkPlacement(state, args)
  if (placed) return placed
  const why = storageAccountNameReason(name)
  if (why) return refuse(OUTCOME.NAME_INVALID, 'K', `The storage account name ${why}.`)
  if (resourcesOfType(state, TYPES.STORAGE_ACCOUNT).some(s => s.name === name) || SIMULATED_TAKEN_STORAGE_NAMES.includes(name))
    return refuse(OUTCOME.NAME_NOT_UNIQUE, 'K2', `"${name}" is already taken. Storage account names must be unique across all of Azure.`)
  const k = STORAGE_KINDS[kind]
  if (!k) return refuse(OUTCOME.INVALID_VALUE, 'M1', `Pick one of: ${Object.values(STORAGE_KINDS).map(s => s.displayName).join(', ')}.`)
  if (!k.redundancy.includes(redundancy)) return refuse(OUTCOME.INVALID_VALUE, 'M1', `${k.displayName} supports ${k.redundancy.join(', ')}.`)
  const badNet = checkStorageNetwork(publicNetworkAccess, defaultAction)
  if (badNet) return badNet
  const inRegion = resourcesOfType(state, TYPES.STORAGE_ACCOUNT).filter(s => s.subscriptionId === subscriptionId && s.location === location)
  if (inRegion.length >= MAX_STORAGE_PER_REGION) return refuse(OUTCOME.LIMIT_REACHED, 'M6', 'A subscription supports 250 storage accounts per region by default.')
  const next = clone(state)
  const sa = newResource(args, TYPES.STORAGE_ACCOUNT, name, {
    kind, performance: k.performance, redundancy, publicNetworkAccess,
    networkAcls: { defaultAction, virtualNetworkRules: [], ipRules: [] },
    primaryEndpoints: storageEndpoints(name),
  })
  next.resources[sa.id] = sa
  return done(next, sa.id)
}

export function updateStorageAccount(state, { id, kind, redundancy, publicNetworkAccess, defaultAction }) {
  const sa = state.resources[id]
  if (sa?.type !== TYPES.STORAGE_ACCOUNT) return refuse(OUTCOME.NOT_FOUND, null, 'That storage account does not exist.')
  if (kind !== undefined && kind !== sa.properties.kind)
    return refuse(OUTCOME.IMMUTABLE, 'M1', 'A storage account can\'t change type after it\'s created — create a new account and copy the data.')
  if (redundancy !== undefined && redundancy !== sa.properties.redundancy) return notModelled('changing a storage account\'s redundancy')
  const pna = publicNetworkAccess ?? sa.properties.publicNetworkAccess
  const action = defaultAction ?? sa.properties.networkAcls.defaultAction
  const badNet = checkStorageNetwork(pna, action)
  if (badNet) return badNet
  const next = clone(state)
  next.resources[id].properties.publicNetworkAccess = pna
  next.resources[id].properties.networkAcls.defaultAction = action
  return done(next, id)
}

// ── Delete and move (§J, §L) ───────────────────────────────────────────────

export function deleteResource(state, { id }) {
  const r = state.resources[id]
  if (!r) return refuse(OUTCOME.NOT_FOUND, null, 'That resource does not exist.')
  if (r.type === TYPES.NETWORK_INTERFACE && r.properties.virtualMachineId)
    return refuse(OUTCOME.NIC_ATTACHED, 'L1', 'A NIC can only be deleted when it isn\'t attached to a VM.')
  if (r.type === TYPES.DISK && r.properties.managedBy) return notModelled('deleting a disk that is attached to a VM')
  if (r.type === TYPES.PUBLIC_IP && r.properties.ipConfigurationId) return notModelled('deleting a public IP that is still associated')
  if (r.type === TYPES.VIRTUAL_NETWORK && resourcesOfType(state, TYPES.NETWORK_INTERFACE).some(n => n.properties.subnetId.startsWith(`${id}/subnets/`)))
    return notModelled('deleting a virtual network that still has network interfaces')
  if (r.type === TYPES.NETWORK_SECURITY_GROUP && Object.values(state.resources).some(o => o.id !== id && referencesAny(o, new Set([id]))))
    return notModelled('deleting an NSG that is still associated')
  const next = clone(state)
  if (r.type === TYPES.VIRTUAL_MACHINE) {
    // The VM's NICs and data disks are detached and left in place (PHASE_1A §6a: what a
    // real delete removes depends on per-resource delete options, not modelled yet).
    for (const nicId of r.properties.networkInterfaceIds) if (next.resources[nicId]) next.resources[nicId].properties.virtualMachineId = null
    for (const diskId of r.properties.dataDiskIds) if (next.resources[diskId]) next.resources[diskId].properties.managedBy = null
  }
  if (r.type === TYPES.NETWORK_INTERFACE && r.properties.publicIpId && next.resources[r.properties.publicIpId])
    next.resources[r.properties.publicIpId].properties.ipConfigurationId = null
  delete next.resources[id]
  return done(next, id)
}

/** Resources a resource can't leave behind in a cross-subscription move (J9's VM example). */
function dependencies(state, r) {
  const p = r.properties
  if (r.type === TYPES.VIRTUAL_MACHINE) return [...p.networkInterfaceIds, ...p.dataDiskIds]
  if (r.type === TYPES.NETWORK_INTERFACE) {
    const vnetId = p.subnetId.slice(0, p.subnetId.lastIndexOf('/subnets/'))
    return [vnetId, p.publicIpId, p.networkSecurityGroupId].filter(Boolean)
  }
  if (r.type === TYPES.VIRTUAL_NETWORK) return p.subnets.map(s => s.networkSecurityGroupId).filter(Boolean)
  return []
}

function dependencyClosure(state, ids) {
  const seen = new Set()
  const walk = id => {
    if (seen.has(id) || !state.resources[id]) return
    seen.add(id)
    dependencies(state, state.resources[id]).forEach(walk)
  }
  ids.forEach(walk)
  return seen
}

/** Rewrite every reference to a moved resource (its ID changes, J9). */
function remapIds(value, mapping) {
  if (typeof value === 'string') {
    for (const [from, to] of mapping) {
      if (value === from) return to
      if (value.startsWith(`${from}/`)) return to + value.slice(from.length)
    }
    return value
  }
  if (Array.isArray(value)) return value.map(v => remapIds(v, mapping))
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, remapIds(v, mapping)]))
  return value
}

/**
 * J9: move resources to another resource group (same or different subscription). The
 * region never changes; the resource ID does. Real moves can lock both groups for up to
 * four hours — here they're instant (documented simplification).
 */
export function moveResources(state, { ids, targetSubscriptionId, targetResourceGroup }) {
  if (!ids?.length) return refuse(OUTCOME.INVALID_VALUE, 'J9', 'Pick at least one resource to move.')
  const moving = ids.map(id => state.resources[id])
  if (moving.some(r => !r)) return refuse(OUTCOME.NOT_FOUND, null, 'One of those resources does not exist.')
  const { subscriptionId: srcSub, resourceGroup: srcRg } = moving[0]
  if (moving.some(r => r.subscriptionId !== srcSub || r.resourceGroup !== srcRg))
    return notModelled('moving resources from more than one resource group in a single move')
  if (!state.resourceGroups[resourceGroupId(targetSubscriptionId, targetResourceGroup)])
    return refuse(OUTCOME.NOT_FOUND, null, 'The target resource group does not exist.')
  if (srcSub === targetSubscriptionId && srcRg === targetResourceGroup)
    return refuse(OUTCOME.INVALID_VALUE, 'J9', 'The resources are already in that resource group.')

  if (srcSub !== targetSubscriptionId) {
    const missing = [...dependencyClosure(state, ids)].filter(id => !ids.includes(id))
    if (missing.length) {
      const names = missing.map(id => state.resources[id].name).join(', ')
      return refuse(OUTCOME.MOVE_MISSING_DEPENDENTS, 'J9',
        `Moving to another subscription must include every dependent resource, from the same resource group: ${names}.`)
    }
  }

  const mapping = new Map(moving.map(r => [r.id, resourceId(targetSubscriptionId, targetResourceGroup, r.type, r.name)]))
  for (const [, to] of mapping)
    if (state.resources[to]) return refuse(OUTCOME.NAME_NOT_UNIQUE, 'K', `The target resource group already has a resource called "${to.split('/').pop()}".`)

  const next = clone(state)
  for (const r of moving) delete next.resources[r.id]
  for (const r of moving) {
    const to = mapping.get(r.id)
    next.resources[to] = { ...r, id: to, subscriptionId: targetSubscriptionId, resourceGroup: targetResourceGroup }
  }
  for (const id of Object.keys(next.resources)) next.resources[id] = remapIds(next.resources[id], mapping)
  return done(next, [...mapping.values()])
}
