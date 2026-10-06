/**
 * "Create a resource" forms for the network view (PHASE_1A step 5). Each form only
 * collects input and calls run(operation, args) — the validator in src/cloud/operations.js
 * decides, and refusals come back with their rule. Option lists mirror what Azure offers
 * (src/cloud/catalog.js): e.g. the OS-disk list leaves out Ultra Disk and Premium SSD v2 (L7).
 */
import { useState } from 'react'
import * as op from '../../cloud/operations.js'
import { TYPES, resourcesOfType, subnetId } from '../../cloud/model.js'
import { REGIONS, regionDisplayName } from '../../cloud/regions.js'
import { DISK_TYPES, VM_SIZES, OS_TYPES, STORAGE_KINDS } from '../../cloud/catalog.js'
import { Field, Form, Select } from './formParts.jsx'

export const CREATE_KINDS = [
  [TYPES.VIRTUAL_NETWORK, 'Virtual network'],
  [TYPES.NETWORK_SECURITY_GROUP, 'Network security group'],
  [TYPES.PUBLIC_IP, 'Public IP address'],
  [TYPES.NETWORK_INTERFACE, 'Network interface'],
  [TYPES.VIRTUAL_MACHINE, 'Virtual machine'],
  [TYPES.DISK, 'Managed disk'],
  [TYPES.STORAGE_ACCOUNT, 'Storage account'],
]

// Portal "Networking" choices for a storage account (M4) → the two settings behind them.
export const STORAGE_ACCESS = {
  all:      { label: 'Enabled from all networks', publicNetworkAccess: 'Enabled', defaultAction: 'Allow' },
  selected: { label: 'Enabled from selected networks', publicNetworkAccess: 'Enabled', defaultAction: 'Deny' },
  disabled: { label: 'Disabled', publicNetworkAccess: 'Disabled', defaultAction: 'Allow' },
}

const inSub = (cloud, subscriptionId, type) => resourcesOfType(cloud, type).filter(r => r.subscriptionId === subscriptionId)

/** Resource group + region pickers; picking a group pre-selects its region (which may still be changed — J2). */
function Placement({ cloud, subscriptionId, value, onChange }) {
  const groups = Object.values(cloud.resourceGroups).filter(g => g.subscriptionId === subscriptionId)
  return (
    <>
      <Field label="Resource group">
        <Select value={value.resourceGroup} options={groups.map(g => [g.name, g.name])}
          onChange={name => onChange({ ...value, resourceGroup: name, location: groups.find(g => g.name === name)?.location ?? value.location })} />
      </Field>
      <Field label="Region" hint="A resource can be in a different region from its resource group.">
        <Select value={value.location} options={REGIONS.map(r => [r.name, r.displayName])}
          onChange={location => onChange({ ...value, location })} />
      </Field>
    </>
  )
}

/** The picked group falls back to the first one (derived), so the picker and the submitted value always agree. */
function usePlacement(cloud, subscriptionId) {
  const groups = Object.values(cloud.resourceGroups).filter(g => g.subscriptionId === subscriptionId)
  const [place, setPlace] = useState({ resourceGroup: '', location: null })
  const resourceGroup = groups.some(g => g.name === place.resourceGroup) ? place.resourceGroup : (groups[0]?.name ?? '')
  const location = place.location ?? groups.find(g => g.name === resourceGroup)?.location ?? REGIONS[0].name
  return [{ subscriptionId, resourceGroup, location }, ({ resourceGroup: g, location: l }) => setPlace({ resourceGroup: g, location: l })]
}

function VirtualNetworkForm({ cloud, subscriptionId, run }) {
  const [place, setPlace] = usePlacement(cloud, subscriptionId)
  const [name, setName] = useState('')
  const [space, setSpace] = useState('10.0.0.0/16')
  const [snName, setSnName] = useState('default')
  const [snPrefix, setSnPrefix] = useState('10.0.0.0/24')
  return (
    <Form submit="Create virtual network" onSubmit={() => run(op.createVirtualNetwork, {
      ...place, name: name.trim(),
      addressPrefixes: space.split(',').map(s => s.trim()).filter(Boolean),
      subnets: snName.trim() ? [{ name: snName.trim(), addressPrefix: snPrefix.trim() }] : [],
    })}>
      <Placement cloud={cloud} subscriptionId={subscriptionId} value={place} onChange={setPlace} />
      <Field label="Name" hint="2–64 characters."><input className="mono" value={name} onChange={e => setName(e.target.value)} placeholder="vnet-app-weu" /></Field>
      <Field label="Address space" hint="CIDR block(s), comma-separated. RFC 1918 private space is recommended.">
        <input className="mono" value={space} onChange={e => setSpace(e.target.value)} />
      </Field>
      <Field label="First subnet name" hint="Leave empty to add subnets later."><input className="mono" value={snName} onChange={e => setSnName(e.target.value)} /></Field>
      <Field label="First subnet address range" hint="Between /29 and /2, inside the address space. Azure keeps 5 addresses of every subnet.">
        <input className="mono" value={snPrefix} onChange={e => setSnPrefix(e.target.value)} />
      </Field>
    </Form>
  )
}

function NetworkSecurityGroupForm({ cloud, subscriptionId, run }) {
  const [place, setPlace] = usePlacement(cloud, subscriptionId)
  const [name, setName] = useState('')
  return (
    <Form submit="Create network security group" onSubmit={() => run(op.createNetworkSecurityGroup, { ...place, name: name.trim() })}>
      <Placement cloud={cloud} subscriptionId={subscriptionId} value={place} onChange={setPlace} />
      <Field label="Name"><input className="mono" value={name} onChange={e => setName(e.target.value)} placeholder="nsg-web" /></Field>
      <p className="mv-note">Every NSG starts with Azure's six default rules. Add your own rules after it's created.</p>
    </Form>
  )
}

function PublicIpForm({ cloud, subscriptionId, run }) {
  const [place, setPlace] = usePlacement(cloud, subscriptionId)
  const [name, setName] = useState('')
  const [label, setLabel] = useState('')
  return (
    <Form submit="Create public IP address" onSubmit={() => run(op.createPublicIp, { ...place, name: name.trim(), domainNameLabel: label.trim() || null })}>
      <Placement cloud={cloud} subscriptionId={subscriptionId} value={place} onChange={setPlace} />
      <Field label="Name"><input className="mono" value={name} onChange={e => setName(e.target.value)} placeholder="pip-web" /></Field>
      <Field label="SKU" hint="Basic public IPs were retired on September 30, 2025.">
        <input value="Standard — static, closed to inbound traffic until an NSG allows it" readOnly />
      </Field>
      <Field label="DNS name label (optional)" hint="Gives <label>.<region>.cloudapp.azure.com; unique within the region.">
        <input className="mono" value={label} onChange={e => setLabel(e.target.value)} />
      </Field>
    </Form>
  )
}

function NetworkInterfaceForm({ cloud, subscriptionId, run }) {
  const [place, setPlace] = usePlacement(cloud, subscriptionId)
  const subnets = inSub(cloud, subscriptionId, TYPES.VIRTUAL_NETWORK).flatMap(v =>
    v.properties.subnets.map(s => [subnetId(v.id, s.name), `${v.name} / ${s.name} (${s.addressPrefix}) — ${regionDisplayName(v.location)}`]))
  const pips = inSub(cloud, subscriptionId, TYPES.PUBLIC_IP).filter(p => !p.properties.ipConfigurationId)
  const nsgs = inSub(cloud, subscriptionId, TYPES.NETWORK_SECURITY_GROUP)
  const [name, setName] = useState('')
  const [picked, setSn] = useState('')
  // Derived, not stored: if nothing (or a vanished subnet) is picked, the first subnet is the choice —
  // so the dropdown and the submitted value never disagree, even when subnets appear after mounting.
  const sn = subnets.some(([id]) => id === picked) ? picked : (subnets[0]?.[0] ?? '')
  const [alloc, setAlloc] = useState('Dynamic')
  const [ip, setIp] = useState('')
  const [pip, setPip] = useState('')
  const [nsg, setNsg] = useState('')
  return (
    <Form submit="Create network interface" onSubmit={() => run(op.createNetworkInterface, {
      ...place, name: name.trim(), subnetId: sn, privateIpAllocation: alloc,
      privateIpAddress: alloc === 'Static' ? ip.trim() : null, publicIpId: pip || null, networkSecurityGroupId: nsg || null,
    })}>
      <Placement cloud={cloud} subscriptionId={subscriptionId} value={place} onChange={setPlace} />
      <Field label="Name"><input className="mono" value={name} onChange={e => setName(e.target.value)} placeholder="nic-web-01" /></Field>
      <Field label="Virtual network / subnet" hint="Must be in the same region and subscription as the NIC.">
        <Select value={sn} onChange={setSn} options={subnets} empty={subnets.length ? undefined : 'No subnets yet — create a virtual network first'} />
      </Field>
      <Field label="Private IP assignment" hint="Azure's DHCP hands the address to the VM's operating system either way.">
        <Select value={alloc} onChange={setAlloc} options={[['Dynamic', 'Dynamic — next free address'], ['Static', 'Static — pick the address']]} />
      </Field>
      {alloc === 'Static' && (
        <Field label="Private IP address" hint="Not one of the five Azure reserves, and not already used.">
          <input className="mono" value={ip} onChange={e => setIp(e.target.value)} placeholder="10.0.0.10" />
        </Field>
      )}
      <Field label="Public IP address (optional)">
        <Select value={pip} onChange={setPip} empty="None" options={pips.map(p => [p.id, `${p.name} — ${p.properties.ipAddress}`])} />
      </Field>
      <Field label="Network security group (optional)">
        <Select value={nsg} onChange={setNsg} empty="None" options={nsgs.map(n => [n.id, n.name])} />
      </Field>
    </Form>
  )
}

function Checklist({ items, value, onChange, empty }) {
  if (!items.length) return <small className="mv-note">{empty}</small>
  return (
    <div className="nv-checklist">
      {items.map(([id, label]) => (
        <label key={id}>
          <input type="checkbox" checked={value.includes(id)}
            onChange={e => onChange(e.target.checked ? [...value, id] : value.filter(v => v !== id))} />
          <span className="mono">{label}</span>
        </label>
      ))}
    </div>
  )
}

function VirtualMachineForm({ cloud, subscriptionId, run }) {
  const [place, setPlace] = usePlacement(cloud, subscriptionId)
  const nics = inSub(cloud, subscriptionId, TYPES.NETWORK_INTERFACE).filter(n => !n.properties.virtualMachineId)
  const disks = inSub(cloud, subscriptionId, TYPES.DISK).filter(d => !d.properties.managedBy)
  const osDiskTypes = Object.entries(DISK_TYPES).filter(([, d]) => d.osCapable)
  const [name, setName] = useState('')
  const [os, setOs] = useState('Linux')
  const [size, setSize] = useState(VM_SIZES[1])
  const [osType, setOsType] = useState('PremiumSSD')
  const [osSize, setOsSize] = useState('128')
  const [nicIds, setNicIds] = useState([])
  const [diskIds, setDiskIds] = useState([])
  return (
    <Form submit="Create virtual machine" onSubmit={() => run(op.createVirtualMachine, {
      ...place, name: name.trim(), osType: os, size, osDisk: { diskType: osType, sizeGiB: Number(osSize) },
      networkInterfaceIds: nicIds, dataDiskIds: diskIds,
    })}>
      <Placement cloud={cloud} subscriptionId={subscriptionId} value={place} onChange={setPlace} />
      <Field label="Operating system" hint="Windows computer names stop at 15 characters; Linux allows 64.">
        <Select value={os} onChange={setOs} options={OS_TYPES.map(o => [o, o])} />
      </Field>
      <Field label="Virtual machine name"><input className="mono" value={name} onChange={e => setName(e.target.value)} placeholder="vm-web-01" /></Field>
      <Field label="Size" hint="A short list of real sizes; regional availability isn't modelled.">
        <Select value={size} onChange={setSize} options={VM_SIZES.map(s => [s, s])} />
      </Field>
      <Field label="OS disk type" hint="Ultra Disk and Premium SSD v2 can't be OS disks.">
        <Select value={osType} onChange={setOsType} options={osDiskTypes.map(([k, d]) => [k, d.displayName])} />
      </Field>
      <Field label="OS disk size (GiB)"><input className="mono" type="number" min="1" value={osSize} onChange={e => setOsSize(e.target.value)} /></Field>
      <Field label="Network interfaces" hint="At least one. Same region and subscription as the VM.">
        <Checklist items={nics.map(n => [n.id, `${n.name} — ${n.properties.privateIpAddress} (${regionDisplayName(n.location)})`])}
          value={nicIds} onChange={setNicIds} empty="No free network interfaces — create one first." />
      </Field>
      <Field label="Data disks (optional)">
        <Checklist items={disks.map(d => [d.id, `${d.name} — ${DISK_TYPES[d.properties.diskType].displayName}, ${d.properties.sizeGiB} GiB`])}
          value={diskIds} onChange={setDiskIds} empty="No unattached disks." />
      </Field>
    </Form>
  )
}

function DiskForm({ cloud, subscriptionId, run }) {
  const [place, setPlace] = usePlacement(cloud, subscriptionId)
  const [name, setName] = useState('')
  const [type, setType] = useState('PremiumSSD')
  const [red, setRed] = useState('LRS')
  const [size, setSize] = useState('128')
  return (
    <Form submit="Create managed disk" onSubmit={() => run(op.createDisk, { ...place, name: name.trim(), diskType: type, redundancy: red, sizeGiB: Number(size) })}>
      <Placement cloud={cloud} subscriptionId={subscriptionId} value={place} onChange={setPlace} />
      <Field label="Name"><input className="mono" value={name} onChange={e => setName(e.target.value)} placeholder="disk-data-01" /></Field>
      <Field label="Disk type"><Select value={type} onChange={setType} options={Object.entries(DISK_TYPES).map(([k, d]) => [k, d.displayName])} /></Field>
      <Field label="Redundancy" hint="Managed disks are locally (LRS) or zone-redundant (ZRS); Ultra Disk is LRS only.">
        <Select value={red} onChange={setRed} options={[['LRS', 'LRS'], ['ZRS', 'ZRS']]} />
      </Field>
      <Field label="Size (GiB)"><input className="mono" type="number" min="1" value={size} onChange={e => setSize(e.target.value)} /></Field>
    </Form>
  )
}

function StorageAccountForm({ cloud, subscriptionId, run }) {
  const [place, setPlace] = usePlacement(cloud, subscriptionId)
  const [name, setName] = useState('')
  const [kind, setKind] = useState('StorageV2')
  const [red, setRed] = useState('ZRS')
  const [access, setAccess] = useState('all')
  const options = STORAGE_KINDS[kind].redundancy
  return (
    <Form submit="Create storage account" onSubmit={() => run(op.createStorageAccount, {
      ...place, name: name.trim(), kind, redundancy: red,
      publicNetworkAccess: STORAGE_ACCESS[access].publicNetworkAccess, defaultAction: STORAGE_ACCESS[access].defaultAction,
    })}>
      <Placement cloud={cloud} subscriptionId={subscriptionId} value={place} onChange={setPlace} />
      <Field label="Storage account name" hint="3–24 lowercase letters and numbers, unique across all of Azure.">
        <input className="mono" value={name} onChange={e => setName(e.target.value)} placeholder="stappweu001" />
      </Field>
      <Field label="Account type" hint="Can't be changed after the account is created.">
        <Select value={kind} options={Object.entries(STORAGE_KINDS).map(([k, s]) => [k, s.displayName])}
          onChange={k => { setKind(k); if (!STORAGE_KINDS[k].redundancy.includes(red)) setRed(STORAGE_KINDS[k].redundancy[0]) }} />
      </Field>
      <Field label="Redundancy"><Select value={red} onChange={setRed} options={options.map(o => [o, o])} /></Field>
      <Field label="Public network access" hint="New accounts accept connections from any network unless you restrict them.">
        <Select value={access} onChange={setAccess} options={Object.entries(STORAGE_ACCESS).map(([k, a]) => [k, a.label])} />
      </Field>
    </Form>
  )
}

const FORMS = {
  [TYPES.VIRTUAL_NETWORK]: VirtualNetworkForm,
  [TYPES.NETWORK_SECURITY_GROUP]: NetworkSecurityGroupForm,
  [TYPES.PUBLIC_IP]: PublicIpForm,
  [TYPES.NETWORK_INTERFACE]: NetworkInterfaceForm,
  [TYPES.VIRTUAL_MACHINE]: VirtualMachineForm,
  [TYPES.DISK]: DiskForm,
  [TYPES.STORAGE_ACCOUNT]: StorageAccountForm,
}

export function CreatePanel({ cloud, subscriptionId, run, kind, onKind }) {
  const CreateForm = FORMS[kind]
  const hasGroup = Object.values(cloud.resourceGroups).some(g => g.subscriptionId === subscriptionId)
  return (
    <section className="nv-create">
      <h2>Create a resource</h2>
      <Field label="Resource type">
        <Select value={kind} onChange={onKind} options={CREATE_KINDS} />
      </Field>
      {hasGroup
        ? <CreateForm key={`${kind}:${subscriptionId}`} cloud={cloud} subscriptionId={subscriptionId} run={run} />
        : <p className="mv-note">This subscription has no resource group yet. Create one in the Management tab first.</p>}
    </section>
  )
}
