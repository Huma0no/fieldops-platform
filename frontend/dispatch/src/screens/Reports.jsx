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
    .report-excluded { opacity: 0.45; text-decoration: line-through; }
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

// A YYYY-MM-DD picker value is a local calendar day (not UTC midnight).
function fmtDay (day) {
  return day ? fmtDate(`${day}T00:00:00`) : '—'
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
    <section className="report-section vd-unit">
      <div className="vd-unit-head"><span className="vd-unit-id">05A</span><span className="vd-unit-name">Equipment &amp; Accessory Usage</span></div>
      <div className="vd-unit-body">
      {data.length === 0 ? (
        <p className="vd-hint" style={S.flush}>No items found for the selected range.</p>
      ) : (
        <>
          {effectiveTotals.length > 0 && (
            <div className="vd-register" aria-label="Included totals">
              {effectiveTotals.map(item => (
                <div key={item.itemName} className="vd-reg-item">
                  <div className="vd-reg-win">{item.effectiveQty}</div>
                  <div className="vd-reg-label">{item.itemName}</div>
                </div>
              ))}
            </div>
          )}

          {addrGroups.map(([addressId, { address, items }]) => {
            const addrExcl = exclAddr.has(addressId)
            return (
              <div key={addressId} className={addrExcl ? 'report-excluded' : ''} style={S.addrGroup}>
                <label className={`vd-group-bar${addrExcl ? ' out' : ''}`} style={S.addrLabel}>
                  <input
                    type="checkbox"
                    className="no-print"
                    checked={!addrExcl}
                    onChange={() => onToggleAddr(addressId, items)}
                  />
                  <span className="name" style={S.addrName}>{address}</span>
                </label>
                <table className="vd-table" style={S.groupTable}>
                  <thead>
                    <tr>
                      <th className="no-print" style={S.checkCol} />
                      <th>Item</th>
                      <th>Category</th>
                      <th style={S.right}>Qty</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map(({ itemName, category, qty }) => {
                      const itemExcl = addrExcl || exclItem.has(`${addressId}::${itemName}`)
                      return (
                        <tr key={itemName} className={itemExcl ? 'report-excluded' : ''}>
                          <td className="no-print" style={S.checkCol}>
                            <input
                              type="checkbox"
                              aria-label={`Include ${itemName}`}
                              checked={!itemExcl}
                              disabled={addrExcl}
                              onChange={() => !addrExcl && onToggleItem(addressId, itemName)}
                            />
                          </td>
                          <td>{itemName}</td>
                          <td>{category}</td>
                          <td className="num" style={S.right}>{qty}</td>
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
              <h4 className="vd-sub">Totals — included items</h4>
              <table className="vd-table">
                <thead>
                  <tr>
                    <th>Item</th><th>Category</th><th style={S.right}>Total Qty</th><th>By Technician</th>
                  </tr>
                </thead>
                <tbody>
                  {effectiveTotals.map(item => (
                    <tr key={item.itemName}>
                      <td>{item.itemName}</td>
                      <td>{item.category}</td>
                      <td className="num" style={S.right}>{item.effectiveQty}</td>
                      <td>{item.byTechnician.map(t => `${t.technicianName}: ${t.qty}`).join(', ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
      </div>
    </section>
  )
}

// ── Refrigerant section ────────────────────────────────────────────────────────

function RefrigerantSection ({ data, exclAddr, onToggleAddr, technicians }) {
  const techName = id => technicians.find(t => t.id === id)?.name ?? id ?? '—'
  const addrMap = {}
  data.forEach(row => {
    if (!addrMap[row.addressId]) addrMap[row.addressId] = { address: row.address, rows: [] }
    addrMap[row.addressId].rows.push(row)
  })
  const addrGroups = Object.entries(addrMap).sort(([, a], [, b]) => a.address.localeCompare(b.address))

  return (
    <section className="report-section vd-unit">
      <div className="vd-unit-head"><span className="vd-unit-id">05B</span><span className="vd-unit-name">Refrigerant Usage</span></div>
      <div className="vd-unit-body">
      {data.length === 0 ? (
        <p className="vd-hint" style={S.flush}>No refrigerant data found for the selected range.</p>
      ) : (
        addrGroups.map(([addressId, { address, rows }]) => {
          const addrExcl = exclAddr.has(addressId)
          return (
            <div key={addressId} className={addrExcl ? 'report-excluded' : ''} style={S.addrGroup}>
              <label className={`vd-group-bar${addrExcl ? ' out' : ''}`} style={S.addrLabel}>
                <input
                  type="checkbox"
                  className="no-print"
                  checked={!addrExcl}
                  onChange={() => onToggleAddr(addressId)}
                />
                <span className="name" style={S.addrName}>{address}</span>
              </label>
              <div style={S.scrollX}>
              <table className="vd-table" style={S.groupTable}>
                <thead>
                  <tr>
                    {['System', 'Service', 'Adj. Oz', 'Factory Charge', 'Manufacturer · Length', 'Date', 'Tech'].map(h => <th key={h}>{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, i) => (
                    <tr key={i}>
                      <td className="num">{row.systemNumber ?? '—'}</td>
                      <td>{row.serviceName ?? '—'}</td>
                      <td className="num">{row.adjustedOz != null ? `${row.adjustedOz} oz` : '—'}</td>
                      <td className="num">{row.factoryChargeUsed != null ? `${row.factoryChargeUsed} oz` : '—'}</td>
                      <td>{linesetLabel(row)}</td>
                      <td className="num" style={S.nowrap}>{fmtDate(row.completedAt)}</td>
                      <td>{techName(row.technicianId)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            </div>
          )
        })
      )}
      </div>
    </section>
  )
}

// ── Root screen ────────────────────────────────────────────────────────────────

// A16: the reading's manufacturer + factory length (W3); readings recorded
// before W3 show their legacy lineset config.
function linesetLabel (row) {
  const length = row.factoryLengthFt != null ? `${row.factoryLengthFt} ft` : null
  const label = [row.manufacturer, length].filter(Boolean).join(' ')
  return label || row.factoryLineConfig || '—'
}

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

  const techName = technicians.find(t => t.id === technicianId)?.name ?? 'All technicians'

  return (
    <div style={S.page}>
      <div className="vd-unit no-print">
        <div className="vd-unit-head"><span className="vd-unit-id">RPT</span><span className="vd-unit-name">Reports</span><span className="vd-unit-note">Equipment, accessories and refrigerant</span></div>
        <div className="vd-knurl" />
        <div className="vd-unit-body" style={S.controls}>
          <label style={S.field}><span className="vd-label">From</span>
            <input type="date" className="vd-input data" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
          </label>
          <label style={S.field}><span className="vd-label">To</span>
            <input type="date" className="vd-input data" value={dateTo} onChange={e => setDateTo(e.target.value)} />
          </label>
          <label style={S.fieldWide}><span className="vd-label">Technician</span>
            <select className="vd-input" value={technicianId} onChange={e => setTechnicianId(e.target.value)}>
              <option value="">All technicians</option>
              {technicians.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </label>
          <button type="button" className="vd-key dark" onClick={generate} disabled={loading}>
            {loading ? 'Loading…' : 'Generate'}
          </button>
          {hasData && (
            <button type="button" className="vd-key" onClick={() => window.print()}>
              Print / Export
            </button>
          )}
        </div>
      </div>

      {/* Printed document letterhead (hidden on screen). */}
      {hasData && (
        <div className="vd-print-only vd-letterhead">
          <div>
            <div className="vd-brand">FieldOps · Dispatch</div>
            <div className="vd-stencil">Usage report</div>
          </div>
          <div className="vd-data" style={S.stub}>
            <div>{fmtDay(dateFrom)} – {fmtDay(dateTo)}</div>
            <div>{techName}</div>
          </div>
        </div>
      )}

      {!hasData && !loading && (
        <p className="vd-hint no-print" style={S.flush}>Select a date range and click Generate.</p>
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
          technicians={technicians}
        />
      )}
    </div>
  )
}

// ── Styles ─────────────────────────────────────────────────────────────────────

// Layout only; the look comes from dispatch.css (vd-*).
const S = {
  page:       { flex: 1, overflowY: 'auto', padding: '16px 18px 18px', display: 'flex', flexDirection: 'column', gap: '18px' },
  controls:   { display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'flex-end' },
  field:      { display: 'flex', flexDirection: 'column', minWidth: '150px' },
  fieldWide:  { display: 'flex', flexDirection: 'column', minWidth: '200px', flex: '0 1 260px' },
  flush:      { margin: 0 },
  addrGroup:  { marginTop: '14px' },
  addrLabel:  { cursor: 'pointer', marginBottom: 0 },
  addrName:   { textTransform: 'none', letterSpacing: '0.4px', fontSize: '13px' },
  groupTable: { border: '2px solid var(--vd-ink)', borderTop: 'none', background: 'var(--vd-plate)' },
  checkCol:   { width: '34px' },
  right:      { textAlign: 'right' },
  nowrap:     { whiteSpace: 'nowrap' },
  scrollX:    { overflowX: 'auto' },
  summaryWrap:{ marginTop: '22px', borderTop: '3px solid var(--vd-ink)', paddingTop: '14px' },
  stub:       { textAlign: 'right', fontSize: '11px', lineHeight: 1.7 },
}
