/**
 * src/components/AddressModal.jsx
 * Address comparison modal — shown when addressMatchLevel returns 'partial'.
 * Dispatcher chooses one of three resolution options per API_CONTRACT.md.
 */

export default function AddressModal ({ extracted, existing, onResolve, onCancel }) {
  return (
    <div className="vd-scrim" onClick={e => { if (e.target === e.currentTarget) onCancel() }}>
      <div className="vd-rack" role="dialog" aria-modal="true" aria-labelledby="address-modal-title" style={styles.modal}>
        <span className="vd-screw tl" /><span className="vd-screw tr" /><span className="vd-screw bl" /><span className="vd-screw br" />
        <h2 id="address-modal-title" className="vd-brand" style={styles.title}>This address may already exist</h2>

        <table className="vd-table">
          <tbody>
            <tr>
              <td><span className="vd-stencil">From PDF</span></td>
              <td>{extracted}</td>
            </tr>
            <tr>
              <td><span className="vd-stencil">In database</span></td>
              <td>
                {existing?.street ?? '—'}
                {existing?.subdivision ? ` (${existing.subdivision})` : ''}
              </td>
            </tr>
          </tbody>
        </table>

        <p className="vd-hint" style={styles.flush}>Which address should this visit be filed under?</p>

        <div style={styles.actions}>
          <button type="button" className="vd-option" onClick={() => onResolve('merge_keep_existing')}>
            <span className="title">Use existing</span>
            <span className="line">Add visit under the address already in the system</span>
          </button>

          <button type="button" className="vd-option" onClick={() => onResolve('create_new')}>
            <span className="title">Create new address</span>
            <span className="line">Treat as a different address and create a new record</span>
          </button>

          <button type="button" className="vd-option off" onClick={() => onResolve('merge_keep_new')}>
            <span className="title">Use PDF version</span>
            <span className="line">Update the existing record with the address from the PDF</span>
          </button>
        </div>

        <button type="button" className="vd-key sm off" style={styles.back} onClick={onCancel}>
          Go back
        </button>
      </div>
    </div>
  )
}

// Layout only; the look comes from dispatch.css (vd-*).
const styles = {
  modal:   { width: '100%', maxWidth: '520px', display: 'flex', flexDirection: 'column', gap: '16px' },
  title:   { margin: 0, fontSize: '20px', borderBottom: '3px solid var(--vd-ink)', paddingBottom: '10px' },
  flush:   { margin: 0 },
  actions: { display: 'flex', flexDirection: 'column', gap: '12px' },
  back:    { alignSelf: 'flex-start' },
}
