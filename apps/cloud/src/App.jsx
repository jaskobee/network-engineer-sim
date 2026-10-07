/**
 * Cloud Engineer — the Azure infrastructure simulator. A product of its own: its own build,
 * URL and save; it shares only the design system and the beta sign-in (@sim/ui) with NetSim.
 */
import { useAuth } from '@sim/ui/AuthContext.jsx'
import LoginPage from '@sim/ui/LoginPage.jsx'
import ProductSwitcher from '@sim/ui/ProductSwitcher.jsx'
import { CloudProvider } from './state/CloudContext.jsx'
import CloudWorkspace from './components/CloudWorkspace.jsx'
import CloudHero from './components/CloudHero.jsx'

export default function App() {
  const { user, logout } = useAuth()
  if (!user) return <LoginPage title="Cloud Engineer" tagline="Build Azure infrastructure. See how it fits together." hero={<CloudHero />} />
  return (
    <CloudProvider>
      <div className="app-layout">
        <header className="app-header">
          <div className="brand" title="Cloud Engineer — Azure infrastructure simulator">
            <span className="brand-leds" aria-hidden="true">
              <i className="led green" /><i className="led amber" /><i className="led" />
            </span>
            Cloud Engineer
            <span className="preview-tag">Preview</span>
          </div>
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
            <ProductSwitcher current="cloud" />
            <span className="user-chip" style={user.role === 'admin' ? { color: 'var(--led-amber)' } : undefined}>
              {user.displayName}
            </span>
            <button className="btn ghost" onClick={logout} title="Sign out">Sign out</button>
          </div>
        </header>
        <CloudWorkspace />
      </div>
    </CloudProvider>
  )
}
