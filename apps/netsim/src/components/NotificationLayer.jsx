import { useEffect, useState } from 'react'
import { useGame } from '../state/GameContext.jsx'
import { useCareer } from '../state/CareerContext.jsx'
import { useJobBoard } from '../state/useJobBoard.js'
import MissionBriefModal from './MissionBriefModal.jsx'
import DifficultyBars from './DifficultyBars.jsx'
import { IconClose } from './icons.jsx'

// Two kinds of "something happened" the player must not miss, shown top-centre above every window (but below dialogs):
//
//  • Toasts — "Service restored. Sam is happy with your service…" after a problem is fixed. They
//    fade on their own; the same text is kept in the inbox.
//  • A job offer — when a NEW job becomes available (after the game has started) the player is asked:
//    accept it, or decline for now. Declining leaves it on the Career board, quietly, for later.
//
// It also keeps the offer book in step with the job board (the "driver" half — renders nothing for that).

export default function NotificationLayer() {
  const { acceptMission, activeMissionId, activeTicket } = useGame()
  const { company, clients, reputation, toasts, dismissToast, syncJobOffers, resolveJobOffer } = useCareer()
  const { all, availableIds, pendingIds } = useJobBoard()
  const [viewing, setViewing] = useState(null)   // a job opened in full from its offer
  // "Hide for now": the card gets out of the way (it can sit over a window's controls) but the offer stays
  // pending — the Career badge and the "New" tag remain until the player accepts, declines or opens it.
  const [hidden, setHidden] = useState(() => new Set())

  // Tell the offer book what is available. Held back until the career exists (a company and its first
  // client) so a brand-new player's starting jobs are recorded quietly, not announced.
  const careerReady = !!company && Object.keys(clients).length > 0
  useEffect(() => {
    if (careerReady) syncJobOffers(all)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availableIds.join('|'), careerReady])

  const busy = !!activeMissionId || !!activeTicket
  const shownIds = pendingIds.filter(id => !hidden.has(id))
  const offer = all.find(m => m.id === shownIds[0]) ?? null

  function accept(mission) {
    acceptMission(mission.id)
    resolveJobOffer(mission.id, 'accepted')
    setViewing(null)
  }

  return (
    <>
      <div className="toast-stack" aria-live="polite">
        {toasts.map(t => <Toast key={t.id} toast={t} onDismiss={() => dismissToast(t.id)} />)}
        {offer && !viewing && (
          <OfferCard
            mission={offer} more={shownIds.length - 1} busy={busy}
            onAccept={() => accept(offer)}
            onDecline={() => resolveJobOffer(offer.id, 'declined')}
            onView={() => setViewing(offer)}
            onHide={() => setHidden(prev => new Set(prev).add(offer.id))}
          />
        )}
      </div>

      {viewing && (
        <MissionBriefModal
          mission={viewing}
          reputation={reputation}
          onClose={() => setViewing(null)}
          onStart={() => accept(viewing)}
          startBlockedReason={busy ? 'Finish your current job first.' : ''}
        />
      )}
    </>
  )
}

function Toast({ toast, onDismiss }) {
  return (
    <div className={`toast ${toast.kind}`} role="status">
      <i className={`led ${toast.kind === 'success' ? 'green' : 'amber'}`} style={{ width: 10, height: 10, marginTop: 5 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 15.5, fontWeight: 700, color: 'var(--ink)', lineHeight: 1.25 }}>{toast.title}</div>
        <div style={{ fontSize: 14.5, color: 'var(--ink-2)', lineHeight: 1.45, marginTop: 3 }}>{toast.body}</div>
      </div>
      <button className="btn ghost icon" onClick={onDismiss} title="Dismiss" aria-label="Dismiss" style={{ width: 26, height: 26 }}>
        <IconClose size={14} />
      </button>
    </div>
  )
}

function OfferCard({ mission, more, busy, onAccept, onDecline, onView, onHide }) {
  return (
    <div className="toast offer" role="group" aria-label={`New job offer: ${mission.title}`}>
      <i className="led blue" style={{ width: 10, height: 10, marginTop: 5 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13.5, color: 'var(--ink-3)' }}>
          New job{more > 0 ? ` (+${more} more waiting)` : ''}
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginTop: 2 }}>
          <span style={{ fontSize: 17, fontWeight: 700, color: 'var(--ink)', lineHeight: 1.2, flex: 1, minWidth: 0 }}>
            <span style={{ marginRight: 8 }}>{mission.avatar}</span>{mission.title}
          </span>
          <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--ink)', flexShrink: 0 }}>${mission.reward?.toLocaleString()}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 3, fontSize: 14, color: 'var(--ink-3)' }}>
          <span>{mission.client}</span>
          <DifficultyBars level={mission.difficulty} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 11, flexWrap: 'wrap' }}>
          <button className="btn primary" onClick={onAccept} disabled={busy}
            title={busy ? 'Finish your current job first' : 'Start this job now'} style={{ padding: '6px 16px' }}>
            Accept job
          </button>
          <button className="btn" onClick={onDecline} title="It stays on the Career board if you change your mind">
            Decline for now
          </button>
          <button className="btn ghost" onClick={onView}>View details</button>
        </div>
        {busy && <div style={{ fontSize: 13.5, color: 'var(--ink-3)', marginTop: 8 }}>Finish your current job to accept this one.</div>}
      </div>
      <button className="btn ghost icon" onClick={onHide} title="Hide for now — it stays under Career" aria-label="Hide for now" style={{ width: 26, height: 26 }}>
        <IconClose size={14} />
      </button>
    </div>
  )
}
