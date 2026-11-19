/**
 * src/screens/CatalogEditor.jsx
 * F10 — Catalog editor for Dispatch: Equipment (with its factory charges per
 * manufacturer + length), Items, Services and Manufacturers (W3).
 * Inline edit covers every non-PK column. Create forms for equipment, items
 * and manufacturers.
 * Note: catalog changes do not affect historical visits.
 */

import { useState, useEffect } from 'react'
import { api } from '@shared/api.js'

const TABS = [
  { id: 'equipment', label: 'Equipment' },
  { id: 'items',     label: 'Items' },
  { id: 'services',  label: 'Services' },
  { id: 'makers',    label: 'Manufacturers' },
]

// ── Root component ─────────────────────────────────────────

export default function CatalogEditor () {
  const [tab, setTab] = useState('equipment')

  return (
    <div style={styles.page}>
      <div className="vd-unit-head" style={styles.header}>
        <span className="vd-unit-id">CAT</span>
        <h2 className="vd-unit-name" style={styles.title}>Catalog Editor</h2>
        <span className="vd-badge hatch" style={styles.notice}>Changes to the catalog do not affect historical visits.</span>
      </div>

      <div className="vd-rocker" style={styles.tabBar}>
        {TABS.map(t => (
          <button
            key={t.id}
            type="button"
            className={tab === t.id ? 'on' : ''}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div style={styles.body}>
        {tab === 'equipment' && <EquipmentTab />}
        {tab === 'items'     && <ItemsTab />}
        {tab === 'services'  && <ServicesTab />}
        {tab === 'makers'    && <ManufacturersTab />}
      </div>
    </div>
  )
}

// ── Equipment tab ──────────────────────────────────────────
// Covers all catalog_equipment columns plus the model's factory charges
// (catalog_equipment_charges: one row per manufacturer + length, W3).
// PK (model) is display-only. All other columns are editable inline.

const EMPTY_EQUIPMENT = {
  model: '', unit_type: '', brand: '', series: '', refrigerant: '',
  is_a2l: false, btu: '', pesp: '', oem_subcooling_goal: '', charges: [],
}

const EQUIP_EDITABLE_COLS = [
  { key: 'unit_type',          label: 'Type',         type: 'text'     },
  { key: 'brand',              label: 'Brand',        type: 'text'     },
  { key: 'series',             label: 'Series',       type: 'text'     },
  { key: 'refrigerant',        label: 'Refrigerant',  type: 'text'     },
  { key: 'is_a2l',             label: 'A2L',          type: 'boolean'  },
  { key: 'btu',                label: 'BTU',          type: 'number'   },
  { key: 'pesp',               label: 'PESP',         type: 'number'   },
  { key: 'oem_subcooling_goal',label: 'OEM subcool goal', type: 'number' },
]

function equipEditValsFromRow (row) {
  return {
    unit_type:           row.unit_type           ?? '',
    brand:               row.brand               ?? '',
    series:              row.series              ?? '',
    refrigerant:         row.refrigerant         ?? '',
    is_a2l:              row.is_a2l              ?? false,
    btu:                 row.btu                 ?? '',
    pesp:                row.pesp                ?? '',
    oem_subcooling_goal: row.oem_subcooling_goal ?? '',
  }
}

function equipBodyFromVals (vals) {
  return {
    unit_type:           vals.unit_type.trim()   || null,
    brand:               vals.brand.trim()       || null,
    series:              vals.series.trim()      || null,
    refrigerant:         vals.refrigerant.trim() || null,
    is_a2l:              vals.is_a2l,
    btu:                 vals.btu !== '' ? Number(vals.btu)                 : null,
    pesp:                vals.pesp               !== '' ? Number(vals.pesp)                : null,
    oem_subcooling_goal: vals.oem_subcooling_goal !== '' ? Number(vals.oem_subcooling_goal) : null,
  }
}

function EquipmentTab () {
  const [rows, setRows]         = useState([])
  const [loading, setLoading]   = useState(true)
  const [editId, setEditId]     = useState(null)
  const [editVals, setEditVals] = useState({})
  const [saving, setSaving]     = useState(false)
  const [showAdd, setShowAdd]   = useState(false)
  const [addForm, setAddForm]   = useState(EMPTY_EQUIPMENT)
  const [adding, setAdding]     = useState(false)
  const [error, setError]       = useState('')
  const [makers, setMakers]     = useState([])

  useEffect(() => { loadData() }, [])

  async function loadData () {
    setLoading(true)
    try {
      const [equipment, manufacturers] = await Promise.all([api.get('/catalog/equipment'), api.get('/catalog/manufacturers')])
      setRows(equipment ?? [])
      setMakers(manufacturers ?? [])
    } catch (err) {
      console.error('Equipment load failed:', err)
    } finally {
      setLoading(false)
    }
  }

  function startEdit (row) {
    setEditId(row.model)
    setEditVals({ ...equipEditValsFromRow(row), charges: chargeRowsFrom(row.charges) })
    setError('')
  }

  async function saveEdit (row) {
    const body = equipBodyFromVals(editVals)
    if (!body.unit_type) { setError('unit_type is required'); return }
    if (!body.brand)     { setError('brand is required'); return }
    const chargeError = chargesError(editVals.charges)
    if (chargeError) { setError(chargeError); return }
    setSaving(true)
    setError('')
    try {
      const updated = await api.patch(
        `/dispatch/catalog/catalog_equipment/${encodeURIComponent(row.model)}`, body
      )
      const { charges } = await api.put(
        `/dispatch/catalog/equipment/${encodeURIComponent(row.model)}/charges`, { charges: chargesBody(editVals.charges) }
      )
      setRows(prev => prev.map(r => r.model === row.model ? { ...updated, charges } : r))
      setEditId(null)
    } catch (err) {
      setError('Save failed.')
      console.error(err)
    } finally {
      setSaving(false)
    }
  }

  async function handleAdd () {
    if (!addForm.model.trim())     { setError('Model is required.'); return }
    if (!addForm.unit_type.trim()) { setError('Type is required.'); return }
    if (!addForm.brand.trim())     { setError('Brand is required.'); return }
    const chargeError = chargesError(addForm.charges)
    if (chargeError) { setError(chargeError); return }
    setAdding(true)
    setError('')
    try {
      const body = {
        model:               addForm.model.trim(),
        unit_type:           addForm.unit_type.trim(),
        brand:               addForm.brand.trim(),
        series:              addForm.series.trim() || null,
        refrigerant:         addForm.refrigerant.trim() || null,
        is_a2l:              addForm.is_a2l,
        btu:                 addForm.btu !== '' ? Number(addForm.btu) : null,
        charges:             chargesBody(addForm.charges),
        pesp:                addForm.pesp !== '' ? Number(addForm.pesp) : null,
        oem_subcooling_goal: addForm.oem_subcooling_goal !== '' ? Number(addForm.oem_subcooling_goal) : null,
      }
      const created = await api.post('/dispatch/catalog/equipment', body)
      setRows(prev => [...prev, created])
      setAddForm(EMPTY_EQUIPMENT)
      setShowAdd(false)
    } catch (err) {
      setError(err.status === 409 ? 'That model already exists.' : 'Add failed.')
      console.error(err)
    } finally {
      setAdding(false)
    }
  }

  if (loading) return <div className="vd-hint" style={styles.loading}>Loading…</div>

  return (
    <div style={styles.tabBody}>
      {error && <p className="vd-error">{error}</p>}

      <div style={{ overflowX: 'auto' }}>
        <table className="vd-table">
          <thead>
            <tr>
              {['Model', 'Type', 'Brand', 'Series', 'Refrigerant', 'A2L', 'BTU',
                'PESP', 'OEM subcool', 'Charges', ''].map(h => (
                <th key={h}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(row => {
              const isEditing = editId === row.model
              return (
                <tr key={row.model}>
                  <td style={styles.td}>{row.model}</td>
                  {EQUIP_EDITABLE_COLS.map(col => (
                    <td key={col.key} style={styles.td}>
                      {isEditing ? (
                        col.type === 'boolean'
                          ? <input type="checkbox" checked={editVals[col.key] ?? false}
                              onChange={e => setEditVals(v => ({ ...v, [col.key]: e.target.checked }))} />
                          : <input className="vd-input sm" style={styles.cellInput} type={col.type === 'number' ? 'number' : 'text'}
                              value={editVals[col.key] ?? ''}
                              onChange={e => setEditVals(v => ({ ...v, [col.key]: e.target.value }))} />
                      ) : (
                        col.type === 'boolean'
                          ? (row[col.key] === true ? 'Yes' : row[col.key] === false ? 'No' : '—')
                          : (row[col.key] ?? '—')
                      )}
                    </td>
                  ))}
                  <td style={styles.td}>
                    {isEditing
                      ? <ChargeRows rows={editVals.charges} makers={makers} brand={editVals.brand}
                          onChange={charges => setEditVals(v => ({ ...v, charges }))} />
                      : chargesSummary(row)}
                  </td>
                  <td style={styles.td}>
                    {isEditing ? (
                      <span style={styles.editActions}>
                        <button className="vd-key sm dark" onClick={() => saveEdit(row)} disabled={saving}>
                          {saving ? '…' : 'Save'}
                        </button>
                        <button className="vd-key sm" onClick={() => setEditId(null)}>Cancel</button>
                      </span>
                    ) : (
                      <button className="vd-key sm" onClick={() => startEdit(row)}>Edit</button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <button className="vd-key sm" style={styles.addToggleBtn} onClick={() => { setShowAdd(s => !s); setError('') }}>
        {showAdd ? 'Cancel' : '+ Add model'}
      </button>

      {showAdd && (
        <div style={styles.addForm}>
          <p className="vd-sub" style={styles.flush}>New equipment model</p>
          <div style={styles.addGrid}>
            {[
              { key: 'model',              label: 'Model *',              type: 'text'   },
              { key: 'unit_type',          label: 'Type * (condenser…)',  type: 'text'   },
              { key: 'brand',              label: 'Brand *',              type: 'text'   },
              { key: 'series',             label: 'Series',               type: 'text'   },
              { key: 'refrigerant',        label: 'Refrigerant',          type: 'text'   },
              { key: 'btu',               label: 'BTU',                  type: 'number' },
              { key: 'pesp',               label: 'PESP',                 type: 'number' },
              { key: 'oem_subcooling_goal',label: 'OEM subcool goal',     type: 'number' },
            ].map(({ key, label, type }) => (
              <div key={key} style={styles.addField}>
                <label className="vd-label" style={styles.flush}>{label}</label>
                <input
                  className="vd-input sm"
                  type={type}
                  value={addForm[key]}
                  onChange={e => setAddForm(f => ({ ...f, [key]: e.target.value }))}
                />
              </div>
            ))}
            <div style={{ ...styles.addField, flexDirection: 'row', alignItems: 'center', gap: '8px' }}>
              <input type="checkbox" checked={addForm.is_a2l}
                onChange={e => setAddForm(f => ({ ...f, is_a2l: e.target.checked }))} />
              <label className="vd-label" style={styles.flush}>A2L refrigerant</label>
            </div>
          </div>
          <div style={styles.addField}>
            <label className="vd-label" style={styles.flush}>Factory charges (manufacturer · length · oz)</label>
            <ChargeRows rows={addForm.charges} makers={makers} brand={addForm.brand}
              onChange={charges => setAddForm(f => ({ ...f, charges }))} />
          </div>
          <button className="vd-key dark" style={styles.addSubmitBtn} onClick={handleAdd} disabled={adding}>
            {adding ? 'Adding…' : 'Add model'}
          </button>
        </div>
      )}
    </div>
  )
}

// ── Factory charges per manufacturer + length (W3) ─────────

function chargeRowsFrom (charges) {
  return (charges ?? []).map(c => ({ manufacturer: c.manufacturer, length_ft: String(c.length_ft), charge_oz: String(c.charge_oz) }))
}

function chargesBody (rows) {
  return rows.map(r => ({ manufacturer: r.manufacturer, length_ft: Number(r.length_ft), charge_oz: Number(r.charge_oz) }))
}

function chargesError (rows) {
  const seen = new Set()
  for (const r of rows) {
    if (!r.manufacturer) return 'Each charge needs a manufacturer.'
    if (!(Number(r.length_ft) > 0)) return 'Each charge needs a length in ft.'
    if (r.charge_oz === '' || !(Number(r.charge_oz) >= 0)) return 'Each charge needs a charge in oz.'
    const key = r.manufacturer + '|' + Number(r.length_ft)
    if (seen.has(key)) return 'Duplicate charge for ' + r.manufacturer + ' ' + Number(r.length_ft) + ' ft.'
    seen.add(key)
  }
  return ''
}

// "15 ft 78 · 30 ft 92 oz"; another manufacturer than the brand is named.
function chargesSummary (row) {
  const charges = row.charges ?? []
  if (!charges.length) return '—'
  return charges.map(c => (c.manufacturer === row.brand ? '' : c.manufacturer + ' ') + c.length_ft + ' ft ' + c.charge_oz).join(' · ') + ' oz'
}

// Add, edit or remove a length row. A new row starts with the model's brand
// when it is a manufacturer.
function ChargeRows ({ rows, makers, brand, onChange }) {
  const set = (i, key, value) => onChange(rows.map((r, j) => j === i ? { ...r, [key]: value } : r))
  const add = () => {
    const maker = makers.find(m => m.name.toLowerCase() === (brand ?? '').trim().toLowerCase())
    onChange([...rows, { manufacturer: maker?.name ?? '', length_ft: maker ? String(maker.default_length_ft) : '', charge_oz: '' }])
  }
  return (
    <div style={styles.chargeList}>
      {rows.map((r, i) => (
        <div key={i} style={styles.chargeRow}>
          <select className="vd-input sm" style={styles.chargeMaker} value={r.manufacturer} aria-label="Manufacturer"
            onChange={e => set(i, 'manufacturer', e.target.value)}>
            <option value="">Manufacturer…</option>
            {makers.map(m => <option key={m.name} value={m.name}>{m.name}</option>)}
          </select>
          <input className="vd-input sm" style={styles.chargeNum} type="number" min="1" placeholder="ft" aria-label="Length ft"
            value={r.length_ft} onChange={e => set(i, 'length_ft', e.target.value)} />
          <input className="vd-input sm" style={styles.chargeNum} type="number" min="0" placeholder="oz" aria-label="Charge oz"
            value={r.charge_oz} onChange={e => set(i, 'charge_oz', e.target.value)} />
          <button type="button" className="vd-key sm" aria-label="Remove length row"
            onClick={() => onChange(rows.filter((_, j) => j !== i))}>✕</button>
        </div>
      ))}
      <button type="button" className="vd-key sm" style={styles.addToggleBtn} onClick={add}>+ Length</button>
    </div>
  )
}

// ── Items tab ──────────────────────────────────────────────
// Covers all catalog_items columns.
// PK (item_name) is display-only. All other columns editable inline.

const EMPTY_ITEM = {
  item_name: '', category: '', default_price: '',
  multiplies_by_system_count: false, tech_supplied: false,
  custom_price: false, expected_price_min: '', expected_price_max: '',
  finish_addon_price: '',
}

const ITEM_BOOL_COLS = [
  { key: 'tech_supplied',              label: 'Tech supplied' },
  { key: 'multiplies_by_system_count', label: 'Multiplies' },
  { key: 'custom_price',               label: 'Custom price' },
]

function itemEditValsFromRow (row) {
  return {
    category:                   row.category                   ?? '',
    default_price:              row.default_price              ?? '',
    tech_supplied:              row.tech_supplied              ?? false,
    multiplies_by_system_count: row.multiplies_by_system_count ?? false,
    custom_price:               row.custom_price               ?? false,
    expected_price_min:         row.expected_price_min         ?? '',
    expected_price_max:         row.expected_price_max         ?? '',
    finish_addon_price:         row.finish_addon_price         ?? '',
  }
}

// Thermostats have no price of their own (CATALOG.md): an empty price is $0,
// never null (S1200). Other items keep an empty price as null.
function itemPrice (value, category) {
  if (value !== '') return Number(value)
  return category === 'thermostat' ? 0 : null
}

function itemBodyFromVals (vals) {
  return {
    category:                   vals.category,
    default_price:              itemPrice(vals.default_price, vals.category),
    tech_supplied:              vals.tech_supplied,
    multiplies_by_system_count: vals.multiplies_by_system_count,
    custom_price:               vals.custom_price,
    expected_price_min:         vals.expected_price_min !== '' ? Number(vals.expected_price_min) : null,
    expected_price_max:         vals.expected_price_max !== '' ? Number(vals.expected_price_max) : null,
    finish_addon_price:         vals.finish_addon_price !== '' ? Number(vals.finish_addon_price) : null,
  }
}

function ItemsTab () {
  const [rows, setRows]         = useState([])
  const [loading, setLoading]   = useState(true)
  const [editId, setEditId]     = useState(null)
  const [editVals, setEditVals] = useState({})
  const [saving, setSaving]     = useState(false)
  const [showAdd, setShowAdd]   = useState(false)
  const [addForm, setAddForm]   = useState(EMPTY_ITEM)
  const [adding, setAdding]     = useState(false)
  const [error, setError]       = useState('')

  useEffect(() => { loadData() }, [])

  async function loadData () {
    setLoading(true)
    try {
      setRows((await api.get('/catalog/items')) ?? [])
    } catch (err) {
      console.error('Items load failed:', err)
    } finally {
      setLoading(false)
    }
  }

  function startEdit (row) {
    setEditId(row.item_name)
    setEditVals(itemEditValsFromRow(row))
    setError('')
  }

  async function saveEdit (row) {
    const body = itemBodyFromVals(editVals)
    setSaving(true)
    setError('')
    try {
      const updated = await api.patch(
        `/dispatch/catalog/catalog_items/${encodeURIComponent(row.item_name)}`, body
      )
      setRows(prev => prev.map(r => r.item_name === row.item_name ? updated : r))
      setEditId(null)
    } catch (err) {
      setError('Save failed.')
      console.error(err)
    } finally {
      setSaving(false)
    }
  }

  async function handleAdd () {
    if (!addForm.item_name.trim()) { setError('Item name is required.'); return }
    if (!addForm.category.trim())  { setError('Category is required.'); return }
    setAdding(true)
    setError('')
    try {
      const body = {
        item_name:                  addForm.item_name.trim(),
        category:                   addForm.category.trim(),
        tech_supplied:              addForm.tech_supplied,
        default_price:              itemPrice(addForm.default_price, addForm.category.trim()),
        multiplies_by_system_count: addForm.multiplies_by_system_count,
        custom_price:               addForm.custom_price,
        expected_price_min:         addForm.expected_price_min !== '' ? Number(addForm.expected_price_min) : null,
        expected_price_max:         addForm.expected_price_max !== '' ? Number(addForm.expected_price_max) : null,
        finish_addon_price:         addForm.finish_addon_price !== '' ? Number(addForm.finish_addon_price) : null,
      }
      const created = await api.post('/dispatch/catalog/items', body)
      setRows(prev => [...prev, created])
      setAddForm(EMPTY_ITEM)
      setShowAdd(false)
    } catch (err) {
      setError(err.status === 409 ? 'That item name already exists.' : 'Add failed.')
      console.error(err)
    } finally {
      setAdding(false)
    }
  }

  if (loading) return <div className="vd-hint" style={styles.loading}>Loading…</div>

  return (
    <div style={styles.tabBody}>
      {error && <p className="vd-error">{error}</p>}

      <div style={{ overflowX: 'auto' }}>
        <table className="vd-table">
          <thead>
            <tr>
              {['Item name', 'Category', 'Price', 'Tech supplied', 'Multiplies',
                'Custom price', 'Min price', 'Max price', 'Finish addon', ''].map(h => (
                <th key={h}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(row => {
              const isEditing = editId === row.item_name
              return (
                <tr key={row.item_name}>
                  <td style={styles.td}>{row.item_name}</td>

                  {/* category */}
                  <td style={styles.td}>
                    {isEditing
                      ? <select className="vd-input sm" style={{ ...styles.cellInput, width: '110px' }}
                          value={editVals.category}
                          onChange={e => setEditVals(v => ({ ...v, category: e.target.value }))}>
                          <option value="accessory">accessory</option>
                          <option value="fix">fix</option>
                          <option value="thermostat">thermostat</option>
                        </select>
                      : row.category}
                  </td>

                  {/* default_price */}
                  <td style={styles.td}>
                    {isEditing
                      ? <input className="vd-input sm" style={styles.cellInput} type="number" min="0" step="0.01"
                          value={editVals.default_price}
                          onChange={e => setEditVals(v => ({ ...v, default_price: e.target.value }))} />
                      : `$${Number(row.default_price ?? 0).toFixed(2)}`}
                  </td>

                  {/* boolean cols */}
                  {ITEM_BOOL_COLS.map(col => (
                    <td key={col.key} style={styles.td}>
                      {isEditing
                        ? <input type="checkbox" checked={editVals[col.key] ?? false}
                            onChange={e => setEditVals(v => ({ ...v, [col.key]: e.target.checked }))} />
                        : (row[col.key] ? 'Yes' : 'No')}
                    </td>
                  ))}

                  {/* price range + finish addon */}
                  {['expected_price_min', 'expected_price_max', 'finish_addon_price'].map(col => (
                    <td key={col} style={styles.td}>
                      {isEditing
                        ? <input className="vd-input sm" style={styles.cellInput} type="number" min="0" step="0.01"
                            value={editVals[col] ?? ''}
                            onChange={e => setEditVals(v => ({ ...v, [col]: e.target.value }))} />
                        : (row[col] != null ? `$${Number(row[col]).toFixed(2)}` : '—')}
                    </td>
                  ))}

                  <td style={styles.td}>
                    {isEditing ? (
                      <span style={styles.editActions}>
                        <button className="vd-key sm dark" onClick={() => saveEdit(row)} disabled={saving}>
                          {saving ? '…' : 'Save'}
                        </button>
                        <button className="vd-key sm" onClick={() => setEditId(null)}>Cancel</button>
                      </span>
                    ) : (
                      <button className="vd-key sm" onClick={() => startEdit(row)}>Edit</button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <button className="vd-key sm" style={styles.addToggleBtn} onClick={() => { setShowAdd(s => !s); setError('') }}>
        {showAdd ? 'Cancel' : '+ Add item'}
      </button>

      {showAdd && (
        <div style={styles.addForm}>
          <p className="vd-sub" style={styles.flush}>New catalog item</p>
          <div style={styles.addGrid}>
            <div style={styles.addField}>
              <label className="vd-label" style={styles.flush}>Item name *</label>
              <input className="vd-input sm" type="text" value={addForm.item_name}
                onChange={e => setAddForm(f => ({ ...f, item_name: e.target.value }))} />
            </div>
            <div style={styles.addField}>
              <label className="vd-label" style={styles.flush}>Category *</label>
              <select className="vd-input sm" value={addForm.category}
                onChange={e => setAddForm(f => ({ ...f, category: e.target.value }))}>
                <option value="">— select —</option>
                <option value="accessory">accessory</option>
                <option value="fix">fix</option>
                <option value="thermostat">thermostat</option>
              </select>
            </div>
            {[
              { key: 'default_price',    label: 'Default price' },
              { key: 'expected_price_min', label: 'Min price (anomaly)' },
              { key: 'expected_price_max', label: 'Max price (anomaly)' },
              { key: 'finish_addon_price', label: 'Finish addon price' },
            ].map(({ key, label }) => (
              <div key={key} style={styles.addField}>
                <label className="vd-label" style={styles.flush}>{label}</label>
                <input className="vd-input sm" type="number" min="0" step="0.01"
                  value={addForm[key]}
                  onChange={e => setAddForm(f => ({ ...f, [key]: e.target.value }))} />
              </div>
            ))}
            {[
              { key: 'tech_supplied',              label: 'Tech supplied' },
              { key: 'multiplies_by_system_count', label: 'Multiplies by system count' },
              { key: 'custom_price',               label: 'Custom price (free-form)' },
            ].map(({ key, label }) => (
              <div key={key} style={{ ...styles.addField, flexDirection: 'row', alignItems: 'center', gap: '8px' }}>
                <input type="checkbox" checked={addForm[key]}
                  onChange={e => setAddForm(f => ({ ...f, [key]: e.target.checked }))} />
                <label className="vd-label" style={styles.flush}>{label}</label>
              </div>
            ))}
          </div>
          <button className="vd-key dark" style={styles.addSubmitBtn} onClick={handleAdd} disabled={adding}>
            {adding ? 'Adding…' : 'Add item'}
          </button>
        </div>
      )}
    </div>
  )
}

// ── Services tab ───────────────────────────────────────────
// catalog_services: default_price + multiplies_by_system_count editable.
// is_bundle is structural — display only. No create form (service list is fixed).

function ServicesTab () {
  const [rows, setRows]         = useState([])
  const [loading, setLoading]   = useState(true)
  const [editId, setEditId]     = useState(null)
  const [editVals, setEditVals] = useState({})
  const [saving, setSaving]     = useState(false)
  const [error, setError]       = useState('')

  useEffect(() => { loadData() }, [])

  async function loadData () {
    setLoading(true)
    try {
      setRows((await api.get('/catalog/services')) ?? [])
    } catch (err) {
      console.error('Services load failed:', err)
    } finally {
      setLoading(false)
    }
  }

  function startEdit (row) {
    setEditId(row.service_name)
    setEditVals({ default_price: row.default_price ?? '', multiplies_by_system_count: row.multiplies_by_system_count ?? false })
    setError('')
  }

  async function saveEdit (row) {
    setSaving(true)
    setError('')
    try {
      const body = {
        default_price:              editVals.default_price !== '' ? Number(editVals.default_price) : 0,
        multiplies_by_system_count: editVals.multiplies_by_system_count,
      }
      const updated = await api.patch(
        `/dispatch/catalog/catalog_services/${encodeURIComponent(row.service_name)}`, body
      )
      setRows(prev => prev.map(r => r.service_name === row.service_name ? updated : r))
      setEditId(null)
    } catch (err) {
      setError('Save failed.')
      console.error(err)
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="vd-hint" style={styles.loading}>Loading…</div>

  return (
    <div style={styles.tabBody}>
      {error && <p className="vd-error">{error}</p>}
      <p className="vd-hint" style={styles.flush}>Service list is fixed — new services cannot be added here.</p>

      <table className="vd-table">
        <thead>
          <tr>
            {['Service name', 'Default price', 'Bundle', 'Multiplies by system', ''].map(h => (
              <th key={h}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(row => {
            const isEditing = editId === row.service_name
            return (
              <tr key={row.service_name}>
                <td style={styles.td}>{row.service_name}</td>
                <td style={styles.td}>
                  {isEditing
                    ? <input className="vd-input sm" style={styles.cellInput} type="number" min="0" step="0.01"
                        value={editVals.default_price}
                        onChange={e => setEditVals(v => ({ ...v, default_price: e.target.value }))} />
                    : `$${Number(row.default_price ?? 0).toFixed(2)}`}
                </td>
                <td style={styles.td}>{row.is_bundle ? 'Yes' : 'No'}</td>
                <td style={styles.td}>
                  {isEditing
                    ? <input type="checkbox" checked={editVals.multiplies_by_system_count}
                        onChange={e => setEditVals(v => ({ ...v, multiplies_by_system_count: e.target.checked }))} />
                    : (row.multiplies_by_system_count ? 'Yes' : 'No')}
                </td>
                <td style={styles.td}>
                  {isEditing ? (
                    <span style={styles.editActions}>
                      <button className="vd-key sm dark" onClick={() => saveEdit(row)} disabled={saving}>
                        {saving ? '…' : 'Save'}
                      </button>
                      <button className="vd-key sm" onClick={() => setEditId(null)}>Cancel</button>
                    </span>
                  ) : (
                    <button className="vd-key sm" onClick={() => startEdit(row)}>Edit</button>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ── Manufacturers tab ──────────────────────────────────────
// catalog_manufacturers (W3): name, oz/ft and default factory length, used by
// Weigh-In and Quick Charge Calc. Inline edit and an add form.

const EMPTY_MAKER = { name: '', oz_per_ft: '', default_length_ft: '' }

function makerError (vals) {
  if (!vals.name.trim()) return 'Name is required.'
  if (!(Number(vals.oz_per_ft) > 0)) return 'oz/ft must be above 0.'
  if (!(Number(vals.default_length_ft) > 0)) return 'Default length must be above 0.'
  return ''
}

const makerBody = vals => ({ name: vals.name.trim(), oz_per_ft: Number(vals.oz_per_ft), default_length_ft: Number(vals.default_length_ft) })

function ManufacturersTab () {
  const [rows, setRows]         = useState([])
  const [loading, setLoading]   = useState(true)
  const [editId, setEditId]     = useState(null)
  const [editVals, setEditVals] = useState(EMPTY_MAKER)
  const [saving, setSaving]     = useState(false)
  const [addForm, setAddForm]   = useState(EMPTY_MAKER)
  const [error, setError]       = useState('')

  useEffect(() => { loadData() }, [])

  async function loadData () {
    setLoading(true)
    try {
      setRows((await api.get('/catalog/manufacturers')) ?? [])
    } catch (err) {
      console.error('Manufacturers load failed:', err)
    } finally {
      setLoading(false)
    }
  }

  function startEdit (row) {
    setEditId(row.name)
    setEditVals({ name: row.name, oz_per_ft: String(row.oz_per_ft), default_length_ft: String(row.default_length_ft) })
    setError('')
  }

  async function saveEdit (row) {
    const problem = makerError(editVals)
    if (problem) { setError(problem); return }
    setSaving(true)
    setError('')
    try {
      const updated = await api.patch(`/dispatch/catalog/catalog_manufacturers/${encodeURIComponent(row.name)}`, makerBody(editVals))
      setRows(prev => prev.map(r => r.name === row.name ? updated : r))
      setEditId(null)
    } catch (err) {
      setError(err.status === 409 ? 'That name already exists.' : 'Save failed.')
      console.error(err)
    } finally {
      setSaving(false)
    }
  }

  async function handleAdd () {
    const problem = makerError(addForm)
    if (problem) { setError(problem); return }
    setSaving(true)
    setError('')
    try {
      const created = await api.post('/dispatch/catalog/manufacturers', makerBody(addForm))
      setRows(prev => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)))
      setAddForm(EMPTY_MAKER)
    } catch (err) {
      setError(err.status === 409 ? 'That manufacturer already exists.' : 'Add failed.')
      console.error(err)
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="vd-hint" style={styles.loading}>Loading…</div>

  const field = (vals, setVals, key, type, label) => (
    <input className="vd-input sm" style={key === 'name' ? undefined : styles.cellInput} type={type} step="any" aria-label={label}
      value={vals[key]} onChange={e => setVals(v => ({ ...v, [key]: e.target.value }))} />
  )

  return (
    <div style={styles.tabBody}>
      {error && <p className="vd-error">{error}</p>}
      <p className="vd-hint" style={styles.flush}>Weigh-In and Calc use oz/ft and the default factory length of the selected manufacturer.</p>

      <table className="vd-table">
        <thead>
          <tr>
            {['Manufacturer', 'oz / ft', 'Default length (ft)', ''].map(h => <th key={h}>{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map(row => {
            const isEditing = editId === row.name
            return (
              <tr key={row.name}>
                <td style={styles.td}>{isEditing ? field(editVals, setEditVals, 'name', 'text', 'Manufacturer') : row.name}</td>
                <td style={styles.td}>{isEditing ? field(editVals, setEditVals, 'oz_per_ft', 'number', 'oz per ft') : row.oz_per_ft}</td>
                <td style={styles.td}>{isEditing ? field(editVals, setEditVals, 'default_length_ft', 'number', 'Default length ft') : row.default_length_ft}</td>
                <td style={styles.td}>
                  {isEditing ? (
                    <span style={styles.editActions}>
                      <button className="vd-key sm dark" onClick={() => saveEdit(row)} disabled={saving}>
                        {saving ? '…' : 'Save'}
                      </button>
                      <button className="vd-key sm" onClick={() => setEditId(null)}>Cancel</button>
                    </span>
                  ) : (
                    <button className="vd-key sm" onClick={() => startEdit(row)}>Edit</button>
                  )}
                </td>
              </tr>
            )
          })}
          <tr>
            <td style={styles.td}>{field(addForm, setAddForm, 'name', 'text', 'New manufacturer')}</td>
            <td style={styles.td}>{field(addForm, setAddForm, 'oz_per_ft', 'number', 'New oz per ft')}</td>
            <td style={styles.td}>{field(addForm, setAddForm, 'default_length_ft', 'number', 'New default length ft')}</td>
            <td style={styles.td}>
              <button className="vd-key sm dark" onClick={handleAdd} disabled={saving}>+ Add</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}

// ── Shared styles ──────────────────────────────────────────

// Layout only; the look comes from dispatch.css (vd-*).
const styles = {
  page:         { flex: 1, overflowY: 'auto', padding: '16px 18px 18px', display: 'flex', flexDirection: 'column', gap: '14px' },
  header:       { border: '2px solid var(--vd-ink)', flexWrap: 'wrap' },
  title:        { margin: 0 },
  notice:       { marginLeft: 'auto' },
  tabBar:       { alignSelf: 'flex-start', flexWrap: 'wrap' },
  body:         { border: '2px solid var(--vd-ink)', background: 'var(--vd-plate)' },
  tabBody:      { padding: '18px', display: 'flex', flexDirection: 'column', gap: '16px' },
  loading:      { padding: '18px', margin: 0 },
  flush:        { margin: 0 },
  td:           { whiteSpace: 'nowrap' },
  cellInput:    { width: '90px' },
  editActions:  { display: 'flex', gap: '6px' },
  addToggleBtn: { alignSelf: 'flex-start' },
  addForm:      { border: '2px solid var(--vd-ink)', background: 'var(--vd-panel)', padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' },
  addGrid:      { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '12px' },
  addField:     { display: 'flex', flexDirection: 'column', gap: '3px' },
  addSubmitBtn: { alignSelf: 'flex-start' },
  chargeList:   { display: 'flex', flexDirection: 'column', gap: '6px', alignItems: 'flex-start' },
  chargeRow:    { display: 'flex', gap: '6px', alignItems: 'center' },
  chargeNum:    { width: '72px' },
  chargeMaker:  { width: '130px', flex: 'none' },
}
