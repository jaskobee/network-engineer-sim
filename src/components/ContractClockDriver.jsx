/**
 * Invisible driver for the background-contract SLA clock. Renders nothing.
 *
 * CareerContext owns all the ticket-lifecycle state and logic (tickContracts)
 * but has no way to know whether a job-board mission is currently active
 * (that's GameContext state) — and a ticket's SLA clock must pause while one
 * is, so a ticket can never expire through no fault of the player. Mounted
 * once in AppContent (App.jsx), the one place both useGame() and useCareer()
 * are readily available, this component is just the traffic cop: it calls
 * tickContracts on an interval (and once on mount, to catch time elapsed
 * while the tab was closed) and applies any newly-issued ticket's real
 * topology fault via GameContext (CareerContext has no topology access at all).
 */
import { useEffect, useRef } from 'react'
import { useGame } from '../state/GameContext.jsx'
import { useCareer } from '../state/CareerContext.jsx'

const TICK_INTERVAL_MS = 15_000

export default function ContractClockDriver() {
  const { activeMissionId, applyTicketFault } = useGame()
  const { activeTickets, tickContracts, markTicketFaultApplied } = useCareer()

  const activeMissionIdRef = useRef(activeMissionId)
  useEffect(() => { activeMissionIdRef.current = activeMissionId })

  useEffect(() => {
    function check() { tickContracts(activeMissionIdRef.current, Date.now()) }
    check() // catch time elapsed while the tab was closed
    const id = setInterval(check, TICK_INTERVAL_MS)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Apply the fault for any ticket tickContracts just issued but hasn't had
  // its topology mutation applied yet.
  useEffect(() => {
    for (const ticket of Object.values(activeTickets)) {
      if (!ticket.faultApplied) {
        applyTicketFault(ticket)
        markTicketFaultApplied(ticket.id)
      }
    }
  }, [activeTickets, applyTicketFault, markTicketFaultApplied])

  return null
}
