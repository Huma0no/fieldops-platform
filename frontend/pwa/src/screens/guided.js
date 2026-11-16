/**
 * src/screens/guided.js
 * FieldOps host for the Guided module (frontend/guided). Resolves the active
 * call (last expanded My Calls card or open Workspace), otherwise offers a
 * picker of the technician's open calls plus "None" (manual setup).
 */

import { api }                  from '../../../shared/api.js'
import { t }                    from '../../../shared/i18n.js'
import { NavBar, navBarStyles } from '../components/nav-bar.js'
import { getCachedMyCallsVisits, getLocalVisitDraft } from '../lib/db.js'
import {
  GUIDED_RETURN_KEY, guidedContextFromVisit, pickableCalls, readGuidedContext, saveGuidedContext,
} from '../lib/guided-context.mjs'

const STYLES_ID = 'styles-guided-screen'

function injectStyles () {
  if (document.getElementById(STYLES_ID)) return
  const style = document.createElement('style')
  style.id = STYLES_ID
  style.textContent = navBarStyles + screenStyles
  document.head.appendChild(style)
}

const navigate = route => window.dispatchEvent(new CustomEvent('app:navigate', { detail: { route } }))

export default async function mount (appEl) {
  injectStyles()
  // Opened from Workspace's floating button: no bar, a way back instead.
  const returnRoute = sessionStorage.getItem(GUIDED_RETURN_KEY)
  sessionStorage.removeItem(GUIDED_RETURN_KEY)

  appEl.innerHTML = ''
  const screen = document.createElement('div')
  screen.className = 'gs-screen'
  const top = document.createElement('div')
  top.className = 'gs-top'
  const body = document.createElement('div')
  body.className = 'gs-body'
  screen.append(top, body)
  if (!returnRoute) screen.appendChild(NavBar({ active: 'guided', onNavigate: navigate }))
  appEl.appendChild(screen)

  const context = readGuidedContext(localStorage)
  if (context) showModule(context)
  else showPicker()

  function renderTop (context) {
    top.innerHTML = ''
    if (returnRoute) {
      const back = button('gs-link', `‹ ${t('guided.backToWorkspace')}`)
      back.addEventListener('click', () => navigate(returnRoute))
      top.appendChild(back)
    }
    if (context) {
      const label = document.createElement('span')
      label.className = 'gs-call'
      label.textContent = t('guided.call', { label: context.label })
      const change = button('gs-link', t('guided.call.change'))
      change.addEventListener('click', showPicker)
      top.append(label, change)
    }
    top.hidden = !top.childElementCount
  }

  async function showModule (context) {
    renderTop(context)
    body.innerHTML = ''
    const root = document.createElement('div')
    root.className = 'gs-module'
    body.appendChild(root)
    const { mount: mountGuided } = await import('../../guided/guided.js')
    await mountGuided(root, { context })
  }

  async function showPicker () {
    renderTop(null)
    body.innerHTML = ''
    const wrap = document.createElement('div')
    wrap.className = 'gs-picker'
    const heading = document.createElement('h1')
    heading.className = 'gs-heading'
    heading.textContent = t('guided.call.pick')
    const message = document.createElement('p')
    message.className = 'gs-note'
    wrap.append(heading, message)
    body.appendChild(wrap)

    const calls = pickableCalls(await getCachedMyCallsVisits().catch(() => []))
    if (!calls.length) message.textContent = t('guided.call.empty')
    for (const call of calls) {
      const option = button('gs-option', call.label)
      option.addEventListener('click', async () => {
        const detail = await api.get(`/visits/${call.id}`).catch(() => getLocalVisitDraft(call.id).catch(() => null))
        const context = guidedContextFromVisit(detail)
        if (!context) { message.textContent = t('guided.call.offline'); return }
        saveGuidedContext(localStorage, context)
        showModule(context)
      })
      wrap.appendChild(option)
    }
    const none = button('gs-option gs-option--none', t('guided.call.none'))
    none.addEventListener('click', () => showModule(null))
    wrap.appendChild(none)
  }
}

function button (className, text) {
  const el = document.createElement('button')
  el.type = 'button'
  el.className = className
  el.textContent = text
  return el
}

const screenStyles = `
  .gs-screen { display:flex; flex-direction:column; height:100%; background:var(--fo-panel); font-family:var(--fo-font-body); }
  .gs-top { display:flex; align-items:center; gap:var(--space-2); padding:calc(var(--space-2) + env(safe-area-inset-top,0px)) var(--space-3) var(--space-1); flex-shrink:0; }
  .gs-top[hidden] { display:none; }
  .gs-call { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-family:var(--fo-font-mono); font-size:12px; font-weight:700; color:var(--fo-ink-soft); }
  .gs-link { min-height:44px; padding:0 var(--space-2); border:none; background:none; color:var(--fo-accent-deep); font-family:var(--fo-font-mono); font-size:12px; font-weight:700; cursor:pointer; }
  .gs-body { flex:1; min-height:0; display:flex; flex-direction:column; }
  .gs-module { flex:1; min-height:0; }
  .gs-picker { flex:1; overflow-y:auto; padding:calc(var(--space-5) + env(safe-area-inset-top,0px)) var(--space-4) var(--space-4); display:flex; flex-direction:column; gap:var(--space-3); }
  .gs-heading { font-size:18px; font-weight:800; color:var(--fo-ink); }
  .gs-note { font-size:13px; color:var(--fo-ink-soft); }
  .gs-note:empty { display:none; }
  .gs-option { min-height:48px; padding:var(--space-3) var(--space-4); border:none; border-radius:var(--fo-radius-md); background:var(--fo-panel); box-shadow:var(--fo-shadow-raised); color:var(--fo-ink); font-family:var(--fo-font-body); font-size:15px; font-weight:700; text-align:left; cursor:pointer; }
  .gs-option--none { color:var(--fo-ink-soft); }
`
