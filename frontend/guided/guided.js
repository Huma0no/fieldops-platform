/**
 * guided/guided.js
 * Guided module entry point. Standalone page and (later) FieldOps both call mount().
 *
 *   mount(rootEl, { context: { zones, dapc } | null, standalone: boolean })
 *
 * The module never calls the FieldOps API; it only reads its own data files.
 */

import { getLanguage, setLanguage, t as translate } from './shared/i18n.js'
import { buildModel, focusGroup, isFieldMeasureSource, normalizeContext, terminalConnections } from './src/model.mjs'
import { METRICS, boundsOf, computeLayout } from './src/layout.mjs'
import { createCamera, fitBox } from './src/camera.mjs'
import { WIRE_COLORS, nodeSubtitle, renderDrawing, terminalLabel } from './src/render.mjs'

const DATA_FILES = {
  library: new URL('./data/guided-component-library.v0.1.json', import.meta.url),
  system: new URL('./data/ut3000-comm.system.json', import.meta.url),
}
const DOUBLE_TAP_MS = 300

export async function mount (root, { context = null, standalone = false } = {}) {
  injectStyles()
  root.classList.add('gd-root')
  const t = (key, vars) => translate(key, vars)

  let data
  try {
    const [library, system] = await Promise.all(
      [DATA_FILES.library, DATA_FILES.system].map(url => fetch(url).then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.json()
      }))
    )
    data = { library, system }
  } catch (err) {
    console.error('Guided data load failed:', err)
    root.innerHTML = ''
    root.appendChild(h('p', 'gd-error', t('guided.loadError')))
    return
  }

  let current = context ? normalizeContext(data.system, context) : null
  render()

  function render () {
    root.innerHTML = ''
    root.appendChild(buildHeader())
    if (current) root.appendChild(buildExplore(current))
    else root.appendChild(buildSetup())
  }

  function buildHeader () {
    const header = h('header', 'gd-header')
    header.appendChild(h('h1', 'gd-title', t('guided.title')))
    if (current) {
      const summary = h('button', 'gd-chip', t('guided.summary', {
        system: data.system.title,
        zones: current.zones,
        dapc: current.dapc ? t('guided.summary.dapc') : '',
      }))
      summary.type = 'button'
      summary.setAttribute('aria-label', t('guided.setup.change'))
      summary.addEventListener('click', () => { current = null; render() })
      header.appendChild(summary)
    }
    if (standalone) header.appendChild(buildLanguageToggle())
    return header
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
    const draft = { zones: data.system.maxZones, dapc: false }
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
    start.addEventListener('click', () => { current = normalizeContext(data.system, draft); render() })
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

  function buildExplore (ctx) {
    const model = buildModel(data.library, data.system, ctx)
    const layout = computeLayout(model)
    const drawing = renderDrawing(model, layout, { t, metrics: METRICS })
    const camera = createCamera(drawing.svg)
    const whole = { x: 0, y: 0, w: layout.width, h: layout.height }

    let focus = null
    let selected = null
    let sheetOpen = false
    let lastTap = { time: 0, x: 0, y: 0 }

    const wrap = h('div', 'gd-explore')
    const stage = h('main', 'gd-stage')
    stage.appendChild(drawing.svg)
    const fit = h('button', 'gd-fit', '⤢')
    fit.type = 'button'
    fit.setAttribute('aria-label', t('guided.fit'))
    fit.addEventListener('click', showOverview)
    stage.appendChild(fit)
    wrap.appendChild(stage)

    const sheet = h('section', 'gd-sheet')
    const sheetHeader = h('button', 'gd-sheet-header')
    sheetHeader.type = 'button'
    sheetHeader.addEventListener('click', () => { sheetOpen = !sheetOpen; renderSheet() })
    const sheetBody = h('div', 'gd-sheet-body')
    sheet.append(sheetHeader, sheetBody)
    wrap.appendChild(sheet)

    function target () {
      return focus ? boundsOf(layout, focus.nodes, focus.wires) : whole
    }

    function frame (animate = true) {
      const { width, height } = stage.getBoundingClientRect()
      camera.moveTo(fitBox(target(), width, height), { animate })
    }

    function applyClasses () {
      drawing.svg.classList.toggle('gd-focused', Boolean(focus))
      for (const [id, g] of drawing.nodeEls) g.classList.toggle('gd-in', Boolean(focus?.nodes.has(id)))
      const selectedWires = new Set(selected ? terminalConnections(model, selected.node, selected.terminal).map(c => c.wire.id) : [])
      for (const [id, g] of drawing.wireEls) {
        g.classList.toggle('gd-in', Boolean(focus?.wires.has(id)))
        g.classList.toggle('gd-sel', selectedWires.has(id))
      }
      for (const [key, g] of drawing.termEls) g.classList.toggle('gd-sel', key === (selected && `${selected.node}.${selected.terminal}`))
    }

    function showOverview () {
      focus = null
      selected = null
      sheetOpen = false
      applyClasses()
      renderSheet()
      frame()
    }

    function focusOn (nodeId) {
      const group = focusGroup(model, nodeId)
      if (!group) return
      focus = group
      selected = null
      applyClasses()
      renderSheet()
      frame()
    }

    function selectTerminal (nodeId, terminalId) {
      selected = { node: nodeId, terminal: terminalId }
      sheetOpen = true
      applyClasses()
      renderSheet()
    }

    function nodeTitle (node) {
      const subtitle = node.kind === 'device' ? nodeSubtitle(node, t) : ''
      return subtitle ? `${node.title} · ${subtitle}` : node.title
    }

    function renderSheet () {
      sheetBody.innerHTML = ''
      if (!selected) {
        const root = focus ? model.nodes.get(focus.root) : null
        sheetHeader.textContent = root ? nodeTitle(root) : t('guided.hint.overview')
        sheetBody.appendChild(h('p', 'gd-hint', focus ? t('guided.hint.focus') : t('guided.hint.overview')))
        sheet.classList.toggle('is-open', sheetOpen && Boolean(focus))
        return
      }
      const node = model.nodes.get(selected.node)
      const terminal = node.terminals.find(term => term.id === selected.terminal)
      const fact = terminal.fact
      const component = model.library.components[node.component]
      sheetHeader.textContent = `${nodeTitle(node)} · ${terminalLabel(node, terminal, t)}`

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

      const source = h('p', `gd-source${isFieldMeasureSource(fact.src) ? ' gd-source--field' : ''}`)
      source.textContent = `${t('guided.fact.source')}: ${fact.src}`
      sheetBody.appendChild(source)
      sheet.classList.toggle('is-open', sheetOpen)
    }

    drawing.svg.addEventListener('click', event => {
      const now = performance.now()
      const isDouble = now - lastTap.time < DOUBLE_TAP_MS &&
        Math.hypot(event.clientX - lastTap.x, event.clientY - lastTap.y) < 30
      lastTap = isDouble ? { time: 0, x: 0, y: 0 } : { time: now, x: event.clientX, y: event.clientY }
      if (isDouble) { showOverview(); return }

      const termEl = event.target.closest('[data-terminal]')
      const nodeEl = event.target.closest('[data-node]')
      if (!nodeEl) return
      const nodeId = nodeEl.getAttribute('data-node')
      if (model.nodes.get(nodeId).inactive) return
      if (termEl && focus?.nodes.has(nodeId)) selectTerminal(nodeId, termEl.getAttribute('data-terminal'))
      else focusOn(nodeId)
    })

    // Rotation and resizes re-fit the current view without animation.
    new ResizeObserver(() => frame(false)).observe(stage)
    renderSheet()
    return wrap
  }
}

function h (tag, className, text = null) {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== null) node.textContent = text
  return node
}

function factRow (label, value) {
  const row = h('p', 'gd-fact')
  row.append(h('span', 'gd-fact-label', label), h('span', 'gd-fact-value', value ?? '—'))
  return row
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
.gd-chip{flex:1;min-width:0;min-height:44px;border:none;border-radius:var(--fo-radius-sm);background:var(--fo-panel);box-shadow:var(--fo-shadow-raised);color:var(--fo-ink);font-family:var(--fo-font-mono);font-size:var(--text-xs);font-weight:600;padding:0 var(--space-3);text-align:left;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:pointer;}
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
.gd-source--field{color:var(--fo-no);font-weight:700;}
.gd-error{margin:var(--space-4);color:var(--fo-no);}

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
.gd-wire.gd-sel .gd-wire-halo{stroke-width:8.4;}
.gd-wire.gd-sel .gd-wire-outline{stroke-width:5.6;}
.gd-wire.gd-sel .gd-wire-core{stroke-width:3.6;}
.gd-term.gd-sel .gd-hit{fill:rgba(181,100,30,.18);}
.gd-term.gd-sel .gd-pin{fill:#b5641e;}
.gd-inactive,.gd-focused .gd-node.gd-inactive,.gd-focused .gd-wire.gd-inactive{opacity:.06;pointer-events:none;}
`
