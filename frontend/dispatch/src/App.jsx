/**
 * src/App.jsx
 * Root component for the Dispatch panel.
 */

import { useState, useEffect, useRef } from 'react'
import { AuthProvider, useAuth } from './lib/auth.jsx'
import { api } from '@shared/api.js'
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
    <div style={toastStyle}>
      <span style={{ fontSize: '12px', color: 'var(--text-secondary)', flex: 1, lineHeight: 1.4 }}>{msg}</span>
      <button
        style={{ background: 'none', border: 'none', color: 'var(--text-disabled)', cursor: 'pointer', padding: '0 0 0 8px', fontSize: '11px', flexShrink: 0 }}
        onClick={() => onDismiss(id)}
      >✕</button>
    </div>
  )
}

const toastStyle = {
  background: 'var(--surface-1)',
  border: '0.5px solid var(--border-default)',
  borderRadius: '8px',
  padding: '10px 14px',
  display: 'flex',
  alignItems: 'flex-start',
  gap: '8px',
  boxShadow: '0 2px 12px rgba(0,0,0,0.18)',
  minWidth: '240px',
  maxWidth: '340px',
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
  const { session }         = useAuth()
  const [active, setActive] = useState('intake')
  const { toasts, dismiss } = useCompletionToasts(!!session)

  if (!session) return <Auth />

  const Screen = SCREENS[active] ?? CallIntake

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100dvh', background:'var(--surface-base)', fontFamily:'var(--font-sans)', color:'var(--text-primary)' }}>
      <NavBar active={active} onNavigate={setActive} />
      <Screen />
      {toasts.length > 0 && (
        <div style={{ position:'fixed', bottom:'20px', right:'20px', display:'flex', flexDirection:'column', gap:'8px', zIndex:9999 }}>
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
