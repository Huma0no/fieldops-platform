/**
 * src/components/home-tabs.js
 * Home groups Lobby, My Calls and Reports. The header shows them as text tabs
 * (replacing the section title); a horizontal swipe on the content switches
 * to the neighbouring tab. Per /docs/fieldops/NAVIGATION.md.
 */

export const HOME_TABS = [
  { id: 'lobby',    label: 'Lobby',    route: '/lobby' },
  { id: 'my-calls', label: 'My Calls', route: '/' },
  { id: 'reports',  label: 'Reports',  route: '/reports' },
]

const LAST_TAB_KEY = 'fo:homeTab'
const SWIPE_MIN_PX = 60

// Tapping Home opens the last-used tab; first time: My Calls.
export function lastHomeRoute () {
  try {
    const id = localStorage.getItem(LAST_TAB_KEY)
    return HOME_TABS.find(tab => tab.id === id)?.route ?? '/'
  } catch (_) {
    return '/'
  }
}

export function HomeTabs ({ active, onNavigate }) {
  try { localStorage.setItem(LAST_TAB_KEY, active) } catch (_) {}
  const el = document.createElement('div')
  el.className = 'home-tabs'
  el.setAttribute('role', 'tablist')
  for (const tab of HOME_TABS) {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = `home-tab${tab.id === active ? ' home-tab--active' : ''}`
    btn.setAttribute('role', 'tab')
    btn.setAttribute('aria-selected', String(tab.id === active))
    btn.textContent = tab.label
    btn.addEventListener('click', () => { if (tab.id !== active) onNavigate(tab.route) })
    el.appendChild(btn)
  }
  return el
}

export function attachHomeSwipe (contentEl, { active, onNavigate }) {
  let start = null
  contentEl.addEventListener('touchstart', e => {
    start = e.touches.length === 1 ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : null
  }, { passive: true })
  contentEl.addEventListener('touchend', e => {
    if (!start) return
    const dx = e.changedTouches[0].clientX - start.x
    const dy = e.changedTouches[0].clientY - start.y
    start = null
    if (Math.abs(dx) < SWIPE_MIN_PX || Math.abs(dx) < Math.abs(dy) * 1.5) return
    const index = HOME_TABS.findIndex(tab => tab.id === active) + (dx < 0 ? 1 : -1)
    if (HOME_TABS[index]) onNavigate(HOME_TABS[index].route)
  }, { passive: true })
}

export const homeTabStyles = `
  .screen-header:has(.home-tabs) { flex-wrap: wrap; gap: var(--space-2); }
  .home-tabs {
    flex: 1 1 220px;
    display: flex;
    gap: 6px;
    padding: 4px;
    border-radius: var(--fo-radius-md);
    box-shadow: var(--fo-shadow-inset);
  }
  .home-tab {
    flex: 1;
    min-height: 44px;
    padding: 0 4px;
    border: none;
    border-radius: var(--fo-radius-sm);
    background: none;
    color: var(--fo-ink-soft);
    font-family: var(--fo-font-mono);
    font-size: 13px;
    font-weight: 700;
    letter-spacing: 0.03em;
    white-space: nowrap;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
  }
  .home-tab--active {
    background: var(--fo-panel);
    box-shadow: var(--fo-shadow-raised);
    color: var(--fo-accent-deep);
  }
`
