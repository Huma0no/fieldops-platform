// DOM builders for component fichas and board part/LED details.
// Every value comes from the component library; only section labels go through `t`.

import { isFieldMeasureSource } from './model.mjs'

export function h (tag, className, text = null) {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== null) node.textContent = text
  return node
}

export function factRow (label, value) {
  const row = h('p', 'gd-fact')
  row.append(h('span', 'gd-fact-label', label), h('span', 'gd-fact-value', value ?? '—'))
  return row
}

export function sourceLine (src, t) {
  return h('p', `gd-source${isFieldMeasureSource(src) ? ' gd-source--field' : ''}`, `${t('guided.fact.source')}: ${src}`)
}

function humanize (key) {
  const words = key.replace(/([A-Z])/g, ' $1').toLowerCase()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

function list (items) {
  const ol = h('ol', 'gd-list')
  for (const item of items) ol.appendChild(h('li', null, item))
  return ol
}

// A board part or LED: description, states (with default), spec, dip switches, source.
export function renderItem (item, t) {
  const out = []
  if (item.desc) out.push(h('p', 'gd-desc', item.desc))
  if (item.spec) out.push(factRow(t('guided.ficha.rating'), item.spec))
  if (Array.isArray(item.states)) {
    out.push(factRow(t('guided.ficha.states'), item.states.join(' · ')))
    if (item.default) out.push(factRow(t('guided.ficha.default'), item.default))
  } else if (item.states) {
    for (const [state, meaning] of Object.entries(item.states)) out.push(factRow(state, meaning))
  }
  for (const sw of item.switches ?? []) {
    out.push(factRow(`#${sw.n}`, [sw.role, sw.default ?? '—', sw.note].filter(Boolean).join(' · ')))
  }
  out.push(sourceLine(item.src, t))
  return out
}

function section (label, children) {
  const wrap = h('div', 'gd-ficha-section')
  wrap.append(h('p', 'gd-label', label), ...children)
  return wrap
}

function terminalRows (terminals) {
  return Object.entries(terminals).map(([id, fact]) => factRow(id, `${fact.fn} — ${fact.exp}`))
}

// Full ficha of one component, as a list of elements for a sheet or an accordion body.
export function renderFicha (component, t) {
  const out = []
  if (component.status === 'pending' && component.pending) {
    out.push(h('p', 'gd-pending', `${t('guided.pending')}: ${component.pending}`))
  }
  if (component.spec) {
    out.push(section(t('guided.ficha.spec'), Object.entries(component.spec).map(([key, value]) => factRow(humanize(key), value))))
  }
  if (component.terminals) out.push(section(t('guided.ficha.terminals'), terminalRows(component.terminals)))
  for (const block of Object.values(component.blocks ?? {})) {
    out.push(section(block.title, terminalRows(block.terminals)))
  }
  if (component.parts?.length) {
    out.push(section(t('guided.ficha.parts'), component.parts.flatMap(part => [h('p', 'gd-sheet-title', part.title), ...renderItem(part, t)])))
  }
  if (component.leds?.length) {
    out.push(section(t('guided.ficha.leds'), component.leds.map(led => {
      const states = led.states ? led : { ...led, states: component.leds.find(other => other.id === led.ref)?.states }
      const wrap = h('div')
      wrap.append(h('p', 'gd-sheet-title', `${led.title} · ${led.color}`), ...renderItem(states, t))
      return wrap
    })))
  }
  if (component.autoSetup) {
    const auto = component.autoSetup
    out.push(section(t('guided.ficha.autoSetup'), [
      ...(auto.recommended ? [h('p', 'gd-note', t('guided.ficha.recommended'))] : []),
      h('p', 'gd-label', t('guided.ficha.before')), list(auto.before),
      h('p', 'gd-label', t('guided.ficha.steps')), list(auto.steps),
    ]))
  }
  if (component.commissioning) {
    out.push(section(t('guided.ficha.commissioning'), [h('p', 'gd-desc', component.commissioning)]))
  }
  if (component.table) {
    const table = h('table', 'gd-table')
    const head = table.createTHead().insertRow()
    head.append(h('th', null, t('guided.ficha.tempF')), h('th', null, t('guided.ficha.ohms')))
    const body = table.createTBody()
    for (const [temp, ohms] of component.table) {
      const row = body.insertRow()
      row.append(h('td', null, String(temp)), h('td', null, String(ohms)))
    }
    out.push(section(t('guided.ficha.table'), [table]))
  }
  out.push(sourceLine(component.src, t))
  return out
}
