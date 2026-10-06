/**
 * Game save: `schemaVersion` + per-device `domain` (roadmap Phase 0 step 5).
 *
 * S1  every new Device is on-prem
 * S2  a new save writes schemaVersion 1 and domain on every device (legacy + client),
 *     and keeps `version: 2` so existing saves and imports still match
 * S3  a pre-Phase-0 save (no schemaVersion, no domain) loads; its devices are on-prem
 * S4  save → JSON → load → save is lossless
 */
import { describe, it, expect } from 'vitest'
import { Device, createAdminLaptop, createIspDevice } from '../../onprem/Device.js'
import { Topology } from '../../onprem/Topology.js'
import { CLIEngine } from '../../onprem/CLIEngine.js'
import { PCCLIEngine } from '../../guest/PCCLIEngine.js'
import { serialize, deserialize } from '../saveLoad.js'

function lab() {
  const topo = new Topology()
  const r1 = new Device({ type: 'router', model: 'R1', portCount: 2, portPrefix: 'GigabitEthernet0/' })
  const pc = new Device({ type: 'pc', model: 'PC1', portCount: 1, portPrefix: 'Ethernet0/' })
  r1.powered = pc.powered = true
  topo.addDevice(r1); topo.addDevice(pc)
  topo.connect(`${r1.id}:GigabitEthernet0/0`, `${pc.id}:Ethernet0/0`)
  const ios = new CLIEngine(topo), sh = new PCCLIEngine(topo)
  for (const c of ['enable', 'conf t', 'interface GigabitEthernet0/0', 'ip address 192.168.1.1 255.255.255.0', 'no shutdown', 'end'])
    ios.execute(r1, c)
  for (const c of ['ip addr add 192.168.1.10/24 dev eth0', 'ip link set eth0 up', 'ip route add default via 192.168.1.1'])
    sh.execute(pc, c)
  return { topo, r1, pc }
}

const save = (topo, clients = new Map()) =>
  JSON.parse(JSON.stringify(serialize(topo, {}, [], 0, [], null, clients, null, null, {})))

describe('S1 — new devices are on-prem', () => {
  it('constructor, admin laptop and ISP all carry domain onprem', () => {
    expect(new Device({ type: 'pc', model: 'PC', portCount: 1, portPrefix: 'Ethernet0/' }).domain).toBe('onprem')
    expect(createAdminLaptop().domain).toBe('onprem')
    expect(createIspDevice().domain).toBe('onprem')
  })
})

describe('S2 — a new save carries schemaVersion and domain', () => {
  it('top level: schemaVersion 1 next to the unchanged version 2', () => {
    const data = save(lab().topo)
    expect(data.version).toBe(2)
    expect(data.schemaVersion).toBe(1)
  })

  it('every legacy and client device is written with domain onprem', () => {
    const client = lab()
    const data = save(lab().topo, new Map([['client_x', { topology: client.topo }]]))
    expect(data.devices.map(d => d.domain)).toEqual(['onprem', 'onprem'])
    expect(data.clientTopologies.client_x.devices.map(d => d.domain)).toEqual(['onprem', 'onprem'])
  })
})

describe('S3 — a pre-Phase-0 save still loads', () => {
  it('no schemaVersion, no domain → devices restored as on-prem, network intact', () => {
    const { topo, pc } = lab()
    const old = save(topo)
    delete old.schemaVersion
    for (const d of old.devices) delete d.domain

    const back = deserialize(old).topology
    expect([...back.devices.values()].map(d => d.domain)).toEqual(['onprem', 'onprem'])
    const pcBack = back.devices.get(pc.id)
    expect(pcBack.interfaces[0].ip).toBe('192.168.1.10')
    expect(back.checkPing('192.168.1.10', '192.168.1.1').reachable).toBe(true)
  })
})

describe('S4 — round trip is lossless', () => {
  it('save → load → save yields the same devices', () => {
    const first = save(lab().topo)
    const second = save(deserialize(first).topology)
    expect(second.devices).toEqual(first.devices)
    expect(second.schemaVersion).toBe(first.schemaVersion)
  })
})
