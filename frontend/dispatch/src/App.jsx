/**
 * src/App.jsx
 * Root component for the Dispatch panel.
 * Handles auth guard and top-level routing.
 */

import { AuthProvider, useAuth } from './lib/auth.jsx'
import Auth from './screens/Auth.jsx'

// Screens are imported lazily as they're built phase by phase.
// Placeholder stubs are used until each screen is implemented.

function Placeholder ({ name }) {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      height: '100%',
      color: 'var(--text-muted)',
      fontSize: 'var(--text-base)',
    }}>
      {name} — coming in next phase
    </div>
  )
}

function AppRoutes () {
  const { session } = useAuth()

  if (!session) return <Auth />

  // Routing will be expanded each phase.
  // For F0 we just confirm auth works — routes to be wired in F1+.
  return <Placeholder name="Dispatch Panel" />
}

export default function App () {
  return (
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  )
}
