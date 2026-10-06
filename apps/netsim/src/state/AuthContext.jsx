/**
 * Client-side authentication context.
 *
 * SECURITY NOTICE: This is a client-side gate, not a real server-side auth system.
 * Credentials are stored as bcrypt hashes (salt rounds = 12). The hashes live in
 * this source file, which means a determined attacker with access to the bundle can
 * extract them and attempt an offline brute-force attack.
 *
 * What this DOES protect against:
 *   - Casual visitors accidentally accessing a beta you haven't announced yet
 *   - People without the passphrase stumbling in
 *
 * What this does NOT protect against:
 *   - Someone who can read your JS bundle and run an offline hash crack
 *   - Use for anything involving real personal data
 *
 * To change a password, generate a new hash:
 *   node -e "import('bcryptjs').then(b => b.default.hash('new-password', 12).then(h => console.log(h)))"
 * Then replace the hash value below.
 */
import { createContext, useContext, useState } from 'react'
import bcrypt from 'bcryptjs'

const USERS = {
  admin: {
    // Password: Ping2026-Admin!
    hash: '$2b$12$KjGNVNqp4QB8/aysRKYntOoTwLSXCNngFWzGVSbyQr8AyJACdC19W',
    role: 'admin',
    displayName: 'Admin',
  },
  test: {
    // Password: Ping2026-Test!
    hash: '$2b$12$7YtCnuEqWJ2JRCbekwJ7kON9MqBQ8l/V9bydnUZg5wxtFtkalrnsG',
    role: 'test',
    displayName: 'Tester',
  },
}

const SESSION_KEY = 'netsim_session'
const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    try {
      const raw = sessionStorage.getItem(SESSION_KEY)
      return raw ? JSON.parse(raw) : null
    } catch {
      return null
    }
  })

  // Returns true on success, false on wrong credentials.
  // Uses async bcrypt.compare so the UI stays responsive during the hash check.
  async function login(username, password) {
    const record = USERS[username.trim().toLowerCase()]
    if (!record) return false
    const valid = await bcrypt.compare(password, record.hash)
    if (!valid) return false
    const session = {
      username: username.trim().toLowerCase(),
      role: record.role,
      displayName: record.displayName,
    }
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(session))
    setUser(session)
    return true
  }

  function logout() {
    sessionStorage.removeItem(SESSION_KEY)
    setUser(null)
  }

  return (
    <AuthContext.Provider value={{ user, login, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
