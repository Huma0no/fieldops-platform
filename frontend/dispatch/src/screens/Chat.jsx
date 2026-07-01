/**
 * src/screens/Chat.jsx
 * F9 — Chat for Dispatch panel.
 * Direct messages per technician + broadcast compose with read receipts.
 */

import { useState, useEffect, useRef } from 'react'
import { api } from '@shared/api.js'

export default function Chat () {
  const [contacts, setContacts]       = useState([])
  const [activeId, setActiveId]       = useState(null)   // technician id or 'broadcast'
  const [messages, setMessages]       = useState([])
  const [loading, setLoading]         = useState(false)
  const [text, setText]               = useState('')
  const [sending, setSending]         = useState(false)
  const [receipts, setReceipts]       = useState(null)   // for broadcast
  const messagesEndRef                = useRef(null)

  useEffect(() => { loadContacts() }, [])
  useEffect(() => { if (messagesEndRef.current) messagesEndRef.current.scrollIntoView() }, [messages])

  async function loadContacts () {
    try {
      const data = await api.get('/dispatch/technicians?activeOnly=true')
      setContacts(data ?? [])
    } catch (err) { console.error('contacts load failed:', err) }
  }

  async function openThread (id) {
    setActiveId(id)
    setMessages([])
    setReceipts(null)
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
    try {
      if (activeId === 'broadcast') {
        await api.post('/chat/broadcast', { body: text.trim() })
      } else {
        await api.post(`/chat/direct/${activeId}`, { body: text.trim() })
      }
      setText('')
      await openThread(activeId)
    } catch (err) { console.error('send failed:', err) }
    finally { setSending(false) }
  }

  const activeContact = contacts.find(c => c.id === activeId)

  return (
    <div style={styles.page}>
      {/* Sidebar */}
      <div style={styles.sidebar}>
        <button
          style={{ ...styles.contactRow, ...(activeId === 'broadcast' ? styles.contactRowActive : {}) }}
          onClick={() => openThread('broadcast')}
        >
          <div style={styles.avatar}>📢</div>
          <div style={styles.contactInfo}>
            <p style={styles.contactName}>Broadcast</p>
            <p style={styles.contactSub}>All technicians</p>
          </div>
        </button>

        <div style={styles.divider} />

        {contacts.map(c => (
          <button
            key={c.id}
            style={{ ...styles.contactRow, ...(activeId === c.id ? styles.contactRowActive : {}) }}
            onClick={() => openThread(c.id)}
          >
            <div style={styles.avatar}>{c.name?.charAt(0)?.toUpperCase() ?? '?'}</div>
            <div style={styles.contactInfo}>
              <p style={styles.contactName}>{c.name}</p>
              <p style={styles.contactSub}>{c.role ?? 'Technician'}</p>
            </div>
          </button>
        ))}
      </div>

      {/* Thread pane */}
      {!activeId ? (
        <div style={styles.emptyThread}>Select a contact to start messaging.</div>
      ) : (
        <div style={styles.threadPane}>
          <div style={styles.threadHeader}>
            <p style={styles.threadName}>
              {activeId === 'broadcast' ? 'Broadcast' : activeContact?.name ?? '—'}
            </p>
            {activeId === 'broadcast' && (
              <p style={styles.threadSub}>Sends to all active technicians</p>
            )}
          </div>

          <div style={styles.messages}>
            {loading ? (
              <p style={styles.msgLoading}>Loading…</p>
            ) : messages.length === 0 ? (
              <p style={styles.msgLoading}>No messages yet.</p>
            ) : (
              messages.map(msg => (
                <div key={msg.id} style={styles.bubbleWrap}>
                  <div style={{
                    ...styles.bubble,
                    ...(msg.sent_by_me ? styles.bubbleMine : styles.bubbleTheirs),
                  }}>
                    {msg.body}
                    <span style={styles.bubbleTime}>{formatTime(msg.created_at)}</span>
                  </div>
                  {activeId === 'broadcast' && msg.sent_by_me && (
                    <button style={styles.receiptBtn} onClick={() => loadReceipts(msg.id)}>
                      receipts
                    </button>
                  )}
                  {receipts?.messageId === msg.id && (
                    <p style={styles.receiptText}>
                      Read by {receipts.read}/{receipts.total} technicians
                    </p>
                  )}
                </div>
              ))
            )}
            <div ref={messagesEndRef} />
          </div>

          <div style={styles.composer}>
            <textarea
              style={styles.composerInput}
              value={text}
              onChange={e => setText(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() } }}
              placeholder={activeId === 'broadcast' ? 'Broadcast message…' : 'Message…'}
              rows={1}
            />
            <button style={styles.sendBtn} onClick={handleSend} disabled={sending || !text.trim()}>
              {sending ? '…' : '↑'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function formatTime (iso) {
  if (!iso) return ''
  try { return new Date(iso).toLocaleTimeString('en-US', { hour:'numeric', minute:'2-digit', hour12:true }) }
  catch (_) { return '' }
}

const styles = {
  page:         { flex:1, display:'flex', overflow:'hidden', background:'var(--surface-base)' },
  sidebar:      { width:'220px', flexShrink:0, borderRight:'0.5px solid var(--border-subtle)', overflowY:'auto', background:'var(--surface-1)', display:'flex', flexDirection:'column' },
  contactRow:   { display:'flex', alignItems:'center', gap:'12px', padding:'10px 16px', background:'none', border:'none', cursor:'pointer', width:'100%', textAlign:'left' },
  contactRowActive: { background:'var(--signal-tint)' },
  avatar:       { width:'34px', height:'34px', borderRadius:'50%', background:'var(--surface-3)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:'13px', fontWeight:600, color:'var(--text-primary)', flexShrink:0 },
  contactInfo:  { minWidth:0 },
  contactName:  { fontSize:'13px', fontWeight:500, color:'var(--text-primary)', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' },
  contactSub:   { fontSize:'11px', color:'var(--text-muted)' },
  divider:      { height:'0.5px', background:'var(--border-subtle)' },
  emptyThread:  { flex:1, display:'flex', alignItems:'center', justifyContent:'center', fontSize:'13px', color:'var(--text-disabled)' },
  threadPane:   { flex:1, display:'flex', flexDirection:'column', overflow:'hidden' },
  threadHeader: { padding:'12px 16px', borderBottom:'0.5px solid var(--border-subtle)', background:'var(--surface-1)', flexShrink:0 },
  threadName:   { fontSize:'14px', fontWeight:500, color:'var(--text-primary)' },
  threadSub:    { fontSize:'12px', color:'var(--text-muted)' },
  messages:     { flex:1, overflowY:'auto', padding:'16px', display:'flex', flexDirection:'column', gap:'8px' },
  msgLoading:   { fontSize:'13px', color:'var(--text-disabled)', textAlign:'center', margin:'auto' },
  bubbleWrap:   { display:'flex', flexDirection:'column', gap:'2px' },
  bubble:       { maxWidth:'70%', padding:'8px 12px', borderRadius:'12px', fontSize:'13px', lineHeight:1.4 },
  bubbleMine:   { background:'var(--color-signal)', color:'#fff', alignSelf:'flex-end', borderBottomRightRadius:'4px' },
  bubbleTheirs: { background:'var(--surface-2)', color:'var(--text-primary)', alignSelf:'flex-start', borderBottomLeftRadius:'4px' },
  bubbleTime:   { display:'block', fontSize:'9px', opacity:0.6, marginTop:'3px', textAlign:'right' },
  receiptBtn:   { background:'none', border:'none', color:'var(--text-disabled)', fontSize:'11px', cursor:'pointer', padding:'0 4px', alignSelf:'flex-end' },
  receiptText:  { fontSize:'11px', color:'var(--text-muted)', alignSelf:'flex-end', paddingRight:'4px' },
  composer:     { display:'flex', alignItems:'flex-end', gap:'8px', padding:'12px 16px', borderTop:'0.5px solid var(--border-subtle)', background:'var(--surface-1)', flexShrink:0 },
  composerInput:{ flex:1, background:'var(--surface-2)', border:'0.5px solid var(--border-default)', borderRadius:'12px', color:'var(--text-primary)', fontSize:'13px', fontFamily:'var(--font-sans)', padding:'8px 12px', outline:'none', resize:'none', lineHeight:1.4 },
  sendBtn:      { width:'36px', height:'36px', borderRadius:'50%', background:'var(--color-signal)', border:'none', color:'#fff', fontSize:'18px', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 },
}
