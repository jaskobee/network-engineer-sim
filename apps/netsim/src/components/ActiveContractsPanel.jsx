/**
 * Client Networks — every client the player has actually done work for
 * (topology established), not just ones with an active contract. A
 * contracted client (see CareerContext's `contracts`) periodically gets a
 * small SLA-timed service ticket (see data/serviceTickets.js); this panel
 * is where the player revisits that client whenever they choose, rather
 * than it being pushed onto the job board. A client who completed a
 * mission but declined the contract offer still needs a way back to their
 * network — sourcing rows from `clients` (completedMissionIds.length > 0)
 * rather than only `contracts` is what makes that possible.
 */
import { useState, useEffect } from 'react'
import { useGame } from '../state/GameContext.jsx'
import { useCareer } from '../state/CareerContext.jsx'
import { ticketUrgency, msRemaining } from '../engine/contractClock.js'
import SatisfactionMeter from './SatisfactionMeter.jsx'

const URGENCY_STYLE = {
  safe:    { color: '#3ee08f', bg: '#0f1f18', led: 'green', label: 'On track' },
  warning: { color: '#ffb42e', bg: '#211a0a', led: 'amber', label: 'Time is short' },
  overdue: { color: '#ff8a4a', bg: '#22140a', led: 'amber', label: 'Overdue' },
  expired: { color: '#ff6259', bg: '#241412', led: 'red',   label: 'Expired' },
}

function formatRemaining(ms) {
  if (ms <= 0) return '0:00'
  const totalSec = Math.floor(ms / 1000)
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

const rowBase = {
  margin: '0 0 8px', borderRadius: 10,
  background: 'var(--surface-raised)', border: '1px solid var(--rule)',
}

function ContractRow({ client, contract, ticket, hasContract, canOpen, onOpen, onView }) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (!ticket) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [ticket])

  if (client.dormant) {
    return (
      <div style={{ ...rowBase, display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', opacity: 0.6 }}>
        <span style={{ fontSize: 23, filter: 'grayscale(1)' }}>{client.avatar}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15.5, fontWeight: 600, color: 'var(--ink-2)' }}>{client.companyName}</div>
          <div style={{ fontSize: 13.5, color: 'var(--ink-3)', marginTop: 2 }}>Relationship paused — no response in too long</div>
        </div>
      </div>
    )
  }

  // No open ticket — nothing urgent needs the player's attention, so this
  // collapses to a single-line summary rather than the full card. Clicking
  // it (when nothing else is active) switches the floorplan to this
  // client's persistent network, so the player can freely revisit/fix
  // something without it needing to be tied to a ticket.
  if (!ticket) {
    return (
      <div
        onClick={canOpen ? onView : undefined}
        title={canOpen ? `View ${client.companyName}'s network` : 'Finish your current job/ticket first'}
        style={{
          ...rowBase, display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px',
          cursor: canOpen ? 'pointer' : 'default', transition: 'border-color 0.12s',
        }}
        onMouseEnter={e => { if (canOpen) e.currentTarget.style.borderColor = 'var(--rule-strong)' }}
        onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--rule)' }}
      >
        <span style={{ fontSize: 19, flexShrink: 0 }}>{client.avatar}</span>
        <span style={{
          fontSize: 15.5, fontWeight: 600, color: 'var(--ink)', flex: 1, minWidth: 0,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>{client.companyName}</span>
        {hasContract && (
          <span style={{ fontSize: 13.5, color: 'var(--ink-3)', flexShrink: 0 }}>${contract.amountPerMonth}/mo</span>
        )}
        <SatisfactionMeter value={client.satisfaction} />
      </div>
    )
  }

  const urgency = ticketUrgency(ticket, now)
  const style = URGENCY_STYLE[urgency]

  return (
    <div style={{ ...rowBase, padding: '10px 12px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 23 }}>{client.avatar}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15.5, fontWeight: 600, color: 'var(--ink)' }}>{client.companyName}</div>
          <div style={{ fontSize: 13.5, color: 'var(--ink-3)', marginTop: 1 }}>${contract.amountPerMonth}/mo</div>
        </div>
        <SatisfactionMeter value={client.satisfaction} />
      </div>

      {ticket && (
        <div style={{
          marginTop: 10, padding: '8px 10px', borderRadius: 8,
          background: style.bg, border: `1px solid ${style.color}40`,
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14.5, fontWeight: 600, color: 'var(--ink)' }}>{ticket.title}</div>
            <div style={{ fontSize: 13.5, fontWeight: 600, color: style.color, marginTop: 3, display: 'flex', alignItems: 'center', gap: 7 }}>
              <i className={`led ${style.led}`} style={{ width: 7, height: 7 }} />
              {style.label} · {formatRemaining(msRemaining(ticket, now))} left
            </div>
          </div>
          <button
            className="btn primary"
            onClick={onOpen}
            disabled={!canOpen}
            title={canOpen ? undefined : 'Finish your current job/ticket first'}
            style={{ padding: '4px 14px', flexShrink: 0 }}
          >Open</button>
        </div>
      )}
    </div>
  )
}

export default function ActiveContractsPanel({ onNavigateAway }) {
  const { activeMissionId, activeTicket, acceptTicket: acceptTicketGame, viewClient } = useGame()
  const { clients, contracts, activeTickets, acceptTicket: acceptTicketCareer } = useCareer()

  // Every client the player has actually done work for — not just ones
  // currently under contract. A client who completed a mission but declined
  // the contract offer still has an established topology and needs a way
  // back to it via viewClient.
  const establishedClients = Object.values(clients).filter(c => c.completedMissionIds.length > 0)
  if (establishedClients.length === 0) return null

  const canOpen = !activeMissionId && !activeTicket

  function handleOpen(ticket) {
    if (!canOpen) return
    acceptTicketCareer(ticket)
    acceptTicketGame(ticket)
  }

  return (
    <div style={{ padding: '14px 14px 6px', borderBottom: '1px solid var(--rule)', flexShrink: 0 }}>
      <div style={{ fontSize: 15, color: 'var(--ink-2)', fontWeight: 600, marginBottom: 10 }}>
        Client networks
      </div>
      {establishedClients.map(client => {
        const contract = client.currentContractId ? contracts[client.currentContractId] : null
        const ticket = contract?.openTicketId ? activeTickets[contract.openTicketId] : null
        return (
          <ContractRow
            key={client.id}
            client={client}
            contract={contract}
            ticket={ticket}
            hasContract={!!contract}
            canOpen={canOpen}
            onOpen={() => ticket && handleOpen(ticket)}
            onView={() => { viewClient(client.id); onNavigateAway?.() }}
          />
        )
      })}
    </div>
  )
}
