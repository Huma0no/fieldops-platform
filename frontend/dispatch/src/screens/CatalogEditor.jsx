/**
 * src/screens/CatalogEditor.jsx
 * F10 — Catalog editor for Dispatch. Full schema coverage for all four editable tables.
 * Inline edit covers every non-PK column. Create forms for equipment and items.
 * Note: catalog changes do not affect historical visits.
 */

import { useState, useEffect } from 'react'
import { api } from '@shared/api.js'

const TABS = [
  { id: 'equipment', label: 'Equipment' },
  { id: 'items',     label: 'Items' },
  { id: 'services',  label: 'Services' },
  { id: 'lineset',   label: 'Lineset Configs' },
]

// ── Root component ─────────────────────────────────────────

export default function CatalogEditor () {
  const [tab, setTab] = useState('equipment')

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h2 style={styles.title}>Catalog Editor</h2>
        <p style={styles.notice}>Changes to the catalog do not affect historical visits.</p>
      </div>

      <div style={styles.tabBar}>
        {TABS.map(t => (
          <button
            key={t.id}
            style={{ ...styles.tabBtn, ...(tab === t.id ? styles.tabBtnActive : {}) }}
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
        {tab === 'lineset'   && <LinesetConfigsTab />}
      </div>
    </div>
  )
}

// ── Equipment tab ──────────────────────────────────────────
// Covers all catalog_equipment columns.
// PK (model) is display-only. All other columns are editable inline.

const EMPTY_EQUIPMENT = {
  model: '', unit_type: '', brand: '', series: '', refrigerant: '',
  is_a2l: false, btu: '', factory_charge_oz: '', revised_charge_oz: '',
  pesp: '', oem_subcooling_goal: '',
}

const EQUIP_EDITABLE_COLS = [
  { key: 'unit_type',          label: 'Type',         type: 'text'     },
  { key: 'brand',              label: 'Brand',        type: 'text'     },
  { key: 'series',             label: 'Series',       type: 'text'     },
  { key: 'refrigerant',        label: 'Refrigerant',  type: 'text'     },
  { key: 'is_a2l',             label: 'A2L',          type: 'boolean'  },
  { key: 'btu',                label: 'BTU',          type: 'number'   },
  { key: 'factory_charge_oz',  label: 'Factory oz',   type: 'number'   },
  { key: 'revised_charge_oz',  label: 'Revised oz',   type: 'number'   },
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
    factory_charge_oz:   row.factory_charge_oz   ?? '',
    revised_charge_oz:   row.revised_charge_oz   ?? '',
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
    factory_charge_oz:   vals.factory_charge_oz  !== '' ? Number(vals.factory_charge_oz)  : null,
    revised_charge_oz:   vals.revised_charge_oz  !== '' ? Number(vals.revised_charge_oz)  : null,
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

  useEffect(() => { loadData() }, [])

  async function loadData () {
    setLoading(true)
    try {
      setRows((await api.get('/catalog/equipment')) ?? [])
    } catch (err) {
      console.error('Equipment load failed:', err)
    } finally {
      setLoading(false)
    }
  }

  function startEdit (row) {
    setEditId(row.model)
    setEditVals(equipEditValsFromRow(row))
    setError('')
  }

  async function saveEdit (row) {
    const body = equipBodyFromVals(editVals)
    if (!body.unit_type) { setError('unit_type is required'); return }
    if (!body.brand)     { setError('brand is required'); return }
    setSaving(true)
    setError('')
    try {
      const updated = await api.patch(
        `/dispatch/catalog/catalog_equipment/${encodeURIComponent(row.model)}`, body
      )
      setRows(prev => prev.map(r => r.model === row.model ? updated : r))
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
        factory_charge_oz:   addForm.factory_charge_oz  !== '' ? Number(addForm.factory_charge_oz)  : null,
        revised_charge_oz:   addForm.revised_charge_oz  !== '' ? Number(addForm.revised_charge_oz)  : null,
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

  if (loading) return <div style={styles.loading}>Loading…</div>

  return (
    <div style={styles.tabBody}>
      {error && <p style={styles.errorText}>{error}</p>}

      <div style={{ overflowX: 'auto' }}>
        <table style={styles.table}>
          <thead>
            <tr>
              {['Model', 'Type', 'Brand', 'Series', 'Refrigerant', 'A2L', 'BTU',
                'Factory oz', 'Revised oz', 'PESP', 'OEM subcool', ''].map(h => (
                <th key={h} style={styles.th}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(row => {
              const isEditing = editId === row.model
              return (
                <tr key={row.model} style={styles.tr}>
                  <td style={styles.td}>{row.model}</td>
                  {EQUIP_EDITABLE_COLS.map(col => (
                    <td key={col.key} style={styles.td}>
                      {isEditing ? (
                        col.type === 'boolean'
                          ? <input type="checkbox" checked={editVals[col.key] ?? false}
                              onChange={e => setEditVals(v => ({ ...v, [col.key]: e.target.checked }))} />
                          : <input style={styles.cellInput} type={col.type === 'number' ? 'number' : 'text'}
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
                    {isEditing ? (
                      <span style={styles.editActions}>
                        <button style={styles.saveBtn} onClick={() => saveEdit(row)} disabled={saving}>
                          {saving ? '…' : 'Save'}
                        </button>
                        <button style={styles.cancelBtn} onClick={() => setEditId(null)}>Cancel</button>
                      </span>
                    ) : (
                      <button style={styles.editBtn} onClick={() => startEdit(row)}>Edit</button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <button style={styles.addToggleBtn} onClick={() => { setShowAdd(s => !s); setError('') }}>
        {showAdd ? 'Cancel' : '+ Add model'}
      </button>

      {showAdd && (
        <div style={styles.addForm}>
          <p style={styles.addFormTitle}>New equipment model</p>
          <div style={styles.addGrid}>
            {[
              { key: 'model',              label: 'Model *',              type: 'text'   },
              { key: 'unit_type',          label: 'Type * (condenser…)',  type: 'text'   },
              { key: 'brand',              label: 'Brand *',              type: 'text'   },
              { key: 'series',             label: 'Series',               type: 'text'   },
              { key: 'refrigerant',        label: 'Refrigerant',          type: 'text'   },
              { key: 'btu',               label: 'BTU',                  type: 'number' },
              { key: 'factory_charge_oz',  label: 'Factory charge (oz)',  type: 'number' },
              { key: 'revised_charge_oz',  label: 'Revised charge (oz)',  type: 'number' },
              { key: 'pesp',               label: 'PESP',                 type: 'number' },
              { key: 'oem_subcooling_goal',label: 'OEM subcool goal',     type: 'number' },
            ].map(({ key, label, type }) => (
              <div key={key} style={styles.addField}>
                <label style={styles.addLabel}>{label}</label>
                <input
                  style={styles.addInput}
                  type={type}
                  value={addForm[key]}
                  onChange={e => setAddForm(f => ({ ...f, [key]: e.target.value }))}
                />
              </div>
            ))}
            <div style={{ ...styles.addField, flexDirection: 'row', alignItems: 'center', gap: '8px' }}>
              <input type="checkbox" checked={addForm.is_a2l}
                onChange={e => setAddForm(f => ({ ...f, is_a2l: e.target.checked }))} />
              <label style={styles.addLabel}>A2L refrigerant</label>
            </div>
          </div>
          <button style={styles.addSubmitBtn} onClick={handleAdd} disabled={adding}>
            {adding ? 'Adding…' : 'Add model'}
          </button>
        </div>
      )}
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

function itemBodyFromVals (vals) {
  return {
    category:                   vals.category,
    default_price:              vals.default_price     !== '' ? Number(vals.default_price)     : null,
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
        default_price:              addForm.default_price     !== '' ? Number(addForm.default_price)     : null,
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

  if (loading) return <div style={styles.loading}>Loading…</div>

  return (
    <div style={styles.tabBody}>
      {error && <p style={styles.errorText}>{error}</p>}

      <div style={{ overflowX: 'auto' }}>
        <table style={styles.table}>
          <thead>
            <tr>
              {['Item name', 'Category', 'Price', 'Tech supplied', 'Multiplies',
                'Custom price', 'Min price', 'Max price', 'Finish addon', ''].map(h => (
                <th key={h} style={styles.th}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(row => {
              const isEditing = editId === row.item_name
              return (
                <tr key={row.item_name} style={styles.tr}>
                  <td style={styles.td}>{row.item_name}</td>

                  {/* category */}
                  <td style={styles.td}>
                    {isEditing
                      ? <select style={{ ...styles.cellInput, width: '110px' }}
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
                      ? <input style={styles.cellInput} type="number" min="0" step="0.01"
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
                        ? <input style={styles.cellInput} type="number" min="0" step="0.01"
                            value={editVals[col] ?? ''}
                            onChange={e => setEditVals(v => ({ ...v, [col]: e.target.value }))} />
                        : (row[col] != null ? `$${Number(row[col]).toFixed(2)}` : '—')}
                    </td>
                  ))}

                  <td style={styles.td}>
                    {isEditing ? (
                      <span style={styles.editActions}>
                        <button style={styles.saveBtn} onClick={() => saveEdit(row)} disabled={saving}>
                          {saving ? '…' : 'Save'}
                        </button>
                        <button style={styles.cancelBtn} onClick={() => setEditId(null)}>Cancel</button>
                      </span>
                    ) : (
                      <button style={styles.editBtn} onClick={() => startEdit(row)}>Edit</button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <button style={styles.addToggleBtn} onClick={() => { setShowAdd(s => !s); setError('') }}>
        {showAdd ? 'Cancel' : '+ Add item'}
      </button>

      {showAdd && (
        <div style={styles.addForm}>
          <p style={styles.addFormTitle}>New catalog item</p>
          <div style={styles.addGrid}>
            <div style={styles.addField}>
              <label style={styles.addLabel}>Item name *</label>
              <input style={styles.addInput} type="text" value={addForm.item_name}
                onChange={e => setAddForm(f => ({ ...f, item_name: e.target.value }))} />
            </div>
            <div style={styles.addField}>
              <label style={styles.addLabel}>Category *</label>
              <select style={styles.addInput} value={addForm.category}
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
                <label style={styles.addLabel}>{label}</label>
                <input style={styles.addInput} type="number" min="0" step="0.01"
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
                <label style={styles.addLabel}>{label}</label>
              </div>
            ))}
          </div>
          <button style={styles.addSubmitBtn} onClick={handleAdd} disabled={adding}>
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

  if (loading) return <div style={styles.loading}>Loading…</div>

  return (
    <div style={styles.tabBody}>
      {error && <p style={styles.errorText}>{error}</p>}
      <p style={styles.fixedNote}>Service list is fixed — new services cannot be added here.</p>

      <table style={styles.table}>
        <thead>
          <tr>
            {['Service name', 'Default price', 'Bundle', 'Multiplies by system', ''].map(h => (
              <th key={h} style={styles.th}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(row => {
            const isEditing = editId === row.service_name
            return (
              <tr key={row.service_name} style={styles.tr}>
                <td style={styles.td}>{row.service_name}</td>
                <td style={styles.td}>
                  {isEditing
                    ? <input style={styles.cellInput} type="number" min="0" step="0.01"
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
                      <button style={styles.saveBtn} onClick={() => saveEdit(row)} disabled={saving}>
                        {saving ? '…' : 'Save'}
                      </button>
                      <button style={styles.cancelBtn} onClick={() => setEditId(null)}>Cancel</button>
                    </span>
                  ) : (
                    <button style={styles.editBtn} onClick={() => startEdit(row)}>Edit</button>
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

// ── Lineset Configs tab ────────────────────────────────────
// catalog_lineset_configs: both numeric columns editable inline.
// No create form (config list is fixed).

function LinesetConfigsTab () {
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
      setRows((await api.get('/catalog/lineset-configs')) ?? [])
    } catch (err) {
      console.error('Lineset configs load failed:', err)
    } finally {
      setLoading(false)
    }
  }

  function startEdit (row) {
    setEditId(row.config_key)
    setEditVals({
      reference_length_ft:   row.reference_length_ft   ?? '',
      adjust_rate_oz_per_ft: row.adjust_rate_oz_per_ft ?? '',
    })
    setError('')
  }

  async function saveEdit (row) {
    setSaving(true)
    setError('')
    try {
      const body = {
        reference_length_ft:   editVals.reference_length_ft   !== '' ? Number(editVals.reference_length_ft)   : null,
        adjust_rate_oz_per_ft: editVals.adjust_rate_oz_per_ft !== '' ? Number(editVals.adjust_rate_oz_per_ft) : null,
      }
      const updated = await api.patch(
        `/dispatch/catalog/catalog_lineset_configs/${encodeURIComponent(row.config_key)}`, body
      )
      setRows(prev => prev.map(r => r.config_key === row.config_key ? updated : r))
      setEditId(null)
    } catch (err) {
      setError('Save failed.')
      console.error(err)
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div style={styles.loading}>Loading…</div>

  return (
    <div style={styles.tabBody}>
      {error && <p style={styles.errorText}>{error}</p>}
      <p style={styles.fixedNote}>Config list is fixed — new configs cannot be added here.</p>

      <table style={styles.table}>
        <thead>
          <tr>
            {['Config key', 'Reference length (ft)', 'Adjust rate (oz/ft)', ''].map(h => (
              <th key={h} style={styles.th}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(row => {
            const isEditing = editId === row.config_key
            return (
              <tr key={row.config_key} style={styles.tr}>
                <td style={styles.td}>{row.config_key}</td>
                <td style={styles.td}>
                  {isEditing
                    ? <input style={styles.cellInput} type="number" step="0.1"
                        value={editVals.reference_length_ft}
                        onChange={e => setEditVals(v => ({ ...v, reference_length_ft: e.target.value }))} />
                    : row.reference_length_ft}
                </td>
                <td style={styles.td}>
                  {isEditing
                    ? <input style={styles.cellInput} type="number" step="0.01"
                        value={editVals.adjust_rate_oz_per_ft}
                        onChange={e => setEditVals(v => ({ ...v, adjust_rate_oz_per_ft: e.target.value }))} />
                    : row.adjust_rate_oz_per_ft}
                </td>
                <td style={styles.td}>
                  {isEditing ? (
                    <span style={styles.editActions}>
                      <button style={styles.saveBtn} onClick={() => saveEdit(row)} disabled={saving}>
                        {saving ? '…' : 'Save'}
                      </button>
                      <button style={styles.cancelBtn} onClick={() => setEditId(null)}>Cancel</button>
                    </span>
                  ) : (
                    <button style={styles.editBtn} onClick={() => startEdit(row)}>Edit</button>
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

// ── Shared styles ──────────────────────────────────────────

const styles = {
  page:         { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'var(--surface-base)' },
  header:       { padding: '16px 24px', borderBottom: '0.5px solid var(--border-subtle)', background: 'var(--surface-1)', flexShrink: 0, display: 'flex', alignItems: 'baseline', gap: '16px', flexWrap: 'wrap' },
  title:        { fontSize: '16px', fontWeight: 500, color: 'var(--text-primary)' },
  notice:       { fontSize: '12px', color: 'var(--color-plasma)', background: 'var(--plasma-tint)', padding: '3px 10px', borderRadius: '99px', border: '0.5px solid var(--plasma-border)', flexShrink: 0 },

  tabBar:       { display: 'flex', gap: '4px', padding: '8px 16px', borderBottom: '0.5px solid var(--border-subtle)', background: 'var(--surface-1)', flexShrink: 0 },
  tabBtn:       { background: 'none', border: 'none', borderRadius: '6px', padding: '6px 14px', fontSize: '13px', color: 'var(--text-muted)', cursor: 'pointer' },
  tabBtnActive: { background: 'var(--signal-tint)', color: 'var(--color-signal)' },

  body:         { flex: 1, overflowY: 'auto' },
  tabBody:      { padding: '16px 24px', display: 'flex', flexDirection: 'column', gap: '16px' },
  loading:      { padding: '24px', color: 'var(--text-muted)', fontSize: '14px' },
  errorText:    { fontSize: '12px', color: 'var(--color-heat)' },
  fixedNote:    { fontSize: '12px', color: 'var(--text-disabled)' },

  table:        { width: '100%', borderCollapse: 'collapse', fontSize: '13px', background: 'var(--surface-1)', borderRadius: '8px', overflow: 'hidden', border: '0.5px solid var(--border-subtle)' },
  th:           { textAlign: 'left', padding: '8px 12px', color: 'var(--text-muted)', fontWeight: 500, fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.04em', borderBottom: '0.5px solid var(--border-subtle)', background: 'var(--surface-1)', whiteSpace: 'nowrap' },
  tr:           { borderBottom: '0.5px solid var(--border-subtle)' },
  td:           { padding: '8px 12px', color: 'var(--text-secondary)', verticalAlign: 'middle', whiteSpace: 'nowrap' },
  cellInput:    { background: 'var(--surface-2)', border: '0.5px solid var(--color-signal)', borderRadius: '4px', color: 'var(--text-primary)', fontSize: '13px', padding: '3px 6px', outline: 'none', width: '90px' },
  editActions:  { display: 'flex', gap: '4px' },
  editBtn:      { background: 'none', border: '0.5px solid var(--border-default)', borderRadius: '4px', color: 'var(--text-muted)', fontSize: '11px', padding: '3px 8px', cursor: 'pointer' },
  saveBtn:      { background: 'var(--color-signal)', color: '#fff', border: 'none', borderRadius: '4px', fontSize: '11px', fontWeight: 500, padding: '3px 8px', cursor: 'pointer' },
  cancelBtn:    { background: 'none', border: '0.5px solid var(--border-default)', borderRadius: '4px', color: 'var(--text-muted)', fontSize: '11px', padding: '3px 8px', cursor: 'pointer' },

  addToggleBtn: { alignSelf: 'flex-start', background: 'none', border: '0.5px solid var(--border-default)', borderRadius: '6px', color: 'var(--color-signal)', fontSize: '13px', padding: '6px 14px', cursor: 'pointer' },
  addForm:      { background: 'var(--surface-1)', border: '0.5px solid var(--border-subtle)', borderRadius: '8px', padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' },
  addFormTitle: { fontSize: '12px', fontWeight: 500, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' },
  addGrid:      { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '10px' },
  addField:     { display: 'flex', flexDirection: 'column', gap: '3px' },
  addLabel:     { fontSize: '11px', color: 'var(--text-muted)', fontWeight: 500 },
  addInput:     { background: 'var(--surface-2)', border: '0.5px solid var(--border-default)', borderRadius: '6px', color: 'var(--text-primary)', fontSize: '13px', padding: '6px 8px', outline: 'none' },
  addSubmitBtn: { alignSelf: 'flex-start', background: 'var(--color-signal)', color: '#fff', border: 'none', borderRadius: '6px', fontSize: '13px', fontWeight: 500, padding: '8px 20px', cursor: 'pointer' },
}
