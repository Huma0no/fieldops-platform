// W2: a new line starts at the call's system count when its catalog item
// multiplies by systems (companions too); otherwise at 1. The technician can
// change it freely afterwards.
describe('Acc + Fix starting quantity', () => {
  let drafts

  beforeAll(async () => {
    drafts = await import('../frontend/pwa/src/lib/workspace-visit.mjs')
  })

  const catalogItems = [
    { item_name: 'UT3000', category: 'accessory', default_price: 30, multiplies_by_system_count: false },
    { item_name: 'EEV Wire', category: 'accessory', default_price: 10, multiplies_by_system_count: true },
    { item_name: 'Float Switch', category: 'accessory', default_price: 5, multiplies_by_system_count: true },
  ]
  const itemRelations = [{ item_name: 'UT3000', relation_type: 'companion', related_item_name: 'EEV Wire' }]

  it('seeds the system count for multiplying items and their companions', () => {
    const draft = { _items: [] }
    drafts.addLocalVisitDraftItem(draft, catalogItems[0], { catalogItems, itemRelations, systemCount: 3 })
    drafts.addLocalVisitDraftItem(draft, catalogItems[2], { catalogItems, itemRelations, systemCount: 3 })
    expect(draft._items.map(item => [item.item_name, item.quantity])).toEqual([
      ['UT3000', 1], ['EEV Wire', 3], ['Float Switch', 3],
    ])
  })

  it('keeps an explicit quantity and lets the technician lower it', () => {
    const draft = { _items: [] }
    drafts.addLocalVisitDraftItem(draft, catalogItems[2], { quantity: 2, catalogItems, systemCount: 3 })
    expect(draft._items[0].quantity).toBe(2)
    expect(drafts.setLocalVisitDraftItemQuantity(draft, draft._items[0].id, 1)).toBe(true)
    expect(draft._items[0].quantity).toBe(1)
  })
})
