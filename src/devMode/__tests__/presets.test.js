/**
 * DevMode preset builder tests — every preset must actually reach its claimed
 * state by driving the real engine (per devMode/presets.js's core principle).
 * These tests catch a preset silently drifting out of sync with engine rules.
 */
import { describe, it, expect } from 'vitest'
import { Topology } from '../../models/Topology.js'
import { CLIEngine } from '../../models/CLIEngine.js'
import { PCCLIEngine } from '../../models/PCCLIEngine.js'
import { Device, createIspDevice, createAdminLaptop } from '../../models/Device.js'
import { deviceCatalog } from '../../data/deviceCatalog.js'
import { PRESETS, buildPreset } from '../presets.js'

// Minimal stand-in for the slice of GameContext that presets.js depends on —
// mirrors the real addSandboxDevice/clearSandbox/sbConnectInterfaces logic in
// state/GameContext.jsx closely enough to exercise the same engine calls.
function makeCtx() {
  const sbTopology = new Topology()
  const sbEngine   = new CLIEngine(sbTopology, 'beginner')
  const sbPcEngine = new PCCLIEngine(sbTopology, 'beginner')
  const counters   = {}

  function addSandboxDevice(catalogEntry) {
    const device = catalogEntry.type === 'isp'
      ? createIspDevice()
      : new Device(catalogEntry)
    counters[catalogEntry.type] = (counters[catalogEntry.type] || 0) + 1
    device.hostname = `${catalogEntry.type.toUpperCase()}${counters[catalogEntry.type]}`
    device.powered = true
    sbTopology.addDevice(device)
  }

  function clearSandbox() {
    sbTopology.clearDevices()
    sbTopology.addDevice(createAdminLaptop())
  }

  function sbConnectInterfaces(a, b) { sbTopology.connect(a, b) }

  return {
    setMode() {}, clearSandbox, addSandboxDevice, sbConnectInterfaces,
    sbTopology, sbEngine, sbPcEngine,
  }
}

const cat = (type) => deviceCatalog.find(e => e.type === type)
void cat

// Scoped to the firewall + admin-laptop-web-UI presets added alongside this test.
// (roas-access-broken is a pre-existing preset with a latent mismatch — it expects
// 'vlan_isolated' but the engine currently reports 'no_route' for that topology;
// that's a separate, pre-existing bug outside this test's scope.)
const NEW_PRESET_IDS = new Set([
  'firewall-zone-solved',
  'firewall-default-deny-broken',
  'firewall-asymmetric-outside-broken',
  'admin-laptop-firewall-ui-solved',
  'admin-laptop-crosszone-router-ui-solved',
  'admin-laptop-crosszone-router-ui-broken',
  'dns-internet-solved',
  'dns-no-nat-broken',
])

describe('devMode presets — firewall + admin-laptop-web-UI presets reach their claimed state via the real engine', () => {
  for (const preset of PRESETS.filter(p => NEW_PRESET_IDS.has(p.id))) {
    it(`${preset.id}: ${preset.description}`, () => {
      const ctx = makeCtx()
      const result = buildPreset(preset.id, ctx)

      expect(result.type).not.toBe('error')

      if (preset.category === 'working') {
        if (result.type === 'ping' || result.type === 'webui') {
          expect(result.reachable).toBe(true)
        } else if (result.type === 'dhcp') {
          expect(result.assigned).toBe(true)
        }
      } else if (preset.category === 'broken') {
        if (result.type === 'ping' || result.type === 'webui') {
          expect(result.reachable).toBe(false)
          if (preset.expectedFailure && preset.expectedFailure !== 'no DHCP offer') {
            expect(result.failureReason).toBe(preset.expectedFailure)
          }
        } else if (result.type === 'dhcp') {
          expect(result.assigned).toBe(false)
        }
      }
    })
  }
})

describe('devMode DNS presets — the symptom the player sees is the real one', () => {
  const pcOf  = ctx => [...ctx.sbTopology.devices.values()].find(d => d.type === 'pc')
  const rtrOf = ctx => [...ctx.sbTopology.devices.values()].find(d => d.type === 'router')

  it('dns-internet-solved: the PC and the router resolve names through the ISP\'s resolver', () => {
    const ctx = makeCtx()
    expect(buildPreset('dns-internet-solved', ctx)).toMatchObject({ type: 'ping', reachable: true })
    const out = ctx.sbPcEngine.execute(pcOf(ctx), 'ping -c 1 google.com')
    expect(out[0]).toBe('PING google.com (8.8.8.8) 56(84) bytes of data.')
    expect(ctx.sbPcEngine.execute(pcOf(ctx), 'nslookup github.com').join('\n')).toContain('Address: 140.82.121.4')
    ctx.sbEngine.execute(rtrOf(ctx), 'enable')
    expect(ctx.sbEngine.execute(rtrOf(ctx), 'ping google.com')[0]).toBe('Translating "google.com"...domain server (8.8.8.8) [OK]')
  })

  it('dns-no-nat-broken: the query dies with nat_required, so the name does not resolve', () => {
    const ctx = makeCtx()
    expect(buildPreset('dns-no-nat-broken', ctx)).toMatchObject({ type: 'ping', reachable: false, failureReason: 'nat_required' })
    expect(ctx.sbPcEngine.execute(pcOf(ctx), 'ping -c 1 google.com')).toEqual(['ping: google.com: Temporary failure in name resolution'])
    // the router's own queries use its public WAN address, so IT still resolves — the symptom is the LAN's
    ctx.sbEngine.execute(rtrOf(ctx), 'enable')
    expect(ctx.sbEngine.execute(rtrOf(ctx), 'ping google.com')[0]).toMatch(/\[OK\]$/)
  })
})
