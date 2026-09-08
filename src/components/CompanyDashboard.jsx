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
      display: 'flex', alignItems: 'center', gap: 8,
      padding: '9px 16px', borderBottom: '1px solid #1a1a3e', flexShrink: 0,
      background: '#070a16', fontSize: 10,
    }}>
      <span style={{ fontSize: 14, flexShrink: 0 }}>{company.avatar}</span>
      <span style={{
        fontWeight: 700, color: '#c8d0e0', flexShrink: 0, maxWidth: 90,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>{company.name}</span>
      <span style={{ color: '#1a2a4a' }}>·</span>
      <span title={`${reputation} reputation points`} style={{ color: '#8ab4d4', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {tier.label}
      </span>
      {clientCount > 0 && (
        <>
          <span style={{ color: '#1a2a4a' }}>·</span>
          <span style={{ color: '#556', flexShrink: 0 }}>{clientCount} client{clientCount === 1 ? '' : 's'}</span>
        </>
      )}
      {monthlyIncome > 0 && (
        <>
          <span style={{ color: '#1a2a4a' }}>·</span>
          <span style={{ color: '#50fa7b', fontFamily: 'monospace', flexShrink: 0 }}>${monthlyIncome.toLocaleString()}/mo</span>
        </>
      )}
    </div>
  )
}
