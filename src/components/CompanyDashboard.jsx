/**
 * CompanyDashboard — company identity + reputation + contracts, as one
 * compact strip rather than its own block — merged visually into the job
 * board's header so the sidebar leads with the balance/active-task area,
 * not a stack of identity panels. Reads only from CareerContext — never
 * touches topology/engine state.
 */
import { useCareer } from '../state/CareerContext.jsx'
import { tierForScore } from '../engine/reputation.js'

export default function CompanyDashboard() {
  const { company, reputation, clients, contracts } = useCareer()
  if (!company) return null

  const tier = tierForScore(reputation)
  const activeContracts = Object.values(contracts).filter(c => c.active)
  const monthlyIncome = activeContracts.reduce((sum, c) => sum + c.amountPerMonth, 0)
  const clientCount = Object.keys(clients).length

  return (
    <div style={{
      padding: '12px 16px', borderBottom: '1px solid var(--rule)', flexShrink: 0,
      background: 'var(--surface-panel)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
        <span style={{ fontSize: 20, flexShrink: 0 }}>{company.avatar}</span>
        <span style={{ fontSize: 17, fontWeight: 700, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {company.name}
        </span>
      </div>
      <div style={{ fontSize: 14, color: 'var(--ink-2)', marginTop: 4 }} title={`${reputation} reputation points`}>
        {tier.label} · {reputation} reputation
      </div>
      {(clientCount > 0 || monthlyIncome > 0) && (
        <div style={{ fontSize: 13.5, color: 'var(--ink-3)', marginTop: 2 }}>
          {clientCount > 0 && `${clientCount} client${clientCount === 1 ? '' : 's'}`}
          {clientCount > 0 && monthlyIncome > 0 && ' · '}
          {monthlyIncome > 0 && `$${monthlyIncome.toLocaleString()}/mo recurring`}
        </div>
      )}
    </div>
  )
}
