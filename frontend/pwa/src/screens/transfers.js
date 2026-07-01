/**
 * src/screens/transfers.js
 * F9 — Transfer Visit flow for PWA.
 * Accessible from the ··· menu in the Job Card.
 * Technician selects a visit from their assigned list,
 * picks a recipient technician, adds a reason, and submits.
 */

import { api }                  from '../../../shared/api.js'
import { NavBar, navBarStyles } from '../components/nav-bar.js'

const STYLES_ID = 'styles-transfers'

function injectStyles () {
  if (document.getElementById(STYLES_ID)) return
  const style = document.createElement('style')
  style.id = STYLES_ID
  style.textContent = navBarStyles + screenStyles
  document.head.appendChild(style)
}

export default async function mount (appEl, { preselectedVisitId } = {}) {
  injectStyles()
  appEl.innerHTML = ''

  const screen = document.createElement('div')
  screen.className = 'screen'

  // Header
  const header = document.createElement('div')
  header.className = 'screen-header'
  const back = document.createElement('button')
  back.className = 'tr-back-btn'
  back.textContent = '←'
  back.addEventListener('click', () =>
    window.dispatchEvent(new CustomEvent('app:navigate', { detail: { route: '/' } }))
  )
  const title = document.createElement('h1')
  title.className = 'screen-title'
  title.textContent = 'Transfer Visit'
  header.appendChild(back)
  header.appendChild(title)
  screen.appendChild(header)

  const body = document.createElement('div')
  body.className = 'scroll-area'
  body.id = 'transfer-body'
  body.style.padding = 'var(--space-4)'
  screen.appendChild(body)

  screen.appendChild(NavBar({
    active: 'my-calls',
    onNavigate: route => window.dispatchEvent(new CustomEvent('app:navigate', { detail: { route } })),
  }))

  appEl.appendChild(screen)

  await buildTransferForm(body, preselectedVisitId)
}

async function buildTransferForm (container, preselectedVisitId) {
  container.innerHTML = '<p style="color:var(--text-muted);font-size:var(--text-sm)">Loading…</p>'

  try {
    const [myVisits, technicians] = await Promise.all([
      api.get('/visits/mine'),
      api.get('/dispatch/technicians?activeOnly=true'),
    ])

    const assignable = (myVisits ?? []).filter(v =>
      ['assigned', 'in_progress'].includes(v.status)
    )

    container.innerHTML = ''

    if (!assignable.length) {
      container.innerHTML = `<p class="tr-empty">No visits available to transfer.</p>`
      return
    }

    // Step 1 — select visit
    const visitSection = document.createElement('div')
    visitSection.className = 'tr-section'

    const visitLabel = document.createElement('p')
    visitLabel.className = 'tr-label'
    visitLabel.textContent = 'Select visit'
    visitSection.appendChild(visitLabel)

    let selectedVisit = preselectedVisitId
      ? assignable.find(v => v.id === preselectedVisitId)
      : null

    const visitBtns = document.createElement('div')
    visitBtns.className = 'tr-visit-list'

    assignable.forEach(visit => {
      const btn = document.createElement('button')
      btn.className = `tr-visit-btn ${selectedVisit?.id === visit.id ? 'tr-visit-btn--active' : ''}`
      btn.dataset.visitId = visit.id
      btn.innerHTML = `
        <p class="tr-visit-addr">${visit.address?.street ?? '—'}</p>
        <p class="tr-visit-meta">${visit.builder ?? ''} · ${formatWorkType(visit.work_type)}</p>
      `
      btn.addEventListener('click', () => {
        selectedVisit = visit
        visitBtns.querySelectorAll('.tr-visit-btn').forEach(b =>
          b.classList.toggle('tr-visit-btn--active', b.dataset.visitId === visit.id)
        )
      })
      visitBtns.appendChild(btn)
    })

    visitSection.appendChild(visitBtns)
    container.appendChild(visitSection)

    // Step 2 — select recipient
    const techSection = document.createElement('div')
    techSection.className = 'tr-section'

    const techLabel = document.createElement('p')
    techLabel.className = 'tr-label'
    techLabel.textContent = 'Transfer to'
    techSection.appendChild(techLabel)

    let selectedTech = null

    const techBtns = document.createElement('div')
    techBtns.className = 'tr-visit-list'

    const myId = JSON.parse(localStorage.getItem('technician') ?? '{}').id

    ;(technicians ?? [])
      .filter(t => t.id !== myId)
      .forEach(tech => {
        const btn = document.createElement('button')
        btn.className = 'tr-visit-btn'
        btn.dataset.techId = tech.id
        btn.innerHTML = `<p class="tr-visit-addr">${tech.name}</p><p class="tr-visit-meta">${tech.role ?? 'Technician'}</p>`
        btn.addEventListener('click', () => {
          selectedTech = tech
          techBtns.querySelectorAll('.tr-visit-btn').forEach(b =>
            b.classList.toggle('tr-visit-btn--active', b.dataset.techId === tech.id)
          )
        })
        techBtns.appendChild(btn)
      })

    if (!techBtns.children.length) {
      const noTech = document.createElement('p')
      noTech.className = 'tr-empty'
      noTech.textContent = 'No other technicians available.'
      techSection.appendChild(noTech)
    } else {
      techSection.appendChild(techBtns)
    }

    container.appendChild(techSection)

    // Step 3 — reason
    const reasonSection = document.createElement('div')
    reasonSection.className = 'tr-section'

    const reasonLabel = document.createElement('p')
    reasonLabel.className = 'tr-label'
    reasonLabel.textContent = 'Reason (optional)'
    reasonSection.appendChild(reasonLabel)

    const reasonInput = document.createElement('textarea')
    reasonInput.className = 'tr-reason'
    reasonInput.placeholder = 'Why are you transferring this visit?'
    reasonInput.rows = 3
    reasonSection.appendChild(reasonInput)
    container.appendChild(reasonSection)

    // Error + submit
    const errorEl = document.createElement('p')
    errorEl.className = 'tr-error'
    container.appendChild(errorEl)

    const submitBtn = document.createElement('button')
    submitBtn.className = 'tr-submit-btn'
    submitBtn.textContent = 'Request transfer'
    submitBtn.addEventListener('click', async () => {
      if (!selectedVisit) { errorEl.textContent = 'Select a visit.'; return }
      if (!selectedTech)  { errorEl.textContent = 'Select a recipient.'; return }
      submitBtn.disabled    = true
      submitBtn.textContent = 'Sending…'
      errorEl.textContent   = ''
      try {
        await api.post(`/visits/${selectedVisit.id}/transfer/initiate`, {
          recipientId: selectedTech.id,
          reason: reasonInput.value.trim() || null,
        })
        container.innerHTML = `
          <div class="tr-success">
            <p style="font-size:32px">✓</p>
            <p class="tr-success-title">Transfer requested</p>
            <p class="tr-success-sub">${selectedTech.name} will be notified.</p>
          </div>
        `
        setTimeout(() =>
          window.dispatchEvent(new CustomEvent('app:navigate', { detail: { route: '/' } }))
        , 2000)
      } catch (err) {
        submitBtn.disabled    = false
        submitBtn.textContent = 'Request transfer'
        errorEl.textContent   = 'Transfer failed. Try again.'
        console.error('transfer failed:', err)
      }
    })

    container.appendChild(submitBtn)

  } catch (err) {
    container.innerHTML = `<p class="tr-empty">Could not load data.</p>`
    console.error('transfer form failed:', err)
  }
}

function formatWorkType (type) {
  const map = { ac_startup:'AC Startup', heat_startup:'Heat Startup', ac_heat:'AC & Heat', prestart:'Prestart', drive_run:'Drive Run' }
  return map[type] ?? type ?? '—'
}

const screenStyles = `
  .screen { display:flex; flex-direction:column; height:100dvh; background:var(--surface-base); overflow:hidden; }
  .screen-header { display:flex; align-items:center; gap:var(--space-3); padding:calc(var(--space-5) + env(safe-area-inset-top,0px)) var(--space-5) var(--space-3); background:var(--surface-1); border-bottom:0.5px solid var(--border-subtle); flex-shrink:0; }
  .screen-title { font-size:var(--text-lg); font-weight:500; color:var(--text-primary); letter-spacing:-0.01em; }
  .scroll-area { flex:1; overflow-y:auto; -webkit-overflow-scrolling:touch; overscroll-behavior:contain; }

  .tr-back-btn { background:none; border:none; color:var(--text-muted); font-size:20px; cursor:pointer; padding:var(--space-2); line-height:1; -webkit-tap-highlight-color:transparent; }

  .tr-section { margin-bottom:var(--space-5); display:flex; flex-direction:column; gap:var(--space-2); }
  .tr-label { font-size:var(--text-sm); font-weight:500; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.04em; }

  .tr-visit-list { display:flex; flex-direction:column; gap:var(--space-2); }
  .tr-visit-btn { background:var(--surface-1); border:0.5px solid var(--border-subtle); border-radius:var(--radius-md); padding:var(--space-3) var(--space-4); text-align:left; cursor:pointer; -webkit-tap-highlight-color:transparent; }
  .tr-visit-btn--active { border-color:var(--color-signal); background:var(--signal-tint); }
  .tr-visit-addr { font-size:var(--text-base); font-weight:500; color:var(--text-primary); }
  .tr-visit-meta { font-size:var(--text-sm); color:var(--text-muted); margin-top:2px; }

  .tr-reason { width:100%; background:var(--surface-2); border:0.5px solid var(--border-default); border-radius:var(--radius-md); color:var(--text-primary); font-size:var(--text-base); font-family:var(--font-sans); padding:var(--space-3); resize:none; outline:none; line-height:1.5; }
  .tr-reason:focus { border-color:var(--color-signal); }

  .tr-error { font-size:var(--text-sm); color:var(--color-heat); min-height:18px; }
  .tr-submit-btn { width:100%; background:var(--color-signal); color:#fff; border:none; border-radius:var(--radius-md); font-size:var(--text-base); font-weight:500; padding:var(--space-4); cursor:pointer; -webkit-tap-highlight-color:transparent; margin-top:var(--space-2); }
  .tr-submit-btn:disabled { opacity:0.6; cursor:not-allowed; }

  .tr-empty { font-size:var(--text-sm); color:var(--text-muted); }
  .tr-success { display:flex; flex-direction:column; align-items:center; gap:var(--space-3); padding:var(--space-8) 0; text-align:center; }
  .tr-success-title { font-size:var(--text-md); font-weight:500; color:var(--text-primary); }
  .tr-success-sub   { font-size:var(--text-sm); color:var(--text-muted); }
`
