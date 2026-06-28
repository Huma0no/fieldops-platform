/**
 * src/components/nav-bar.js
 * Bottom navigation bar — persistent across all main screens.
 *
 * Usage:
 *   import { NavBar } from '../components/nav-bar.js'
 *   const nav = NavBar({ active: 'my-calls', onNavigate: (route) => navigate(route) })
 *   appEl.appendChild(nav)
 */

const TABS = [
  {
    id:    'my-calls',
    label: 'My Calls',
    route: '/',
    icon:  `<svg width="22" height="22" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
              <rect x="3" y="4" width="18" height="16" rx="2"/>
              <line x1="3" y1="9" x2="21" y2="9"/>
              <line x1="8" y1="14" x2="13" y2="14"/>
              <line x1="8" y1="17" x2="11" y2="17"/>
            </svg>`,
  },
  {
    id:    'lobby',
    label: 'Lobby',
    route: '/lobby',
    icon:  `<svg width="22" height="22" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
              <circle cx="12" cy="12" r="9"/>
              <polyline points="12 8 12 12 14 14"/>
            </svg>`,
  },
  {
    id:    'reports',
    label: 'Reports',
    route: '/reports',
    icon:  `<svg width="22" height="22" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
              <polyline points="14 2 14 8 20 8"/>
              <line x1="8" y1="13" x2="16" y2="13"/>
              <line x1="8" y1="17" x2="13" y2="17"/>
            </svg>`,
  },
  {
    id:    'chat',
    label: 'Chat',
    route: '/chat',
    icon:  `<svg width="22" height="22" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
            </svg>`,
  },
  {
    id:    'settings',
    label: 'Settings',
    route: '/settings',
    icon:  `<svg width="22" height="22" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
              <circle cx="12" cy="8" r="4"/>
              <path d="M6 20v-2a6 6 0 0 1 12 0v2"/>
            </svg>`,
  },
]

export function NavBar ({ active, onNavigate, unreadChat = 0 }) {
  const nav = document.createElement('nav')
  nav.className = 'nav-bar'

  TABS.forEach(tab => {
    const btn      = document.createElement('button')
    const isActive = tab.id === active
    btn.className  = `nav-tab ${isActive ? 'nav-tab--active' : ''}`
    btn.setAttribute('aria-label', tab.label)

    btn.innerHTML = `
      <span class="nav-icon">${tab.icon}</span>
      <span class="nav-label">${tab.label}</span>
      ${tab.id === 'chat' && unreadChat > 0
        ? `<span class="nav-badge">${unreadChat > 9 ? '9+' : unreadChat}</span>`
        : ''}
    `

    btn.addEventListener('click', () => {
      if (!isActive) onNavigate(tab.route)
    })

    nav.appendChild(btn)
  })

  return nav
}

// Update unread badge without re-rendering the whole nav
export function updateChatBadge (navEl, count) {
  const chatTab = navEl.querySelector('[aria-label="Chat"]')
  if (!chatTab) return
  let badge = chatTab.querySelector('.nav-badge')
  if (count > 0) {
    if (!badge) {
      badge = document.createElement('span')
      badge.className = 'nav-badge'
      chatTab.appendChild(badge)
    }
    badge.textContent = count > 9 ? '9+' : count
  } else {
    badge?.remove()
  }
}

export const navBarStyles = `
  .nav-bar {
    display: flex;
    background: var(--surface-1);
    border-top: 0.5px solid var(--border-subtle);
    padding-bottom: env(safe-area-inset-bottom, 0px);
    flex-shrink: 0;
  }

  .nav-tab {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 3px;
    padding: 10px 4px;
    background: none;
    border: none;
    cursor: pointer;
    color: var(--text-disabled);
    position: relative;
    transition: color var(--dur-fast) var(--ease-out);
    -webkit-tap-highlight-color: transparent;
  }

  .nav-tab--active {
    color: var(--color-signal);
  }

  .nav-tab:not(.nav-tab--active):active {
    color: var(--text-muted);
  }

  .nav-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
  }

  .nav-label {
    font-size: 10px;
    font-weight: 400;
    letter-spacing: 0.01em;
    white-space: nowrap;
  }

  .nav-tab--active .nav-label {
    font-weight: 500;
  }

  .nav-badge {
    position: absolute;
    top: 6px;
    right: calc(50% - 18px);
    background: var(--color-heat);
    color: #fff;
    font-size: 9px;
    font-weight: 600;
    min-width: 16px;
    height: 16px;
    border-radius: var(--radius-pill);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0 4px;
  }
`
