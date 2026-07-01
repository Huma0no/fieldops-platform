/**
 * src/screens/settings.js
 * F10 — Technician settings: theme, AI provider config, inventory view, pay link.
 */

import { api }                  from '../../../shared/api.js'
import { NavBar, navBarStyles } from '../components/nav-bar.js'

const STYLES_ID = 'styles-settings'

function injectStyles () {
  if (document.getElementById(STYLES_ID)) return
  const style = document.createElement('style')
  style.id = STYLES_ID
  style.textContent = navBarStyles + screenStyles
  document.head.appendChild(style)
}

export default async function mount (appEl) {
  injectStyles()
  appEl.innerHTML = ''

  const screen = document.createElement('div')
  screen.className = 'screen'

  const header = document.createElement('div')
  header.className = 'screen-header'
  const title = document.createElement('h1')
  title.className = 'screen-title'
  title.textContent = 'Settings'
  header.appendChild(title)
  screen.appendChild(header)

  const scrollArea = document.createElement('div')
  scrollArea.className = 'scroll-area'
  screen.appendChild(scrollArea)

  screen.appendChild(NavBar({
    active: 'settings',
    onNavigate: route => window.dispatchEvent(new CustomEvent('app:navigate', { detail: { route } })),
  }))

  appEl.appendChild(screen)

  let settings = {}
  try {
    settings = await api.get('/technicians/me/settings') ?? {}
  } catch (err) {
    console.error('Settings load failed:', err)
  }

  renderSettings(scrollArea, settings)
}

function renderSettings (container, settings) {
  container.innerHTML = ''

  const inner = document.createElement('div')
  inner.className = 'st-inner'
  container.appendChild(inner)

  inner.appendChild(buildSection('Appearance', buildThemeSection(settings.theme ?? 'dark')))
  inner.appendChild(buildSection('AI Assistant', buildAISection(settings)))

  const invSection = buildSection('My Inventory', buildLoadingEl())
  inner.appendChild(invSection)
  loadInventory(invSection.querySelector('.st-section-body'))

  inner.appendChild(buildSection('Pay', buildPayLink()))
}

// ── Layout helper ──────────────────────────────────────────

function buildSection (title, body) {
  const wrap = document.createElement('div')
  wrap.className = 'st-section'

  const heading = document.createElement('p')
  heading.className = 'st-section-title'
  heading.textContent = title
  wrap.appendChild(heading)

  const bodyEl = document.createElement('div')
  bodyEl.className = 'st-section-body'
  bodyEl.appendChild(body)
  wrap.appendChild(bodyEl)

  return wrap
}

function buildLoadingEl () {
  const p = document.createElement('p')
  p.className = 'st-muted'
  p.textContent = 'Loading…'
  return p
}

// ── Theme ──────────────────────────────────────────────────

function buildThemeSection (currentTheme) {
  const row = document.createElement('div')
  row.className = 'st-row'

  const label = document.createElement('span')
  label.className = 'st-row-label'
  label.textContent = 'Theme'
  row.appendChild(label)

  const toggle = document.createElement('div')
  toggle.className = 'st-theme-toggle'

  ;[{ value: 'dark', label: 'Dark' }, { value: 'light', label: 'Light' }].forEach(({ value, label: lbl }) => {
    const btn = document.createElement('button')
    btn.className = `st-theme-btn ${currentTheme === value ? 'st-theme-btn--active' : ''}`
    btn.textContent = lbl
    btn.addEventListener('click', async () => {
      if (btn.classList.contains('st-theme-btn--active')) return
      toggle.querySelectorAll('.st-theme-btn').forEach(b => b.classList.remove('st-theme-btn--active'))
      btn.classList.add('st-theme-btn--active')
      try {
        await api.patch('/technicians/me/settings', { theme: value })
        document.documentElement.setAttribute('data-theme', value)
      } catch (err) { console.error('Theme save failed:', err) }
    })
    toggle.appendChild(btn)
  })

  row.appendChild(toggle)
  return row
}

// ── AI Provider ────────────────────────────────────────────

const AI_PROVIDERS = [
  { value: 'anthropic', label: 'Anthropic', keyField: 'aiApiKeyAnthropic', hasKeyField: 'hasKeyAnthropic' },
  { value: 'openai',    label: 'OpenAI',    keyField: 'aiApiKeyOpenai',    hasKeyField: 'hasKeyOpenai' },
  { value: 'google',    label: 'Google',    keyField: 'aiApiKeyGoogle',    hasKeyField: 'hasKeyGoogle' },
]

function buildAISection (settings) {
  let activeProvider = settings.aiProvider ?? 'anthropic'
  const localHasKey  = { ...settings }   // mutable copy for optimistic UI

  const wrap = document.createElement('div')
  wrap.className = 'st-ai-wrap'

  const selector = document.createElement('div')
  selector.className = 'st-ai-selector'

  const keyPanel = document.createElement('div')
  keyPanel.className = 'st-ai-panel'

  AI_PROVIDERS.forEach(p => {
    const btn = document.createElement('button')
    btn.className = `st-ai-tab ${activeProvider === p.value ? 'st-ai-tab--active' : ''}`
    btn.textContent = p.label
    btn.addEventListener('click', async () => {
      if (activeProvider === p.value) return
      activeProvider = p.value
      selector.querySelectorAll('.st-ai-tab').forEach(b => b.classList.remove('st-ai-tab--active'))
      btn.classList.add('st-ai-tab--active')
      renderKeyPanel(keyPanel, activeProvider, localHasKey)
      try {
        await api.patch('/technicians/me/settings', { aiProvider: p.value })
      } catch (err) { console.error('AI provider save failed:', err) }
    })
    selector.appendChild(btn)
  })

  wrap.appendChild(selector)
  renderKeyPanel(keyPanel, activeProvider, localHasKey)
  wrap.appendChild(keyPanel)

  return wrap
}

function renderKeyPanel (panel, providerValue, hasKeyState) {
  panel.innerHTML = ''
  const meta = AI_PROVIDERS.find(p => p.value === providerValue)
  if (!meta) return

  const hasKey = hasKeyState[meta.hasKeyField] === true

  const status = document.createElement('p')
  status.className = `st-key-status ${hasKey ? 'st-key-status--saved' : ''}`
  status.textContent = hasKey ? 'Key saved' : 'No key saved'
  panel.appendChild(status)

  const inputRow = document.createElement('div')
  inputRow.className = 'st-key-row'

  const input = document.createElement('input')
  input.type = 'password'
  input.className = 'st-key-input'
  input.placeholder = `Paste ${meta.label} API key`
  input.autocomplete = 'off'

  const saveBtn = document.createElement('button')
  saveBtn.className = 'st-key-save-btn'
  saveBtn.textContent = 'Save'
  saveBtn.addEventListener('click', async () => {
    const key = input.value.trim()
    if (!key) return
    saveBtn.disabled = true
    saveBtn.textContent = 'Saving…'
    try {
      await api.patch('/technicians/me/settings', { [meta.keyField]: key })
      hasKeyState[meta.hasKeyField] = true
      input.value = ''
      status.textContent = 'Key saved'
      status.className = 'st-key-status st-key-status--saved'
    } catch (err) {
      console.error('Key save failed:', err)
    } finally {
      saveBtn.disabled = false
      saveBtn.textContent = 'Save'
    }
  })

  inputRow.appendChild(input)
  inputRow.appendChild(saveBtn)
  panel.appendChild(inputRow)
}

// ── Inventory ──────────────────────────────────────────────

async function loadInventory (sectionBody) {
  try {
    const data = await api.get('/inventory/mine')
    sectionBody.innerHTML = ''

    if (!data?.length) {
      const p = document.createElement('p')
      p.className = 'st-muted'
      p.textContent = 'No inventory data for current period.'
      sectionBody.appendChild(p)
      return
    }

    const table = document.createElement('table')
    table.className = 'st-table'

    const thead = document.createElement('thead')
    thead.innerHTML = '<tr>' +
      ['Item', 'Assigned', 'Consumed', 'Balance'].map(h =>
        `<th class="st-th">${h}</th>`
      ).join('') +
      '</tr>'
    table.appendChild(thead)

    const tbody = document.createElement('tbody')
    data.forEach(row => {
      const balance = row.balance ?? (row.quantityAssigned - row.quantityConsumed)
      const low     = balance <= 2
      const tr = document.createElement('tr')
      tr.innerHTML = [
        `<td class="st-td">${row.itemName ?? row.item_name ?? '—'}</td>`,
        `<td class="st-td">${row.quantityAssigned ?? row.quantity_assigned ?? '—'}</td>`,
        `<td class="st-td">${row.quantityConsumed ?? row.quantity_consumed ?? '—'}</td>`,
        `<td class="st-td ${low ? 'st-td--low' : ''}">${balance}${low ? ' ⚠' : ''}</td>`,
      ].join('')
      tbody.appendChild(tr)
    })
    table.appendChild(tbody)
    sectionBody.appendChild(table)
  } catch (err) {
    sectionBody.innerHTML = '<p class="st-muted">Could not load inventory.</p>'
    console.error('Inventory load failed:', err)
  }
}

// ── Pay link ───────────────────────────────────────────────

function buildPayLink () {
  const btn = document.createElement('button')
  btn.className = 'st-pay-link'
  btn.textContent = 'View Pay Periods →'
  btn.addEventListener('click', () =>
    window.dispatchEvent(new CustomEvent('app:navigate', { detail: { route: '/pay' } }))
  )
  return btn
}

// ── Styles ─────────────────────────────────────────────────

const screenStyles = `
  .screen { display:flex; flex-direction:column; height:100dvh; background:var(--surface-base); overflow:hidden; }
  .screen-header { display:flex; align-items:center; padding:calc(var(--space-5) + env(safe-area-inset-top,0px)) var(--space-5) var(--space-3); background:var(--surface-1); border-bottom:0.5px solid var(--border-subtle); flex-shrink:0; }
  .screen-title { font-size:var(--text-lg); font-weight:500; color:var(--text-primary); letter-spacing:-0.01em; }
  .scroll-area { flex:1; overflow-y:auto; -webkit-overflow-scrolling:touch; overscroll-behavior:contain; }

  .st-inner { padding:var(--space-5) var(--space-5) var(--space-10); display:flex; flex-direction:column; gap:var(--space-5); }
  .st-section { display:flex; flex-direction:column; gap:var(--space-2); }
  .st-section-title { font-size:var(--text-xs); font-weight:500; color:var(--text-disabled); text-transform:uppercase; letter-spacing:0.05em; }
  .st-section-body { background:var(--surface-1); border-radius:var(--radius-lg); border:0.5px solid var(--border-subtle); overflow:hidden; }

  .st-row { display:flex; justify-content:space-between; align-items:center; padding:var(--space-3) var(--space-4); }
  .st-row-label { font-size:var(--text-base); color:var(--text-primary); }

  .st-theme-toggle { display:flex; gap:3px; background:var(--surface-2); padding:3px; border-radius:var(--radius-md); }
  .st-theme-btn { background:none; border:none; border-radius:var(--radius-sm); padding:4px 14px; font-size:var(--text-sm); color:var(--text-muted); cursor:pointer; transition:background 120ms,color 120ms; font-family:var(--font-sans); }
  .st-theme-btn--active { background:var(--surface-1); color:var(--text-primary); box-shadow:0 1px 3px rgba(0,0,0,.25); }

  .st-ai-wrap { display:flex; flex-direction:column; }
  .st-ai-selector { display:flex; border-bottom:0.5px solid var(--border-subtle); }
  .st-ai-tab { flex:1; background:none; border:none; border-bottom:2px solid transparent; padding:var(--space-3); font-size:var(--text-sm); color:var(--text-muted); cursor:pointer; font-family:var(--font-sans); transition:color 100ms; }
  .st-ai-tab--active { color:var(--color-signal); border-bottom-color:var(--color-signal); }
  .st-ai-panel { padding:var(--space-4); display:flex; flex-direction:column; gap:var(--space-3); }
  .st-key-status { font-size:var(--text-sm); color:var(--text-muted); }
  .st-key-status--saved { color:#22C55E; }
  .st-key-row { display:flex; gap:var(--space-2); }
  .st-key-input { flex:1; background:var(--surface-2); border:0.5px solid var(--border-default); border-radius:var(--radius-md); color:var(--text-primary); font-size:var(--text-sm); padding:var(--space-2) var(--space-3); outline:none; font-family:var(--font-mono); letter-spacing:0.02em; }
  .st-key-input:focus { border-color:var(--color-signal); }
  .st-key-save-btn { background:var(--color-signal); color:#fff; border:none; border-radius:var(--radius-md); font-size:var(--text-sm); font-weight:500; padding:var(--space-2) var(--space-4); cursor:pointer; flex-shrink:0; font-family:var(--font-sans); }
  .st-key-save-btn:disabled { opacity:0.6; cursor:not-allowed; }

  .st-table { width:100%; border-collapse:collapse; font-size:var(--text-sm); }
  .st-th { text-align:left; padding:var(--space-2) var(--space-4); font-size:var(--text-xs); color:var(--text-disabled); font-weight:500; text-transform:uppercase; letter-spacing:0.04em; border-bottom:0.5px solid var(--border-subtle); }
  .st-td { padding:var(--space-2) var(--space-4); color:var(--text-secondary); border-bottom:0.5px solid var(--border-subtle); }
  .st-td--low { color:var(--color-plasma); font-weight:500; }
  .st-muted { padding:var(--space-4); font-size:var(--text-sm); color:var(--text-muted); }

  .st-pay-link { display:block; width:100%; background:none; border:none; text-align:left; padding:var(--space-4); font-size:var(--text-base); color:var(--color-signal); cursor:pointer; font-family:var(--font-sans); -webkit-tap-highlight-color:transparent; }
`
