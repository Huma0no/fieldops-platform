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

  if (loading) return <div className="vd-hint" style={s.loading}>Loading…</div>

  return (
    <div style={s.page} onClick={() => setOpenAssign(null)}>
      <div className="vd-unit">
        <div className="vd-unit-head"><span className="vd-unit-id">LBY</span><span className="vd-unit-name">Lobby</span></div>
        <div className="vd-knurl" />
        <div className="vd-unit-body">
          <div style={s.summary}>
            <div className="vd-readout inline">
              <span className="num">{String(visits.length).padStart(2, '0')}</span>
              <span className="cap">waiting</span>
            </div>
          </div>
          {visits.length === 0 ? (
            <p className="vd-hint" style={s.flush}>No visits in lobby.</p>
          ) : (
            groupEntries.map(([subdivision, group]) => (
              <div key={subdivision} style={s.group}>
                <div className="vd-group-bar">
                  <span className="name">{subdivision}</span>
                  <span className="count">{String(group.length).padStart(2, '0')}</span>
                </div>
                <div className="vd-cols-2" style={s.cards}>
                  {group.map(v => (
                    <div key={v.id} className={`vd-card${v.tags.includes('priority') ? ' prio' : ''}`}>
                      <div className="addr">{v.address.street}</div>
                      <div className="sub">
                        {[v.address.builder, v.workType].filter(Boolean).join(' · ')}
                      </div>
                      {v.tags.length > 0 && (
                        <div className="tags">
                          {v.tags.map(t => (
                            <span key={t} className={`vd-badge${t === 'priority' ? ' solid' : ''}`}>{TAG_LABELS[t] || t.toUpperCase()}</span>
                          ))}
                        </div>
                      )}
                      <div className="foot">
                        <div style={{ position: 'relative' }} onClick={e => e.stopPropagation()}>
                          <button
                            type="button"
                            className="vd-key sm"
                            aria-expanded={openAssign === v.id}
                            onClick={() => setOpenAssign(openAssign === v.id ? null : v.id)}
                          >
                            Assign ▾
                          </button>
                          {openAssign === v.id && (
                            <div className="vd-menu">
                              {technicians.length === 0 ? (
                                <div className="empty">No technicians available</div>
                              ) : (
                                technicians
                                  .slice()
                                  .sort((a, b) => a.name.localeCompare(b.name))
                                  .map(t => (
                                    <button type="button" key={t.id} onClick={() => handleAssign(v.id, t.id)}>
                                      {t.name}
                                    </button>
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
      </div>
    </div>
  )
}

// Layout only; the look comes from dispatch.css (vd-*).
const s = {
  page:    { flex: 1, overflowY: 'auto', padding: '16px 18px 18px' },
  loading: { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' },
  summary: { display: 'flex', alignItems: 'center', gap: 14, marginBottom: 18 },
  flush:   { margin: 0 },
  group:   { marginBottom: 18 },
  cards:   { gap: 12 },
}
