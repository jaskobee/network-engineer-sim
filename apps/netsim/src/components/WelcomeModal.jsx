import { useState } from 'react'
import Faceplate from './Faceplate.jsx'
import DifficultyBars from './DifficultyBars.jsx'
import { IconCart, IconDiagram, IconTerminal, IconBriefcase } from './icons.jsx'

const TOURED_KEY     = 'netsim_v1_toured'
const DIFFICULTY_KEY = 'netsim_v1_difficulty'

export function hasSeenTour() {
  return !!localStorage.getItem(TOURED_KEY)
}

function markTourSeen() {
  localStorage.setItem(TOURED_KEY, '1')
}

// `icon` on the UI-tour steps is the same glyph as the real control it points at.
const STEPS = [
  {
    hero: 'faceplate',
    title: 'Welcome to NetSim',
    body: "A networking sim where the fundamentals are 100% real — actual CLI commands, actual routing, switching, and troubleshooting — but you learn them by running your own network engineering company, not by memorizing a manual.",
  },
  {
    title: 'Your story',
    body: "You just got certified — no big company job lined up, so you're going independent. Your first lead: an old friend just opened a small shop and needs their network set up. Not glamorous, but everyone starts somewhere.",
  },
  {
    title: 'Where this goes',
    body: "Every job builds your reputation. Happy clients keep coming back — and they grow. A router and a couple of PCs today can become Wi-Fi, VLANs, and firewalls tomorrow. Junior engineer today, enterprise architect eventually — how far you take it is up to you.",
  },
  {
    icon: <IconCart size={26} />,
    title: 'Buy devices',
    body: "Open the Shop from the left rail. Buy a Router and a PC to get started on your first job. Right-click a placed device and choose Power On before configuring.",
    arrow: { symbol: '◀', label: 'Shop on the left' },
  },
  {
    icon: <IconDiagram size={26} />,
    title: 'Build your network',
    body: "Drag devices from Inventory onto the map. Right-click a device and choose Connect Cable to wire them together.",
    arrow: { symbol: '▲', label: 'Map in the center' },
  },
  {
    icon: <IconTerminal size={26} />,
    title: 'Configure via terminal',
    body: "Right-click any powered device → Open Terminal. Assign IPs, bring interfaces up with 'no shutdown', and test with ping.",
    arrow: { symbol: '▼', label: 'Terminal at the bottom' },
  },
  {
    icon: <IconBriefcase size={26} />,
    title: 'Accept a job first',
    body: "Open Career from the right rail and pick a job. Accept it to see your tasks. Complete them all to earn money and unlock bigger contracts.",
    arrow: { symbol: '▶', label: 'Career on the right' },
  },
  { title: 'Choose your challenge', isDifficultyStep: true },
  { title: 'Name your company', isCompanyStep: true },
]

const COMPANY_AVATARS = ['💼', '🛠️', '🌐', '📡', '🔧', '⚡']

const DIFFICULTIES = [
  {
    id: 'beginner',
    label: 'Beginner',
    level: 1,
    desc: 'Step-by-step hints shown for each task. Commands suggested in the task panel.',
  },
  {
    id: 'advanced',
    label: 'Advanced',
    level: 2,
    desc: 'Task descriptions only — no command hints. Use "help" or "man <cmd>" in the terminal for guidance.',
  },
  {
    id: 'networkEngineer',
    label: 'Network Engineer',
    level: 3,
    desc: 'No hints. Realistic help output. You should know your commands.',
  },
]

function DifficultyPicker({ selected, onChange }) {
  return (
    <div role="radiogroup" aria-label="Difficulty" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {DIFFICULTIES.map(d => {
        const on = selected === d.id
        return (
          <button
            key={d.id}
            role="radio"
            aria-checked={on}
            onClick={() => onChange(d.id)}
            style={{
              textAlign: 'left', padding: '11px 14px', borderRadius: 10, cursor: 'pointer',
              border: `1px solid ${on ? 'var(--signal-strong)' : 'var(--rule-strong)'}`,
              background: on ? 'var(--signal-wash)' : 'var(--surface-raised)',
              color: 'inherit', transition: 'background 0.12s, border-color 0.12s',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 3 }}>
              <span style={{ fontSize: 16.5, fontWeight: 700, color: on ? 'var(--ink)' : 'var(--ink-2)' }}>{d.label}</span>
              <span style={{ marginLeft: 'auto' }}><DifficultyBars level={d.level} max={3} /></span>
            </div>
            <div style={{ fontSize: 14.5, color: 'var(--ink-3)', lineHeight: 1.45 }}>{d.desc}</div>
          </button>
        )
      })}
    </div>
  )
}

function CompanyNameStep({ name, onChangeName, avatar, onChangeAvatar }) {
  return (
    <div>
      <div role="radiogroup" aria-label="Company icon" style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
        {COMPANY_AVATARS.map(a => (
          <button
            key={a}
            role="radio"
            aria-checked={avatar === a}
            aria-label={`Icon ${a}`}
            onClick={() => onChangeAvatar(a)}
            style={{
              width: 40, height: 40, fontSize: 20, borderRadius: 8, cursor: 'pointer',
              background: avatar === a ? 'var(--signal-wash)' : 'var(--surface-raised)',
              border: `1px solid ${avatar === a ? 'var(--signal-strong)' : 'var(--rule-strong)'}`,
            }}
          >{a}</button>
        ))}
      </div>
      <label htmlFor="company-name" style={{ display: 'block', fontSize: 14.5, fontWeight: 600, color: 'var(--ink-2)', marginBottom: 6 }}>
        Company name
      </label>
      <input
        id="company-name"
        autoFocus
        value={name}
        onChange={e => onChangeName(e.target.value)}
        placeholder="e.g. Ping Networks"
        maxLength={40}
        style={{
          width: '100%', boxSizing: 'border-box', padding: '11px 12px', fontSize: 16.5,
          background: 'var(--surface-well)', color: 'var(--ink)', border: '1px solid var(--rule-strong)',
          borderRadius: 8, outline: 'none', transition: 'border-color 0.15s, box-shadow 0.15s',
        }}
        onFocus={e => { e.currentTarget.style.borderColor = 'var(--signal)'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(77,166,255,.22)' }}
        onBlur={e => { e.currentTarget.style.borderColor = 'var(--rule-strong)'; e.currentTarget.style.boxShadow = 'none' }}
      />
      <div style={{ fontSize: 14.5, color: 'var(--ink-3)', marginTop: 8, lineHeight: 1.5 }}>
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
      background: 'rgba(6,10,13,0.86)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div role="dialog" aria-modal="true" aria-label={current.title} style={{
        background: 'var(--surface-panel)',
        border: '1px solid var(--rule-strong)',
        borderRadius: 14,
        width: 480, maxWidth: '94vw', padding: '28px 32px 26px',
        boxShadow: 'var(--shadow-float)',
      }}>
        {/* Progress: one LED per step — lit up to where you are */}
        <div aria-label={`Step ${step + 1} of ${STEPS.length}`} style={{ display: 'flex', gap: 7, marginBottom: 24 }}>
          {STEPS.map((_, i) => (
            <i key={i} className={`led ${i < step ? 'green' : i === step ? 'blue' : ''}`} style={{ width: 8, height: 8 }} />
          ))}
        </div>

        {current.hero === 'faceplate' && <div style={{ marginBottom: 20 }}><Faceplate /></div>}
        {current.icon && (
          <div style={{
            width: 48, height: 48, display: 'grid', placeItems: 'center', marginBottom: 16,
            color: 'var(--signal)', background: 'var(--signal-wash)',
            border: '1px solid var(--signal-deep)', borderRadius: 10,
          }}>{current.icon}</div>
        )}

        <h2 style={{ fontSize: 26, fontWeight: 700, color: 'var(--ink)', lineHeight: 1.15, marginBottom: 10 }}>
          {current.title}
        </h2>

        {current.isDifficultyStep ? (
          <>
            <p style={{ fontSize: 15.5, color: 'var(--ink-3)', marginBottom: 16 }}>
              You can change this anytime from Settings.
            </p>
            <DifficultyPicker selected={selDiff} onChange={setSelDiff} />
          </>
        ) : current.isCompanyStep ? (
          <div style={{ marginTop: 16 }}>
            <CompanyNameStep
              name={companyName} onChangeName={setCompanyName}
              avatar={companyAvatar} onChangeAvatar={setCompanyAvatar}
            />
          </div>
        ) : (
          <>
            <p style={{ fontSize: 17, color: 'var(--ink-2)', lineHeight: 1.55, maxWidth: '52ch' }}>
              {current.body}
            </p>
            {current.arrow && (
              <div style={{
                display: 'inline-flex', alignItems: 'center', gap: 8, marginTop: 16,
                padding: '5px 12px', borderRadius: 999,
                background: 'var(--surface-well)', border: '1px solid var(--rule-strong)',
                fontSize: 14.5, color: 'var(--ink-2)',
              }}>
                <span style={{ fontSize: 13, color: 'var(--signal)' }}>{current.arrow.symbol}</span>
                {current.arrow.label}
              </div>
            )}
          </>
        )}

        {/* Buttons */}
        <div style={{ display: 'flex', gap: 10, justifyContent: 'space-between', alignItems: 'center', marginTop: 28 }}>
          {!isLast ? (
            <button className="btn ghost" onClick={skip} style={{ padding: '8px 14px', fontSize: 15 }}>Skip Tour</button>
          ) : <span />}
          <button className="btn primary" onClick={next} style={{ padding: '9px 28px', fontSize: 16.5 }}>
            {isLast ? 'Start my company' : 'Next'}
          </button>
        </div>
      </div>
    </div>
  )
}
