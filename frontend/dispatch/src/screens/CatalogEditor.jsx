/**
 * src/screens/CatalogEditor.jsx
 * F10 — Catalog editor for Dispatch. Inline edit + add for equipment, items, services.
 * All saves go to PATCH /api/dispatch/catalog/:table/:id.
 * Note: catalog changes do not affect historical visits.
 */

import { useState, useEffect } from 'react'
import { api } from '@shared/api.js'

const TABS = [
  { id: 'equipment', label: 'Equipment' },
  { id: 'items',     label: 'Items' },
  { id: 'services',  label: 'Services' },
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
      </div>
    </div>
  )
}

// ── Equipment tab ──────────────────────────────────────────

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
      const data = await api.get('/catalog/equipment')
      setRows(data ?? [])
    } catch (err) {
      console.error('Equipment load failed:', err)
    } finally {
      setLoading(false)
    }
  }

  function startEdit (row) {
    setEditId(row.id)
    setEditVals({
      pesp:               row.pesp              ?? '',
      factory_charge_oz:  row.factory_charge_oz ?? '',
      revised_charge_oz:  row.revised_charge_oz ?? '',
    })
    setError('')
  }

  async function saveEdit (row) {
    setSaving(true)
    setError('')
    try {
      const body = {}
      if (editVals.pesp              !== '') body.pesp              = editVals.pesp === 'null' ? null : Number(editVals.pesp)
      if (editVals.factory_charge_oz !== '') body.factory_charge_oz = Number(editVals.factory_charge_oz)
      if (editVals.revised_charge_oz !== '') body.revised_charge_oz = editVals.revised_charge_oz === '' ? null : Number(editVals.revised_charge_oz)
      await api.patch(`/dispatch/catalog/equipment/${row.id}`, body)
      setRows(prev => prev.map(r => r.id === row.id ? { ...r, ...body } : r))
      setEditId(null)
    } catch (err) {
      setError('Save failed.')
      console.error(err)
    } finally {
      setSaving(false)
    }
  }

  async function handleAdd () {
    if (!addForm.model.trim()) { setError('Model is required.'); return }
    setAdding(true)
    setError('')
    try {
      const body = {
        model:              addForm.model.trim(),
        type:               addForm.type.trim() || null,
        refrigerant:        addForm.refrigerant.trim() || null,
        factory_charge_oz:  addForm.factory_charge_oz !== '' ? Number(addForm.factory_charge_oz) : null,
        revised_charge_oz:  addForm.revised_charge_oz !== '' ? Number(addForm.revised_charge_oz) : null,
        pesp:               addForm.pesp !== '' ? Number(addForm.pesp) : null,
        is_a2l:             addForm.is_a2l,
      }
      const created = await api.post('/dispatch/catalog/equipment', body)
      setRows(prev => [...prev, created])
      setAddForm(EMPTY_EQUIPMENT)
      setShowAdd(false)
    } catch (err) {
      setError('Add failed.')
      console.error(err)
    } finally {
      setAdding(false)
    }
  }

  if (loading) return <div style={styles.loading}>Loading…</div>

  return (
    <div style={styles.tabBody}>
      {error && <p style={styles.errorText}>{error}</p>}

      <table style={styles.table}>
        <thead>
          <tr>
            {['Model','Type','Refrigerant','Factory oz','Revised oz','PESP','A2L',''].map(h => (
              <th key={h} style={styles.th}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(row => {
            const isEditing = editId === row.id
            return (
              <tr key={row.id} style={styles.tr}>
                <td style={styles.td}>{row.model}</td>
                <td style={styles.td}>{row.type ?? '—'}</td>
                <td style={styles.td}>{row.refrigerant ?? '—'}</td>
                <td style={styles.td}>
                  {isEditing
                    ? <input style={styles.cellInput} type="number" value={editVals.factory_charge_oz}
                        onChange={e => setEditVals(v => ({ ...v, factory_charge_oz: e.target.value }))} />
                    : (row.factory_charge_oz ?? '—')}
                </td>
                <td style={styles.td}>
                  {isEditing
                    ? <input style={styles.cellInput} type="number" value={editVals.revised_charge_oz}
                        onChange={e => setEditVals(v => ({ ...v, revised_charge_oz: e.target.value }))} />
                    : (row.revised_charge_oz ?? '—')}
                </td>
                <td style={styles.td}>
                  {isEditing
                    ? <input style={styles.cellInput} type="number" step="0.1" value={editVals.pesp}
                        onChange={e => setEditVals(v => ({ ...v, pesp: e.target.value }))} />
                    : (row.pesp ?? '—')}
                </td>
                <td style={styles.td}>{row.is_a2l ? 'Yes' : 'No'}</td>
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

      <button style={styles.addToggleBtn} onClick={() => { setShowAdd(s => !s); setError('') }}>
        {showAdd ? 'Cancel' : '+ Add model'}
      </button>

      {showAdd && (
        <div style={styles.addForm}>
          <p style={styles.addFormTitle}>New equipment model</p>
          <div style={styles.addGrid}>
            {[
              { key: 'model',             label: 'Model *',            type: 'text' },
              { key: 'type',              label: 'Type (indoor/outdoor)', type: 'text' },
              { key: 'refrigerant',       label: 'Refrigerant',        type: 'text' },
              { key: 'factory_charge_oz', label: 'Factory charge (oz)', type: 'number' },
              { key: 'revised_charge_oz', label: 'Revised charge (oz)', type: 'number' },
              { key: 'pesp',              label: 'PESP',               type: 'number' },
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
            <div style={styles.addField}>
              <label style={styles.addLabel}>A2L refrigerant</label>
              <input
                type="checkbox"
                checked={addForm.is_a2l}
                onChange={e => setAddForm(f => ({ ...f, is_a2l: e.target.checked }))}
              />
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

const EMPTY_EQUIPMENT = {
  model: '', type: '', refrigerant: '', factory_charge_oz: '', revised_charge_oz: '', pesp: '', is_a2l: false,
}

// ── Items tab ──────────────────────────────────────────────

function ItemsTab () {
  const [rows, setRows]         = useState([])
  const [loading, setLoading]   = useState(true)
  const [editId, setEditId]     = useState(null)
  const [editPrice, setEditPrice] = useState('')
  const [saving, setSaving]     = useState(false)
  const [showAdd, setShowAdd]   = useState(false)
  const [addForm, setAddForm]   = useState(EMPTY_ITEM)
  const [adding, setAdding]     = useState(false)
  const [error, setError]       = useState('')

  useEffect(() => { loadData() }, [])

  async function loadData () {
    setLoading(true)
    try {
      const data = await api.get('/catalog/items')
      setRows(data ?? [])
    } catch (err) {
      console.error('Items load failed:', err)
    } finally {
      setLoading(false)
    }
  }

  async function saveEdit (row) {
    setSaving(true)
    setError('')
    try {
      const price = Number(editPrice)
      await api.patch(`/dispatch/catalog/items/${row.id}`, { default_price: price })
      setRows(prev => prev.map(r => r.id === row.id ? { ...r, default_price: price } : r))
      setEditId(null)
    } catch (err) {
      setError('Save failed.')
      console.error(err)
    } finally {
      setSaving(false)
    }
  }

  async function handleAdd () {
    if (!addForm.item_name.trim() || !addForm.category.trim()) {
      setError('Item name and category are required.')
      return
    }
    setAdding(true)
    setError('')
    try {
      const body = {
        item_name:                  addForm.item_name.trim(),
        category:                   addForm.category.trim(),
        default_price:              addForm.default_price !== '' ? Number(addForm.default_price) : 0,
        multiplies_by_system_count: addForm.multiplies_by_system_count,
        tech_supplied:              addForm.tech_supplied,
        custom_price:               addForm.custom_price,
      }
      const created = await api.post('/dispatch/catalog/items', body)
      setRows(prev => [...prev, created])
      setAddForm(EMPTY_ITEM)
      setShowAdd(false)
    } catch (err) {
      setError('Add failed.')
      console.error(err)
    } finally {
      setAdding(false)
    }
  }

  if (loading) return <div style={styles.loading}>Loading…</div>

  return (
    <div style={styles.tabBody}>
      {error && <p style={styles.errorText}>{error}</p>}

      <table style={styles.table}>
        <thead>
          <tr>
            {['Item name','Category','Price','Multiplies','Tech supplied','Custom price',''].map(h => (
              <th key={h} style={styles.th}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(row => {
            const isEditing = editId === row.id
            return (
              <tr key={row.id} style={styles.tr}>
                <td style={styles.td}>{row.item_name}</td>
                <td style={styles.td}>{row.category}</td>
                <td style={styles.td}>
                  {isEditing
                    ? <input style={styles.cellInput} type="number" min="0" step="0.01"
                        value={editPrice} onChange={e => setEditPrice(e.target.value)} />
                    : `$${Number(row.default_price ?? 0).toFixed(2)}`}
                </td>
                <td style={styles.td}>{row.multiplies_by_system_count ? 'Yes' : 'No'}</td>
                <td style={styles.td}>{row.tech_supplied ? 'Yes' : 'No'}</td>
                <td style={styles.td}>{row.custom_price ? 'Yes' : 'No'}</td>
                <td style={styles.td}>
                  {isEditing ? (
                    <span style={styles.editActions}>
                      <button style={styles.saveBtn} onClick={() => saveEdit(row)} disabled={saving}>
                        {saving ? '…' : 'Save'}
                      </button>
                      <button style={styles.cancelBtn} onClick={() => setEditId(null)}>Cancel</button>
                    </span>
                  ) : (
                    <button style={styles.editBtn} onClick={() => { setEditId(row.id); setEditPrice(row.default_price ?? 0); setError('') }}>
                      Edit
                    </button>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>

      <button style={styles.addToggleBtn} onClick={() => { setShowAdd(s => !s); setError('') }}>
        {showAdd ? 'Cancel' : '+ Add item'}
      </button>

      {showAdd && (
        <div style={styles.addForm}>
          <p style={styles.addFormTitle}>New catalog item</p>
          <div style={styles.addGrid}>
            {[
              { key: 'item_name',     label: 'Item name *',  type: 'text' },
              { key: 'category',      label: 'Category *',   type: 'text', placeholder: 'accessory / fix / thermostat' },
              { key: 'default_price', label: 'Default price', type: 'number' },
            ].map(({ key, label, type, placeholder }) => (
              <div key={key} style={styles.addField}>
                <label style={styles.addLabel}>{label}</label>
                <input
                  style={styles.addInput}
                  type={type}
                  placeholder={placeholder}
                  value={addForm[key]}
                  onChange={e => setAddForm(f => ({ ...f, [key]: e.target.value }))}
                />
              </div>
            ))}
            {[
              { key: 'multiplies_by_system_count', label: 'Multiplies by system count' },
              { key: 'tech_supplied',              label: 'Tech supplied' },
              { key: 'custom_price',               label: 'Custom price (free-form)' },
            ].map(({ key, label }) => (
              <div key={key} style={{ ...styles.addField, flexDirection: 'row', alignItems: 'center', gap: '8px' }}>
                <input
                  type="checkbox"
                  checked={addForm[key]}
                  onChange={e => setAddForm(f => ({ ...f, [key]: e.target.checked }))}
                />
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

const EMPTY_ITEM = {
  item_name: '', category: '', default_price: '', multiplies_by_system_count: false, tech_supplied: false, custom_price: false,
}

// ── Services tab ───────────────────────────────────────────

function ServicesTab () {
  const [rows, setRows]           = useState([])
  const [loading, setLoading]     = useState(true)
  const [editId, setEditId]       = useState(null)
  const [editPrice, setEditPrice] = useState('')
  const [saving, setSaving]       = useState(false)
  const [error, setError]         = useState('')

  useEffect(() => { loadData() }, [])

  async function loadData () {
    setLoading(true)
    try {
      const data = await api.get('/catalog/services')
      setRows(data ?? [])
    } catch (err) {
      console.error('Services load failed:', err)
    } finally {
      setLoading(false)
    }
  }

  async function saveEdit (row) {
    setSaving(true)
    setError('')
    try {
      const price = Number(editPrice)
      await api.patch(`/dispatch/catalog/services/${row.id}`, { default_price: price })
      setRows(prev => prev.map(r => r.id === row.id ? { ...r, default_price: price } : r))
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

      <table style={styles.table}>
        <thead>
          <tr>
            {['Service name','Default price','Bundle','Multiplies by system',''].map(h => (
              <th key={h} style={styles.th}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(row => {
            const isEditing = editId === row.id
            return (
              <tr key={row.id} style={styles.tr}>
                <td style={styles.td}>{row.service_name}</td>
                <td style={styles.td}>
                  {isEditing
                    ? <input style={styles.cellInput} type="number" min="0" step="0.01"
                        value={editPrice} onChange={e => setEditPrice(e.target.value)} />
                    : `$${Number(row.default_price ?? 0).toFixed(2)}`}
                </td>
                <td style={styles.td}>{row.is_bundle ? 'Yes' : 'No'}</td>
                <td style={styles.td}>{row.multiplies_by_system_count ? 'Yes' : 'No'}</td>
                <td style={styles.td}>
                  {isEditing ? (
                    <span style={styles.editActions}>
                      <button style={styles.saveBtn} onClick={() => saveEdit(row)} disabled={saving}>
                        {saving ? '…' : 'Save'}
                      </button>
                      <button style={styles.cancelBtn} onClick={() => setEditId(null)}>Cancel</button>
                    </span>
                  ) : (
                    <button style={styles.editBtn} onClick={() => { setEditId(row.id); setEditPrice(row.default_price ?? 0); setError('') }}>
                      Edit
                    </button>
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

  table:        { width: '100%', borderCollapse: 'collapse', fontSize: '13px', background: 'var(--surface-1)', borderRadius: '8px', overflow: 'hidden', border: '0.5px solid var(--border-subtle)' },
  th:           { textAlign: 'left', padding: '8px 12px', color: 'var(--text-muted)', fontWeight: 500, fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.04em', borderBottom: '0.5px solid var(--border-subtle)', background: 'var(--surface-1)' },
  tr:           { borderBottom: '0.5px solid var(--border-subtle)' },
  td:           { padding: '8px 12px', color: 'var(--text-secondary)', verticalAlign: 'middle' },
  cellInput:    { background: 'var(--surface-2)', border: '0.5px solid var(--color-signal)', borderRadius: '4px', color: 'var(--text-primary)', fontSize: '13px', padding: '3px 6px', outline: 'none', width: '80px' },
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
