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
 *   rewrite, firewall policy) and emits events. The existing 379 Vitest tests
 *   are the spec — any behavioural drift is a bug.
 *
 * Phase 3b (this component, once 3a lands):
 *   Subscribe to the event stream at a chosen capture point and render frames.
 *   The capture point is AN INTERFACE, not global — the laptop's NIC sees what
 *   a real NIC would see on a switched network (SPAN/mirror ports for remote
 *   capture is a later feature).
 */

export default function WireFishPanel() {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      height: '100%', background: '#0a0f18', color: '#9ab', fontFamily: 'monospace', padding: 40,
      textAlign: 'center',
    }}>
      <div style={{ fontSize: 48, marginBottom: 20 }}>🐟</div>

      <div style={{ fontSize: 18, fontWeight: 700, color: '#c8d8e8', marginBottom: 8 }}>
        WireFish
      </div>
      <div style={{ fontSize: 11, color: '#4a90e2', marginBottom: 24, fontStyle: 'italic' }}>
        Packet Capture Analyser — Phase 3
      </div>

      <div style={{
        maxWidth: 500, background: '#0d1520', border: '1px solid #1a2a3e',
        borderRadius: 8, padding: 24, textAlign: 'left',
      }}>
        <div style={{ fontSize: 10, color: '#e08050', fontWeight: 700, marginBottom: 10,
          textTransform: 'uppercase', letterSpacing: 0.5 }}>
          ⚠ Not yet available — here's why
        </div>

        <p style={{ fontSize: 10, color: '#8ab', lineHeight: 1.8, margin: '0 0 12px 0' }}>
          WireFish must only show frames the engine actually produced.
          Inventing a plausible ARP/ICMP sequence from a BFS result and calling it a
          "capture" would mislead every student who trusts this tool to learn packet
          analysis. That's the one shortcut we won't take.
        </p>

        <p style={{ fontSize: 10, color: '#8ab', lineHeight: 1.8, margin: '0 0 16px 0' }}>
          The current engine is a reachability oracle — it answers <em>"can src reach dst, and why not?"</em>
          but doesn't walk packets hop-by-hop. WireFish needs the event-emitting packet
          engine (Phase 3a) before it can display anything truthfully.
        </p>

        <div style={{ borderTop: '1px solid #1a2a3e', paddingTop: 14 }}>
          <div style={{ fontSize: 9, color: '#668', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 }}>
            Phase 3 build order
          </div>
          {[
            ['3a', 'Packet/event engine — hop-by-hop packet walk, device processing, event emission. Existing 379 tests are the spec. Every diff from current BFS = deliberate decision.', false],
            ['3b', 'WireFish as first consumer — subscribe to capture events at a specific interface. Capture point = laptop\'s NIC (what a real NIC on a switched network would see).', false],
            ['3c', 'DHCP DORA visualisation — watch Discover die at the router; add ip helper-address; watch it get relayed as unicast. Makes a described lesson visible.', false],
          ].map(([phase, desc, done]) => (
            <div key={phase} style={{ display: 'flex', gap: 10, marginBottom: 10, opacity: done ? 1 : 0.7 }}>
              <span style={{
                flexShrink: 0, width: 28, height: 28, borderRadius: '50%', display: 'flex',
                alignItems: 'center', justifyContent: 'center', fontSize: 9, fontWeight: 700,
                background: done ? '#0a2a0a' : '#1a2a3e', color: done ? '#5aba5a' : '#4a90e2',
                border: `1px solid ${done ? '#2a5a2a' : '#2a3a4e'}`,
              }}>{phase}</span>
              <span style={{ fontSize: 10, color: '#668', lineHeight: 1.6 }}>{desc}</span>
            </div>
          ))}
        </div>

        <div style={{ marginTop: 16, padding: '8px 12px', background: '#0a1200',
          border: '1px solid #1a2a1a', borderRadius: 4, fontSize: 9, color: '#4a6a4a' }}>
          <strong style={{ color: '#5a8a5a' }}>Until then:</strong> use <code style={{ color: '#9ab' }}>ping</code> and
          the device CLI (<code style={{ color: '#9ab' }}>show ip route</code>,
          <code style={{ color: '#9ab' }}>show firewall-rules</code>,
          <code style={{ color: '#9ab' }}>show conn</code>) to diagnose network behaviour.
          The fault-injection missions are designed around exactly these tools.
        </div>
      </div>
    </div>
  )
}
