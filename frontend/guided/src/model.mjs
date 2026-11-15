// Resolves a system definition against the component library for one context.
// Pure data in, pure data out: every fact the UI shows is a reference into the library.

export function normalizeContext (system, context = {}) {
  const max = system.maxZones ?? 3
  const requested = context.zones == null ? NaN : Number(context.zones)
  const zones = Number.isFinite(requested) ? Math.min(max, Math.max(1, Math.trunc(requested))) : max
  return { zones, dapc: context.dapc === true }
}

export function matches (when, context) {
  return !when || Object.entries(when).every(([key, value]) => context[key] === value)
}

function expandZoneTemplates (templates, maxZones) {
  const wires = []
  for (let n = 1; n <= maxZones; n++) {
    for (const template of templates) {
      wires.push({
        ...template,
        from: template.from.replaceAll('{n}', n),
        to: template.to.replaceAll('{n}', n),
        zone: n,
      })
    }
  }
  return wires
}

function requireFact (terminals, terminalId, where) {
  const fact = terminals?.[terminalId]
  if (!fact) throw new Error(`Guided data: no library terminal "${terminalId}" for ${where}`)
  return fact
}

export function isFieldMeasureSource (src) {
  return /^not in manual/i.test(String(src ?? ''))
}

export function buildModel (library, system, rawContext) {
  const context = normalizeContext(system, rawContext)
  const boardComponent = library.components[system.board.component]
  if (!boardComponent) throw new Error(`Guided data: unknown board component "${system.board.component}"`)

  const nodes = new Map()

  for (const block of system.blocks) {
    const libBlock = boardComponent.blocks?.[block.type]
    if (!libBlock) throw new Error(`Guided data: no UT3000 block "${block.type}" for ${block.id}`)
    nodes.set(block.id, {
      kind: 'block',
      id: block.id,
      type: block.type,
      side: block.side,
      zone: block.zone ?? null,
      title: block.zone ? libBlock.title.replace(/\bn\b/, String(block.zone)) : libBlock.title,
      silk: libBlock.silk ?? null,
      unusedInSetup: (libBlock.unusedIn ?? []).includes(system.setup),
      inactive: Boolean(block.zone && block.zone > context.zones),
      component: system.board.component,
      terminals: block.terminals.map(id => ({
        id,
        face: 'out',
        label: id,
        fact: requireFact(libBlock.terminals, id, `block ${block.id}`),
        unused: false,
      })),
    })
  }

  for (const device of system.devices) {
    if (!matches(device.when, context)) continue
    const component = library.components[device.component]
    if (!component) throw new Error(`Guided data: unknown component "${device.component}" for ${device.id}`)
    const unused = new Set(device.unused ?? [])
    const terminal = face => id => ({
      id,
      face,
      label: device.labels?.[id] ?? id,
      fact: requireFact(component.terminals, id, `device ${device.id}`),
      unused: unused.has(id),
    })
    nodes.set(device.id, {
      kind: 'device',
      id: device.id,
      side: device.side,
      column: device.column,
      anchor: device.anchor,
      zone: device.zone ?? null,
      section: device.section ?? null,
      title: component.name,
      component: device.component,
      status: component.status,
      inactive: Boolean(device.zone && device.zone > context.zones),
      terminals: [
        ...(device.in ?? []).map(terminal('in')),
        ...(device.out ?? []).map(terminal('out')),
      ],
    })
  }

  const allWires = [
    ...expandZoneTemplates(system.wireTemplates?.perZone ?? [], system.maxZones ?? 3),
    ...(system.wires ?? []),
  ]
  const wires = []
  for (const raw of allWires) {
    if (!matches(raw.when, context)) continue
    const from = parseEndpoint(raw.from)
    const to = parseEndpoint(raw.to)
    for (const end of [from, to]) {
      const node = nodes.get(end.node)
      if (!node) throw new Error(`Guided data: wire endpoint "${end.node}" is not drawn in this context`)
      if (!node.terminals.some(t => t.id === end.terminal)) {
        throw new Error(`Guided data: wire endpoint "${end.node}.${end.terminal}" is not a drawn terminal`)
      }
    }
    wires.push({
      id: `${raw.from}>${raw.to}`,
      from,
      to,
      type: raw.type ?? 'wire',
      color: raw.color ?? null,
      inactive: nodes.get(from.node).inactive || nodes.get(to.node).inactive,
    })
  }

  return { context, system, library, nodes, wires }
}

function parseEndpoint (ref) {
  const dot = ref.indexOf('.')
  return { node: ref.slice(0, dot), terminal: ref.slice(dot + 1) }
}

// Focus group for a tapped node: its board block plus every device reachable
// from it through active wires, without crossing into other board blocks.
export function focusGroup (model, nodeId) {
  const start = model.nodes.get(nodeId)
  if (!start || start.inactive) return null
  const root = start.kind === 'block' ? start.id : findBlockFor(model, nodeId)
  const seed = root ?? nodeId
  const group = new Set([seed])
  const queue = [seed]
  while (queue.length) {
    const current = queue.shift()
    for (const neighbor of neighbors(model, current)) {
      if (group.has(neighbor)) continue
      if (model.nodes.get(neighbor).kind === 'block') continue
      group.add(neighbor)
      queue.push(neighbor)
    }
  }
  const wires = new Set(
    activeWires(model)
      .filter(w => group.has(w.from.node) && group.has(w.to.node))
      .map(w => w.id)
  )
  return { root: seed, nodes: group, wires }
}

function activeWires (model) {
  return model.wires.filter(w => !w.inactive)
}

function neighbors (model, nodeId) {
  const result = []
  for (const wire of activeWires(model)) {
    if (wire.from.node === nodeId) result.push(wire.to.node)
    else if (wire.to.node === nodeId) result.push(wire.from.node)
  }
  return result
}

function findBlockFor (model, deviceId) {
  const seen = new Set([deviceId])
  const queue = [deviceId]
  while (queue.length) {
    const current = queue.shift()
    for (const neighbor of neighbors(model, current)) {
      if (seen.has(neighbor)) continue
      if (model.nodes.get(neighbor).kind === 'block') return neighbor
      seen.add(neighbor)
      queue.push(neighbor)
    }
  }
  return null
}

export function terminalConnections (model, nodeId, terminalId) {
  const result = []
  for (const wire of activeWires(model)) {
    if (wire.from.node === nodeId && wire.from.terminal === terminalId) result.push({ wire, other: wire.to })
    else if (wire.to.node === nodeId && wire.to.terminal === terminalId) result.push({ wire, other: wire.from })
  }
  return result
}
