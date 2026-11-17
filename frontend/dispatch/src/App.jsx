/**
 * src/App.jsx
 * Root component for the Dispatch panel.
 */

import { useState, useEffect, useRef } from 'react'
import { AuthProvider, useAuth } from './lib/auth.jsx'
import { api } from '@shared/api.js'
import NavBar            from './components/NavBar.jsx'
import Auth, { PasswordChange } from './screens/Auth.jsx'
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
import Reports           from './screens/Reports.jsx'

function useCompletionToasts (active) {
  const [toasts, setToasts] = useState([])
  const sinceRef = useRef(new Date().toISOString())

  useEffect(() => {
    if (!active) return
    const poll = setInterval(async () => {
      try {
        const since = encodeURIComponent(sinceRef.current)
        const data = await api.get(`/sync/changes?since=${since}`)
        sinceRef.current = data.serverTime
        const hits = (data.notifications ?? []).filter(n => n.type === 'completion_received')
        if (hits.length > 0) {
          setToasts(prev => [...prev, ...hits.map(n => ({ id: n.id, msg: n.body }))])
        }
      } catch (_) {}
    }, 20000)
    return () => clearInterval(poll)
  }, [active])

  const dismiss = id => setToasts(prev => prev.filter(t => t.id !== id))
  return { toasts, dismiss }
}

function Toast ({ id, msg, onDismiss }) {
  useEffect(() => {
    const t = setTimeout(() => onDismiss(id), 5000)
    return () => clearTimeout(t)
  }, [id, onDismiss])
  return (
    <div className="vd-alert" role="status">
      <span style={{ fontSize: '12px', flex: 1, lineHeight: 1.4 }}>{msg}</span>
      <button type="button" className="vd-key sm" aria-label="Dismiss" onClick={() => onDismiss(id)}>✕</button>
    </div>
  )
}

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
  reports:     Reports,
}

function AppRoutes () {
  const { session, logout }  = useAuth()
  const [active, setActive] = useState('intake')
  const [screenState, setScreenState] = useState(null)
  const { toasts, dismiss } = useCompletionToasts(!!session)

  if (!session) return <Auth />
  if (!['DISPATCH_OWNER', 'DISPATCHER', 'owner', 'dispatcher'].includes(session.dispatcher.role)) return <Auth />
  if (session.dispatcher.mustChangePassword) return <PasswordChange />

  const Screen = SCREENS[active] ?? CallIntake

  return (
    <div className="vd-shell">
      <div className="vd-rack">
        <span className="vd-screw tl" /><span className="vd-screw tr" /><span className="vd-screw bl" /><span className="vd-screw br" />
        <NavBar
          active={active}
          operator={session.dispatcher.name ?? session.dispatcher.username}
          onNavigate={(next) => { setActive(next); setScreenState(null) }}
          onLogout={logout}
        />
        <main className="vd-well">
          <Screen
            initialVisitId={active === 'corrections' ? screenState?.visitId : undefined}
            onCorrectReport={(visitId) => { setScreenState({ visitId }); setActive('corrections') }}
          />
        </main>
      </div>
      {toasts.length > 0 && (
        <div className="vd-toasts">
          {toasts.map(t => <Toast key={t.id} id={t.id} msg={t.msg} onDismiss={dismiss} />)}
        </div>
      )}
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
