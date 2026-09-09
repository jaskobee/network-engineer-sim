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
import { Section, relativeTime } from './AdminLaptopShared.jsx'

const URGENCY_COLOR = { safe: '#50fa7b', warning: '#ffb86c', overdue: '#ff8855', expired: '#ff5555' }
const NOTIFICATION_ICON = {
  'ticket-issued':    '🔧',
  'sla-warning':      '⚠️',
  'sla-expired':      '⛔',
  'ticket-completed': '✅',
  'client-dormant':   '💤',
}
const DAY_MS = 24 * 60 * 60 * 1000

function formatRemaining(ms) {
  if (ms <= 0) return '0:00'
  const totalSec = Math.floor(ms / 1000)
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

// ── Stat card row ─────────────────────────────────────────────────────────────

function StatCard({ label, value, sub, color }) {
  return (
    <div style={{ background: '#0a0f18', border: '1px solid #1a2a3e', borderRadius: 8, padding: '12px 14px', minWidth: 0 }}>
      <div style={{ fontSize: 9, color: '#557', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 19, fontWeight: 700, color: color || '#c8d8e8', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value}</div>
      {sub && <div style={{ fontSize: 9, color: '#557', marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sub}</div>}
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
  const color = URGENCY_COLOR[urgency] ?? '#4a90e2'
  const remainingLabel = elapsed <= SLA_DURATION_MS
    ? `${formatRemaining(SLA_DURATION_MS - elapsed)} left`
    : elapsed <= totalSpan
      ? `${formatRemaining(totalSpan - elapsed)} grace left`
      : 'expired'

  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
        <span style={{ fontSize: 10, color: '#8ab4d4' }}>
          <span style={{ marginRight: 5 }}>{client.avatar}</span>
          <strong style={{ color: '#c8d8e8' }}>{client.companyName}</strong> — {ticket.title}
        </span>
        <span style={{ fontSize: 9, color, fontFamily: 'monospace', flexShrink: 0, marginLeft: 8 }}>{remainingLabel}</span>
      </div>
      <div style={{ position: 'relative', height: 16, borderRadius: 4, overflow: 'hidden', background: '#0a0f18', border: '1px solid #1a2a3e' }}>
        <div style={{ position: 'absolute', left: `${slaPct}%`, right: 0, top: 0, bottom: 0, background: '#1a1206' }} />
        <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${nowPct}%`, background: color, opacity: 0.35 }} />
        <div style={{ position: 'absolute', left: `${slaPct}%`, top: 0, bottom: 0, width: 1, background: '#557' }} title="SLA deadline" />
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
    <Section title="Active Incidents">
      {rows.length === 0 ? (
        <div style={{ fontSize: 10, color: '#557', padding: '6px 0' }}>No open incidents — nice work.</div>
      ) : (
        rows.map(({ ticket, client }) => <IncidentRow key={ticket.id} ticket={ticket} client={client} now={now} />)
      )}
    </Section>
  )
}

// ── Client happiness ──────────────────────────────────────────────────────────

function SatisfactionRing({ value }) {
  const r = 32, circumference = 2 * Math.PI * r
  const pct = Math.max(0, Math.min(100, value))
  const offset = circumference * (1 - pct / 100)
  const color = pct >= 70 ? '#50fa7b' : pct >= 35 ? '#ffb86c' : '#ff5555'
  return (
    <svg width={84} height={84} viewBox="0 0 84 84" style={{ flexShrink: 0 }}>
      <circle cx={42} cy={42} r={r} fill="none" stroke="#1a2a3e" strokeWidth={7} />
      <circle
        cx={42} cy={42} r={r} fill="none" stroke={color} strokeWidth={7}
        strokeDasharray={circumference} strokeDashoffset={offset}
        strokeLinecap="round" transform="rotate(-90 42 42)"
      />
      <text x={42} y={47} textAnchor="middle" fontSize={15} fontWeight={700} fill={color} fontFamily="monospace">
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
    <Section title="Client Happiness">
      {list.length === 0 ? (
        <div style={{ fontSize: 10, color: '#557', padding: '6px 0' }}>No clients yet — accept your first job to get started.</div>
      ) : (
        <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
          <SatisfactionRing value={avg ?? 0} />
          <div style={{ flex: 1, minWidth: 0 }}>
            {list.map(c => (
              <div key={c.id} style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0',
                opacity: c.dormant ? 0.5 : 1, filter: c.dormant ? 'grayscale(1)' : 'none',
              }}>
                <span style={{ fontSize: 13, flexShrink: 0 }}>{c.avatar}</span>
                <span style={{
                  fontSize: 10, color: '#c8d8e8', flex: 1, minWidth: 0,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>{c.companyName}{c.dormant ? ' (dormant)' : ''}</span>
                <SatisfactionMeter value={c.satisfaction} />
              </div>
            ))}
          </div>
        </div>
      )}
    </Section>
  )
}

// ── Missions progress + weekly earnings ───────────────────────────────────────

function MissionsProgressWidget({ completedMissions, clients }) {
  const total = MISSIONS.length + Object.keys(MISSION_DEFINITIONS).length
  const done = completedMissions.length
  const pct = total > 0 ? Math.round((done / total) * 100) : 0
  const pipeline = Object.values(clients).reduce((s, c) => s + (c.availableFutureMissionIds?.length ?? 0), 0)

  return (
    <Section title="Missions Progress">
      <div style={{ fontSize: 18, fontWeight: 700, color: '#c8d8e8', fontFamily: 'monospace', marginBottom: 4 }}>
        {done} <span style={{ fontSize: 11, color: '#557' }}>/ {total} complete</span>
      </div>
      <div style={{ height: 6, borderRadius: 3, background: '#0d0d20', overflow: 'hidden', marginBottom: 8 }}>
        <div style={{ width: `${pct}%`, height: '100%', background: '#4a90e2' }} />
      </div>
      <div style={{ fontSize: 9, color: '#557' }}>
        {pipeline > 0 ? `${pipeline} client mission${pipeline === 1 ? '' : 's'} in your pipeline` : 'No new client missions queued right now'}
      </div>
    </Section>
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
    <Section title="Weekly Earnings">
      <div style={{ fontSize: 14, fontWeight: 700, color: '#50fa7b', fontFamily: 'monospace', marginBottom: 8 }}>
        ${weekTotal.toLocaleString()} <span style={{ fontSize: 9, color: '#557', fontWeight: 400 }}>last 7 days</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 5, height: 58 }}>
        {buckets.map((v, i) => (
          <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
            <div title={`$${v.toLocaleString()}`} style={{
              width: '100%', maxWidth: 20, borderRadius: '3px 3px 0 0',
              height: Math.max(2, (v / max) * 42),
              background: v > 0 ? '#4a90e2' : '#141c2a',
            }} />
            <span style={{ fontSize: 8, color: '#557' }}>{labels[i]}</span>
          </div>
        ))}
      </div>
    </Section>
  )
}

// ── Recent activity ────────────────────────────────────────────────────────────

function RecentActivityWidget({ notifications, completedMissions, ticketHistory, onOpenInbox }) {
  const rows = [
    ...notifications.map(n => ({ id: n.id, icon: NOTIFICATION_ICON[n.kind] ?? '📩', text: n.subject, ts: n.createdAt })),
    ...completedMissions.filter(m => m.completedAt).map(m => ({
      id: `mission-${m.id}-${m.completedAt}`, icon: '🏆',
      text: `Mission complete — earned $${(m.reward + (m.refund || 0)).toLocaleString()}`, ts: m.completedAt,
    })),
    ...ticketHistory.map((t, i) => ({
      id: `ticket-${i}-${t.completedAt}`, icon: '✅',
      text: `Ticket resolved: ${t.title} (+$${t.reward})`, ts: t.completedAt,
    })),
  ].sort((a, b) => b.ts - a.ts).slice(0, 5)

  return (
    <Section title="Recent Activity">
      {rows.length === 0 ? (
        <div style={{ fontSize: 10, color: '#557', padding: '6px 0' }}>No activity yet.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {rows.map(r => (
            <div key={r.id} style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
              <span style={{ fontSize: 12, flexShrink: 0 }}>{r.icon}</span>
              <span style={{ fontSize: 10, color: '#8ab', flex: 1, minWidth: 0 }}>{r.text}</span>
              <span style={{ fontSize: 9, color: '#446', flexShrink: 0 }}>{relativeTime(r.ts)}</span>
            </div>
          ))}
        </div>
      )}
      <button
        onClick={onOpenInbox}
        style={{
          marginTop: 10, fontSize: 9, color: '#4a90e2', background: 'transparent',
          border: 'none', cursor: 'pointer', padding: 0,
        }}
      >View all in Inbox →</button>
    </Section>
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
  const monthlyRecurringRevenue = Object.values(contracts)
    .filter(c => c.active)
    .reduce((s, c) => s + c.amountPerMonth, 0)

  return (
    <div style={{ padding: 24, color: '#8ab', fontFamily: 'monospace' }}>
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: '#c8d8e8', marginBottom: 4 }}>📊 Dashboard</div>
        <div style={{ fontSize: 10, color: '#557' }}>Your business, at a glance — updates in real time as you work.</div>
      </div>

      {!setupComplete && (
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          background: '#1a1206', border: '1px solid #4a3510', borderRadius: 6,
          padding: '8px 14px', marginBottom: 20, fontSize: 10, color: '#ffb86c',
        }}>
          <span>⚠ Laptop setup incomplete — {setupDone}/{setupSteps.length} steps done</span>
          <button onClick={onOpenGuide} style={{ background: 'transparent', border: '1px solid #4a3510', color: '#ffb86c', borderRadius: 3, padding: '2px 8px', fontSize: 9, cursor: 'pointer' }}>
            See the Guide →
          </button>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 10, marginBottom: 20 }}>
        <StatCard label="Balance" value={`$${budget.toLocaleString()}`} color="#50fa7b" />
        <StatCard label="Total Earned" value={`$${totalEarned.toLocaleString()}`} sub="missions + tickets" />
        <StatCard label="Monthly Recurring" value={`$${monthlyRecurringRevenue.toLocaleString()}/mo`} sub={`${Object.values(contracts).filter(c => c.active).length} active contract(s)`} />
        <StatCard label="Reputation" value={reputation} color="#8ab4d4" sub={tier.label} />
      </div>
      <div style={{ marginTop: -12, marginBottom: 20 }}>
        <div style={{ height: 5, borderRadius: 3, background: '#0d0d20', overflow: 'hidden' }}>
          <div style={{ width: `${tierProgressPct}%`, height: '100%', background: '#8ab4d4' }} />
        </div>
        <div style={{ fontSize: 8, color: '#446', marginTop: 3 }}>
          {nextTier ? `${nextTier.min - reputation} reputation to ${nextTier.label}` : 'Max tier reached'}
        </div>
      </div>

      <ActiveIncidentsWidget clients={clients} activeTickets={activeTickets} now={now} />
      <ClientHappinessWidget clients={clients} />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 20 }}>
        <MissionsProgressWidget completedMissions={completedMissions} clients={clients} />
        <EarningsWidget completedMissions={completedMissions} ticketHistory={ticketHistory} />
      </div>

      <RecentActivityWidget
        notifications={notifications} completedMissions={completedMissions} ticketHistory={ticketHistory}
        onOpenInbox={onOpenInbox}
      />
    </div>
  )
}
