/**
 * Detail panels for the network view (PHASE_1A step 5): what a selected subnet or resource
 * is, the facts that matter for its rules, and the changes that are possible on it. All
 * changes go through run(operation, args).
 */
import { useState } from 'react'
import * as op from '../azure/operations.js'
import {
  TYPES, DEFAULT_SECURITY_RULES, findSubnet, resourcesOfType, subnetId, usedAddressesInSubnet,
} from '../azure/model.js'
import { parseCidr, reservedAddresses, usableCount } from '../azure/cidr.js'
import { regionDisplayName } from '../azure/regions.js'
import { DISK_TYPES, STORAGE_KINDS, SECURITY_RULE_PROTOCOLS } from '../azure/catalog.js'
import { AzureItem } from './AzureIcon.jsx'
import { Field, Facts, Form, Select, DangerButton } from './formParts.jsx'
import { STORAGE_ACCESS, StorageAccessFields } from './NetworkForms.jsx'

const nameOf = (cloud, id) => (id && cloud.resources[id]?.name) || '—'

function NsgPicker({ cloud, subscriptionId, onPick, title }) {
  const nsgs = resourcesOfType(cloud, TYPES.NETWORK_SECURITY_GROUP).filter(n => n.subscriptionId === subscriptionId)
  const [nsg, setNsg] = useState('')
  const value = nsgs.some(n => n.id === nsg) ? nsg : (nsgs[0]?.id ?? '')
  if (!nsgs.length) return <p className="mv-note">No network security groups in this subscription yet.</p>
  return (
    <Form title={title} submit="Associate" onSubmit={() => onPick(value)}>
      <Field label="Network security group" hint="One NSG per subnet and per NIC.">
        <Select value={value} onChange={setNsg} options={nsgs.map(n => [n.id, `${n.name} — ${regionDisplayName(n.location)}`])} />
      </Field>
    </Form>
  )
}

function SubnetDetails({ cloud, id, run }) {
  const { vnet, subnet } = findSubnet(cloud, id)
  const block = parseCidr(subnet.addressPrefix)
  const used = usedAddressesInSubnet(cloud, id)
  const [prefix, setPrefix] = useState(subnet.addressPrefix)
  return (
    <>
      <AzureItem kind="subnet" label={`${vnet.name} / ${subnet.name}`} size={32} />
      <Facts rows={[
        ['Address range', subnet.addressPrefix, true],
        ['Usable addresses', `${usableCount(block)} (2^${32 - block.prefix} − 5) — ${used.length} in use`],
        ['Reserved by Azure', reservedAddresses(block).join(', '), true],
        ['Default outbound access', 'Off — a private subnet (new virtual networks default to private subnets)'],
        ['Network security group', nameOf(cloud, subnet.networkSecurityGroupId)],
      ]} />
      <p className="mv-note">
        The first four addresses and the last one are Azure's: network address, default gateway (.1), two for
        Azure DNS (.2, .3) and broadcast. A /24 therefore gives 251 usable addresses, not 254.
      </p>
      <NsgPicker cloud={cloud} subscriptionId={vnet.subscriptionId} title="Associate a network security group"
        onPick={nsgId => run(op.associateNetworkSecurityGroup, { nsgId, targetId: id })} />
      <Form title="Resize the subnet" submit="Resize" onSubmit={() => run(op.resizeSubnet, { subnetId: id, addressPrefix: prefix.trim() })}>
        <Field label="Address range" hint="Only possible while nothing is deployed in the subnet.">
          <input className="mono" value={prefix} onChange={e => setPrefix(e.target.value)} />
        </Field>
      </Form>
    </>
  )
}

function VirtualNetworkDetails({ cloud, r, run, select }) {
  const [name, setName] = useState('')
  const [prefix, setPrefix] = useState('')
  return (
    <>
      <AzureItem kind={r.type} label={r.name} size={32} />
      <Facts rows={[
        ['Address space', r.properties.addressPrefixes.join(', '), true],
        ['Region', `${regionDisplayName(r.location)} — a virtual network lives in one region`],
        ['Subnets', r.properties.subnets.length],
        ['Resource ID', r.id, true],
      ]} />
      <Form title="Add a subnet" submit="Add subnet"
        onSubmit={() => run(op.addSubnet, { vnetId: r.id, name: name.trim(), addressPrefix: prefix.trim() },
          () => { setName(''); setPrefix(''); select({ kind: 'subnet', id: subnetId(r.id, name.trim()) }) })}>
        <Field label="Subnet name"><input className="mono" value={name} onChange={e => setName(e.target.value)} placeholder="app" /></Field>
        <Field label="Address range" hint="Inside the address space, not overlapping another subnet, /29 to /2.">
          <input className="mono" value={prefix} onChange={e => setPrefix(e.target.value)} placeholder="10.0.2.0/24" />
        </Field>
      </Form>
      <DangerButton label="Delete virtual network" confirm={`Delete ${r.name}?`} onConfirm={() => run(op.deleteResource, { id: r.id }, () => select(null))} />
    </>
  )
}

function RuleTable({ rules, caption }) {
  return (
    <div className="nv-table-wrap">
    <table className="nv-rules">
      <caption>{caption}</caption>
      <thead><tr><th>Priority</th><th>Name</th><th>Direction</th><th>Protocol</th><th>Source</th><th>Destination</th><th>Ports</th><th>Action</th></tr></thead>
      <tbody>
        {rules.map(x => (
          <tr key={`${x.direction}-${x.priority}`}>
            <td className="mono">{x.priority}</td><td className="mono">{x.name}</td><td>{x.direction}</td><td>{x.protocol}</td>
            <td className="mono">{x.source}</td><td className="mono">{x.destination}</td><td className="mono">{x.destinationPorts}</td>
            <td><i className={`led ${x.access === 'Allow' ? 'green' : 'red'}`} /> {x.access}</td>
          </tr>
        ))}
      </tbody>
    </table>
    </div>
  )
}

function NetworkSecurityGroupDetails({ cloud, r, run, select }) {
  const [rule, setRule] = useState({ name: '', priority: '100', direction: 'Inbound', access: 'Allow', protocol: 'TCP', source: '*', destination: '*', destinationPorts: '443' })
  const set = k => v => setRule(x => ({ ...x, [k]: v }))
  const targets = [
    ...resourcesOfType(cloud, TYPES.VIRTUAL_NETWORK).filter(v => v.subscriptionId === r.subscriptionId)
      .flatMap(v => v.properties.subnets.map(s => [subnetId(v.id, s.name), `Subnet ${v.name} / ${s.name}`])),
    ...resourcesOfType(cloud, TYPES.NETWORK_INTERFACE).filter(n => n.subscriptionId === r.subscriptionId).map(n => [n.id, `NIC ${n.name}`]),
  ]
  const [target, setTarget] = useState('')
  const targetValue = targets.some(([id]) => id === target) ? target : (targets[0]?.[0] ?? '')
  const sorted = [...r.properties.securityRules].sort((a, b) => a.direction.localeCompare(b.direction) || a.priority - b.priority)
  return (
    <>
      <AzureItem kind={r.type} label={r.name} size={32} />
      <Facts rows={[['Region', regionDisplayName(r.location)], ['Resource ID', r.id, true]]} />
      <p className="mv-note">
        Rules are checked lowest priority number first, and the first match decides. The simulator stores and shows the
        rules now; evaluating real traffic against them arrives in a later preview step.
      </p>
      <RuleTable rules={sorted} caption={sorted.length ? 'Your rules' : 'Your rules — none yet'} />
      <RuleTable rules={DEFAULT_SECURITY_RULES} caption="Default rules — created by Azure in every NSG; they can't be removed, only overridden" />
      <Form title="Add a security rule" submit="Add rule" onSubmit={() => run(op.addSecurityRule, {
        nsgId: r.id, rule: { ...rule, name: rule.name.trim(), priority: Number(rule.priority) },
      })}>
        <div className="nv-grid">
          <Field label="Name"><input className="mono" value={rule.name} onChange={e => set('name')(e.target.value)} placeholder="Allow-HTTPS" /></Field>
          <Field label="Priority" hint="100–4096"><input className="mono" value={rule.priority} onChange={e => set('priority')(e.target.value)} /></Field>
          <Field label="Direction"><Select value={rule.direction} onChange={set('direction')} options={[['Inbound', 'Inbound'], ['Outbound', 'Outbound']]} /></Field>
          <Field label="Action"><Select value={rule.access} onChange={set('access')} options={[['Allow', 'Allow'], ['Deny', 'Deny']]} /></Field>
          <Field label="Protocol"><Select value={rule.protocol} onChange={set('protocol')} options={SECURITY_RULE_PROTOCOLS.map(p => [p, p])} /></Field>
          <Field label="Destination ports" hint="e.g. 443, 80,443 or 8000-8080"><input className="mono" value={rule.destinationPorts} onChange={e => set('destinationPorts')(e.target.value)} /></Field>
          <Field label="Source" hint="Any (*), an IP, a CIDR, or VirtualNetwork / Internet / AzureLoadBalancer"><input className="mono" value={rule.source} onChange={e => set('source')(e.target.value)} /></Field>
          <Field label="Destination"><input className="mono" value={rule.destination} onChange={e => set('destination')(e.target.value)} /></Field>
        </div>
      </Form>
      {targets.length > 0 && (
        <Form title="Associate with a subnet or NIC" submit="Associate" onSubmit={() => run(op.associateNetworkSecurityGroup, { nsgId: r.id, targetId: targetValue })}>
          <Field label="Subnet or network interface"><Select value={targetValue} onChange={setTarget} options={targets} /></Field>
        </Form>
      )}
      <DangerButton label="Delete network security group" confirm={`Delete ${r.name}?`} onConfirm={() => run(op.deleteResource, { id: r.id }, () => select(null))} />
    </>
  )
}

function NetworkInterfaceDetails({ cloud, r, run, select }) {
  const p = r.properties
  const { vnet, subnet } = findSubnet(cloud, p.subnetId)
  return (
    <>
      <AzureItem kind={r.type} label={r.name} size={32} />
      <Facts rows={[
        ['Private IP', `${p.privateIpAddress} (${p.privateIpAllocation})`, true],
        ['Subnet', `${vnet?.name} / ${subnet?.name} (${subnet?.addressPrefix})`],
        ['Attached to', p.virtualMachineId ? nameOf(cloud, p.virtualMachineId) : 'No virtual machine'],
        ['Public IP', p.publicIpId ? `${nameOf(cloud, p.publicIpId)} — ${cloud.resources[p.publicIpId]?.properties.ipAddress}` : 'None'],
        ['Network security group', nameOf(cloud, p.networkSecurityGroupId)],
        ['IP forwarding', p.ipForwarding ? 'Enabled' : 'Disabled (default)'],
        ['Region', regionDisplayName(r.location)],
        ['Resource ID', r.id, true],
      ]} />
      <p className="mv-note">The VM's operating system gets this address from Azure's DHCP. Setting a different address inside the OS cuts the VM off.</p>
      <NsgPicker cloud={cloud} subscriptionId={r.subscriptionId} title="Associate a network security group"
        onPick={nsgId => run(op.associateNetworkSecurityGroup, { nsgId, targetId: r.id })} />
      <DangerButton label="Delete network interface" confirm={`Delete ${r.name}?`} onConfirm={() => run(op.deleteResource, { id: r.id }, () => select(null))} />
    </>
  )
}

function VirtualMachineDetails({ cloud, r, run, select }) {
  const p = r.properties
  return (
    <>
      <AzureItem kind={r.type} label={r.name} size={32} />
      <Facts rows={[
        ['Operating system', p.osType],
        ['Size', p.size, true],
        ['OS disk', `${DISK_TYPES[p.osDisk.diskType].displayName}, ${p.osDisk.sizeGiB} GiB`],
        ['Network interfaces', p.networkInterfaceIds.map(id => `${nameOf(cloud, id)} (${cloud.resources[id]?.properties.privateIpAddress})`).join(', ')],
        ['Data disks', p.dataDiskIds.length ? p.dataDiskIds.map(id => nameOf(cloud, id)).join(', ') : 'None'],
        ['Region', regionDisplayName(r.location)],
        ['Resource ID', r.id, true],
      ]} />
      <DangerButton label="Delete virtual machine"
        confirm={`Delete ${r.name}? Its network interfaces and data disks are detached and kept.`}
        onConfirm={() => run(op.deleteResource, { id: r.id }, () => select(null))} />
    </>
  )
}

function PublicIpDetails({ cloud, r, run, select }) {
  const p = r.properties
  return (
    <>
      <AzureItem kind={r.type} label={r.name} size={32} />
      <Facts rows={[
        ['Address', p.ipAddress, true],
        ['SKU / assignment', `${p.sku} / ${p.allocationMethod}`],
        ['DNS name', p.fqdn ?? 'None', true],
        ['Associated with', p.ipConfigurationId ? nameOf(cloud, p.ipConfigurationId) : 'Nothing'],
        ['Region', regionDisplayName(r.location)],
      ]} />
      <p className="mv-note">
        The simulator hands out addresses from 198.51.100.0/24, a documentation range — never a real Azure address. A
        Standard public IP is closed to inbound traffic until an NSG allows it.
      </p>
      <DangerButton label="Delete public IP address" confirm={`Delete ${r.name}?`} onConfirm={() => run(op.deleteResource, { id: r.id }, () => select(null))} />
    </>
  )
}

function DiskDetails({ cloud, r, run, select }) {
  const p = r.properties
  return (
    <>
      <AzureItem kind={r.type} label={r.name} size={32} />
      <Facts rows={[
        ['Type', `${DISK_TYPES[p.diskType].displayName}${DISK_TYPES[p.diskType].osCapable ? '' : ' — data disks only'}`],
        ['Redundancy', p.redundancy],
        ['Size', `${p.sizeGiB} GiB`],
        ['Attached to', p.managedBy ? nameOf(cloud, p.managedBy) : 'Nothing'],
        ['Region', regionDisplayName(r.location)],
      ]} />
      <DangerButton label="Delete disk" confirm={`Delete ${r.name}?`} onConfirm={() => run(op.deleteResource, { id: r.id }, () => select(null))} />
    </>
  )
}

function StorageAccountDetails({ cloud, r, run, select }) {
  const p = r.properties
  const current = p.publicNetworkAccess === 'Disabled' ? 'disabled' : p.networkAcls.defaultAction === 'Deny' ? 'selected' : 'all'
  const [access, setAccess] = useState(current)
  return (
    <>
      <AzureItem kind={r.type} label={r.name} size={32} />
      <Facts rows={[
        ['Account type', `${STORAGE_KINDS[p.kind].displayName} (${p.performance})`],
        ['Redundancy', p.redundancy],
        ['Public network access', STORAGE_ACCESS[current].label],
        ['Blob endpoint', p.primaryEndpoints.blob, true],
        ['File endpoint', p.primaryEndpoints.file, true],
        ['Region', regionDisplayName(r.location)],
        ['Resource ID', r.id, true],
      ]} />
      {/* What the current setting means (M4). Private endpoints and VNet/IP rules come in a later phase. */}
      <p className="mv-note">
        A storage account isn&apos;t inside a virtual network.{' '}
        {current === 'all' && 'Clients on any network can reach its public endpoints.'}
        {current === 'selected' && 'Only the virtual networks and IP addresses you allow can use its public endpoints; requests from anywhere else get a 403 error. Adding those network rules isn\'t built in this preview yet, so nothing is allowed.'}
        {current === 'disabled' && 'Its public endpoints accept no traffic: it can only be reached through a private endpoint, which you create separately.'}
        {' '}Private endpoints and private DNS come in a later part of the cloud track.
      </p>
      <Form title="Networking" submit="Save" onSubmit={() => run(op.updateStorageAccount, {
        id: r.id, publicNetworkAccess: STORAGE_ACCESS[access].publicNetworkAccess, defaultAction: STORAGE_ACCESS[access].defaultAction,
      })}>
        <StorageAccessFields value={access} onChange={setAccess} />
      </Form>
      <DangerButton label="Delete storage account" confirm={`Delete ${r.name}?`} onConfirm={() => run(op.deleteResource, { id: r.id }, () => select(null))} />
    </>
  )
}

const PANELS = {
  [TYPES.VIRTUAL_NETWORK]: VirtualNetworkDetails,
  [TYPES.NETWORK_SECURITY_GROUP]: NetworkSecurityGroupDetails,
  [TYPES.NETWORK_INTERFACE]: NetworkInterfaceDetails,
  [TYPES.VIRTUAL_MACHINE]: VirtualMachineDetails,
  [TYPES.PUBLIC_IP]: PublicIpDetails,
  [TYPES.DISK]: DiskDetails,
  [TYPES.STORAGE_ACCOUNT]: StorageAccountDetails,
}

/** sel: { kind: 'subnet', id } or { kind: 'res', id } — must exist in cloud (the view checks). */
export function NetworkDetails({ cloud, sel, run, select }) {
  if (sel.kind === 'subnet') return <SubnetDetails key={sel.id} cloud={cloud} id={sel.id} run={run} />
  const r = cloud.resources[sel.id]
  const Panel = PANELS[r.type]
  return <Panel key={sel.id} cloud={cloud} r={r} run={run} select={select} />
}

