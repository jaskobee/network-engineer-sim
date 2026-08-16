import { useState, useRef, useEffect } from 'react'
import { useAuth } from '../state/AuthContext.jsx'

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
    width: '100%', padding: '10px 12px', boxSizing: 'border-box',
    background: '#07070d', border: '1px solid #1a1a3e',
    borderRadius: 4, color: '#e0e0e0',
    fontSize: 13, fontFamily: "'Courier New', Courier, monospace",
    outline: 'none', opacity: isLocked ? 0.5 : 1,
    transition: 'border-color 0.15s',
  }
  const labelStyle = {
    display: 'block', fontSize: 10, color: '#555',
    letterSpacing: 1.5, marginBottom: 6,
  }

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      background: '#07070d', fontFamily: "'Courier New', Courier, monospace",
      padding: 24,
    }}>

      {/* Logo */}
      <div style={{ marginBottom: 40, textAlign: 'center', userSelect: 'none' }}>
        <div style={{ fontSize: 38, fontWeight: 900, letterSpacing: 8, color: '#e0e0e0' }}>
          NETSIM
        </div>
        <div style={{ fontSize: 10, color: '#4a90e2', letterSpacing: 4, marginTop: 6 }}>
          NETWORK ENGINEER SIMULATOR
        </div>
        <div style={{
          display: 'inline-block', marginTop: 14,
          background: '#0a1f0a', border: '1px solid #1e5c1e',
          color: '#50fa7b', fontSize: 9, letterSpacing: 3,
          padding: '3px 12px', borderRadius: 2,
        }}>
          BETA ACCESS
        </div>
      </div>

      {/* Card */}
      <div style={{
        width: '100%', maxWidth: 380,
        background: '#0d0d1a', border: '1px solid #1a1a3e',
        borderRadius: 6, padding: '32px 32px 28px',
      }}>
        <div style={{ fontSize: 10, color: '#444', letterSpacing: 2, marginBottom: 28, textAlign: 'center' }}>
          SIGN IN TO CONTINUE
        </div>

        <form onSubmit={handleSubmit} autoComplete="off" noValidate>

          {/* Username field */}
          <div style={{ marginBottom: 16 }}>
            <label style={labelStyle}>USERNAME</label>
            <input
              ref={userRef}
              type="text"
              value={username}
              onChange={e => setUsername(e.target.value)}
              disabled={loading || isLocked}
              autoComplete="username"
              spellCheck={false}
              style={inputStyle}
              onFocus={e  => { e.target.style.borderColor = '#2a5298' }}
              onBlur={e   => { e.target.style.borderColor = '#1a1a3e' }}
            />
          </div>

          {/* Password field */}
          <div style={{ marginBottom: 24 }}>
            <label style={labelStyle}>PASSWORD</label>
            <div style={{ position: 'relative' }}>
              <input
                type={showPw ? 'text' : 'password'}
                value={password}
                onChange={e => setPassword(e.target.value)}
                disabled={loading || isLocked}
                autoComplete="current-password"
                style={{ ...inputStyle, paddingRight: 56 }}
                onFocus={e  => { e.target.style.borderColor = '#2a5298' }}
                onBlur={e   => { e.target.style.borderColor = '#1a1a3e' }}
              />
              <button
                type="button"
                onClick={() => setShowPw(v => !v)}
                tabIndex={-1}
                style={{
                  position: 'absolute', right: 0, top: 0, bottom: 0,
                  width: 48, background: 'none', border: 'none',
                  cursor: 'pointer', color: '#444',
                  fontSize: 9, letterSpacing: 0.5, fontFamily: 'inherit',
                }}
                aria-label={showPw ? 'Hide password' : 'Show password'}
              >
                {showPw ? 'HIDE' : 'SHOW'}
              </button>
            </div>
          </div>

          {/* Error / lockout message */}
          {error && (
            <div style={{
              marginBottom: 16, padding: '9px 12px',
              background: '#140808', border: '1px solid #3a1010',
              borderRadius: 4, color: '#ff5555', fontSize: 11,
              lineHeight: 1.5,
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
            disabled={!canSubmit}
            style={{
              width: '100%', padding: '11px 0',
              background: canSubmit ? '#2a5298' : '#0d0d2a',
              color:      canSubmit ? '#ffffff' : '#333',
              border: '1px solid ' + (canSubmit ? '#2a5298' : '#1a1a3e'),
              borderRadius: 4,
              fontSize: 12, fontWeight: 700, letterSpacing: 1.5,
              cursor: canSubmit ? 'pointer' : 'not-allowed',
              fontFamily: 'inherit', transition: 'background 0.15s, color 0.15s',
            }}
            onMouseEnter={e => { if (canSubmit) e.currentTarget.style.background = '#3a62a8' }}
            onMouseLeave={e => { if (canSubmit) e.currentTarget.style.background = '#2a5298' }}
          >
            {loading ? 'VERIFYING...' : isLocked ? `LOCKED (${countdown}s)` : 'SIGN IN'}
          </button>

        </form>
      </div>

      {/* Honest security disclaimer */}
      <div style={{ marginTop: 32, maxWidth: 380, textAlign: 'center' }}>
        <p style={{ fontSize: 9, color: '#2a2a3a', lineHeight: 1.8, margin: 0 }}>
          Beta testing access only. Credentials stored as bcrypt hashes — not suitable
          for protecting sensitive personal data. Do not reuse passwords from other accounts.
        </p>
      </div>

    </div>
  )
}
