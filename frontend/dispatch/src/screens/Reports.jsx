/**
 * src/screens/Reports.jsx
 * Dispatch — on-demand Equipment/Accessory and Refrigerant usage reports.
 */

import { useState, useEffect } from 'react'
import { api } from '@shared/api.js'

;(function injectPrintStyles () {
  if (document.getElementById('reports-print-style')) return
  const s = document.createElement('style')
  s.id = 'reports-print-style'
  s.textContent = `
    .report-excluded { opacity: 0.28; text-decoration: line-through; }
    @media print {
      .no-print { display: none !important; }
      .report-excluded { display: none !important; }
      .report-section + .report-section { page-break-before: always; }
    }
  `
  document.head.appendChild(s)
})()

function weekRange () {
  const now = new Date()
  const day = now.getDay()
  const mon = new Date(now); mon.setDate(now.getDate() - ((day + 6) % 7))
  const sun = new Date(mon); sun.setDate(mon.getDate() + 6)
  const fmt = d => d.toISOString().slice(0, 10)
  return { dateFrom: fmt(mon), dateTo: fmt(sun) }
}

function fmtDate (iso) {
  if (!iso) return '—'
  try { return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) }
  catch { return '—' }
}

// ── Equipment section ──────────────────────────────────────────────────────────

function EquipmentSection ({ data, exclAddr, exclItem, onToggleAddr, onToggleItem }) {
  const addrMap = {}
  data.forEach(item => {
    item.byAddress.forEach(({ addressId, address, qty }) => {
      if (!addrMap[addressId]) addrMap[addressId] = { address, items: [] }
      addrMap[addressId].items.push({ itemName: item.itemName, category: item.category, qty })
    })
  })
  const addrGroups = Object.entries(addrMap).sort(([, a], [, b]) => a.address.localeCompare(b.address))

  const effectiveTotals = data.flatMap(item => {
    const inclQty = item.byAddress
      .filter(a => !exclAddr.has(a.addressId) && !exclItem.has(`${a.addressId}::${item.itemName}`))
      .reduce((s, a) => s + a.qty, 0)
    return inclQty > 0 ? [{ ...item, effectiveQty: inclQty }] : []
  })

  return (
    <section className="report-section" style={S.section}>
      <h3 style={S.sectionTitle}>Equipment &amp; Accessory Usage</h3>

      {data.length === 0 ? (
        <p style={S.empty}>No items found for the selected range.</p>
      ) : (
        <>
          {addrGroups.map(([addressId, { address, items }]) => {
            const addrExcl = exclAddr.has(addressId)
            return (
              <div key={addressId} className={addrExcl ? 'report-excluded' : ''} style={S.addrGroup}>
                <label style={S.addrLabel}>
                  <input
                    type="checkbox"
                    checked={!addrExcl}
                    onChange={() => onToggleAddr(addressId, items)}
                    style={{ marginRight: '6px' }}
                  />
                  <strong style={{ fontSize: '13px' }}>{address}</strong>
                </label>
                <table style={{ ...S.table, marginLeft: '20px', width: 'calc(100% - 20px)' }}>
                  <thead>
                    <tr>
                      <th style={S.th} className="no-print" />
                      <th style={S.th}>Item</th>
                      <th style={S.th}>Category</th>
                      <th style={S.th}>Qty</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map(({ itemName, category, qty }) => {
                      const itemExcl = addrExcl || exclItem.has(`${addressId}::${itemName}`)
                      return (
                        <tr key={itemName} className={itemExcl ? 'report-excluded' : ''} style={S.tr}>
                          <td style={S.td} className="no-print">
                            <input
                              type="checkbox"
                              checked={!itemExcl}
                              disabled={addrExcl}
                              onChange={() => !addrExcl && onToggleItem(addressId, itemName)}
                            />
                          </td>
                          <td style={S.td}>{itemName}</td>
                          <td style={S.td}>{category}</td>
                          <td style={S.td}>{qty}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )
          })}

          {effectiveTotals.length > 0 && (
            <div style={S.summaryWrap}>
              <div style={S.summaryLabel}>Totals — included items</div>
              <table style={S.table}>
                <thead>
                  <tr>
                    {['Item', 'Category', 'Total Qty', 'By Technician'].map(h => (
                      <th key={h} style={S.th}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {effectiveTotals.map(item => (
                    <tr key={item.itemName} style={S.tr}>
                      <td style={S.td}>{item.itemName}</td>
                      <td style={S.td}>{item.category}</td>
                      <td style={S.td}>{item.effectiveQty}</td>
                      <td style={S.td}>
                        {item.byTechnician.map(t => `${t.technicianName}: ${t.qty}`).join(', ')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  )
}

// ── Refrigerant section ────────────────────────────────────────────────────────

function RefrigerantSection ({ data, exclAddr, onToggleAddr }) {
  const addrMap = {}
  data.forEach(row => {
    if (!addrMap[row.addressId]) addrMap[row.addressId] = { address: row.address, rows: [] }
    addrMap[row.addressId].rows.push(row)
  })
  const addrGroups = Object.entries(addrMap).sort(([, a], [, b]) => a.address.localeCompare(b.address))

  return (
    <section className="report-section" style={S.section}>
      <h3 style={S.sectionTitle}>Refrigerant Usage</h3>

      {data.length === 0 ? (
        <p style={S.empty}>No refrigerant data found for the selected range.</p>
      ) : (
        addrGroups.map(([addressId, { address, rows }]) => {
          const addrExcl = exclAddr.has(addressId)
          return (
            <div key={addressId} className={addrExcl ? 'report-excluded' : ''} style={S.addrGroup}>
              <label style={S.addrLabel}>
                <input
                  type="checkbox"
                  checked={!addrExcl}
                  onChange={() => onToggleAddr(addressId)}
                  style={{ marginRight: '6px' }}
                />
                <strong style={{ fontSize: '13px' }}>{address}</strong>
              </label>
              <table style={{ ...S.table, marginLeft: '20px', width: 'calc(100% - 20px)' }}>
                <thead>
                  <tr>
                    {['System', 'Service', 'Adj. Oz', 'Factory Charge', 'Lineset Config', 'Date', 'Tech'].map(h => (
                      <th key={h} style={S.th}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, i) => (
                    <tr key={i} style={S.tr}>
                      <td style={S.td}>{row.systemNumber ?? '—'}</td>
                      <td style={S.td}>{row.serviceName ?? '—'}</td>
                      <td style={S.td}>{row.adjustedOz != null ? `${row.adjustedOz} oz` : '—'}</td>
                      <td style={S.td}>{row.factoryChargeUsed != null ? `${row.factoryChargeUsed} oz` : '—'}</td>
                      <td style={S.td}>{row.factoryLineConfig ?? '—'}</td>
                      <td style={S.td}>{fmtDate(row.completedAt)}</td>
                      <td style={S.td}>{row.technicianId ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        })
      )}
    </section>
  )
}

// ── Root screen ────────────────────────────────────────────────────────────────

export default function Reports () {
  const { dateFrom: defFrom, dateTo: defTo } = weekRange()
  const [dateFrom,     setDateFrom]     = useState(defFrom)
  const [dateTo,       setDateTo]       = useState(defTo)
  const [technicianId, setTechnicianId] = useState('')
  const [technicians,  setTechnicians]  = useState([])
  const [loading,      setLoading]      = useState(false)
  const [equipment,    setEquipment]    = useState(null)
  const [refrigerant,  setRefrigerant]  = useState(null)
  const [exclEqAddr,   setExclEqAddr]   = useState(new Set())
  const [exclEqItem,   setExclEqItem]   = useState(new Set())
  const [exclRefAddr,  setExclRefAddr]  = useState(new Set())

  useEffect(() => {
    api.get('/dispatch/technicians').then(d => setTechnicians(d ?? [])).catch(() => {})
  }, [])

  async function generate () {
    setLoading(true)
    setExclEqAddr(new Set()); setExclEqItem(new Set()); setExclRefAddr(new Set())
    try {
      const p = new URLSearchParams({ dateFrom, dateTo })
      if (technicianId) p.set('technicianId', technicianId)
      const [eq, ref] = await Promise.all([
        api.get(`/dispatch/reports/equipment?${p}`),
        api.get(`/dispatch/reports/refrigerant?${p}`),
      ])
      setEquipment(eq ?? [])
      setRefrigerant(ref ?? [])
    } catch (err) {
      console.error('report fetch failed:', err)
    } finally {
      setLoading(false)
    }
  }

  function toggleEqAddr (addressId, addrItems) {
    const wasExcluded = exclEqAddr.has(addressId)
    setExclEqAddr(prev => {
      const s = new Set(prev); wasExcluded ? s.delete(addressId) : s.add(addressId); return s
    })
    setExclEqItem(prev => {
      const s = new Set(prev)
      addrItems.forEach(({ itemName }) => {
        const k = `${addressId}::${itemName}`
        wasExcluded ? s.delete(k) : s.add(k)
      })
      return s
    })
  }

  function toggleEqItem (addressId, itemName) {
    const k = `${addressId}::${itemName}`
    setExclEqItem(prev => {
      const s = new Set(prev); s.has(k) ? s.delete(k) : s.add(k); return s
    })
  }

  function toggleRefAddr (addressId) {
    setExclRefAddr(prev => {
      const s = new Set(prev); s.has(addressId) ? s.delete(addressId) : s.add(addressId); return s
    })
  }

  const hasData = equipment !== null || refrigerant !== null

  return (
    <div style={S.page}>
      <div style={S.header} className="no-print">
        <h2 style={S.title}>Reports</h2>
        <div style={S.controls}>
          <input
            type="date"
            style={S.input}
            value={dateFrom}
            onChange={e => setDateFrom(e.target.value)}
          />
          <span style={S.sep}>–</span>
          <input
            type="date"
            style={S.input}
            value={dateTo}
            onChange={e => setDateTo(e.target.value)}
          />
          <select style={S.input} value={technicianId} onChange={e => setTechnicianId(e.target.value)}>
            <option value="">All technicians</option>
            {technicians.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <button style={S.btn} onClick={generate} disabled={loading}>
            {loading ? 'Loading…' : 'Generate'}
          </button>
          {hasData && (
            <button style={{ ...S.btn, ...S.printBtn }} onClick={() => window.print()}>
              Print / Export
            </button>
          )}
        </div>
      </div>

      <div style={S.body}>
        {!hasData && !loading && (
          <p style={S.empty} className="no-print">Select a date range and click Generate.</p>
        )}

        {equipment !== null && (
          <EquipmentSection
            data={equipment}
            exclAddr={exclEqAddr}
            exclItem={exclEqItem}
            onToggleAddr={toggleEqAddr}
            onToggleItem={toggleEqItem}
          />
        )}

        {refrigerant !== null && (
          <RefrigerantSection
            data={refrigerant}
            exclAddr={exclRefAddr}
            onToggleAddr={toggleRefAddr}
          />
        )}
      </div>
    </div>
  )
}

// ── Styles ─────────────────────────────────────────────────────────────────────

const S = {
  page:        { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'var(--surface-base)' },
  header:      { padding: '16px 24px', borderBottom: '0.5px solid var(--border-subtle)', display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap', flexShrink: 0, background: 'var(--surface-1)' },
  title:       { fontSize: '16px', fontWeight: 500, color: 'var(--text-primary)', flexShrink: 0 },
  controls:    { display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center', flex: 1 },
  sep:         { color: 'var(--text-disabled)', fontSize: '13px' },
  input:       { background: 'var(--surface-2)', border: '0.5px solid var(--border-default)', borderRadius: '6px', color: 'var(--text-primary)', fontSize: '13px', padding: '6px 10px', outline: 'none', fontFamily: 'var(--font-sans)' },
  btn:         { background: 'var(--color-signal)', color: '#fff', border: 'none', borderRadius: '6px', fontSize: '13px', fontWeight: 500, padding: '6px 14px', cursor: 'pointer' },
  printBtn:    { background: 'var(--surface-3)', color: 'var(--text-secondary)', border: '0.5px solid var(--border-default)' },
  body:        { flex: 1, overflowY: 'auto', padding: '24px', display: 'flex', flexDirection: 'column', gap: '32px' },
  empty:       { color: 'var(--text-muted)', fontSize: '14px' },
  section:     { display: 'flex', flexDirection: 'column', gap: '12px' },
  sectionTitle:{ fontSize: '15px', fontWeight: 600, color: 'var(--text-primary)', borderBottom: '0.5px solid var(--border-subtle)', paddingBottom: '8px', marginBottom: '4px' },
  addrGroup:   { display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: '16px' },
  addrLabel:   { display: 'flex', alignItems: 'center', fontSize: '13px', color: 'var(--text-secondary)', cursor: 'pointer', marginBottom: '4px' },
  table:       { width: '100%', borderCollapse: 'collapse', fontSize: '13px' },
  th:          { textAlign: 'left', padding: '6px 10px', color: 'var(--text-muted)', fontWeight: 500, fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.04em', borderBottom: '0.5px solid var(--border-subtle)' },
  tr:          { borderBottom: '0.5px solid var(--border-subtle)' },
  td:          { padding: '8px 10px', color: 'var(--text-secondary)', verticalAlign: 'middle' },
  summaryWrap: { borderTop: '1px solid var(--border-default)', paddingTop: '12px', marginTop: '4px' },
  summaryLabel:{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '8px', fontWeight: 500 },
}
