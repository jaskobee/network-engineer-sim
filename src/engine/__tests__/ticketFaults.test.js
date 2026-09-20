/**
 * Every service ticket's fault is REAL state, breaks the network for real, and is fixed with the
 * commands its hint names — all against the real engine (rules/missions.md #8).
 *
 * The shop is built the way mission_local_shop_1 leaves it: router 10.0.10.1, a switch, PC-1/2/3 at
 * 10.0.10.101–103. For each template: the objective is unmet before the fault (a healthy network),
 * met=false after it, and met=true again once the player does the fix — with a ping to prove it.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { Device } from '../../models/Device.js'
import { Topology } from '../../models/Topology.js'
import { CLIEngine } from '../../models/CLIEngine.js'
import { PCCLIEngine } from '../../models/PCCLIEngine.js'
import { deviceCatalog } from '../../data/deviceCatalog.js'
import { SERVICE_TICKET_TEMPLATES, createTicketInstance } from '../../data/serviceTickets.js'
import { buildRuntimeFromDefinition } from '../missionEngine.js'
import { applyTicketFault } from '../ticketFaults.js'

const cat = type => deviceCatalog.find(e => e.type === type)
const run = (eng, dev, ...cmds) => { for (const c of cmds) eng.execute(dev, c) }

let topo, ios, lx, router, sw, pcs, devices

function ticketFor(templateId) {
  const t = SERVICE_TICKET_TEMPLATES.client_local_shop.find(x => x.id === templateId)
  return createTicketInstance('client_local_shop', 'c1', t, 0, 8 * 60_000)
}
const objectiveMet = ticket => {
  const rt = buildRuntimeFromDefinition(ticket)
  const placements = Object.fromEntries(devices.map(d => [d.id, { x: 0, y: 0 }]))
  return rt.checkFn(devices, placements, topo).t1
}
const pingsRouter = pc => topo.checkPing(pc.interfaces[0].ip ?? '0.0.0.0', '10.0.10.1').reachable

beforeEach(() => {
  topo = new Topology(); ios = new CLIEngine(topo); lx = new PCCLIEngine(topo)
  router = new Device(cat('router')); sw = new Device(cat('switch'))
  pcs = [1, 2, 3].map(() => new Device(cat('pc')))
  devices = [router, sw, ...pcs]
  for (const d of devices) { d.powered = true; topo.addDevice(d) }
  topo.connect(`${router.id}:GigabitEthernet0/0`, `${sw.id}:FastEthernet0/1`)
  pcs.forEach((pc, i) => topo.connect(`${sw.id}:FastEthernet0/${i + 2}`, `${pc.id}:Ethernet0/0`))
  run(ios, router, 'enable', 'configure terminal', 'interface GigabitEthernet0/0', 'ip address 10.0.10.1 255.255.255.0', 'no shutdown', 'end')
  pcs.forEach((pc, i) => run(lx, pc, `ip addr add 10.0.10.${101 + i}/24 dev eth0`, 'ip link set eth0 up'))
})

describe('the shop is healthy before any fault', () => {
  it('every PC reaches the router', () => { for (const pc of pcs) expect(pingsRouter(pc)).toBe(true) })
})

describe('ticket_loose_cable_pc2 — a cable comes loose', () => {
  it('pulls the real cable, breaks PC-2, and reconnecting it fixes it', () => {
    const t = ticketFor('ticket_loose_cable_pc2')
    expect(objectiveMet(t)).toBe(true)                                   // cabled → objective already true
    expect(applyTicketFault(topo, t)).toBe(true)
    expect(objectiveMet(t)).toBe(false)
    expect(pcs[1].interfaces[0].connected_to).toBeNull()
    expect(pingsRouter(pcs[1])).toBe(false)
    expect(pingsRouter(pcs[0])).toBe(true)                               // only PC-2 is affected
    topo.connect(`${sw.id}:FastEthernet0/3`, `${pcs[1].id}:Ethernet0/0`)
    expect(objectiveMet(t)).toBe(true)
  })
})

describe('ticket_ip_reset_pc3 — a PC loses its address', () => {
  it('clears the real address and re-addressing it fixes it', () => {
    const t = ticketFor('ticket_ip_reset_pc3')
    expect(applyTicketFault(topo, t)).toBe(true)
    expect(pcs[2].interfaces[0].ip).toBeNull()
    expect(objectiveMet(t)).toBe(false)
    run(lx, pcs[2], 'ip addr add 10.0.10.103/24 dev eth0', 'ip link set eth0 up')
    expect(objectiveMet(t)).toBe(true)
    expect(pingsRouter(pcs[2])).toBe(true)
  })
})

describe('ticket_adapter_off_pc1 — a network adapter is switched off', () => {
  it('disables the real adapter (address kept), the switch port loses carrier, and ip link set up fixes it', () => {
    const t = ticketFor('ticket_adapter_off_pc1')
    expect(objectiveMet(t)).toBe(true)
    expect(applyTicketFault(topo, t)).toBe(true)
    const pc1 = pcs[0].interfaces[0]
    expect(pc1.status).toBe('admin_down')
    expect(pc1.ip).toBe('10.0.10.101')                                   // still addressed — it is switched off, not unconfigured
    expect(sw.getInterface('FastEthernet0/2').status).toBe('down')        // the far end lost carrier
    expect(objectiveMet(t)).toBe(false)
    expect(pingsRouter(pcs[0])).toBe(false)
    run(lx, pcs[0], 'ip link set eth0 up')
    expect(objectiveMet(t)).toBe(true)
    expect(pingsRouter(pcs[0])).toBe(true)
  })

  it('the hint the player is shown is a command that fixes it', () => {
    const t = ticketFor('ticket_adapter_off_pc1')
    const cmd = t.objectives[0].hint.find(h => h.cmd)?.cmd
    expect(cmd).toBe('ip link set eth0 up')
  })
})

describe('ticket_router_lan_down — the router LAN port is shut down', () => {
  it('shuts the real interface, every PC loses the network, and no shutdown restores it', () => {
    const t = ticketFor('ticket_router_lan_down')
    expect(objectiveMet(t)).toBe(true)
    expect(applyTicketFault(topo, t)).toBe(true)
    const lan = router.getInterface('GigabitEthernet0/0')
    expect(lan.status).toBe('admin_down')
    expect(lan.ip).toBe('10.0.10.1')                                     // config intact — administratively shut
    expect(objectiveMet(t)).toBe(false)
    for (const pc of pcs) expect(pingsRouter(pc)).toBe(false)
    run(ios, router, 'enable', 'configure terminal', 'interface GigabitEthernet0/0', 'no shutdown', 'end')
    expect(objectiveMet(t)).toBe(true)
    for (const pc of pcs) expect(pingsRouter(pc)).toBe(true)
  })

  it('the interface state is the one the accuracy spec wants: administratively down, not "down"', () => {
    applyTicketFault(topo, ticketFor('ticket_router_lan_down'))
    expect(router.getInterface('GigabitEthernet0/0').status).toBe('admin_down')
  })
})

describe('applyTicketFault is safe', () => {
  it('returns false (and changes nothing) when the role cannot be found', () => {
    const empty = new Topology()
    expect(applyTicketFault(empty, ticketFor('ticket_loose_cable_pc2'))).toBe(false)
  })
  it('returns false for a ticket with no fault', () => {
    expect(applyTicketFault(topo, { ...ticketFor('ticket_loose_cable_pc2'), fault: null })).toBe(false)
  })
})
