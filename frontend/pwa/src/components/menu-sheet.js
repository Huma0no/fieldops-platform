/**
 * src/components/menu-sheet.js
 * Bottom sheet opened from the nav bar's Menu tab. Contains Settings and
 * Transfers — see /docs/fieldops/NAVIGATION.md.
 */

export function MenuSheet ({ onNavigate, onClose }) {
  const overlay = document.createElement('div')
  overlay.className = 'ms-overlay'
  overlay.addEventListener('click', e => { if (e.target === overlay) onClose() })

  const sheet = document.createElement('div')
  sheet.className = 'ms-sheet'

  const title = document.createElement('p')
  title.className = 'ms-title'
  title.textContent = 'Menu'
  sheet.appendChild(title)

  ;[
    { label: 'Settings',  route: '/settings' },
    { label: 'Transfers', route: '/transfers/incoming' },
  ].forEach(({ label, route }) => {
    const btn = document.createElement('button')
    btn.className = 'ms-item'
    btn.textContent = label
    btn.addEventListener('click', () => {
      onClose()
      onNavigate(route)
    })
    sheet.appendChild(btn)
  })

  overlay.appendChild(sheet)
  return overlay
}

export const menuSheetStyles = `
  .ms-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,0.6);
    display: flex;
    align-items: flex-end;
    z-index: 100;
  }

  .ms-sheet {
    width: 100%;
    background: var(--fo-panel, var(--surface-1));
    border-radius: var(--fo-radius-lg, 16px) var(--fo-radius-lg, 16px) 0 0;
    padding: var(--space-5, 20px);
    padding-bottom: calc(var(--space-5, 20px) + env(safe-area-inset-bottom, 0px));
    display: flex;
    flex-direction: column;
    gap: var(--space-2, 8px);
  }

  .ms-title {
    font-size: var(--text-sm, 13px);
    font-weight: 500;
    color: var(--fo-ink-soft, var(--text-muted));
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin-bottom: var(--space-2, 8px);
  }

  .ms-item {
    background: var(--fo-well, var(--surface-2));
    border: none;
    border-radius: var(--fo-radius-sm, 8px);
    color: var(--fo-ink, var(--text-primary));
    font-size: var(--text-base, 15px);
    font-weight: 500;
    text-align: left;
    padding: var(--space-4, 16px);
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
  }

  .ms-item:active {
    color: var(--fo-accent-deep, var(--color-signal));
  }
`
