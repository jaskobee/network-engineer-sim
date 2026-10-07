/**
 * Network view (PHASE_1A step 5): one subscription at a time, drawn region → virtual
 * network → subnet → NIC (with its VM and public IP), and everything that lives outside a
 * virtual network — NSGs, unattached public IPs, disks, storage accounts — beside it.
 * The right-hand panel shows the selected item or the "Create a resource" forms.
 */
import { useState } from 'react'
import { useCloud } from '../state/CloudContext.jsx'
import * as op from '../azure/operations.js'
import { TYPES, findSubnet, subnetId } from '../azure/model.js'
import { regionDisplayName, REGIONS } from '../azure/regions.js'
import { AzureItem } from './AzureIcon.jsx'
import OperationResult from './OperationResult.jsx'
import { CreatePanel } from './NetworkForms.jsx'
import { NetworkDetails } from './NetworkDetails.jsx'

// Operations whose result id is a new resource the view should select afterwards.
const CREATES = new Set([
  op.createVirtualNetwork, op.createNetworkSecurityGroup, op.createPublicIp, op.createNetworkInterface,
  op.createVirtualMachine, op.deployVirtualMachine, op.createDisk, op.createStorageAccount,
])

function Pick({ sel, kind, id, onSelect, className, children }) {
  const on = sel?.kind === kind && sel?.id === id
  return (
    <div className={`${className} nv-pick`} role="button" tabIndex={0} aria-pressed={on}
      onClick={e => { e.stopPropagation(); onSelect({ kind, id }) }}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); onSelect({ kind, id }) } }}>
      {children}
    </div>
  )
}

function NicCard({ cloud, nic, sel, onSelect }) {
  const vm = nic.properties.virtualMachineId && cloud.resources[nic.properties.virtualMachineId]
  const pip = nic.properties.publicIpId && cloud.resources[nic.properties.publicIpId]
  return (
    <div className="nv-nic">
      {vm && (
        <Pick sel={sel} kind="res" id={vm.id} onSelect={onSelect} className="nv-chip">
          <AzureItem kind={vm.type} label={vm.name} size={20} />
        </Pick>
      )}
      <Pick sel={sel} kind="res" id={nic.id} onSelect={onSelect} className="nv-chip">
        <AzureItem kind={nic.type} label={`${nic.name} · ${nic.properties.privateIpAddress}`} size={20} />
        {nic.properties.networkSecurityGroupId && <span className="nv-badge">NSG {cloud.resources[nic.properties.networkSecurityGroupId]?.name}</span>}
      </Pick>
      {pip && (
        <Pick sel={sel} kind="res" id={pip.id} onSelect={onSelect} className="nv-chip">
          <AzureItem kind={pip.type} label={`${pip.name} · ${pip.properties.ipAddress}`} size={20} />
        </Pick>
      )}
    </div>
  )
}

function Diagram({ cloud, subscriptionId, sel, onSelect }) {
  const mine = Object.values(cloud.resources).filter(r => r.subscriptionId === subscriptionId)
  const regions = REGIONS.map(r => r.name).filter(name => mine.some(r => r.location === name))
  if (!regions.length) return <p className="mv-note nv-empty">Nothing deployed in this subscription yet. Create a virtual network to start.</p>

  return regions.map(region => {
    const here = mine.filter(r => r.location === region)
    const vnets = here.filter(r => r.type === TYPES.VIRTUAL_NETWORK)
    const nics = here.filter(r => r.type === TYPES.NETWORK_INTERFACE)
    const outside = here.filter(r =>
      [TYPES.NETWORK_SECURITY_GROUP, TYPES.DISK, TYPES.STORAGE_ACCOUNT].includes(r.type) ||
      (r.type === TYPES.PUBLIC_IP && !r.properties.ipConfigurationId))
    return (
      <section key={region} className="nv-region" aria-label={regionDisplayName(region)}>
        <h3>{regionDisplayName(region)}</h3>
        {vnets.map(v => (
          <Pick key={v.id} sel={sel} kind="res" id={v.id} onSelect={onSelect} className="nv-vnet">
            <div className="nv-head">
              <AzureItem kind={v.type} label={v.name} />
              <span className="mono nv-cidr">{v.properties.addressPrefixes.join(', ')}</span>
            </div>
            <div className="nv-subnets">
              {v.properties.subnets.map(s => {
                const id = subnetId(v.id, s.name)
                const inSubnet = nics.filter(n => n.properties.subnetId === id)
                return (
                  <Pick key={id} sel={sel} kind="subnet" id={id} onSelect={onSelect} className="nv-subnet">
                    <div className="nv-head">
                      <AzureItem kind="subnet" label={s.name} size={20} />
                      <span className="mono nv-cidr">{s.addressPrefix}</span>
                    </div>
                    <div className="nv-tags">
                      <span className="nv-badge">Private subnet</span>
                      {s.networkSecurityGroupId && <span className="nv-badge">NSG {cloud.resources[s.networkSecurityGroupId]?.name}</span>}
                    </div>
                    {inSubnet.map(n => <NicCard key={n.id} cloud={cloud} nic={n} sel={sel} onSelect={onSelect} />)}
                  </Pick>
                )
              })}
              {!v.properties.subnets.length && <p className="mv-note">No subnets yet.</p>}
            </div>
          </Pick>
        ))}
        {/* NICs whose virtual network is in another region can't exist (L2), so every NIC is drawn above. */}
        {outside.length > 0 && (
          <div className="nv-outside">
            <h4>Not inside a virtual network</h4>
            <div className="nv-chips">
              {outside.map(r => (
                <Pick key={r.id} sel={sel} kind="res" id={r.id} onSelect={onSelect} className="nv-chip">
                  <AzureItem kind={r.type} label={r.name} size={20} />
                </Pick>
              ))}
            </div>
          </div>
        )}
      </section>
    )
  })
}

export default function NetworkView() {
  const { cloud, apply } = useCloud()
  const subs = Object.values(cloud.subscriptions)
  const [subPick, setSubPick] = useState('')
  const subscriptionId = subs.some(s => s.id === subPick) ? subPick : (subs[0]?.id ?? '')
  const [picked, setPicked] = useState(null)
  const [createKind, setCreateKind] = useState(TYPES.VIRTUAL_NETWORK)
  const [result, setResult] = useState(null)

  // A selection that no longer exists (deleted, moved, Start over) means "nothing selected".
  const sel = picked && (picked.kind === 'subnet' ? findSubnet(cloud, picked.id).subnet : cloud.resources[picked.id]) ? picked : null

  /** Run an operation; a successful create selects the new resource, `next` handles anything else. */
  function run(operation, args, next) {
    const r = apply(operation, args)
    setResult(r)
    if (r.ok) {
      if (next) next(r)
      else if (CREATES.has(operation)) setPicked({ kind: 'res', id: r.id })
    }
    return r
  }

  function select(node) {
    setPicked(node)
    setResult(null)
  }

  if (!subs.length) {
    return (
      <div className="cloud-inner">
        <p className="mv-note">No subscription yet. Add one in the Management tab (or let a mission hand you one), then build its network here.</p>
      </div>
    )
  }

  return (
    <div className="mv">
      <div className="nv-left">
        <div className="nv-toolbar">
          <label className="mv-field nv-sub">
            <span>Subscription</span>
            <select value={subscriptionId} onChange={e => { setSubPick(e.target.value); select(null) }}>
              {subs.map(s => <option key={s.id} value={s.id}>{s.displayName}</option>)}
            </select>
          </label>
          <button className="btn" aria-pressed={!sel} onClick={() => select(null)}>Create a resource</button>
        </div>
        <Diagram cloud={cloud} subscriptionId={subscriptionId} sel={sel} onSelect={select} />
      </div>
      <section className="mv-right" aria-label="Details">
        <OperationResult result={result} onDismiss={() => setResult(null)} />
        {sel
          ? <NetworkDetails cloud={cloud} sel={sel} run={run} select={select} />
          : <CreatePanel cloud={cloud} subscriptionId={subscriptionId} run={run} report={setResult} kind={createKind} onKind={setCreateKind} />}
      </section>
    </div>
  )
}
