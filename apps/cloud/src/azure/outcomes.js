/**
 * Management-plane outcomes — why a create / update / move / delete was refused.
 *
 * The cloud counterpart of src/core/failureReasons.js, for docs/AZURE_ACCURACY.md
 * §"Management-plane outcomes". These are the sim's own codes. A real Azure Resource
 * Manager error code is attached (`armCode`) ONLY where the spec sources it; everywhere
 * else the UI explains the rule in plain words and labels it as the simulator's explanation.
 *
 * `not_modelled` is the honest answer for a case the verified spec doesn't cover yet
 * (docs/PHASE_1A_CLOUD_SECTION.md §6a): the sim refuses rather than inventing a rule.
 */

const ENTRIES = [
  { key: 'NAME_INVALID',            code: 'name_invalid',            description: 'The name breaks the naming rule for this resource type (length or characters).' },
  { key: 'NAME_NOT_UNIQUE',         code: 'name_not_unique',         description: 'Another resource already uses this name within its uniqueness scope.' },
  { key: 'NOT_FOUND',               code: 'not_found',               description: 'A referenced subscription, resource group, management group or resource does not exist.' },
  { key: 'INVALID_VALUE',           code: 'invalid_value',           description: 'A setting has a value this resource type does not accept.' },
  { key: 'REGION_MISMATCH',         code: 'region_mismatch',         description: 'Resources that must share a region are in different regions.' },
  { key: 'SUBSCRIPTION_MISMATCH',   code: 'subscription_mismatch',   description: 'Resources that must share a subscription are in different subscriptions.' },
  { key: 'SUBNET_OVERLAP',          code: 'subnet_overlap',          description: 'The subnet overlaps another subnet in the same virtual network.' },
  { key: 'SUBNET_OUTSIDE_VNET',     code: 'subnet_outside_vnet',     description: 'The subnet is not inside the virtual network address space.' },
  { key: 'SUBNET_SIZE',             code: 'subnet_size',             description: 'The subnet prefix is outside the supported /29 to /2 range.' },
  { key: 'SUBNET_IN_USE',           code: 'subnet_in_use',           description: 'The subnet can only be resized while nothing is deployed in it.' },
  { key: 'ADDRESS_RANGE_BLOCKED',   code: 'address_range_blocked',   description: 'The address range is one Azure does not allow in a virtual network.' },
  { key: 'ADDRESS_INVALID',         code: 'address_invalid',         description: 'The IP address or CIDR block is not written correctly.' },
  { key: 'ADDRESS_RESERVED',        code: 'address_reserved',        description: 'The address is one of the five Azure reserves in every subnet.' },
  { key: 'ADDRESS_IN_USE',          code: 'address_in_use',          description: 'Another network interface already uses this private IP address.' },
  { key: 'HIERARCHY_TOO_DEEP',      code: 'hierarchy_too_deep',      description: 'The management group tree would exceed six levels below the root.' },
  { key: 'HIERARCHY_CYCLE',         code: 'hierarchy_cycle',         description: 'A management group cannot be moved under itself or one of its descendants.' },
  { key: 'ROOT_IMMUTABLE',          code: 'root_immutable',          description: 'The root management group cannot be moved or deleted.' },
  { key: 'LIMIT_REACHED',           code: 'limit_reached',           description: 'An Azure limit for this scope would be exceeded.' },
  { key: 'NIC_REQUIRED',            code: 'nic_required',            description: 'A virtual machine needs at least one network interface.' },
  { key: 'NIC_ATTACHED',            code: 'nic_attached',            description: 'The network interface is attached to a virtual machine.' },
  { key: 'DISK_NOT_OS_CAPABLE',     code: 'disk_not_os_capable',     description: 'This managed disk type cannot be used as an OS disk.' },
  { key: 'RETIRED',                 code: 'retired',                 description: 'This option has been retired by Azure.' },
  { key: 'IMMUTABLE',               code: 'immutable',               description: 'This setting cannot be changed after the resource is created.' },
  { key: 'MOVE_MISSING_DEPENDENTS', code: 'move_missing_dependents', description: 'A cross-subscription move must include every dependent resource, all from the same resource group.', armCode: 'MissingMoveDependentResources' },
  { key: 'NOT_MODELLED',            code: 'not_modelled',            description: 'The simulator does not model this case yet, so it refuses instead of guessing what Azure does.' },
]

/** OUTCOME.NAME_INVALID === 'name_invalid' */
export const OUTCOME = Object.freeze(Object.fromEntries(ENTRIES.map(e => [e.key, e.code])))

/** Registry keyed by code: { code, domain: 'cloud', description, armCode? } */
export const OUTCOMES = Object.freeze(Object.fromEntries(ENTRIES.map(e => [
  e.code,
  Object.freeze({ code: e.code, domain: 'cloud', description: e.description, ...(e.armCode ? { armCode: e.armCode } : {}) }),
])))

/** A refused operation. ruleId is the docs/AZURE_ACCURACY.md rule, or null for not_modelled. */
export function refuse(outcome, ruleId, message) {
  return { ok: false, outcome, ruleId, message }
}
