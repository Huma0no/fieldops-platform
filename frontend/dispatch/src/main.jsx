import '@shared/tokens.css'
import './styles/dispatch.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'

if ('serviceWorker' in navigator) {
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
