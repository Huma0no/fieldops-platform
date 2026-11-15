// Computes drawing coordinates for a resolved model. Pure: no DOM.
// Columns per side, from the board outward: board (0) · mid (1, DAPC only) · outer (2).

export const METRICS = {
  row: 20,
  blockHead: 22,
  deviceHead: 32,
  boxPad: 6,
  gapY: 12,
  blockW: 112,
  boardCenter: 56,
  boardTitle: 34,
  boardPad: 8,
  deviceW: 150,
  midW: 112,
  lane: 8,
  gapMargin: 14,
  minGap: 28,
}

const SIDES = ['left', 'right']

export function computeLayout (model, metrics = METRICS) {
  const m = metrics
  const boxes = new Map()
  const blocks = [...model.nodes.values()].filter(n => n.kind === 'block')
  const devices = [...model.nodes.values()].filter(n => n.kind === 'device')
  const hasMid = Object.fromEntries(SIDES.map(side => [side, devices.some(d => d.side === side && d.column === 'mid')]))

  // ── Vertical placement ─────────────────────────────────
  let boardBottom = m.boardTitle
  for (const side of SIDES) {
    let y = m.boardTitle
    for (const block of blocks.filter(b => b.side === side)) {
      const h = m.blockHead + block.terminals.length * m.row + m.boxPad
      boxes.set(block.id, { y, h, w: m.blockW })
      y += h + m.gapY
    }
    boardBottom = Math.max(boardBottom, y - m.gapY + m.boardPad)
  }

  for (const side of SIDES) {
    for (const column of ['mid', 'outer']) {
      let prevBottom = -Infinity
      for (const device of devices.filter(d => d.side === side && d.column === column)) {
        const rows = Math.max(countFace(device, 'in'), countFace(device, 'out'))
        const h = m.deviceHead + rows * m.row + m.boxPad
        let y = Math.max(boxes.get(device.anchor).y, prevBottom + m.gapY)
        if (column === 'outer' && hasMid[side] && connectsToBoard(model, device.id)) {
          y = clearOfMidBoxes(y, h, devices, boxes, side, m.gapY)
        }
        boxes.set(device.id, { y, h, w: column === 'mid' ? m.midW : m.deviceW })
        prevBottom = y + h
      }
    }
  }

  // ── Pins (y now, x after the columns are known) ────────
  const pins = new Map()
  for (const node of model.nodes.values()) {
    const box = boxes.get(node.id)
    const rowIndex = { in: 0, out: 0 }
    for (const terminal of node.terminals) {
      const i = rowIndex[terminal.face]++
      pins.set(pinKey(node.id, terminal.id), {
        node: node.id,
        terminal: terminal.id,
        face: terminal.face,
        y: box.y + (node.kind === 'block' ? m.blockHead : m.deviceHead) + i * m.row + m.row / 2,
        x: 0,
      })
    }
  }

  // ── Routing: one gap per wire, lanes inside each gap ───
  const routes = model.wires.map(wire => {
    const a = endpoint(model, wire.from)
    const b = endpoint(model, wire.to)
    const [inner, outer] = a.col <= b.col ? [a, b] : [b, a]
    return { wire, inner, outer, gap: gapFor(inner, hasMid[inner.side]) }
  })
  const lanes = assignLanes(routes, pins)
  const gapWidth = {}
  for (const side of SIDES) {
    for (const k of [1, 2]) {
      const count = lanes.counts.get(`${side}:${k}`) ?? 0
      gapWidth[`${side}:${k}`] = Math.max(m.minGap, 2 * m.gapMargin + Math.max(0, count - 1) * m.lane)
    }
  }

  // ── Horizontal placement, left to right ────────────────
  const columnX = {}
  const gapX = {}
  let x = 0
  columnX['left:2'] = x; x += m.deviceW
  if (hasMid.left) {
    gapX['left:2'] = x; x += gapWidth['left:2']
    columnX['left:1'] = x; x += m.midW
  }
  gapX['left:1'] = x; x += gapWidth['left:1']
  const boardW = 2 * m.blockW + m.boardCenter
  const board = { x, y: 0, w: boardW, h: boardBottom }
  x += boardW
  gapX['right:1'] = x; x += gapWidth['right:1']
  if (hasMid.right) {
    columnX['right:1'] = x; x += m.midW
    gapX['right:2'] = x; x += gapWidth['right:2']
  }
  columnX['right:2'] = x; x += m.deviceW
  const width = x

  const rects = new Map()
  for (const node of model.nodes.values()) {
    const box = boxes.get(node.id)
    let nx
    if (node.kind === 'block') nx = node.side === 'left' ? board.x : board.x + board.w - m.blockW
    else nx = columnX[`${node.side}:${node.column === 'mid' ? 1 : 2}`]
    rects.set(node.id, { x: nx, y: box.y, w: box.w, h: box.h })
  }

  for (const pin of pins.values()) {
    const node = model.nodes.get(pin.node)
    const rect = rects.get(pin.node)
    // Blocks face away from the board; device "in" faces the board, "out" faces away.
    if (node.kind === 'block') pin.x = node.side === 'left' ? rect.x : rect.x + rect.w
    else pin.x = (node.side === 'left') === (pin.face === 'in') ? rect.x + rect.w : rect.x
  }

  const wirePaths = new Map()
  for (const route of routes) {
    const p1 = pins.get(pinKey(route.inner.node, route.inner.terminal))
    const p2 = pins.get(pinKey(route.outer.node, route.outer.terminal))
    const lane = lanes.byWire.get(route.wire.id)
    const gx = gapX[route.gap]
    // Lanes are counted from the board side of the gap.
    const laneX = route.inner.side === 'left'
      ? gx + gapWidth[route.gap] - m.gapMargin - lane * m.lane
      : gx + m.gapMargin + lane * m.lane
    wirePaths.set(route.wire.id, [
      { x: p1.x, y: p1.y },
      { x: laneX, y: p1.y },
      { x: laneX, y: p2.y },
      { x: p2.x, y: p2.y },
    ])
  }

  let height = board.h
  for (const rect of rects.values()) height = Math.max(height, rect.y + rect.h)

  return { width, height, board, rects, pins, wirePaths }
}

export function pinKey (nodeId, terminalId) {
  return `${nodeId}.${terminalId}`
}

function countFace (node, face) {
  return node.terminals.filter(t => t.face === face).length
}

function connectsToBoard (model, deviceId) {
  return model.wires.some(w =>
    (w.from.node === deviceId && model.nodes.get(w.to.node).kind === 'block') ||
    (w.to.node === deviceId && model.nodes.get(w.from.node).kind === 'block')
  )
}

function clearOfMidBoxes (y, h, devices, boxes, side, gapY) {
  const mids = devices.filter(d => d.side === side && d.column === 'mid').map(d => boxes.get(d.id))
  let moved = true
  while (moved) {
    moved = false
    for (const box of mids) {
      if (y < box.y + box.h + 4 && y + h > box.y - 4) {
        y = box.y + box.h + gapY
        moved = true
      }
    }
  }
  return y
}

function endpoint (model, end) {
  const node = model.nodes.get(end.node)
  const terminal = node.terminals.find(t => t.id === end.terminal)
  const col = node.kind === 'block' ? 0 : node.column === 'mid' ? 1 : 2
  return { ...end, side: node.side, col, face: terminal.face }
}

// The lane runs in the gap next to the inner endpoint's face.
function gapFor (inner, sideHasMid) {
  if (inner.col === 0) return `${inner.side}:1`
  if (inner.col === 1) return inner.face === 'out' ? `${inner.side}:2` : `${inner.side}:1`
  return sideHasMid ? `${inner.side}:2` : `${inner.side}:1`
}

// Greedy interval packing: wires whose vertical spans do not overlap share a lane.
function assignLanes (routes, pins) {
  const byGap = new Map()
  for (const route of routes) {
    const y1 = pins.get(pinKey(route.inner.node, route.inner.terminal)).y
    const y2 = pins.get(pinKey(route.outer.node, route.outer.terminal)).y
    const span = { route, start: Math.min(y1, y2), end: Math.max(y1, y2) }
    if (!byGap.has(route.gap)) byGap.set(route.gap, [])
    byGap.get(route.gap).push(span)
  }
  const byWire = new Map()
  const counts = new Map()
  for (const [gap, spans] of byGap) {
    spans.sort((a, b) => a.start - b.start || a.end - b.end)
    const laneEnds = []
    for (const span of spans) {
      let lane = laneEnds.findIndex(end => end + 6 < span.start)
      if (lane === -1) { lane = laneEnds.length; laneEnds.push(span.end) } else laneEnds[lane] = span.end
      byWire.set(span.route.wire.id, lane)
    }
    counts.set(gap, laneEnds.length)
  }
  return { byWire, counts }
}

export function boundsOf (layout, nodeIds, wireIds = []) {
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity
  for (const id of nodeIds) {
    const r = layout.rects.get(id)
    if (!r) continue
    x1 = Math.min(x1, r.x); y1 = Math.min(y1, r.y)
    x2 = Math.max(x2, r.x + r.w); y2 = Math.max(y2, r.y + r.h)
  }
  for (const id of wireIds) {
    for (const p of layout.wirePaths.get(id) ?? []) {
      x1 = Math.min(x1, p.x); y1 = Math.min(y1, p.y)
      x2 = Math.max(x2, p.x); y2 = Math.max(y2, p.y)
    }
  }
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 }
}
