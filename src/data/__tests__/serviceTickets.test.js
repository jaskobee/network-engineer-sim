import { describe, it, expect } from 'vitest'
import {
  SERVICE_TICKET_TEMPLATES, pickTicketTemplate, createTicketInstance, setTicketIdCounter,
} from '../serviceTickets.js'

describe('serviceTickets', () => {
  it('has at least one template for client_local_shop, each with objectives and a fault', () => {
    const templates = SERVICE_TICKET_TEMPLATES.client_local_shop
    expect(templates.length).toBeGreaterThan(0)
    for (const t of templates) {
      expect(t.objectives.length).toBeGreaterThan(0)
      expect(t.fault).toBeTruthy()
      expect(t.fault.role).toBeTruthy()
      expect(t.reward).toBeGreaterThan(0)
    }
  })

  it('pickTicketTemplate returns a template belonging to the requested client', () => {
    const picked = pickTicketTemplate('client_local_shop')
    expect(SERVICE_TICKET_TEMPLATES.client_local_shop).toContain(picked)
  })

  it('pickTicketTemplate returns null for an unknown client', () => {
    expect(pickTicketTemplate('nonexistent_client')).toBeNull()
  })

  it('createTicketInstance builds a fresh, unresolved, unpaused ticket from a template', () => {
    setTicketIdCounter(0)
    const template = SERVICE_TICKET_TEMPLATES.client_local_shop[0]
    const ticket = createTicketInstance('client_local_shop', 'contract-1', template, 1000, 8000)
    expect(ticket.id).toBe('ticket-1')
    expect(ticket.clientId).toBe('client_local_shop')
    expect(ticket.contractId).toBe('contract-1')
    expect(ticket.templateId).toBe(template.id)
    expect(ticket.issuedAt).toBe(1000)
    expect(ticket.deadlineAt).toBe(9000)
    expect(ticket.pausedMs).toBe(0)
    expect(ticket.faultApplied).toBe(false)
    expect(ticket.status).toBe('open')
    expect(ticket.notifiedStages).toEqual([])
    expect(ticket.objectives).toBe(template.objectives)
  })

  it('createTicketInstance assigns unique, incrementing ids', () => {
    setTicketIdCounter(0)
    const template = SERVICE_TICKET_TEMPLATES.client_local_shop[0]
    const a = createTicketInstance('client_local_shop', 'contract-1', template, 0, 8000)
    const b = createTicketInstance('client_local_shop', 'contract-1', template, 0, 8000)
    expect(a.id).not.toBe(b.id)
  })
})
