/**
 * src/screens/Restock.jsx
 * F6 — Consumption report with mark-as-restocked action.
 */

import { useState } from 'react'
import { api } from '@shared/api.js'

export default function Restock () {
  const [report, setReport]     = useState([])
  const [loading, setLoading]   = useState(false)
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo]     = useState('')
  const [marking, setMarking]   = useState(new Set())
  const [marked, setMarked]     = useState(new Set())

  async function loadReport () {
    if (!dateFrom || !dateTo) return
    setLoading(true)
    try {
      const data = await api.get(`/dispatch/restock-report?dateFrom=${dateFrom}&dateTo=${dateTo}`)
      setReport(data ?? [])
      setMarked(new Set())
    } catch (err) {
      console.error('restock report failed:', err)
    } finally {
      setLoading(false)
    }
  }

  async function handleRestock (itemName) {
    setMarking(s => new Set(s).add(itemName))
    try {
      await api.post('/dispatch/restock-report/mark-restocked', { itemName, dateFrom, dateTo })
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
                const isDone    = marked.has(row.item_name)
                const isMarking = marking.has(row.item_name)
                return (
                  <tr key={row.item_name} style={{ ...styles.tr, opacity: isDone ? 0.5 : 1 }}>
                    <td style={styles.td}>{row.item_name}</td>
                    <td style={styles.td}>{row.total_consumed}</td>
                    <td style={styles.td}>
                      {row.by_technician?.map(t => (
                        <span key={t.technician_id} style={styles.techChip}>
                          {t.name}: {t.consumed}
                        </span>
                      ))}
                    </td>
                    <td style={styles.td}>
                      {isDone ? (
                        <span style={styles.doneTag}>Restocked</span>
                      ) : (
                        <button
                          style={styles.restockBtn}
                          onClick={() => handleRestock(row.item_name)}
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
}
