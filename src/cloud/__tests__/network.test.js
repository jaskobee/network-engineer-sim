/**
 * Virtual networks, NSGs, NICs, public IPs — docs/AZURE_ACCURACY.md §A, §B, §C, §L, §N.
 *
 * N-A1  five reserved addresses per subnet; usable = 2^(32−p) − 5 (a /24 has 251)
 * N-A2  subnets /29…/2
 * N-A3  subnets inside the address space, no overlap; resize only when empty
 * N-A3a blocked ranges refused; non-private space warned
 * N-B1  new subnets have no default outbound access
 * N-C   NSG rule priority 100–4096, unique per direction; default rules exact and fixed
 * N-L2  a NIC joins a VNet only in the same subscription and region
 * N-L3  dynamic = next free address after the reserved four; static must be free and not reserved
 * N-N   public IPs: Basic retired, Standard static only
 */
import { describe, it, expect } from 'vitest'
import * as op from '../operations.js'
import { OUTCOME } from '../outcomes.js'
import { parseCidr, reservedAddresses, usableCount } from '../cidr.js'
import { DEFAULT_SECURITY_RULES } from '../model.js'
import { SUB_A, SUB_B, must, expectRefused, baseState, at, networkState } from './fixtures.js'

describe('N-A1 — reserved addresses', () => {
  it('a /24 reserves .0 .1 .2 .3 and .255 and leaves 251 usable', () => {
    const b = parseCidr('192.168.1.0/24')
    expect(reservedAddresses(b)).toEqual(['192.168.1.0', '192.168.1.1', '192.168.1.2', '192.168.1.3', '192.168.1.255'])
    expect(usableCount(b)).toBe(251)
    expect(usableCount(parseCidr('10.0.0.0/29'))).toBe(3)
  })
})

describe('N-A2/A3 — subnets', () => {
  const { state, vnetId, webSubnetId } = networkState()
  it('/29 is the smallest, /30 is refused', () => {
    expect(op.addSubnet(state, { vnetId, name: 'tiny', addressPrefix: '10.0.2.0/29' }).ok).toBe(true)
    expectRefused(op.addSubnet(state, { vnetId, name: 'too-small', addressPrefix: '10.0.2.0/30' }), OUTCOME.SUBNET_SIZE, 'A2')
  })
  it('must sit inside the VNet address space', () => {
    expectRefused(op.addSubnet(state, { vnetId, name: 'out', addressPrefix: '10.1.0.0/24' }), OUTCOME.SUBNET_OUTSIDE_VNET, 'A3')
  })
  it('must not overlap another subnet', () => {
    expectRefused(op.addSubnet(state, { vnetId, name: 'clash', addressPrefix: '10.0.1.128/25' }), OUTCOME.SUBNET_OVERLAP, 'A3')
  })
  it('must be written as a network address', () => {
    expectRefused(op.addSubnet(state, { vnetId, name: 'sloppy', addressPrefix: '10.0.2.5/24' }), OUTCOME.ADDRESS_INVALID, 'A3')
  })
  it('can be resized only while empty', () => {
    expect(op.resizeSubnet(state, { subnetId: webSubnetId, addressPrefix: '10.0.1.0/25' }).ok).toBe(true)
    const withNic = must(op.createNetworkInterface(state, { ...at(), name: 'nic-1', subnetId: webSubnetId })).state
    expectRefused(op.resizeSubnet(withNic, { subnetId: webSubnetId, addressPrefix: '10.0.1.0/25' }), OUTCOME.SUBNET_IN_USE, 'A3')
  })
})

describe('N-A3a / B1 — address space', () => {
  const s = baseState()
  it.each([['224.0.0.0/4'], ['127.0.0.0/8'], ['169.254.0.0/16'], ['168.63.129.0/24']])('refuses %s', p => {
    expectRefused(op.createVirtualNetwork(s, { ...at(), name: 'vnet-bad', addressPrefixes: [p] }), OUTCOME.ADDRESS_RANGE_BLOCKED, 'A3a')
  })
  it('RFC 1918 and RFC 6598 are fine without warnings; other space is allowed with a warning', () => {
    expect(must(op.createVirtualNetwork(s, { ...at(), name: 'vnet-cgnat', addressPrefixes: ['100.64.0.0/16'] })).warnings).toEqual([])
    const r = must(op.createVirtualNetwork(s, { ...at(), name: 'vnet-public', addressPrefixes: ['20.0.0.0/16'] }))
    expect(r.warnings.map(w => w.ruleId)).toEqual(['A3a'])
  })
  it('B1: every new subnet is private — default outbound access off', () => {
    const { state, vnetId } = networkState()
    expect(state.resources[vnetId].properties.subnets[0].defaultOutboundAccess).toBe(false)
  })
})

describe('N-C — network security groups', () => {
  const s = baseState()
  const rule = (o = {}) => ({ name: 'allow-https', priority: 200, direction: 'Inbound', access: 'Allow', protocol: 'TCP', destinationPorts: '443', ...o })
  it('priority must be 100–4096', () => {
    for (const p of [99, 4097, 65000])
      expectRefused(op.createNetworkSecurityGroup(s, { ...at(), name: 'nsg', securityRules: [rule({ priority: p })] }), OUTCOME.INVALID_VALUE, 'C1')
  })
  it('two rules can\'t share a priority in the same direction — the other direction is fine', () => {
    const rules = [rule(), rule({ name: 'allow-ssh', destinationPorts: '22' })]
    expectRefused(op.createNetworkSecurityGroup(s, { ...at(), name: 'nsg', securityRules: rules }), OUTCOME.INVALID_VALUE, 'C2')
    const ok = [rule(), rule({ name: 'out-https', direction: 'Outbound' })]
    expect(op.createNetworkSecurityGroup(s, { ...at(), name: 'nsg', securityRules: ok }).ok).toBe(true)
  })
  it('ports and unsupported service tags are checked', () => {
    expectRefused(op.createNetworkSecurityGroup(s, { ...at(), name: 'nsg', securityRules: [rule({ destinationPorts: '70000' })] }), OUTCOME.INVALID_VALUE, null)
    expectRefused(op.createNetworkSecurityGroup(s, { ...at(), name: 'nsg', securityRules: [rule({ source: 'Storage' })] }), OUTCOME.NOT_MODELLED, null)
    expect(op.createNetworkSecurityGroup(s, { ...at(), name: 'nsg', securityRules: [rule({ source: 'Internet', destinationPorts: '80,443,8000-8080' })] }).ok).toBe(true)
  })
  it('C2: the six default rules, with the names exactly as Microsoft prints them', () => {
    expect(DEFAULT_SECURITY_RULES.map(r => `${r.direction} ${r.priority} ${r.name} ${r.access}`)).toEqual([
      'Inbound 65000 AllowVNetInBound Allow',
      'Inbound 65001 AllowAzureLoadBalancerInBound Allow',
      'Inbound 65500 DenyAllInbound Deny',
      'Outbound 65000 AllowVnetOutBound Allow',
      'Outbound 65001 AllowInternetOutBound Allow',
      'Outbound 65500 DenyAllOutBound Deny',
    ])
    expect(Object.isFrozen(DEFAULT_SECURITY_RULES)).toBe(true)
  })
  it('associates with a subnet or a NIC in the same region; another region is not modelled', () => {
    const { state, webSubnetId } = networkState()
    let t = must(op.createNetworkSecurityGroup(state, { ...at(), name: 'nsg-web' })).state
    const nsgId = Object.keys(t.resources).find(id => id.endsWith('/nsg-web'))
    t = must(op.associateNetworkSecurityGroup(t, { nsgId, targetId: webSubnetId })).state
    expect(t.resources[webSubnetId.split('/subnets/')[0]].properties.subnets[0].networkSecurityGroupId).toBe(nsgId)
    const far = must(op.createNetworkSecurityGroup(state, { ...at('rg-app', SUB_A, 'eastus'), name: 'nsg-far' }))
    expectRefused(op.associateNetworkSecurityGroup(far.state, { nsgId: far.id, targetId: webSubnetId }), OUTCOME.NOT_MODELLED, null)
  })
})

describe('N-L2/L3 — network interfaces', () => {
  const { state, webSubnetId } = networkState()
  it('dynamic allocation hands out .4, then .5 — never a reserved address', () => {
    const a = must(op.createNetworkInterface(state, { ...at(), name: 'nic-a', subnetId: webSubnetId }))
    const b = must(op.createNetworkInterface(a.state, { ...at(), name: 'nic-b', subnetId: webSubnetId }))
    expect(a.state.resources[a.id].properties.privateIpAddress).toBe('10.0.1.4')
    expect(b.state.resources[b.id].properties.privateIpAddress).toBe('10.0.1.5')
  })
  it('a static address must be inside the subnet, not reserved, not taken', () => {
    const nic = (ip, name = 'nic-s') => op.createNetworkInterface(state, { ...at(), name, subnetId: webSubnetId, privateIpAllocation: 'Static', privateIpAddress: ip })
    expectRefused(nic('10.0.2.10'), OUTCOME.ADDRESS_INVALID, 'L3')
    expectRefused(nic('10.0.1.1'), OUTCOME.ADDRESS_RESERVED, 'A1')
    expectRefused(nic('10.0.1.255'), OUTCOME.ADDRESS_RESERVED, 'A1')
    const t = must(nic('10.0.1.10')).state
    expectRefused(op.createNetworkInterface(t, { ...at(), name: 'nic-t', subnetId: webSubnetId, privateIpAllocation: 'Static', privateIpAddress: '10.0.1.10' }), OUTCOME.ADDRESS_IN_USE, 'L3')
  })
  it('the VNet must be in the same region and subscription as the NIC', () => {
    expectRefused(op.createNetworkInterface(state, { ...at('rg-app', SUB_A, 'northeurope'), name: 'nic-ne', subnetId: webSubnetId }), OUTCOME.REGION_MISMATCH, 'L2')
    expectRefused(op.createNetworkInterface(state, { ...at('rg-dev', SUB_B), name: 'nic-b', subnetId: webSubnetId }), OUTCOME.SUBSCRIPTION_MISMATCH, 'L2')
  })
  it('the NIC may live in a different resource group from its VNet (H2)', () => {
    const t = must(op.createResourceGroup(state, { subscriptionId: SUB_A, name: 'rg-compute', location: 'westeurope' })).state
    expect(op.createNetworkInterface(t, { ...at('rg-compute'), name: 'nic-x', subnetId: webSubnetId }).ok).toBe(true)
  })
  it('L5: IP forwarding is off by default', () => {
    const r = must(op.createNetworkInterface(state, { ...at(), name: 'nic-f', subnetId: webSubnetId }))
    expect(r.state.resources[r.id].properties.ipForwarding).toBe(false)
  })
})

describe('N-N — public IP addresses', () => {
  const s = baseState()
  it('N1: Basic is retired', () => {
    expectRefused(op.createPublicIp(s, { ...at(), name: 'pip', sku: 'Basic' }), OUTCOME.RETIRED, 'N1')
  })
  it('N2: Standard is static only', () => {
    expectRefused(op.createPublicIp(s, { ...at(), name: 'pip', allocationMethod: 'Dynamic' }), OUTCOME.INVALID_VALUE, 'N2')
  })
  it('N3: Standard v2 is not offered', () => {
    expectRefused(op.createPublicIp(s, { ...at(), name: 'pip', sku: 'StandardV2' }), OUTCOME.INVALID_VALUE, 'N3')
  })
  it('addresses come from documentation space; N5 DNS labels are unique per region', () => {
    const r = must(op.createPublicIp(s, { ...at(), name: 'pip-web', domainNameLabel: 'contoso' }))
    const pip = r.state.resources[r.id].properties
    expect(pip.ipAddress.startsWith('198.51.100.')).toBe(true)
    expect(pip.fqdn).toBe('contoso.westeurope.cloudapp.azure.com')
    expectRefused(op.createPublicIp(r.state, { ...at(), name: 'pip-2', domainNameLabel: 'contoso' }), OUTCOME.NAME_NOT_UNIQUE, 'N5')
    expect(op.createPublicIp(r.state, { ...at('rg-app', SUB_A, 'eastus'), name: 'pip-3', domainNameLabel: 'contoso' }).ok).toBe(true)
  })
})
