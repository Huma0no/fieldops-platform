// Builds the SVG drawing from a resolved model and its layout.
// Text shown in the drawing comes from the data, except UI labels passed through `t`.

import { pinKey } from './layout.mjs'

const NS = 'http://www.w3.org/2000/svg'

export const WIRE_COLORS = {
  white: '#f4f4f1',
  yellow: '#e0b50c',
  green: '#2f9a4c',
  red: '#d23a2e',
  black: '#1f2023',
  blue: '#2f6bd6',
}

function el (tag, attrs = {}, parent = null, text = null) {
  const node = document.createElementNS(NS, tag)
  for (const [key, value] of Object.entries(attrs)) {
    if (value !== null && value !== undefined) node.setAttribute(key, String(value))
  }
  if (text !== null) node.textContent = text
  if (parent) parent.appendChild(node)
  return node
}

export function nodeSubtitle (node, t) {
  const parts = []
  if (node.zone) parts.push(t('guided.zone', { n: node.zone }))
  if (node.section) parts.push(t(`guided.section.${node.section}`))
  if (node.status === 'pending') parts.push(t('guided.pending'))
  return parts.join(' · ')
}

export function terminalLabel (node, terminal, t) {
  if (terminal.id === '_') return node.unusedInSetup ? t('guided.notUsedShort') : terminal.fact.fn
  if (node.silk?.[terminal.id]) return `${terminal.id} · ${node.silk[terminal.id]}`
  return terminal.label
}

export function renderDrawing (model, layout, { t, metrics }) {
  const margin = 40
  const svg = el('svg', {
    class: 'gd-svg',
    xmlns: NS,
    viewBox: `${-margin} ${-margin} ${layout.width + 2 * margin} ${layout.height + 2 * margin}`,
    preserveAspectRatio: 'xMidYMid meet',
    role: 'img',
  })
  el('rect', {
    class: 'gd-bg',
    x: -2000, y: -2000, width: layout.width + 4000, height: layout.height + 4000,
  }, svg)

  const board = layout.board
  const boardComponent = model.library.components[model.system.board.component]
  el('rect', { class: 'gd-board', x: board.x, y: board.y, width: board.w, height: board.h, rx: 10 }, svg)
  el('text', { class: 'gd-board-title', x: board.x + board.w / 2, y: board.y + 22, 'text-anchor': 'middle' }, svg, boardComponent.name)

  const nodeEls = new Map()
  const termEls = new Map()
  const nodesLayer = el('g', { class: 'gd-nodes' }, svg)

  for (const node of model.nodes.values()) {
    const rect = layout.rects.get(node.id)
    const classes = ['gd-node', `gd-node--${node.kind}`]
    if (node.kind === 'device' && node.column === 'mid') classes.push('gd-node--mid')
    if (node.inactive) classes.push('gd-inactive')
    if (node.unusedInSetup) classes.push('gd-unused')
    const g = el('g', { class: classes.join(' '), 'data-node': node.id }, nodesLayer)
    el('rect', { class: 'gd-box', x: rect.x, y: rect.y, width: rect.w, height: rect.h, rx: node.kind === 'block' ? 4 : 8 }, g)

    if (node.kind === 'block') {
      el('text', { class: 'gd-block-title', x: rect.x + 6, y: rect.y + 15 }, g, node.title)
    } else {
      el('text', { class: 'gd-device-title', x: rect.x + 8, y: rect.y + 14 }, g, node.title)
      const subtitle = nodeSubtitle(node, t)
      if (subtitle) el('text', { class: 'gd-device-sub', x: rect.x + 8, y: rect.y + 26 }, g, subtitle)
    }

    const split = node.terminals.some(term => term.face === 'out') && node.terminals.some(term => term.face === 'in')
    for (const terminal of node.terminals) {
      const pin = layout.pins.get(pinKey(node.id, terminal.id))
      const atRightEdge = pin.x >= rect.x + rect.w - 0.5
      const termClasses = ['gd-term']
      if (terminal.unused) termClasses.push('gd-unused')
      const tg = el('g', { class: termClasses.join(' '), 'data-node': node.id, 'data-terminal': terminal.id }, g)
      const hitW = split ? rect.w / 2 : rect.w
      const hitX = split && atRightEdge ? rect.x + rect.w / 2 : rect.x
      el('rect', { class: 'gd-hit', x: hitX, y: pin.y - metrics.row / 2, width: hitW, height: metrics.row }, tg)
      el('text', {
        class: terminal.id === '_' ? 'gd-term-label gd-term-label--wide' : 'gd-term-label',
        x: atRightEdge ? pin.x - 8 : pin.x + 8,
        y: pin.y + 3,
        'text-anchor': atRightEdge ? 'end' : 'start',
      }, tg, terminalLabel(node, terminal, t))
      el('circle', { class: 'gd-pin', cx: pin.x, cy: pin.y, r: 3.2 }, tg)
      termEls.set(pinKey(node.id, terminal.id), tg)
    }
    nodeEls.set(node.id, g)
  }

  const wireEls = new Map()
  const wiresLayer = el('g', { class: 'gd-wires' }, svg)
  for (const wire of model.wires) {
    const points = layout.wirePaths.get(wire.id).map(p => `${p.x},${p.y}`).join(' ')
    const classes = ['gd-wire', wire.type === 'tube' ? 'gd-wire--tube' : '']
    if (wire.inactive) classes.push('gd-inactive')
    const g = el('g', { class: classes.join(' ').trim(), 'data-wire': wire.id }, wiresLayer)
    if (wire.type === 'tube') {
      el('polyline', { class: 'gd-tube-outer', points }, g)
      el('polyline', { class: 'gd-tube-inner', points }, g)
    } else {
      // The halo cuts a gap where a later wire crosses an earlier one, so crossings never read as junctions.
      el('polyline', { class: 'gd-wire-halo', points }, g)
      el('polyline', { class: 'gd-wire-outline', points }, g)
      el('polyline', { class: 'gd-wire-core', points, stroke: WIRE_COLORS[wire.color] ?? '#888' }, g)
    }
    wireEls.set(wire.id, g)
  }

  return { svg, nodeEls, termEls, wireEls }
}
