// Small stroke icons drawn on a 24px grid. They inherit `currentColor`, so state
// (hover, active, disabled) is styled with plain CSS instead of swapping glyphs.
function Icon({ size = 20, children }) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true" focusable="false"
    >
      {children}
    </svg>
  )
}

export const IconCart = p => (
  <Icon {...p}>
    <circle cx="9" cy="20" r="1.3" /><circle cx="18" cy="20" r="1.3" />
    <path d="M2.5 3.5h2.7l2.1 11h11.2l2-8H6.2" />
  </Icon>
)

export const IconBox = p => (
  <Icon {...p}>
    <path d="M12 2.8 20.5 7.4v9.2L12 21.2 3.5 16.6V7.4z" />
    <path d="M3.5 7.4 12 12l8.5-4.6M12 12v9.2" />
  </Icon>
)

export const IconBriefcase = p => (
  <Icon {...p}>
    <rect x="3" y="7.5" width="18" height="12.5" rx="2" />
    <path d="M9 7.5V5.8A1.8 1.8 0 0 1 10.8 4h2.4A1.8 1.8 0 0 1 15 5.8v1.7M3 13h18" />
  </Icon>
)

export const IconLaptop = p => (
  <Icon {...p}>
    <rect x="5" y="5" width="14" height="10" rx="1.5" />
    <path d="M2.5 19h19l-1.6-4H4.1z" />
  </Icon>
)

export const IconSliders = p => (
  <Icon {...p}>
    <path d="M4 7h9M17 7h3M4 17h3M11 17h9" />
    <circle cx="15" cy="7" r="2" /><circle cx="9" cy="17" r="2" />
  </Icon>
)

// A window with a title bar and two form rows — "configure with a GUI".
export const IconWindow = p => (
  <Icon {...p}>
    <rect x="3" y="4.5" width="18" height="15" rx="2" />
    <path d="M3 9h18M7 13h4M7 16h7" />
  </Icon>
)

export const IconClose = p => (
  <Icon {...p}><path d="M6 6l12 12M18 6 6 18" /></Icon>
)

export const IconChevronDown = p => (
  <Icon {...p}><path d="m6 9 6 6 6-6" /></Icon>
)

export const IconChevronUp = p => (
  <Icon {...p}><path d="m6 15 6-6 6 6" /></Icon>
)

export const IconDiagram = p => (
  <Icon {...p}>
    <rect x="3" y="4" width="7" height="6" rx="1.2" /><rect x="14" y="14" width="7" height="6" rx="1.2" />
    <path d="M6.5 10v3.5a2 2 0 0 0 2 2H14M17.5 14v-3.5a2 2 0 0 0-2-2H10" />
  </Icon>
)

export const IconLock = p => (
  <Icon {...p}>
    <rect x="5" y="10.5" width="14" height="9.5" rx="2" />
    <path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" />
  </Icon>
)

export const IconTerminal = p => (
  <Icon {...p}>
    <rect x="3" y="4.5" width="18" height="15" rx="2" />
    <path d="m7.5 9.5 3 2.5-3 2.5M13 15h4" />
  </Icon>
)

export const IconDashboard = p => (
  <Icon {...p}>
    <rect x="3" y="3" width="8" height="10" rx="1.6" /><rect x="13" y="3" width="8" height="6" rx="1.6" />
    <rect x="13" y="11" width="8" height="10" rx="1.6" /><rect x="3" y="15" width="8" height="6" rx="1.6" />
  </Icon>
)

export const IconBook = p => (
  <Icon {...p}>
    <path d="M4 5.6A1.6 1.6 0 0 1 5.6 4H11v15.5H5.6A1.6 1.6 0 0 0 4 21z" />
    <path d="M20 5.6A1.6 1.6 0 0 0 18.4 4H13v15.5h5.4A1.6 1.6 0 0 1 20 21z" />
  </Icon>
)

export const IconPulse = p => (
  <Icon {...p}><path d="M2.5 12h4.2l2.6-7 4.6 14 2.6-7h4.9" /></Icon>
)

export const IconGlobe = p => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M3 12h18M12 3c2.6 2.6 3.9 5.6 3.9 9s-1.3 6.4-3.9 9c-2.6-2.6-3.9-5.6-3.9-9S9.4 5.6 12 3z" />
  </Icon>
)

export const IconMail = p => (
  <Icon {...p}>
    <rect x="3" y="5.5" width="18" height="13" rx="2" />
    <path d="m3.5 7.2 8.5 6 8.5-6" />
  </Icon>
)

export const IconCheck = p => (
  <Icon {...p}><path d="m5 12.5 4.5 4.5L19 7.5" /></Icon>
)

export const IconPower = p => (
  <Icon {...p}><path d="M12 3v8" /><path d="M6.6 6.9a7.5 7.5 0 1 0 10.8 0" /></Icon>
)

export const IconPlug = p => (
  <Icon {...p}>
    <path d="M9 3v5M15 3v5" /><path d="M6.5 8h11v3.5a5.5 5.5 0 0 1-11 0z" /><path d="M12 17v4" />
  </Icon>
)

export const IconShield = p => (
  <Icon {...p}><path d="M12 3 4.5 6v5.5c0 4.4 3 7.9 7.5 9.5 4.5-1.6 7.5-5.1 7.5-9.5V6z" /></Icon>
)
