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
  const [assignForm, setAssignForm] = useState({ technicianId: '', itemName: '', quantity: '' })
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
    const { technicianId, itemName, quantity } = assignForm
    if (!technicianId || !itemName || !quantity) {
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
        quantity: Number(quantity),
      })
      setAssignSuccess(`Assigned ${quantity} × ${itemName}.`)
      setAssignForm({ technicianId: '', itemName: '', quantity: '' })
      loadInventory()
    } catch (err) {
      setAssignError('Assignment failed. Check the values and try again.')
      console.error('assign failed:', err)
    } finally {
      setAssigning(false)
    }
  }

  // Group inventory by technician
  const byTech = inventory.reduce((acc, row) => {
    const key = row.technician_id
    if (!acc[key]) acc[key] = { name: row.technician_name, items: [] }
    acc[key].items.push(row)
    return acc
  }, {})

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
          ) : Object.keys(byTech).length === 0 ? (
            <p style={styles.empty}>No inventory data.</p>
          ) : (
            Object.entries(byTech).map(([techId, { name, items }]) => (
              <div key={techId} style={styles.techBlock}>
                <p style={styles.techName}>{name}</p>
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
                      const balance = item.assigned - item.consumed
                      const low     = balance <= (item.low_threshold ?? 2)
                      return (
                        <tr key={item.item_name} style={styles.tr}>
                          <td style={styles.td}>{item.item_name}</td>
                          <td style={styles.td}>{item.assigned}</td>
                          <td style={styles.td}>{item.consumed}</td>
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
