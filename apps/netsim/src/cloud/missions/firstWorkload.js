/**
 * Cloud mission 2 — First workload (AZURE_ACCURACY §A, §B, §C, §K, §L, §N).
 *
 * Deploy an internal web VM in West Europe: resource group, virtual network with a /24
 * subnet (251 usable — A1), an NSG that allows HTTPS on that subnet, and a Linux VM with no
 * public IP. The trap: another team's network already exists in North Europe; a VM in West
 * Europe can't use it (L2).
 */
import { createCloudState, TYPES, subnetId } from '../model.js'
import * as op from '../operations.js'
import { resourceGroupIs, resourceAt, subnetOf, allowsInbound } from './conditions.js'

const TENANT = '9b4e2c71-6d3a-4f80-a5c2-7e1d9b3f4a62'
export const SUB = 'd2a8f5c3-9e1b-4c7d-8f2a-4b6e0d9c3a71'
const RG = 'rg-web-prod'

function must(r) { if (!r.ok) throw new Error(`mission setup failed: ${r.message}`); return r.state }

const vnet = t => resourceAt(t, SUB, RG, TYPES.VIRTUAL_NETWORK, 'vnet-web-prod')
const webSubnetId = t => vnet(t) && subnetId(vnet(t).id, 'snet-web')
const vm = t => resourceAt(t, SUB, RG, TYPES.VIRTUAL_MACHINE, 'vm-web-01')
const vmNics = t => (vm(t)?.properties.networkInterfaceIds ?? []).map(id => t.resources[id]).filter(Boolean)

export const firstWorkloadMission = {
  id: 'cloud_first_workload',
  title: 'First workload',
  client: 'Contoso Ltd',
  summary: 'Deploy an internal web server in West Europe with its own network and firewall rules.',
  brief: [
    'Contoso\'s intranet web server is moving to Azure, in West Europe. Users reach it over HTTPS from the corporate '
      + 'network; it must never be reachable straight from the internet.',
    'Use the "Contoso Corp Production" subscription and these names: resource group rg-web-prod, virtual network '
      + 'vnet-web-prod (10.10.0.0/16) with subnet snet-web (10.10.1.0/24), NSG nsg-snet-web, and a Linux VM vm-web-01.',
    'Note: the networking team already runs vnet-hub-neu in North Europe for other projects. Leave it alone.',
  ],
  objectives: [
    { id: 'rg', text: 'Create resource group rg-web-prod in West Europe.',
      hint: 'Management tab → select the subscription → "Create a resource group".',
      check: t => resourceGroupIs(t, SUB, RG, 'westeurope') },
    { id: 'vnet', text: 'Create vnet-web-prod (10.10.0.0/16, West Europe) with subnet snet-web 10.10.1.0/24.',
      hint: 'Network tab → Create a resource → Virtual network. A /24 leaves 251 usable addresses after Azure\'s five.',
      check: t => {
        const v = vnet(t)
        return !!v && v.location === 'westeurope' && v.properties.addressPrefixes.includes('10.10.0.0/16')
          && subnetOf(v, 'snet-web')?.addressPrefix === '10.10.1.0/24'
      } },
    { id: 'nsg', text: 'Create nsg-snet-web with an inbound rule that allows TCP 443, and associate it with snet-web.',
      hint: 'Create the NSG, open it, "Add a security rule" (Inbound, Allow, TCP, port 443), then associate it with the subnet.',
      check: t => {
        const nsg = resourceAt(t, SUB, RG, TYPES.NETWORK_SECURITY_GROUP, 'nsg-snet-web')
        return allowsInbound(nsg, 443) && subnetOf(vnet(t), 'snet-web')?.networkSecurityGroupId === nsg.id
      } },
    { id: 'vm', text: 'Create Linux VM vm-web-01 in West Europe, in subnet snet-web.',
      hint: 'Create a resource → Virtual machine. Pick a Linux image and snet-web on the Networking step.',
      check: t => {
        const v = vm(t)
        return !!v && v.location === 'westeurope' && v.properties.osType === 'Linux'
          && vmNics(t).some(n => n.properties.subnetId === webSubnetId(t))
      } },
    { id: 'no-public-ip', text: 'vm-web-01 has no public IP address.',
      hint: 'On the VM\'s Networking step, set Public IP to "None". A public IP can\'t be removed from this preview\'s VM — recreate it if needed.',
      check: t => !!vm(t) && vmNics(t).length > 0 && vmNics(t).every(n => !n.properties.publicIpId) },
  ],
  learn: ['A1', 'A3', 'B1', 'C1', 'K1', 'L2', 'N2'],
  debrief: [
    'Azure keeps five addresses of every subnet, so snet-web has 251 usable addresses, not 254.',
    'A VM, its network interface and its virtual network must share a region — that\'s why vnet-hub-neu was no use here.',
    'New subnets are private: without a public IP or NAT gateway the VM has no default way out to the internet.',
    'The NSG on the subnet allows HTTPS in; every other inbound flow from outside the VNet meets DenyAllInbound.',
  ],
  setup() {
    let s = createCloudState({ tenantId: TENANT })
    s = must(op.addSubscription(s, { id: SUB, displayName: 'Contoso Corp Production' }))
    s = must(op.createResourceGroup(s, { subscriptionId: SUB, name: 'rg-network-neu', location: 'northeurope' }))
    s = must(op.createVirtualNetwork(s, {
      subscriptionId: SUB, resourceGroup: 'rg-network-neu', location: 'northeurope', name: 'vnet-hub-neu',
      addressPrefixes: ['10.20.0.0/16'], subnets: [{ name: 'snet-shared', addressPrefix: '10.20.1.0/24' }],
    }))
    return s
  },
}
