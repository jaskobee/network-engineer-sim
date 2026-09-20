/**
 * AdminLaptop — always-available floating management panel.
 * Tabs: GUIDE (setup + OS selector) | WIREFISH (packet capture) | BROWSER (device web UIs)
 */

import { useState, useRef, useCallback } from 'react'
import WireFishPanel from './WiresharkPanel.jsx'
import BrowserPanel from './BrowserPanel.jsx'
import AdminDashboardTab from './AdminDashboardTab.jsx'
import { Section, relativeTime } from './AdminLaptopShared.jsx'
import { useGame } from '../state/GameContext.jsx'
import { IconLaptop, IconTerminal, IconDashboard, IconBook, IconPulse, IconGlobe, IconMail, IconSliders, IconCheck } from './icons.jsx'
import { useCareer } from '../state/CareerContext.jsx'

const INITIAL_W = 900
const INITIAL_H = 600

export default function AdminLaptop({ onClose }) {
  const { laptopDevice, setLaptopOsType, openTerminal } = useGame()
  const { notifications, markNotificationRead } = useCareer()
  const unreadCount = notifications.filter(n => !n.read).length

  const [tab, setTab] = useState('dashboard')
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

  // Laptop setup status — lifted out of GuideTab so both it and the
  // Dashboard tab's setup nudge read the same derivation instead of
  // duplicating it.
  const laptopIface   = laptopDevice?.interfaces?.[0]
  const laptopHasIp   = !!(laptopIface?.ip)
  const laptopCabled  = !!(laptopIface?.connected_to)
  const laptopPowered = !!(laptopDevice?.powered)
  const laptopHasGw   = !!(laptopDevice?.routing_table?.find(r => r.network === '0.0.0.0'))

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
    { id: 'dashboard', icon: <IconDashboard size={17} />, label: 'Dashboard' },
    { id: 'guide',    icon: <IconBook size={17} />,      label: 'Guide' },
    { id: 'wirefish', icon: <IconPulse size={17} />,     label: 'WireFish' },
    { id: 'browser',  icon: <IconGlobe size={17} />,     label: 'Browser' },
    { id: 'inbox',    icon: <IconMail size={17} />,      label: 'Inbox', badge: unreadCount },
    { id: 'settings', icon: <IconSliders size={17} />,   label: 'Settings' },
  ]

  return (
    <div style={{ ...windowStyle, borderRadius: maximised ? 0 : 12, overflow: 'hidden',
      boxShadow: '0 24px 70px rgba(0,0,0,0.65), 0 0 0 1px var(--rule-strong)',
      background: 'var(--surface-ground)', fontFamily: 'var(--font-ui)' }}>

      {/* ── Title bar ──────────────────────────────────────────────────────── */}
      <div
        onMouseDown={onTitleMouseDown}
        style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '7px 12px', background: 'var(--surface-panel)',
          borderBottom: '1px solid var(--rule)',
          cursor: maximised ? 'default' : 'grab', userSelect: 'none', flexShrink: 0,
        }}
      >
        {/* Window controls — grey until hovered, so colour stays reserved for signal */}
        <span className="tl-group">
          <button onClick={onClose} className="tl close" title="Close" aria-label="Close" />
          <button onClick={() => {}} className="tl min" title="Minimise (unavailable)" aria-label="Minimise (unavailable)" />
          <button onClick={() => setMaximised(m => !m)} className="tl max" title={maximised ? 'Restore' : 'Maximise'} aria-label={maximised ? 'Restore' : 'Maximise'} />
        </span>

        <span style={{ marginLeft: 6, display: 'flex', alignItems: 'center', gap: 8, fontSize: 16, fontWeight: 600, color: 'var(--ink)' }}>
          <IconLaptop size={17} /> Admin laptop
        </span>
        <span style={{ fontSize: 14, color: 'var(--ink-3)' }}>Management console</span>

        {/* Terminal shortcut — opens the laptop's own real terminal (same
            action right-clicking it on the floorplan does), not a tab with
            its own content pane. Grows from wherever this button sits. */}
        <button
          className="btn ghost icon"
          onClick={e => openTerminal(laptopDevice?.id, { x: e.clientX, y: e.clientY })}
          onMouseDown={e => e.stopPropagation()}
          disabled={!laptopDevice?.powered}
          title={laptopDevice?.powered ? 'Open Terminal' : 'Power on the laptop first'}
          aria-label="Open terminal"
          style={{ marginLeft: 8 }}
        ><IconTerminal size={17} /></button>

        {/* Tab bar — the active tab names itself; the rest stay icon-only to save room */}
        <div role="tablist" style={{ marginLeft: 'auto', display: 'flex', gap: 2 }} onMouseDown={e => e.stopPropagation()}>
          {TABS.map(t => {
            const on = tab === t.id
            return (
              <button
                key={t.id}
                role="tab"
                aria-selected={on}
                onClick={() => setTab(t.id)}
                title={t.label}
                className={`lap-tab${on ? ' on' : ''}`}
              >
                {t.icon}
                {on && <span>{t.label}</span>}
                {t.badge > 0 && <span className="badge" style={{ top: -4, right: -4, minWidth: 15, height: 15, fontSize: 11, borderWidth: 1 }}>{t.badge > 9 ? '9+' : t.badge}</span>}
              </button>
            )
          })}
        </div>
      </div>

      {/* ── Content area ───────────────────────────────────────────────────── */}
      <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
        <div style={{ display: tab === 'dashboard' ? 'flex' : 'none', flexDirection: 'column', height: '100%', overflow: 'auto' }}>
          <AdminDashboardTab
            cabled={laptopCabled} powered={laptopPowered} hasIp={laptopHasIp} hasGw={laptopHasGw}
            onOpenGuide={() => setTab('guide')} onOpenInbox={() => setTab('inbox')}
          />
        </div>
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
          background: 'linear-gradient(135deg, transparent 50%, var(--rule-strong) 50%)',
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
  // The adapter starts switched off (administratively down) and must be enabled, like an interface.
  const enabled = !!iface && iface.status !== 'admin_down'

  const steps = osType === 'windows'
    ? winSteps(iface, hasIp, hasGw)
    : linuxSteps(iface, hasIp, hasGw)

  return (
    <div style={{ padding: 24, color: '#88a6bb', fontFamily: 'var(--font-ui)', overflowY: 'auto' }}>
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 18.5, fontWeight: 700, color: '#c8d9e8', marginBottom: 4 }}>
          Admin laptop setup
        </div>
        <div style={{ fontSize: 14.5, color: '#6f8fa6', lineHeight: 1.7 }}>
          The Admin Laptop is your network engineer&apos;s workstation. It lives on the floorplan
          as a real device — cable it, power it on, and configure an IP before the Browser
          or WireFish tools can reach anything. Currently set up for <strong style={{ color: '#8ab3d4' }}>{osType === 'windows' ? 'Windows' : 'Linux'}</strong> —
          change that anytime in Settings.
        </div>
      </div>

      {/* Setup checklist */}
      <Section title="Setup checklist">
        <StepRow done={true}   num={0} label="Laptop created" hint="The admin laptop is always present — no purchase needed." />
        <StepRow done={cabled} num={1} label="Cable connected"
          hint="Right-click the laptop on the floorplan → Connect → pick a switch or router port." />
        <StepRow done={powered} num={2} label="Power on"
          hint="Right-click the laptop → Power On." />
        <StepRow done={enabled} num={3} label="Network adapter enabled"
          hint={osType === 'windows'
            ? 'The adapter starts switched off. Open Terminal → netsh interface set interface name="Ethernet0" admin=enabled'
            : 'The adapter starts switched off. Open Terminal → ip link set eth0 up'}
          cmd={osType === 'windows'
            ? 'netsh interface set interface name="Ethernet0" admin=enabled'
            : 'ip link set eth0 up'}
          guideMode={guideMode}
        />
        <StepRow done={hasIp} num={4}
          label={`IP address configured${hasIp && iface?.ip ? ` (${iface.ip})` : ''}`}
          hint={osType === 'windows'
            ? `Open Terminal → netsh interface ip set address "Ethernet0" static <ip> <mask> <gw>`
            : 'Open Terminal → ip addr add <ip>/<prefix> dev eth0'}
          cmd={osType === 'windows'
            ? `netsh interface ip set address "Ethernet0" static 192.168.1.50 255.255.255.0 192.168.1.1`
            : 'ip addr add 192.168.1.50/24 dev eth0'}
          guideMode={guideMode}
        />
        <StepRow done={hasGw} num={5}
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
      <Section title={`Command reference — ${osType === 'windows' ? 'Windows CMD' : 'Linux'}`}>
        <CmdTable rows={steps} />
      </Section>

      {/* Using the tools */}
      <Section title="Using the tools">
        <div style={{ display: 'flex', gap: 12 }}>
          <ToolCard icon={<IconGlobe size={16} />} name="Browser" desc="Navigate to a device IP to open its web management UI (firewall rules, routing, NAT). The connection goes through the real engine — if the laptop has no route to the device, you get a realistic browser error." />
          <ToolCard icon={<IconPulse size={16} />} name="WireFish" desc="Packet capture analyser — coming in Phase 3. Will show real frames emitted by the packet engine hop-by-hop. See the WireFish tab for the build timeline." />
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
    <div style={{ padding: 24, color: '#88a6bb', fontFamily: 'var(--font-ui)', overflowY: 'auto' }}>
      <div style={{ fontSize: 18.5, fontWeight: 700, color: '#c8d9e8', marginBottom: 16 }}>
        Settings
      </div>

      <Section title="Operating system">
        <div style={{ display: 'flex', gap: 12 }}>
          <OsCard
            active={osType === 'linux'} onClick={() => onSetOs('linux')}
            icon={null} name="Linux" sub="Ubuntu / Debian shell"
            cmds={['ip addr add', 'ip route add default via', 'ping', 'dhclient']}
          />
          <OsCard
            active={osType === 'windows'} onClick={() => onSetOs('windows')}
            icon={null} name="Windows" sub="Windows CMD"
            cmds={['ipconfig /all', 'netsh interface ip set address', 'route print', 'ping']}
          />
        </div>
        <div style={{ fontSize: 13.5, color: '#7090a6', marginTop: 8 }}>
          The OS choice changes the CLI commands in the terminal tab. Both OSes teach the
          same networking — just different syntax. The choice is saved on the device and
          persists across sessions.
        </div>
      </Section>

      <Section title="Guide mode">
        <div style={{ display: 'flex', gap: 8 }}>
          <ModeBtn active={guideMode === 'beginner'} onClick={() => onSetMode('beginner')} label="Beginner" />
          <ModeBtn active={guideMode === 'expert'}   onClick={() => onSetMode('expert')}   label="Expert" />
        </div>
        <div style={{ fontSize: 13.5, color: '#7090a6', marginTop: 8 }}>
          Beginner mode shows step-by-step hints and example commands in the Guide tab and
          mission task list. Expert mode hides them — you're expected to know your commands.
        </div>
      </Section>
    </div>
  )
}

// ── Inbox tab ─────────────────────────────────────────────────────────────────

const NOTIFICATION_LED = {
  'ticket-issued': 'blue', 'ticket-reminder': 'amber', 'new-job': 'blue', 'sla-warning': 'amber', 'sla-expired': 'red',
  'ticket-completed': 'green', 'client-dormant': '',
}

function NotificationsTab({ notifications, onMarkRead }) {
  if (notifications.length === 0) {
    return (
      <div style={{ padding: 24, textAlign: 'center', color: '#7090a6', fontFamily: 'var(--font-ui)' }}>
        <div style={{ fontSize: 16, color: 'var(--ink-2)', marginBottom: 4 }}>No messages yet</div>
        <div style={{ fontSize: 15 }}>Your clients will reach out here.</div>
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
            background: n.read ? '#0e1316' : '#0f1c28',
            border: `1px solid ${n.read ? '#171f24' : '#233e57'}`,
            cursor: n.read ? 'default' : 'pointer',
          }}
        >
          <i className={`led ${NOTIFICATION_LED[n.kind] ?? ''}`} style={{ marginTop: 6 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
              <span style={{ fontSize: 15, fontWeight: n.read ? 400 : 700, color: n.read ? '#88a6bb' : '#c8d9e8' }}>
                {n.subject}
              </span>
              <span style={{ fontSize: 13.5, color: '#7090a6', flexShrink: 0 }}>{relativeTime(n.createdAt)}</span>
            </div>
            <div style={{ fontSize: 14.5, color: 'var(--ink-3)', marginTop: 3, lineHeight: 1.5 }}>{n.body}</div>
          </div>
          {!n.read && <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--signal)', flexShrink: 0 }}>New</span>}
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
    { cmd: 'netsh interface set interface name="Ethernet0" admin=enabled',      desc: 'Enable the network adapter'        },
    { cmd: 'netsh interface show interface',                                    desc: 'Show adapters: Enabled / Connected' },
    { cmd: 'netsh interface ip set address "Ethernet0" static 192.168.1.50 255.255.255.0 192.168.1.1',
                                                                                desc: 'Set static IP, mask, and gateway'  },
    { cmd: 'netsh interface ip set address "Ethernet0" dhcp',                   desc: 'Obtain IP via DHCP'                },
    { cmd: 'netsh interface ip show config',                                    desc: 'Show detailed interface settings'  },
    { cmd: 'netsh interface ip delete address "Ethernet0" 192.168.1.50',        desc: 'Remove a static IP address'        },
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

function StepRow({ done, num, label, hint, cmd, guideMode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 10 }}>
      <div style={{
        flexShrink: 0, width: 20, height: 20, borderRadius: '50%',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 14.5, fontWeight: 700,
        background: done ? '#0e261a' : '#12181c',
        color: done ? '#3ee08f' : '#7090a6',
        border: `1px solid ${done ? '#204c36' : '#202b33'}`,
      }}>
        {done ? <IconCheck size={13} /> : num}
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 14.5, color: done ? '#88a6bb' : '#c8d9e8', fontWeight: done ? 400 : 600 }}>{label}</div>
        {!done && guideMode === 'beginner' && hint && (
          <div style={{ fontSize: 13.5, color: '#6f8fa6', marginTop: 3, lineHeight: 1.6 }}>{hint}</div>
        )}
        {!done && cmd && guideMode === 'beginner' && (
          <code style={{ fontFamily: 'var(--font-mono)', display: 'block', marginTop: 5, fontSize: 12.5, color: '#66d4ea', background: '#0c151e', padding: '3px 8px', borderRadius: 3, border: '1px solid #202b33' }}>
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
      flex: 1, padding: 12, background: active ? '#102232' : '#0e1316',
      border: `1px solid ${active ? '#4da6ff' : '#202b33'}`, borderRadius: 6,
      cursor: 'pointer', textAlign: 'left', color: '#88a6bb',
    }}>
      
      <div style={{ fontSize: 14.5, fontWeight: 700, color: active ? '#c8d9e8' : '#7e8c9e', marginBottom: 2 }}>{name}</div>
      <div style={{ fontSize: 13.5, color: '#7090a6', marginBottom: 8 }}>{sub}</div>
      {cmds.map(c => <code key={c} style={{ display: 'block', fontSize: 13, color: active ? '#66d4ea' : '#7291a6', marginBottom: 2 }}>{c}</code>)}
    </button>
  )
}

function CmdTable({ rows }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {rows.map(({ cmd, desc }) => (
        <div key={cmd} style={{ display: 'flex', gap: 12, alignItems: 'baseline' }}>
          <code style={{ fontFamily: 'var(--font-mono)', flexShrink: 0, fontSize: 12.5, color: '#66d4ea', background: '#0c151e', padding: '2px 6px', borderRadius: 3, border: '1px solid #202b33', whiteSpace: 'nowrap', maxWidth: 440, overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {cmd}
          </code>
          <span style={{ fontSize: 13.5, color: '#6f8fa6', flexShrink: 0 }}>{desc}</span>
        </div>
      ))}
    </div>
  )
}

function ToolCard({ icon, name, desc }) {
  return (
    <div style={{ flex: 1, padding: 12, background: '#0e1316', border: '1px solid #202b33', borderRadius: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 15.5, fontWeight: 600, color: 'var(--ink)', marginBottom: 6 }}>{icon} {name}</div>
      <div style={{ fontSize: 13.5, color: '#7090a6', lineHeight: 1.7 }}>{desc}</div>
    </div>
  )
}

function ModeBtn({ active, onClick, label }) {
  return (
    <button onClick={onClick} style={{
      padding: '3px 10px', fontSize: 13.5, border: `1px solid ${active ? '#4da6ff' : '#202b33'}`,
      borderRadius: 3, cursor: 'pointer', background: active ? '#24313a' : 'transparent',
      color: active ? '#4da6ff' : '#7090a6', fontWeight: active ? 700 : 400,
    }}>{label}</button>
  )
}
