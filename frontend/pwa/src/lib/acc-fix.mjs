// Acc + Fix template layout (W2): tiles, sub-option groups, the technician's
// template and the order tiles are shown in. Pure functions; the Workspace
// renders them. Spec: docs/fieldops/workspace/ACC-SPEC.md, FIX-SPEC.md.

export const TEMPLATE_SIZE = { accessory: 6, fix: 4 }
// Free-text lines live in the +Add sheet ("+ Other"), never as tiles.
export const OTHER_ITEM = { accessory: 'Other', fix: 'Other Fix' }
export const REPEATABLE_ITEMS = new Set(Object.values(OTHER_ITEM))

const priceOf = item => Number(item.default_price ?? 0)

// One tile per catalog item, or per group of sub-options (group_label).
// tile: { key, label, items, group, wide, price, minPrice, rank, board, companionOf }
export function buildTiles (catalogItems, category, itemRelations = []) {
  const companionOf = new Map(itemRelations
    .filter(relation => relation.relation_type === 'companion')
    .map(relation => [relation.related_item_name, relation.item_name]))
  const boards = new Set(companionOf.values())
  const tiles = []
  const byKey = new Map()
  for (const item of catalogItems) {
    if (item.category !== category || item.selectable === false || REPEATABLE_ITEMS.has(item.item_name)) continue
    const key = item.group_label || item.item_name
    let tile = byKey.get(key)
    if (!tile) {
      tile = {
        key,
        label: item.group_label || item.label || item.item_name,
        items: [],
        group: Boolean(item.group_label),
        wide: Boolean(item.group_label) || item.tile_wide === true,
        rank: null,
        board: boards.has(item.item_name),
        companionOf: companionOf.get(item.item_name) ?? null,
      }
      byKey.set(key, tile)
      tiles.push(tile)
    }
    tile.items.push(item)
    if (item.template_rank != null) tile.rank = tile.rank == null ? item.template_rank : Math.min(tile.rank, item.template_rank)
  }
  for (const tile of tiles) {
    const prices = tile.items.map(priceOf)
    tile.price = Math.max(...prices)
    tile.minPrice = Math.min(...prices)
  }
  return tiles
}

// Reports (among the last 30) that used each tile; a group sums its options.
export function tileUsage (tiles, usage = {}) {
  return Object.fromEntries(tiles.map(tile => [tile.key, tile.items.reduce((sum, item) => sum + (usage[item.item_name] ?? 0), 0)]))
}

// Template keys and where they come from: the technician's pins ("yours"),
// else the most-used tiles ("suggested", companions excluded, topped up from
// the default template), else the default template ("default").
export function templateFor (tiles, category, { usage = {}, pinned = null } = {}) {
  const known = new Set(tiles.map(tile => tile.key))
  if (Array.isArray(pinned)) return { source: 'yours', keys: pinned.filter(key => known.has(key)) }
  const size = TEMPLATE_SIZE[category] ?? 6
  const counts = tileUsage(tiles, usage)
  const eligible = tiles.filter(tile => !tile.companionOf)
  const defaults = eligible.filter(tile => tile.rank != null).sort((a, b) => a.rank - b.rank).map(tile => tile.key)
  const used = eligible
    .filter(tile => counts[tile.key] > 0)
    .sort((a, b) => counts[b.key] - counts[a.key] || b.price - a.price || a.label.localeCompare(b.label))
    .map(tile => tile.key)
  if (!used.length) return { source: 'default', keys: defaults }
  const keys = used.slice(0, size)
  for (const key of defaults) if (keys.length < size && !keys.includes(key)) keys.push(key)
  return { source: 'suggested', keys }
}

// Tiles on screen: the template, tiles added from the sheet on this call,
// pre-specified at Intake, and anything selected. Ordered by price high → low;
// a selected board's companions follow it. Companions show only with their
// board, unless the technician selected one on its own.
export function visibleTiles (tiles, { templateKeys = [], addedKeys = [], selectedNames = [], preIdentified = [] } = {}) {
  const selected = new Set(selectedNames)
  const isOn = tile => tile.items.some(item => selected.has(item.item_name))
  const wanted = new Set([...templateKeys, ...addedKeys])
  const pre = new Set(preIdentified)
  const boardOn = new Set(tiles.filter(tile => tile.board && isOn(tile)).map(tile => tile.items[0].item_name))
  const shown = tiles.filter(tile => {
    if (tile.companionOf) return isOn(tile) && !boardOn.has(tile.companionOf)
    return wanted.has(tile.key) || isOn(tile) || tile.items.some(item => pre.has(item.item_name))
  })
  shown.sort((a, b) => b.price - a.price || a.label.localeCompare(b.label))
  const ordered = []
  for (const tile of shown) {
    ordered.push(tile)
    if (tile.board && isOn(tile)) {
      for (const companion of tiles.filter(entry => entry.companionOf === tile.items[0].item_name)) ordered.push(companion)
    }
  }
  return ordered
}

// "$20" or "$20–50" for a group whose options differ.
export function tilePriceLabel (tile) {
  const fmt = value => `$${Number.isInteger(value) ? value : value.toFixed(2)}`
  return tile.minPrice === tile.price ? fmt(tile.price) : `${fmt(tile.minPrice)}–${fmt(tile.price).slice(1)}`
}

// Companions the technician can also add on their own from +Add (Kristo,
// 2026-11-25); the others ride with their board.
const SHEET_COMPANIONS = new Set(['EEV Wire'])

// The +Add sheet: every tile (companions ride with their board), filtered by
// a search on the tile label, its options or the catalog name.
export function sheetTiles (tiles, query = '') {
  const q = query.trim().toLowerCase()
  return tiles
    .filter(tile => !tile.companionOf || SHEET_COMPANIONS.has(tile.key))
    .filter(tile => !q || [tile.label, ...tile.items.flatMap(item => [item.item_name, item.label, item.option_label])]
      .some(text => text && text.toLowerCase().includes(q)))
    .sort((a, b) => a.label.localeCompare(b.label))
}
