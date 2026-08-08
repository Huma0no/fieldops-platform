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

const CHECKLIST_ITEMS = [
  { key: 'pdrain_ecoil',   label: 'P-drain [eCoil]',            reportText: 'No/Incomplete pdrain at ecoil' },
  { key: 'pdrain_disch',   label: 'P-drain [Discharge]',         reportText: 'No/Incomplete pdrain' },
  { key: 'tstat_locked',   label: 'Tstat Locked?',                reportText: null, noPhoto: true },
  { key: 'media_filter',   label: 'Media Filter',                 reportText: 'Media filter missing' },
  { key: 'electric_meter', label: 'Electric Meter',               reportText: 'No electric meter' },
  { key: 'breaker_cond',   label: 'Breaker — Condenser',          reportText: 'Disconnect missing at Cond' },
  { key: 'breaker_ah',     label: 'Breaker — Air Handler',        reportText: 'No breakers in the main breaker panel' },
  { key: 'disconnect_box', label: 'Disconnect box',               reportText: 'Disconnect box missing' },
  { key: 'whip_220v',      label: 'Whip 220v',                    reportText: '220v not connected/Missing at cond' },
  { key: 'furnace_switch', label: 'Furnace disconnect switch',    reportText: 'Furnace disconnect switch missing' },
  { key: 'cable_110v',     label: '110v cable',                   reportText: '110v cable to furnace not connected' },
  { key: 'gas_meter',      label: 'Gas Meter',                    reportText: 'gas meter closed/missing' },
  { key: 'gas_pipes',      label: 'Gas Pipes/Tubing at Furnace',  reportText: 'Gas pipes/Tubing at furnace missing' },
  { key: 'gas_valve',      label: 'Gas Valve',                    reportText: null },
]

// 5-step linear rail. 'calc' is intentionally not included — buildCalcSection()
// stays intact as a standalone utility panel, to be wired to the bottom strip
// in a later pass.
const STEPS = [
  { id: 'service',     label: 'Srv+T', icon: '⚡' },
  { id: 'accessories', label: 'Acc',   icon: '🔧' },
  { id: 'fixes',       label: 'Fix',   icon: '🔩' },
  { id: 'weighin',     label: 'Wght',  icon: '⚖️' },
  { id: 'notes',       label: 'Notes', icon: '📝' },
]

// Maps the ids used internally by the (unchanged) content-builder functions —
// some of which pre-date the merge (e.g. 'thermostat', 'startup') — to the
// step they now live under, for refreshSection()'s targeted re-render.
const SECTION_TO_STEP = {
  service: 'service', thermostat: 'service',
  accessories: 'accessories',
  fixes: 'fixes',
  weighin: 'weighin',
  startup: 'notes', notes: 'notes', checklist: 'notes',
}

let visit           = null
let catalogItems    = []
let linesetConfigs  = []
let equipmentCatalog = []
let activeStep       = 'service'
let completedSections = new Set()
const GPS_STORAGE_KEY = 'fo_gps_state'
let gps = { lat: null, lon: null, source: null, denied: false }
let _gpsPhotosMissing = 0
let _exifrLoaded = false

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
    ;[visit, catalogItems, linesetConfigs, equipmentCatalog] = await Promise.all([
      api.get(`/visits/${visitId}`),
      getCatalog('items').then(d => d ?? []),
      api.get('/catalog/lineset-configs').catch(() => []),
      api.get('/catalog/equipment').catch(() => []),
    ])
    if (!visit._service) {
      const svc = (visit.services ?? [])[0]
      visit._service = {
        ac:          svc?.serviceName === 'AC' || svc?.serviceName === 'AC & Heat',
        heat:        svc?.serviceName === 'Heat' || svc?.serviceName === 'AC & Heat',
        prestart:    svc?.serviceName === 'Prestart',
        cancel:      svc?.serviceName === 'Cancel',
        driveRun:    svc?.serviceName === 'Drive Run',
        finish:      svc?.isFinish ?? false,
        temporarily: svc?.isTemporarily ?? false,
        twoSystems:  visit.hasMultipleSystems ?? false,
      }
    }
    if (!visit._items) visit._items = []
    if (!visit._checklist) visit._checklist = {}
    if (!visit._checklistPhotoCounts) visit._checklistPhotoCounts = {}
  } catch (err) {
    console.error('Workspace load failed:', err)
    navigateBack()
    return
  }

  appEl.innerHTML = ''
  gps = loadGpsState() ?? { lat: null, lon: null, source: null, denied: false }
  _gpsPhotosMissing = 0
  renderScreen(appEl)
  if (!(gps.lat && gps.lon)) requestGps()
}

function renderScreen (appEl) {
  const screen = document.createElement('div')
  screen.className = 'ws-screen'
  screen.id = 'ws-screen'
  screen.appendChild(buildHeader())
  const body = document.createElement('div')
  body.className = 'ws-body'
  body.id = 'ws-body'
  screen.appendChild(body)
  screen.appendChild(buildPriceSummary())
  appEl.appendChild(screen)
  renderBody()
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
  const addrParts = [visit.address?.street, visit.address?.city].filter(Boolean)
  addr.textContent = addrParts.length ? addrParts.join(', ') : '—'
  if (addrParts.length) {
    addr.classList.add('ws-header-addr--nav')
    addr.addEventListener('click', () => {
      window.open('https://maps.google.com/maps?q=' + encodeURIComponent(addrParts.join(', ')), '_blank')
    })
  }
  info.appendChild(supra)
  info.appendChild(addr)
  el.appendChild(back)
  el.appendChild(info)
  return el
}

// ── Step rail + linear navigation ───────────────────────────
//
// Replaces the old vertical accordion. Only the active step's content is
// rendered into #ws-body; Back/Next move between STEPS, and the rail itself
// can jump to any step directly. Completion marks reuse the same
// completedSections Set / markSectionComplete() the accordion used.

function renderBody () {
  const body = document.getElementById('ws-body')
  if (!body) return
  body.innerHTML = ''
  body.appendChild(buildStepRail())
  const stepIndex = STEPS.findIndex(s => s.id === activeStep)
  const content = buildStepContent(activeStep)
  content.id = 'ws-step-content'
  body.appendChild(content)
  body.appendChild(buildStepFooter(stepIndex))
}

function goToStep (stepId) {
  if (stepId === activeStep) return
  activeStep = stepId
  renderBody()
  document.getElementById('ws-step-content')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

function buildStepRail () {
  const wrap = document.createElement('div')
  wrap.className = 'ws-rail-wrap'
  const rail = document.createElement('div')
  rail.className = 'ws-rail'
  STEPS.forEach(step => {
    const isActive = step.id === activeStep
    const isDone   = completedSections.has(step.id)
    const btn = document.createElement('button')
    btn.className = `ws-rail-step${isActive ? ' ws-rail-step--active' : ''}${isDone ? ' ws-rail-step--done' : ''}`
    const icon = document.createElement('span')
    icon.className = 'ws-rail-icon'
    icon.textContent = step.icon
    const lbl = document.createElement('span')
    lbl.className = 'ws-rail-label'
    lbl.textContent = step.label
    btn.appendChild(icon)
    btn.appendChild(lbl)
    btn.addEventListener('click', () => goToStep(step.id))
    rail.appendChild(btn)
  })
  wrap.appendChild(rail)
  return wrap
}

function buildStepFooter (stepIndex) {
  const footer = document.createElement('div')
  footer.className = 'ws-step-footer'

  const backBtn = document.createElement('button')
  backBtn.className = 'ws-step-back-btn'
  backBtn.textContent = '← Back'
  backBtn.disabled = stepIndex <= 0
  backBtn.addEventListener('click', () => goToStep(STEPS[stepIndex - 1].id))
  footer.appendChild(backBtn)

  const isLast = stepIndex === STEPS.length - 1
  const nextBtn = document.createElement('button')
  nextBtn.className = `ws-done-btn${isLast ? ' ws-done-btn--generate' : ''}`
  nextBtn.textContent = isLast ? 'Generate Report' : 'Next →'
  nextBtn.addEventListener('click', () => {
    if (isLast) {
      openGenerateModal()
    } else {
      markSectionComplete(STEPS[stepIndex].id)
      goToStep(STEPS[stepIndex + 1].id)
    }
  })
  footer.appendChild(nextBtn)

  return footer
}

function buildStepContent (stepId) {
  switch (stepId) {
    case 'service':     return buildServiceStepContent()
    case 'accessories': return stripTrailingButton(buildItemsSection('accessory'))
    case 'fixes':       return stripTrailingButton(buildItemsSection('fix'))
    case 'weighin':     return stripTrailingButton(buildWeighInSection())
    case 'notes':       return buildNotesStepContent()
    default:            return document.createElement('div')
  }
}

// Removes the trailing Done/Skip/Generate button a content-builder function
// appends for the old accordion flow — navigation is now handled by the
// step-level footer instead. The builder functions themselves are untouched;
// this only trims what they return.
function stripTrailingButton (el) {
  if (el.lastElementChild?.classList.contains('ws-done-btn')) {
    el.lastElementChild.remove()
  }
  return el
}

// Step 1: Service + Thermostat, merged into one content block.
function buildServiceStepContent () {
  const wrap = document.createElement('div')
  wrap.className = 'ws-section-content'
  const svcEl    = stripTrailingButton(buildServiceSection())
  const tstatEl  = stripTrailingButton(buildThermostatSection())
  ;[...svcEl.children].forEach(c => wrap.appendChild(c))
  ;[...tstatEl.children].forEach(c => wrap.appendChild(c))
  return wrap
}

// Step 5: Startup checklist (incl. compliance photos) at top, notes below.
function buildNotesStepContent () {
  const wrap = document.createElement('div')
  wrap.className = 'ws-section-content'
  const startupEl   = stripTrailingButton(buildStartupChecklistSection())
  const checklistEl = stripTrailingButton(buildChecklistSection())
  const notesEl      = stripTrailingButton(buildNotesSection())
  ;[...startupEl.children].forEach(c => wrap.appendChild(c))
  ;[...checklistEl.children].forEach(c => wrap.appendChild(c))
  ;[...notesEl.children].forEach(c => wrap.appendChild(c))
  return wrap
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
      return `${items.length} item${items.length !== 1 ? 's' : ''}`
    }
    case 'fixes': {
      const items = (visit._items ?? []).filter(i => i.category === 'fix')
      return items.length ? `${items.length} fix${items.length !== 1 ? 'es' : ''}` : '—'
    }
    case 'startup': {
      const answered = CHECKLIST_ITEMS.filter(i => visit._checklist?.[i.key] != null).length
      return answered ? `${answered}/${CHECKLIST_ITEMS.length}` : '—'
    }
    case 'weighin':   return visit._weighinDone ? 'Done' : '—'
    case 'calc':      return '—'
    case 'notes':     return visit.notes ? visit.notes.slice(0, 30) + (visit.notes.length > 30 ? '…' : '') : '—'
    case 'checklist': return `${visit._photoCount ?? 0} photo${(visit._photoCount ?? 0) !== 1 ? 's' : ''}`
    default:          return '—'
  }
}

// Advancing to the next step is now the step-footer's job (see
// buildStepFooter) — this just records completion, same Set as before.
function markSectionComplete (sectionId) {
  completedSections.add(sectionId)
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
  amount.textContent = formatPrice(visit.totalPrice)
  left.appendChild(lbl)
  left.appendChild(amount)
  el.appendChild(left)
  return el
}

function updatePrice (newTotal) {
  const el = document.getElementById('ws-price-amount')
  if (el) el.textContent = formatPrice(newTotal)
  if (visit) visit.totalPrice = newTotal
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
    { key: 'prestart', label: 'Prestart' },
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
      refreshSection('service')
    })
    baseRow.appendChild(btn)
  })
  wrap.appendChild(baseRow)

  if (svc.ac || svc.heat) {
    const modRow = document.createElement('div')
    modRow.className = 'ws-btn-grid ws-btn-grid--modifiers'
    ;[['finish','Finish'],['temporarily','Temporarily']].forEach(([key,label]) => {
      const btn = document.createElement('button')
      btn.className = `ws-item-btn ws-btn--modifier${svc[key] ? ' ws-item-btn--active' : ''}`
      btn.textContent = label
      btn.addEventListener('click', async () => {
        svc[key] = !svc[key]
        await syncService()
        refreshSection('service')
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
  else if (svc.ac)          serviceName = 'AC'
  else if (svc.heat)        serviceName = 'Heat'
  else if (svc.prestart)    serviceName = 'Prestart System'
  else if (svc.cancel)      serviceName = 'Cancel'
  else if (svc.driveRun)    serviceName = 'Drive Run'
  if (!serviceName) return
  try {
    const result = await api.patch(`/visits/${visit.id}/services`, {
      serviceName, isFinish: svc.finish, isTemporarily: svc.temporarily,
    })
    if (result?.totalPrice !== undefined) updatePrice(result.totalPrice)
  } catch (err) { console.error('Service sync failed:', err) }
}

function hasActiveItems () { return (visit._items ?? []).length > 0 }

async function clearAllItems () {
  try {
    const result = await api.patch(`/visits/${visit.id}/services`, { serviceName: 'Cancel', confirmed: true })
    visit._items = []
    if (result?.totalPrice !== undefined) updatePrice(result.totalPrice)
    else updatePrice(0)
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
    const isActive = selected?.item_name === item.item_name
    const isPre    = !isActive && preSpec === item.item_name
    const btn = document.createElement('button')
    btn.className = `ws-item-btn${isActive ? ' ws-item-btn--active' : ''}${isPre ? ' ws-item-btn--pre' : ''}`
    btn.innerHTML = isPre ? `${item.item_name}<span class="ws-pre-label">suggested</span>` : item.item_name
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
          const result = await api.post(`/visits/${visit.id}/items`, { itemName: item.item_name, category: 'thermostat', quantity: qty })
          visit._items = [...(visit._items ?? []), { id: result.id, item_name: item.item_name, category: 'thermostat', quantity: qty, price: item.default_price }]
          if (result.totalPrice !== undefined) updatePrice(result.totalPrice)
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
  const modal = makeModal(item.item_name)
  const note = document.createElement('p')
  note.className = 'ws-modal-note'
  note.textContent = 'How many?'
  modal.appendChild(note)
  let qty = 1
  const qtyWrap = document.createElement('div')
  qtyWrap.className = 'ws-qty-wrap'
  const minus = makeModalBtn('−', 'secondary'); minus.classList.add('ws-qty-btn')
  const display = document.createElement('span'); display.className='ws-price-amount'; display.textContent='1'
  const plus = makeModalBtn('+', 'secondary'); plus.classList.add('ws-qty-btn')
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
    const isActive = activeItems.some(a => a.item_name === item.item_name)
    const isPre    = !isActive && preIds.includes(item.item_name)
    const btn = document.createElement('button')
    btn.className = `ws-item-btn${isActive ? ' ws-item-btn--active' : ''}${isPre ? ' ws-item-btn--pre' : ''}`
    btn.disabled  = !!isCancelled
    btn.innerHTML = isPre ? `${item.item_name}<span class="ws-pre-label">suggested</span>` : item.item_name
    btn.addEventListener('click', async () => {
      if (isActive) {
        const existing = activeItems.find(a => a.item_name === item.item_name)
        if (existing) {
          await api.delete(`/visits/${visit.id}/items/${existing.id}`)
          visit._items = (visit._items ?? []).filter(i => i.id !== existing.id)
          refreshSection(sectionId)
        }
        return
      }
      if (item.custom_price) { showCustomPriceModal(item, price => addItem(item, category, 1, price)); return }
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
    const body = { itemName: item.item_name, category, quantity }
    if (customPrice !== undefined) body.price = customPrice
    const result = await api.post(`/visits/${visit.id}/items`, body)
    const newItem = { id: result.id, item_name: item.item_name, category, quantity, price: customPrice ?? item.default_price }
    visit._items = [...(visit._items ?? []).filter(i => !result.removedItems?.includes(i.item_name)), newItem]
    if (result.totalPrice !== undefined) updatePrice(result.totalPrice)
    refreshSection(category === 'accessory' ? 'accessories' : 'fixes')
  } catch (err) { console.error('Add item failed:', err) }
}

function showCustomPriceModal (item, onConfirm) {
  const overlay = makeOverlay()
  const modal = makeModal(item.item_name)
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

  const NUMERIC_FIELDS = [
    ['linesetLength','Lineset length (ft)'],['adjustedOz','Adjusted oz'],['fanSpeedCfm','Fan speed CFM'],
    ['liquidLineTemp','Liquid line temp (°F)'],['suctionLineTemp','Suction line temp (°F)'],
    ['condenserSatTemp','Condenser sat temp'],['subcoolingValue','Subcooling'],
  ]
  const numericKeys = NUMERIC_FIELDS.map(f => f[0])

  // Detect brand from equipment catalog using the outdoor unit model for this system
  const outdoorModel = visit.systems?.find(s => s.systemNumber === systemNum)?.outdoorModel
  const brand = (equipmentCatalog.find(e => e.model === outdoorModel)?.brand ?? '').toLowerCase()

  function getPreselect () {
    if (brand.includes('trane')) {
      const d = visit.scheduledTime ? new Date(visit.scheduledTime) : null
      if (!d || isNaN(d)) return null
      if (d < new Date('2025-05-01')) return 'TRANE-PRE-2025'
      if (d < new Date('2026-01-01')) return 'TRANE-MID-2025'
      return 'TRANE-2026'
    }
    if (brand.includes('lennox'))  return 'LENNOX-30'
    if (brand.includes('goodman')) return 'GOODMAN'
    if (brand.includes('daikin'))  return 'DAIKIN'
    return null
  }
  const preselect = getPreselect()

  async function syncWeighIn () {
    const body = {}
    numericKeys.forEach(k => {
      const v = parseFloat(document.getElementById(`wi-${systemNum}-${k}`)?.value)
      if (!isNaN(v)) body[k] = v
    })
    const configEl = document.getElementById(`wi-${systemNum}-config`)
    if (configEl?.value) body.factoryLineConfig = configEl.value
    const cfg = linesetConfigs.find(c => c.config_key === configEl?.value)
    body.factoryChargeUsed = cfg?.revised_available
      ? (document.getElementById(`wi-${systemNum}-charge`)?.value || 'factory')
      : 'factory'
    try { await api.put(`/visits/${visit.id}/weigh-in/${systemNum}`, body) }
    catch (err) { console.error('Weigh-in sync failed:', err) }
  }

  // Numeric fields
  NUMERIC_FIELDS.forEach(([key, label]) => {
    const row = document.createElement('div'); row.className='ws-field-row'
    const lbl = document.createElement('label'); lbl.className='ws-field-label'; lbl.textContent=label; lbl.setAttribute('for',`wi-${systemNum}-${key}`)
    const input = document.createElement('input')
    input.type='number'; input.id=`wi-${systemNum}-${key}`; input.className='ws-field-input'; input.inputMode='decimal'
    input.addEventListener('blur', syncWeighIn)
    row.appendChild(lbl); row.appendChild(input); panel.appendChild(row)
  })

  // Lineset config dropdown
  const configRow = document.createElement('div'); configRow.className='ws-field-row'
  const configLbl = document.createElement('label'); configLbl.className='ws-field-label'; configLbl.textContent='Lineset config'; configLbl.setAttribute('for',`wi-${systemNum}-config`)
  const configSel = document.createElement('select'); configSel.id=`wi-${systemNum}-config`; configSel.className='ws-field-input'
  const emptyOpt = document.createElement('option'); emptyOpt.value=''; emptyOpt.textContent='— select —'
  configSel.appendChild(emptyOpt)
  linesetConfigs.forEach(cfg => {
    const opt = document.createElement('option'); opt.value=cfg.config_key; opt.textContent=cfg.config_key
    if (cfg.config_key === preselect) opt.selected = true
    configSel.appendChild(opt)
  })
  configRow.appendChild(configLbl); configRow.appendChild(configSel); panel.appendChild(configRow)

  // Factory/revised row — only visible when selected config has revised_available=true
  const chargeRow = document.createElement('div'); chargeRow.className='ws-field-row'
  const chargeLbl = document.createElement('label'); chargeLbl.className='ws-field-label'; chargeLbl.textContent='Charge'; chargeLbl.setAttribute('for',`wi-${systemNum}-charge`)
  const chargeSel = document.createElement('select'); chargeSel.id=`wi-${systemNum}-charge`; chargeSel.className='ws-field-input'
  ;[['factory','Factory'],['revised','Revised']].forEach(([val, txt]) => {
    const opt = document.createElement('option'); opt.value=val; opt.textContent=txt; chargeSel.appendChild(opt)
  })
  chargeSel.addEventListener('change', syncWeighIn)
  chargeRow.appendChild(chargeLbl); chargeRow.appendChild(chargeSel); panel.appendChild(chargeRow)

  function updateChargeVisibility (configKey) {
    const cfg = linesetConfigs.find(c => c.config_key === configKey)
    chargeRow.classList.toggle('hidden', !cfg?.revised_available)
  }
  updateChargeVisibility(preselect ?? '')
  configSel.addEventListener('change', () => { updateChargeVisibility(configSel.value); syncWeighIn() })

  // Scale/Fan photos — per-system, per WEIGHIN-SPEC.md items 13-14
  const photoSep = document.createElement('p'); photoSep.className='ws-weighin-label'; photoSep.textContent='Compliance Photos'
  panel.appendChild(photoSep)
  const photoGrid = document.createElement('div'); photoGrid.className='ws-btn-grid'
  ;['SCALE', 'FAN'].forEach(tag => {
    const btn = document.createElement('button'); btn.className='ws-item-btn'; btn.textContent=tag
    if (visit._weighInPhotos?.[`${systemNum}-${tag}`]) btn.classList.add('ws-item-btn--active')
    btn.addEventListener('click', () => captureWeighInPhoto(tag, systemNum, btn))
    photoGrid.appendChild(btn)
  })
  panel.appendChild(photoGrid)

  return panel
}

async function captureWeighInPhoto (tag, systemNum, btn) {
  const input = document.createElement('input')
  input.type='file'; input.accept='image/*'; input.capture='environment'
  input.addEventListener('change', async () => {
    const file = input.files[0]; if (!file) return
    btn.classList.add('ws-item-btn--active')
    const compressed = await compressImage(file)
    const category = tag === 'SCALE' ? 'weigh_in_scale' : 'fan_speed'
    const form = new FormData()
    form.append('photo', compressed, file.name)
    form.append('tag', tag)
    form.append('category', category)
    form.append('systemNumber', systemNum)
    await appendGpsFields(form, tag, file)
    try {
      await api.upload(`/visits/${visit.id}/photos`, form)
      visit._photoCount = (visit._photoCount ?? 0) + 1
      visit._weighInPhotos = visit._weighInPhotos ?? {}
      visit._weighInPhotos[`${systemNum}-${tag}`] = true
    } catch (err) { console.error('Weigh-in photo upload failed:', err); btn.classList.remove('ws-item-btn--active') }
  })
  input.click()
}

function buildCalcSection () {
  const wrap = document.createElement('div')
  wrap.className = 'ws-section-content'
  const count = visit._service?.twoSystems ? 2 : 1
  for (let i = 1; i <= count; i++) wrap.appendChild(buildCalcPanel(i, count > 1))
  const doneBtn = document.createElement('button')
  doneBtn.className = 'ws-done-btn'; doneBtn.textContent = 'Done'
  doneBtn.addEventListener('click', () => markSectionComplete('calc'))
  wrap.appendChild(doneBtn)
  return wrap
}

function buildCalcPanel (systemNum, showLabel) {
  const panel = document.createElement('div')
  panel.className = 'ws-weighin-panel'
  if (showLabel) {
    const lbl = document.createElement('p'); lbl.className='ws-weighin-label'; lbl.textContent=`System ${systemNum}`
    panel.appendChild(lbl)
  }

  const outdoorModel = visit.systems?.find(s => s.systemNumber === systemNum)?.outdoorModel
  const brand = (equipmentCatalog.find(e => e.model === outdoorModel)?.brand ?? '').toLowerCase()

  function getPreselect () {
    if (brand.includes('trane')) {
      const d = visit.scheduledTime ? new Date(visit.scheduledTime) : null
      if (!d || isNaN(d)) return null
      if (d < new Date('2025-05-01')) return 'TRANE-PRE-2025'
      if (d < new Date('2026-01-01')) return 'TRANE-MID-2025'
      return 'TRANE-2026'
    }
    if (brand.includes('lennox'))  return 'LENNOX-30'
    if (brand.includes('goodman')) return 'GOODMAN'
    if (brand.includes('daikin'))  return 'DAIKIN'
    return null
  }
  const preselect = getPreselect()

  // Config dropdown
  const configRow = document.createElement('div'); configRow.className='ws-field-row'
  const configLbl = document.createElement('label'); configLbl.className='ws-field-label'; configLbl.textContent='Lineset config'; configLbl.setAttribute('for',`calc-${systemNum}-config`)
  const configSel = document.createElement('select'); configSel.id=`calc-${systemNum}-config`; configSel.className='ws-field-input'
  const emptyOpt = document.createElement('option'); emptyOpt.value=''; emptyOpt.textContent='— select —'; configSel.appendChild(emptyOpt)
  linesetConfigs.forEach(cfg => {
    const opt = document.createElement('option'); opt.value=cfg.config_key; opt.textContent=cfg.config_key
    if (cfg.config_key === preselect) opt.selected = true
    configSel.appendChild(opt)
  })
  configRow.appendChild(configLbl); configRow.appendChild(configSel); panel.appendChild(configRow)

  // Actual lineset input
  const ftRow = document.createElement('div'); ftRow.className='ws-field-row'
  const ftLbl = document.createElement('label'); ftLbl.className='ws-field-label'; ftLbl.textContent='Actual lineset (ft)'; ftLbl.setAttribute('for',`calc-${systemNum}-ft`)
  const ftInput = document.createElement('input')
  ftInput.type='number'; ftInput.id=`calc-${systemNum}-ft`; ftInput.className='ws-field-input'; ftInput.inputMode='decimal'; ftInput.placeholder='ft'
  ftRow.appendChild(ftLbl); ftRow.appendChild(ftInput); panel.appendChild(ftRow)

  // Result display
  const resultEl = document.createElement('p'); resultEl.className='ws-calc-result'; resultEl.textContent='—'
  panel.appendChild(resultEl)

  function updateResult () {
    const cfg = linesetConfigs.find(c => c.config_key === configSel.value)
    const actual = parseFloat(ftInput.value)
    if (!cfg || isNaN(actual)) { resultEl.textContent = '—'; return }
    const adj = Math.round((actual - cfg.reference_length_ft) * cfg.adjust_rate_oz_per_ft * 10) / 10
    if (adj === 0)      resultEl.textContent = 'No adjustment needed'
    else if (adj > 0)   resultEl.textContent = `Add ${adj.toFixed(1)} oz`
    else                resultEl.textContent = `Remove ${Math.abs(adj).toFixed(1)} oz`
  }

  configSel.addEventListener('change', updateResult)
  ftInput.addEventListener('input', updateResult)
  updateResult()
  return panel
}

function buildStartupChecklistSection () {
  const wrap = document.createElement('div'); wrap.className='ws-section-content'
  CHECKLIST_ITEMS.forEach(item => wrap.appendChild(buildChecklistItemRow(item)))
  const doneBtn = document.createElement('button')
  doneBtn.className='ws-done-btn'; doneBtn.textContent='Done'
  doneBtn.addEventListener('click', () => markSectionComplete('startup'))
  wrap.appendChild(doneBtn)
  return wrap
}

function buildChecklistItemRow (item) {
  const answer = visit._checklist?.[item.key] ?? null
  const wrap = document.createElement('div'); wrap.className='ws-check-item'
  const row = document.createElement('div'); row.className='ws-check-row'
  const lbl = document.createElement('span'); lbl.className='ws-check-label'; lbl.textContent=item.label
  const btnGroup = document.createElement('div'); btnGroup.className='ws-check-btns'
  ;[['yes','Yes'],['no','No']].forEach(([val, txt]) => {
    const btn = document.createElement('button')
    btn.className = `ws-check-btn${answer === val ? ' ws-check-btn--active' : ''}`
    btn.textContent = txt
    btn.addEventListener('click', () => {
      visit._checklist = visit._checklist ?? {}
      visit._checklist[item.key] = visit._checklist[item.key] === val ? null : val
      refreshSection('startup')
    })
    btnGroup.appendChild(btn)
  })
  row.appendChild(lbl); row.appendChild(btnGroup); wrap.appendChild(row)
  if (answer === 'no' && !item.noPhoto) {
    const photoRow = document.createElement('div'); photoRow.className='ws-check-photo-row'
    const photoBtn = document.createElement('button'); photoBtn.className='ws-check-photo-btn'
    const count = visit._checklistPhotoCounts?.[item.key] ?? 0
    photoBtn.textContent = count > 0 ? `📷 ${count} photo${count !== 1 ? 's' : ''}` : '📷 Add photo'
    photoBtn.addEventListener('click', () => captureStartupItemPhoto(item.key, photoBtn))
    photoRow.appendChild(photoBtn); wrap.appendChild(photoRow)
  }
  return wrap
}

async function captureStartupItemPhoto (itemKey, btn) {
  const input = document.createElement('input')
  input.type='file'; input.accept='image/*'; input.capture='environment'
  input.addEventListener('change', async () => {
    const file = input.files[0]; if (!file) return
    const compressed = await compressImage(file)
    const form = new FormData()
    form.append('photo', compressed, file.name); form.append('tag', itemKey.toUpperCase()); form.append('category', 'site_evidence')
    try {
      await api.upload(`/visits/${visit.id}/photos`, form)
      visit._checklistPhotoCounts = visit._checklistPhotoCounts ?? {}
      visit._checklistPhotoCounts[itemKey] = (visit._checklistPhotoCounts[itemKey] ?? 0) + 1
      visit._photoCount = (visit._photoCount ?? 0) + 1
      const count = visit._checklistPhotoCounts[itemKey]
      btn.textContent = `📷 ${count} photo${count !== 1 ? 's' : ''}`
    } catch (err) { console.error('Checklist photo failed:', err) }
  })
  input.click()
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
  const genBtn = document.createElement('button')
  genBtn.className='ws-done-btn ws-done-btn--generate'; genBtn.textContent='Generate Report'
  genBtn.addEventListener('click', openGenerateModal)
  wrap.appendChild(genBtn)
  return wrap
}

async function compressImage (file, maxPx=1600, quality=0.8) {
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

async function loadExifr () {
  if (_exifrLoaded) return window.exifr
  return new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = 'https://unpkg.com/exifr/dist/full.umd.cjs'
    s.onload = () => { _exifrLoaded = true; resolve(window.exifr) }
    s.onerror = () => reject(new Error('exifr load failed'))
    document.head.appendChild(s)
  })
}

async function getGpsFromPhoto (file) {
  try {
    const exifr = await loadExifr()
    const result = await exifr.gps(file)
    if (result?.latitude && result?.longitude) {
      return { lat: result.latitude.toFixed(6), lon: result.longitude.toFixed(6) }
    }
  } catch {}
  return null
}

async function appendGpsFields (form, tag, file) {
  if (tag !== 'SCALE' && tag !== 'FAN') return
  const fromPhoto = await getGpsFromPhoto(file)
  const coords = fromPhoto ?? (gps.lat ? { lat: gps.lat, lon: gps.lon } : null)
  if (coords) {
    form.append('lat', coords.lat)
    form.append('lon', coords.lon)
  } else {
    _gpsPhotosMissing++
  }
}

function loadGpsState () {
  try {
    const raw = sessionStorage.getItem(GPS_STORAGE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}

function saveGpsState () {
  try { sessionStorage.setItem(GPS_STORAGE_KEY, JSON.stringify(gps)) } catch {}
}

function requestGps () {
  if (!navigator.geolocation || gps.denied) return
  showGpsPrompt()
}

function showGpsPrompt () {
  const overlay = makeOverlay()
  const modal = makeModal('Location Access')
  const note = document.createElement('p'); note.className = 'ws-modal-note'
  note.textContent = 'Location is used to embed GPS coordinates in SCALE and FAN photos for compliance records.'
  const actions = makeActions([
    { label: 'Skip',  cls: 'secondary', fn: () => { gps.denied = true; saveGpsState(); overlay.remove() } },
    { label: 'Allow', cls: 'primary',   fn: () => {
      overlay.remove()
      navigator.geolocation.getCurrentPosition(
        pos => {
          gps.lat    = pos.coords.latitude.toFixed(6)
          gps.lon    = pos.coords.longitude.toFixed(6)
          gps.source = 'device'
          saveGpsState()
        },
        () => { gps.denied = true; saveGpsState() },
        { enableHighAccuracy: true, timeout: 8000 }
      )
    }},
  ])
  modal.appendChild(note); modal.appendChild(actions)
  overlay.appendChild(modal)
  document.getElementById('ws-screen')?.appendChild(overlay)
}

function buildChecklistAnswers () {
  return CHECKLIST_ITEMS
    .filter(item => visit._checklist?.[item.key] != null)
    .map(item => ({
      item: item.key,
      answer: visit._checklist[item.key],
      photoCount: visit._checklistPhotoCounts?.[item.key] ?? 0,
      reportText: visit._checklist[item.key] === 'no' ? item.reportText : null,
    }))
}

function openGenerateModal () {
  const pdrain1 = visit._checklist?.pdrain_ecoil
  const pdrain2 = visit._checklist?.pdrain_disch
  if (pdrain1 !== 'yes' || pdrain2 !== 'yes') {
    showPdrainAdvisory()
    return
  }
  openGenerateModalDirect()
}

function showPdrainAdvisory () {
  const overlay = makeOverlay()
  const modal = makeModal('P-drain Review')
  const note = document.createElement('p'); note.className='ws-modal-note'
  note.textContent = 'Reviewing the P-drain before completing is recommended.'
  const actions = makeActions([
    { label: 'Close',      cls: 'secondary', fn: () => overlay.remove() },
    { label: 'Understood', cls: 'primary',   fn: () => { overlay.remove(); openGenerateModalDirect() } },
  ])
  modal.appendChild(note); modal.appendChild(actions)
  overlay.appendChild(modal)
  document.getElementById('ws-screen')?.appendChild(overlay)
}

function openGenerateModalDirect () {
  const overlay = makeOverlay()
  const modal = makeModal('Generate Report')
  const summary = document.createElement('div'); summary.className='ws-modal-summary'
  const items = visit._items ?? []
  ;[['Service', getSectionSummary('service')], ['Items', items.length ? `${items.length} item${items.length!==1?'s':''}` : 'None'],
    ['Total', formatPrice(visit.totalPrice)], ['Photos', String(visit._photoCount ?? 0)]
  ].forEach(([label, value]) => {
    const row = document.createElement('div'); row.className='ws-modal-row'
    row.innerHTML=`<span class="ws-modal-row-label">${label}</span><span class="ws-modal-row-value">${value}</span>`
    summary.appendChild(row)
  })
  const note = document.createElement('p'); note.className='ws-modal-note'
  note.textContent = 'Review before submitting. Corrections require a request after submission.'
  if (_gpsPhotosMissing > 0) {
    const gpsWarn = document.createElement('p'); gpsWarn.className='ws-modal-note ws-modal-note--warn'
    gpsWarn.textContent = 'GPS required for SCALE and FAN photos. Retake or enable location access.'
    modal.appendChild(gpsWarn)
  }
  const actions = makeActions([
    { label: 'Go back', cls: 'secondary', fn: () => overlay.remove() },
    { label: 'Submit report', cls: 'primary', fn: async (btn) => {
      btn.disabled=true; btn.textContent='Submitting…'
      try {
        await api.post(`/visits/${visit.id}/complete`, { checklistAnswers: buildChecklistAnswers() })
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
  if (_gpsPhotosMissing > 0) {
    const submitBtn = actions.querySelector('.ws-modal-btn--primary')
    if (submitBtn) submitBtn.disabled = true
  }
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
  const payload = { visitId: visit.id, address: visit.address, service: visit._service, items: visit._items??[], total: visit.totalPrice, notes: visit.notes, generatedAt: new Date().toISOString(), offline: true }
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

// Called by the (unchanged) content-builder functions after a data change.
// sectionId may be a pre-merge id (e.g. 'thermostat', 'startup') — map it to
// the step that now owns it and re-render if that step is the one showing.
function refreshSection (sectionId) {
  const stepId = SECTION_TO_STEP[sectionId] ?? sectionId
  if (stepId === activeStep) renderBody()
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
  .ws-screen{display:flex;flex-direction:column;height:100dvh;background:var(--fo-panel);overflow:hidden;position:relative;font-family:var(--fo-font-body);}
  .ws-loading{display:flex;align-items:center;justify-content:center;height:100dvh;font-size:var(--text-base);color:var(--fo-ink-soft);background:var(--fo-panel);}
  .ws-header{display:flex;align-items:center;gap:var(--space-3);padding:calc(var(--space-5) + env(safe-area-inset-top,0px)) var(--space-4) var(--space-3);background:var(--fo-panel);flex-shrink:0;}
  .ws-back-btn{background:var(--fo-panel);box-shadow:var(--fo-shadow-raised);border:none;color:var(--fo-ink-soft);font-size:18px;cursor:pointer;padding:var(--space-2);border-radius:var(--fo-radius-sm);line-height:1;-webkit-tap-highlight-color:transparent;flex-shrink:0;}
  .ws-header-info{flex:1;min-width:0;}
  .ws-header-supra{font-size:var(--text-xs);color:var(--fo-ink-soft);font-family:var(--fo-font-mono);text-transform:uppercase;letter-spacing:.05em;}
  .ws-header-addr{font-size:var(--text-base);font-weight:600;color:var(--fo-ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
  .ws-header-addr--nav{cursor:pointer;color:var(--fo-accent-deep);text-decoration:underline;text-decoration-style:dotted;text-underline-offset:2px;-webkit-tap-highlight-color:transparent;}
  .ws-body{flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch;overscroll-behavior:contain;padding:var(--space-2) var(--space-3) var(--space-4);display:flex;flex-direction:column;gap:var(--space-2);}
  .ws-rail-wrap{overflow-x:auto;-webkit-overflow-scrolling:touch;flex-shrink:0;}
  .ws-rail{display:flex;padding:6px 2px;gap:8px;}
  .ws-rail-step{flex:0 0 auto;min-width:60px;display:flex;flex-direction:column;align-items:center;gap:2px;padding:8px 10px;border-radius:var(--fo-radius-sm);border:none;background:var(--fo-panel);box-shadow:var(--fo-shadow-raised);color:var(--fo-ink-soft);cursor:pointer;position:relative;-webkit-tap-highlight-color:transparent;}
  .ws-rail-icon{font-size:14px;}
  .ws-rail-label{font-size:9px;color:var(--fo-ink-soft);font-family:var(--fo-font-mono);font-weight:500;white-space:nowrap;}
  .ws-rail-step--done::after{content:'';position:absolute;top:4px;right:4px;width:6px;height:6px;border-radius:50%;background:var(--fo-ok);}
  .ws-rail-step--active{box-shadow:var(--fo-shadow-inset);}
  .ws-rail-step--active .ws-rail-label{color:var(--fo-accent-deep);}
  .ws-step-footer{display:flex;gap:var(--space-2);}
  .ws-step-back-btn{flex:0 0 auto;background:var(--fo-panel);box-shadow:var(--fo-shadow-raised);border:none;border-radius:var(--fo-radius-sm);color:var(--fo-ink-soft);font-size:var(--text-sm);font-weight:500;padding:var(--space-3) var(--space-4);cursor:pointer;-webkit-tap-highlight-color:transparent;}
  .ws-step-back-btn:disabled{opacity:.35;cursor:not-allowed;box-shadow:none;}
  .ws-section-content{background:var(--fo-panel);box-shadow:var(--fo-shadow-raised);border-radius:var(--fo-radius);padding:16px 14px;display:flex;flex-direction:column;gap:var(--space-3);}
  .ws-btn-grid{display:flex;flex-wrap:wrap;gap:8px;}
  .ws-btn-grid--modifiers{margin-top:-4px;}
  .ws-item-btn{flex:1;min-width:72px;padding:10px;border-radius:var(--fo-radius-sm);border:none;background:var(--fo-tile);box-shadow:var(--fo-shadow-raised);color:var(--fo-ink);font-family:var(--fo-font-mono);font-size:var(--text-sm);font-weight:500;cursor:pointer;text-align:center;position:relative;overflow:hidden;-webkit-tap-highlight-color:transparent;display:flex;flex-direction:column;align-items:center;gap:2px;}
  .ws-item-btn:disabled{opacity:.35;cursor:not-allowed;}
  .ws-item-btn--active{box-shadow:var(--fo-shadow-inset);color:var(--fo-accent-deep);}
  .ws-item-btn--ac{box-shadow:var(--fo-shadow-inset),0 0 0 2px var(--fo-blue-glow);color:var(--fo-blue);}
  .ws-item-btn--heat{box-shadow:var(--fo-shadow-inset),0 0 0 2px var(--fo-red-glow);color:var(--fo-no);}
  .ws-item-btn--pre{color:var(--fo-accent);}
  .ws-pre-label{font-size:9px;color:var(--fo-accent);font-family:var(--fo-font-mono);font-weight:400;letter-spacing:.02em;}
  .ws-btn--modifier{font-size:var(--text-xs);}
  .ws-items-list{display:flex;flex-direction:column;gap:var(--space-2);}
  .ws-item-chip{display:flex;justify-content:space-between;align-items:center;background:var(--fo-panel);box-shadow:var(--fo-shadow-inset);border-radius:var(--fo-radius-sm);padding:var(--space-2) var(--space-3);}
  .ws-chip-name{font-size:var(--text-sm);font-weight:600;color:var(--fo-ink);}
  .ws-chip-right{display:flex;align-items:center;gap:var(--space-2);}
  .ws-chip-price{font-size:var(--text-sm);color:var(--fo-ink-soft);font-family:var(--fo-font-mono);}
  .ws-chip-del{background:none;border:none;color:var(--fo-no);font-size:18px;cursor:pointer;padding:0 2px;line-height:1;-webkit-tap-highlight-color:transparent;}
  .ws-done-btn{flex:1;background:var(--fo-panel);box-shadow:var(--fo-shadow-raised);color:var(--fo-accent-deep);border:none;border-radius:var(--fo-radius-sm);font-family:var(--fo-font-body);font-size:var(--text-base);font-weight:800;padding:var(--space-3);cursor:pointer;-webkit-tap-highlight-color:transparent;}
  .ws-done-btn--generate{color:var(--fo-ok);}
  .ws-weighin-panel{display:flex;flex-direction:column;gap:var(--space-2);}
  .ws-weighin-label{font-size:var(--text-xs);color:var(--fo-ink-soft);font-family:var(--fo-font-mono);text-transform:uppercase;letter-spacing:.06em;font-weight:500;margin-bottom:var(--space-1);}
  .ws-field-row{display:flex;justify-content:space-between;align-items:center;gap:var(--space-3);}
  .ws-field-label{font-size:var(--text-sm);color:var(--fo-ink-soft);flex:1;}
  .ws-field-input{background:var(--fo-well);box-shadow:var(--fo-shadow-well);border:none;border-radius:var(--fo-radius-sm);color:var(--fo-ink);font-family:var(--fo-font-mono);font-size:var(--text-base);padding:var(--space-2) var(--space-3);width:100px;text-align:right;outline:none;appearance:none;}
  .ws-field-input:focus{color:var(--fo-accent-deep);}
  .ws-notes-input{width:100%;background:var(--fo-well);box-shadow:var(--fo-shadow-well);border:none;border-radius:var(--fo-radius-sm);color:var(--fo-ink);font-size:var(--text-base);font-family:var(--fo-font-body);padding:var(--space-3);resize:none;outline:none;line-height:1.5;}
  .ws-notes-input:focus{color:var(--fo-ink);}
  .ws-price-bar{background:var(--fo-panel);box-shadow:var(--fo-shadow-card);padding:var(--space-3) var(--space-4);padding-bottom:calc(var(--space-3) + env(safe-area-inset-bottom,0px));display:flex;align-items:center;justify-content:space-between;gap:var(--space-3);flex-shrink:0;position:relative;z-index:1;}
  .ws-price-label{font-size:var(--text-xs);color:var(--fo-ink-soft);font-family:var(--fo-font-mono);text-transform:uppercase;letter-spacing:.05em;}
  .ws-price-amount{font-size:20px;font-weight:800;font-family:var(--fo-font-mono);color:var(--fo-accent-deep);}
  .ws-modal-overlay{position:absolute;inset:0;background:rgba(0,0,0,.6);display:flex;align-items:flex-end;z-index:50;}
  .ws-modal{width:100%;background:var(--fo-panel);box-shadow:var(--fo-shadow-card);border-radius:var(--fo-radius) var(--fo-radius) 0 0;padding:var(--space-5);display:flex;flex-direction:column;gap:var(--space-3);padding-bottom:calc(var(--space-5) + env(safe-area-inset-bottom,0px));}
  .ws-modal-title{font-size:var(--text-md);font-weight:700;color:var(--fo-ink);}
  .ws-modal-summary{background:var(--fo-well);box-shadow:var(--fo-shadow-well);border-radius:var(--fo-radius-sm);padding:var(--space-3);display:flex;flex-direction:column;gap:var(--space-2);}
  .ws-qty-wrap{display:flex;align-items:center;justify-content:center;gap:16px;margin:8px 0;}
  .ws-qty-btn{width:44px;background:var(--fo-tile);box-shadow:var(--fo-shadow-raised);color:var(--fo-accent-deep);}
  .ws-qty-btn:active{box-shadow:var(--fo-shadow-inset);}
  .ws-modal-row{display:flex;justify-content:space-between;align-items:center;}
  .ws-modal-row-label{font-size:var(--text-sm);color:var(--fo-ink-soft);}
  .ws-modal-row-value{font-size:var(--text-sm);font-weight:600;color:var(--fo-ink);}
  .ws-modal-note{font-size:var(--text-sm);color:var(--fo-ink-soft);line-height:1.5;}
  .ws-modal-note--warn{color:var(--fo-no);font-weight:500;}
  .ws-modal-actions{display:flex;gap:var(--space-2);}
  .ws-modal-btn{flex:1;background:var(--fo-panel);box-shadow:var(--fo-shadow-raised);border-radius:var(--fo-radius-sm);font-size:var(--text-base);font-weight:600;padding:var(--space-3);cursor:pointer;border:none;-webkit-tap-highlight-color:transparent;}
  .ws-modal-btn--primary{color:var(--fo-accent-deep);}
  .ws-modal-btn--secondary{color:var(--fo-ink-soft);}
  .ws-modal-btn--heat{color:var(--fo-no);}
  .ws-price-input{width:100%;background:var(--fo-well);box-shadow:var(--fo-shadow-well);border:none;border-radius:var(--fo-radius-sm);color:var(--fo-ink);font-size:var(--text-lg);padding:var(--space-3);text-align:center;outline:none;}
  .ws-empty-note{font-size:var(--text-sm);color:var(--fo-ink-soft);text-align:center;padding:var(--space-4) 0;}
  .ws-calc-result{background:var(--fo-well);box-shadow:var(--fo-shadow-well);border-radius:var(--fo-radius-sm);padding:var(--space-3);text-align:center;font-size:var(--text-lg);font-weight:700;color:var(--fo-accent-deep);}
  .ws-check-item{display:flex;flex-direction:column;gap:6px;}
  .ws-check-row{display:flex;align-items:center;justify-content:space-between;gap:var(--space-3);}
  .ws-check-label{font-size:var(--text-sm);color:var(--fo-ink);flex:1;line-height:1.3;}
  .ws-check-btns{display:flex;gap:6px;flex-shrink:0;}
  .ws-check-btn{padding:5px 14px;border-radius:var(--fo-radius-sm);border:none;background:var(--fo-tile);box-shadow:var(--fo-shadow-raised);color:var(--fo-ink-soft);font-size:var(--text-sm);font-weight:500;cursor:pointer;-webkit-tap-highlight-color:transparent;}
  .ws-check-btn--active{box-shadow:var(--fo-shadow-inset);}
  .ws-check-btns .ws-check-btn--active:first-child{color:var(--fo-ok);}
  .ws-check-btns .ws-check-btn--active:last-child{color:var(--fo-no);}
  .ws-check-photo-row{padding-left:2px;}
  .ws-check-photo-btn{background:var(--fo-well);box-shadow:var(--fo-shadow-well);border:none;border-radius:var(--fo-radius-sm);color:var(--fo-no);font-size:var(--text-sm);padding:4px 10px;cursor:pointer;-webkit-tap-highlight-color:transparent;}
  `
  document.head.appendChild(style)
}
