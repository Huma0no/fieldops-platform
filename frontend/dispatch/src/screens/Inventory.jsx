/**
 * src/screens/Inventory.jsx
 * F6 — Per-technician inventory balance + stock assignment.
 */

import { useState, useEffect } from 'react'
import { api } from '@shared/api.js'

export default function Inventory () {
  const [inventory, setInventory] = useState([])
  const [loading, setLoading]     = useState(true)
  const [assigning, setAssigning] = useState(false)
  const [assignForm, setAssignForm] = useState({ technicianId: '', itemName: '', quantity: '', periodStart: '' })
  const [assignError, setAssignError] = useState('')
  const [assignSuccess, setAssignSuccess] = useState('')

  useEffect(() => { loadInventory() }, [])

  async function loadInventory () {
    setLoading(true)
    try {
      const data = await api.get('/dispatch/inventory')
      setInventory(data ?? [])
    } catch (err) {
      console.error('inventory load failed:', err)
    } finally {
      setLoading(false)
    }
  }

  async function handleAssign () {
    const { technicianId, itemName, quantity, periodStart } = assignForm
    if (!technicianId || !itemName || !quantity || !periodStart) {
      setAssignError('All fields are required.')
      return
    }
    setAssigning(true)
    setAssignError('')
    setAssignSuccess('')
    try {
      await api.post('/dispatch/inventory/assign', {
        technicianId,
        itemName,
        quantityAssigned: Number(quantity),
        periodStart,
      })
      setAssignSuccess(`Assigned ${quantity} × ${itemName}.`)
      setAssignForm({ technicianId: '', itemName: '', quantity: '', periodStart: '' })
      loadInventory()
    } catch (err) {
      setAssignError('Assignment failed. Check the values and try again.')
      console.error('assign failed:', err)
    } finally {
      setAssigning(false)
    }
  }


  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h2 style={styles.title}>Inventory</h2>
      </div>

      <div style={styles.body}>
        {/* Left — inventory table */}
        <div style={styles.tablePane}>
          {loading ? (
            <p style={styles.loading}>Loading…</p>
          ) : inventory.length === 0 ? (
            <p style={styles.empty}>No inventory data.</p>
          ) : (
            // The API returns one entry per technician with that week's items.
            inventory.map(({ technicianId, technicianName, items }) => (
              <div key={technicianId} style={styles.techBlock}>
                <p style={styles.techName}>{technicianName}</p>
                <table style={styles.table}>
                  <thead>
                    <tr>
                      {['Item','Assigned','Consumed','Balance'].map(h => (
                        <th key={h} style={styles.th}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {items.map(item => {
                      const balance = item.balance
                      const low     = balance <= 2
                      return (
                        <tr key={item.itemName} style={styles.tr}>
                          <td style={styles.td}>{item.itemName}</td>
                          <td style={styles.td}>{item.quantityAssigned}</td>
                          <td style={styles.td}>{item.quantityConsumed}</td>
                          <td style={{ ...styles.td, color: low ? 'var(--color-plasma)' : 'var(--text-primary)', fontWeight: low ? 600 : 400 }}>
                            {balance}
                            {low && <span style={styles.lowTag}>low</span>}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            ))
          )}
        </div>

        {/* Right — assign stock */}
        <div style={styles.assignPane}>
          <p style={styles.sectionTitle}>Assign stock</p>

          <div style={styles.form}>
            <div style={styles.fieldRow}>
              <label style={styles.fieldLabel}>Technician ID</label>
              <input
                style={styles.input}
                value={assignForm.technicianId}
                onChange={e => setAssignForm(f => ({ ...f, technicianId: e.target.value }))}
                placeholder="Technician ID"
              />
            </div>
            <div style={styles.fieldRow}>
              <label style={styles.fieldLabel}>Item name</label>
              <input
                style={styles.input}
                value={assignForm.itemName}
                onChange={e => setAssignForm(f => ({ ...f, itemName: e.target.value }))}
                placeholder="e.g. Float Switch"
              />
            </div>
            <div style={styles.fieldRow}>
              <label style={styles.fieldLabel}>Quantity</label>
              <input
                style={styles.input}
                type="number"
                min="1"
                value={assignForm.quantity}
                onChange={e => setAssignForm(f => ({ ...f, quantity: e.target.value }))}
                placeholder="e.g. 10"
              />
            </div>
            <div style={styles.fieldRow}>
              <label style={styles.fieldLabel}>Period start</label>
              <input
                style={styles.input}
                type="date"
                value={assignForm.periodStart}
                onChange={e => setAssignForm(f => ({ ...f, periodStart: e.target.value }))}
              />
            </div>

            {assignError   && <p style={styles.errorText}>{assignError}</p>}
            {assignSuccess && <p style={styles.successText}>{assignSuccess}</p>}

            <button style={styles.assignBtn} onClick={handleAssign} disabled={assigning}>
              {assigning ? 'Assigning…' : 'Assign'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

const styles = {
  page:   { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'var(--surface-base)' },
  header: { padding: '16px 24px', borderBottom: '0.5px solid var(--border-subtle)', background: 'var(--surface-1)', flexShrink: 0 },
  title:  { fontSize: '16px', fontWeight: 500, color: 'var(--text-primary)' },
  body:   { flex: 1, display: 'flex', overflow: 'hidden' },

  tablePane:  { flex: 1, overflowY: 'auto', padding: '20px 24px', borderRight: '0.5px solid var(--border-subtle)', display: 'flex', flexDirection: 'column', gap: '24px' },
  techBlock:  { display: 'flex', flexDirection: 'column', gap: '8px' },
  techName:   { fontSize: '13px', fontWeight: 500, color: 'var(--text-secondary)' },
  table:      { width: '100%', borderCollapse: 'collapse', fontSize: '13px' },
  th:         { textAlign: 'left', padding: '6px 10px', color: 'var(--text-muted)', fontWeight: 500, fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.04em', borderBottom: '0.5px solid var(--border-subtle)' },
  tr:         { borderBottom: '0.5px solid var(--border-subtle)' },
  td:         { padding: '8px 10px', color: 'var(--text-secondary)' },
  lowTag:     { marginLeft: '6px', fontSize: '10px', color: 'var(--color-plasma)', background: 'var(--plasma-tint)', padding: '1px 6px', borderRadius: '99px', border: '0.5px solid var(--plasma-border)' },

  assignPane:   { flex: '0 0 280px', padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: '16px' },
  sectionTitle: { fontSize: '11px', color: 'var(--text-disabled)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 500 },
  form:         { display: 'flex', flexDirection: 'column', gap: '12px' },
  fieldRow:     { display: 'flex', flexDirection: 'column', gap: '3px' },
  fieldLabel:   { fontSize: '11px', color: 'var(--text-muted)', fontWeight: 500 },
  input:        { background: 'var(--surface-2)', border: '0.5px solid var(--border-default)', borderRadius: '6px', color: 'var(--text-primary)', fontSize: '13px', padding: '6px 10px', outline: 'none' },
  errorText:    { fontSize: '12px', color: 'var(--color-heat)' },
  successText:  { fontSize: '12px', color: '#22C55E' },
  assignBtn:    { background: 'var(--color-signal)', color: '#fff', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: 500, padding: '10px', cursor: 'pointer' },
  loading:      { color: 'var(--text-muted)', fontSize: '14px' },
  empty:        { color: 'var(--text-muted)', fontSize: '14px' },
}
