import { describe, it, expect } from 'vitest'
import {
  ticketIssuedNotification, slaWarningNotification, slaExpiredNotification,
  ticketCompletedNotification, clientDormantNotification, setNotificationIdCounter,
} from '../notifications.js'

const client = { id: 'client_local_shop', companyName: "Sam's Corner Store" }
const ticket = { title: "PC-2's network cable came loose", description: 'Reconnect it.' }

describe('notifications', () => {
  it('every factory returns the common shape, unread by default', () => {
    setNotificationIdCounter(0)
    const n = ticketIssuedNotification(client, ticket, 1000)
    expect(n).toMatchObject({
      id: 'note-1',
      clientId: 'client_local_shop',
      kind: 'ticket-issued',
      createdAt: 1000,
      read: false,
    })
    expect(n.subject).toContain("Sam's Corner Store")
    expect(n.body).toContain(ticket.title)
  })

  it('assigns unique ids across factories', () => {
    setNotificationIdCounter(0)
    const a = ticketIssuedNotification(client, ticket, 0)
    const b = slaWarningNotification(client, ticket, 0)
    expect(a.id).not.toBe(b.id)
  })

  it('slaExpiredNotification and clientDormantNotification mention the client by name', () => {
    const expired = slaExpiredNotification(client, ticket, 0)
    expect(expired.kind).toBe('sla-expired')
    expect(expired.body).toContain("Sam's Corner Store")

    const dormant = clientDormantNotification(client, 0)
    expect(dormant.kind).toBe('client-dormant')
    expect(dormant.body).toContain("Sam's Corner Store")
  })

  it('ticketCompletedNotification varies its message by outcome kind', () => {
    const fast = ticketCompletedNotification(client, ticket, 'fast', 0)
    const late = ticketCompletedNotification(client, ticket, 'late', 0)
    expect(fast.body).not.toBe(late.body)
  })
})
