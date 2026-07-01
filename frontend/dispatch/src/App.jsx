/**
 * src/App.jsx
 * Root component for the Dispatch panel.
 * Auth guard + routing with NavBar.
 */

import { useState } from 'react'
import { AuthProvider, useAuth } from './lib/auth.jsx'
import NavBar      from './components/NavBar.jsx'
import Auth        from './screens/Auth.jsx'
import PdfIntake   from './screens/PdfIntake.jsx'
import History     from './screens/History.jsx'
import Inventory   from './screens/Inventory.jsx'
import Restock     from './screens/Restock.jsx'
import PayPeriods  from './screens/PayPeriods.jsx'
import Corrections from './screens/Corrections.jsx'

function LobbyPlaceholder () {
  return (
    <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', color:'var(--text-muted)', fontSize:'14px' }}>
      Lobby — coming in Phase F2 Dispatch
    </div>
  )
}

const spinStyle = document.createElement('style')
spinStyle.textContent = `@keyframes spin { to { transform: rotate(360deg); } }`
document.head.appendChild(spinStyle)

const SCREENS = {
  intake:      PdfIntake,
  lobby:       LobbyPlaceholder,
  history:     History,
  inventory:   Inventory,
  restock:     Restock,
  pay:         PayPeriods,
  corrections: Corrections,
}

function AppRoutes () {
  const { session }         = useAuth()
  const [active, setActive] = useState('intake')

  if (!session) return <Auth />

  const Screen = SCREENS[active] ?? PdfIntake

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
