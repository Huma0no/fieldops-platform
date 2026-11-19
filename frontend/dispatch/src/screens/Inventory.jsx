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
  // Active technicians only (the endpoint's default, as in Reports).
  const [technicians, setTechnicians] = useState([])

  useEffect(() => { loadInventory() }, [])
  useEffect(() => {
    api.get('/dispatch/technicians').then(d => setTechnicians(d ?? [])).catch(() => {})
  }, [])

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
      <div className="vd-detail-cols">
        {/* Stock on hand, per technician */}
        <div className="vd-unit">
          <div className="vd-unit-head"><span className="vd-unit-id">STK</span><span className="vd-unit-name">Stock on hand</span><span className="vd-unit-note">This week · per technician</span></div>
          <div className="vd-knurl" />
          <div className="vd-unit-body">
            {loading ? (
              <p className="vd-hint" style={styles.flush}>Loading…</p>
            ) : inventory.length === 0 ? (
              <p className="vd-hint" style={styles.flush}>No inventory data.</p>
            ) : (
              // The API returns one entry per technician with that week's items.
              inventory.map(({ technicianId, technicianName, items }) => (
                <div key={technicianId} style={styles.techBlock}>
                  <div className="vd-group-bar"><span className="name">{technicianName}</span><span className="count">{items.length} items</span></div>
                  <div style={styles.scrollX}>
                    <table className="vd-table">
                      <thead>
                        <tr>
                          <th>Item</th><th style={styles.right}>Assigned</th><th style={styles.right}>Consumed</th><th style={styles.right}>Balance</th><th>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {items.map(item => {
                          const balance = item.balance
                          const low     = balance <= 2
                          return (
                            <tr key={item.itemName}>
                              <td>{item.itemName}</td>
                              <td className="num" style={styles.right}>{item.quantityAssigned}</td>
                              <td className="num" style={styles.right}>{item.quantityConsumed}</td>
                              <td className="num" style={styles.right}>{balance}</td>
                              <td>{low ? <span className="vd-badge solid">Low</span> : <span className="vd-badge">OK</span>}</td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Assign stock */}
        <div className="vd-unit">
          <div className="vd-unit-head"><span className="vd-unit-id">ASN</span><span className="vd-unit-name">Assign stock</span></div>
          <div className="vd-unit-body" style={styles.form}>
            <label><span className="vd-label">Technician</span>
              <select
                className="vd-input"
                value={assignForm.technicianId}
                onChange={e => setAssignForm(f => ({ ...f, technicianId: e.target.value }))}
              >
                <option value="">Select a technician…</option>
                {technicians.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </label>
            <label><span className="vd-label">Item name</span>
              <input
                className="vd-input"
                value={assignForm.itemName}
                onChange={e => setAssignForm(f => ({ ...f, itemName: e.target.value }))}
                placeholder="e.g. Float Switch"
              />
            </label>
            <label><span className="vd-label">Quantity</span>
              <input
                className="vd-input data"
                type="number"
                min="1"
                value={assignForm.quantity}
                onChange={e => setAssignForm(f => ({ ...f, quantity: e.target.value }))}
                placeholder="e.g. 10"
              />
            </label>
            <label><span className="vd-label">Period start</span>
              <input
                className="vd-input data"
                type="date"
                value={assignForm.periodStart}
                onChange={e => setAssignForm(f => ({ ...f, periodStart: e.target.value }))}
              />
            </label>

            {assignError   && <p className="vd-error">{assignError}</p>}
            {assignSuccess && <p className="vd-hint" style={styles.flush}>{assignSuccess}</p>}

            <button type="button" className="vd-key dark wide" onClick={handleAssign} disabled={assigning}>
              {assigning ? 'Assigning…' : 'Assign'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// Layout only; the look comes from dispatch.css (vd-*).
const styles = {
  page:      { flex: 1, overflowY: 'auto', padding: '16px 18px 18px' },
  flush:     { margin: 0 },
  scrollX:   { overflowX: 'auto' },
  right:     { textAlign: 'right' },
  techBlock: { marginBottom: '18px' },
  form:      { display: 'flex', flexDirection: 'column', gap: '12px' },
}
