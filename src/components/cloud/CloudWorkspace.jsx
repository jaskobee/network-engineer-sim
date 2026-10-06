/**
 * The Cloud section (roadmap Phase 1a, shipped as "Preview").
 *
 * Step 3 of docs/PHASE_1A_CLOUD_SECTION.md: the section exists, shows the player's tenant
 * and can start over. The management view, network view, forms and missions arrive in
 * steps 4–6. Everything here reads CloudContext; nothing assigns cloud state directly.
 */
import { useCloud } from '../../state/CloudContext.jsx'
import { managementGroupScope } from '../../cloud/model.js'

export default function CloudWorkspace() {
  const { cloud, resetCloud, loadNotice, dismissLoadNotice } = useCloud()
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
    <main className="cloud-workspace">
      <div className="cloud-inner">
        <header className="cloud-head">
          <h1>Cloud <span className="preview-tag">Preview</span></h1>
          <p>
            Build Azure infrastructure — management groups, subscriptions, resource groups, networks,
            virtual machines and storage — and see how it fits together. Every rule the builder enforces
            is checked against Microsoft Learn. NetSim never connects to real Azure.
          </p>
        </header>

        {loadNotice && (
          <div className="cloud-notice" role="status">
            <i className="led amber" />
            <span>{loadNotice}</span>
            <button className="btn ghost" onClick={dismissLoadNotice}>Dismiss</button>
          </div>
        )}

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
            <li><strong>Management view</strong> — the management group tree, subscriptions and resource groups.</li>
            <li><strong>Network view</strong> — regions, virtual networks and subnets with their VMs, NICs and NSGs.</li>
            <li><strong>Build missions</strong> — landing zone basics, a first workload, and storage for an app.</li>
          </ul>
        </section>

        <div className="cloud-actions">
          <button className="btn danger" onClick={startOver}>Start over</button>
        </div>
      </div>
    </main>
  )
}
