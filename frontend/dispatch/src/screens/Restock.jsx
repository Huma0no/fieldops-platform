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
      <div style={styles.header}>
        <h2 style={styles.title}>Restock</h2>
        <div style={styles.filters}>
          <input
            style={styles.input}
            type="date"
            value={dateFrom}
            onChange={e => setDateFrom(e.target.value)}
          />
          <span style={styles.filterSep}>to</span>
          <input
            style={styles.input}
            type="date"
            value={dateTo}
            onChange={e => setDateTo(e.target.value)}
          />
          <button style={styles.searchBtn} onClick={loadReport} disabled={!dateFrom || !dateTo}>
            Load report
          </button>
        </div>
      </div>

      <div style={styles.tableWrap}>
        {loading ? (
          <p style={styles.loading}>Loading…</p>
        ) : report.length === 0 ? (
          <p style={styles.empty}>Select a date range and load the report.</p>
        ) : (
          <table style={styles.table}>
            <thead>
              <tr>
                {['Item','Total consumed','By technician',''].map(h => (
                  <th key={h} style={styles.th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {report.map(row => {
                const isDone    = marked.has(row.itemName)
                const isMarking = marking.has(row.itemName)
                const isLow     = lowStockItems.has(row.itemName)
                return (
                  <tr key={row.itemName} style={{ ...styles.tr, opacity: isDone ? 0.5 : 1 }}>
                    <td style={styles.td}>
                      {row.itemName}
                      {isLow && <span style={styles.lowTag}>low stock</span>}
                    </td>
                    <td style={styles.td}>{row.totalConsumed}</td>
                    <td style={styles.td}>
                      {row.byTechnician?.map(t => (
                        <span key={t.technicianId} style={styles.techChip}>
                          {t.technicianName}: {t.consumed}
                        </span>
                      ))}
                    </td>
                    <td style={styles.td}>
                      {isDone ? (
                        <span style={styles.doneTag}>Restocked</span>
                      ) : (
                        <button
                          style={styles.restockBtn}
                          onClick={() => handleRestock(row.itemName)}
                          disabled={isMarking}
                        >
                          {isMarking ? '…' : 'Mark restocked'}
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

const styles = {
  page:      { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'var(--surface-base)' },
  header:    { padding: '16px 24px', borderBottom: '0.5px solid var(--border-subtle)', background: 'var(--surface-1)', display: 'flex', alignItems: 'center', gap: '16px', flexShrink: 0, flexWrap: 'wrap' },
  title:     { fontSize: '16px', fontWeight: 500, color: 'var(--text-primary)', flexShrink: 0 },
  filters:   { display: 'flex', alignItems: 'center', gap: '8px' },
  filterSep: { fontSize: '12px', color: 'var(--text-muted)' },
  input:     { background: 'var(--surface-2)', border: '0.5px solid var(--border-default)', borderRadius: '6px', color: 'var(--text-primary)', fontSize: '13px', padding: '6px 10px', outline: 'none' },
  searchBtn: { background: 'var(--color-signal)', color: '#fff', border: 'none', borderRadius: '6px', fontSize: '13px', fontWeight: 500, padding: '6px 14px', cursor: 'pointer' },
  tableWrap: { flex: 1, overflowY: 'auto', padding: '16px 24px' },
  loading:   { color: 'var(--text-muted)', fontSize: '14px' },
  empty:     { color: 'var(--text-muted)', fontSize: '14px' },
  table:     { width: '100%', borderCollapse: 'collapse', fontSize: '13px' },
  th:        { textAlign: 'left', padding: '8px 12px', color: 'var(--text-muted)', fontWeight: 500, fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.04em', borderBottom: '0.5px solid var(--border-subtle)' },
  tr:        { borderBottom: '0.5px solid var(--border-subtle)' },
  td:        { padding: '10px 12px', color: 'var(--text-secondary)', verticalAlign: 'top' },
  techChip:  { display: 'inline-block', fontSize: '11px', color: 'var(--text-muted)', background: 'var(--surface-3)', padding: '2px 8px', borderRadius: '99px', marginRight: '4px', marginBottom: '2px' },
  doneTag:   { fontSize: '11px', color: '#22C55E', background: 'rgba(34,197,94,0.12)', padding: '3px 10px', borderRadius: '99px' },
  restockBtn:{ background: 'none', border: '0.5px solid var(--border-default)', borderRadius: '6px', color: 'var(--text-muted)', fontSize: '12px', padding: '4px 10px', cursor: 'pointer' },
  lowTag:    { marginLeft: '6px', fontSize: '10px', color: 'var(--color-plasma)', background: 'var(--plasma-tint)', padding: '1px 6px', borderRadius: '99px', border: '0.5px solid var(--plasma-border)' },
}
