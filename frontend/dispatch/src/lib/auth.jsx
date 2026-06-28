/**
 * src/lib/auth.jsx
 * Auth context for Dispatch panel.
 * Provides session state and expiry handling app-wide.
 */

import { createContext, useContext, useState, useEffect } from 'react'

const AuthContext = createContext(null)

function getSession () {
  const token = localStorage.getItem('deviceToken')
  const raw   = localStorage.getItem('technician')
  if (!token || !raw) return null
  try {
    return { token, dispatcher: JSON.parse(raw) }
  } catch (_) {
    return null
  }
}

export function AuthProvider ({ children }) {
  const [session, setSession] = useState(() => getSession())

  useEffect(() => {
    function onExpired () {
      localStorage.removeItem('deviceToken')
      localStorage.removeItem('technician')
      setSession(null)
    }
    window.addEventListener('auth:expired', onExpired)
    return () => window.removeEventListener('auth:expired', onExpired)
  }, [])

  function login (token, dispatcher) {
    localStorage.setItem('deviceToken', token)
    localStorage.setItem('technician', JSON.stringify(dispatcher))
    setSession({ token, dispatcher })
  }

  function logout () {
    localStorage.removeItem('deviceToken')
    localStorage.removeItem('technician')
    setSession(null)
  }

  return (
    <AuthContext.Provider value={{ session, login, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth () {
  return useContext(AuthContext)
}
