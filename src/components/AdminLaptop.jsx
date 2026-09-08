/**
 * AdminLaptop — always-available floating management panel.
 * Tabs: GUIDE (setup + OS selector) | WIREFISH (packet capture) | BROWSER (device web UIs)
 */

import { useState, useRef, useCallback } from 'react'
import WireFishPanel from './WiresharkPanel.jsx'
import BrowserPanel from './BrowserPanel.jsx'
import { useGame } from '../state/GameContext.jsx'
import { useCareer } from '../state/CareerContext.jsx'

const INITIAL_W = 900
const INITIAL_H = 600

export default function AdminLaptop({ onClose }) {
  const { laptopDevice, setLaptopOsType, openTerminal } = useGame()
  const { notifications, markNotificationRead } = useCareer()
  const unreadCount = notifications.filter(n => !n.read).length

  const [tab, setTab] = useState('guide')
  const [pos, setPos] = useState(() => ({
    x: Math.max(20, (window.innerWidth  - INITIAL_W) / 2),
    y: Math.max(20, (window.innerHeight - INITIAL_H) / 2),
  }))
  const [size, setSize]         = useState({ w: INITIAL_W, h: INITIAL_H })
  const [maximised, setMaximised] = useState(false)
  const [guideMode, setGuideMode] = useState(
    () => localStorage.getItem('netsim_laptop_guide_mode') || 'beginner'
  )

  const osType = laptopDevice?.os_type ?? 'linux'

  function handleSetOs(type) {
    setLaptopOsType(type)
    localStorage.setItem('netsim_laptop_os', type)
  }

  function handleSetMode(m) {
    setGuideMode(m)
    localStorage.setItem('netsim_laptop_guide_mode', m)
  }

  // ── Dragging ─────────────────────────────────────────────────────────────────
  const dragRef = useRef(null)
  const onTitleMouseDown = useCallback((e) => {
    if (maximised) return
    if (e.target.closest('button')) return
    dragRef.current = { startX: e.clientX - pos.x, startY: e.clientY - pos.y }
    function onMove(ev) {
      if (!dragRef.current) return
      setPos({ x: Math.max(0, ev.clientX - dragRef.current.startX), y: Math.max(0, ev.clientY - dragRef.current.startY) })
    }
    function onUp() { dragRef.current = null; document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp) }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    e.preventDefault()
  }, [pos, maximised])

  // ── Resize ───────────────────────────────────────────────────────────────────
  const resizeRef = useRef(null)
  const onResizeMouseDown = useCallback((e) => {
    if (maximised) return
    resizeRef.current = { startX: e.clientX, startY: e.clientY, startW: size.w, startH: size.h }
    function onMove(ev) {
      if (!resizeRef.current) return
      setSize({ w: Math.max(680, resizeRef.current.startW + ev.clientX - resizeRef.current.startX), h: Math.max(400, resizeRef.current.startH + ev.clientY - resizeRef.current.startY) })
    }
    function onUp() { resizeRef.current = null; document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp) }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    e.preventDefault()
  }, [size, maximised])

  const windowStyle = maximised
    ? { position: 'fixed', inset: 0, zIndex: 3000, display: 'flex', flexDirection: 'column' }
    : { position: 'fixed', left: pos.x, top: pos.y, width: size.w, height: size.h, zIndex: 3000, display: 'flex', flexDirection: 'column' }

  const TABS = [
    { id: 'guide',    icon: '📖', label: 'Guide' },
    { id: 'wirefish', icon: '🐟', label: 'WireFish' },
    { id: 'browser',  icon: '🌐', label: 'Browser' },
    { id: 'inbox',    icon: '📧', label: 'Inbox', badge: unreadCount },
    { id: 'settings', icon: '⚙️', label: 'Settings' },
  ]

  return (
    <div style={{ ...windowStyle, borderRadius: maximised ? 0 : 6, overflow: 'hidden',
      boxShadow: '0 20px 60px rgba(0,0,0,0.8), 0 0 0 1px #1a2a3e',
      background: '#0a0f18', fontFamily: 'monospace' }}>

      {/* ── Title bar ──────────────────────────────────────────────────────── */}
      <div
        onMouseDown={onTitleMouseDown}
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '6px 10px', background: '#0d1520',
          borderBottom: '1px solid #1a2a3e',
          cursor: maximised ? 'default' : 'grab', userSelect: 'none', flexShrink: 0,
        }}
      >
        {/* Traffic-light buttons */}
        <button onClick={onClose}                       style={trafficBtn('#ff5f57')} title="Close" />
        <button onClick={() => {}}                      style={trafficBtn('#febc2e')} title="Minimise (unavailable)" />
        <button onClick={() => setMaximised(m => !m)}   style={trafficBtn('#28c840')} title={maximised ? 'Restore' : 'Maximise'} />

        {/* Title */}
        <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 700, color: '#8ab4d4', letterSpacing: 1 }}>
          🖥 ADMIN LAPTOP
        </span>
        <span style={{ fontSize: 9, color: '#334', marginLeft: 2 }}>management console</span>

        {/* Terminal shortcut — opens the laptop's own real terminal (same
            action right-clicking it on the floorplan does), not a tab with
            its own content pane. Grows from wherever this button sits. */}
        <button
          onClick={e => openTerminal(laptopDevice?.id, { x: e.clientX, y: e.clientY })}
          onMouseDown={e => e.stopPropagation()}
          disabled={!laptopDevice?.powered}
          title={laptopDevice?.powered ? 'Open Terminal' : 'Power on the laptop first'}
          style={{
            marginLeft: 14, width: 30, height: 26, fontSize: 15,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'transparent', border: '1px solid #1a2a3e', borderRadius: 4,
            cursor: laptopDevice?.powered ? 'pointer' : 'not-allowed',
            color: laptopDevice?.powered ? '#8ab4d4' : '#334',
            opacity: laptopDevice?.powered ? 1 : 0.5,
          }}
        >⌨</button>

        {/* Tab bar — icon-first, tooltip for the label instead of inline text */}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 2 }} onMouseDown={e => e.stopPropagation()}>
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} title={t.label} style={{
              position: 'relative',
              width: 34, height: 26, fontSize: 15,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              border: 'none', borderRadius: 3, cursor: 'pointer',
              background: tab === t.id ? '#1a2e4a' : 'transparent',
              borderBottom: tab === t.id ? '2px solid #4a90e2' : '2px solid transparent',
            }}>
              {t.icon}
              {t.badge > 0 && (
                <span style={{
                  position: 'absolute', top: 1, right: 1,
                  minWidth: 12, height: 12, borderRadius: 6, padding: '0 2px',
                  background: '#ff5555', color: '#fff', fontSize: 7, fontWeight: 700,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  border: '1px solid #0a0f18',
                }}>{t.badge > 9 ? '9+' : t.badge}</span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* ── Content area ───────────────────────────────────────────────────── */}
      <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
        <div style={{ display: tab === 'guide' ? 'flex' : 'none', flexDirection: 'column', height: '100%', overflow: 'auto' }}>
          <GuideTab laptopDevice={laptopDevice} osType={osType} guideMode={guideMode} />
        </div>
        <div style={{ display: tab === 'wirefish' ? 'flex' : 'none', flexDirection: 'column', height: '100%' }}>
          <WireFishPanel />
        </div>
        <div style={{ display: tab === 'browser' ? 'flex' : 'none', flexDirection: 'column', height: '100%' }}>
          <BrowserPanel />
        </div>
        <div style={{ display: tab === 'inbox' ? 'flex' : 'none', flexDirection: 'column', height: '100%', overflow: 'auto' }}>
          <NotificationsTab notifications={notifications} onMarkRead={markNotificationRead} />
        </div>
        <div style={{ display: tab === 'settings' ? 'flex' : 'none', flexDirection: 'column', height: '100%', overflow: 'auto' }}>
          <SettingsTab osType={osType} guideMode={guideMode} onSetMode={handleSetMode} onSetOs={handleSetOs} />
        </div>
      </div>

      {/* ── Resize handle ──────────────────────────────────────────────────── */}
      {!maximised && (
        <div onMouseDown={onResizeMouseDown} style={{
          position: 'absolute', bottom: 0, right: 0, width: 14, height: 14,
          cursor: 'nwse-resize',
          background: 'linear-gradient(135deg, transparent 50%, #1a2a3e 50%)',
        }} />
      )}
    </div>
  )
}

// ── Guide tab ─────────────────────────────────────────────────────────────────

function GuideTab({ laptopDevice, osType, guideMode }) {
  const iface   = laptopDevice?.interfaces?.[0]
  const hasIp   = !!(iface?.ip)
  const cabled  = !!(iface?.connected_to)
  const powered = !!(laptopDevice?.powered)
  const hasGw   = !!(laptopDevice?.routing_table?.find(r => r.network === '0.0.0.0'))

  const steps = osType === 'windows'
    ? winSteps(iface, hasIp, hasGw)
    : linuxSteps(iface, hasIp, hasGw)

  return (
    <div style={{ padding: 24, color: '#8ab', fontFamily: 'monospace', overflowY: 'auto' }}>
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: '#c8d8e8', marginBottom: 4 }}>
          🖥 Admin Laptop Setup
        </div>
        <div style={{ fontSize: 10, color: '#557', lineHeight: 1.7 }}>
          The Admin Laptop is your network engineer&apos;s workstation. It lives on the floorplan
          as a real device — cable it, power it on, and configure an IP before the Browser
          or WireFish tools can reach anything. Currently set up for <strong style={{ color: '#8ab4d4' }}>{osType === 'windows' ? 'Windows' : 'Linux'}</strong> —
          change that anytime in ⚙ Settings.
        </div>
      </div>

      {/* Setup checklist */}
      <Section title="Setup Checklist">
        <StepRow done={true}   num={0} label="Laptop created" hint="The admin laptop is always present — no purchase needed." />
        <StepRow done={cabled} num={1} label="Cable connected"
          hint="Right-click the laptop on the floorplan → Connect → pick a switch or router port." />
        <StepRow done={powered} num={2} label="Power on"
          hint="Right-click the laptop → Power On. The interface link comes up when the peer is also up." />
        <StepRow done={hasIp} num={3}
          label={`IP address configured${hasIp && iface?.ip ? ` (${iface.ip})` : ''}`}
          hint={osType === 'windows'
            ? `Open Terminal → netsh interface ip set address "Ethernet0" static <ip> <mask> <gw>`
            : 'Open Terminal → ip addr add <ip>/<prefix> dev eth0'}
          cmd={osType === 'windows'
            ? `netsh interface ip set address "Ethernet0" static 192.168.1.50 255.255.255.0 192.168.1.1`
            : 'ip addr add 192.168.1.50/24 dev eth0'}
          guideMode={guideMode}
        />
        <StepRow done={hasGw} num={4}
          label={`Default gateway configured${hasGw ? ` (→ ${laptopDevice?.routing_table?.find(r => r.network === '0.0.0.0')?.next_hop})` : ''}`}
          hint={osType === 'windows'
            ? 'Included in the netsh command above, or: route add 0.0.0.0 mask 0.0.0.0 <gw>'
            : 'ip route add default via <gateway-ip>'}
          cmd={osType === 'windows'
            ? 'route add 0.0.0.0 mask 0.0.0.0 192.168.1.1'
            : 'ip route add default via 192.168.1.1'}
          guideMode={guideMode}
        />
      </Section>

      {/* Command reference */}
      <Section title={`Command Reference — ${osType === 'windows' ? 'Windows CMD' : 'Linux'}`}>
        <CmdTable rows={steps} />
      </Section>

      {/* Using the tools */}
      <Section title="Using the Tools">
        <div style={{ display: 'flex', gap: 12 }}>
          <ToolCard icon="🌐" name="Browser" desc="Navigate to a device IP to open its web management UI (firewall rules, routing, NAT). The connection goes through the real engine — if the laptop has no route to the device, you get a realistic browser error." />
          <ToolCard icon="🐟" name="WireFish" desc="Packet capture analyser — coming in Phase 3. Will show real frames emitted by the packet engine hop-by-hop. See the WireFish tab for the build timeline." />
        </div>
      </Section>
    </div>
  )
}

// ── Settings tab ──────────────────────────────────────────────────────────────
//
// Holds the OS choice and Guide verbosity — things worth picking once, not
// chrome that needs to sit in front of the player permanently. Guide reads
// both (read-only there) but can no longer change them.

function SettingsTab({ osType, guideMode, onSetMode, onSetOs }) {
  return (
    <div style={{ padding: 24, color: '#8ab', fontFamily: 'monospace', overflowY: 'auto' }}>
      <div style={{ fontSize: 16, fontWeight: 700, color: '#c8d8e8', marginBottom: 16 }}>
        ⚙ Settings
      </div>

      <Section title="Operating System">
        <div style={{ display: 'flex', gap: 12 }}>
          <OsCard
            active={osType === 'linux'} onClick={() => onSetOs('linux')}
            icon="🐧" name="Linux" sub="Ubuntu / Debian shell"
            cmds={['ip addr add', 'ip route add default via', 'ping', 'dhclient']}
          />
          <OsCard
            active={osType === 'windows'} onClick={() => onSetOs('windows')}
            icon="🪟" name="Windows" sub="Windows CMD"
            cmds={['ipconfig /all', 'netsh interface ip set address', 'route print', 'ping']}
          />
        </div>
        <div style={{ fontSize: 9, color: '#446', marginTop: 8 }}>
          The OS choice changes the CLI commands in the terminal tab. Both OSes teach the
          same networking — just different syntax. The choice is saved on the device and
          persists across sessions.
        </div>
      </Section>

      <Section title="Guide Mode">
        <div style={{ display: 'flex', gap: 8 }}>
          <ModeBtn active={guideMode === 'beginner'} onClick={() => onSetMode('beginner')} label="📖 Beginner" />
          <ModeBtn active={guideMode === 'expert'}   onClick={() => onSetMode('expert')}   label="⚡ Expert" />
        </div>
        <div style={{ fontSize: 9, color: '#446', marginTop: 8 }}>
          Beginner mode shows step-by-step hints and example commands in the Guide tab and
          mission task list. Expert mode hides them — you're expected to know your commands.
        </div>
      </Section>
    </div>
  )
}

// ── Inbox tab ─────────────────────────────────────────────────────────────────

const NOTIFICATION_ICON = {
  'ticket-issued':    '🔧',
  'sla-warning':      '⚠️',
  'sla-expired':       '⛔',
  'ticket-completed': '✅',
  'client-dormant':   '💤',
}

function relativeTime(ms) {
  const diff = Date.now() - ms
  const mins = Math.floor(diff / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

function NotificationsTab({ notifications, onMarkRead }) {
  if (notifications.length === 0) {
    return (
      <div style={{ padding: 24, textAlign: 'center', color: '#446', fontFamily: 'monospace' }}>
        <div style={{ fontSize: 32, marginBottom: 10, opacity: 0.5 }}>📭</div>
        <div style={{ fontSize: 11 }}>No messages yet — your clients will reach out here.</div>
      </div>
    )
  }
  return (
    <div style={{ padding: 16 }}>
      {notifications.map(n => (
        <div
          key={n.id}
          onClick={() => !n.read && onMarkRead(n.id)}
          style={{
            display: 'flex', gap: 10, padding: '10px 12px', marginBottom: 6, borderRadius: 6,
            background: n.read ? '#0a0f18' : '#0d1a2a',
            border: `1px solid ${n.read ? '#141c28' : '#1e3a5c'}`,
            cursor: n.read ? 'default' : 'pointer',
          }}
        >
          <span style={{ fontSize: 18, flexShrink: 0 }}>{NOTIFICATION_ICON[n.kind] ?? '📩'}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
              <span style={{ fontSize: 11, fontWeight: n.read ? 400 : 700, color: n.read ? '#8ab' : '#c8d8e8' }}>
                {n.subject}
              </span>
              <span style={{ fontSize: 9, color: '#446', flexShrink: 0 }}>{relativeTime(n.createdAt)}</span>
            </div>
            <div style={{ fontSize: 10, color: '#5a7', marginTop: 3, lineHeight: 1.5 }}>{n.body}</div>
          </div>
          {!n.read && <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#4a90e2', flexShrink: 0, marginTop: 4 }} />}
        </div>
      ))}
    </div>
  )
}

function linuxSteps(iface, hasIp, hasGw) {
  return [
    { cmd: 'ip addr show',                                desc: 'Show all interfaces and IP addresses'           },
    { cmd: 'ip link set eth0 up',                        desc: 'Bring interface online'                          },
    { cmd: 'ip addr add 192.168.1.50/24 dev eth0',       desc: 'Assign a static IP address'                     },
    { cmd: 'ip addr del 192.168.1.50/24 dev eth0',       desc: 'Remove an IP address'                           },
    { cmd: 'ip route show',                              desc: 'Show routing table'                              },
    { cmd: 'ip route add default via 192.168.1.1',       desc: 'Add a default gateway'                          },
    { cmd: 'ip route add 10.0.0.0/8 via 192.168.1.1',   desc: 'Add a specific static route'                    },
    { cmd: 'dhclient eth0',                              desc: 'Request an IP address via DHCP'                  },
    { cmd: 'dhclient -r eth0',                           desc: 'Release DHCP lease'                             },
    { cmd: 'ping 192.168.1.1',                           desc: 'Test connectivity to gateway'                   },
    { cmd: 'ping -c 1 192.168.1.1',                      desc: 'Send exactly 1 ping packet'                     },
    { cmd: 'ifconfig',                                   desc: 'Show interface config (legacy)'                  },
    { cmd: 'route',                                      desc: 'Show routing table (legacy)'                     },
  ]
}

function winSteps(iface, hasIp, hasGw) {
  return [
    { cmd: 'ipconfig',                                                          desc: 'Show IP configuration'             },
    { cmd: 'ipconfig /all',                                                     desc: 'Show detailed IP config + MAC'     },
    { cmd: 'netsh interface ip set address "Ethernet0" static 192.168.1.50 255.255.255.0 192.168.1.1',
                                                                                desc: 'Set static IP, mask, and gateway'  },
    { cmd: 'netsh interface ip set address "Ethernet0" dhcp',                   desc: 'Obtain IP via DHCP'                },
    { cmd: 'netsh interface ip show config',                                    desc: 'Show detailed interface settings'  },
    { cmd: 'ipconfig /release',                                                 desc: 'Release DHCP lease'                },
    { cmd: 'ipconfig /renew',                                                   desc: 'Renew DHCP lease'                  },
    { cmd: 'route print',                                                       desc: 'Display routing table'             },
    { cmd: 'route add 10.0.0.0 mask 255.255.255.0 192.168.1.1',                desc: 'Add a static route'                },
    { cmd: 'route delete 10.0.0.0',                                             desc: 'Remove a static route'            },
    { cmd: 'ping 192.168.1.1',                                                  desc: 'Test connectivity to gateway'      },
    { cmd: 'ping -n 1 192.168.1.1',                                             desc: 'Send exactly 1 ping packet'        },
    { cmd: 'arp -a',                                                            desc: 'Show ARP cache'                    },
  ]
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Section({ title, children }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ fontSize: 9, color: '#4a90e2', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8, borderBottom: '1px solid #1a2a3e', paddingBottom: 4 }}>{title}</div>
      {children}
    </div>
  )
}

function StepRow({ done, num, label, hint, cmd, guideMode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 10 }}>
      <div style={{
        flexShrink: 0, width: 20, height: 20, borderRadius: '50%',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 10, fontWeight: 700,
        background: done ? '#0a2a1a' : '#0d1520',
        color: done ? '#50fa7b' : '#446',
        border: `1px solid ${done ? '#1a5a2a' : '#1a2a3e'}`,
      }}>
        {done ? '✓' : num}
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 10, color: done ? '#8ab' : '#c8d8e8', fontWeight: done ? 400 : 600 }}>{label}</div>
        {!done && guideMode === 'beginner' && hint && (
          <div style={{ fontSize: 9, color: '#557', marginTop: 3, lineHeight: 1.6 }}>{hint}</div>
        )}
        {!done && cmd && guideMode === 'beginner' && (
          <code style={{ display: 'block', marginTop: 4, fontSize: 9, color: '#8be9fd', background: '#0a1520', padding: '3px 8px', borderRadius: 3, border: '1px solid #1a2a3e' }}>
            {cmd}
          </code>
        )}
      </div>
    </div>
  )
}

function OsCard({ active, onClick, icon, name, sub, cmds }) {
  return (
    <button onClick={onClick} style={{
      flex: 1, padding: 12, background: active ? '#0d1e35' : '#0a0f18',
      border: `1px solid ${active ? '#4a90e2' : '#1a2a3e'}`, borderRadius: 6,
      cursor: 'pointer', textAlign: 'left', color: '#8ab',
    }}>
      <div style={{ fontSize: 20, marginBottom: 4 }}>{icon}</div>
      <div style={{ fontSize: 12, fontWeight: 700, color: active ? '#c8d8e8' : '#668', marginBottom: 2 }}>{name}</div>
      <div style={{ fontSize: 9, color: '#446', marginBottom: 8 }}>{sub}</div>
      {cmds.map(c => <code key={c} style={{ display: 'block', fontSize: 8, color: active ? '#8be9fd' : '#334', marginBottom: 2 }}>{c}</code>)}
    </button>
  )
}

function CmdTable({ rows }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {rows.map(({ cmd, desc }) => (
        <div key={cmd} style={{ display: 'flex', gap: 12, alignItems: 'baseline' }}>
          <code style={{ flexShrink: 0, fontSize: 9, color: '#8be9fd', background: '#0a1520', padding: '2px 6px', borderRadius: 3, border: '1px solid #1a2a3e', whiteSpace: 'nowrap', maxWidth: 440, overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {cmd}
          </code>
          <span style={{ fontSize: 9, color: '#557', flexShrink: 0 }}>{desc}</span>
        </div>
      ))}
    </div>
  )
}

function ToolCard({ icon, name, desc }) {
  return (
    <div style={{ flex: 1, padding: 12, background: '#0a0f18', border: '1px solid #1a2a3e', borderRadius: 6 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: '#8ab', marginBottom: 6 }}>{icon} {name}</div>
      <div style={{ fontSize: 9, color: '#446', lineHeight: 1.7 }}>{desc}</div>
    </div>
  )
}

function ModeBtn({ active, onClick, label }) {
  return (
    <button onClick={onClick} style={{
      padding: '3px 10px', fontSize: 9, border: `1px solid ${active ? '#4a90e2' : '#1a2a3e'}`,
      borderRadius: 3, cursor: 'pointer', background: active ? '#1a2e4a' : 'transparent',
      color: active ? '#4a90e2' : '#446', fontWeight: active ? 700 : 400,
    }}>{label}</button>
  )
}

function trafficBtn(color) {
  return {
    width: 12, height: 12, borderRadius: '50%',
    background: color, border: 'none', cursor: 'pointer', padding: 0, flexShrink: 0,
    boxShadow: '0 0 0 1px rgba(0,0,0,0.3)',
  }
}
