/**
 * guided/guided.js
 * Guided module entry point. Standalone page and (later) FieldOps both call mount().
 *
 *   mount(rootEl, { context: { zones, dapc, equipment? } | null, standalone: boolean })
 *   equipment = { board, thermostat } from the call; it decides whether the guide is offered.
 *
 * The module never calls the FieldOps API; it only reads its own data files.
 */

import { getLanguage, setLanguage, t as translate } from './shared/i18n.js'
import { buildModel, focusGroup, normalizeContext, terminalConnections } from './src/model.mjs'
import { METRICS, boundsOf, computeLayout } from './src/layout.mjs'
import { createCamera, fitBox } from './src/camera.mjs'
import { WIRE_COLORS, nodeSubtitle, renderDrawing, terminalLabel } from './src/render.mjs'
import { buildSteps, guideAvailable, localized, stepForNode } from './src/guide.mjs'
import { factRow, h, renderFicha, renderItem, sourceLine } from './src/ficha.mjs'

const DATA_FILES = {
  library: new URL('./data/guided-component-library.v0.1.json', import.meta.url),
  system: new URL('./data/ut3000-comm.system.json', import.meta.url),
  guide: new URL('./data/ut3000-comm.guide.json', import.meta.url),
}
const DOUBLE_TAP_MS = 300

export async function mount (root, { context = null, standalone = false } = {}) {
  injectStyles()
  root.classList.add('gd-root')
  const t = (key, vars) => translate(key, vars)

  let data
  try {
    const [library, system, guide] = await Promise.all(
      [DATA_FILES.library, DATA_FILES.system, DATA_FILES.guide].map(url => fetch(url).then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.json()
      }))
    )
    data = { library, system, guide }
  } catch (err) {
    console.error('Guided data load failed:', err)
    root.innerHTML = ''
    root.appendChild(h('p', 'gd-error', t('guided.loadError')))
    return
  }

  // Thermostat count from the call; above maxZones (twinning) is not covered.
  const requestedZones = Number(context?.zones)
  const available = guideAvailable(data.guide, context?.equipment)
  let current = context ? normalizeContext(data.system, context) : null
  let setupOpen = !current
  let mode = 'guided'
  let rotateHintDismissed = false
  let fichasOpen = false
  render()

  function render () {
    root.innerHTML = ''
    if (fichasOpen) { root.append(buildFichasHeader(), buildFichas()); return }
    root.appendChild(buildHeader())
    if (requestedZones > data.system.maxZones) {
      root.appendChild(h('p', 'gd-banner', t('guided.zones.twinning', { count: requestedZones, max: data.system.maxZones })))
    }
    root.appendChild(setupOpen ? buildSetup() : buildView(current))
  }

  function buildHeader () {
    const header = h('header', 'gd-header')
    if (setupOpen) header.appendChild(h('h1', 'gd-title', t('guided.title')))
    else header.append(buildChip(), buildModeToggle())
    if (standalone) header.appendChild(buildLanguageToggle())
    return header
  }

  function buildFichasHeader () {
    const header = h('header', 'gd-header')
    const back = h('button', 'gd-step-btn', '‹')
    back.type = 'button'
    back.setAttribute('aria-label', t('guided.back'))
    back.addEventListener('click', () => { fichasOpen = false; render() })
    header.append(back, h('h1', 'gd-title', t('guided.fichas')))
    if (standalone) header.appendChild(buildLanguageToggle())
    return header
  }

  // Every component in the library, collapsed.
  function buildFichas () {
    const list = h('main', 'gd-fichas')
    for (const component of Object.values(data.library.components)) {
      const item = h('details', 'gd-ficha')
      const summary = h('summary', 'gd-ficha-summary', component.name)
      if (component.status === 'pending') summary.appendChild(h('span', 'gd-tag', t('guided.pending')))
      summary.appendChild(h('span', 'gd-ficha-maker', component.maker))
      item.append(summary, ...renderFicha(component, t))
      list.appendChild(item)
    }
    return list
  }

  function openFichasButton (className) {
    const button = h('button', className, t('guided.fichas'))
    button.type = 'button'
    button.addEventListener('click', () => { fichasOpen = true; render() })
    return button
  }

  // Two lines so the zone count and DAPC never truncate in portrait.
  function buildChip () {
    const chip = h('button', 'gd-chip')
    chip.type = 'button'
    chip.setAttribute('aria-label', t('guided.setup.change'))
    chip.append(
      h('span', 'gd-chip-line', zonesText(current.zones) + (current.dapc ? t('guided.summary.dapc') : '')),
      h('span', 'gd-chip-line gd-chip-sub', data.system.title)
    )
    chip.addEventListener('click', () => { setupOpen = true; render() })
    return chip
  }

  function buildModeToggle () {
    const toggle = segment(
      [{ value: 'guided', label: t('guided.mode.guided') }, { value: 'explore', label: t('guided.mode.explore') }],
      () => mode,
      value => { mode = value; render() }
    )
    toggle.classList.add('gd-mode')
    toggle.setAttribute('role', 'group')
    toggle.setAttribute('aria-label', t('guided.mode'))
    return toggle
  }

  function zonesText (n) {
    return n === 1 ? t('guided.zones.one') : t('guided.zones.other', { n })
  }

  // One button that switches to the other language; it shows the language it switches to.
  function buildLanguageToggle () {
    const next = getLanguage() === 'en' ? 'es' : 'en'
    const button = h('button', 'gd-lang', next.toUpperCase())
    button.type = 'button'
    button.setAttribute('aria-label', `${t('guided.language')}: ${next.toUpperCase()}`)
    button.addEventListener('click', () => { setLanguage(next); render() })
    return button
  }

  function buildSetup () {
    const draft = { zones: current?.zones ?? data.system.maxZones, dapc: current?.dapc ?? false }
    const card = h('section', 'gd-setup')
    card.appendChild(h('h2', 'gd-setup-heading', t('guided.setup.heading')))

    card.appendChild(h('p', 'gd-label', t('guided.setup.system')))
    card.appendChild(h('p', 'gd-setup-system', data.system.title))

    card.appendChild(h('p', 'gd-label', t('guided.setup.zones')))
    card.appendChild(segment(
      Array.from({ length: data.system.maxZones }, (_, i) => ({ value: i + 1, label: String(i + 1) })),
      () => draft.zones,
      value => { draft.zones = value }
    ))

    card.appendChild(h('p', 'gd-label', t('guided.setup.dapc')))
    card.appendChild(segment(
      [{ value: true, label: t('guided.setup.yes') }, { value: false, label: t('guided.setup.no') }],
      () => draft.dapc,
      value => { draft.dapc = value }
    ))

    const start = h('button', 'gd-primary', t('guided.setup.start'))
    start.type = 'button'
    start.addEventListener('click', () => {
      current = normalizeContext(data.system, draft)
      setupOpen = false
      render()
    })
    card.appendChild(start)
    return card
  }

  function segment (options, getValue, setValue) {
    const group = h('div', 'gd-segment')
    const buttons = options.map(option => {
      const button = h('button', 'gd-segment-btn', option.label)
      button.type = 'button'
      button.addEventListener('click', () => { setValue(option.value); sync() })
      group.appendChild(button)
      return { button, option }
    })
    function sync () {
      for (const { button, option } of buttons) button.classList.toggle('is-active', option.value === getValue())
    }
    sync()
    return group
  }

  // Explore and Guided share the drawing, camera and sheet; they differ in what
  // sets the focus (a tapped group vs. the current step) and in the bottom bar.
  function buildView (ctx) {
    const guided = mode === 'guided'
    if (guided && !available) {
      const card = h('section', 'gd-unavailable')
      card.append(h('p', null, t('guided.unavailable')), openFichasButton('gd-primary'))
      return card
    }

    const model = buildModel(data.library, data.system, ctx)
    const layout = computeLayout(model)
    const drawing = renderDrawing(model, layout, { t, metrics: METRICS })
    const camera = createCamera(drawing.svg)
    const whole = { x: 0, y: 0, w: layout.width, h: layout.height }
    const steps = guided ? buildSteps(data.guide, model) : []
    const language = getLanguage()

    let stepIndex = 0 // Guided: 0 = system map, 1..M = steps
    let focus = null
    let selected = null
    let sheetOpen = guided // the map's power-off warning is visible on entry
    let lastTap = { time: 0, x: 0, y: 0 }

    if (guided) {
      for (const [id, g] of drawing.nodeEls) g.classList.toggle('gd-target', stepForNode(steps, id) >= 0)
    }

    const wrap = h('div', 'gd-explore')
    const stage = h('main', 'gd-stage')
    stage.appendChild(drawing.svg)
    const fit = h('button', 'gd-fit', '⤢')
    fit.type = 'button'
    fit.setAttribute('aria-label', guided ? t('guided.map') : t('guided.fit'))
    fit.addEventListener('click', () => (guided ? goTo(0) : showOverview()))
    stage.appendChild(fit)
    if (!guided) stage.appendChild(openFichasButton('gd-fichas-btn'))

    const rotateHint = h('p', 'gd-rotate')
    if (guided) {
      const close = h('button', 'gd-rotate-close', '×')
      close.type = 'button'
      close.setAttribute('aria-label', t('guided.dismiss'))
      close.addEventListener('click', () => { rotateHintDismissed = true; updateRotateHint() })
      rotateHint.append(h('span', null, t('guided.landscape')), close)
      stage.appendChild(rotateHint)
    }
    wrap.appendChild(stage)

    const sheet = h('section', 'gd-sheet')
    const sheetBody = h('div', 'gd-sheet-body')
    const sheetHeader = h('button', 'gd-sheet-header')
    sheetHeader.type = 'button'
    sheetHeader.addEventListener('click', () => { sheetOpen = !sheetOpen; renderSheet() })

    const dots = h('div', 'gd-dots')
    dots.setAttribute('aria-hidden', 'true')
    const dotEls = steps.map(() => dots.appendChild(h('span', 'gd-dot')))
    const prev = stepButton('‹', t('guided.prev'), () => goTo(stepIndex - 1))
    const next = stepButton('›', t('guided.next'), () => goTo(stepIndex + 1))
    const stepTitle = h('span', 'gd-step-title')
    const stepCount = h('span', 'gd-step-count')
    sheetHeader.className = guided ? 'gd-step-label' : 'gd-sheet-header'
    if (guided) sheetHeader.append(stepTitle, stepCount)
    const bar = h('div', 'gd-bar')
    bar.append(prev, sheetHeader, next)

    if (guided) sheet.append(dots, sheetBody, bar)
    else sheet.append(sheetHeader, sheetBody)
    wrap.appendChild(sheet)

    function stepButton (label, aria, onClick) {
      const button = h('button', 'gd-step-btn', label)
      button.type = 'button'
      button.setAttribute('aria-label', aria)
      button.addEventListener('click', onClick)
      return button
    }

    // A focus frames its nodes and wires plus the board items anchored to its blocks;
    // the board footer (system LEDs, buttons) is a focus of its own.
    function target () {
      if (!focus) return whole
      if (focus.footer) return layout.footer
      const items = model.boardItems.filter(itemInFocus).map(item => layout.itemRects.get(item.key))
      return boundsOf(layout, focus.nodes, focus.wires, items)
    }

    function itemInFocus (item) {
      return Boolean(item.at ? focus?.nodes.has(item.at) : focus?.footer)
    }

    function frame (animate = true) {
      const { width, height } = stage.getBoundingClientRect()
      camera.moveTo(fitBox(target(), width, height), { animate })
    }

    function applyClasses () {
      drawing.svg.classList.toggle('gd-focused', Boolean(focus))
      drawing.svg.classList.toggle('gd-map', guided && stepIndex === 0)
      for (const [id, g] of drawing.nodeEls) g.classList.toggle('gd-in', Boolean(focus?.nodes.has(id)))
      const selectedWires = new Set(selected?.terminal ? terminalConnections(model, selected.node, selected.terminal).map(c => c.wire.id) : [])
      for (const [id, g] of drawing.wireEls) {
        g.classList.toggle('gd-in', Boolean(focus?.wires.has(id)))
        g.classList.toggle('gd-emph', Boolean(focus?.emph?.has(id)))
        g.classList.toggle('gd-sel', selectedWires.has(id))
      }
      for (const [key, g] of drawing.termEls) g.classList.toggle('gd-sel', key === (selected && `${selected.node}.${selected.terminal}`))
      for (const item of model.boardItems) {
        const g = drawing.itemEls.get(item.key)
        g.classList.toggle('gd-in', itemInFocus(item))
        g.classList.toggle('gd-sel', item.key === selected?.item)
      }
    }

    function update () {
      applyClasses()
      renderSheet()
      updateRotateHint()
      frame()
    }

    function showOverview () {
      focus = null
      selected = null
      sheetOpen = false
      update()
    }

    function focusOn (nodeId) {
      const group = focusGroup(model, nodeId)
      if (!group) return
      focus = group
      selected = null
      update()
    }

    function goTo (index) {
      stepIndex = Math.max(0, Math.min(steps.length, index))
      const step = steps[stepIndex - 1]
      // With context wires, the step's own wires are told apart by stroke width (gd-emph).
      focus = step
        ? { nodes: step.nodes, wires: new Set([...step.wires, ...step.contextWires]), emph: step.contextWires.size ? step.wires : null }
        : null
      selected = null
      sheetOpen = !step
      update()
    }

    // selected: { node, terminal } | { node } | { item: boardItemKey } | { ficha: componentId }
    function select (value) {
      selected = value
      sheetOpen = true
      applyClasses()
      renderSheet()
    }

    function focusFooter () {
      focus = { footer: true, nodes: new Set(), wires: new Set() }
      selected = null
      update()
    }

    function updateRotateHint () {
      const portrait = stage.clientHeight > stage.clientWidth
      rotateHint.hidden = !(guided && stepIndex === 0 && portrait && !rotateHintDismissed)
    }

    function nodeTitle (node) {
      const subtitle = node.kind === 'device' ? nodeSubtitle(node, t) : ''
      return subtitle ? `${node.title} · ${subtitle}` : node.title
    }

    function renderSheet () {
      sheetBody.innerHTML = ''
      sheet.classList.toggle('is-open', sheetOpen)
      if (guided) renderStepBar()

      if (selected) {
        const title = selected.terminal ? renderTerminal()
          : selected.item ? renderBoardItem()
            : selected.ficha ? renderComponent()
              : renderNode()
        if (guided) sheetBody.prepend(h('p', 'gd-sheet-title', title))
        else sheetHeader.textContent = title
        return
      }
      if (guided) { renderStep(); return }

      const rootNode = focus?.root ? model.nodes.get(focus.root) : null
      sheetHeader.textContent = rootNode ? nodeTitle(rootNode) : t('guided.hint.overview')
      sheetBody.appendChild(h('p', 'gd-hint', focus ? t('guided.hint.focus') : t('guided.hint.overview')))
      sheet.classList.toggle('is-open', sheetOpen && Boolean(focus))
    }

    function renderStepBar () {
      const step = steps[stepIndex - 1]
      stepTitle.textContent = step ? localized(step.title, language) : t('guided.map')
      stepCount.textContent = step
        ? t('guided.stepOf', { n: stepIndex, m: steps.length })
        : t('guided.stepCount', { m: steps.length })
      prev.disabled = stepIndex === 0
      next.disabled = stepIndex === steps.length
      dotEls.forEach((dot, i) => {
        dot.classList.toggle('is-done', i < stepIndex - 1)
        dot.classList.toggle('is-current', i === stepIndex - 1)
      })
    }

    function renderStep () {
      const step = steps[stepIndex - 1]
      if (!step) {
        sheetBody.appendChild(h('p', 'gd-warn', localized(data.guide.map.warning, language)))
        sheetBody.appendChild(h('p', 'gd-hint', t('guided.hint.map')))
        return
      }
      if (step.cable) sheetBody.appendChild(factRow(t('guided.cable'), localized(step.cable, language)))
      for (const note of step.notes) sheetBody.appendChild(h('p', note.warn ? 'gd-warn' : 'gd-desc', localized(note, language)))
      for (const fact of step.facts) {
        if (Array.isArray(fact.value)) {
          sheetBody.appendChild(h('p', 'gd-label', localized(fact.label, language)))
          const list = h('ol', 'gd-list')
          for (const item of fact.value) list.appendChild(h('li', null, item))
          sheetBody.appendChild(list)
        } else {
          sheetBody.appendChild(factRow(localized(fact.label, language), fact.value))
        }
        sheetBody.appendChild(sourceLine(fact.src, t)).classList.add('gd-source--step')
      }
      if (step.wires.size) sheetBody.appendChild(h('p', 'gd-hint', t('guided.hint.step')))
    }

    function renderBoardItem () {
      const item = model.boardItems.find(entry => entry.key === selected.item)
      sheetBody.append(...renderItem(item.data, t))
      return item.data.title
    }

    // A block or device without a step: its terminals at a glance.
    function renderNode () {
      const node = model.nodes.get(selected.node)
      if (node.unusedInSetup) sheetBody.appendChild(h('p', 'gd-note', t('guided.notUsed')))
      for (const terminal of node.terminals) {
        sheetBody.appendChild(factRow(terminalLabel(node, terminal, t), `${terminal.fact.fn} — ${terminal.fact.exp}`))
      }
      sheetBody.appendChild(sourceLine(model.library.components[node.component].src, t))
      return nodeTitle(node)
    }

    function renderComponent () {
      const component = model.library.components[selected.ficha]
      sheetBody.append(...renderFicha(component, t))
      return component.status === 'pending' ? `${component.name} · ${t('guided.pending')}` : component.name
    }

    // Fills the sheet body with the selected terminal's facts; returns its title.
    function renderTerminal () {
      const node = model.nodes.get(selected.node)
      const terminal = node.terminals.find(term => term.id === selected.terminal)
      const fact = terminal.fact
      const component = model.library.components[node.component]

      if (component.status === 'pending' && component.pending) {
        sheetBody.appendChild(h('p', 'gd-pending', `${t('guided.pending')}: ${component.pending}`))
      }
      sheetBody.appendChild(factRow(t('guided.fact.function'), fact.fn))
      if (fact.desc) sheetBody.appendChild(h('p', 'gd-desc', fact.desc))
      sheetBody.appendChild(factRow(t('guided.fact.expected'), fact.exp))
      if (fact.alt) sheetBody.appendChild(factRow(t('guided.fact.alternate'), fact.alt))
      if (node.unusedInSetup || terminal.unused) sheetBody.appendChild(h('p', 'gd-note', t('guided.notUsed')))

      sheetBody.appendChild(h('p', 'gd-label', t('guided.fact.connects')))
      const connections = terminalConnections(model, node.id, terminal.id)
      if (!connections.length) sheetBody.appendChild(h('p', 'gd-desc', t('guided.fact.noConnection')))
      for (const { wire, other } of connections) {
        const otherNode = model.nodes.get(other.node)
        const otherTerminal = otherNode.terminals.find(term => term.id === other.terminal)
        const row = h('p', 'gd-connection')
        const swatch = h('span', `gd-swatch${wire.type === 'tube' ? ' gd-swatch--tube' : ''}`)
        if (wire.type !== 'tube') swatch.style.background = WIRE_COLORS[wire.color] ?? '#888'
        swatch.setAttribute('aria-label', wire.type === 'tube' ? t('guided.tube') : wire.color)
        row.append(swatch, document.createTextNode(`${nodeTitle(otherNode)} · ${terminalLabel(otherNode, otherTerminal, t)}`))
        sheetBody.appendChild(row)
      }
      sheetBody.appendChild(sourceLine(fact.src, t))
      return `${nodeTitle(node)} · ${terminalLabel(node, terminal, t)}`
    }

    drawing.svg.addEventListener('click', event => {
      const now = performance.now()
      const isDouble = now - lastTap.time < DOUBLE_TAP_MS &&
        Math.hypot(event.clientX - lastTap.x, event.clientY - lastTap.y) < 30
      lastTap = isDouble ? { time: 0, x: 0, y: 0 } : { time: now, x: event.clientX, y: event.clientY }
      if (isDouble) { if (guided) goTo(0); else showOverview(); return }

      const termEl = event.target.closest('[data-terminal]')
      const fichaEl = event.target.closest('[data-ficha]')
      const itemEl = event.target.closest('[data-board-item]')
      const nodeId = event.target.closest('[data-node]')?.getAttribute('data-node') ?? null
      const inFocus = Boolean(nodeId && focus?.nodes.has(nodeId))
      const item = itemEl && model.boardItems.find(entry => entry.key === itemEl.getAttribute('data-board-item'))

      if (guided && stepIndex === 0) {
        const index = nodeId ? stepForNode(steps, nodeId) : -1
        if (index >= 0) goTo(index + 1)
        return
      }
      // The board title is always tappable; a node's title only inside the focus.
      if (fichaEl && (!nodeId || inFocus)) return select({ ficha: fichaEl.getAttribute('data-ficha') })
      if (termEl && inFocus) return select({ node: nodeId, terminal: termEl.getAttribute('data-terminal') })
      if (item && itemInFocus(item)) return select({ item: item.key })
      const group = item ? item.at : nodeId

      // Guided: empty space re-frames the step; another group jumps to its step;
      // a group with no step shows its detail without leaving the step.
      if (guided) {
        if (!item && !nodeId) return frame()
        if (inFocus) return
        const index = group ? stepForNode(steps, group) : -1
        if (index >= 0) return goTo(index + 1)
        return select(item ? { item: item.key } : { node: nodeId })
      }
      // Explore: any group or part focuses directly (one tap); empty space → overview.
      if (item && !group) return focusFooter()
      if (group) return focusOn(group)
      if (focus) showOverview()
    })

    // Rotation and resizes re-fit the current view without animation.
    new ResizeObserver(() => { frame(false); updateRotateHint() }).observe(stage)
    applyClasses()
    renderSheet()
    return wrap
  }
}

const STYLES_ID = 'styles-guided'
function injectStyles () {
  if (document.getElementById(STYLES_ID)) return
  const style = document.createElement('style')
  style.id = STYLES_ID
  style.textContent = STYLES
  document.head.appendChild(style)
}

const STYLES = `
.gd-root{display:flex;flex-direction:column;height:100%;min-height:0;background:var(--fo-panel);color:var(--fo-ink);font-family:var(--fo-font-body);}
.gd-header{display:flex;align-items:center;gap:var(--space-2);padding:var(--space-2) var(--space-3);padding-top:calc(var(--space-2) + env(safe-area-inset-top,0px));flex-shrink:0;}
.gd-title{font-size:var(--text-lg);font-weight:800;margin:0;flex-shrink:0;}
.gd-chip{flex:1;min-width:0;min-height:44px;display:flex;flex-direction:column;justify-content:center;gap:1px;border:none;border-radius:var(--fo-radius-sm);background:var(--fo-panel);box-shadow:var(--fo-shadow-raised);color:var(--fo-ink);font-family:var(--fo-font-mono);font-size:var(--text-xs);font-weight:700;padding:var(--space-1) var(--space-2);text-align:left;cursor:pointer;}
.gd-chip-line{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.gd-chip-sub{font-size:10px;font-weight:500;color:var(--fo-ink-soft);}
.gd-mode{flex:0 0 auto;gap:var(--space-1);margin:0;}
.gd-mode .gd-segment-btn{padding:0 var(--space-2);font-size:var(--text-xs);}
.gd-banner{margin:0 var(--space-3) var(--space-2);font-size:var(--text-xs);font-weight:600;color:var(--fo-accent-deep);}
.gd-unavailable{margin:var(--space-3);padding:var(--space-4);border-radius:var(--fo-radius);background:var(--fo-panel);box-shadow:var(--fo-shadow-card);font-weight:700;}
.gd-segment{display:flex;gap:var(--space-2);margin-bottom:var(--space-3);}
.gd-segment-btn{flex:1;min-height:44px;min-width:44px;border:none;border-radius:var(--fo-radius-sm);background:var(--fo-panel);box-shadow:var(--fo-shadow-raised);color:var(--fo-ink-soft);font-family:var(--fo-font-mono);font-weight:700;cursor:pointer;}
.gd-segment-btn.is-active{box-shadow:var(--fo-shadow-inset);color:var(--fo-accent-deep);}
.gd-lang{flex:0 0 44px;height:44px;margin-left:auto;border:none;border-radius:var(--fo-radius-sm);background:var(--fo-panel);box-shadow:var(--fo-shadow-raised);color:var(--fo-ink-soft);font-family:var(--fo-font-mono);font-size:var(--text-xs);font-weight:700;cursor:pointer;}
.gd-setup{margin:var(--space-3);padding:var(--space-4);border-radius:var(--fo-radius);background:var(--fo-panel);box-shadow:var(--fo-shadow-card);}
.gd-setup-heading{margin:0 0 var(--space-3);font-size:var(--text-md);font-weight:800;}
.gd-setup-system{margin:0 0 var(--space-3);font-weight:700;}
.gd-label{margin:0 0 var(--space-1);font-family:var(--fo-font-mono);font-size:var(--text-xs);font-weight:700;color:var(--fo-ink-soft);text-transform:uppercase;letter-spacing:.06em;}
.gd-primary{width:100%;min-height:48px;margin-top:var(--space-2);border:none;border-radius:var(--fo-radius-sm);background:var(--fo-panel);box-shadow:var(--fo-shadow-raised);color:var(--fo-accent-deep);font-family:var(--fo-font-body);font-size:var(--text-base);font-weight:800;cursor:pointer;}
.gd-explore{flex:1;min-height:0;display:flex;flex-direction:column;}
.gd-stage{flex:1;min-height:0;position:relative;margin:0 var(--space-2);border-radius:var(--fo-radius-md);overflow:hidden;box-shadow:var(--fo-shadow-well);background:#f6f6f3;}
.gd-svg{display:block;width:100%;height:100%;touch-action:manipulation;user-select:none;-webkit-user-select:none;-webkit-tap-highlight-color:transparent;}
.gd-fit{position:absolute;top:var(--space-2);right:var(--space-2);width:44px;height:44px;border:none;border-radius:50%;background:var(--fo-panel);box-shadow:var(--fo-shadow-raised);font-size:20px;color:var(--fo-ink);cursor:pointer;}
.gd-sheet{flex-shrink:0;margin:var(--space-2);margin-bottom:calc(var(--space-2) + env(safe-area-inset-bottom,0px));border-radius:var(--fo-radius-md);background:var(--fo-panel);box-shadow:var(--fo-shadow-card);overflow:hidden;}
.gd-sheet-header{display:block;width:100%;min-height:44px;border:none;background:none;padding:var(--space-2) var(--space-3);text-align:left;font-family:var(--fo-font-body);font-weight:700;font-size:var(--text-sm);color:var(--fo-ink);cursor:pointer;}
.gd-sheet-body{display:none;max-height:42vh;overflow-y:auto;padding:0 var(--space-3) var(--space-3);}
.gd-sheet.is-open .gd-sheet-body{display:block;}
.gd-hint,.gd-desc{margin:0 0 var(--space-2);font-size:var(--text-sm);color:var(--fo-ink-soft);}
.gd-fact{display:flex;gap:var(--space-2);margin:0 0 var(--space-1);font-size:var(--text-sm);}
.gd-fact-label{flex:0 0 84px;font-family:var(--fo-font-mono);font-size:var(--text-xs);font-weight:700;color:var(--fo-ink-soft);text-transform:uppercase;padding-top:2px;}
.gd-fact-value{flex:1;font-weight:600;}
.gd-note,.gd-pending{margin:0 0 var(--space-2);font-size:var(--text-sm);font-weight:600;color:var(--fo-accent-deep);}
.gd-connection{display:flex;align-items:center;gap:var(--space-2);margin:0 0 var(--space-1);font-size:var(--text-sm);}
.gd-swatch{flex:0 0 18px;height:8px;border-radius:4px;box-shadow:0 0 0 1px #5a5e64;}
.gd-swatch--tube{background:#c9cdd2;box-shadow:0 0 0 2px #8d939a;}
.gd-source{margin:var(--space-2) 0 0;font-family:var(--fo-font-mono);font-size:var(--text-xs);color:var(--fo-ink-soft);}
.gd-source--step{margin:0 0 var(--space-2);}
.gd-source--field{color:var(--fo-no);font-weight:700;}
.gd-error{margin:var(--space-4);color:var(--fo-no);}
.gd-warn{margin:0 0 var(--space-2);font-size:var(--text-sm);font-weight:700;color:var(--fo-no);}
.gd-sheet-title{margin:0 0 var(--space-2);font-size:var(--text-sm);font-weight:700;}
.gd-list{margin:0 0 var(--space-1);padding-left:20px;font-size:var(--text-sm);}
.gd-dots{display:flex;gap:2px;padding:6px var(--space-3) 0;}
.gd-dot{flex:1;height:3px;border-radius:2px;background:var(--fo-panel-lo);}
.gd-dot.is-done{background:var(--fo-ink-soft);}
.gd-dot.is-current{background:var(--fo-accent-deep);}
.gd-dots+.gd-sheet-body{padding-top:var(--space-2);}
.gd-bar{display:flex;align-items:center;gap:var(--space-1);padding:var(--space-1);}
.gd-step-btn{flex:0 0 44px;height:44px;border:none;border-radius:var(--fo-radius-sm);background:var(--fo-panel);box-shadow:var(--fo-shadow-raised);color:var(--fo-ink);font-size:22px;line-height:1;cursor:pointer;}
.gd-step-btn:disabled{opacity:.35;cursor:default;}
.gd-step-label{flex:1;min-width:0;min-height:44px;border:none;background:none;text-align:center;font-family:var(--fo-font-body);color:var(--fo-ink);cursor:pointer;}
.gd-step-title{display:block;font-size:var(--text-sm);font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.gd-step-count{display:block;font-family:var(--fo-font-mono);font-size:var(--text-xs);color:var(--fo-ink-soft);}
.gd-rotate{position:absolute;top:var(--space-2);left:var(--space-2);display:flex;align-items:center;margin:0;padding-left:var(--space-3);border-radius:999px;background:var(--fo-panel);box-shadow:var(--fo-shadow-raised);font-size:var(--text-xs);font-weight:600;color:var(--fo-ink-soft);}
.gd-rotate[hidden]{display:none;}
.gd-rotate-close{width:44px;height:44px;border:none;background:none;font-size:18px;color:var(--fo-ink-soft);cursor:pointer;}

@media (orientation:landscape) and (max-height:540px){
  .gd-explore{flex-direction:row;}
  .gd-stage{margin-bottom:calc(var(--space-2) + env(safe-area-inset-bottom,0px));}
  .gd-sheet{flex:0 0 300px;align-self:flex-end;max-height:calc(100% - 2 * var(--space-2));display:flex;flex-direction:column;margin-left:0;}
  .gd-sheet-body{max-height:none;min-height:0;}
}

.gd-fichas-btn{position:absolute;top:var(--space-2);left:var(--space-2);height:44px;padding:0 var(--space-3);border:none;border-radius:999px;background:var(--fo-panel);box-shadow:var(--fo-shadow-raised);font-family:var(--fo-font-body);font-size:var(--text-sm);font-weight:700;color:var(--fo-ink);cursor:pointer;}
.gd-fichas{flex:1;min-height:0;overflow-y:auto;padding:0 var(--space-3) calc(var(--space-3) + env(safe-area-inset-bottom,0px));}
.gd-ficha{margin-bottom:var(--space-2);padding:0 var(--space-3);border-radius:var(--fo-radius-md);background:var(--fo-panel);box-shadow:var(--fo-shadow-card);}
.gd-ficha[open]{padding-bottom:var(--space-3);}
.gd-ficha-summary{display:flex;align-items:center;gap:var(--space-2);min-height:48px;font-weight:700;cursor:pointer;}
.gd-ficha-maker{margin-left:auto;font-family:var(--fo-font-mono);font-size:var(--text-xs);font-weight:500;color:var(--fo-ink-soft);}
.gd-tag{padding:2px 6px;border-radius:999px;background:var(--fo-accent-deep);color:var(--fo-panel-hi);font-family:var(--fo-font-mono);font-size:10px;font-weight:700;}
.gd-ficha-section{margin-top:var(--space-2);}
.gd-table{border-collapse:collapse;font-family:var(--fo-font-mono);font-size:var(--text-xs);}
.gd-table th,.gd-table td{padding:2px var(--space-3) 2px 0;text-align:right;}
.gd-unavailable p{margin:0 0 var(--space-2);}

.gd-bg{fill:transparent;}
.gd-board{fill:#fbfbf9;stroke:#8a8f96;stroke-width:1.2;}
.gd-board-title{font-family:var(--fo-font-mono);font-size:12px;font-weight:700;fill:#22252a;}
.gd-box{fill:#fff;stroke:#9ca1a8;stroke-width:1;}
.gd-node--device>.gd-box{stroke:#7d828a;}
.gd-node--mid>.gd-box{fill:#eef3fa;}
.gd-block-title{font-family:var(--fo-font-mono);font-size:7.5px;font-weight:700;fill:#3a3e44;}
.gd-device-title{font-family:var(--fo-font-body);font-size:9.5px;font-weight:700;fill:#22252a;}
.gd-device-sub{font-family:var(--fo-font-mono);font-size:7.5px;fill:#5d6268;}
.gd-term-label{font-family:var(--fo-font-mono);font-size:8.5px;font-weight:700;fill:#22252a;}
.gd-term-label--wide{font-family:var(--fo-font-body);font-size:7.5px;font-weight:600;}
.gd-pin{fill:#fff;stroke:#3a3e44;stroke-width:1.2;}
.gd-hit{fill:transparent;}
.gd-node,.gd-wire{transition:opacity .25s ease;}
.gd-wire{pointer-events:none;opacity:.5;}
.gd-wire-halo{fill:none;stroke:#f6f6f3;stroke-width:6.4;stroke-linejoin:round;}
.gd-wire-outline{fill:none;stroke:#2a2c30;stroke-width:3.6;stroke-linejoin:round;}
.gd-wire-core{fill:none;stroke-width:2;stroke-linejoin:round;}
.gd-tube-outer{fill:none;stroke:#8d939a;stroke-width:6;stroke-linejoin:round;}
.gd-tube-inner{fill:none;stroke:#d3d6da;stroke-width:2.5;stroke-linejoin:round;}
.gd-unused{opacity:.4;}
.gd-focused .gd-node:not(.gd-in){opacity:.22;}
.gd-focused .gd-wire{opacity:.08;}
.gd-focused .gd-wire.gd-in{opacity:1;}
.gd-wire.gd-emph .gd-wire-halo{stroke-width:7.6;}
.gd-wire.gd-emph .gd-wire-outline{stroke-width:4.8;}
.gd-wire.gd-emph .gd-wire-core{stroke-width:2.8;}
.gd-wire.gd-sel .gd-wire-halo{stroke-width:8.4;}
.gd-wire.gd-sel .gd-wire-outline{stroke-width:5.6;}
.gd-wire.gd-sel .gd-wire-core{stroke-width:3.6;}
.gd-term.gd-sel .gd-hit{fill:rgba(181,100,30,.18);}
.gd-term.gd-sel .gd-pin{fill:#b5641e;}
.gd-map .gd-node.gd-target>.gd-box{stroke:#b5641e;stroke-width:1.6;}
.gd-bitem{cursor:pointer;}
.gd-bitem-box{fill:#fff;stroke:#b9bdc2;stroke-width:.8;}
.gd-led{stroke:#2a2c30;stroke-width:.6;}
.gd-part{fill:#e0b50c;stroke:#2a2c30;stroke-width:.6;}
.gd-bitem-label{font-family:var(--fo-font-mono);font-size:6.5px;font-weight:700;fill:#3a3e44;}
.gd-bitem.gd-sel .gd-bitem-box{fill:rgba(181,100,30,.18);stroke:#b5641e;}
.gd-focused .gd-bitem:not(.gd-in){opacity:.35;}
.gd-ficha-hit{cursor:pointer;}
.gd-block-title,.gd-device-title,.gd-device-sub{pointer-events:none;}
.gd-inactive,.gd-focused .gd-node.gd-inactive,.gd-focused .gd-wire.gd-inactive,.gd-focused .gd-bitem.gd-inactive{opacity:.06;pointer-events:none;}
`
