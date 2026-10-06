/**
 * Where each docs/AZURE_ACCURACY.md rule comes from, so a refusal can link the player to
 * the real Microsoft Learn page ("Learn more"). URLs are the sources the spec cites.
 */
const LEARN = 'https://learn.microsoft.com/en-us/azure'

const SOURCES = {
  managementGroups: { title: 'Management groups overview', url: `${LEARN}/governance/management-groups/overview` },
  resourceManager:  { title: 'What is Azure Resource Manager?', url: `${LEARN}/azure-resource-manager/management/overview` },
  limits:           { title: 'Azure subscription and service limits', url: `${LEARN}/azure-resource-manager/management/azure-subscription-service-limits` },
  move:             { title: 'Move resources to a new resource group or subscription', url: `${LEARN}/azure-resource-manager/management/move-resource-group-and-subscription` },
  naming:           { title: 'Naming rules and restrictions for Azure resources', url: `${LEARN}/azure-resource-manager/management/resource-name-rules` },
  vnetFaq:          { title: 'Azure Virtual Network FAQ', url: `${LEARN}/virtual-network/virtual-networks-faq` },
  privateIp:        { title: 'Private IP addresses', url: `${LEARN}/virtual-network/ip-services/private-ip-addresses` },
  defaultOutbound:  { title: 'Default outbound access', url: `${LEARN}/virtual-network/ip-services/default-outbound-access` },
  nsg:              { title: 'Network security groups overview', url: `${LEARN}/virtual-network/network-security-groups-overview` },
  nic:              { title: 'Create, change, or delete network interfaces', url: `${LEARN}/virtual-network/virtual-network-network-interface` },
  publicIp:         { title: 'Public IP addresses', url: `${LEARN}/virtual-network/ip-services/public-ip-addresses` },
  disks:            { title: 'Managed disk types', url: `${LEARN}/virtual-machines/disks-types` },
  storage:          { title: 'Storage account overview', url: `${LEARN}/storage/common/storage-account-overview` },
  redundancy:       { title: 'Azure Storage redundancy', url: `${LEARN}/storage/common/storage-redundancy` },
  storageNetwork:   { title: 'Set the default public network access rule', url: `${LEARN}/storage/common/storage-network-security-set-default-access` },
}

const BY_RULE = {
  A1: 'vnetFaq', A2: 'vnetFaq', A3: 'vnetFaq', A3a: 'vnetFaq', A4: 'vnetFaq', A5: 'privateIp', A7: 'vnetFaq',
  B1: 'defaultOutbound',
  C1: 'nsg', C2: 'nsg',
  I1: 'managementGroups', I2: 'managementGroups', I3: 'managementGroups', I4: 'managementGroups',
  I5: 'managementGroups', I6: 'limits', I8: 'naming',
  J2: 'resourceManager', J3: 'resourceManager', J8: 'limits', J9: 'move',
  K: 'naming', K1: 'naming', K2: 'storage',
  L1: 'nic', L2: 'nic', L3: 'nic', L5: 'nic', L7: 'disks', L8: 'redundancy',
  M1: 'storage', M4: 'storageNetwork', M6: 'storage',
  N1: 'publicIp', N2: 'publicIp', N3: 'publicIp', N5: 'publicIp',
}

/** → { title, url } for a rule ID, or null (e.g. not_modelled refusals carry no rule). */
export function ruleSource(ruleId) {
  return ruleId && BY_RULE[ruleId] ? SOURCES[BY_RULE[ruleId]] : null
}

export const RULE_IDS_WITH_SOURCES = Object.freeze(Object.keys(BY_RULE))
