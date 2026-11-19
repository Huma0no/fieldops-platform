import '@shared/tokens.css'
import './styles/dispatch.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'

// Dev only: evict a FieldOps worker left on Dispatch's dev port. On the pilot
// server both apps share an origin, and FieldOps' worker must survive.
if (import.meta.env.DEV && 'serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then(registrations => {
    for (const registration of registrations) {
      registration.unregister()
    }
  }).catch(() => {})
}

createRoot(document.getElementById('app')).render(
  <StrictMode>
    <App />
  </StrictMode>
)
