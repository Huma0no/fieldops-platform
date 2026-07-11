import { useState, useEffect, useRef } from 'react'
import { api } from '@shared/api.js'

const TAG_LABELS = { priority: 'PRIORITARIO', multiSystem: 'MULTISISTEMA', a2l: 'A2L' }

export default function Lobby() {
  const [visits, setVisits]           = useState([])
  const [technicians, setTechnicians] = useState([])
  const [loading, setLoading]         = useState(true)
  const [openAssign, setOpenAssign]   = useState(null)
  const pollRef = useRef(null)

  async function load() {
    try {
      const data = await api.get('/dispatch/lobby')
      setVisits(data)
    } catch (err) {
      console.error('lobby load failed:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    api.get('/dispatch/technicians').then(setTechnicians).catch(() => {})
    pollRef.current = setInterval(load, 10_000)
    return () => clearInterval(pollRef.current)
  }, [])

  async function handleAssign(visitId, technicianId) {
    setOpenAssign(null)
    try {
      await api.patch(`/dispatch/visits/${visitId}/reassign`, { technicianId })
    } catch (err) {
      console.error('reassign failed:', err)
    }
  }

  const groups = {}
  for (const v of visits) {
    const key = v.address.subdivision || '—'
    if (!groups[key]) groups[key] = []
    groups[key].push(v)
  }
  const groupEntries = Object.entries(groups).sort(([a], [b]) => a.localeCompare(b))

  if (loading) return <div style={s.loading}>Loading…</div>

  return (
    <div style={s.page} onClick={() => setOpenAssign(null)}>
      {visits.length === 0 ? (
        <p style={s.empty}>No visits in lobby.</p>
      ) : (
        groupEntries.map(([subdivision, group]) => (
          <div key={subdivision} style={{ marginBottom: 24 }}>
            <div style={s.subdivisionLabel}>{subdivision}</div>
            <div style={s.lobbyGrid}>
              {group.map(v => (
                <div key={v.id} style={s.visitCard}>
                  <div style={s.visitAddr}>{v.address.street}</div>
                  <div style={s.visitSub}>
                    {[v.address.builder, v.workType].filter(Boolean).join(' · ')}
                  </div>
                  {v.tags.length > 0 && (
                    <div style={s.tags}>
                      {v.tags.map(t => (
                        <span key={t} style={s.tag}>{TAG_LABELS[t] || t.toUpperCase()}</span>
                      ))}
                    </div>
                  )}
                  <div style={s.assignRow}>
                    <div style={{ position: 'relative' }} onClick={e => e.stopPropagation()}>
                      <button
                        style={s.assignBtn}
                        onClick={() => setOpenAssign(openAssign === v.id ? null : v.id)}
                      >
                        Assign ▾
                      </button>
                      {openAssign === v.id && (
                        <div style={s.assignDropdown}>
                          {technicians.length === 0 ? (
                            <div style={s.assignOption}>No technicians available</div>
                          ) : (
                            technicians
                              .slice()
                              .sort((a, b) => a.name.localeCompare(b.name))
                              .map(t => (
                                <div
                                  key={t.id}
                                  style={s.assignOption}
                                  onClick={() => handleAssign(v.id, t.id)}
                                >
                                  {t.name}
                                </div>
                              ))
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  )
}

const s = {
  page:  { flex: 1, overflowY: 'auto', padding: '20px 24px', background: '#EAEAE6', color: '#141414', fontFamily: '-apple-system, Helvetica, Arial, sans-serif' },
  loading: { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '13px', color: '#5A5A5A', background: '#EAEAE6' },
  empty:   { fontSize: '13px', color: '#5A5A5A' },
  subdivisionLabel: { fontSize: '11px', fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase', color: '#5A5A5A', marginBottom: 8 },
  lobbyGrid:  { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 16 },
  visitCard:  { border: '1px solid #141414', padding: '12px 14px', background: '#F4F4F1' },
  visitAddr:  { fontSize: '13px', fontWeight: 500 },
  visitSub:   { fontSize: '11px', color: '#5A5A5A', marginTop: 2 },
  tags:       { marginTop: 8, display: 'flex', gap: 5, flexWrap: 'wrap' },
  tag:        { fontSize: '10px', border: '1px solid #141414', padding: '2px 6px', letterSpacing: '0.3px' },
  assignRow:  { marginTop: 10, display: 'flex', justifyContent: 'flex-end' },
  assignBtn:  { border: '1px solid #141414', padding: '5px 10px', fontSize: '11px', background: 'none', cursor: 'pointer', color: '#141414', fontFamily: 'inherit' },
  assignDropdown: { position: 'absolute', right: 0, top: '100%', background: '#EAEAE6', border: '1px solid #141414', minWidth: 160, zIndex: 10 },
  assignOption:   { padding: '7px 10px', fontSize: '12px', cursor: 'pointer', borderBottom: '1px solid #DDD' },
}
