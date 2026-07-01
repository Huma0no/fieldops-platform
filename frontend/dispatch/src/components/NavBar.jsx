/**
 * src/components/NavBar.jsx
 * Top navigation bar for the Dispatch panel.
 * Added in F6 — first phase with multiple screens.
 */

const TABS = [
  { id: 'intake',    label: 'PDF Intake',  icon: '📄' },
  { id: 'lobby',     label: 'Lobby',       icon: '🕐' },
  { id: 'history',   label: 'History',     icon: '📋' },
  { id: 'inventory', label: 'Inventory',   icon: '📦' },
  { id: 'restock',   label: 'Restock',     icon: '🔄' },
]

export default function NavBar ({ active, onNavigate }) {
  return (
    <nav style={styles.nav}>
      <div style={styles.logo}>Field Ops</div>
      <div style={styles.tabs}>
        {TABS.map(tab => (
          <button
            key={tab.id}
            style={{
              ...styles.tab,
              ...(active === tab.id ? styles.tabActive : {}),
            }}
            onClick={() => onNavigate(tab.id)}
          >
            <span style={styles.tabIcon}>{tab.icon}</span>
            <span>{tab.label}</span>
          </button>
        ))}
      </div>
    </nav>
  )
}

const styles = {
  nav: {
    display: 'flex',
    alignItems: 'center',
    gap: '24px',
    padding: '0 24px',
    height: '52px',
    background: 'var(--surface-1)',
    borderBottom: '0.5px solid var(--border-subtle)',
    flexShrink: 0,
  },
  logo: {
    fontSize: '14px',
    fontWeight: 600,
    color: 'var(--color-signal)',
    letterSpacing: '-0.01em',
    flexShrink: 0,
  },
  tabs: {
    display: 'flex',
    gap: '4px',
  },
  tab: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    background: 'none',
    border: 'none',
    borderRadius: '6px',
    padding: '6px 12px',
    fontSize: '13px',
    color: 'var(--text-muted)',
    cursor: 'pointer',
    transition: 'background 100ms, color 100ms',
  },
  tabActive: {
    background: 'var(--signal-tint)',
    color: 'var(--color-signal)',
  },
  tabIcon: { fontSize: '14px' },
}
