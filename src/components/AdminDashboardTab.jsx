/**
 * Admin Laptop — Dashboard tab. The default tab: a real-time overview of the
 * player's business (balance, reputation, open SLA incidents, client
 * happiness, mission progress, recent activity). Every number here reads
 * directly from GameContext/CareerContext — nothing decorative or invented,
 * matching the rest of this game's "never fake data" convention. "Uptime" is
 * deliberately not shown: there's no historical up/down log anywhere in this
 * codebase, only current live interface status, so a fabricated uptime
 * percentage would misrepresent real data.
 */
import { useState, useEffect } from 'react'
import { useGame } from '../state/GameContext.jsx'
import { useCareer } from '../state/CareerContext.jsx'
import { tierForScore, REPUTATION_TIERS } from '../engine/reputation.js'
import { ticketUrgency, SLA_DURATION_MS, TICKET_GRACE_MS } from '../engine/contractClock.js'
import { MISSIONS } from '../data/missions.js'
import { MISSION_DEFINITIONS } from '../data/missionDefinitions/index.js'
import SatisfactionMeter from './SatisfactionMeter.jsx'
import { Card, relativeTime } from './AdminLaptopShared.jsx'

const URGENCY_COLOR = { safe: '#3ee08f', warning: '#ffb42e', overdue: '#ff8a4a', expired: '#ff6259' }
const URGENCY_LED = { safe: 'green', warning: 'amber', overdue: 'amber', expired: 'red' }
// Activity kinds are told apart by the same LED colours used everywhere else.
const KIND_LED = {
  'ticket-issued': 'blue', 'sla-warning': 'amber', 'sla-expired': 'red',
  'ticket-completed': 'green', 'client-dormant': '', mission: 'green',
}
const DAY_MS = 24 * 60 * 60 * 1000

function formatRemaining(ms) {
  if (ms <= 0) return '0:00'
  const totalSec = Math.floor(ms / 1000)
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

const emptyNote = { fontSize: 14.5, color: 'var(--ink-3)', display: 'flex', alignItems: 'center', gap: 9 }

// ── Stat cards ────────────────────────────────────────────────────────────────

function StatCard({ label, value, sub, big, children }) {
  return (
    <div style={{
      background: 'var(--surface-panel)', border: '1px solid var(--rule)', borderRadius: 10,
      padding: '13px 16px', minWidth: 0,
    }}>
      <div style={{ fontSize: 14, color: 'var(--ink-3)', marginBottom: 4 }}>{label}</div>
      <div style={{
        fontSize: big ? 34 : 28, fontWeight: 700, color: 'var(--ink)', lineHeight: 1.1,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>{value}</div>
      {sub && <div style={{ fontSize: 13.5, color: 'var(--ink-3)', marginTop: 5 }}>{sub}</div>}
      {children}
    </div>
  )
}

// ── Active incidents (SLA ticket timeline) ────────────────────────────────────

function IncidentRow({ client, ticket, now }) {
  const elapsed = Math.max(0, (now - ticket.issuedAt) - (ticket.pausedMs ?? 0))
  const totalSpan = SLA_DURATION_MS + TICKET_GRACE_MS
  const nowPct = Math.min(100, (elapsed / totalSpan) * 100)
  const slaPct = (SLA_DURATION_MS / totalSpan) * 100
  const urgency = ticketUrgency(ticket, now)
  const color = URGENCY_COLOR[urgency] ?? '#4da6ff'
  const remainingLabel = elapsed <= SLA_DURATION_MS
    ? `${formatRemaining(SLA_DURATION_MS - elapsed)} left`
    : elapsed <= totalSpan
      ? `${formatRemaining(totalSpan - elapsed)} grace left`
      : 'Expired'

  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10, marginBottom: 6 }}>
        <span style={{ fontSize: 15, color: 'var(--ink-2)', minWidth: 0 }}>
          <span style={{ marginRight: 6 }}>{client.avatar}</span>
          <strong style={{ color: 'var(--ink)', fontWeight: 600 }}>{client.companyName}</strong> · {ticket.title}
        </span>
        <span style={{ fontSize: 14, fontWeight: 600, color, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 7 }}>
          <i className={`led ${URGENCY_LED[urgency] ?? ''}`} style={{ width: 7, height: 7 }} />
          {remainingLabel}
        </span>
      </div>
      <div style={{ position: 'relative', height: 12, borderRadius: 6, overflow: 'hidden', background: 'var(--surface-well)', border: '1px solid var(--rule)' }}>
        <div style={{ position: 'absolute', left: `${slaPct}%`, right: 0, top: 0, bottom: 0, background: '#241c0b' }} />
        <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${nowPct}%`, background: color, opacity: 0.4 }} />
        <div style={{ position: 'absolute', left: `${slaPct}%`, top: 0, bottom: 0, width: 1, background: 'var(--ink-3)' }} title="SLA deadline" />
        <div style={{ position: 'absolute', left: `calc(${nowPct}% - 1px)`, top: 0, bottom: 0, width: 2, background: color }} />
      </div>
    </div>
  )
}

function ActiveIncidentsWidget({ clients, activeTickets, now }) {
  const rows = Object.values(activeTickets)
    .map(ticket => ({ ticket, client: clients[ticket.clientId] }))
    .filter(r => !!r.client)
  return (
    <Card title="Active incidents" note={rows.length > 0 ? `${rows.length} open` : undefined}>
      {rows.length === 0 ? (
        <div style={emptyNote}><i className="led green" />All clear — no open incidents.</div>
      ) : (
        rows.map(({ ticket, client }) => <IncidentRow key={ticket.id} ticket={ticket} client={client} now={now} />)
      )}
    </Card>
  )
}

// ── Client happiness ──────────────────────────────────────────────────────────

function SatisfactionRing({ value }) {
  const r = 34, circumference = 2 * Math.PI * r
  const pct = Math.max(0, Math.min(100, value))
  const offset = circumference * (1 - pct / 100)
  const color = pct >= 70 ? '#3ee08f' : pct >= 35 ? '#ffb42e' : '#ff6259'
  return (
    <svg width={90} height={90} viewBox="0 0 90 90" style={{ flexShrink: 0 }} role="img" aria-label={`Average satisfaction ${Math.round(pct)} percent`}>
      <circle cx={45} cy={45} r={r} fill="none" stroke="#2c3b46" strokeWidth={8} />
      <circle
        cx={45} cy={45} r={r} fill="none" stroke={color} strokeWidth={8}
        strokeDasharray={circumference} strokeDashoffset={offset}
        strokeLinecap="round" transform="rotate(-90 45 45)"
      />
      <text x={45} y={51} textAnchor="middle" fontSize={20} fontWeight={700} fill="#e8eef2" fontFamily="var(--font-ui)">
        {Math.round(pct)}%
      </text>
    </svg>
  )
}

function ClientHappinessWidget({ clients }) {
  const list = Object.values(clients)
  const active = list.filter(c => !c.dormant)
  const avg = active.length > 0 ? active.reduce((s, c) => s + c.satisfaction, 0) / active.length : null

  return (
    <Card title="Client happiness" note={active.length > 0 ? `${active.length} active` : undefined}>
      {list.length === 0 ? (
        <div style={emptyNote}>No clients yet — accept your first job to get started.</div>
      ) : (
        <div style={{ display: 'flex', gap: 18, alignItems: 'center' }}>
          <SatisfactionRing value={avg ?? 0} />
          <div style={{ flex: 1, minWidth: 0 }}>
            {list.map(c => (
              <div key={c.id} style={{
                display: 'flex', alignItems: 'center', gap: 9, padding: '5px 0',
                opacity: c.dormant ? 0.55 : 1, filter: c.dormant ? 'grayscale(1)' : 'none',
              }}>
                <span style={{ fontSize: 17, flexShrink: 0 }}>{c.avatar}</span>
                <span style={{
                  fontSize: 15, color: 'var(--ink)', flex: 1, minWidth: 0,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>{c.companyName}{c.dormant ? ' (dormant)' : ''}</span>
                <SatisfactionMeter value={c.satisfaction} />
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  )
}

// ── Missions progress + weekly earnings ───────────────────────────────────────

function MissionsProgressWidget({ completedMissions, clients }) {
  const total = MISSIONS.length + Object.keys(MISSION_DEFINITIONS).length
  const done = completedMissions.length
  const pct = total > 0 ? Math.round((done / total) * 100) : 0
  const pipeline = Object.values(clients).reduce((s, c) => s + (c.availableFutureMissionIds?.length ?? 0), 0)

  return (
    <Card title="Missions">
      <div style={{ fontSize: 26, fontWeight: 700, color: 'var(--ink)', lineHeight: 1.1, marginBottom: 8 }}>
        {done} <span style={{ fontSize: 15, fontWeight: 400, color: 'var(--ink-3)' }}>of {total} complete</span>
      </div>
      <div style={{ height: 6, borderRadius: 3, background: 'var(--rule-strong)', overflow: 'hidden', marginBottom: 10 }}>
        <div style={{ width: `${pct}%`, height: '100%', background: 'var(--signal)' }} />
      </div>
      <div style={{ fontSize: 14, color: 'var(--ink-3)' }}>
        {pipeline > 0 ? `${pipeline} client mission${pipeline === 1 ? '' : 's'} in your pipeline` : 'No new client missions queued right now'}
      </div>
    </Card>
  )
}

function bucketEarningsByDay(entries) {
  const buckets = Array(7).fill(0)
  const now = Date.now()
  for (const e of entries) {
    const dayIndex = Math.floor((now - e.completedAt) / DAY_MS)
    if (dayIndex >= 0 && dayIndex < 7) buckets[6 - dayIndex] += e.amount
  }
  return buckets
}

function EarningsWidget({ completedMissions, ticketHistory }) {
  const entries = [
    ...completedMissions.filter(m => m.completedAt).map(m => ({ completedAt: m.completedAt, amount: m.reward + (m.refund || 0) })),
    ...ticketHistory.map(t => ({ completedAt: t.completedAt, amount: t.reward })),
  ]
  const buckets = bucketEarningsByDay(entries)
  const max = Math.max(1, ...buckets)
  const labels = Array.from({ length: 7 }, (_, i) =>
    new Date(Date.now() - (6 - i) * DAY_MS).toLocaleDateString(undefined, { weekday: 'short' }).slice(0, 2))
  const weekTotal = buckets.reduce((s, v) => s + v, 0)

  return (
    <Card title="Earnings" note="Last 7 days">
      <div style={{ fontSize: 26, fontWeight: 700, color: 'var(--ink)', lineHeight: 1.1, marginBottom: 10 }}>
        ${weekTotal.toLocaleString()}
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 62 }}>
        {buckets.map((v, i) => (
          <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5 }}>
            <div title={`$${v.toLocaleString()}`} style={{
              width: '100%', maxWidth: 26, borderRadius: '3px 3px 0 0',
              height: Math.max(3, (v / max) * 42),
              background: v > 0 ? 'var(--signal)' : 'var(--rule-strong)',
            }} />
            <span style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>{labels[i]}</span>
          </div>
        ))}
      </div>
    </Card>
  )
}

// ── Recent activity ────────────────────────────────────────────────────────────

function RecentActivityWidget({ notifications, completedMissions, ticketHistory, onOpenInbox }) {
  const rows = [
    ...notifications.map(n => ({ id: n.id, led: KIND_LED[n.kind] ?? '', text: n.subject, ts: n.createdAt })),
    ...completedMissions.filter(m => m.completedAt).map(m => ({
      id: `mission-${m.id}-${m.completedAt}`, led: KIND_LED.mission,
      text: `Mission complete — earned $${(m.reward + (m.refund || 0)).toLocaleString()}`, ts: m.completedAt,
    })),
    ...ticketHistory.map((t, i) => ({
      id: `ticket-${i}-${t.completedAt}`, led: KIND_LED['ticket-completed'],
      text: `Ticket resolved: ${t.title} (+$${t.reward})`, ts: t.completedAt,
    })),
  ].sort((a, b) => b.ts - a.ts).slice(0, 5)

  return (
    <Card
      title="Recent activity"
      note={<button className="btn ghost" onClick={onOpenInbox} style={{ padding: '1px 8px', fontSize: 13.5 }}>Open inbox</button>}
    >
      {rows.length === 0 ? (
        <div style={emptyNote}>Nothing yet. Accept a job and your activity shows up here.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
          {rows.map(r => (
            <div key={r.id} style={{ display: 'flex', gap: 10, alignItems: 'baseline' }}>
              <i className={`led ${r.led}`} style={{ width: 7, height: 7, alignSelf: 'center' }} />
              <span style={{ fontSize: 15, color: 'var(--ink-2)', flex: 1, minWidth: 0 }}>{r.text}</span>
              <span style={{ fontSize: 13.5, color: 'var(--ink-3)', flexShrink: 0 }}>{relativeTime(r.ts)}</span>
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}

// ── Panel root ────────────────────────────────────────────────────────────────

export default function AdminDashboardTab({ cabled, powered, hasIp, hasGw, onOpenGuide, onOpenInbox }) {
  const { budget, completedMissions } = useGame()
  const { reputation, clients, contracts, activeTickets, notifications, ticketHistory } = useCareer()

  const hasOpenTickets = Object.keys(activeTickets).length > 0
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (!hasOpenTickets) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [hasOpenTickets])

  const setupSteps = [cabled, powered, hasIp, hasGw]
  const setupDone = setupSteps.filter(Boolean).length
  const setupComplete = setupDone === setupSteps.length

  const tier = tierForScore(reputation)
  const tierIndex = REPUTATION_TIERS.findIndex(t => t.label === tier.label)
  const nextTier = REPUTATION_TIERS[tierIndex + 1]
  const tierProgressPct = nextTier
    ? Math.max(0, Math.min(100, ((reputation - tier.min) / (nextTier.min - tier.min)) * 100))
    : 100

  const totalEarned = completedMissions.reduce((s, m) => s + m.reward + (m.refund || 0), 0)
    + ticketHistory.reduce((s, t) => s + t.reward, 0)
  const activeContracts = Object.values(contracts).filter(c => c.active)
  const monthlyRecurringRevenue = activeContracts.reduce((s, c) => s + c.amountPerMonth, 0)

  return (
    <div style={{ padding: '22px 24px 28px', color: 'var(--ink-2)' }}>
      <div style={{ marginBottom: 18 }}>
        <h2 style={{ fontSize: 26, fontWeight: 700, color: 'var(--ink)', lineHeight: 1.1 }}>Dashboard</h2>
        <div style={{ fontSize: 15, color: 'var(--ink-3)', marginTop: 4 }}>Your business at a glance. Updates as you work.</div>
      </div>

      {!setupComplete && (
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12,
          background: '#1d1608', border: '1px solid #4a3812', borderRadius: 10,
          padding: '9px 14px', marginBottom: 16, fontSize: 15, color: 'var(--ink)',
        }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <i className="led amber" />
            Laptop setup incomplete — {setupDone} of {setupSteps.length} steps done
          </span>
          <button className="btn" onClick={onOpenGuide} style={{ padding: '3px 12px' }}>Open guide</button>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12, marginBottom: 12 }}>
        <StatCard big label="Balance" value={`$${budget.toLocaleString()}`} />
        <StatCard label="Total earned" value={`$${totalEarned.toLocaleString()}`} sub="Missions and tickets" />
        <StatCard
          label="Monthly recurring" value={`$${monthlyRecurringRevenue.toLocaleString()}/mo`}
          sub={`${activeContracts.length} active contract${activeContracts.length === 1 ? '' : 's'}`}
        />
        <StatCard label="Reputation" value={reputation} sub={tier.label}>
          <div style={{ height: 5, borderRadius: 3, background: 'var(--rule-strong)', overflow: 'hidden', marginTop: 10 }}>
            <div style={{ width: `${tierProgressPct}%`, height: '100%', background: 'var(--signal)' }} />
          </div>
          <div style={{ fontSize: 13, color: 'var(--ink-3)', marginTop: 5 }}>
            {nextTier ? `${nextTier.min - reputation} to next tier` : 'Max tier reached'}
          </div>
        </StatCard>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <ActiveIncidentsWidget clients={clients} activeTickets={activeTickets} now={now} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 12 }}>
          <ClientHappinessWidget clients={clients} />
          <EarningsWidget completedMissions={completedMissions} ticketHistory={ticketHistory} />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 12 }}>
          <MissionsProgressWidget completedMissions={completedMissions} clients={clients} />
          <RecentActivityWidget
            notifications={notifications} completedMissions={completedMissions} ticketHistory={ticketHistory}
            onOpenInbox={onOpenInbox}
          />
        </div>
      </div>
    </div>
  )
}
