/**
 * WireFish — packet capture analyser.
 *
 * STATUS: Phase 3 placeholder.
 *
 * Why it isn't built yet (from docs/ADMIN_LAPTOP_AND_TOOLS.md, Hard Rule 3):
 *   "Do NOT post-hoc invent an ARP/ICMP sequence from a BFS path result to ship
 *    faster. If the engine can't emit it truthfully, don't display it."
 *
 * The current engine is a reachability oracle (BFS → yes/no + failureReason).
 * It does not produce packets. A packet analyser must show frames the engine
 * actually emitted — not frames synthesized after the fact from the BFS path.
 *
 * Phase 3a (needed first):
 *   Refactor the engine to be event-emitting: a packet object walks the topology
 *   hop-by-hop; each device processes it (L2 MAC lookup, L3 route lookup, NAT
 *   rewrite, firewall policy) and emits events. The existing Vitest suite
 *   are the spec — any behavioural drift is a bug.
 *
 * Phase 3b (this component, once 3a lands):
 *   Subscribe to the event stream at a chosen capture point and render frames.
 *   The capture point is AN INTERFACE, not global — the laptop's NIC sees what
 *   a real NIC would see on a switched network (SPAN/mirror ports for remote
 *   capture is a later feature).
 */

import { IconPulse } from './icons.jsx'

const PHASES = [
  ['3a', 'Packet/event engine', 'Hop-by-hop packet walk, device processing, event emission. The existing test suite is the spec; every diff from today\'s BFS is a deliberate decision.'],
  ['3b', 'WireFish as first consumer', 'Subscribe to capture events at a specific interface. The capture point is the laptop\'s NIC — what a real NIC on a switched network would see.'],
  ['3c', 'DHCP DORA visualisation', 'Watch Discover die at the router, add ip helper-address, then watch it get relayed as unicast. Makes a described lesson visible.'],
]

const code = { fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--ink)' }

export default function WireFishPanel() {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      minHeight: '100%', background: 'var(--surface-ground)', color: 'var(--ink-2)',
      padding: '36px 24px 40px', overflowY: 'auto',
    }}>
      <div style={{
        width: 56, height: 56, display: 'grid', placeItems: 'center', marginBottom: 16,
        color: 'var(--signal)', background: 'var(--signal-wash)',
        border: '1px solid var(--signal-deep)', borderRadius: 14,
      }}><IconPulse size={28} /></div>

      <h2 style={{ fontSize: 28, fontWeight: 700, color: 'var(--ink)', lineHeight: 1.1 }}>WireFish</h2>
      <div style={{ fontSize: 16, color: 'var(--ink-3)', marginTop: 4, marginBottom: 22 }}>
        Packet capture analyser · Phase 3
      </div>

      <div style={{
        width: '100%', maxWidth: 540, background: 'var(--surface-panel)',
        border: '1px solid var(--rule)', borderRadius: 12, padding: '20px 22px', textAlign: 'left',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 16.5, color: 'var(--ink)', fontWeight: 600, marginBottom: 12 }}>
          <i className="led amber" /> Not available yet — here&apos;s why
        </div>

        <p style={{ fontSize: 15.5, lineHeight: 1.6, margin: '0 0 12px' }}>
          WireFish must only show frames the engine actually produced. Inventing a plausible
          ARP/ICMP sequence from a BFS result and calling it a &quot;capture&quot; would mislead every
          student who trusts this tool to learn packet analysis. That&apos;s the one shortcut we won&apos;t take.
        </p>

        <p style={{ fontSize: 15.5, lineHeight: 1.6, margin: '0 0 16px' }}>
          The current engine is a reachability oracle. It answers <em>&quot;can src reach dst, and why not?&quot;</em> but
          doesn&apos;t walk packets hop by hop. WireFish needs the event-emitting packet engine
          (Phase 3a) before it can display anything truthfully.
        </p>

        <div style={{ borderTop: '1px solid var(--rule)', paddingTop: 12 }}>
          <div style={{ fontSize: 15, color: 'var(--ink)', fontWeight: 600, marginBottom: 4 }}>Phase 3 build order</div>
          {PHASES.map(([phase, title, desc], i) => (
            <div key={phase} className={`step${i === 0 ? ' first' : ''}${i === PHASES.length - 1 ? ' last' : ''}`} style={{ paddingLeft: 0, paddingRight: 0 }}>
              <i className="led step-led" />
              <div className="step-body">
                <div style={{ fontSize: 15.5, color: 'var(--ink)', fontWeight: 600 }}>
                  <span style={{ color: 'var(--ink-3)', marginRight: 8 }}>{phase}</span>{title}
                </div>
                <div style={{ fontSize: 14.5, color: 'var(--ink-3)', lineHeight: 1.5, marginTop: 2 }}>{desc}</div>
              </div>
            </div>
          ))}
        </div>

        <div style={{
          marginTop: 14, padding: '10px 12px', background: 'var(--surface-well)',
          border: '1px solid var(--rule)', borderRadius: 8, fontSize: 14.5, lineHeight: 1.6, color: 'var(--ink-2)',
        }}>
          <strong style={{ color: 'var(--ink)' }}>Until then:</strong> use <code style={code}>ping</code> and
          the device CLI (<code style={code}>show ip route</code>, <code style={code}>show firewall-rules</code>,{' '}
          <code style={code}>show conn</code>) to diagnose network behaviour.
          The fault-injection missions are designed around exactly these tools.
        </div>
      </div>
    </div>
  )
}
