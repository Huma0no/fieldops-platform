/**
 * src/App.jsx
 * Root component for the Dispatch panel.
 */

import { useState } from 'react'
import { AuthProvider, useAuth } from './lib/auth.jsx'
import NavBar            from './components/NavBar.jsx'
import Auth              from './screens/Auth.jsx'
import CallIntake        from './screens/CallIntake.jsx'
import History           from './screens/History.jsx'
import Inventory         from './screens/Inventory.jsx'
import Restock           from './screens/Restock.jsx'
import PayPeriods        from './screens/PayPeriods.jsx'
import Corrections       from './screens/Corrections.jsx'
import Chat              from './screens/Chat.jsx'
import CatalogEditor     from './screens/CatalogEditor.jsx'
import TechnicianManager from './screens/TechnicianManager.jsx'
import Lobby             from './screens/Lobby.jsx'

const spinStyle = document.createElement('style')
spinStyle.textContent = `@keyframes spin { to { transform: rotate(360deg); } }`
document.head.appendChild(spinStyle)

const SCREENS = {
  intake:      CallIntake,
  lobby:       Lobby,
  history:     History,
  inventory:   Inventory,
  restock:     Restock,
  pay:         PayPeriods,
  corrections: Corrections,
  chat:        Chat,
  catalog:     CatalogEditor,
  technicians: TechnicianManager,
}

function AppRoutes () {
  const { session }         = useAuth()
  const [active, setActive] = useState('intake')

  if (!session) return <Auth />

  const Screen = SCREENS[active] ?? CallIntake

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100dvh', background:'var(--surface-base)', fontFamily:'var(--font-sans)', color:'var(--text-primary)' }}>
      <NavBar active={active} onNavigate={setActive} />
      <Screen />
    </div>
  )
}

export default function App () {
  return (
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  )
}
