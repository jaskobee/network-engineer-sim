/**
 * CompanyDashboard — company identity + reputation + active contracts summary.
 * Sits at the top of the Job Board (MissionPanel), above the balance/jobs list.
 * Reads only from CareerContext — never touches topology/engine state.
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
    <div style={{ padding: '12px 16px', borderBottom: '1px solid #1a1a3e', flexShrink: 0, background: '#070a16' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: 16 }}>{company.avatar}</span>
        <span style={{ fontSize: 12, fontWeight: 700, color: '#c8d0e0', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {company.name}
        </span>
      </div>

      <div style={{ display: 'flex', gap: 14 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 8, color: '#2a3a5a', letterSpacing: 0.5, marginBottom: 2 }}>REPUTATION</div>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#8ab4d4' }}>{tier.label}</div>
          <div style={{ fontSize: 9, color: '#3a4a6a', fontFamily: 'monospace' }}>{reputation} pts</div>
        </div>
        {clientCount > 0 && (
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 8, color: '#2a3a5a', letterSpacing: 0.5, marginBottom: 2 }}>CLIENTS</div>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#c8d0e0' }}>{clientCount}</div>
          </div>
        )}
        {monthlyIncome > 0 && (
          <div style={{ flex: 1, minWidth: 0, textAlign: 'right' }}>
            <div style={{ fontSize: 8, color: '#2a3a5a', letterSpacing: 0.5, marginBottom: 2 }}>MONTHLY CONTRACTS</div>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#50fa7b', fontFamily: 'monospace' }}>${monthlyIncome.toLocaleString()}/mo</div>
          </div>
        )}
      </div>
    </div>
  )
}
