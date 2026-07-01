/**
 * src/components/AddressModal.jsx
 * Address comparison modal — shown when addressMatchLevel returns 'partial'.
 * Dispatcher chooses one of three resolution options per API_CONTRACT.md.
 */

export default function AddressModal ({ extracted, existing, onResolve, onCancel }) {
  return (
    <div style={styles.overlay} onClick={e => { if (e.target === e.currentTarget) onCancel() }}>
      <div style={styles.modal}>
        <h2 style={styles.title}>This address may already exist</h2>

        <div style={styles.comparison}>
          <div style={styles.compRow}>
            <span style={styles.compLabel}>From PDF</span>
            <span style={styles.compValue}>{extracted}</span>
          </div>
          <div style={styles.compRow}>
            <span style={styles.compLabel}>In database</span>
            <span style={styles.compValue}>
              {existing?.street ?? '—'}
              {existing?.subdivision ? ` (${existing.subdivision})` : ''}
            </span>
          </div>
        </div>

        <p style={styles.question}>Which address should this visit be filed under?</p>

        <div style={styles.actions}>
          <button
            style={styles.optionBtn}
            onClick={() => onResolve('merge_keep_existing')}
          >
            <span style={styles.optionTitle}>Use existing</span>
            <span style={styles.optionSub}>Add visit under the address already in the system</span>
          </button>

          <button
            style={styles.optionBtn}
            onClick={() => onResolve('create_new')}
          >
            <span style={styles.optionTitle}>Create new address</span>
            <span style={styles.optionSub}>Treat as a different address and create a new record</span>
          </button>

          <button
            style={{ ...styles.optionBtn, ...styles.optionBtnMuted }}
            onClick={() => onResolve('merge_keep_new')}
          >
            <span style={styles.optionTitle}>Use PDF version</span>
            <span style={styles.optionSub}>Update the existing record with the address from the PDF</span>
          </button>
        </div>

        <button style={styles.cancelBtn} onClick={onCancel}>
          Go back
        </button>
      </div>
    </div>
  )
}

const styles = {
  overlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.6)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 100,
    padding: '24px',
  },
  modal: {
    width: '100%',
    maxWidth: '480px',
    background: 'var(--surface-1)',
    borderRadius: '12px',
    padding: '24px',
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
    border: '0.5px solid var(--border-default)',
  },
  title: {
    fontSize: '16px',
    fontWeight: 500,
    color: 'var(--text-primary)',
  },
  comparison: {
    background: 'var(--surface-2)',
    borderRadius: '8px',
    padding: '12px',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    border: '0.5px solid var(--border-subtle)',
  },
  compRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: '12px',
  },
  compLabel: {
    fontSize: '12px',
    color: 'var(--text-muted)',
    flexShrink: 0,
    width: '80px',
  },
  compValue: {
    fontSize: '13px',
    color: 'var(--text-primary)',
    textAlign: 'right',
  },
  question: {
    fontSize: '13px',
    color: 'var(--text-muted)',
  },
  actions: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  optionBtn: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: '2px',
    background: 'var(--surface-2)',
    border: '0.5px solid var(--border-default)',
    borderRadius: '8px',
    padding: '12px 14px',
    cursor: 'pointer',
    textAlign: 'left',
    transition: 'border-color 100ms',
  },
  optionBtnMuted: {
    opacity: 0.7,
  },
  optionTitle: {
    fontSize: '13px',
    fontWeight: 500,
    color: 'var(--text-primary)',
  },
  optionSub: {
    fontSize: '12px',
    color: 'var(--text-muted)',
  },
  cancelBtn: {
    background: 'none',
    border: 'none',
    color: 'var(--text-muted)',
    fontSize: '13px',
    cursor: 'pointer',
    padding: '4px 0',
    textAlign: 'left',
  },
}
