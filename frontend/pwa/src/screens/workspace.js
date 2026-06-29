/**
 * src/screens/workspace.js
 * Workspace — core field execution screen.
 *
 * Architecture:
 *   - Full-screen, no NavBar
 *   - Progress bar (7 segments) + vertical accordion sections
 *   - Each section: trigger row [icon + name] [Speak btn] + expandable content
 *   - Price summary sticky at bottom
 *   - Sections: Service → Thermostat → Accessories → Fixes → Weigh-in → Notes → Checklist
 *
 * Exported as default(appEl) per app.js routing contract.
 * Reads visitId from sessionStorage key 'workspace:visitId' (set by job-card.js).
 */

import { api }        from '../../../shared/api.js'
import { getCatalog } from '../lib/db.js'

const SECTIONS = [
  { id: 'service',     label: 'Service',    icon: '⚡' },
  { id: 'thermostat',  label: 'Thermostat', icon: '🌡' },
  { id: 'accessories', label: 'Acc',        icon: '🔧' },
  { id: 'fixes',       label: 'Fixes',      icon: '🔩' },
  { id: 'weighin',     label: 'Weigh-in',   icon: '⚖️' },
  { id: 'notes',       label: 'Notes',      icon: '📝' },
  { id: 'checklist',   label: 'Checklist',  icon: '✅' },
]

let visit         = null
let catalogItems  = []
let activeSection = 'service'
let completedSections = new Set()

export default async function mount (appEl) {
  injectStyles()
  appEl.innerHTML = ''

  const visitId = sessionStorage.getItem('workspace:visitId')
  if (!visitId) { navigateBack(); return }

  const loading = document.createElement('div')
  loading.className = 'ws-loading'
  loading.textContent = 'Loading…'
  appEl.appendChild(loading)

  try {
    ;[visit, catalogItems] = await Promise.all([
      api.get(`/visits/${visitId}`),
      getCatalog('items').then(d => d ?? []),
    ])
    if (!visit._service) {
      visit._service = { ac: false, heat: false, prestart: false, cancel: false, driveRun: false, finish: false, temporarily: false, twoSystems: false }
    }
    if (!visit._items) visit._items = []
  } catch (err) {
    console.error('Workspace load failed:', err)
    navigateBack()
    return
  }

  appEl.innerHTML = ''
  renderScreen(appEl)
}

function renderScreen (appEl) {
  const screen = document.createElement('div')
  screen.className = 'ws-screen'
  screen.id = 'ws-screen'
  screen.appendChild(buildHeader())
  screen.appendChild(buildProgressBar())
  const body = document.createElement('div')
  body.className = 'ws-body'
  body.id = 'ws-body'
  SECTIONS.forEach(sec => body.appendChild(buildAccordion(sec)))
  screen.appendChild(body)
  screen.appendChild(buildPriceSummary())
  appEl.appendChild(screen)
}

function buildHeader () {
  const el = document.createElement('div')
  el.className = 'ws-header'
  const back = document.createElement('button')
  back.className = 'ws-back-btn'
  back.innerHTML = '←'
  back.setAttribute('aria-label', 'Back')
  back.addEventListener('click', navigateBack)
  const info = document.createElement('div')
  info.className = 'ws-header-info'
  const supra = document.createElement('p')
  supra.className = 'ws-header-supra'
  supra.textContent = 'Workspace'
  const addr = document.createElement('p')
  addr.className = 'ws-header-addr'
  addr.textContent = visit.address?.street ?? '—'
  info.appendChild(supra)
  info.appendChild(addr)
  el.appendChild(back)
  el.appendChild(info)
  return el
}

function buildProgressBar () {
  const wrap = document.createElement('div')
  wrap.className = 'ws-progress-wrap'
  wrap.id = 'ws-progress'
  const bar = document.createElement('div')
  bar.className = 'ws-progress-bar'
  SECTIONS.forEach((sec, i) => {
    const seg = document.createElement('div')
    seg.className = `ws-progress-seg${completedSections.has(sec.id) ? ' ws-progress-seg--done' : ''}`
    seg.dataset.section = sec.id
    bar.appendChild(seg)
    if (i < SECTIONS.length - 1) {
      const gap = document.createElement('div')
      gap.style.width = '3px'
      bar.appendChild(gap)
    }
  })
  const labels = document.createElement('div')
  labels.className = 'ws-progress-labels'
  SECTIONS.forEach(sec => {
    const lbl = document.createElement('span')
    lbl.className = `ws-progress-label${completedSections.has(sec.id) ? ' ws-progress-label--done' : ''}`
    lbl.textContent = sec.label
    lbl.dataset.section = sec.id
    labels.appendChild(lbl)
  })
  wrap.appendChild(bar)
  wrap.appendChild(labels)
  return wrap
}

function updateProgressBar () {
  SECTIONS.forEach(sec => {
    document.querySelector(`.ws-progress-seg[data-section="${sec.id}"]`)
      ?.classList.toggle('ws-progress-seg--done', completedSections.has(sec.id))
    document.querySelector(`.ws-progress-label[data-section="${sec.id}"]`)
      ?.classList.toggle('ws-progress-label--done', completedSections.has(sec.id))
  })
}

function buildAccordion (sec) {
  const isActive    = sec.id === activeSection
  const isCompleted = completedSections.has(sec.id)
  const wrap = document.createElement('div')
  wrap.className = `ws-accordion${isActive ? ' ws-accordion--active' : ''}`
  wrap.id = `acc-${sec.id}`
  const trigger = document.createElement('div')
  trigger.className = 'ws-acc-trigger'
  const tLeft = document.createElement('div')
  tLeft.className = 'ws-acc-trigger-left'
  const icon = document.createElement('span')
  icon.className = 'ws-acc-icon'
  icon.textContent = sec.icon
  const lbl = document.createElement('span')
  lbl.className = 'ws-acc-label'
  lbl.textContent = sec.label
  tLeft.appendChild(icon)
  tLeft.appendChild(lbl)
  const tRight = document.createElement('div')
  tRight.className = 'ws-acc-trigger-right'
  if (isCompleted && !isActive) {
    const summary = document.createElement('span')
    summary.className = 'ws-acc-summary'
    summary.id = `summary-${sec.id}`
    summary.textContent = getSectionSummary(sec.id)
    tRight.appendChild(summary)
  }
  if (isActive) {
    const speakBtn = document.createElement('button')
    speakBtn.className = 'ws-speak-btn'
    speakBtn.textContent = '🎤 Speak'
    speakBtn.addEventListener('click', e => e.stopPropagation())
    tRight.appendChild(speakBtn)
  }
  const chevron = document.createElement('span')
  chevron.className = 'ws-acc-chevron'
  chevron.textContent = '›'
  chevron.style.transform = isActive ? 'rotate(90deg)' : ''
  tRight.appendChild(chevron)
  trigger.appendChild(tLeft)
  trigger.appendChild(tRight)
  trigger.addEventListener('click', () => toggleSection(sec.id))
  wrap.appendChild(trigger)
  const content = document.createElement('div')
  content.className = 'ws-acc-content'
  content.id = `content-${sec.id}`
  if (isActive) content.appendChild(buildSectionContent(sec.id))
  wrap.appendChild(content)
  return wrap
}

function toggleSection (sectionId) {
  if (activeSection === sectionId) return
  const prevAcc = document.getElementById(`acc-${activeSection}`)
  const prevContent = document.getElementById(`content-${activeSection}`)
  if (prevAcc) prevAcc.classList.remove('ws-accordion--active')
  if (prevContent) {
    prevContent.innerHTML = ''
    const tRight = prevAcc?.querySelector('.ws-acc-trigger-right')
    if (tRight) {
      tRight.querySelector('.ws-speak-btn')?.remove()
      if (!tRight.querySelector('.ws-acc-summary')) {
        const summary = document.createElement('span')
        summary.className = 'ws-acc-summary'
        summary.id = `summary-${activeSection}`
        summary.textContent = getSectionSummary(activeSection)
        const chevron = tRight.querySelector('.ws-acc-chevron')
        if (chevron) tRight.insertBefore(summary, chevron)
        else tRight.appendChild(summary)
      }
      const chevron = tRight.querySelector('.ws-acc-chevron')
      if (chevron) chevron.style.transform = ''
    }
  }
  activeSection = sectionId
  const newAcc = document.getElementById(`acc-${sectionId}`)
  const newContent = document.getElementById(`content-${sectionId}`)
  if (newAcc) newAcc.classList.add('ws-accordion--active')
  const newTRight = newAcc?.querySelector('.ws-acc-trigger-right')
  if (newTRight) {
    newTRight.querySelector('.ws-acc-summary')?.remove()
    if (!newTRight.querySelector('.ws-speak-btn')) {
      const speakBtn = document.createElement('button')
      speakBtn.className = 'ws-speak-btn'
      speakBtn.textContent = '🎤 Speak'
      speakBtn.addEventListener('click', e => e.stopPropagation())
      const chevron = newTRight.querySelector('.ws-acc-chevron')
      if (chevron) newTRight.insertBefore(speakBtn, chevron)
      else newTRight.appendChild(speakBtn)
    }
    const chevron = newTRight.querySelector('.ws-acc-chevron')
    if (chevron) chevron.style.transform = 'rotate(90deg)'
  }
  if (newContent) {
    newContent.appendChild(buildSectionContent(sectionId))
    newContent.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }
}

function buildSectionContent (sectionId) {
  switch (sectionId) {
    case 'service':     return buildServiceSection()
    case 'thermostat':  return buildThermostatSection()
    case 'accessories': return buildItemsSection('accessory')
    case 'fixes':       return buildItemsSection('fix')
    case 'weighin':     return buildWeighInSection()
    case 'notes':       return buildNotesSection()
    case 'checklist':   return buildChecklistSection()
    default:            return document.createElement('div')
  }
}

function getSectionSummary (sectionId) {
  switch (sectionId) {
    case 'service': {
      const svc = visit._service
      if (!svc) return '—'
      const parts = []
      if (svc.ac)          parts.push('AC')
      if (svc.heat)        parts.push('Heat')
      if (svc.prestart)    parts.push('Prestart')
      if (svc.cancel)      parts.push('Cancel')
      if (svc.driveRun)    parts.push('Drive Run')
      if (svc.finish)      parts.push('Finish')
      if (svc.temporarily) parts.push('Temporarily')
      if (svc.twoSystems)  parts.push('2 Systems')
      return parts.join(' · ') || '—'
    }
    case 'thermostat': {
      const items = (visit._items ?? []).filter(i => i.category === 'thermostat')
      return items.length ? items.map(i => `${i.item_name} × ${i.quantity}`).join(', ') : '—'
    }
    case 'accessories': {
      const items = (visit._items ?? []).filter(i => i.category === 'accessory')
      if (!items.length) return '—'
      const total = items.reduce((s, i) => s + Number(i.price ?? 0), 0)
      return `$${total.toFixed(0)} · ${items.length} item${items.length !== 1 ? 's' : ''}`
    }
    case 'fixes': {
      const items = (visit._items ?? []).filter(i => i.category === 'fix')
      return items.length ? `${items.length} fix${items.length !== 1 ? 'es' : ''}` : '—'
    }
    case 'weighin':   return visit._weighinDone ? 'Done' : '—'
    case 'notes':     return visit.notes ? visit.notes.slice(0, 30) + (visit.notes.length > 30 ? '…' : '') : '—'
    case 'checklist': return `${visit._photoCount ?? 0} photo${(visit._photoCount ?? 0) !== 1 ? 's' : ''}`
    default:          return '—'
  }
}

function markSectionComplete (sectionId) {
  completedSections.add(sectionId)
  updateProgressBar()
  const idx  = SECTIONS.findIndex(s => s.id === sectionId)
  const next = SECTIONS[idx + 1]
  if (next) toggleSection(next.id)
}

function buildPriceSummary () {
  const el = document.createElement('div')
  el.className = 'ws-price-bar'
  const left = document.createElement('div')
  const lbl = document.createElement('p')
  lbl.className = 'ws-price-label'
  lbl.textContent = 'Total'
  const amount = document.createElement('p')
  amount.className = 'ws-price-amount'
  amount.id = 'ws-price-amount'
  amount.textContent = formatPrice(visit.total_price)
  left.appendChild(lbl)
  left.appendChild(amount)
  const genBtn = document.createElement('button')
  genBtn.className = 'ws-gen-btn'
  genBtn.textContent = 'Generate Report'
  genBtn.addEventListener('click', openGenerateModal)
  el.appendChild(left)
  el.appendChild(genBtn)
  return el
}

function updatePrice (newTotal) {
  const el = document.getElementById('ws-price-amount')
  if (el) el.textContent = formatPrice(newTotal)
  if (visit) visit.total_price = newTotal
}

function formatPrice (val) {
  return `$${Number(val ?? 0).toFixed(2)}`
}

function buildServiceSection () {
  const wrap = document.createElement('div')
  wrap.className = 'ws-section-content'
  const svc = visit._service

  const baseRow = document.createElement('div')
  baseRow.className = 'ws-btn-grid'

  const baseServices = [
    { key: 'ac', label: 'AC' }, { key: 'heat', label: 'Heat' },
    { key: 'prestart', label: 'Prestart' }, { key: 'cancel', label: 'Cancel' },
    { key: 'driveRun', label: 'Drive Run' },
  ]

  baseServices.forEach(({ key, label }) => {
    const btn = document.createElement('button')
    const cls = svc[key] ? (key === 'ac' ? ' ws-item-btn--ac' : key === 'heat' ? ' ws-item-btn--heat' : ' ws-item-btn--active') : ''
    btn.className = `ws-item-btn${cls}`
    btn.textContent = label
    btn.addEventListener('click', async () => {
      if (key === 'cancel' && hasActiveItems()) {
        const ok = await showCancelConfirm()
        if (!ok) return
        await clearAllItems()
      }
      svc[key] = !svc[key]
      if (key === 'cancel' || key === 'driveRun') {
        svc.ac = false; svc.heat = false; svc.prestart = false
        if (key === 'cancel') svc.driveRun = false
        if (key === 'driveRun') svc.cancel = false
      } else if (['ac','heat','prestart'].includes(key)) {
        svc.cancel = false; svc.driveRun = false
      }
      await syncService()
      const content = document.getElementById('content-service')
      if (content) { content.innerHTML = ''; content.appendChild(buildServiceSection()) }
    })
    baseRow.appendChild(btn)
  })
  wrap.appendChild(baseRow)

  if (svc.ac || svc.heat) {
    const modRow = document.createElement('div')
    modRow.className = 'ws-btn-grid ws-btn-grid--modifiers'
    ;[['finish','Finish'],['temporarily','Temporarily'],['twoSystems','2 Systems']].forEach(([key,label]) => {
      const btn = document.createElement('button')
      btn.className = `ws-item-btn ws-btn--modifier${svc[key] ? ' ws-item-btn--active' : ''}`
      btn.textContent = label
      btn.addEventListener('click', async () => {
        svc[key] = !svc[key]
        await syncService()
        const content = document.getElementById('content-service')
        if (content) { content.innerHTML = ''; content.appendChild(buildServiceSection()) }
      })
      modRow.appendChild(btn)
    })
    wrap.appendChild(modRow)
  }

  const hasService = svc.ac || svc.heat || svc.prestart || svc.cancel || svc.driveRun
  if (hasService) {
    const doneBtn = document.createElement('button')
    doneBtn.className = 'ws-done-btn'
    doneBtn.textContent = 'Done'
    doneBtn.addEventListener('click', () => markSectionComplete('service'))
    wrap.appendChild(doneBtn)
  }
  return wrap
}

async function syncService () {
  const svc = visit._service
  let serviceName = null
  if (svc.ac && svc.heat)   serviceName = 'AC & Heat'
  else if (svc.ac)          serviceName = 'AC Startup'
  else if (svc.heat)        serviceName = 'Heat Startup'
  else if (svc.prestart)    serviceName = 'Prestart'
  else if (svc.cancel)      serviceName = 'Cancel'
  else if (svc.driveRun)    serviceName = 'Drive Run'
  try {
    const result = await api.patch(`/visits/${visit.id}/services`, {
      serviceName, isFinish: svc.finish, isTemporarily: svc.temporarily, twoSystems: svc.twoSystems,
    })
    if (result?.total_price !== undefined) updatePrice(result.total_price)
  } catch (err) { console.error('Service sync failed:', err) }
}

function hasActiveItems () { return (visit._items ?? []).length > 0 }

async function clearAllItems () {
  try {
    await api.patch(`/visits/${visit.id}/services`, { serviceName: 'Cancel', confirmed: true })
    visit._items = []
    updatePrice(0)
  } catch (err) { console.error('Clear items failed:', err) }
}

function showCancelConfirm () {
  return new Promise(resolve => {
    const overlay = makeOverlay(() => resolve(false))
    const modal = makeModal('Confirm cancel')
    const items = visit._items ?? []
    const body = document.createElement('p')
    body.className = 'ws-modal-note'
    body.textContent = `This will remove ${items.length} item${items.length !== 1 ? 's' : ''} and set the total to $0.`
    const actions = makeActions(
      [{ label: 'Go back', cls: 'secondary', fn: () => { overlay.remove(); resolve(false) } },
       { label: 'Yes, cancel', cls: 'heat', fn: () => { overlay.remove(); resolve(true) } }]
    )
    modal.appendChild(body)
    modal.appendChild(actions)
    overlay.appendChild(modal)
    document.getElementById('ws-screen')?.appendChild(overlay)
  })
}

function buildThermostatSection () {
  const wrap = document.createElement('div')
  wrap.className = 'ws-section-content'
  const tstatItems = catalogItems.filter(i => i.category === 'thermostat')
  const selected   = (visit._items ?? []).find(i => i.category === 'thermostat')
  const preSpec    = visit.pre_specified_thermostat

  const grid = document.createElement('div')
  grid.className = 'ws-btn-grid'

  tstatItems.forEach(item => {
    const isActive = selected?.item_name === item.name
    const isPre    = !isActive && preSpec === item.name
    const btn = document.createElement('button')
    btn.className = `ws-item-btn${isActive ? ' ws-item-btn--active' : ''}${isPre ? ' ws-item-btn--pre' : ''}`
    btn.innerHTML = isPre ? `${item.name}<span class="ws-pre-label">suggested</span>` : item.name
    btn.addEventListener('click', async () => {
      if (isActive) {
        const existing = (visit._items ?? []).find(i => i.category === 'thermostat')
        if (existing) {
          await api.delete(`/visits/${visit.id}/items/${existing.id}`)
          visit._items = (visit._items ?? []).filter(i => i.id !== existing.id)
          refreshSection('thermostat')
        }
        return
      }
      const existing = (visit._items ?? []).find(i => i.category === 'thermostat')
      if (existing) {
        await api.delete(`/visits/${visit.id}/items/${existing.id}`)
        visit._items = (visit._items ?? []).filter(i => i.id !== existing.id)
      }
      showQuantityModal(item, async qty => {
        try {
          const result = await api.post(`/visits/${visit.id}/items`, { itemName: item.name, category: 'thermostat', quantity: qty })
          visit._items = [...(visit._items ?? []), result.item ?? { item_name: item.name, category: 'thermostat', quantity: qty, price: item.price }]
          if (result.total_price !== undefined) updatePrice(result.total_price)
          refreshSection('thermostat')
        } catch (err) { console.error('Add thermostat failed:', err) }
      })
    })
    grid.appendChild(btn)
  })

  wrap.appendChild(grid)
  if (selected) {
    wrap.appendChild(buildItemChip(selected))
    const doneBtn = document.createElement('button')
    doneBtn.className = 'ws-done-btn'
    doneBtn.textContent = 'Done'
    doneBtn.addEventListener('click', () => markSectionComplete('thermostat'))
    wrap.appendChild(doneBtn)
  } else {
    const skipBtn = document.createElement('button')
    skipBtn.className = 'ws-done-btn'
    skipBtn.textContent = 'Skip'
    skipBtn.addEventListener('click', () => markSectionComplete('thermostat'))
    wrap.appendChild(skipBtn)
  }
  return wrap
}

function showQuantityModal (item, onConfirm) {
  const overlay = makeOverlay()
  const modal = makeModal(item.name)
  const note = document.createElement('p')
  note.className = 'ws-modal-note'
  note.textContent = 'How many?'
  modal.appendChild(note)
  let qty = 1
  const qtyWrap = document.createElement('div')
  qtyWrap.style.cssText = 'display:flex;align-items:center;justify-content:center;gap:16px;margin:8px 0;'
  const minus = makeModalBtn('−', 'secondary'); minus.style.width='44px'
  const display = document.createElement('span'); display.className='ws-price-amount'; display.textContent='1'
  const plus = makeModalBtn('+', 'secondary'); plus.style.width='44px'
  minus.addEventListener('click', () => { if (qty > 1) { qty--; display.textContent = qty } })
  plus.addEventListener('click',  () => { qty++; display.textContent = qty })
  qtyWrap.appendChild(minus); qtyWrap.appendChild(display); qtyWrap.appendChild(plus)
  modal.appendChild(qtyWrap)
  const actions = makeActions([
    { label: 'Cancel', cls: 'secondary', fn: () => overlay.remove() },
    { label: 'Add',    cls: 'primary',   fn: () => { overlay.remove(); onConfirm(qty) } },
  ])
  modal.appendChild(actions)
  overlay.appendChild(modal)
  document.getElementById('ws-screen')?.appendChild(overlay)
}

function buildItemsSection (category) {
  const wrap = document.createElement('div')
  wrap.className = 'ws-section-content'
  const isCancelled = visit._service?.cancel
  const items       = catalogItems.filter(i => i.category === category)
  const activeItems = (visit._items ?? []).filter(i => i.category === category)
  const preIds      = category === 'accessory' ? (visit.pre_identified_accessories ?? []) : []
  const sectionId   = category === 'accessory' ? 'accessories' : 'fixes'

  const grid = document.createElement('div')
  grid.className = 'ws-btn-grid'

  items.forEach(item => {
    const isActive = activeItems.some(a => a.item_name === item.name)
    const isPre    = !isActive && preIds.includes(item.name)
    const btn = document.createElement('button')
    btn.className = `ws-item-btn${isActive ? ' ws-item-btn--active' : ''}${isPre ? ' ws-item-btn--pre' : ''}`
    btn.disabled  = !!isCancelled
    btn.innerHTML = isPre ? `${item.name}<span class="ws-pre-label">suggested</span>` : item.name
    btn.addEventListener('click', async () => {
      if (isActive) {
        const existing = activeItems.find(a => a.item_name === item.name)
        if (existing) {
          await api.delete(`/visits/${visit.id}/items/${existing.id}`)
          visit._items = (visit._items ?? []).filter(i => i.id !== existing.id)
          refreshSection(sectionId)
        }
        return
      }
      if (item.custom_price) { showCustomPriceModal(item, price => addItem(item, category, 1, price)); return }
      if (category === 'fix' && (item.name === 'Fixed Leaks' || item.name === 'Extended Wire')) {
        showSubOptionsModal(item, category); return
      }
      await addItem(item, category, 1)
    })
    grid.appendChild(btn)
  })

  wrap.appendChild(grid)
  if (activeItems.length) {
    const list = document.createElement('div')
    list.className = 'ws-items-list'
    activeItems.forEach(i => list.appendChild(buildItemChip(i)))
    wrap.appendChild(list)
  }
  const doneBtn = document.createElement('button')
  doneBtn.className = 'ws-done-btn'
  doneBtn.textContent = activeItems.length ? 'Done' : 'Skip'
  doneBtn.addEventListener('click', () => markSectionComplete(sectionId))
  wrap.appendChild(doneBtn)
  return wrap
}

async function addItem (item, category, quantity, customPrice) {
  try {
    const body = { itemName: item.name, category, quantity }
    if (customPrice !== undefined) body.customPrice = customPrice
    const result = await api.post(`/visits/${visit.id}/items`, body)
    const newItem = result.item ?? { item_name: item.name, category, quantity, price: customPrice ?? item.price }
    visit._items = [...(visit._items ?? []), newItem]
    if (result.companionItems?.length) visit._items = [...visit._items, ...result.companionItems]
    if (result.total_price !== undefined) updatePrice(result.total_price)
    refreshSection(category === 'accessory' ? 'accessories' : 'fixes')
  } catch (err) { console.error('Add item failed:', err) }
}

function showCustomPriceModal (item, onConfirm) {
  const overlay = makeOverlay()
  const modal = makeModal(item.name)
  const input = document.createElement('input')
  input.type = 'number'; input.min = '0'; input.step = '0.01'
  input.placeholder = 'Enter price'; input.className = 'ws-price-input'
  modal.appendChild(input)
  const actions = makeActions([
    { label: 'Cancel', cls: 'secondary', fn: () => overlay.remove() },
    { label: 'Add', cls: 'primary', fn: () => {
      const price = parseFloat(input.value)
      if (isNaN(price) || price < 0) return
      overlay.remove(); onConfirm(price)
    }},
  ])
  modal.appendChild(actions)
  overlay.appendChild(modal)
  document.getElementById('ws-screen')?.appendChild(overlay)
  setTimeout(() => input.focus(), 50)
}

function showSubOptionsModal (item, category) {
  const SUB_OPTIONS = { 'Fixed Leaks': ['cunit','ecoil','wall'], 'Extended Wire': ['cunit','furnace'] }
  const options = SUB_OPTIONS[item.name] ?? []
  const overlay = makeOverlay()
  const modal = makeModal(item.name)
  const note = document.createElement('p'); note.className='ws-modal-note'; note.textContent='Select all that apply'
  modal.appendChild(note)
  const selected = new Set()
  const grid = document.createElement('div'); grid.className = 'ws-btn-grid'
  options.forEach(opt => {
    const btn = document.createElement('button')
    btn.className = 'ws-item-btn'; btn.textContent = opt
    btn.addEventListener('click', () => {
      if (selected.has(opt)) { selected.delete(opt); btn.classList.remove('ws-item-btn--active') }
      else { selected.add(opt); btn.classList.add('ws-item-btn--active') }
    })
    grid.appendChild(btn)
  })
  modal.appendChild(grid)
  const actions = makeActions([
    { label: 'Cancel', cls: 'secondary', fn: () => overlay.remove() },
    { label: 'Add', cls: 'primary', fn: async () => { overlay.remove(); await addItem({ ...item, subOptions: [...selected] }, category, 1) } },
  ])
  modal.appendChild(actions)
  overlay.appendChild(modal)
  document.getElementById('ws-screen')?.appendChild(overlay)
}

function buildWeighInSection () {
  const wrap = document.createElement('div')
  wrap.className = 'ws-section-content'
  const count = visit._service?.twoSystems ? 2 : 1
  for (let i = 1; i <= count; i++) wrap.appendChild(buildWeighInPanel(i, count > 1))
  const doneBtn = document.createElement('button')
  doneBtn.className = 'ws-done-btn'; doneBtn.textContent = 'Done'
  doneBtn.addEventListener('click', () => { visit._weighinDone = true; markSectionComplete('weighin') })
  wrap.appendChild(doneBtn)
  return wrap
}

function buildWeighInPanel (systemNum, showLabel) {
  const panel = document.createElement('div')
  panel.className = 'ws-weighin-panel'
  if (showLabel) {
    const lbl = document.createElement('p'); lbl.className='ws-weighin-label'; lbl.textContent=`System ${systemNum}`
    panel.appendChild(lbl)
  }
  const FIELDS = [
    ['linesetLength','Lineset length (ft)'],['adjustedOz','Adjusted oz'],['fanSpeedCfm','Fan speed CFM'],
    ['liquidLineTemp','Liquid line temp (°F)'],['suctionLineTemp','Suction line temp (°F)'],
    ['condenserSatTemp','Condenser sat temp'],['subcooling','Subcooling'],
  ]
  const keys = FIELDS.map(f => f[0])
  FIELDS.forEach(([key, label]) => {
    const row = document.createElement('div'); row.className='ws-field-row'
    const lbl = document.createElement('label'); lbl.className='ws-field-label'; lbl.textContent=label; lbl.setAttribute('for',`wi-${systemNum}-${key}`)
    const input = document.createElement('input')
    input.type='number'; input.id=`wi-${systemNum}-${key}`; input.className='ws-field-input'; input.inputMode='decimal'
    input.addEventListener('blur', async () => {
      const body = {}
      keys.forEach(k => {
        const v = parseFloat(document.getElementById(`wi-${systemNum}-${k}`)?.value)
        if (!isNaN(v)) body[k] = v
      })
      try { await api.put(`/visits/${visit.id}/weigh-in/${systemNum}`, body) }
      catch (err) { console.error('Weigh-in sync failed:', err) }
    })
    row.appendChild(lbl); row.appendChild(input)
    panel.appendChild(row)
  })
  return panel
}

function buildNotesSection () {
  const wrap = document.createElement('div'); wrap.className='ws-section-content'
  const textarea = document.createElement('textarea')
  textarea.className='ws-notes-input'; textarea.placeholder='Field notes, observations…'
  textarea.value = visit.notes ?? ''; textarea.rows=5
  textarea.addEventListener('blur', async () => {
    visit.notes = textarea.value
    try { await api.patch(`/visits/${visit.id}/notes`, { notes: textarea.value }) }
    catch (err) { console.error('Notes sync failed:', err) }
  })
  const doneBtn = document.createElement('button')
  doneBtn.className='ws-done-btn'; doneBtn.textContent='Done'
  doneBtn.addEventListener('click', () => markSectionComplete('notes'))
  wrap.appendChild(textarea); wrap.appendChild(doneBtn)
  return wrap
}

function buildChecklistSection () {
  const wrap = document.createElement('div'); wrap.className='ws-section-content'
  const TAGS = ['SCALE','FAN','NO_GAS_METER','NO_ELECTRIC_METER','NO_PDRAIN','BREAKERS_MISSING','Other']
  const grid = document.createElement('div'); grid.className='ws-btn-grid'
  TAGS.forEach(tag => {
    const btn = document.createElement('button'); btn.className='ws-item-btn'; btn.textContent=tag
    btn.addEventListener('click', () => capturePhoto(tag, btn))
    grid.appendChild(btn)
  })
  wrap.appendChild(grid)
  const thumbs = document.createElement('div'); thumbs.className='ws-thumbs'; thumbs.id='ws-thumbs'
  wrap.appendChild(thumbs)
  const genBtn = document.createElement('button')
  genBtn.className='ws-done-btn ws-done-btn--generate'; genBtn.textContent='Generate Report'
  genBtn.addEventListener('click', openGenerateModal)
  wrap.appendChild(genBtn)
  return wrap
}

async function capturePhoto (tag, btn) {
  const input = document.createElement('input')
  input.type='file'; input.accept='image/*'; input.capture='environment'
  input.addEventListener('change', async () => {
    const file = input.files[0]; if (!file) return
    btn.classList.add('ws-item-btn--active')
    const compressed = await compressImage(file)
    const form = new FormData()
    form.append('photo', compressed, file.name); form.append('tag', tag)
    try {
      await api.upload(`/visits/${visit.id}/photos`, form)
      visit._photoCount = (visit._photoCount ?? 0) + 1
      addThumb(compressed, tag)
    } catch (err) { console.error('Photo upload failed:', err); btn.classList.remove('ws-item-btn--active') }
  })
  input.click()
}

function addThumb (blob, tag) {
  const thumbs = document.getElementById('ws-thumbs'); if (!thumbs) return
  const url = URL.createObjectURL(blob)
  const wrap = document.createElement('div'); wrap.className='ws-thumb'
  const img = document.createElement('img'); img.src=url; img.alt=tag; img.onload=()=>URL.revokeObjectURL(url)
  const lbl = document.createElement('span'); lbl.className='ws-thumb-label'; lbl.textContent=tag
  wrap.appendChild(img); wrap.appendChild(lbl); thumbs.appendChild(wrap)
}

async function compressImage (file, maxPx=1200, quality=0.7) {
  return new Promise(resolve => {
    const img = new Image(); const url = URL.createObjectURL(file)
    img.onload = () => {
      URL.revokeObjectURL(url)
      const scale = Math.min(1, maxPx / Math.max(img.width, img.height))
      const canvas = document.createElement('canvas')
      canvas.width = img.width * scale; canvas.height = img.height * scale
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height)
      canvas.toBlob(blob => resolve(blob ?? file), 'image/jpeg', quality)
    }
    img.onerror = () => resolve(file); img.src = url
  })
}

function openGenerateModal () {
  const overlay = makeOverlay()
  const modal = makeModal('Generate Report')
  const summary = document.createElement('div'); summary.className='ws-modal-summary'
  const items = visit._items ?? []
  ;[['Service', getSectionSummary('service')], ['Items', items.length ? `${items.length} item${items.length!==1?'s':''}` : 'None'],
    ['Total', formatPrice(visit.total_price)], ['Photos', String(visit._photoCount ?? 0)]
  ].forEach(([label, value]) => {
    const row = document.createElement('div'); row.className='ws-modal-row'
    row.innerHTML=`<span class="ws-modal-row-label">${label}</span><span class="ws-modal-row-value">${value}</span>`
    summary.appendChild(row)
  })
  const note = document.createElement('p'); note.className='ws-modal-note'
  note.textContent = 'Review before submitting. Corrections require a request after submission.'
  const actions = makeActions([
    { label: 'Go back', cls: 'secondary', fn: () => overlay.remove() },
    { label: 'Submit report', cls: 'primary', fn: async (btn) => {
      btn.disabled=true; btn.textContent='Submitting…'
      try {
        await api.post(`/visits/${visit.id}/complete`)
        overlay.remove()
        sessionStorage.removeItem('workspace:visitId')
        window.dispatchEvent(new CustomEvent('app:navigate', { detail: { route: '/reports' } }))
      } catch (err) {
        btn.disabled=false; btn.textContent='Submit report'
        if (!navigator.onLine) { overlay.remove(); showOfflineModal() }
        else console.error('Submit failed:', err)
      }
    }},
  ])
  modal.appendChild(summary); modal.appendChild(note); modal.appendChild(actions)
  overlay.appendChild(modal)
  document.getElementById('ws-screen')?.appendChild(overlay)
}

function showOfflineModal () {
  const overlay = makeOverlay()
  const modal = makeModal('No connection')
  const note = document.createElement('p'); note.className='ws-modal-note'
  note.textContent = "You're offline. Download the report now or wait for a connection."
  modal.appendChild(note)
  const actions = makeActions([
    { label: 'Download', cls: 'secondary', fn: () => { downloadLocalReport(); overlay.remove() } },
    { label: 'Wait', cls: 'primary', fn: async () => {
      const { enqueue } = await import('../lib/queue.js')
      await enqueue({ visitId: visit.id, queuedAt: new Date().toISOString() })
      overlay.remove(); navigateBack()
    }},
  ])
  modal.appendChild(actions); overlay.appendChild(modal)
  document.getElementById('ws-screen')?.appendChild(overlay)
}

function downloadLocalReport () {
  const payload = { visitId: visit.id, address: visit.address, service: visit._service, items: visit._items??[], total: visit.total_price, notes: visit.notes, generatedAt: new Date().toISOString(), offline: true }
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a'); a.href=url; a.download=`report-${visit.id}-offline.json`; a.click()
  URL.revokeObjectURL(url)
}

function buildItemChip (item) {
  const chip = document.createElement('div'); chip.className='ws-item-chip'
  const name = document.createElement('span'); name.className='ws-chip-name'
  name.textContent = item.quantity > 1 ? `${item.item_name} × ${item.quantity}` : item.item_name
  const right = document.createElement('div'); right.className='ws-chip-right'
  if (item.price) {
    const price = document.createElement('span'); price.className='ws-chip-price'
    price.textContent = `$${Number(item.price).toFixed(2)}`; right.appendChild(price)
  }
  const del = document.createElement('button'); del.className='ws-chip-del'; del.textContent='×'
  del.addEventListener('click', async () => {
    try {
      await api.delete(`/visits/${visit.id}/items/${item.id}`)
      visit._items = (visit._items ?? []).filter(i => i.id !== item.id)
      const sectionId = item.category==='thermostat' ? 'thermostat' : item.category==='accessory' ? 'accessories' : 'fixes'
      refreshSection(sectionId)
    } catch (err) { console.error('Delete item failed:', err) }
  })
  right.appendChild(del); chip.appendChild(name); chip.appendChild(right)
  return chip
}

function refreshSection (sectionId) {
  const content = document.getElementById(`content-${sectionId}`); if (!content) return
  content.innerHTML = ''; content.appendChild(buildSectionContent(sectionId))
}

function navigateBack () {
  window.dispatchEvent(new CustomEvent('app:navigate', { detail: { route: '/' } }))
}

function makeOverlay (onClickOutside) {
  const overlay = document.createElement('div'); overlay.className='ws-modal-overlay'
  if (onClickOutside) overlay.addEventListener('click', e => { if (e.target===overlay) onClickOutside() })
  else overlay.addEventListener('click', e => { if (e.target===overlay) overlay.remove() })
  return overlay
}

function makeModal (title) {
  const modal = document.createElement('div'); modal.className='ws-modal'
  const h2 = document.createElement('h2'); h2.className='ws-modal-title'; h2.textContent=title
  modal.appendChild(h2)
  return modal
}

function makeModalBtn (label, cls) {
  const btn = document.createElement('button')
  btn.className = `ws-modal-btn ws-modal-btn--${cls}`; btn.textContent=label
  return btn
}

function makeActions (items) {
  const actions = document.createElement('div'); actions.className='ws-modal-actions'
  items.forEach(({ label, cls, fn }) => {
    const btn = makeModalBtn(label, cls)
    btn.addEventListener('click', () => fn(btn))
    actions.appendChild(btn)
  })
  return actions
}

const STYLES_ID = 'styles-workspace'
function injectStyles () {
  if (document.getElementById(STYLES_ID)) return
  const style = document.createElement('style'); style.id=STYLES_ID
  style.textContent = `
  .ws-screen{display:flex;flex-direction:column;height:100dvh;background:var(--surface-base);overflow:hidden;position:relative;}
  .ws-loading{display:flex;align-items:center;justify-content:center;height:100dvh;font-size:var(--text-base);color:var(--text-muted);}
  .ws-header{display:flex;align-items:center;gap:var(--space-3);padding:calc(var(--space-5) + env(safe-area-inset-top,0px)) var(--space-4) var(--space-3);background:var(--surface-1);border-bottom:0.5px solid var(--border-subtle);flex-shrink:0;}
  .ws-back-btn{background:none;border:none;color:var(--text-muted);font-size:20px;cursor:pointer;padding:var(--space-2);border-radius:var(--radius-md);line-height:1;-webkit-tap-highlight-color:transparent;flex-shrink:0;}
  .ws-header-info{flex:1;min-width:0;}
  .ws-header-supra{font-size:var(--text-xs);color:var(--text-disabled);text-transform:uppercase;letter-spacing:.05em;}
  .ws-header-addr{font-size:var(--text-base);font-weight:500;color:var(--text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
  .ws-progress-wrap{background:var(--surface-1);padding:8px 16px 10px;border-bottom:0.5px solid var(--border-subtle);flex-shrink:0;}
  .ws-progress-bar{display:flex;align-items:center;margin-bottom:6px;}
  .ws-progress-seg{flex:1;height:3px;border-radius:2px;background:var(--surface-3);transition:background var(--dur-base) var(--ease-out);}
  .ws-progress-seg--done{background:var(--color-signal);}
  .ws-progress-labels{display:flex;justify-content:space-between;}
  .ws-progress-label{font-size:9px;color:var(--text-disabled);flex:1;text-align:center;transition:color var(--dur-base) var(--ease-out);}
  .ws-progress-label--done{color:var(--color-signal);}
  .ws-body{flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch;overscroll-behavior:contain;padding:var(--space-2) var(--space-3) var(--space-4);display:flex;flex-direction:column;gap:var(--space-2);}
  .ws-accordion{background:var(--surface-1);border-radius:var(--radius-lg);border:0.5px solid var(--border-subtle);overflow:hidden;transition:border-color var(--dur-fast) var(--ease-out);}
  .ws-accordion--active{border-color:var(--signal-border);}
  .ws-acc-trigger{display:flex;align-items:center;justify-content:space-between;padding:12px 14px;cursor:pointer;-webkit-tap-highlight-color:transparent;gap:var(--space-2);}
  .ws-acc-trigger-left{display:flex;align-items:center;gap:var(--space-2);}
  .ws-acc-icon{font-size:14px;}
  .ws-acc-label{font-size:var(--text-base);font-weight:500;color:var(--text-secondary);}
  .ws-accordion--active .ws-acc-label{color:var(--text-primary);}
  .ws-acc-trigger-right{display:flex;align-items:center;gap:var(--space-2);flex-shrink:0;}
  .ws-acc-summary{font-size:var(--text-sm);color:var(--color-signal);font-weight:500;}
  .ws-acc-chevron{font-size:16px;color:var(--text-disabled);transition:transform var(--dur-fast) var(--ease-out);line-height:1;}
  .ws-speak-btn{background:none;border:0.5px solid var(--signal-border);border-radius:var(--radius-md);color:var(--color-signal);font-size:var(--text-sm);padding:4px 8px;cursor:pointer;-webkit-tap-highlight-color:transparent;}
  .ws-acc-content{overflow:hidden;}
  .ws-section-content{padding:0 12px 14px;display:flex;flex-direction:column;gap:var(--space-3);}
  .ws-btn-grid{display:flex;flex-wrap:wrap;gap:6px;}
  .ws-btn-grid--modifiers{margin-top:-4px;}
  .ws-item-btn{flex:1;min-width:72px;padding:9px 10px;border-radius:var(--radius-md);border:0.5px solid var(--border-default);background:var(--surface-3);color:var(--text-secondary);font-size:var(--text-sm);font-weight:500;cursor:pointer;text-align:center;position:relative;overflow:hidden;transition:background var(--dur-fast),color var(--dur-fast);-webkit-tap-highlight-color:transparent;display:flex;flex-direction:column;align-items:center;gap:2px;}
  .ws-item-btn:disabled{opacity:.35;cursor:not-allowed;}
  .ws-item-btn--active{background:var(--void2,#161920);color:var(--text-primary);border:1.5px solid var(--color-signal);}
  .ws-item-btn--ac{background:#eff6ff;color:#1d4ed8;border:1.5px solid #1d4ed8;}
  .ws-item-btn--heat{background:#fff7ed;color:#c2410c;border:1.5px solid #c2410c;}
  .ws-item-btn--pre{border-color:var(--plasma-border);}
  .ws-pre-label{font-size:9px;color:var(--color-plasma);font-weight:400;letter-spacing:.02em;}
  .ws-btn--modifier{font-size:var(--text-xs);}
  .ws-items-list{display:flex;flex-direction:column;gap:var(--space-2);}
  .ws-item-chip{display:flex;justify-content:space-between;align-items:center;background:var(--surface-2);border-radius:var(--radius-md);padding:var(--space-2) var(--space-3);border:0.5px solid var(--border-subtle);}
  .ws-chip-name{font-size:var(--text-sm);font-weight:500;color:var(--text-primary);}
  .ws-chip-right{display:flex;align-items:center;gap:var(--space-2);}
  .ws-chip-price{font-size:var(--text-sm);color:var(--text-muted);}
  .ws-chip-del{background:none;border:none;color:var(--color-heat);font-size:18px;cursor:pointer;padding:0 2px;line-height:1;-webkit-tap-highlight-color:transparent;}
  .ws-done-btn{width:100%;background:var(--color-signal);color:#fff;border:none;border-radius:var(--radius-md);font-size:var(--text-base);font-weight:500;padding:var(--space-3);cursor:pointer;-webkit-tap-highlight-color:transparent;margin-top:var(--space-1);}
  .ws-done-btn--generate{background:#22C55E;}
  .ws-weighin-panel{display:flex;flex-direction:column;gap:var(--space-2);}
  .ws-weighin-label{font-size:var(--text-xs);color:var(--text-disabled);text-transform:uppercase;letter-spacing:.06em;font-weight:500;margin-bottom:var(--space-1);}
  .ws-field-row{display:flex;justify-content:space-between;align-items:center;gap:var(--space-3);}
  .ws-field-label{font-size:var(--text-sm);color:var(--text-muted);flex:1;}
  .ws-field-input{background:var(--surface-2);border:0.5px solid var(--border-default);border-radius:var(--radius-md);color:var(--text-primary);font-size:var(--text-base);padding:var(--space-2) var(--space-3);width:100px;text-align:right;outline:none;}
  .ws-field-input:focus{border-color:var(--color-signal);}
  .ws-notes-input{width:100%;background:var(--surface-2);border:0.5px solid var(--border-default);border-radius:var(--radius-md);color:var(--text-primary);font-size:var(--text-base);font-family:var(--font-sans);padding:var(--space-3);resize:none;outline:none;line-height:1.5;}
  .ws-notes-input:focus{border-color:var(--color-signal);}
  .ws-thumbs{display:flex;flex-wrap:wrap;gap:var(--space-2);}
  .ws-thumb{width:64px;height:64px;border-radius:var(--radius-md);overflow:hidden;position:relative;border:0.5px solid var(--border-subtle);}
  .ws-thumb img{width:100%;height:100%;object-fit:cover;}
  .ws-thumb-label{position:absolute;bottom:0;left:0;right:0;background:rgba(0,0,0,.6);color:#fff;font-size:8px;text-align:center;padding:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
  .ws-price-bar{background:var(--surface-1);border-top:0.5px solid var(--border-subtle);padding:var(--space-3) var(--space-4);padding-bottom:calc(var(--space-3) + env(safe-area-inset-bottom,0px));display:flex;align-items:center;justify-content:space-between;gap:var(--space-3);flex-shrink:0;}
  .ws-price-label{font-size:var(--text-xs);color:var(--text-disabled);text-transform:uppercase;letter-spacing:.05em;}
  .ws-price-amount{font-size:20px;font-weight:500;color:var(--text-primary);}
  .ws-gen-btn{background:var(--color-signal);color:#fff;border:none;border-radius:var(--radius-md);font-size:var(--text-sm);font-weight:500;padding:var(--space-3) var(--space-4);cursor:pointer;white-space:nowrap;-webkit-tap-highlight-color:transparent;}
  .ws-modal-overlay{position:absolute;inset:0;background:rgba(0,0,0,.6);display:flex;align-items:flex-end;z-index:50;}
  .ws-modal{width:100%;background:var(--surface-1);border-radius:var(--radius-lg) var(--radius-lg) 0 0;padding:var(--space-5);display:flex;flex-direction:column;gap:var(--space-3);padding-bottom:calc(var(--space-5) + env(safe-area-inset-bottom,0px));}
  .ws-modal-title{font-size:var(--text-md);font-weight:500;color:var(--text-primary);}
  .ws-modal-summary{background:var(--surface-2);border-radius:var(--radius-md);padding:var(--space-3);display:flex;flex-direction:column;gap:var(--space-2);border:0.5px solid var(--border-subtle);}
  .ws-modal-row{display:flex;justify-content:space-between;align-items:center;}
  .ws-modal-row-label{font-size:var(--text-sm);color:var(--text-muted);}
  .ws-modal-row-value{font-size:var(--text-sm);font-weight:500;color:var(--text-primary);}
  .ws-modal-note{font-size:var(--text-sm);color:var(--text-muted);line-height:1.5;}
  .ws-modal-actions{display:flex;gap:var(--space-2);}
  .ws-modal-btn{flex:1;border-radius:var(--radius-md);font-size:var(--text-base);font-weight:500;padding:var(--space-3);cursor:pointer;border:none;-webkit-tap-highlight-color:transparent;}
  .ws-modal-btn--primary{background:var(--color-signal);color:#fff;}
  .ws-modal-btn--secondary{background:var(--surface-3);color:var(--text-secondary);}
  .ws-modal-btn--heat{background:var(--color-heat);color:#fff;}
  .ws-price-input{width:100%;background:var(--surface-2);border:0.5px solid var(--border-default);border-radius:var(--radius-md);color:var(--text-primary);font-size:var(--text-lg);padding:var(--space-3);text-align:center;outline:none;}
  .ws-price-input:focus{border-color:var(--color-signal);}
  .ws-empty-note{font-size:var(--text-sm);color:var(--text-muted);text-align:center;padding:var(--space-4) 0;}
  `
  document.head.appendChild(style)
}
