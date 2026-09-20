// Device line-art shared by the floorplan and the shop/sandbox catalogs, so a device
// looks the same wherever you meet it. Each carries its own status LEDs.

function RouterIcon() {
  return (
    <svg viewBox="0 0 54 38" width="54" height="38" style={{ display: 'block', margin: '0 auto' }}>
      <rect x="2" y="10" width="50" height="20" rx="3" fill="#11273c" stroke="#4da6ff" strokeWidth="1.4"/>
      {[10, 18, 26, 34].map(x => (
        <rect key={x} x={x} y="17" width="5" height="6" rx="1" fill="#1f3e5b" stroke="#2a79bf" strokeWidth="0.8"/>
      ))}
      <circle cx="45" cy="20" r="2.5" fill="#3ee08f"/>
      <line x1="12" y1="10" x2="9"  y2="2"  stroke="#2f6fbd" strokeWidth="1.5" strokeLinecap="round"/>
      <line x1="42" y1="10" x2="45" y2="2"  stroke="#2f6fbd" strokeWidth="1.5" strokeLinecap="round"/>
      <circle cx="9"  cy="2" r="1.5" fill="#4da6ff"/>
      <circle cx="45" cy="2" r="1.5" fill="#4da6ff"/>
    </svg>
  )
}

function SwitchIcon() {
  return (
    <svg viewBox="0 0 54 22" width="54" height="22" style={{ display: 'block', margin: '0 auto' }}>
      <rect x="1" y="2" width="52" height="18" rx="2" fill="#11273c" stroke="#4da6ff" strokeWidth="1.4"/>
      {[5, 10, 15, 20, 25, 30, 35, 40].map(x => (
        <rect key={x} x={x} y="6" width="4" height="10" rx="0.8" fill="#1f3e5b" stroke="#2a79bf" strokeWidth="0.6"/>
      ))}
      <circle cx="49" cy="11" r="2" fill="#3ee08f"/>
    </svg>
  )
}

function PCIcon() {
  return (
    <svg viewBox="0 0 48 42" width="48" height="42" style={{ display: 'block', margin: '0 auto' }}>
      <rect x="2" y="2" width="44" height="30" rx="3" fill="#11273c" stroke="#4da6ff" strokeWidth="1.4"/>
      <rect x="5" y="5" width="38" height="22" rx="1.5" fill="#08131e"/>
      <rect x="9" y="11" width="6"  height="1.5" rx="0.5" fill="#4da6ff" opacity="0.7"/>
      <rect x="9" y="14" width="14" height="1.5" rx="0.5" fill="#2f6fbd" opacity="0.5"/>
      <rect x="9" y="17" width="10" height="1.5" rx="0.5" fill="#2f6fbd" opacity="0.5"/>
      <rect x="21" y="32" width="6"  height="5" fill="#1f3e5b"/>
      <rect x="13" y="37" width="22" height="3" rx="1.5" fill="#1f3e5b" stroke="#2f6fbd" strokeWidth="0.8"/>
    </svg>
  )
}

function ServerIcon() {
  return (
    <svg viewBox="0 0 48 44" width="48" height="44" style={{ display: 'block', margin: '0 auto' }}>
      {[0, 14, 28].map((y, i) => (
        <g key={y}>
          <rect x="2" y={y + 2} width="44" height="11" rx="1.5" fill="#11273c" stroke="#4da6ff" strokeWidth="1.2"/>
          {[6, 13, 20, 27].map(x => (
            <rect key={x} x={x} y={y + 5} width="5" height="5" rx="0.5" fill="#162737" stroke="#30567a" strokeWidth="0.5"/>
          ))}
          <circle cx="41" cy={y + 7.5} r="2" fill={i === 0 ? '#3ee08f' : i === 1 ? '#ffb42e' : '#3ee08f'}/>
        </g>
      ))}
    </svg>
  )
}

function PhoneIcon() {
  return (
    <svg viewBox="0 0 48 48" width="48" height="48" style={{ display: 'block', margin: '0 auto' }}>
      {/* Phone body */}
      <rect x="8" y="10" width="32" height="28" rx="3" fill="#11273c" stroke="#f082bd" strokeWidth="1.4"/>
      {/* Screen */}
      <rect x="11" y="13" width="26" height="14" rx="1.5" fill="#08131e"/>
      {/* Screen glow lines (idle display) */}
      <rect x="14" y="16" width="12" height="1.5" rx="0.5" fill="#f082bd" opacity="0.6"/>
      <rect x="14" y="19" width="8"  height="1.5" rx="0.5" fill="#a020d0" opacity="0.4"/>
      {/* Keypad dots */}
      {[0,1,2].map(col => [0,1,2].map(row => (
        <circle key={`${col}-${row}`}
          cx={16 + col * 7} cy={31 + row * 4} r="1.2"
          fill="#f082bd" opacity="0.5"/>
      )))}
      {/* Power LED */}
      <circle cx="40" cy="14" r="2" fill="#3ee08f"/>
    </svg>
  )
}

function FirewallIcon() {
  return (
    <svg viewBox="0 0 54 46" width="54" height="46" style={{ display: 'block', margin: '0 auto' }}>
      {/* Chassis */}
      <rect x="2" y="10" width="50" height="22" rx="3" fill="#11273c" stroke="#ff8a4a" strokeWidth="1.4"/>
      {/* Status LEDs */}
      <circle cx="45" cy="21" r="2.5" fill="#3ee08f"/>
      <circle cx="40" cy="21" r="2" fill="#ffb42e"/>
      {/* Shield emblem */}
      <path d="M27 14 L34 17 L34 23 Q34 27 27 30 Q20 27 20 23 L20 17 Z" fill="#0d1e2d" stroke="#ff8a4a" strokeWidth="1.2"/>
      <line x1="27" y1="18" x2="27" y2="27" stroke="#ff8a4a" strokeWidth="1" opacity="0.7"/>
      <line x1="22" y1="22" x2="32" y2="22" stroke="#ff8a4a" strokeWidth="1" opacity="0.7"/>
      {/* Ports */}
      {[7, 11, 15].map(x => (
        <rect key={x} x={x} y="17" width="3" height="8" rx="0.5" fill="#1f3e5b" stroke="#30567a" strokeWidth="0.5"/>
      ))}
      {/* Antennas */}
      <line x1="10" y1="10" x2="8"  y2="3"  stroke="#ff8a4a" strokeWidth="1.2" strokeLinecap="round" opacity="0.6"/>
      <line x1="44" y1="10" x2="46" y2="3"  stroke="#ff8a4a" strokeWidth="1.2" strokeLinecap="round" opacity="0.6"/>
    </svg>
  )
}

function IspIcon() {
  return (
    <svg viewBox="0 0 54 42" width="54" height="42" style={{ display: 'block', margin: '0 auto' }}>
      <circle cx="27" cy="21" r="17" fill="#060f18" stroke="#26bfd6" strokeWidth="1.5"/>
      <ellipse cx="27" cy="21" rx="17" ry="7" fill="none" stroke="#26bfd6" strokeWidth="0.8" opacity="0.45"/>
      <ellipse cx="27" cy="21" rx="8" ry="17" fill="none" stroke="#26bfd6" strokeWidth="0.8" opacity="0.45"/>
      <line x1="10" y1="21" x2="44" y2="21" stroke="#26bfd6" strokeWidth="0.8" opacity="0.45"/>
      <line x1="27" y1="4" x2="27" y2="38" stroke="#26bfd6" strokeWidth="0.8" opacity="0.45"/>
      <circle cx="27" cy="4" r="2" fill="#26bfd6" opacity="0.9"/>
    </svg>
  )
}

function LaptopIcon() {
  return (
    <svg viewBox="0 0 54 42" width="54" height="42" style={{ display: 'block', margin: '0 auto' }}>
      {/* Lid */}
      <rect x="4" y="3" width="46" height="28" rx="2.5" fill="#11273c" stroke="#8ab3d4" strokeWidth="1.4"/>
      <rect x="7" y="6" width="40" height="22" rx="1.5" fill="#08131e"/>
      {/* Screen content lines */}
      <rect x="10" y="10" width="24" height="1.5" rx="0.5" fill="#4da6ff" opacity="0.7"/>
      <rect x="10" y="14" width="18" height="1.5" rx="0.5" fill="#66d4ea" opacity="0.5"/>
      <rect x="10" y="18" width="20" height="1.5" rx="0.5" fill="#66d4ea" opacity="0.4"/>
      {/* Admin star badge */}
      <circle cx="39" cy="16" r="5" fill="#1e364c" stroke="#4da6ff" strokeWidth="0.8"/>
      <text x="39" y="19" textAnchor="middle" fontSize="6" fill="#4da6ff">★</text>
      {/* Base / keyboard */}
      <path d="M2 31 Q2 38 6 38 L48 38 Q52 38 52 31 Z" fill="#11273c" stroke="#8ab3d4" strokeWidth="1.2"/>
      {/* Touchpad */}
      <rect x="19" y="33" width="16" height="3" rx="1" fill="#161e24" stroke="#4da6ff" strokeWidth="0.5" opacity="0.6"/>
      {/* Hinge */}
      <rect x="4" y="30" width="46" height="2" rx="1" fill="#1e364c" stroke="#8ab3d4" strokeWidth="0.6"/>
    </svg>
  )
}

export const DEVICE_ICONS = { router: RouterIcon, switch: SwitchIcon, pc: PCIcon, server: ServerIcon, phone: PhoneIcon, firewall: FirewallIcon, isp: IspIcon, laptop: LaptopIcon }
