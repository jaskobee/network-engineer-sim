/**
 * The Cloud section (roadmap Phase 1a, shipped as "Preview").
 *
 * Tabs: Missions (step 6), Management (step 4), Network (step 5) and Overview. While a
 * mission runs, a mission bar stays visible on every tab and the views work in that
 * customer's tenant; otherwise they work in the player's sandbox. Everything reads
 * CloudContext; nothing assigns cloud state directly.
 */
import { useState } from 'react'
import { useCloud } from '../../state/CloudContext.jsx'
import { managementGroupScope } from '../../cloud/model.js'
import ManagementView from './ManagementView.jsx'
import NetworkView from './NetworkView.jsx'
import CloudMissions, { MissionBar } from './CloudMissions.jsx'

const TABS = [['missions', 'Missions'], ['management', 'Management'], ['network', 'Network'], ['overview', 'Overview']]

function Overview() {
  const { cloud, resetCloud, mission } = useCloud()
  const root = cloud.managementGroups[cloud.tenantId]
  const counts = [
    ['Management groups', Object.keys(cloud.managementGroups).length],
    ['Subscriptions', Object.keys(cloud.subscriptions).length],
    ['Resource groups', Object.keys(cloud.resourceGroups).length],
    ['Resources', Object.keys(cloud.resources).length],
  ]

  function startOver() {
    if (window.confirm('Start your sandbox over with an empty tenant? Missions and your on-prem game are not affected.')) resetCloud()
  }

  return (
    <div className="cloud-inner">
      <section className="cloud-card" aria-label="Tenant">
        <h2>{mission ? `${mission.def.client}'s tenant (mission)` : 'Your sandbox tenant'}</h2>
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

      <p className="cloud-credit">
        Tenant and subscription IDs are made-up GUIDs. Azure icons are Microsoft&apos;s Azure architecture icons, used
        unmodified as training material under Microsoft&apos;s icon terms.
      </p>

      <div className="cloud-actions">
        {mission
          ? <p className="mv-note">You&apos;re in a mission. Leave it (Missions tab) to get back to your sandbox.</p>
          : <button className="btn danger" onClick={startOver}>Start sandbox over</button>}
      </div>
    </div>
  )
}

export default function CloudWorkspace() {
  const { loadNotice, dismissLoadNotice } = useCloud()
  const [tab, setTab] = useState('missions')

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

      <MissionBar onOpen={() => setTab('missions')} />

      {loadNotice && (
        <div className="cloud-notice" role="status">
          <i className="led amber" />
          <span>{loadNotice}</span>
          <button className="btn ghost" onClick={dismissLoadNotice}>Dismiss</button>
        </div>
      )}

      {tab === 'missions' && <CloudMissions onStarted={() => setTab('management')} />}
      {tab === 'management' && <ManagementView />}
      {tab === 'network' && <NetworkView />}
      {tab === 'overview' && <Overview />}
    </main>
  )
}
