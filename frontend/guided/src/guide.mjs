// Resolves a guide (data) into the step list for one model. Pure: no DOM.
// Step 0 (system map) is not part of the list; steps are numbered 1..M.

import { matches } from './model.mjs'

// A guide is offered only when the call's equipment meets its requirements.
// No equipment (standalone page) means the user chose the setup manually.
export function guideAvailable (guide, equipment) {
  if (!equipment) return true
  return Object.entries(guide.requires ?? {}).every(([key, allowed]) => allowed.includes(equipment[key]))
}

export function buildSteps (guide, model) {
  const ctx = model.context
  const raw = []
  for (const entry of guide.steps) {
    if (!entry.perZone) { raw.push(entry); continue }
    for (let n = 1; n <= ctx.zones; n++) {
      for (const step of entry.perZone) raw.push(JSON.parse(JSON.stringify(step).replaceAll('{n}', n)))
    }
  }
  return raw.filter(step => matches(step.when, ctx)).map(step => resolveStep(step, model))
}

function resolveStep (step, model) {
  for (const id of step.frame) {
    if (!model.nodes.has(id)) throw new Error(`Guided guide: step "${step.id}" frames unknown node "${id}"`)
  }
  const pick = pairs => {
    const ids = new Set()
    for (const pair of pairs ?? []) {
      const [a, b] = pair.split('~')
      const found = model.wires.filter(w =>
        (w.from.node === a && w.to.node === b) || (w.from.node === b && w.to.node === a))
      if (!found.length) throw new Error(`Guided guide: step "${step.id}" wire filter "${pair}" matches no wire`)
      for (const w of found) ids.add(w.id)
    }
    return ids
  }
  return {
    id: step.id,
    title: step.title,
    cable: step.cable ?? null,
    notes: (step.notes ?? []).filter(note => matches(note.when, model.context)),
    facts: (step.facts ?? [])
      .filter(fact => matches(fact.when, model.context))
      .map(fact => ({ label: fact.label, ...resolveRef(model.library, fact.ref) })),
    nodes: new Set(step.frame),
    wires: pick(step.wires),
    // Shown at full opacity but not part of the step (e.g. the rest of a DAPC damper chain).
    contextWires: pick(step.contextWires),
  }
}

// "component.path.to.value" into library.components. Array segments match by `id`.
// The source is the nearest `src` on the way down.
export function resolveRef (library, ref) {
  let value = library.components
  let src = null
  for (const key of ref.split('.')) {
    value = Array.isArray(value) && !/^\d+$/.test(key) ? value.find(item => item.id === key) : value?.[key]
    if (value === undefined) throw new Error(`Guided guide: reference "${ref}" not found in the library`)
    if (value && typeof value === 'object' && value.src) src = value.src
  }
  return { value, src }
}

// Index (0-based) of the first step that frames this node, or -1.
export function stepForNode (steps, nodeId) {
  return steps.findIndex(step => step.nodes.has(nodeId))
}

export function localized (text, language) {
  return text?.[language] ?? text?.en ?? ''
}
