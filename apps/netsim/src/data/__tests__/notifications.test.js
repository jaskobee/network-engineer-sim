import { describe, it, expect } from 'vitest'
import {
  ticketIssuedNotification, slaWarningNotification, slaExpiredNotification,
  ticketCompletedNotification, clientDormantNotification, setNotificationIdCounter,
  ticketReminderNotification, ticketResolutionMessage, newJobNotification,
} from '../notifications.js'
import { clientContactName } from '../clients.js'

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

  it('ticketReminderNotification counts up, and a late ticket says it is overdue', () => {
    const r1 = ticketReminderNotification(client, ticket, 0, { urgency: 'safe', number: 1 })
    expect(r1.kind).toBe('ticket-reminder')
    expect(r1.subject).toMatch(/^Reminder:/)
    const late = ticketReminderNotification(client, ticket, 0, { urgency: 'overdue', number: 2 })
    expect(late.subject).toMatch(/^Overdue:/)
    expect(late.body).not.toBe(r1.body)
  })

  it('newJobNotification names the job and says what to do', () => {
    const n = newJobNotification({ id: 'm', title: 'Getting Online', client: "Sam's Corner Store", clientId: 'c' }, 5)
    expect(n.kind).toBe('new-job')
    expect(n.subject).toContain('Getting Online')
    expect(n.body).toMatch(/accept or decline/i)
  })

  it('ids never move backwards (a reload must not reuse a saved id)', () => {
    setNotificationIdCounter(50)
    const a = ticketIssuedNotification(client, ticket, 0)
    setNotificationIdCounter(3)                                         // a lower value is ignored
    const b = ticketIssuedNotification(client, ticket, 0)
    expect(a.id).toBe('note-51')
    expect(b.id).toBe('note-52')
  })
})

describe('the message the player gets when a problem is fixed', () => {
  const fixedTicket = { title: 'PC-2 cable', resolution: 'Cable is connected again and service is restored.' }
  it('names the contact, the reputation and the money — and says what was fixed', () => {
    const { title, body } = ticketResolutionMessage(client, fixedTicket, 'ontime', 5, 60)
    expect(title).toBe('Service restored')
    expect(body).toBe("Cable is connected again and service is restored. Sam is happy with your service. You gained 5 reputation and earned $60.")
  })
  it('a quick fix is celebrated', () => {
    expect(ticketResolutionMessage(client, fixedTicket, 'fast', 15, 60).body).toMatch(/Sam is delighted with how quickly you responded\. You gained 15 reputation/)
  })
  it('a late fix is honest: reputation is lost, the fee is still paid', () => {
    const b = ticketResolutionMessage(client, fixedTicket, 'late', -5, 60).body
    expect(b).toMatch(/took longer than agreed/)
    expect(b).toMatch(/You lost 5 reputation, but earned \$60\./)
  })
  it('falls back to a plain line when a ticket has no resolution text', () => {
    expect(ticketResolutionMessage(client, { title: 't' }, 'ontime', 5, 0).body).toMatch(/^The problem is fixed and service is restored\./)
  })
  it('the inbox copy carries the same message', () => {
    const n = ticketCompletedNotification(client, fixedTicket, 'ontime', 0, { gained: 5, reward: 60 })
    expect(n.body).toContain('Cable is connected again')
    expect(n.body).toContain('You gained 5 reputation')
  })
})

describe('clientContactName', () => {
  it('uses the stored contact, else the owner in "Sam\'s Corner Store", else the company', () => {
    expect(clientContactName({ contactName: 'Priya', companyName: 'X' })).toBe('Priya')
    expect(clientContactName({ companyName: "Sam's Corner Store" })).toBe('Sam')
    expect(clientContactName({ companyName: 'Acme Ltd' })).toBe('Acme Ltd')
  })
})
