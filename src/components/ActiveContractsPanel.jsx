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
  safe:    { color: '#50fa7b', bg: '#0a2010', label: 'On track' },
  warning: { color: '#ffb86c', bg: '#2a1a00', label: 'Time is short' },
  overdue: { color: '#ff8855', bg: '#2a1400', label: 'Overdue' },
  expired: { color: '#ff5555', bg: '#2a1010', label: 'Expired' },
}

function formatRemaining(ms) {
  if (ms <= 0) return '0:00'
  const totalSec = Math.floor(ms / 1000)
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  return `${m}:${String(s).padStart(2, '0')}`
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
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '10px 12px', margin: '0 0 8px', borderRadius: 6,
        background: '#0a0a14', border: '1px solid #1a1a2a', opacity: 0.55,
      }}>
        <span style={{ fontSize: 20, filter: 'grayscale(1)' }}>{client.avatar}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#556' }}>{client.companyName}</div>
          <div style={{ fontSize: 9, color: '#445', marginTop: 2 }}>Relationship paused — no response in too long</div>
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
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '7px 10px', margin: '0 0 6px', borderRadius: 6,
          background: '#0a0f1e', border: '1px solid #16223a',
          cursor: canOpen ? 'pointer' : 'default',
        }}
        onMouseEnter={e => { if (canOpen) e.currentTarget.style.borderColor = '#2a5298' }}
        onMouseLeave={e => { if (canOpen) e.currentTarget.style.borderColor = '#16223a' }}
      >
        <span style={{ fontSize: 15, flexShrink: 0 }}>{client.avatar}</span>
        <span style={{
          fontSize: 11, fontWeight: 700, color: '#c8d0e0', flex: 1, minWidth: 0,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>{client.companyName}</span>
        {hasContract && (
          <span style={{ fontSize: 9, color: '#3a5a8a', fontFamily: 'monospace', flexShrink: 0 }}>${contract.amountPerMonth}/mo</span>
        )}
        <SatisfactionMeter value={client.satisfaction} />
      </div>
    )
  }

  const urgency = ticketUrgency(ticket, now)
  const style = URGENCY_STYLE[urgency]

  return (
    <div style={{
      padding: '10px 12px', margin: '0 0 8px', borderRadius: 6,
      background: '#0a0f1e', border: '1px solid #1a2a4a',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 20 }}>{client.avatar}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#c8d0e0' }}>{client.companyName}</div>
          <div style={{ fontSize: 9, color: '#3a5a8a', marginTop: 2, fontFamily: 'monospace' }}>${contract.amountPerMonth}/mo</div>
        </div>
        <SatisfactionMeter value={client.satisfaction} />
      </div>

      {ticket && (
        <div style={{
          marginTop: 8, padding: '7px 10px', borderRadius: 5,
          background: style.bg, border: `1px solid ${style.color}40`,
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#c8d0e0' }}>{ticket.title}</div>
            <div style={{ fontSize: 9, color: style.color, fontFamily: 'monospace', marginTop: 2 }}>
              {style.label} · {formatRemaining(msRemaining(ticket, now))} left
            </div>
          </div>
          <button
            onClick={onOpen}
            disabled={!canOpen}
            title={canOpen ? undefined : 'Finish your current job/ticket first'}
            style={{
              padding: '4px 12px', fontSize: 9, fontWeight: 700, letterSpacing: 0.5,
              background: canOpen ? '#1a3a5c' : '#0d1220',
              color: canOpen ? '#4a90e2' : '#334',
              border: `1px solid ${canOpen ? '#2a5298' : '#1a1a2a'}`,
              borderRadius: 4, cursor: canOpen ? 'pointer' : 'not-allowed', flexShrink: 0,
            }}
          >OPEN</button>
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
    <div style={{ padding: '14px 14px 4px', borderBottom: '1px solid #1a1a3e', flexShrink: 0 }}>
      <div style={{ fontSize: 9, color: '#2a2a50', letterSpacing: 1.5, fontWeight: 700, marginBottom: 10 }}>
        CLIENT NETWORKS
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
