/**
 * src/screens/chat.js
 * F9 — Chat screen for PWA.
 */

import { api }                  from '../../../shared/api.js'
import { NavBar, navBarStyles } from '../components/nav-bar.js'
import { startSync }            from '../lib/sync.js'

const STYLES_ID = 'styles-chat'

function injectStyles () {
  if (document.getElementById(STYLES_ID)) return
  const style = document.createElement('style')
  style.id = STYLES_ID
  style.textContent = navBarStyles + screenStyles
  document.head.appendChild(style)
}

let contacts     = []
let activeThread = null
let messages     = []

export default async function mount (appEl) {
  injectStyles()
  appEl.innerHTML = ''

  const screen = document.createElement('div')
  screen.className = 'screen chat-screen'
  screen.id = 'chat-screen'
  screen.appendChild(buildHeader())

  const body = document.createElement('div')
  body.className = 'chat-body'
  body.appendChild(buildSidebar())

  const threadPane = document.createElement('div')
  threadPane.className = 'chat-thread-pane'
  threadPane.id = 'chat-thread-pane'
  threadPane.innerHTML = '<p class="chat-empty-thread">Select a contact to start messaging.</p>'
  body.appendChild(threadPane)
  screen.appendChild(body)

  screen.appendChild(NavBar({
    active: 'chat',
    onNavigate: route => window.dispatchEvent(new CustomEvent('app:navigate', { detail: { route } })),
  }))

  appEl.appendChild(screen)
  await loadContacts()
  startSync()
  window.addEventListener('sync:update', onSyncUpdate)
}

async function loadContacts () {
  try {
    const data = await api.get('/dispatch/technicians?activeOnly=true')
    contacts = data ?? []
    renderSidebarContacts()
  } catch (err) { console.error('contacts load failed:', err) }
}

function buildSidebar () {
  const sidebar = document.createElement('div')
  sidebar.className = 'chat-sidebar'
  sidebar.id = 'chat-sidebar'

  const broadcast = document.createElement('button')
  broadcast.className = 'chat-contact-row'
  broadcast.innerHTML = `<div class="chat-avatar chat-avatar--broadcast">📢</div><div class="chat-contact-info"><p class="chat-contact-name">Broadcast</p><p class="chat-contact-sub">From dispatcher</p></div>`
  broadcast.addEventListener('click', () => openBroadcast())
  sidebar.appendChild(broadcast)

  const divider = document.createElement('div')
  divider.className = 'chat-divider'
  sidebar.appendChild(divider)

  const contactsWrap = document.createElement('div')
  contactsWrap.id = 'chat-contacts'
  sidebar.appendChild(contactsWrap)
  return sidebar
}

function renderSidebarContacts () {
  const wrap = document.getElementById('chat-contacts')
  if (!wrap) return
  wrap.innerHTML = ''
  if (!contacts.length) {
    const empty = document.createElement('p')
    empty.className = 'chat-sidebar-empty'
    empty.textContent = 'No other technicians.'
    wrap.appendChild(empty)
    return
  }
  contacts.forEach(contact => {
    const btn = document.createElement('button')
    btn.className = `chat-contact-row ${activeThread?.id === contact.id ? 'chat-contact-row--active' : ''}`
    btn.innerHTML = `<div class="chat-avatar">${contact.name?.charAt(0)?.toUpperCase() ?? '?'}</div><div class="chat-contact-info"><p class="chat-contact-name">${contact.name}</p><p class="chat-contact-sub">${contact.role ?? 'Technician'}</p></div>`
    btn.addEventListener('click', () => openThread(contact))
    wrap.appendChild(btn)
  })
}

async function openBroadcast () {
  activeThread = { id: 'broadcast', name: 'Broadcast', type: 'broadcast' }
  renderSidebarContacts()
  const pane = document.getElementById('chat-thread-pane')
  if (!pane) return
  pane.innerHTML = ''
  pane.appendChild(buildThreadHeader('Broadcast', 'Messages from dispatcher'))
  const msgArea = document.createElement('div')
  msgArea.className = 'chat-messages'
  msgArea.id = 'chat-messages'
  msgArea.innerHTML = '<p class="chat-msg-loading">Loading…</p>'
  pane.appendChild(msgArea)
  try {
    const data = await api.get('/chat/broadcast')
    messages = data ?? []
    renderMessages(msgArea)
    messages.forEach(m => { if (!m.read_at) api.post(`/chat/${m.id}/mark-read`).catch(() => {}) })
  } catch (err) { msgArea.innerHTML = '<p class="chat-msg-loading">Could not load messages.</p>' }
}

async function openThread (contact) {
  activeThread = { id: contact.id, name: contact.name, type: 'direct' }
  renderSidebarContacts()
  const pane = document.getElementById('chat-thread-pane')
  if (!pane) return
  pane.innerHTML = ''
  pane.appendChild(buildThreadHeader(contact.name, contact.role ?? 'Technician'))
  const msgArea = document.createElement('div')
  msgArea.className = 'chat-messages'
  msgArea.id = 'chat-messages'
  msgArea.innerHTML = '<p class="chat-msg-loading">Loading…</p>'
  pane.appendChild(msgArea)
  pane.appendChild(buildComposer(contact.id))
  try {
    const data = await api.get(`/chat/direct/${contact.id}`)
    messages = data ?? []
    renderMessages(msgArea)
    messages.forEach(m => { if (!m.read_at) api.post(`/chat/${m.id}/mark-read`).catch(() => {}) })
    msgArea.scrollTop = msgArea.scrollHeight
  } catch (err) { msgArea.innerHTML = '<p class="chat-msg-loading">Could not load messages.</p>' }
}

function buildThreadHeader (name, sub) {
  const header = document.createElement('div')
  header.className = 'chat-thread-header'
  header.innerHTML = `<p class="chat-thread-name">${name}</p><p class="chat-thread-sub">${sub}</p>`
  return header
}

function buildComposer (contactId) {
  const wrap = document.createElement('div')
  wrap.className = 'chat-composer'
  const input = document.createElement('textarea')
  input.className = 'chat-input'
  input.placeholder = 'Message…'
  input.rows = 1
  input.addEventListener('input', () => { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 120) + 'px' })
  input.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(contactId, input) } })
  const sendBtn = document.createElement('button')
  sendBtn.className = 'chat-send-btn'
  sendBtn.textContent = '↑'
  sendBtn.addEventListener('click', () => sendMessage(contactId, input))
  wrap.appendChild(input)
  wrap.appendChild(sendBtn)
  return wrap
}

async function sendMessage (contactId, input) {
  const text = input.value.trim()
  if (!text) return
  input.value = ''
  input.style.height = 'auto'
  const optimistic = { id: Date.now(), body: text, sent_by_me: true, created_at: new Date().toISOString() }
  messages.push(optimistic)
  const msgArea = document.getElementById('chat-messages')
  if (msgArea) { renderMessages(msgArea); msgArea.scrollTop = msgArea.scrollHeight }
  try { await api.post(`/chat/direct/${contactId}`, { body: text }) }
  catch (err) { console.error('send failed:', err) }
}

function renderMessages (container) {
  container.innerHTML = ''
  if (!messages.length) { container.innerHTML = '<p class="chat-msg-loading">No messages yet.</p>'; return }
  messages.forEach(msg => {
    const bubble = document.createElement('div')
    bubble.className = `chat-bubble ${msg.sent_by_me ? 'chat-bubble--mine' : 'chat-bubble--theirs'}`
    bubble.textContent = msg.body
    const time = document.createElement('span')
    time.className = 'chat-bubble-time'
    time.textContent = formatTime(msg.created_at)
    bubble.appendChild(time)
    container.appendChild(bubble)
  })
}

function onSyncUpdate (e) {
  const { newMessages } = e.detail ?? {}
  if (newMessages?.length && activeThread) {
    const relevant = newMessages.filter(m =>
      activeThread.type === 'broadcast' ? m.channel === 'broadcast'
      : m.sender_id === activeThread.id || m.recipient_id === activeThread.id
    )
    if (relevant.length) {
      messages = [...messages, ...relevant]
      const msgArea = document.getElementById('chat-messages')
      if (msgArea) { renderMessages(msgArea); msgArea.scrollTop = msgArea.scrollHeight }
    }
  }
}

function buildHeader () {
  const header = document.createElement('div')
  header.className = 'screen-header'
  const title = document.createElement('h1')
  title.className = 'screen-title'
  title.textContent = 'Chat'
  header.appendChild(title)
  return header
}

function formatTime (iso) {
  if (!iso) return ''
  try { return new Date(iso).toLocaleTimeString('en-US', { hour:'numeric', minute:'2-digit', hour12:true }) }
  catch (_) { return '' }
}

const screenStyles = `
  .chat-screen { display:flex; flex-direction:column; height:100dvh; background:var(--surface-base); overflow:hidden; }
  .screen-header { display:flex; justify-content:space-between; align-items:center; padding:calc(var(--space-5) + env(safe-area-inset-top,0px)) var(--space-5) var(--space-3); background:var(--surface-1); border-bottom:0.5px solid var(--border-subtle); flex-shrink:0; }
  .screen-title { font-size:var(--text-lg); font-weight:500; color:var(--text-primary); letter-spacing:-0.01em; }
  .chat-body { flex:1; display:flex; overflow:hidden; }
  .chat-sidebar { width:200px; flex-shrink:0; border-right:0.5px solid var(--border-subtle); overflow-y:auto; background:var(--surface-1); display:flex; flex-direction:column; }
  .chat-contact-row { display:flex; align-items:center; gap:var(--space-3); padding:var(--space-3) var(--space-4); background:none; border:none; cursor:pointer; width:100%; text-align:left; -webkit-tap-highlight-color:transparent; }
  .chat-contact-row--active { background:var(--signal-tint); }
  .chat-avatar { width:34px; height:34px; border-radius:50%; background:var(--surface-3); display:flex; align-items:center; justify-content:center; font-size:13px; font-weight:600; color:var(--text-primary); flex-shrink:0; }
  .chat-avatar--broadcast { background:var(--signal-tint); }
  .chat-contact-info { min-width:0; }
  .chat-contact-name { font-size:var(--text-sm); font-weight:500; color:var(--text-primary); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .chat-contact-sub { font-size:var(--text-xs); color:var(--text-muted); }
  .chat-divider { height:0.5px; background:var(--border-subtle); }
  .chat-sidebar-empty { font-size:var(--text-sm); color:var(--text-disabled); padding:var(--space-4); }
  .chat-thread-pane { flex:1; display:flex; flex-direction:column; overflow:hidden; }
  .chat-empty-thread { font-size:var(--text-sm); color:var(--text-disabled); margin:auto; }
  .chat-thread-header { padding:var(--space-3) var(--space-4); border-bottom:0.5px solid var(--border-subtle); background:var(--surface-1); flex-shrink:0; }
  .chat-thread-name { font-size:var(--text-base); font-weight:500; color:var(--text-primary); }
  .chat-thread-sub { font-size:var(--text-sm); color:var(--text-muted); }
  .chat-messages { flex:1; overflow-y:auto; padding:var(--space-4); display:flex; flex-direction:column; gap:var(--space-2); }
  .chat-msg-loading { font-size:var(--text-sm); color:var(--text-disabled); text-align:center; margin:auto; }
  .chat-bubble { max-width:75%; padding:var(--space-2) var(--space-3); border-radius:var(--radius-lg); font-size:var(--text-base); line-height:1.4; }
  .chat-bubble--mine { background:var(--color-signal); color:#fff; align-self:flex-end; border-bottom-right-radius:4px; }
  .chat-bubble--theirs { background:var(--surface-2); color:var(--text-primary); align-self:flex-start; border-bottom-left-radius:4px; }
  .chat-bubble-time { display:block; font-size:9px; opacity:0.6; margin-top:3px; text-align:right; }
  .chat-composer { display:flex; align-items:flex-end; gap:var(--space-2); padding:var(--space-3) var(--space-4); padding-bottom:calc(var(--space-3) + env(safe-area-inset-bottom,0px)); border-top:0.5px solid var(--border-subtle); background:var(--surface-1); flex-shrink:0; }
  .chat-input { flex:1; background:var(--surface-2); border:0.5px solid var(--border-default); border-radius:var(--radius-lg); color:var(--text-primary); font-size:var(--text-base); font-family:var(--font-sans); padding:var(--space-2) var(--space-3); outline:none; resize:none; line-height:1.4; max-height:120px; overflow-y:auto; }
  .chat-input:focus { border-color:var(--color-signal); }
  .chat-send-btn { width:36px; height:36px; border-radius:50%; background:var(--color-signal); border:none; color:#fff; font-size:18px; cursor:pointer; display:flex; align-items:center; justify-content:center; flex-shrink:0; }
`
