/**
 * The Cloud section (roadmap Phase 1a, shipped as "Preview").
 *
 * Tabs: Management (step 4), Network (step 5) and Overview (the tenant, Start over).
 * Missions arrive in step 6; until then they're listed as coming, never shown
 * as dead buttons. Everything reads CloudContext; nothing assigns cloud state directly.
 */
import { useState } from 'react'
import { useCloud } from '../../state/CloudContext.jsx'
import { managementGroupScope } from '../../cloud/model.js'
import ManagementView from './ManagementView.jsx'
import NetworkView from './NetworkView.jsx'

const TABS = [['management', 'Management'], ['network', 'Network'], ['overview', 'Overview']]

function Overview() {
  const { cloud, resetCloud } = useCloud()
  const root = cloud.managementGroups[cloud.tenantId]
  const counts = [
    ['Management groups', Object.keys(cloud.managementGroups).length],
    ['Subscriptions', Object.keys(cloud.subscriptions).length],
    ['Resource groups', Object.keys(cloud.resourceGroups).length],
    ['Resources', Object.keys(cloud.resources).length],
  ]

  function startOver() {
    if (window.confirm('Start the Cloud section over with an empty tenant? Your on-prem game is not affected.')) resetCloud()
  }

  return (
    <div className="cloud-inner">
      <section className="cloud-card" aria-label="Your tenant">
        <h2>Your tenant</h2>
        <dl className="cloud-facts">
          <dt>Root management group</dt>
          <dd>{root.displayName}</dd>
          <dt>Tenant ID</dt>
          <dd className="mono">{cloud.tenantId}</dd>
          <dt>Scope</dt>
          <dd className="mono">{managementGroupScope(cloud.tenantId)}</dd>
        </dl>
        <ul className="cloud-counts">
          {counts.map(([label, n]) => (
            <li key={label}><span className="mono">{n}</span>{label}</li>
          ))}
        </ul>
      </section>

      <section className="cloud-card" aria-label="Coming next">
        <h2>Coming next in this preview</h2>
        <ul className="cloud-roadmap">
          <li><strong>Build missions</strong> — landing zone basics, a first workload, and storage for an app.</li>
        </ul>
      </section>

      <p className="cloud-credit">
        Azure icons are Microsoft's Azure architecture icons, used unmodified as training material under
        Microsoft's icon terms.
      </p>

      <div className="cloud-actions">
        <button className="btn danger" onClick={startOver}>Start over</button>
      </div>
    </div>
  )
}

export default function CloudWorkspace() {
  const { loadNotice, dismissLoadNotice } = useCloud()
  const [tab, setTab] = useState('management')

  return (
    <main className="cloud-workspace">
      <header className="cloud-top">
        <div className="cloud-head">
          <h1>Cloud <span className="preview-tag">Preview</span></h1>
          <p>
            Build Azure infrastructure and see how it fits together. Every rule the builder enforces is
            checked against Microsoft Learn. NetSim never connects to real Azure.
          </p>
        </div>
        <div className="seg" role="group" aria-label="Cloud view">
          {TABS.map(([id, label]) => (
            <button key={id} onClick={() => setTab(id)} aria-pressed={tab === id}>{label}</button>
          ))}
        </div>
      </header>

      {loadNotice && (
        <div className="cloud-notice" role="status">
          <i className="led amber" />
          <span>{loadNotice}</span>
          <button className="btn ghost" onClick={dismissLoadNotice}>Dismiss</button>
        </div>
      )}

      {tab === 'management' && <ManagementView />}
      {tab === 'network' && <NetworkView />}
      {tab === 'overview' && <Overview />}
    </main>
  )
}
