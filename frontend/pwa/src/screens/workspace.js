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
import { priceVisit } from '../../../shared/pricing.mjs'
import { keepPhoto, uploadPendingPhotos } from '../lib/photo-upload.mjs'
import { getActiveTechnicianId, getCatalog, getLocalVisitDraft, saveLocalVisitDraft } from '../lib/db.js'
import { createCompletionSnapshot, createPendingCompletionSubmission, deliverCompletionSubmission } from '../lib/completion-submission.mjs'
import { isCancelJustificationMissing } from '../lib/cancel-justification.mjs'
import { cancelConfirmationStyles, showCancelConfirmation } from '../lib/cancel-confirmation.mjs'
import { CalcPanel, calcPanelStyles } from '../components/calc-panel.js'
import { Receipt, receiptStyles } from '../components/receipt.js'
import { receiptModel } from '../lib/receipt.mjs'
import { GUIDED_RETURN_KEY, guidedContextFromVisit, saveGuidedContext } from '../lib/guided-context.mjs'
import {
  addLocalVisitDraftItem,
  createLocalVisitDraft,
  consumeConfirmedCancelForVisit,
  discardLegacyUnconfirmedCancelOrigin,
  effectiveSystemService,
  enterLocalVisitDraftCancelMode,
  hasServiceSelection,
  isConfirmedLocalVisitDraftCancelMode,
  isCustomSystemService,
  markLocalVisitDraftDirty,
  migrateLegacyConfirmedCancelMode,
  missingServiceSystems,
  normalizeServiceState,
  removeLocalVisitDraftItem,
  resetSystemService,
  serviceRowsFromState,
  serviceStateFromRows,
  setDriveRun,
  setLocalVisitDraftItemQuantity,
  systemNumbersOf,
  systemServiceName,
  tapService,
  toggleLocalVisitDraftChecklist,
  updateLocalVisitDraftNotes,
} from '../lib/workspace-visit.mjs'

const CHECKLIST_ITEMS = [
  { key: 'pdrain_ecoil',   label: 'P-drain [eCoil]',            reportText: 'No/Incomplete pdrain at ecoil', reminder: 'Reviewing the P-drain is recommended before completing.' },
  { key: 'pdrain_disch',   label: 'P-drain [Discharge]',         reportText: 'No/Incomplete pdrain', reminder: 'Reviewing the P-drain is recommended before completing.' },
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
let notesDraftTimer = null
// Cached catalog data for local pricing (docs/OFFLINE-FIRST-CONTRACT.md).
let catalogServices = []
let itemRelations = []
let priceOverrides = {}
// Service step: the system the switcher selected, or null for the default
// selection that applies to every system without its own override.
let selectedSystem = null

export default async function mount (appEl) {
  injectStyles()
  appEl.innerHTML = ''
  activeStep = 'service'
  selectedSystem = null
  completedSections.clear()
  clearTimeout(notesDraftTimer)

  const visitId = sessionStorage.getItem('workspace:visitId')
  const activeTechnicianId = getActiveTechnicianId()
  if (!visitId || !activeTechnicianId) { navigateBack(); return }

  const loading = document.createElement('div')
  loading.className = 'ws-loading'
  loading.textContent = 'Loading…'
  appEl.appendChild(loading)

  try {
    const [localDraft, cachedItems, cachedLinesetConfigs, cachedEquipment, catalogVersion, cachedServices, cachedRelations, cachedOverrides] = await Promise.all([
      getLocalVisitDraft(visitId, activeTechnicianId),
      getCatalog('items').then(d => d ?? []),
      getCatalog('lineset-configs').then(d => d ?? []),
      getCatalog('equipment').then(d => d ?? []),
      getCatalog('version'),
      getCatalog('services').then(d => d ?? []),
      getCatalog('item-relations').then(d => d ?? []),
      getCatalog(`price-overrides:${activeTechnicianId}`).then(d => d ?? []),
    ])

    catalogItems = cachedItems
    linesetConfigs = cachedLinesetConfigs
    equipmentCatalog = cachedEquipment
    catalogServices = cachedServices
    itemRelations = cachedRelations
    priceOverrides = Object.fromEntries(cachedOverrides.map(row => [row.itemName, row.overridePrice]))

    if (localDraft) {
      visit = localDraft
      try {
        const detail = await api.get(`/visits/${visitId}`)
        if (detail?.technicianId && detail.technicianId !== activeTechnicianId) {
          navigateBack()
          return
        }
        visit = {
          ...detail,
          ...localDraft,
          technicianId: localDraft.technicianId ?? detail?.technicianId ?? activeTechnicianId,
          propertyId: localDraft.propertyId ?? detail?.propertyId,
          orderNumber: localDraft.orderNumber ?? detail?.orderNumber,
          scheduledDate: localDraft.scheduledDate ?? detail?.scheduledDate,
          scheduledTime: localDraft.scheduledTime ?? detail?.scheduledTime,
          workType: localDraft.workType ?? detail?.workType,
          hasMultipleSystems: localDraft.hasMultipleSystems ?? detail?.hasMultipleSystems,
          address: localDraft.address ?? detail?.address,
          systems: localDraft.systems ?? detail?.systems,
        }
        await saveLocalVisitDraft(visit, activeTechnicianId)
      } catch (_) {
        // Offline drafts remain available; a missing authoritative field will
        // be rejected by the server until the technician can review it online.
      }
    } else {
      const detail = await api.get(`/visits/${visitId}`)
      if (detail?.technicianId && detail.technicianId !== activeTechnicianId) {
        navigateBack()
        return
      }
      visit = createLocalVisitDraft(
        { ...detail, technicianId: detail?.technicianId ?? activeTechnicianId },
        { catalogVersion }
      )
      await saveLocalVisitDraft(visit, activeTechnicianId)
    }

    if (!catalogItems.length) catalogItems = await api.get('/catalog/items').catch(() => [])
    if (!linesetConfigs.length) linesetConfigs = await api.get('/catalog/lineset-configs').catch(() => [])
    if (!equipmentCatalog.length) equipmentCatalog = await api.get('/catalog/equipment').catch(() => [])
    if (!catalogServices.length) catalogServices = await api.get('/catalog/services').catch(() => [])
    if (!itemRelations.length) itemRelations = await api.get('/catalog/item-relations').catch(() => [])

    visit._service = visit._service
      ? normalizeServiceState(visit._service)
      : serviceStateFromRows(visit.services ?? [], systemNumbersOf(visit))
    repriceVisit()
    if (!visit._checklist) visit._checklist = {}
    if (!visit._checklistPhotoCounts) visit._checklistPhotoCounts = {}

    activeStep = visit._activeStep ?? 'service'
    ;(visit._completedSteps ?? []).forEach(step => completedSections.add(step))

    // A My Calls confirmation has already happened before navigation. Apply
    // the Cancel mode only after the Workspace has loaded its durable draft.
    if (consumeConfirmedCancelForVisit(sessionStorage, visitId)) {
      enterLocalVisitDraftCancelMode(visit)
      activeStep = 'notes'
      await persistCurrentDraft({ touch: false })
    } else if (migrateLegacyConfirmedCancelMode(visit)) {
      activeStep = 'notes'
      await persistCurrentDraft({ touch: false })
    } else if (discardLegacyUnconfirmedCancelOrigin(visit)) {
      activeStep = 'service'
      await persistCurrentDraft({ touch: false })
    }
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
  screen.appendChild(buildActiveJobBanner())
  const body = document.createElement('div')
  body.className = 'ws-body'
  body.id = 'ws-body'
  screen.appendChild(body)
  screen.appendChild(buildPriceSummary())
  screen.appendChild(buildToolButtons())
  appEl.appendChild(screen)
  renderBody()
  // The open Workspace is the active call for Guided.
  saveGuidedContext(localStorage, guidedContextFromVisit(visit))
}

// The bottom bar is not mounted in Workspace; Guided and Calc float bottom-right.
function buildToolButtons () {
  const el = document.createElement('div')
  el.className = 'ws-tools'
  const guided = document.createElement('button')
  guided.className = 'ws-tool-btn'
  guided.setAttribute('aria-label', 'Guided')
  guided.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="5.5" cy="17" r="2.5"/><circle cx="18.5" cy="7" r="2.5"/><path d="M7.5 15.5C12 14 9 9 16.3 8.2"/><path d="M4 21h3M17 3h3"/></svg>'
  guided.addEventListener('click', async () => {
    await flushNotesDraftSave()
    saveGuidedContext(localStorage, guidedContextFromVisit(visit))
    sessionStorage.setItem(GUIDED_RETURN_KEY, '/workspace')
    window.dispatchEvent(new CustomEvent('app:navigate', { detail: { route: '/guided' } }))
  })
  const calc = document.createElement('button')
  calc.className = 'ws-tool-btn'
  calc.setAttribute('aria-label', 'Calc')
  calc.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="4" y="2" width="16" height="20" rx="2"/><line x1="8" y1="7" x2="16" y2="7"/><line x1="8" y1="12" x2="8" y2="12"/><line x1="12" y1="12" x2="12" y2="12"/><line x1="16" y1="12" x2="16" y2="12"/><line x1="8" y1="16" x2="8" y2="16"/><line x1="12" y1="16" x2="12" y2="16"/><line x1="16" y1="16" x2="16" y2="16"/></svg>'
  calc.addEventListener('click', () => {
    const overlay = CalcPanel({ onClose: () => overlay.remove() })
    document.body.appendChild(overlay)
  })
  el.append(guided, calc)
  return el
}

function buildHeader () {
  const el = document.createElement('div')
  el.className = 'ws-header'

  const top = document.createElement('div')
  top.className = 'ws-header-top'

  const back = document.createElement('button')
  back.className = 'ws-back-btn'
  back.innerHTML = '←'
  back.setAttribute('aria-label', 'Back')
  back.addEventListener('click', navigateBack)
  top.appendChild(back)

  const info = document.createElement('div')
  info.className = 'ws-header-info'
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
  info.appendChild(addr)
  top.appendChild(info)

  el.appendChild(top)
  return el
}

function buildActiveJobBanner () {
  const el = document.createElement('div')
  el.className = 'ws-active-job-banner'
  el.id = 'ws-active-job-banner'

  const info = document.createElement('div')
  info.className = 'ws-active-job-info'
  const address = document.createElement('p')
  address.className = 'ws-active-job-address'
  address.textContent = visit.address?.street ?? '—'
  const meta = document.createElement('p')
  meta.className = 'ws-active-job-meta'
  const systemCount = visit.systems?.length ?? 0
  const metaParts = [
    visit.address?.subdivision,
    visit.address?.builder,
    `${systemCount} system${systemCount !== 1 ? 's' : ''}`,
  ].filter(Boolean)
  const switcher = buildSystemSwitcher()
  if (switcher && selectedSystem != null) {
    const system = (visit.systems ?? []).find(s => Number(s.systemNumber) === selectedSystem)
    meta.textContent = `System ${selectedSystem} · ${system?.outdoorModel ?? '—'}`
  } else {
    meta.textContent = metaParts.join(' · ')
  }
  info.appendChild(address)
  info.appendChild(meta)
  el.appendChild(info)

  const right = document.createElement('div')
  right.className = 'ws-active-job-actions'
  if (switcher) right.appendChild(switcher)
  const price = document.createElement('p')
  price.className = 'ws-active-job-price'
  price.id = 'ws-active-job-price'
  price.textContent = formatPrice(visit.totalPrice)
  const cancelBtn = document.createElement('button')
  cancelBtn.className = 'ws-active-job-cancel-btn'
  cancelBtn.innerHTML = '✕'
  cancelBtn.setAttribute('aria-label', 'Cancel visit')
  cancelBtn.addEventListener('click', beginCancel)
  right.appendChild(price)
  right.appendChild(cancelBtn)
  el.appendChild(right)
  return el
}

// System switcher (Service step, multi-system calls): All edits the default
// for every system; a number edits that system. A dot marks systems with
// their own (custom) service.
function buildSystemSwitcher () {
  const numbers = systemNumbersOf(visit)
  if (activeStep !== 'service' || numbers.length < 2 || isCancelMode() || isDriveRunMode()) return null
  const el = document.createElement('div')
  el.className = 'ws-sys-switch'
  el.setAttribute('role', 'group')
  el.setAttribute('aria-label', 'Systems')
  ;[null, ...numbers].forEach((number) => {
    const btn = document.createElement('button')
    btn.type = 'button'
    const on = selectedSystem === number
    const custom = number != null && isCustomSystemService(visit._service, number)
    btn.className = `ws-sys-btn${on ? ' ws-sys-btn--on' : ''}${custom ? ' ws-sys-btn--custom' : ''}`
    btn.textContent = number == null ? 'All' : String(number)
    btn.setAttribute('aria-pressed', String(on))
    btn.setAttribute('aria-label', number == null ? 'All systems' : `System ${number}${custom ? ', custom' : ''}`)
    btn.addEventListener('click', () => {
      if (on) return
      selectedSystem = number
      renderBody()
    })
    el.appendChild(btn)
  })
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
  document.getElementById('ws-active-job-banner')?.replaceWith(buildActiveJobBanner())
  body.innerHTML = ''
  body.appendChild(buildStepRail())
  const stepIndex = STEPS.findIndex(s => s.id === activeStep)
  const content = buildStepContent(activeStep)
  content.id = 'ws-step-content'
  body.appendChild(content)
  body.appendChild(buildStepFooter(stepIndex))
}

function goToStep (stepId) {
  if (isCancelMode() && stepId !== 'notes') return
  if (stepId === activeStep) return
  activeStep = stepId
  visit._activeStep = stepId
  persistCurrentDraft()
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
    btn.disabled = isCancelMode() && step.id !== 'notes'
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
  if (isCancelMode() && stepId !== 'notes') return buildCancelModeNotice()
  if (isDriveRunMode() && ['accessories', 'fixes', 'weighin'].includes(stepId)) return buildDriveRunNotice()
  switch (stepId) {
    case 'service':     return buildServiceStepContent()
    case 'accessories': return stripTrailingButton(buildItemsSection('accessory'))
    case 'fixes':       return stripTrailingButton(buildItemsSection('fix'))
    case 'weighin':     return stripTrailingButton(buildWeighInSection())
    case 'notes':       return buildNotesStepContent()
    default:            return document.createElement('div')
  }
}

function buildCancelModeNotice () {
  const notice = document.createElement('div')
  notice.className = 'ws-section-content ws-cancel-mode-notice'
  notice.textContent = 'Cancel mode keeps Notes and Checklist available for the required justification. Work selections are cleared until Generate Report.'
  return notice
}

// Drive Run active: every section is locked except Notes and the checklist
// (whose answers lead to its photos). Drive Run itself stays usable in Service.
function isDriveRunMode () {
  return visit?._service?.driveRun === true && !isCancelMode()
}

function buildDriveRunNotice () {
  const notice = document.createElement('div')
  notice.className = 'ws-section-content ws-cancel-mode-notice'
  notice.textContent = 'Drive Run active — this section is locked. Turn Drive Run off in Service to edit it.'
  return notice
}

function isCancelMode () {
  return isConfirmedLocalVisitDraftCancelMode(visit)
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
      const service = visit._service
      if (!service) return '—'
      if (service.cancel) return 'Cancel'
      if (service.driveRun) return 'Drive Run'
      const numbers = systemNumbersOf(visit)
      const labels = numbers.map(n => serviceSelectionLabel(effectiveSystemService(service, n)) ?? '—')
      return numbers.length === 1 ? labels[0] : labels.map((label, i) => `S${numbers[i]}: ${label}`).join(' · ')
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
  visit._completedSteps = [...completedSections]
  persistCurrentDraft()
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
  const bannerEl = document.getElementById('ws-active-job-price')
  if (bannerEl) bannerEl.textContent = formatPrice(newTotal)
  if (visit) visit.totalPrice = newTotal
}

function formatPrice (val) {
  return `$${Number(val ?? 0).toFixed(2)}`
}

// Service: AC · HEAT · PRESTART tiles, Finish always below, Temporarily with
// AC or Heat, and the call-wide Drive Run. Taps edit the default for every
// system, or the system the banner switcher selected (its custom service).
function buildServiceSection () {
  const wrap = document.createElement('div')
  wrap.className = 'ws-section-content'
  const service = visit._service
  const numbers = systemNumbersOf(visit)
  const target = numbers.includes(selectedSystem) ? selectedSystem : null
  const selection = target == null ? service.default : effectiveSystemService(service, target)

  const head = document.createElement('div')
  head.className = 'ws-panel-head'
  const title = document.createElement('span')
  title.className = 'ws-panel-title'
  title.textContent = 'Service'
  head.appendChild(title)
  if (numbers.length > 1) {
    const scope = document.createElement('span')
    scope.className = 'ws-panel-note'
    const customCount = numbers.filter(n => isCustomSystemService(service, n)).length
    if (target != null) {
      scope.textContent = `System ${target} · ${isCustomSystemService(service, target) ? 'custom' : 'default'}`
    } else {
      scope.textContent = customCount
        ? `${numbers.length - customCount} use default · ${customCount} custom`
        : `applies to all ${numbers.length} systems`
    }
    head.appendChild(scope)
    if (target != null && isCustomSystemService(service, target)) {
      const reset = document.createElement('button')
      reset.type = 'button'
      reset.className = 'ws-svc-reset'
      reset.textContent = '↺'
      reset.setAttribute('aria-label', `Reset system ${target} to the default`)
      reset.addEventListener('click', () => {
        resetSystemService(service, target)
        afterServiceChange()
      })
      head.appendChild(reset)
    }
  }
  wrap.appendChild(head)

  const tap = key => () => {
    tapService(service, target, key)
    afterServiceChange()
  }
  const tiles = document.createElement('div')
  tiles.className = 'ws-btn-grid ws-btn-grid--3'
  ;[['ac', 'AC'], ['heat', 'HEAT'], ['prestart', 'PRESTART']].forEach(([key, label]) => {
    const btn = document.createElement('button')
    const on = selection[key] === true
    btn.className = `ws-item-btn${on ? (key === 'ac' ? ' ws-item-btn--ac' : key === 'heat' ? ' ws-item-btn--heat' : ' ws-item-btn--active') : ''}`
    btn.textContent = label
    btn.setAttribute('aria-pressed', String(on))
    btn.disabled = service.driveRun
    btn.addEventListener('click', tap(key))
    tiles.appendChild(btn)
  })
  wrap.appendChild(tiles)

  const mods = document.createElement('div')
  mods.className = 'ws-btn-grid ws-btn-grid--modifiers'
  const modifiers = [['finish', 'Finish']]
  if (selection.ac || selection.heat) modifiers.push(['temporarily', 'Temporarily'])
  modifiers.forEach(([key, label]) => {
    const btn = document.createElement('button')
    const on = selection[key] === true
    btn.className = `ws-item-btn ws-btn--modifier${on ? ' ws-item-btn--active' : ''}`
    btn.textContent = label
    btn.setAttribute('aria-pressed', String(on))
    btn.disabled = service.driveRun
    btn.addEventListener('click', tap(key))
    mods.appendChild(btn)
  })
  wrap.appendChild(mods)

  const hint = service.driveRun
    ? 'Drive Run active — services, T-stat, Accessories, Fixes and Weigh-In are locked. Tap Drive Run to turn it off.'
    : selection.prestart ? 'Prestart is exclusive — it can’t combine with other services.' : ''
  if (hint) {
    const hintEl = document.createElement('p')
    hintEl.className = 'ws-svc-hint'
    hintEl.textContent = hint
    wrap.appendChild(hintEl)
  }

  const drive = document.createElement('button')
  drive.className = `ws-item-btn ws-drive-btn${service.driveRun ? ' ws-item-btn--active' : ''}`
  drive.textContent = 'Drive Run'
  drive.setAttribute('aria-pressed', String(service.driveRun))
  drive.addEventListener('click', toggleDriveRun)
  wrap.appendChild(drive)
  return wrap
}

function serviceSelectionLabel (selection) {
  const name = systemServiceName(selection)
  if (!name) return null
  const extras = []
  if (selection.finish && name !== 'Finish') extras.push('Finish')
  if (selection.temporarily && (selection.ac || selection.heat)) extras.push('Temporarily')
  return [name, ...extras].join(' · ')
}

function afterServiceChange () {
  repriceVisit()
  refreshSection('service')
}

function afterItemChange (sectionId) {
  repriceVisit()
  refreshSection(sectionId)
}

// Local-first pricing (docs/OFFLINE-FIRST-CONTRACT.md): every edit reprices the
// draft on the device with the shared pricing module and the cached catalog.
// The server recomputes from its own catalog when the Report is submitted and
// records any difference (PP-01).
function repriceVisit () {
  if (!visit) return
  const service = visit._service
  const numbers = systemNumbersOf(visit)
  const customNames = new Set(catalogItems.filter(entry => entry.custom_price).map(entry => entry.item_name))
  const result = priceVisit({
    services: service.cancel ? [] : serviceRowsFromState(service, numbers),
    items: (visit._items ?? []).map(item => ({
      itemName: item.item_name,
      category: item.category,
      description: item.description ?? null,
      quantity: item.quantity ?? 1,
      price: customNames.has(item.item_name) ? item.price : undefined,
    })),
    systemCount: numbers.length,
    catalog: { services: catalogServices, items: catalogItems },
    overrides: priceOverrides,
  })
  service.rows = result.services
  visit._items = (visit._items ?? []).map((item, index) => ({
    ...item,
    price: result.items[index].price,
    tech_supplied: result.items[index].techSupplied,
  }))
  updatePrice(service.cancel || isCancelMode() ? 0 : result.total)
}

// Drive Run replaces every service on the call and clears the other work
// sections; Notes and photos stay. One confirmation, only when something
// would be cleared.
async function toggleDriveRun () {
  const service = visit._service
  if (service.driveRun) {
    setDriveRun(service, false)
    afterServiceChange()
    return
  }
  const hasWork = hasServiceSelection(service, systemNumbersOf(visit)) ||
    (visit._items ?? []).length > 0 ||
    (visit._weighInData ?? []).length > 0 ||
    Object.values(visit._checklist ?? {}).some(answer => answer != null)
  if (hasWork && !await confirmDriveRun()) return
  setDriveRun(service, true)
  selectedSystem = null
  await clearWorkForDriveRun()
  afterServiceChange()
}

function confirmDriveRun () {
  return new Promise((resolve) => {
    const overlay = makeOverlay(() => { overlay.remove(); resolve(false) })
    const modal = makeModal('Drive Run')
    const note = document.createElement('p'); note.className = 'ws-modal-note'
    note.textContent = 'Drive Run replaces every service on the call and clears T-stat, Accessories, Fixes, Weigh-In and the checklist. Notes and photos stay.'
    const actions = makeActions([
      { label: 'Keep working', cls: 'secondary', fn: () => { overlay.remove(); resolve(false) } },
      { label: 'Drive Run', cls: 'primary', fn: () => { overlay.remove(); resolve(true) } },
    ])
    modal.appendChild(note); modal.appendChild(actions)
    overlay.appendChild(modal)
    document.getElementById('ws-screen')?.appendChild(overlay)
  })
}

function clearWorkForDriveRun () {
  visit._items = []
  visit._weighInData = []
  visit._weighinDone = false
  visit._checklist = {}
  completedSections.clear()
  visit._completedSteps = []
}

async function beginCancel () {
  if (isCancelMode()) return
  const confirmed = await showCancelConfirmation(document.getElementById('ws-screen'))
  if (!confirmed) return
  enterLocalVisitDraftCancelMode(visit)
  activeStep = 'notes'
  completedSections.clear()
  updatePrice(0)
  await persistCurrentDraft({ touch: false })
  renderBody()
}

// T-stat: tapping a model toggles it; each selected model has its own
// quantity row (1–4 quick picks, + for more) and its own report line.
function buildThermostatSection () {
  const wrap = document.createElement('div')
  wrap.className = 'ws-section-content'
  const tstatItems = catalogItems.filter(i => i.category === 'thermostat')
  const selected   = (visit._items ?? []).filter(i => i.category === 'thermostat')
  const preSpec    = visit.pre_specified_thermostat

  const head = document.createElement('div')
  head.className = 'ws-panel-head'
  const title = document.createElement('span')
  title.className = 'ws-panel-title'
  title.textContent = 'T-stat'
  const summary = document.createElement('span')
  summary.className = 'ws-panel-note'
  summary.textContent = selected.length ? selected.map(i => `${i.item_name} × ${i.quantity}`).join(' · ') : 'none'
  head.append(title, summary)
  wrap.appendChild(head)

  const picker = document.createElement('div')
  picker.className = 'ws-tstat-picker'
  tstatItems.forEach((item) => {
    const isActive = selected.some(i => i.item_name === item.item_name)
    const row = document.createElement('button')
    row.type = 'button'
    row.className = `ws-tstat-opt${isActive ? ' ws-tstat-opt--on' : ''}`
    row.setAttribute('aria-pressed', String(isActive))
    row.disabled = isDriveRunMode()
    row.textContent = item.item_name
    if (!isActive && preSpec === item.item_name) {
      const pre = document.createElement('span'); pre.className = 'ws-pre-label'; pre.textContent = 'suggested'
      row.appendChild(pre)
    }
    row.addEventListener('click', () => toggleThermostat(item))
    picker.appendChild(row)
  })
  wrap.appendChild(picker)

  selected.forEach((item) => {
    const row = document.createElement('div')
    row.className = 'ws-tqty-row'
    const name = document.createElement('span'); name.className = 'ws-tqty-name'; name.textContent = item.item_name
    row.appendChild(name)
    ;[1, 2, 3, 4].forEach((qty) => {
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.className = `ws-tqty-btn${item.quantity === qty ? ' ws-tqty-btn--on' : ''}`
      btn.textContent = String(qty)
      btn.setAttribute('aria-label', `${item.item_name} quantity ${qty}`)
      btn.addEventListener('click', () => setThermostatQuantity(item, qty))
      row.appendChild(btn)
    })
    const more = document.createElement('button')
    more.type = 'button'
    more.className = `ws-tqty-btn${item.quantity > 4 ? ' ws-tqty-btn--on' : ''}`
    more.textContent = item.quantity > 4 ? String(item.quantity) : '+'
    more.setAttribute('aria-label', `${item.item_name} quantity ${Math.max(4, item.quantity) + 1}`)
    more.addEventListener('click', () => setThermostatQuantity(item, Math.max(4, item.quantity) + 1))
    row.appendChild(more)
    wrap.appendChild(row)
  })
  return wrap
}

function toggleThermostat (item) {
  const existing = (visit._items ?? []).find(i => i.category === 'thermostat' && i.item_name === item.item_name)
  if (existing) removeLocalVisitDraftItem(visit, existing.id, itemRelations)
  else addLocalVisitDraftItem(visit, item, { quantity: 1, catalogItems, itemRelations })
  afterItemChange('thermostat')
}

function setThermostatQuantity (item, quantity) {
  if (!setLocalVisitDraftItemQuantity(visit, item.id, quantity)) return
  afterItemChange('thermostat')
}

function buildItemsSection (category) {
  const wrap = document.createElement('div')
  wrap.className = 'ws-section-content'
  const isCancelled = isCancelMode()
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
          removeLocalVisitDraftItem(visit, existing.id, itemRelations)
          afterItemChange(sectionId)
        }
        return
      }
      if (item.custom_price) { showCustomPriceModal(item, ({ price, description }) => addItem(item, category, 1, price, description)); return }
      addItem(item, category, 1)
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

function addItem (item, category, quantity, customPrice, description) {
  addLocalVisitDraftItem(visit, item, { quantity, price: customPrice, description, catalogItems, itemRelations })
  afterItemChange(category === 'accessory' ? 'accessories' : 'fixes')
}

function showCustomPriceModal (item, onConfirm) {
  const overlay = makeOverlay()
  const modal = makeModal(item.item_name)
  const requiresDescription = item.item_name === 'Other' || item.item_name === 'Other Fix'
  let descriptionInput
  if (requiresDescription) {
    descriptionInput = document.createElement('input')
    descriptionInput.type = 'text'; descriptionInput.placeholder = 'Enter description'; descriptionInput.className = 'ws-price-input'
    modal.appendChild(descriptionInput)
  }
  const input = document.createElement('input')
  input.type = 'number'; input.min = '0'; input.step = '0.01'
  input.placeholder = 'Enter price'; input.className = 'ws-price-input'
  modal.appendChild(input)
  const actions = makeActions([
    { label: 'Cancel', cls: 'secondary', fn: () => overlay.remove() },
    { label: 'Add', cls: 'primary', fn: () => {
      const price = parseFloat(input.value)
      const description = descriptionInput?.value.trim()
      if (isNaN(price) || price < 0 || (requiresDescription && !description)) return
      overlay.remove(); onConfirm({ price, description })
    }},
  ])
  modal.appendChild(actions)
  overlay.appendChild(modal)
  document.getElementById('ws-screen')?.appendChild(overlay)
  setTimeout(() => (descriptionInput ?? input).focus(), 50)
}

function buildWeighInSection () {
  const wrap = document.createElement('div')
  wrap.className = 'ws-section-content'
  const count = systemNumbersOf(visit).length
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
    ['condenserSatTemp','Condenser sat temp'],['subcoolingValue','Subcooling'],['oemSubcoolingGoal','OEM subcooling goal (°F)'],
  ]
  const numericKeys = NUMERIC_FIELDS.map(f => f[0])
  const savedWeighIn = (visit._weighInData ?? []).find(data => data.systemNumber === systemNum)

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

    // Computed on the device from the cached catalog (local-first); the
    // measurements travel in the Report snapshot.
    if (cfg && body.linesetLength != null) {
      body.approxAdjustOz = (body.linesetLength - cfg.reference_length_ft) * cfg.adjust_rate_oz_per_ft
    }
    const equipment = equipmentCatalog.find(e => e.model === outdoorModel)
    if (equipment) {
      body.factoryChargeOz = (body.factoryChargeUsed === 'revised' ? equipment.revised_charge_oz : equipment.factory_charge_oz) ?? null
    }
    body.oemSubcoolingGoal = body.oemSubcoolingGoal ?? 10
    if (body.subcoolingValue != null) body.subcoolingDeviation = body.subcoolingValue - body.oemSubcoolingGoal

    const currentWeighIn = (visit._weighInData ?? []).find(
      data => (data.systemNumber ?? data.system_number) === systemNum
    )
    visit._weighInData = [
      ...(visit._weighInData ?? []).filter(
        data => (data.systemNumber ?? data.system_number) !== systemNum
      ),
      { ...(currentWeighIn ?? {}), ...body, systemNumber: systemNum },
    ]
    await persistCurrentDraft()
  }

  // Numeric fields
  NUMERIC_FIELDS.forEach(([key, label]) => {
    const row = document.createElement('div'); row.className='ws-field-row'
    const lbl = document.createElement('label'); lbl.className='ws-field-label'; lbl.textContent=label; lbl.setAttribute('for',`wi-${systemNum}-${key}`)
    const input = document.createElement('input')
    input.type='number'; input.id=`wi-${systemNum}-${key}`; input.className='ws-field-input'; input.inputMode='decimal'
    if (savedWeighIn?.[key] != null) input.value = savedWeighIn[key]
    else if (key === 'oemSubcoolingGoal') input.value = '10'
    input.addEventListener('blur', syncWeighIn)
    row.appendChild(lbl); row.appendChild(input); panel.appendChild(row)
  })

  // Read-only deviation is derived from measured subcooling and the editable OEM goal.
  const deviationRow = document.createElement('div'); deviationRow.className='ws-field-row'
  const deviationLbl = document.createElement('label'); deviationLbl.className='ws-field-label'
  deviationLbl.textContent = 'SC deviation (°F)'; deviationLbl.setAttribute('for', `wi-${systemNum}-subcoolingDeviation`)
  const deviationOutput = document.createElement('output')
  deviationOutput.id = `wi-${systemNum}-subcoolingDeviation`
  deviationOutput.className = 'ws-field-input'
  deviationOutput.setAttribute('aria-live', 'polite')
  function updateSubcoolingDeviation () {
    const measured = parseFloat(document.getElementById(`wi-${systemNum}-subcoolingValue`)?.value)
    const goal = parseFloat(document.getElementById(`wi-${systemNum}-oemSubcoolingGoal`)?.value)
    deviationOutput.textContent = Number.isFinite(measured) && Number.isFinite(goal)
      ? (measured - goal).toFixed(1)
      : '—'
  }
  ;['subcoolingValue', 'oemSubcoolingGoal'].forEach(key => {
    document.getElementById(`wi-${systemNum}-${key}`)?.addEventListener('input', updateSubcoolingDeviation)
  })
  updateSubcoolingDeviation()
  deviationRow.appendChild(deviationLbl); deviationRow.appendChild(deviationOutput); panel.appendChild(deviationRow)

  // Lineset config dropdown
  const configRow = document.createElement('div'); configRow.className='ws-field-row'
  const configLbl = document.createElement('label'); configLbl.className='ws-field-label'; configLbl.textContent='Lineset config'; configLbl.setAttribute('for',`wi-${systemNum}-config`)
  const configSel = document.createElement('select'); configSel.id=`wi-${systemNum}-config`; configSel.className='ws-field-input'
  const emptyOpt = document.createElement('option'); emptyOpt.value=''; emptyOpt.textContent='— select —'
  configSel.appendChild(emptyOpt)
  linesetConfigs.forEach(cfg => {
    const opt = document.createElement('option'); opt.value=cfg.config_key; opt.textContent=cfg.config_key
    configSel.appendChild(opt)
  })
  const selectedConfig = savedWeighIn?.factoryLineConfig ?? preselect
  if (selectedConfig) configSel.value = selectedConfig
  configRow.appendChild(configLbl); configRow.appendChild(configSel); panel.appendChild(configRow)

  // Factory/revised row — only visible when selected config has revised_available=true
  const chargeRow = document.createElement('div'); chargeRow.className='ws-field-row'
  const chargeLbl = document.createElement('label'); chargeLbl.className='ws-field-label'; chargeLbl.textContent='Charge'; chargeLbl.setAttribute('for',`wi-${systemNum}-charge`)
  const chargeSel = document.createElement('select'); chargeSel.id=`wi-${systemNum}-charge`; chargeSel.className='ws-field-input'
  ;[['factory','Factory'],['revised','Revised']].forEach(([val, txt]) => {
    const opt = document.createElement('option'); opt.value=val; opt.textContent=txt; chargeSel.appendChild(opt)
  })
  const equipment = equipmentCatalog.find(e => e.model === outdoorModel)
  if (savedWeighIn?.factoryChargeOz != null && equipment?.revised_charge_oz != null &&
      savedWeighIn.factoryChargeOz === equipment.revised_charge_oz) {
    chargeSel.value = 'revised'
  }
  chargeSel.addEventListener('change', syncWeighIn)
  chargeRow.appendChild(chargeLbl); chargeRow.appendChild(chargeSel); panel.appendChild(chargeRow)

  function updateChargeVisibility (configKey) {
    const cfg = linesetConfigs.find(c => c.config_key === configKey)
    chargeRow.classList.toggle('hidden', !cfg?.revised_available)
  }
  updateChargeVisibility(selectedConfig ?? '')
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
    const coords = await photoGps(tag, file)
    try {
      const ref = await keepPhoto({
        visitId: visit.id, technicianId: getActiveTechnicianId() ?? visit.technicianId,
        blob: compressed, fileName: file.name, tag, category, systemNumber: Number(systemNum),
        street: visit.address?.street, lat: coords?.lat ?? null, lon: coords?.lon ?? null,
      })
      visit.evidenceRefs = [...(visit.evidenceRefs ?? []), ref]
      visit._photoCount = (visit._photoCount ?? 0) + 1
      visit._weighInPhotos = visit._weighInPhotos ?? {}
      visit._weighInPhotos[`${systemNum}-${tag}`] = true
      await persistCurrentDraft({ touch: false })
      void uploadPendingPhotos()
    } catch (err) { console.error('Weigh-in photo could not be saved:', err); btn.classList.remove('ws-item-btn--active') }
  })
  input.click()
}

function buildCalcSection () {
  const wrap = document.createElement('div')
  wrap.className = 'ws-section-content'
  const count = systemNumbersOf(visit).length
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
      toggleLocalVisitDraftChecklist(visit, item.key, val)
      persistCurrentDraft({ touch: false })
      refreshSection('startup')
    })
    btnGroup.appendChild(btn)
  })
  row.appendChild(lbl); row.appendChild(btnGroup); wrap.appendChild(row)
  if (item.reminder) {
    const reminder = document.createElement('p'); reminder.className='ws-check-reminder'; reminder.textContent=item.reminder
    wrap.appendChild(reminder)
  }
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
    try {
      const ref = await keepPhoto({
        visitId: visit.id, technicianId: getActiveTechnicianId() ?? visit.technicianId,
        blob: compressed, fileName: file.name, tag: itemKey.toUpperCase(), category: 'site_evidence',
        street: visit.address?.street,
      })
      visit.evidenceRefs = [...(visit.evidenceRefs ?? []), ref]
      visit._checklistPhotoCounts = visit._checklistPhotoCounts ?? {}
      visit._checklistPhotoCounts[itemKey] = (visit._checklistPhotoCounts[itemKey] ?? 0) + 1
      visit._photoCount = (visit._photoCount ?? 0) + 1
      const count = visit._checklistPhotoCounts[itemKey]
      btn.textContent = `📷 ${count} photo${count !== 1 ? 's' : ''}`
      await persistCurrentDraft({ touch: false })
      void uploadPendingPhotos()
    } catch (err) { console.error('Checklist photo could not be saved:', err) }
  })
  input.click()
}

function buildNotesSection () {
  const wrap = document.createElement('div'); wrap.className='ws-section-content'
  const textarea = document.createElement('textarea')
  textarea.className='ws-notes-input'; textarea.placeholder='Field notes, observations…'
  textarea.value = visit.notes ?? ''; textarea.rows=5
  textarea.addEventListener('input', () => {
    updateLocalVisitDraftNotes(visit, textarea.value)
    scheduleNotesDraftSave()
  })
  textarea.addEventListener('blur', async () => {
    updateLocalVisitDraftNotes(visit, textarea.value)
    await flushNotesDraftSave()
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

async function getGpsFromPhoto (file) {
  try {
    // Bundled with the app (precached), so it also works offline.
    const exifr = await import('../vendor/exifr-lite.mjs')
    const result = await exifr.gps(file)
    if (result?.latitude && result?.longitude) {
      return { lat: result.latitude.toFixed(6), lon: result.longitude.toFixed(6) }
    }
  } catch {}
  return null
}

// SCALE and FAN photos need GPS (embedded by the server on upload).
async function photoGps (tag, file) {
  if (tag !== 'SCALE' && tag !== 'FAN') return null
  const fromPhoto = await getGpsFromPhoto(file)
  const coords = fromPhoto ?? (gps.lat ? { lat: gps.lat, lon: gps.lon } : null)
  if (!coords) _gpsPhotosMissing++
  return coords
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

async function openGenerateModal () {
  if (isCancelMode() && isCancelJustificationMissing({ notes: visit.notes, checklist: visit._checklist })) {
    showCancelJustificationBlock()
    return
  }
  repriceVisit()
  await persistCurrentDraft({ touch: false })
  if (!isCancelMode()) {
    const numbers = systemNumbersOf(visit)
    const missing = missingServiceSystems(visit._service, numbers)
    if (missing.length) {
      showServiceMissingBlock(numbers.length > 1 ? `System ${missing.join(', ')}: no service selected` : 'No service selected')
      return
    }
  }
  openGenerateModalDirect().catch(err => console.error('Could not open the report review:', err))
}

function showServiceMissingBlock (message) {
  const overlay = makeOverlay()
  const modal = makeModal('Service missing')
  const note = document.createElement('p'); note.className = 'ws-modal-note'
  note.textContent = `${message}. Choose a service, or Drive Run, before generating this report.`
  const actions = makeActions([
    { label: 'Go to Service', cls: 'primary', fn: () => { overlay.remove(); goToStep('service') } },
  ])
  modal.appendChild(note); modal.appendChild(actions)
  overlay.appendChild(modal)
  document.getElementById('ws-screen')?.appendChild(overlay)
}

function showCancelJustificationBlock () {
  const overlay = makeOverlay()
  const modal = makeModal('Add Notes or Checklist')
  const note = document.createElement('p'); note.className='ws-modal-note'
  note.textContent = 'Add a note or answer at least one checklist item before generating this report.'
  const actions = makeActions([
    { label: 'OK', cls: 'primary', fn: () => overlay.remove() },
  ])
  modal.appendChild(note); modal.appendChild(actions)
  overlay.appendChild(modal)
  document.getElementById('ws-screen')?.appendChild(overlay)
}

// W4: Generate Report opens the receipt the Report will carry, stamped DRAFT,
// with Edit (back to the Workspace) and Confirm & send.
async function openGenerateModalDirect () {
  const activeTechnicianId = getActiveTechnicianId() ?? visit.technicianId
  await persistCurrentDraft({ touch: false })
  const draft = await getLocalVisitDraft(visit.id, activeTechnicianId) ?? visit
  const checklistAnswers = buildChecklistAnswers()
  const preview = createCompletionSnapshot(draft, { checklistAnswers, technicianId: activeTechnicianId })

  const overlay = document.createElement('div'); overlay.className = 'ws-review'
  const title = document.createElement('h2'); title.className = 'ws-review-title'; title.textContent = 'Review before sending'
  overlay.appendChild(title)
  overlay.appendChild(Receipt(receiptModel(preview, {
    catalog: { services: catalogServices, items: catalogItems },
    technicianName: technicianName(),
  }), { draft: true }))
  if (_gpsPhotosMissing > 0) {
    const gpsWarn = document.createElement('p'); gpsWarn.className='ws-modal-note ws-modal-note--warn'
    gpsWarn.textContent = 'GPS required for SCALE and FAN photos. Retake or enable location access.'
    overlay.appendChild(gpsWarn)
  }
  const actions = makeActions([
    { label: 'Edit', cls: 'secondary', fn: () => overlay.remove() },
    { label: 'Confirm & send', cls: 'primary', fn: async (btn) => {
      btn.disabled=true; btn.textContent='Saving report…'
      try {
        // Persist the immutable submission before any transport attempt. A
        // retry will use this record, never the mutable Workspace draft.
        const submission = await createPendingCompletionSubmission(draft, { checklistAnswers, technicianId: activeTechnicianId })
        try {
          await deliverCompletionSubmission(submission, { activeTechnicianId })
        } catch (err) {
          if (navigator.onLine) console.warn('Report saved locally; delivery remains pending:', err)
        }
        overlay.remove()
        sessionStorage.removeItem('workspace:visitId')
        window.dispatchEvent(new CustomEvent('app:navigate', { detail: { route: '/reports' } }))
      } catch (err) {
        btn.disabled=false; btn.textContent='Confirm & send'
        console.error('Could not save report locally:', err)
      }
    }},
  ])
  if (_gpsPhotosMissing > 0) {
    const submitBtn = actions.querySelector('.ws-modal-btn--primary')
    if (submitBtn) submitBtn.disabled = true
  }
  overlay.appendChild(actions)
  const note = document.createElement('p'); note.className='ws-modal-note ws-review-note'
  note.textContent = 'Corrections require a request after sending.'
  overlay.appendChild(note)
  document.getElementById('ws-screen')?.appendChild(overlay)
}

function technicianName () {
  try { return JSON.parse(localStorage.getItem('technician') ?? 'null')?.name ?? null } catch { return null }
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
  const displayName = item.description ?? item.item_name
  name.textContent = item.quantity > 1 ? `${displayName} × ${item.quantity}` : displayName
  const right = document.createElement('div'); right.className='ws-chip-right'
  if (item.price) {
    const price = document.createElement('span'); price.className='ws-chip-price'
    price.textContent = `$${Number(item.price).toFixed(2)}`; right.appendChild(price)
  }
  const del = document.createElement('button'); del.className='ws-chip-del'; del.textContent='×'
  del.addEventListener('click', () => {
    removeLocalVisitDraftItem(visit, item.id, itemRelations)
    afterItemChange(item.category==='thermostat' ? 'thermostat' : item.category==='accessory' ? 'accessories' : 'fixes')
  })
  right.appendChild(del); chip.appendChild(name); chip.appendChild(right)
  return chip
}

// Called by the (unchanged) content-builder functions after a data change.
// sectionId may be a pre-merge id (e.g. 'thermostat', 'startup') — map it to
// the step that now owns it and re-render if that step is the one showing.
function refreshSection (sectionId) {
  // Legacy mutation handlers update the same runtime draft before they
  // re-render. Persist that authoritative local state without recalculating.
  persistCurrentDraft({ touch: false })
  const stepId = SECTION_TO_STEP[sectionId] ?? sectionId
  if (stepId === activeStep) renderBody()
}

function persistCurrentDraft ({ touch = true } = {}) {
  if (!visit) return Promise.resolve()
  if (touch) markLocalVisitDraftDirty(visit)
  const activeTechnicianId = getActiveTechnicianId() ?? visit.technicianId
  return saveLocalVisitDraft(visit, activeTechnicianId).catch(err => console.error('Local draft save failed:', err))
}

function scheduleNotesDraftSave () {
  clearTimeout(notesDraftTimer)
  notesDraftTimer = setTimeout(() => { persistCurrentDraft({ touch: false }) }, 250)
}

async function flushNotesDraftSave () {
  clearTimeout(notesDraftTimer)
  await persistCurrentDraft({ touch: false })
}

async function navigateBack () {
  await flushNotesDraftSave()
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
  style.textContent = calcPanelStyles + receiptStyles + `
  .ws-tools{position:absolute;right:var(--space-4);bottom:calc(10px + env(safe-area-inset-bottom,0px));display:flex;flex-direction:column;gap:8px;z-index:3;}
  .ws-tool-btn{width:44px;height:44px;border:none;border-radius:var(--fo-radius-md);background:var(--fo-panel);box-shadow:var(--fo-shadow-raised);color:var(--fo-accent-deep);display:grid;place-items:center;cursor:pointer;-webkit-tap-highlight-color:transparent;}
  .ws-screen{display:flex;flex-direction:column;height:100dvh;background:var(--fo-panel);overflow:hidden;position:relative;font-family:var(--fo-font-body);}
  .ws-loading{display:flex;align-items:center;justify-content:center;height:100dvh;font-size:var(--text-base);color:var(--fo-ink-soft);background:var(--fo-panel);}
  .ws-header{display:flex;flex-direction:column;padding:calc(var(--space-5) + env(safe-area-inset-top,0px)) var(--space-4) var(--space-2);background:var(--fo-panel);flex-shrink:0;}
  .ws-header-top{display:flex;align-items:flex-start;gap:var(--space-3);}
  .ws-back-btn{background:var(--fo-panel);box-shadow:var(--fo-shadow-raised);border:none;color:var(--fo-ink-soft);font-size:18px;cursor:pointer;padding:var(--space-2);border-radius:var(--fo-radius-sm);line-height:1;-webkit-tap-highlight-color:transparent;flex-shrink:0;}
  .ws-header-info{flex:1;min-width:0;}
  .ws-header-addr{font-size:var(--text-base);font-weight:600;color:var(--fo-ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
  .ws-header-addr--nav{cursor:pointer;color:var(--fo-accent-deep);text-decoration:underline;text-decoration-style:dotted;text-underline-offset:2px;-webkit-tap-highlight-color:transparent;}
  .ws-active-job-banner{display:flex;align-items:center;gap:var(--space-3);margin:0 var(--space-3) var(--space-2);padding:var(--space-3);background:var(--fo-panel);box-shadow:var(--fo-shadow-raised);border-radius:var(--fo-radius-sm);flex-shrink:0;}
  .ws-active-job-info{flex:1;min-width:0;}
  .ws-active-job-address{font-size:var(--text-sm);font-weight:600;color:var(--fo-ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
  .ws-active-job-meta{font-size:var(--text-xs);color:var(--fo-ink-soft);font-family:var(--fo-font-mono);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:2px;}
  .ws-active-job-actions{display:flex;align-items:center;gap:var(--space-2);flex-shrink:0;}
  .ws-active-job-price{font-size:var(--text-base);font-weight:800;font-family:var(--fo-font-mono);color:var(--fo-accent-deep);}
  .ws-active-job-cancel-btn{background:var(--fo-well);box-shadow:var(--fo-shadow-well);border:none;color:var(--fo-no);font-size:13px;font-weight:700;cursor:pointer;width:24px;height:24px;border-radius:50%;line-height:1;-webkit-tap-highlight-color:transparent;}
  .ws-body{flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch;overscroll-behavior:contain;padding:var(--space-2) var(--space-3) calc(var(--space-4) + 60px);display:flex;flex-direction:column;gap:var(--space-2);}
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
  .ws-review{position:absolute;inset:0;z-index:50;overflow-y:auto;background:var(--fo-panel);padding:calc(var(--space-5) + env(safe-area-inset-top,0px)) 14px calc(var(--space-6) + env(safe-area-inset-bottom,0px));display:flex;flex-direction:column;gap:var(--space-3);}
  .ws-review-title{margin:4px 2px 0;font:800 18px var(--fo-font-body);color:var(--fo-ink);}
  .ws-review .ws-modal-actions{margin-top:var(--space-2);}
  .ws-review-note{text-align:center;}
  .ws-modal-overlay{position:absolute;inset:0;background:var(--fo-scrim);display:flex;align-items:flex-end;z-index:50;}
  .ws-modal{width:100%;background:var(--fo-panel);box-shadow:var(--fo-shadow-card);border-radius:var(--fo-radius) var(--fo-radius) 0 0;padding:var(--space-5);display:flex;flex-direction:column;gap:var(--space-3);padding-bottom:calc(var(--space-5) + env(safe-area-inset-bottom,0px));}
  .ws-modal-title{font-size:var(--text-md);font-weight:700;color:var(--fo-ink);}
  .ws-modal-summary{background:var(--fo-well);box-shadow:var(--fo-shadow-well);border-radius:var(--fo-radius-sm);padding:var(--space-3);display:flex;flex-direction:column;gap:var(--space-2);}
  .ws-sys-switch{display:flex;gap:2px;padding:3px;border-radius:999px;box-shadow:var(--fo-shadow-inset);}
  .ws-sys-btn{position:relative;min-width:36px;height:36px;border:none;border-radius:999px;background:none;color:var(--fo-ink-soft);font-family:var(--fo-font-mono);font-size:var(--text-sm);font-weight:700;cursor:pointer;-webkit-tap-highlight-color:transparent;}
  .ws-sys-btn--on{background:var(--fo-panel);box-shadow:var(--fo-shadow-raised);color:var(--fo-accent-deep);}
  .ws-sys-btn--custom::after{content:'';position:absolute;top:5px;right:5px;width:6px;height:6px;border-radius:50%;background:var(--fo-accent);}
  .ws-panel-head{display:flex;align-items:center;gap:var(--space-2);min-height:28px;}
  .ws-panel-title{font-family:var(--fo-font-body);font-size:var(--text-sm);font-weight:800;color:var(--fo-ink);}
  .ws-panel-note{flex:1;text-align:right;font-family:var(--fo-font-mono);font-size:var(--text-xs);color:var(--fo-ink-soft);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
  .ws-svc-reset{width:36px;height:36px;border:none;border-radius:var(--fo-radius-sm);background:var(--fo-panel);box-shadow:var(--fo-shadow-raised);color:var(--fo-accent-deep);font-size:16px;cursor:pointer;flex-shrink:0;}
  .ws-btn-grid--3{display:grid;grid-template-columns:repeat(3,1fr);}
  .ws-svc-hint{font-size:var(--text-xs);color:var(--fo-accent-deep);font-family:var(--fo-font-mono);}
  .ws-drive-btn{flex:none;width:100%;}
  .ws-tstat-picker{max-height:176px;overflow-y:auto;padding:4px;border-radius:var(--fo-radius-sm);box-shadow:var(--fo-shadow-well);display:flex;flex-direction:column;gap:2px;}
  .ws-tstat-opt{display:flex;align-items:center;justify-content:space-between;width:100%;min-height:44px;flex-shrink:0;padding:0 var(--space-3);border:none;border-radius:var(--fo-radius-sm);background:none;color:var(--fo-ink);font-family:var(--fo-font-mono);font-size:var(--text-sm);font-weight:600;text-align:left;cursor:pointer;-webkit-tap-highlight-color:transparent;}
  .ws-tstat-opt:disabled{opacity:.35;cursor:not-allowed;}
  .ws-tstat-opt--on{background:var(--fo-panel);box-shadow:var(--fo-shadow-raised);color:var(--fo-accent-deep);}
  .ws-tqty-row{display:flex;align-items:center;gap:6px;}
  .ws-tqty-name{flex:1;min-width:0;font-family:var(--fo-font-mono);font-size:var(--text-sm);font-weight:600;color:var(--fo-ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
  .ws-tqty-btn{width:44px;height:44px;flex-shrink:0;border:none;border-radius:var(--fo-radius-sm);background:var(--fo-tile);box-shadow:var(--fo-shadow-raised);color:var(--fo-ink-soft);font-family:var(--fo-font-mono);font-size:var(--text-sm);font-weight:700;cursor:pointer;-webkit-tap-highlight-color:transparent;}
  .ws-tqty-btn--on{box-shadow:var(--fo-shadow-inset);color:var(--fo-accent-deep);}
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
  .ws-check-reminder{margin:0 0 0 2px;font-size:var(--text-xs);color:var(--fo-ink-soft);line-height:1.3;}
  .ws-check-btns{display:flex;gap:6px;flex-shrink:0;}
  .ws-check-btn{padding:5px 14px;border-radius:var(--fo-radius-sm);border:none;background:var(--fo-tile);box-shadow:var(--fo-shadow-raised);color:var(--fo-ink-soft);font-size:var(--text-sm);font-weight:500;cursor:pointer;-webkit-tap-highlight-color:transparent;}
  .ws-check-btn--active{box-shadow:var(--fo-shadow-inset);}
  .ws-check-btns .ws-check-btn--active:first-child{color:var(--fo-ok);}
  .ws-check-btns .ws-check-btn--active:last-child{color:var(--fo-no);}
  .ws-check-photo-row{padding-left:2px;}
  .ws-check-photo-btn{background:var(--fo-well);box-shadow:var(--fo-shadow-well);border:none;border-radius:var(--fo-radius-sm);color:var(--fo-no);font-size:var(--text-sm);padding:4px 10px;cursor:pointer;-webkit-tap-highlight-color:transparent;}
  .ws-cancel-mode-notice{font-size:var(--text-sm);line-height:1.5;color:var(--fo-ink-soft);text-align:center;padding:var(--space-5) var(--space-2);}
  ${cancelConfirmationStyles}
  `
  document.head.appendChild(style)
}
