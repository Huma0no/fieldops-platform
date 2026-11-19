/**
 * src/screens/Restock.jsx
 * F6 — Consumption report with mark-as-restocked action.
 */

import { useState } from 'react'
import { api } from '@shared/api.js'

export default function Restock () {
  const [report, setReport]         = useState([])
  const [loading, setLoading]       = useState(false)
  const [dateFrom, setDateFrom]     = useState('')
  const [dateTo, setDateTo]         = useState('')
  const [marking, setMarking]       = useState(new Set())
  const [marked, setMarked]         = useState(new Set())
  const [lowStockItems, setLowStock] = useState(new Set())

  async function loadReport () {
    if (!dateFrom || !dateTo) return
    setLoading(true)
    try {
      const [data, inv] = await Promise.all([
        api.get(`/dispatch/restock-report?dateFrom=${dateFrom}&dateTo=${dateTo}`),
        api.get('/dispatch/inventory').catch(() => []),
      ])
      setReport(data?.items ?? [])
      setMarked(new Set())

      // Flag items where any tech has balance <= 0
      const low = new Set()
      for (const tech of (inv ?? [])) {
        for (const item of (tech.items ?? [])) {
          if (item.balance <= 0) low.add(item.itemName)
        }
      }
      setLowStock(low)
    } catch (err) {
      console.error('restock report failed:', err)
    } finally {
      setLoading(false)
    }
  }

  async function handleRestock (itemName) {
    setMarking(s => new Set(s).add(itemName))
    try {
      await api.post('/dispatch/restock-report/mark-restocked', { periodStart: dateFrom, periodEnd: dateTo, itemNames: [itemName] })
      setMarked(s => new Set(s).add(itemName))
    } catch (err) {
      console.error('mark restocked failed:', err)
    } finally {
      setMarking(s => { const n = new Set(s); n.delete(itemName); return n })
    }
  }

  return (
    <div style={styles.page}>
      <div className="vd-unit">
        <div className="vd-unit-head"><span className="vd-unit-id">RST</span><span className="vd-unit-name">Restock report</span><span className="vd-unit-note">Consumed items · mark what was restocked</span></div>
        <div className="vd-knurl" />
        <div className="vd-unit-body">
          <div style={styles.controls}>
            <label style={styles.field}><span className="vd-label">From</span>
              <input className="vd-input data" type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
            </label>
            <label style={styles.field}><span className="vd-label">To</span>
              <input className="vd-input data" type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} />
            </label>
            <button type="button" className="vd-key dark" onClick={loadReport} disabled={!dateFrom || !dateTo}>
              Load report
            </button>
          </div>

          {loading ? (
            <p className="vd-hint" style={styles.flush}>Loading…</p>
          ) : report.length === 0 ? (
            <p className="vd-hint" style={styles.flush}>Select a date range and load the report.</p>
          ) : (
            <div style={styles.scrollX}>
              <table className="vd-table">
                <thead>
                  <tr>
                    <th>Item</th><th style={styles.right}>Total consumed</th><th>By technician</th><th />
                  </tr>
                </thead>
                <tbody>
                  {report.map(row => {
                    const isDone    = marked.has(row.itemName)
                    const isMarking = marking.has(row.itemName)
                    const isLow     = lowStockItems.has(row.itemName)
                    return (
                      <tr key={row.itemName} className={isDone ? 'inact' : ''}>
                        <td>
                          {row.itemName}
                          {isLow && <span className="vd-badge solid" style={styles.tag}>Low stock</span>}
                        </td>
                        <td className="num" style={styles.right}>{row.totalConsumed}</td>
                        <td>
                          <div className="vd-chips">
                            {row.byTechnician?.map(t => (
                              <span key={t.technicianId} className="vd-chip">
                                {t.technicianName}: <span className="vd-data">{t.consumed}</span>
                              </span>
                            ))}
                          </div>
                        </td>
                        <td style={styles.right}>
                          {isDone ? (
                            <span className="vd-badge hatch">Restocked</span>
                          ) : (
                            <button type="button" className="vd-key sm" onClick={() => handleRestock(row.itemName)} disabled={isMarking}>
                              {isMarking ? '…' : 'Mark restocked'}
                            </button>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// Layout only; the look comes from dispatch.css (vd-*).
const styles = {
  page:     { flex: 1, overflowY: 'auto', padding: '16px 18px 18px' },
  controls: { display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: '18px' },
  field:    { display: 'flex', flexDirection: 'column', minWidth: '150px' },
  flush:    { margin: 0 },
  scrollX:  { overflowX: 'auto' },
  right:    { textAlign: 'right' },
  tag:      { marginLeft: '8px' },
}
