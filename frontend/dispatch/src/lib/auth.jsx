/** Shared session state for the Dispatch panel. */
import { createContext, useContext, useState, useEffect } from 'react'
import { api } from '@shared/api.js'

const AuthContext = createContext(null)

function getSession () {
  try {
    const raw = localStorage.getItem('technician')
    return raw ? { dispatcher: JSON.parse(raw) } : null
  } catch (_) {
    return null
  }
}

export function AuthProvider ({ children }) {
  const [session, setSession] = useState(() => getSession())

  useEffect(() => {
    function onExpired () {
      localStorage.removeItem('technician')
      setSession(null)
    }
    window.addEventListener('auth:expired', onExpired)
    if (session) {
      api.get('/auth/me').then(({ user }) => {
        if (!['DISPATCH_OWNER', 'DISPATCHER'].includes(user.role)) throw new Error('This account does not have Dispatch access')
        login(user)
      }).catch(() => {})
    }
    return () => window.removeEventListener('auth:expired', onExpired)
  }, [])

  function login (user) {
    localStorage.setItem('technician', JSON.stringify(user))
    setSession({ dispatcher: user })
  }

  async function logout () {
    try { await api.post('/auth/logout', {}) } catch (_) {}
    localStorage.removeItem('technician')
    setSession(null)
  }

  return <AuthContext.Provider value={{ session, login, logout }}>{children}</AuthContext.Provider>
}

export function useAuth () {
  return useContext(AuthContext)
}
