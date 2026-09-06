import { useState } from 'react'

const TOURED_KEY     = 'netsim_v1_toured'
const DIFFICULTY_KEY = 'netsim_v1_difficulty'

export function hasSeenTour() {
  return !!localStorage.getItem(TOURED_KEY)
}

function markTourSeen() {
  localStorage.setItem(TOURED_KEY, '1')
}

const STEPS = [
  {
    icon: '🌐',
    title: 'Welcome to NetSim',
    body: "A networking sim where the fundamentals are 100% real — actual CLI commands, actual routing, switching, and troubleshooting — but you learn them by running your own network engineering company, not by memorizing a manual.",
    arrow: null,
  },
  {
    icon: '🎓',
    title: 'Your Story',
    body: "You just got certified — no big company job lined up, so you're going independent. Your first lead: an old friend just opened a small shop and needs their network set up. Not glamorous, but everyone starts somewhere.",
    arrow: null,
  },
  {
    icon: '🚀',
    title: 'Where This Goes',
    body: "Every job builds your reputation. Happy clients keep coming back — and they grow. A router and a couple of PCs today can become Wi-Fi, VLANs, and firewalls tomorrow. Junior engineer today, enterprise architect eventually — how far you take it is up to you.",
    arrow: null,
  },
  {
    icon: '🛒',
    title: 'Buy Devices',
    body: "Head to the Shop on the left sidebar. Buy a Router and a PC to get started on your first job. Right-click a placed device and Power On before configuring.",
    arrow: 'left',
  },
  {
    icon: '🗺️',
    title: 'Build Your Network',
    body: "Drag devices from Inventory onto the map. Right-click a device and choose Connect Cable to wire them together.",
    arrow: 'center',
  },
  {
    icon: '⌨️',
    title: 'Configure via Terminal',
    body: "Right-click any powered device → Open Terminal. Assign IPs, bring interfaces up with 'no shutdown', and test with ping.",
    arrow: 'down',
  },
  {
    icon: '📋',
    title: 'Accept a Job First',
    body: "Check the Job Board on the right. Accept a job to see your tasks. Complete all tasks to earn money and unlock bigger contracts!",
    arrow: 'right',
  },
  {
    icon: '⚙️',
    title: 'Choose Your Challenge',
    body: null, // rendered as difficulty picker
    arrow: null,
    isDifficultyStep: true,
  },
  {
    icon: '🏢',
    title: 'Name Your Company',
    body: null, // rendered as CompanyNameStep
    arrow: null,
    isCompanyStep: true,
  },
]

const COMPANY_AVATARS = ['💼', '🛠️', '🌐', '📡', '🔧', '⚡']

const ARROW = {
  left:   { symbol: '◀', label: 'Shop on the left' },
  center: { symbol: '▲', label: 'Map in the center' },
  down:   { symbol: '▼', label: 'Terminal at the bottom' },
  right:  { symbol: '▶', label: 'Job Board on the right' },
}

const DIFFICULTIES = [
  {
    id: 'beginner',
    label: 'Beginner',
    icon: '🟢',
    desc: 'Step-by-step hints shown for each task. Commands suggested in the task panel.',
  },
  {
    id: 'advanced',
    label: 'Advanced',
    icon: '🟡',
    desc: 'Task descriptions only — no command hints. Use "help" or "man <cmd>" in the terminal for guidance.',
  },
  {
    id: 'networkEngineer',
    label: 'Network Engineer',
    icon: '🔴',
    desc: 'No hints. Realistic help output. You should know your commands.',
  },
]

function DifficultyPicker({ selected, onChange }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, textAlign: 'left' }}>
      {DIFFICULTIES.map(d => (
        <div
          key={d.id}
          onClick={() => onChange(d.id)}
          style={{
            padding: '10px 14px', borderRadius: 8, cursor: 'pointer',
            border: `2px solid ${selected === d.id ? '#4a90e2' : '#1a1a3e'}`,
            background: selected === d.id ? '#0a1830' : '#07080f',
            transition: 'all 0.15s',
          }}
          onMouseEnter={e => { if (selected !== d.id) e.currentTarget.style.borderColor = '#2a3060' }}
          onMouseLeave={e => { if (selected !== d.id) e.currentTarget.style.borderColor = '#1a1a3e' }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <span style={{ fontSize: 14 }}>{d.icon}</span>
            <span style={{ fontSize: 13, fontWeight: 700, color: selected === d.id ? '#e0e0e0' : '#888' }}>{d.label}</span>
            {selected === d.id && (
              <span style={{ marginLeft: 'auto', fontSize: 10, color: '#4a90e2', fontWeight: 700 }}>SELECTED</span>
            )}
          </div>
          <div style={{ fontSize: 11, color: '#555', lineHeight: 1.5 }}>{d.desc}</div>
        </div>
      ))}
    </div>
  )
}

function CompanyNameStep({ name, onChangeName, avatar, onChangeAvatar }) {
  return (
    <div style={{ textAlign: 'left' }}>
      <div style={{ display: 'flex', gap: 6, justifyContent: 'center', marginBottom: 16 }}>
        {COMPANY_AVATARS.map(a => (
          <button
            key={a}
            onClick={() => onChangeAvatar(a)}
            style={{
              width: 36, height: 36, fontSize: 17, borderRadius: 8, cursor: 'pointer',
              background: avatar === a ? '#0f1e3a' : '#07080f',
              border: `2px solid ${avatar === a ? '#4a90e2' : '#1a1a3e'}`,
            }}
          >{a}</button>
        ))}
      </div>
      <label style={{ display: 'block', fontSize: 10, color: '#555', letterSpacing: 0.5, marginBottom: 6 }}>
        COMPANY NAME
      </label>
      <input
        autoFocus
        value={name}
        onChange={e => onChangeName(e.target.value)}
        placeholder="e.g. Ping Networks"
        maxLength={40}
        style={{
          width: '100%', boxSizing: 'border-box', padding: '10px 12px', fontSize: 14,
          background: '#07080f', color: '#e0e0e0', border: '1px solid #1a1a3e',
          borderRadius: 8, outline: 'none',
        }}
        onFocus={e => { e.currentTarget.style.borderColor = '#4a90e2' }}
        onBlur={e => { e.currentTarget.style.borderColor = '#1a1a3e' }}
      />
      <div style={{ fontSize: 11, color: '#444', marginTop: 8, lineHeight: 1.5 }}>
        Every network engineer needs a name on the door. This is yours.
      </div>
    </div>
  )
}

export default function WelcomeModal({ onDone }) {
  const [step,          setStep]          = useState(0)
  const [selDiff,        setSelDiff]        = useState('beginner')
  const [companyName,    setCompanyName]    = useState('')
  const [companyAvatar,  setCompanyAvatar]  = useState(COMPANY_AVATARS[0])

  const current = STEPS[step]
  const isLast  = step === STEPS.length - 1

  function finish() {
    localStorage.setItem(DIFFICULTY_KEY, selDiff)
    markTourSeen()
    const finalName = companyName.trim() || 'My Network Co.'
    onDone(selDiff, finalName, companyAvatar)
  }

  function next() {
    if (isLast) finish()
    else setStep(s => s + 1)
  }

  // "Skip Tour" skips the explanatory steps only — difficulty and company name
  // still matter, so it jumps to the final step rather than finishing outright.
  function skip() {
    setStep(STEPS.length - 1)
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 3000,
      background: 'rgba(4,4,12,0.88)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{
        background: '#0d1226',
        border: '1px solid #2a5298',
        borderRadius: 12,
        width: 420, padding: '32px 36px',
        boxShadow: '0 8px 60px rgba(0,0,0,0.8)',
        position: 'relative',
        textAlign: 'center',
      }}>
        {/* Step dots */}
        <div style={{ display: 'flex', justifyContent: 'center', gap: 6, marginBottom: 24 }}>
          {STEPS.map((_, i) => (
            <div key={i} style={{
              width: i === step ? 18 : 6, height: 6, borderRadius: 3,
              background: i === step ? '#4a90e2' : i < step ? '#1e3a6a' : '#1a1a3e',
              transition: 'all 0.25s',
            }} />
          ))}
        </div>

        {current.isDifficultyStep ? (
          <>
            <div style={{ fontSize: 48, marginBottom: 12 }}>{current.icon}</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#e0e0e0', marginBottom: 4 }}>
              {current.title}
            </div>
            <div style={{ fontSize: 12, color: '#555', marginBottom: 16 }}>
              You can change this anytime from the header.
            </div>
            <DifficultyPicker selected={selDiff} onChange={setSelDiff} />
          </>
        ) : current.isCompanyStep ? (
          <>
            <div style={{ fontSize: 48, marginBottom: 12 }}>{current.icon}</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#e0e0e0', marginBottom: 16 }}>
              {current.title}
            </div>
            <CompanyNameStep
              name={companyName} onChangeName={setCompanyName}
              avatar={companyAvatar} onChangeAvatar={setCompanyAvatar}
            />
          </>
        ) : (
          <>
            {/* Icon */}
            <div style={{ fontSize: 48, marginBottom: 12 }}>{current.icon}</div>
            {/* Title */}
            <div style={{ fontSize: 16, fontWeight: 700, color: '#e0e0e0', marginBottom: 10 }}>
              {current.title}
            </div>
            {/* Body */}
            <div style={{ fontSize: 13, color: '#888', lineHeight: 1.6, marginBottom: 20 }}>
              {current.body}
            </div>
            {/* Directional indicator */}
            {current.arrow && ARROW[current.arrow] && (
              <div style={{
                display: 'inline-flex', alignItems: 'center', gap: 8,
                padding: '6px 14px', borderRadius: 20,
                background: '#070d1a', border: '1px solid #1a3060',
                fontSize: 11, color: '#4a90e2', marginBottom: 20,
              }}>
                <span style={{ fontSize: 14 }}>{ARROW[current.arrow].symbol}</span>
                {ARROW[current.arrow].label}
              </div>
            )}
          </>
        )}

        {/* Buttons */}
        <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 24 }}>
          {!isLast && (
            <button
              onClick={skip}
              style={{
                padding: '8px 18px', fontSize: 12, fontWeight: 600,
                background: 'transparent', color: '#444',
                border: '1px solid #1a1a3e', borderRadius: 6, cursor: 'pointer',
              }}
              onMouseEnter={e => { e.currentTarget.style.color = '#888' }}
              onMouseLeave={e => { e.currentTarget.style.color = '#444' }}
            >
              Skip Tour
            </button>
          )}
          <button
            onClick={next}
            style={{
              padding: '8px 28px', fontSize: 13, fontWeight: 700,
              background: '#2a5298', color: '#e0e0e0',
              border: 'none', borderRadius: 6, cursor: 'pointer',
              letterSpacing: 0.5, transition: 'background 0.15s',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = '#3a6ab8' }}
            onMouseLeave={e => { e.currentTarget.style.background = '#2a5298' }}
          >
            {isLast ? "LET'S GO!" : 'Next'}
          </button>
        </div>
      </div>
    </div>
  )
}
