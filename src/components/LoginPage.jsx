import { useState, useRef, useEffect } from 'react'
import { useAuth } from '../state/AuthContext.jsx'
import Faceplate from './Faceplate.jsx'

const MAX_ATTEMPTS    = 5
const LOCKOUT_SECONDS = 30

export default function LoginPage() {
  const { login } = useAuth()
  const [username,    setUsername]   = useState('')
  const [password,    setPassword]   = useState('')
  const [showPw,      setShowPw]     = useState(false)
  const [error,       setError]      = useState('')
  const [loading,     setLoading]    = useState(false)
  const [attempts,    setAttempts]   = useState(0)
  const [lockedUntil, setLockedUntil] = useState(null)
  const [countdown,   setCountdown]  = useState(0)
  const timerRef  = useRef(null)
  const userRef   = useRef(null)

  useEffect(() => {
    userRef.current?.focus()
  }, [])

  function startLockout() {
    const until = Date.now() + LOCKOUT_SECONDS * 1000
    setLockedUntil(until)
    setCountdown(LOCKOUT_SECONDS)
    timerRef.current = setInterval(() => {
      const rem = Math.ceil((until - Date.now()) / 1000)
      if (rem <= 0) {
        clearInterval(timerRef.current)
        setLockedUntil(null)
        setCountdown(0)
        setAttempts(0)
        setError('')
      } else {
        setCountdown(rem)
      }
    }, 500)
  }

  useEffect(() => () => clearInterval(timerRef.current), [])

  async function handleSubmit(e) {
    e.preventDefault()
    if (lockedUntil || loading) return
    if (!username.trim() || !password) return

    setLoading(true)
    setError('')

    const ok = await login(username.trim(), password)

    if (ok) {
      // AuthContext sets user → App re-renders to the game automatically
      return
    }

    setLoading(false)
    const next = attempts + 1
    setAttempts(next)
    if (next >= MAX_ATTEMPTS) {
      startLockout()
      setError(`Too many failed attempts. Locked for ${LOCKOUT_SECONDS} seconds.`)
    } else {
      const left = MAX_ATTEMPTS - next
      setError(`Invalid credentials. ${left} attempt${left !== 1 ? 's' : ''} remaining.`)
    }
  }

  const isLocked  = !!lockedUntil
  const canSubmit = !loading && !isLocked && username.trim().length > 0 && password.length > 0

  // ── Shared input style ──────────────────────────────────────────────────────
  const inputStyle = {
    width: '100%', padding: '11px 12px', boxSizing: 'border-box',
    background: 'var(--surface-well)', border: '1px solid var(--rule-strong)',
    borderRadius: 8, color: 'var(--ink)',
    fontSize: 16, fontFamily: 'inherit',
    outline: 'none', opacity: isLocked ? 0.5 : 1,
    transition: 'border-color 0.15s, box-shadow 0.15s',
  }
  const labelStyle = {
    display: 'block', fontSize: 14.5, fontWeight: 600, color: 'var(--ink-2)',
    marginBottom: 6,
  }
  const focusOn  = e => { e.target.style.borderColor = 'var(--signal)'; e.target.style.boxShadow = '0 0 0 3px rgba(77,166,255,.22)' }
  const focusOff = e => { e.target.style.borderColor = 'var(--rule-strong)'; e.target.style.boxShadow = 'none' }

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      background: 'var(--surface-ground)', padding: 24,
    }}>

      {/* Hero */}
      <div style={{ marginBottom: 30, textAlign: 'center', userSelect: 'none', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <Faceplate />
        <h1 style={{ fontSize: 48, fontWeight: 700, letterSpacing: 0.2, color: 'var(--ink)', lineHeight: 1, marginTop: 22 }}>NetSim</h1>
        <p style={{ fontSize: 19, color: 'var(--ink-2)', marginTop: 10 }}>
          Configure real network gear. Get paid when it works.
        </p>
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 8, marginTop: 14,
          fontSize: 14, fontWeight: 600, color: 'var(--ink-2)',
          border: '1px solid var(--rule-strong)', borderRadius: 999, padding: '3px 12px 3px 10px',
        }}>
          <i className="led amber" style={{ width: 7, height: 7 }} /> Beta access
        </span>
      </div>

      {/* Card */}
      <div style={{
        width: '100%', maxWidth: 400,
        background: 'var(--surface-panel)', border: '1px solid var(--rule-strong)',
        borderRadius: 14, padding: '28px 28px 26px',
        boxShadow: 'var(--shadow-float)',
      }}>
        <form onSubmit={handleSubmit} autoComplete="off" noValidate>

          {/* Username field */}
          <div style={{ marginBottom: 16 }}>
            <label htmlFor="login-username" style={labelStyle}>Username</label>
            <input
              id="login-username"
              ref={userRef}
              type="text"
              value={username}
              onChange={e => setUsername(e.target.value)}
              disabled={loading || isLocked}
              autoComplete="username"
              spellCheck={false}
              style={inputStyle}
              onFocus={focusOn}
              onBlur={focusOff}
            />
          </div>

          {/* Password field */}
          <div style={{ marginBottom: 22 }}>
            <label htmlFor="login-password" style={labelStyle}>Password</label>
            <div style={{ position: 'relative' }}>
              <input
                id="login-password"
                type={showPw ? 'text' : 'password'}
                value={password}
                onChange={e => setPassword(e.target.value)}
                disabled={loading || isLocked}
                autoComplete="current-password"
                style={{ ...inputStyle, paddingRight: 64 }}
                onFocus={focusOn}
                onBlur={focusOff}
              />
              <button
                type="button"
                onClick={() => setShowPw(v => !v)}
                style={{
                  position: 'absolute', right: 4, top: 4, bottom: 4,
                  padding: '0 10px', background: 'none', border: 'none', borderRadius: 6,
                  cursor: 'pointer', color: 'var(--ink-3)', fontSize: 14, fontWeight: 600,
                }}
                aria-label={showPw ? 'Hide password' : 'Show password'}
              >
                {showPw ? 'Hide' : 'Show'}
              </button>
            </div>
          </div>

          {/* Error / lockout message */}
          {error && (
            <div role="alert" style={{
              marginBottom: 16, padding: '9px 12px',
              background: '#211412', border: '1px solid #4a2521',
              borderRadius: 8, color: '#ff8078', fontSize: 14.5,
              lineHeight: 1.45,
            }}>
              {isLocked
                ? `Locked — try again in ${countdown}s`
                : error
              }
            </div>
          )}

          {/* Submit */}
          <button
            type="submit"
            className="btn primary"
            disabled={!canSubmit}
            style={{ width: '100%', padding: '11px 0', fontSize: 16.5 }}
          >
            {loading ? 'Verifying…' : isLocked ? `Locked (${countdown}s)` : 'Sign in'}
          </button>

        </form>
      </div>

      {/* Honest security disclaimer */}
      <p style={{ marginTop: 26, maxWidth: 400, textAlign: 'center', fontSize: 13.5, color: 'var(--ink-3)', lineHeight: 1.6 }}>
        Beta testing access only. Credentials are stored as bcrypt hashes — not suitable
        for protecting sensitive personal data. Don&apos;t reuse passwords from other accounts.
      </p>

    </div>
  )
}
