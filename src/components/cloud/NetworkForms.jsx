/**
 * "Create a resource" for the network view, following the portal's flow: fill the form →
 * **Review + create** (Azure validates the whole deployment first) → **Create**. The
 * validation is a dry run of the same operation (operations are pure), so a refusal shows
 * before anything exists, exactly as "Validation failed" does in the portal.
 *
 * Forms only collect input and call submit(operation, args, summary) — src/cloud/operations.js
 * decides. Option lists mirror what Azure offers (src/cloud/catalog.js).
 */
import { useState } from 'react'
import * as op from '../../cloud/operations.js'
import { TYPES, resourcesOfType, subnetId } from '../../cloud/model.js'
import { REGIONS, regionDisplayName } from '../../cloud/regions.js'
import { DISK_TYPES, VM_SIZES, VM_IMAGES, STORAGE_KINDS } from '../../cloud/catalog.js'
import { Field, Facts, Form, Select } from './formParts.jsx'

export const CREATE_KINDS = [
  [TYPES.VIRTUAL_MACHINE, 'Virtual machine'],
  [TYPES.VIRTUAL_NETWORK, 'Virtual network'],
  [TYPES.NETWORK_SECURITY_GROUP, 'Network security group'],
  [TYPES.PUBLIC_IP, 'Public IP address'],
  [TYPES.NETWORK_INTERFACE, 'Network interface'],
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

/** Summary rows every review starts with. */
const basics = (cloud, place, name) => [
  ['Subscription', cloud.subscriptions[place.subscriptionId]?.displayName],
  ['Resource group', place.resourceGroup],
  ['Name', name, true],
  ['Region', regionDisplayName(place.location)],
]

/** A value picked from a list that may change under the form: falls back to the first option. */
const pickOrFirst = (picked, options) => (options.some(([v]) => v === picked) ? picked : (options[0]?.[0] ?? ''))

function subnetOptions(cloud, subscriptionId) {
  return inSub(cloud, subscriptionId, TYPES.VIRTUAL_NETWORK).flatMap(v =>
    v.properties.subnets.map(s => [subnetId(v.id, s.name), `${v.name} / ${s.name} (${s.addressPrefix}) — ${regionDisplayName(v.location)}`]))
}

// ── Virtual machine — Basics / Disks / Networking ────────────────────────────

function VirtualMachineForm({ cloud, subscriptionId, submit }) {
  const [place, setPlace] = usePlacement(cloud, subscriptionId)
  const subnets = subnetOptions(cloud, subscriptionId)
  const nsgs = inSub(cloud, subscriptionId, TYPES.NETWORK_SECURITY_GROUP)
  const disks = inSub(cloud, subscriptionId, TYPES.DISK).filter(d => !d.properties.managedBy)
  const osDiskTypes = Object.entries(DISK_TYPES).filter(([, d]) => d.osCapable)
  const [name, setName] = useState('')
  const [imageId, setImageId] = useState(VM_IMAGES[0].id)
  const [size, setSize] = useState(VM_SIZES[1])
  const [osType, setOsType] = useState('PremiumSSD')
  const [osSize, setOsSize] = useState('128')
  const [diskIds, setDiskIds] = useState([])
  const [snPick, setSn] = useState('')
  const sn = pickOrFirst(snPick, subnets)
  const [publicIp, setPublicIp] = useState('new')
  const [nsg, setNsg] = useState('')
  const image = VM_IMAGES.find(i => i.id === imageId)
  const label = (opts, v) => opts.find(([k]) => k === v)?.[1]

  return (
    <Form submit="Review + create" onSubmit={() => submit(op.deployVirtualMachine, {
      ...place, name: name.trim(), osType: image.osType, image: image.id, size,
      osDisk: { diskType: osType, sizeGiB: Number(osSize) }, dataDiskIds: diskIds,
      subnetId: sn, publicIp, networkSecurityGroupId: nsg || null,
    }, [
      ...basics(cloud, place, name.trim()),
      ['Image', image.displayName], ['Size', size, true],
      ['OS disk', `${DISK_TYPES[osType].displayName}, ${osSize} GiB`],
      ['Data disks', diskIds.length ? diskIds.map(id => cloud.resources[id]?.name).join(', ') : 'None'],
      ['Virtual network / subnet', label(subnets, sn) ?? '—'],
      ['Public IP', publicIp === 'new' ? `(new) ${name.trim()}-ip` : 'None'],
      ['Network interface', `(new) ${name.trim()}-nic`],
      ['NIC network security group', nsg ? cloud.resources[nsg]?.name : 'None'],
    ])}>
      <h3 className="nv-step">Basics</h3>
      <Placement cloud={cloud} subscriptionId={subscriptionId} value={place} onChange={setPlace} />
      <Field label="Virtual machine name" hint={image.osType === 'Windows' ? 'Windows computer names stop at 15 characters.' : 'Linux names may be up to 64 characters.'}>
        <input className="mono" value={name} onChange={e => setName(e.target.value)} placeholder="vm-web-01" />
      </Field>
      <Field label="Image"><Select value={imageId} onChange={setImageId} options={VM_IMAGES.map(i => [i.id, i.displayName])} /></Field>
      <Field label="Size" hint="A short list of real sizes; regional availability isn't modelled.">
        <Select value={size} onChange={setSize} options={VM_SIZES.map(s => [s, s])} />
      </Field>
      <p className="mv-note">Administrator account (username, password or SSH key) isn't modelled in this preview.</p>

      <h3 className="nv-step">Disks</h3>
      <Field label="OS disk type" hint="Ultra Disk and Premium SSD v2 can't be OS disks.">
        <Select value={osType} onChange={setOsType} options={osDiskTypes.map(([k, d]) => [k, d.displayName])} />
      </Field>
      <Field label="OS disk size (GiB)"><input className="mono" type="number" min="1" value={osSize} onChange={e => setOsSize(e.target.value)} /></Field>
      <Field label="Attach existing data disks (optional)">
        <Checklist items={disks.map(d => [d.id, `${d.name} — ${DISK_TYPES[d.properties.diskType].displayName}, ${d.properties.sizeGiB} GiB (${regionDisplayName(d.location)})`])}
          value={diskIds} onChange={setDiskIds} empty="No unattached disks." />
      </Field>

      <h3 className="nv-step">Networking</h3>
      <Field label="Virtual network / subnet" hint="The wizard creates the VM's network interface here — same region and subscription as the VM.">
        <Select value={sn} onChange={setSn} options={subnets} empty={subnets.length ? undefined : 'No subnets yet — create a virtual network first'} />
      </Field>
      <Field label="Public IP" hint="A Standard public IP is closed to inbound traffic until an NSG allows it. Many workloads need none.">
        <Select value={publicIp} onChange={setPublicIp} options={[['new', `(new) ${name.trim() || '<vm name>'}-ip`], ['none', 'None']]} />
      </Field>
      <Field label="NIC network security group">
        <Select value={nsg} onChange={setNsg} empty="None" options={nsgs.map(n => [n.id, `${n.name} — ${regionDisplayName(n.location)}`])} />
      </Field>
    </Form>
  )
}

// ── Other resources ──────────────────────────────────────────────────────────

function VirtualNetworkForm({ cloud, subscriptionId, submit }) {
  const [place, setPlace] = usePlacement(cloud, subscriptionId)
  const [name, setName] = useState('')
  const [space, setSpace] = useState('10.0.0.0/16')
  const [snName, setSnName] = useState('default')
  const [snPrefix, setSnPrefix] = useState('10.0.0.0/24')
  const prefixes = space.split(',').map(s => s.trim()).filter(Boolean)
  return (
    <Form submit="Review + create" onSubmit={() => submit(op.createVirtualNetwork, {
      ...place, name: name.trim(), addressPrefixes: prefixes,
      subnets: snName.trim() ? [{ name: snName.trim(), addressPrefix: snPrefix.trim() }] : [],
    }, [
      ...basics(cloud, place, name.trim()),
      ['Address space', prefixes.join(', '), true],
      ['Subnet', snName.trim() ? `${snName.trim()} — ${snPrefix.trim()}` : 'None'],
    ])}>
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

function NetworkSecurityGroupForm({ cloud, subscriptionId, submit }) {
  const [place, setPlace] = usePlacement(cloud, subscriptionId)
  const [name, setName] = useState('')
  return (
    <Form submit="Review + create" onSubmit={() => submit(op.createNetworkSecurityGroup, { ...place, name: name.trim() }, basics(cloud, place, name.trim()))}>
      <Placement cloud={cloud} subscriptionId={subscriptionId} value={place} onChange={setPlace} />
      <Field label="Name"><input className="mono" value={name} onChange={e => setName(e.target.value)} placeholder="nsg-web" /></Field>
      <p className="mv-note">Every NSG starts with Azure's six default rules. Add your own rules after it's created.</p>
    </Form>
  )
}

function PublicIpForm({ cloud, subscriptionId, submit }) {
  const [place, setPlace] = usePlacement(cloud, subscriptionId)
  const [name, setName] = useState('')
  const [label, setLabel] = useState('')
  return (
    <Form submit="Review + create" onSubmit={() => submit(op.createPublicIp, { ...place, name: name.trim(), domainNameLabel: label.trim() || null }, [
      ...basics(cloud, place, name.trim()), ['SKU', 'Standard'], ['Assignment', 'Static'], ['DNS name label', label.trim() || 'None'],
    ])}>
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

/**
 * A standalone NIC, as the portal's "Create network interface" offers it. N4: the portal
 * can't put a public IP on a NIC while creating it (CLI/PowerShell can) — so no public IP here.
 */
function NetworkInterfaceForm({ cloud, subscriptionId, submit }) {
  const [place, setPlace] = usePlacement(cloud, subscriptionId)
  const subnets = subnetOptions(cloud, subscriptionId)
  const nsgs = inSub(cloud, subscriptionId, TYPES.NETWORK_SECURITY_GROUP)
  const [name, setName] = useState('')
  const [snPick, setSn] = useState('')
  const sn = pickOrFirst(snPick, subnets)
  const [alloc, setAlloc] = useState('Dynamic')
  const [ip, setIp] = useState('')
  const [nsg, setNsg] = useState('')
  return (
    <Form submit="Review + create" onSubmit={() => submit(op.createNetworkInterface, {
      ...place, name: name.trim(), subnetId: sn, privateIpAllocation: alloc,
      privateIpAddress: alloc === 'Static' ? ip.trim() : null, networkSecurityGroupId: nsg || null,
    }, [
      ...basics(cloud, place, name.trim()),
      ['Virtual network / subnet', subnets.find(([v]) => v === sn)?.[1] ?? '—'],
      ['Private IP', alloc === 'Static' ? `${ip.trim()} (Static)` : 'Dynamic'],
      ['Network security group', nsg ? cloud.resources[nsg]?.name : 'None'],
    ])}>
      <Placement cloud={cloud} subscriptionId={subscriptionId} value={place} onChange={setPlace} />
      <Field label="Name"><input className="mono" value={name} onChange={e => setName(e.target.value)} placeholder="nic-app-01" /></Field>
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
      <Field label="Network security group (optional)">
        <Select value={nsg} onChange={setNsg} empty="None" options={nsgs.map(n => [n.id, n.name])} />
      </Field>
      <p className="mv-note">The portal can't add a public IP while creating a NIC; a VM created with the wizard gets one if you ask.</p>
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

function DiskForm({ cloud, subscriptionId, submit }) {
  const [place, setPlace] = usePlacement(cloud, subscriptionId)
  const [name, setName] = useState('')
  const [type, setType] = useState('PremiumSSD')
  const [red, setRed] = useState('LRS')
  const [size, setSize] = useState('128')
  return (
    <Form submit="Review + create" onSubmit={() => submit(op.createDisk, { ...place, name: name.trim(), diskType: type, redundancy: red, sizeGiB: Number(size) }, [
      ...basics(cloud, place, name.trim()), ['Disk type', DISK_TYPES[type].displayName], ['Redundancy', red], ['Size', `${size} GiB`],
    ])}>
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

function StorageAccountForm({ cloud, subscriptionId, submit }) {
  const [place, setPlace] = usePlacement(cloud, subscriptionId)
  const [name, setName] = useState('')
  const [kind, setKind] = useState('StorageV2')
  const [red, setRed] = useState('ZRS')
  const [access, setAccess] = useState('all')
  const options = STORAGE_KINDS[kind].redundancy
  return (
    <Form submit="Review + create" onSubmit={() => submit(op.createStorageAccount, {
      ...place, name: name.trim(), kind, redundancy: red,
      publicNetworkAccess: STORAGE_ACCESS[access].publicNetworkAccess, defaultAction: STORAGE_ACCESS[access].defaultAction,
    }, [
      ...basics(cloud, place, name.trim()), ['Account type', STORAGE_KINDS[kind].displayName], ['Redundancy', red],
      ['Public network access', STORAGE_ACCESS[access].label],
    ])}>
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
  [TYPES.VIRTUAL_MACHINE]: VirtualMachineForm,
  [TYPES.VIRTUAL_NETWORK]: VirtualNetworkForm,
  [TYPES.NETWORK_SECURITY_GROUP]: NetworkSecurityGroupForm,
  [TYPES.PUBLIC_IP]: PublicIpForm,
  [TYPES.NETWORK_INTERFACE]: NetworkInterfaceForm,
  [TYPES.DISK]: DiskForm,
  [TYPES.STORAGE_ACCOUNT]: StorageAccountForm,
}

/**
 * The create flow. `report(result)` shows a validation refusal; `run(operation, args)`
 * deploys after the player confirms on the review page.
 */
export function CreatePanel({ cloud, subscriptionId, run, report, kind, onKind }) {
  const [pending, setPending] = useState(null)   // { operation, args, summary, warnings }
  const CreateForm = FORMS[kind]
  const hasGroup = Object.values(cloud.resourceGroups).some(g => g.subscriptionId === subscriptionId)

  function submit(operation, args, summary) {
    const validation = operation(cloud, args)        // dry run — nothing is applied
    if (!validation.ok) { report(validation); return }
    report(null)
    setPending({ operation, args, summary, warnings: validation.warnings })
  }

  return (
    <section className="nv-create">
      <h2>{pending ? 'Review + create' : 'Create a resource'}</h2>
      {pending && (
        <div className="nv-review">
          <p className="nv-valid"><i className="led green" />Validation passed</p>
          {pending.warnings.map((w, i) => <p key={i} className="mv-note"><i className="led amber" /> {w.message}</p>)}
          <Facts rows={pending.summary} />
          <div className="nv-review-actions">
            <button className="btn" type="button" onClick={() => setPending(null)}>Back</button>
            <button className="btn primary" type="button" onClick={() => {
              const r = run(pending.operation, pending.args)
              if (r.ok) setPending(null)
            }}>Create</button>
          </div>
        </div>
      )}
      {/* The form stays mounted under the review, so Back returns to what was typed. */}
      <div style={{ display: pending ? 'none' : 'contents' }}>
        <Field label="Resource type">
          <Select value={kind} onChange={k => { setPending(null); onKind(k) }} options={CREATE_KINDS} />
        </Field>
        {hasGroup
          ? <CreateForm key={`${kind}:${subscriptionId}`} cloud={cloud} subscriptionId={subscriptionId} submit={submit} />
          : <p className="mv-note">This subscription has no resource group yet. Create one in the Management tab first.</p>}
      </div>
    </section>
  )
}
