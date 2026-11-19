/**
 * src/screens/Chat.jsx
 * F9 — Chat for Dispatch panel.
 * Direct messages per technician + broadcast compose with read receipts.
 */

import { useState, useEffect, useRef } from 'react'
import { api } from '@shared/api.js'
import { useAuth } from '../lib/auth.jsx'

export default function Chat () {
  const { session }                   = useAuth()
  const me                            = session?.dispatcher?.id
  const [contacts, setContacts]       = useState([])
  const [activeId, setActiveId]       = useState(null)   // technician id or 'broadcast'
  const [messages, setMessages]       = useState([])
  const [loading, setLoading]         = useState(false)
  const [text, setText]               = useState('')
  const [sending, setSending]         = useState(false)
  const [sendError, setSendError]     = useState('')
  const [receipts, setReceipts]       = useState(null)   // for broadcast
  const messagesEndRef                = useRef(null)

  useEffect(() => { loadContacts() }, [])
  useEffect(() => { if (messagesEndRef.current) messagesEndRef.current.scrollIntoView() }, [messages])

  async function loadContacts () {
    try {
      const data = await api.get('/dispatch/technicians?activeOnly=true')
      setContacts((data ?? []).filter(c => c.id !== me))
    } catch (err) { console.error('contacts load failed:', err) }
  }

  async function openThread (id) {
    setActiveId(id)
    setMessages([])
    setReceipts(null)
    setSendError('')
    setLoading(true)
    try {
      if (id === 'broadcast') {
        const data = await api.get('/chat/broadcast')
        setMessages(data ?? [])
      } else {
        const data = await api.get(`/chat/direct/${id}`)
        setMessages(data ?? [])
      }
    } catch (err) { console.error('thread load failed:', err) }
    finally { setLoading(false) }
  }

  async function loadReceipts (messageId) {
    try {
      const data = await api.get(`/chat/broadcast/${messageId}/read-receipts`)
      setReceipts({ messageId, total: data?.total ?? 0, read: data?.read ?? 0 })
    } catch (err) { console.error('receipts load failed:', err) }
  }

  async function handleSend () {
    if (!text.trim() || !activeId) return
    setSending(true)
    setSendError('')
    try {
      if (activeId === 'broadcast') {
        await api.post('/chat/broadcast', { body: text.trim() })
      } else {
        await api.post(`/chat/direct/${activeId}`, { body: text.trim() })
      }
      setText('')
      await openThread(activeId)
    } catch (err) {
      setSendError('Failed to send. Try again.')
    }
    finally { setSending(false) }
  }

  const activeContact = contacts.find(c => c.id === activeId)

  return (
    <div style={styles.page}>
      {/* Contacts */}
      <div className="vd-unit" style={styles.sidebar}>
        <div className="vd-unit-head"><span className="vd-unit-id">CH</span><span className="vd-unit-name">Channels</span></div>
        <div style={styles.list}>
          <button
            type="button"
            className={`vd-row${activeId === 'broadcast' ? ' on' : ''}`}
            onClick={() => openThread('broadcast')}
          >
            <span className="vd-unit-id" style={styles.mark}>ALL</span>
            <span style={styles.contactInfo}>
              <span className="title">Broadcast</span>
              <span className="line">All technicians</span>
            </span>
          </button>
          {contacts.map(c => (
            <button
              key={c.id}
              type="button"
              className={`vd-row${activeId === c.id ? ' on' : ''}`}
              onClick={() => openThread(c.id)}
            >
              <span className="vd-unit-id" style={styles.mark}>{c.name?.charAt(0)?.toUpperCase() ?? '?'}</span>
              <span style={styles.contactInfo}>
                <span className="title">{c.name}</span>
                <span className="line">{c.role ?? 'Technician'}</span>
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Thread */}
      <div className="vd-unit" style={styles.threadPane}>
        <div className="vd-unit-head">
          <span className="vd-unit-id">MSG</span>
          <span className="vd-unit-name">
            {!activeId ? 'Messages' : activeId === 'broadcast' ? 'Broadcast' : activeContact?.name ?? '—'}
          </span>
          {activeId === 'broadcast' && <span className="vd-unit-note">Sends to all active technicians</span>}
        </div>

        {!activeId ? (
          <p className="vd-hint" style={styles.emptyThread}>Select a contact to start messaging.</p>
        ) : (
          <>
            <div style={styles.messages}>
              {loading ? (
                <p className="vd-hint" style={styles.msgLoading}>Loading…</p>
              ) : messages.length === 0 ? (
                <p className="vd-hint" style={styles.msgLoading}>No messages yet.</p>
              ) : (
                messages.map(msg => (
                  <div key={msg.id} style={{ ...styles.bubbleWrap, alignItems: msg.sentByMe ? 'flex-end' : 'flex-start' }}>
                    <div className={`vd-msg${msg.sentByMe ? ' mine' : ''}`}>
                      {msg.body}
                      <span className="time">{formatTime(msg.createdAt)}</span>
                    </div>
                    {activeId === 'broadcast' && msg.sentByMe && (
                      <button type="button" className="vd-key sm" style={styles.receiptBtn} onClick={() => loadReceipts(msg.id)}>
                        Receipts
                      </button>
                    )}
                    {receipts?.messageId === msg.id && (
                      <p className="vd-hint" style={styles.flush}>
                        Read by <span className="vd-data">{receipts.read}/{receipts.total}</span> technicians
                      </p>
                    )}
                  </div>
                ))
              )}
              <div ref={messagesEndRef} />
            </div>

            {sendError && <p className="vd-error" style={styles.sendError}>{sendError}</p>}
            <div style={styles.composer}>
              <textarea
                className="vd-input"
                style={styles.composerInput}
                aria-label="Message"
                value={text}
                onChange={e => setText(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() } }}
                placeholder={activeId === 'broadcast' ? 'Broadcast message…' : 'Message…'}
                rows={1}
              />
              <button type="button" className="vd-key dark" onClick={handleSend} disabled={sending || !text.trim()}>
                {sending ? 'Sending…' : 'Send'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function formatTime (iso) {
  if (!iso) return ''
  try { return new Date(iso).toLocaleTimeString('en-US', { hour:'numeric', minute:'2-digit', hour12:true }) }
  catch (_) { return '' }
}

// Layout only; the look comes from dispatch.css (vd-*).
const styles = {
  page:         { flex: 1, minHeight: 0, display: 'flex', gap: '18px', padding: '16px 18px 18px', overflow: 'hidden' },
  sidebar:      { width: '250px', flexShrink: 0, display: 'flex', flexDirection: 'column', minHeight: 0 },
  list:         { overflowY: 'auto', flex: 1 },
  mark:         { width: '30px', textAlign: 'center', flexShrink: 0 },
  contactInfo:  { display: 'flex', flexDirection: 'column', minWidth: 0 },
  threadPane:   { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', minHeight: 0 },
  emptyThread:  { margin: 'auto', fontSize: '12px' },
  messages:     { flex: 1, overflowY: 'auto', padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: '10px' },
  msgLoading:   { margin: 'auto' },
  bubbleWrap:   { display: 'flex', flexDirection: 'column', gap: '4px' },
  receiptBtn:   { alignSelf: 'flex-end' },
  flush:        { margin: 0 },
  sendError:    { padding: '0 18px 6px' },
  composer:     { display: 'flex', alignItems: 'flex-end', gap: '10px', padding: '12px 18px', borderTop: '2px solid var(--vd-ink)', background: 'var(--vd-panel)' },
  composerInput:{ flex: 1, resize: 'none', lineHeight: 1.4 },
}
