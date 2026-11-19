// W2 Acc + Fix template layout rules (frontend/pwa/src/lib/acc-fix.mjs).
describe('Acc + Fix template', () => {
  let m

  beforeAll(async () => {
    m = await import('../frontend/pwa/src/lib/acc-fix.mjs')
  })

  const item = (item_name, default_price, extra = {}) => ({ item_name, category: 'accessory', default_price, tech_supplied: false, ...extra })
  const catalog = [
    item('UT3000', 30, { template_rank: 1, tile_wide: true }),
    item('HZ322', 30, { template_rank: 2 }),
    item('Harmony', 40, { tile_wide: true }),
    item('DAPC', 10), item('Ecoil Wire', 10, { label: 'EEV Wire' }), item('eBypass', 10), item('Bypass', 5),
    item('FIN180P', 10, { template_rank: 3 }),
    item('Float Switch', 5, { template_rank: 4 }),
    item('Weight-In-Data', 10, { template_rank: 5, label: 'Weigh-in' }),
    item('Dehum', 10), item('RDS', 10),
    item('LP Kit Lennox 1stg', 20, { group_label: 'LP Kit', option_label: 'Lennox 1Stg' }),
    item('LP Kit Goodman', 20, { group_label: 'LP Kit', option_label: 'Goodman' }),
    item('Other', null, { custom_price: true, tech_supplied: true }),
    item('Retired', 5, { selectable: false }),
    { item_name: 'Leaks Wall', category: 'fix', default_price: 50, group_label: 'Leaks', option_label: 'Wall', template_rank: 3 },
    { item_name: 'Leaks Ecoil', category: 'fix', default_price: 20, group_label: 'Leaks', option_label: 'eCoil', template_rank: 3 },
    { item_name: 'Pressure Test', category: 'fix', default_price: 10, template_rank: 1 },
  ]
  const relations = [
    ...['DAPC', 'Ecoil Wire', 'eBypass'].map(related_item_name => ({ item_name: 'UT3000', relation_type: 'companion', related_item_name })),
    { item_name: 'HZ322', relation_type: 'companion', related_item_name: 'Bypass' },
  ]
  const keys = tiles => tiles.map(tile => tile.key)

  it('builds tiles: groups, labels, wide tiles, companions; skips Other and retired items', () => {
    const tiles = m.buildTiles(catalog, 'accessory', relations)
    const byKey = Object.fromEntries(tiles.map(tile => [tile.key, tile]))
    expect(byKey['LP Kit']).toMatchObject({ label: 'LP Kit', group: true, wide: true, price: 20 })
    expect(byKey['LP Kit'].items.map(i => i.option_label)).toEqual(['Lennox 1Stg', 'Goodman'])
    expect(byKey['Ecoil Wire']).toMatchObject({ label: 'EEV Wire', companionOf: 'UT3000' })
    expect(byKey.UT3000).toMatchObject({ wide: true, board: true })
    expect(byKey.Other).toBeUndefined()
    expect(byKey.Retired).toBeUndefined()
    const leaks = m.buildTiles(catalog, 'fix', relations).find(tile => tile.key === 'Leaks')
    expect(m.tilePriceLabel(leaks)).toBe('$20–50')
  })

  it('uses the default template with no history, the most-used tiles otherwise, pins first', () => {
    const tiles = m.buildTiles(catalog, 'accessory', relations)
    expect(m.templateFor(tiles, 'accessory')).toEqual({ source: 'default', keys: ['UT3000', 'HZ322', 'FIN180P', 'Float Switch', 'Weight-In-Data'] })

    // Companions never count; a group sums its options; topped up from the default.
    const usage = { DAPC: 30, RDS: 9, 'LP Kit Goodman': 4, 'LP Kit Lennox 1stg': 4, Dehum: 2 }
    expect(m.templateFor(tiles, 'accessory', { usage })).toEqual({ source: 'suggested', keys: ['RDS', 'LP Kit', 'Dehum', 'UT3000', 'HZ322', 'FIN180P'] })

    expect(m.templateFor(tiles, 'accessory', { usage, pinned: ['Dehum', 'Gone'] })).toEqual({ source: 'yours', keys: ['Dehum'] })
    expect(m.templateFor(m.buildTiles(catalog, 'fix', relations), 'fix').keys).toEqual(['Pressure Test', 'Leaks'])
  })

  it('shows template, added, pre-specified and selected tiles by price, companions after their board', () => {
    const tiles = m.buildTiles(catalog, 'accessory', relations)
    const shown = m.visibleTiles(tiles, {
      templateKeys: ['Float Switch', 'FIN180P'],
      addedKeys: ['RDS'],
      selectedNames: ['UT3000', 'DAPC', 'Ecoil Wire', 'eBypass'],
      preIdentified: ['Harmony'],
    })
    expect(keys(shown)).toEqual(['Harmony', 'UT3000', 'DAPC', 'Ecoil Wire', 'eBypass', 'FIN180P', 'RDS', 'Float Switch'])
    // A companion selected on its own (board off) still shows; others stay hidden.
    expect(keys(m.visibleTiles(tiles, { selectedNames: ['Bypass'] }))).toEqual(['Bypass'])
  })

  it('searches the sheet by label, option or catalog name; companions ride with their board', () => {
    const tiles = m.buildTiles(catalog, 'accessory', relations)
    expect(keys(m.sheetTiles(tiles, 'goodman'))).toEqual(['LP Kit'])
    expect(keys(m.sheetTiles(tiles, 'weigh'))).toEqual(['Weight-In-Data'])
    expect(keys(m.sheetTiles(tiles, 'eev'))).toEqual([])
  })

  it('sums option usage per group tile', () => {
    const tiles = m.buildTiles(catalog, 'accessory', relations)
    expect(m.tileUsage(tiles, { 'LP Kit Goodman': 2, 'LP Kit Lennox 1stg': 3 })['LP Kit']).toBe(5)
  })
})
