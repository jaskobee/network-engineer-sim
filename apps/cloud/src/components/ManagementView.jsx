/**
 * Management view (PHASE_1A step 4): Tenant root group → management groups →
 * subscriptions → resource groups → resources, with portal-style forms for management
 * groups, subscriptions and resource groups. Every change goes through
 * CloudContext.apply(operation, args); refusals are shown by OperationResult.
 */
import { useState } from 'react'
import { useCloud } from '../state/CloudContext.jsx'
import * as op from '../azure/operations.js'
import {
  isRoot, managementGroupDepth, managementGroupScope, subscriptionScope, resourceGroupId,
  childManagementGroups, childSubscriptions, resourcesInGroup,
} from '../azure/model.js'
import { REGIONS, regionDisplayName } from '../azure/regions.js'
import { AzureItem } from './AzureIcon.jsx'
import OperationResult from './OperationResult.jsx'
import { Field, Facts, Form } from './formParts.jsx'

// ── Tree ─────────────────────────────────────────────────────────────────────

function TreeRow({ depth, selected, onSelect, children }) {
  return (
    <li>
      <button className="mv-row" style={{ paddingLeft: 10 + depth * 18 }} aria-pressed={selected} onClick={onSelect}>
        {children}
      </button>
    </li>
  )
}

function Tree({ cloud, selected, onSelect }) {
  const is = (kind, id) => selected.kind === kind && selected.id === id
  const rows = []
  const walkMg = (mg, depth) => {
    rows.push(
      <TreeRow key={`mg:${mg.id}`} depth={depth} selected={is('mg', mg.id)} onSelect={() => onSelect({ kind: 'mg', id: mg.id })}>
        <AzureItem kind="managementGroup" label={mg.displayName} />
      </TreeRow>,
    )
    for (const child of childManagementGroups(cloud, mg.id)) walkMg(child, depth + 1)
    for (const sub of childSubscriptions(cloud, mg.id)) {
      rows.push(
        <TreeRow key={`sub:${sub.id}`} depth={depth + 1} selected={is('sub', sub.id)} onSelect={() => onSelect({ kind: 'sub', id: sub.id })}>
          <AzureItem kind="subscription" label={sub.displayName} />
        </TreeRow>,
      )
      for (const rg of Object.values(cloud.resourceGroups).filter(g => g.subscriptionId === sub.id)) {
        rows.push(
          <TreeRow key={`rg:${rg.id}`} depth={depth + 2} selected={is('rg', rg.id)} onSelect={() => onSelect({ kind: 'rg', id: rg.id })}>
            <AzureItem kind="resourceGroup" label={rg.name} />
          </TreeRow>,
        )
        for (const r of resourcesInGroup(cloud, rg.subscriptionId, rg.name)) {
          rows.push(
            <TreeRow key={`res:${r.id}`} depth={depth + 3} selected={is('res', r.id)} onSelect={() => onSelect({ kind: 'res', id: r.id })}>
              <AzureItem kind={r.type} label={r.name} size={20} />
            </TreeRow>,
          )
        }
      }
    }
  }
  walkMg(cloud.managementGroups[cloud.tenantId], 0)
  return <ul className="mv-tree" aria-label="Management hierarchy">{rows}</ul>
}

// ── Details per kind ─────────────────────────────────────────────────────────

function ManagementGroupDetails({ cloud, mg, run }) {
  const { mission } = useCloud()   // missions hand out their subscriptions — no shortcut there
  const root = isRoot(cloud, mg.id)
  const depth = managementGroupDepth(cloud, mg.id)
  const [newId, setNewId] = useState('')
  const [newName, setNewName] = useState('')
  const [rename, setRename] = useState(mg.displayName)
  const [target, setTarget] = useState(mg.parentId ?? '')
  const [subName, setSubName] = useState('')
  const others = Object.values(cloud.managementGroups).filter(m => m.id !== mg.id)

  return (
    <>
      <AzureItem kind="managementGroup" label={mg.displayName} size={32} />
      <Facts rows={[
        ['ID', mg.id, true],
        ['Level', root ? 'Root — the top of the tenant' : `${depth} of 6 below the root`],
        ['Parent', root ? '—' : cloud.managementGroups[mg.parentId]?.displayName],
        ['Scope', managementGroupScope(mg.id), true],
      ]} />
      {root && (
        <p className="mv-note">
          Every management group and subscription in the tenant folds up into this root group. It can be
          renamed, but it can't be moved or deleted. Anything assigned here applies to the whole tenant.
        </p>
      )}

      <Form title="Add a management group under this one" submit="Create"
        onSubmit={() => run(op.createManagementGroup, { id: newId.trim(), displayName: newName, parentId: mg.id },
          r => { setNewId(''); setNewName(''); return { kind: 'mg', id: r.id } })}>
        <Field label="Management group ID" hint="Permanent. Letters, numbers, hyphens, underscores, periods and parentheses; 1–90 characters.">
          <input className="mono" value={newId} onChange={e => setNewId(e.target.value)} placeholder="landing-zones" />
        </Field>
        <Field label="Display name" hint="Shown in the tree. Can be changed later.">
          <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Landing zones" />
        </Field>
      </Form>

      <Form title="Rename" submit="Save" onSubmit={() => run(op.renameManagementGroup, { id: mg.id, displayName: rename })}>
        <Field label="Display name"><input value={rename} onChange={e => setRename(e.target.value)} /></Field>
      </Form>

      {!root && (
        <Form title="Move to another parent" submit="Move" onSubmit={() => run(op.moveManagementGroup, { id: mg.id, parentId: target })}>
          <Field label="New parent management group">
            <select value={target} onChange={e => setTarget(e.target.value)}>
              {others.map(m => <option key={m.id} value={m.id}>{m.displayName} ({m.id})</option>)}
            </select>
          </Field>
        </Form>
      )}

      {root && !mission && (
        <Form title="Add a subscription — simulated shortcut" submit="Add subscription"
          onSubmit={() => run(op.addSubscription, { displayName: subName },
            r => { setSubName(''); return { kind: 'sub', id: r.id } })}>
          <p className="mv-note">
            In real Azure a subscription comes from a billing agreement, not a button. Missions hand you the
            subscriptions they need; this shortcut is for experimenting. New subscriptions start under the root.
          </p>
          <Field label="Subscription name">
            <input value={subName} onChange={e => setSubName(e.target.value)} placeholder="Production" />
          </Field>
        </Form>
      )}

      {!root && (
        <div className="mv-danger">
          <button className="btn danger" onClick={() => {
            if (window.confirm(`Delete management group "${mg.displayName}"?`))
              run(op.deleteManagementGroup, { id: mg.id }, () => ({ kind: 'mg', id: mg.parentId }))
          }}>Delete management group</button>
        </div>
      )}
    </>
  )
}

function SubscriptionDetails({ cloud, sub, run }) {
  const [target, setTarget] = useState(sub.parentId)
  const [rgName, setRgName] = useState('')
  const [region, setRegion] = useState(REGIONS[0].name)
  return (
    <>
      <AzureItem kind="subscription" label={sub.displayName} size={32} />
      <Facts rows={[
        ['Subscription ID', sub.id, true],
        ['Management group', cloud.managementGroups[sub.parentId]?.displayName],
        ['Scope', subscriptionScope(sub.id), true],
      ]} />

      <Form title="Create a resource group" submit="Create"
        onSubmit={() => run(op.createResourceGroup, { subscriptionId: sub.id, name: rgName.trim(), location: region },
          r => { setRgName(''); return { kind: 'rg', id: r.id } })}>
        <Field label="Resource group name" hint="Unique in this subscription. Letters, digits, underscores, hyphens, periods, parentheses; no period at the end.">
          <input className="mono" value={rgName} onChange={e => setRgName(e.target.value)} placeholder="rg-app-prod" />
        </Field>
        <Field label="Region" hint="Where the resource group's metadata is stored. Its resources may be in other regions.">
          <select value={region} onChange={e => setRegion(e.target.value)}>
            {REGIONS.map(r => <option key={r.name} value={r.name}>{r.displayName}</option>)}
          </select>
        </Field>
      </Form>

      <Form title="Move to a management group" submit="Move" onSubmit={() => run(op.moveSubscription, { id: sub.id, parentId: target })}>
        <Field label="Management group" hint="A subscription has exactly one parent.">
          <select value={target} onChange={e => setTarget(e.target.value)}>
            {Object.values(cloud.managementGroups).map(m => <option key={m.id} value={m.id}>{m.displayName} ({m.id})</option>)}
          </select>
        </Field>
      </Form>
    </>
  )
}

function ResourceGroupDetails({ cloud, rg, run }) {
  const resources = resourcesInGroup(cloud, rg.subscriptionId, rg.name)
  return (
    <>
      <AzureItem kind="resourceGroup" label={rg.name} size={32} />
      <Facts rows={[
        ['Region', `${regionDisplayName(rg.location)} (metadata location)`],
        ['Subscription', cloud.subscriptions[rg.subscriptionId]?.displayName],
        ['Resource ID', rg.id, true],
        ['Resources', resources.length ? resources.length : 'None yet — build networks, VMs and storage in the Network tab'],
      ]} />
      <div className="mv-danger">
        <button className="btn danger" onClick={() => {
          const msg = resources.length
            ? `Delete resource group "${rg.name}"? Its ${resources.length} resource(s) are deleted with it.`
            : `Delete resource group "${rg.name}"?`
          if (window.confirm(msg))
            run(op.deleteResourceGroup, { subscriptionId: rg.subscriptionId, name: rg.name }, () => ({ kind: 'sub', id: rg.subscriptionId }))
        }}>Delete resource group</button>
      </div>
    </>
  )
}

function ResourceDetails({ cloud, r, run }) {
  return (
    <>
      <AzureItem kind={r.type} label={r.name} size={32} />
      <Facts rows={[
        ['Type', r.type, true],
        ['Region', regionDisplayName(r.location)],
        ['Resource group', r.resourceGroup],
        ['Resource ID', r.id, true],
      ]} />
      <div className="mv-danger">
        <button className="btn danger" onClick={() => {
          if (window.confirm(`Delete ${r.name}?`))
            run(op.deleteResource, { id: r.id }, () => ({ kind: 'rg', id: resourceGroupId(r.subscriptionId, r.resourceGroup) }))
        }}>Delete resource</button>
      </div>
    </>
  )
}

// ── View ─────────────────────────────────────────────────────────────────────

export default function ManagementView() {
  const { cloud, apply } = useCloud()
  const [picked, setPicked] = useState({ kind: 'mg', id: cloud.tenantId })
  const [result, setResult] = useState(null)

  // A selection whose node no longer exists (deleted, or after Start over) falls back to the root.
  const exists = {
    mg: id => cloud.managementGroups[id], sub: id => cloud.subscriptions[id],
    rg: id => cloud.resourceGroups[id], res: id => cloud.resources[id],
  }[picked.kind]?.(picked.id)
  const selected = exists ? picked : { kind: 'mg', id: cloud.tenantId }

  /** Run an operation; on success optionally select what `next(result)` returns. */
  function run(operation, args, next) {
    const r = apply(operation, args)
    setResult(r)
    if (r.ok && next) {
      const to = next(r)
      if (to) setPicked(to)
    }
    return r
  }

  function select(node) {
    setPicked(node)
    setResult(null)
  }

  const key = `${selected.kind}:${selected.id}`   // remounts the panel so its forms start fresh
  let details
  if (selected.kind === 'mg') details = <ManagementGroupDetails key={key} cloud={cloud} mg={cloud.managementGroups[selected.id]} run={run} />
  else if (selected.kind === 'sub') details = <SubscriptionDetails key={key} cloud={cloud} sub={cloud.subscriptions[selected.id]} run={run} />
  else if (selected.kind === 'rg') details = <ResourceGroupDetails key={key} cloud={cloud} rg={cloud.resourceGroups[selected.id]} run={run} />
  else details = <ResourceDetails key={key} cloud={cloud} r={cloud.resources[selected.id]} run={run} />

  return (
    <div className="mv">
      <aside className="mv-left">
        <Tree cloud={cloud} selected={selected} onSelect={select} />
      </aside>
      <section className="mv-right" aria-label="Details">
        <OperationResult result={result} onDismiss={() => setResult(null)} />
        {details}
      </section>
    </div>
  )
}
