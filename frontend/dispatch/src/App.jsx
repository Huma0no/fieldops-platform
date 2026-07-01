/**
 * src/App.jsx
 * Root component for the Dispatch panel.
 * Auth guard + top-level routing.
 */

import { AuthProvider, useAuth } from './lib/auth.jsx'
import Auth from './screens/Auth.jsx'
import PdfIntake from './screens/PdfIntake.jsx'

// Inject spinner keyframe globally
const spinStyle = document.createElement('style')
spinStyle.textContent = `@keyframes spin { to { transform: rotate(360deg); } }`
document.head.appendChild(spinStyle)

function AppRoutes () {
  const { session } = useAuth()
  if (!session) return <Auth />
  // Default view: PDF Intake. Additional routes added per phase.
  return <PdfIntake />
}

export default function App () {
  return (
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  )
}
