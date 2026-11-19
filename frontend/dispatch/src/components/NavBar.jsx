/**
 * src/components/NavBar.jsx
 * Dispatch masthead and function-key navigation (docs/mockups/fieldops-dispatch-mockups.html, 00 Shell).
 * Added in F6 — first phase with multiple screens.
 */

const TABS = [
  { id: 'intake',      label: 'Call Intake' },
  { id: 'lobby',       label: 'Lobby' },
  { id: 'history',     label: 'History' },
  { id: 'inventory',   label: 'Inventory' },
  { id: 'restock',     label: 'Restock' },
  { id: 'pay',         label: 'Ledger' },
  { id: 'corrections', label: 'Corrections' },
  { id: 'chat',        label: 'Chat' },
  { id: 'catalog',     label: 'Catalog' },
  { id: 'technicians', label: 'Technicians' },
  { id: 'reports',     label: 'Reports' },
]

// THU · JUL 16 · 2026
function plateDate (date = new Date()) {
  const day = date.toLocaleDateString('en-US', { weekday: 'short' })
  const month = date.toLocaleDateString('en-US', { month: 'short' })
  return `${day} · ${month} ${date.getDate()} · ${date.getFullYear()}`.toUpperCase()
}

export default function NavBar ({ active, onNavigate, onLogout, operator }) {
  return (
    <>
      <header className="vd-masthead">
        <div className="vd-brand">FieldOps · Dispatch</div>
        <div className="vd-meta">
          {operator && <><span className="vd-stencil">Operator</span><span>{operator}</span></>}
          <span className="vd-plaque">{plateDate()}</span>
        </div>
      </header>
      <div className="vd-shell-nav">
        <nav className="vd-fnrow" aria-label="Dispatch sections">
          {TABS.map(tab => (
            <button
              key={tab.id}
              type="button"
              className={`vd-fkey${active === tab.id ? ' on' : ''}`}
              aria-current={active === tab.id ? 'page' : undefined}
              onClick={() => onNavigate(tab.id)}
            >
              <span className={`vd-led${active === tab.id ? ' on' : ''}`} aria-hidden="true" />
              {tab.label}
            </button>
          ))}
        </nav>
        <button type="button" className="vd-key sm" onClick={onLogout}>Sign out</button>
      </div>
    </>
  )
}
