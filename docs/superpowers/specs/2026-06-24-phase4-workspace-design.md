# Phase 4 — Workspace: Design Spec

**Date:** 2026-06-24
**Status:** Approved, ready for implementation planning

---

## Overview

Phase 4 adds the workspace surface that technicians use while on-site: selecting services, adding items (with companion/exclusion cascade), updating system models, recording weigh-in measurements, capturing photos, and writing notes. A server-side pricing engine recalculates `total_price` after every write operation. No Drive upload in this phase — photo bytes are discarded after metadata is stored.

---

## Architecture

### New files

```
src/services/pricing.js     ← standalone pricing engine, reused in Phase 6
src/routes/workspace.js     ← all workspace endpoints + private helpers
```

### Mount

`src/index.js` gets one new line after the existing visits mounts:

```js
app.use('/api/visits', require('./routes/workspace'));
```

Express cascades multiple routers at the same prefix without conflict — workspace routes use different HTTP methods and subpaths than visits.js.

### `workspace.js` internal structure

```
imports
requireVisitOwnership()      ← private middleware, attaches req.visit
resolveCompanionCascade()    ← private async helper
resolveExclusionCascade()    ← private async helper
PATCH  /:id/services
POST   /:id/items
DELETE /:id/items/:itemId
PATCH  /:id/systems/:systemNumber
PUT    /:id/weigh-in/:systemNumber
POST   /:id/photos
PATCH  /:id/notes
module.exports = router
```

### Routing convention

The `/api/dispatch/` prefix indicates access level. All workspace endpoints are technician-facing and live in `workspace.js`, mounted at `/api/visits`. This follows the same convention established in Phase 3.

---

## Pricing Engine — `src/services/pricing.js`

### Signature

```js
async function calculateVisitPrice(db, visitId)  // → number
```

Imported by `workspace.js` now and by the dispatcher full-edit endpoint in Phase 6. Never duplicated.

### Execution

Fetch in parallel:
1. `visit_services` JOIN `catalog_services` for this visit
2. `visit_items` JOIN `catalog_items` for this visit
3. `COUNT(*) FROM visit_systems WHERE visit_id = $visitId` → systemCount
4. `technician_price_overrides` for this visit's `technician_id` (keyed into a Map for O(1) lookup)

Compute:

```
if any service_name = 'Cancel' → return 0

serviceTotal = 0
for each visit_services row:
  price = catalog_services.default_price
  if catalog_services.multiplies_by_system_count: price *= systemCount
  serviceTotal += price

finishAddonTotal = 0
if any visit_services.is_finish = true:
  finishAddonTotal = SUM of catalog_items.finish_addon_price
    for all visit_items in this visit where finish_addon_price IS NOT NULL

itemTotal = 0
for each visit_items row:
  if catalog_items.custom_price:  use visit_items.price directly
  else if tech override exists:   use override_price from Map
  else:                           use catalog_items.default_price
  if catalog_items.multiplies_by_system_count: price *= systemCount
  itemTotal += price

return serviceTotal + itemTotal + finishAddonTotal
```

Notes:
- `custom_price` items use `visit_items.price` as stored at creation — not recalculated from catalog
- Cancel check exits before all other logic
- No rounding — return raw float, stored as `real`

---

## Shared Middleware — `requireVisitOwnership`

Private async function used by all handlers:

```
SELECT id, status, technician_id, address_id FROM visits WHERE id = $id
→ 404 "Visit not found" if no row
→ 403 "This visit is not assigned to you" if technician_id ≠ req.technician.id
→ 400 "Visit cannot be modified — current status: {status}"
       if status NOT IN ('assigned', 'in_progress')
→ attach row to req.visit, call next()
```

Handlers never re-fetch the visit. `req.visit` carries `{ id, status, technician_id, address_id }`.

---

## Endpoints

### `PATCH /api/visits/:id/services`

**Auth:** `requireVisitOwnership`  
**Body:** `{ serviceName, isFinish?, isTemporarily?, confirmed? }`

Validate `serviceName` against: `['AC', 'Heat', 'AC & Heat', 'Prestart System', 'Drive Run', 'Cancel']` → 400 `"Invalid service name"` if not in list.

**Cancel path:**
- Query `visit_items` count for this visit
- If count > 0 AND `confirmed` not true: return `{ requiresConfirmation: true, itemsToRemove: [{ id, itemName }] }`
- If confirmed (or count = 0): DELETE all `visit_items`, DELETE all `visit_services`, UPDATE `visits SET total_price = 0, updated_at = now()`. Return updated visit.

**Normal path:**
- DELETE existing `visit_services` row for this visit (if any)
- INSERT new `visit_services` row: `{ service_name: serviceName, is_finish: isFinish ?? false, is_temporarily: isTemporarily ?? false, price: catalog_services.default_price (fetched by service_name) }`
- Call `calculateVisitPrice(db, visitId)`
- UPDATE `visits SET total_price, updated_at`
- Return: `{ id, serviceName, isFinish, isTemporarily, totalPrice }`

---

### `POST /api/visits/:id/items`

**Auth:** `requireVisitOwnership`  
**Body:** `{ category, itemName, quantity?, price? }`

1. Validate `category` ∈ `['accessory', 'fix', 'thermostat']` → 400
2. Look up `catalog_items` by `itemName` → 400 `"Item not found in catalog"` if missing
3. If `custom_price = true` AND `price` not provided → 400 `"price is required for this item"`
4. Resolve `resolvedPrice`: body `price` if `custom_price`, else `catalog_items.default_price`
5. INSERT `visit_items`: `{ id: uuid, visit_id, category, item_name, quantity: quantity ?? 1, price: resolvedPrice, tech_supplied }`
6. Call `resolveCompanionCascade(db, visitId, itemName)` → returns `addedCompanions[]`
7. Call `resolveExclusionCascade(db, visitId, itemName)` → returns `removedItems[]`
8. Call `calculateVisitPrice(db, visitId)`
9. UPDATE `visits SET total_price, updated_at`
10. Return: `{ id, totalPrice, addedItems: [itemName, ...addedCompanions], removedItems }`

---

### `DELETE /api/visits/:id/items/:itemId`

**Auth:** `requireVisitOwnership`

1. Fetch `visit_items` row by `itemId` → 404 if not found
2. Capture `item_name` from the row
3. DELETE the row
4. Call `resolveCompanionCascade` in remove mode: if this item was a parent (has companions in catalog_item_relations WHERE item_name = $itemName AND relation_type = 'companion'), delete those companions from visit_items
5. Call `calculateVisitPrice(db, visitId)`
6. UPDATE `visits SET total_price, updated_at`
7. Return: `{ totalPrice, removedItems: [itemName, ...deletedCompanions] }`

---

### `PATCH /api/visits/:id/systems/:systemNumber`

**Auth:** `requireVisitOwnership`  
**Body:** `{ indoorModel?, outdoorModel? }`

1. Fetch `visit_systems` WHERE `visit_id = $id AND system_number = $systemNumber` → 404 `"System not found"` if missing
2. If `outdoorModel` provided: look up `catalog_equipment` by model — if found, pull `refrigerant` from it; if not found, refrigerant stays unchanged
3. UPDATE `visit_systems` with provided fields (partial update — only fields present in body)
4. UPDATE `visits SET updated_at = now()`
5. If no fields provided in body: no-op update; still UPDATE `visits.updated_at`
6. Return: `{ systemNumber, indoorModel, outdoorModel, refrigerant }` (merged result — current DB state)

---

### `PUT /api/visits/:id/weigh-in/:systemNumber`

**Auth:** `requireVisitOwnership`  
**Body:** `{ linesetLength, factoryLineConfig, factoryChargeUsed, adjustedOz, fanSpeedCfm, liquidLineTemp, suctionLineTemp, condenserSatTemp, subcoolingValue }`

`factoryChargeUsed`: `'factory'` | `'revised'`

1. `address_id` from `req.visit.address_id`
2. Look up `catalog_lineset_configs` by `factoryLineConfig` → 400 `"Lineset config not found"` if missing
3. Calculate `approx_adjust_oz = (linesetLength - referenceLength) * adjustRateOzPerFt`
4. Fetch `visit_systems` for this visit + systemNumber → get `outdoor_model`
5. Look up `catalog_equipment` by `outdoor_model` → get `factory_charge_oz`, `revised_charge_oz`
6. Resolve `factory_charge_oz` to store: `factoryChargeUsed === 'revised'` → use `revised_charge_oz`; else use `factory_charge_oz`
7. `oem_subcooling_goal = 10` (hardcoded; stored in the row)
8. `subcooling_deviation = subcoolingValue - 10`
9. UPSERT `weigh_in_data` ON CONFLICT (address_id, system_number) DO UPDATE SET all fields
10. UPDATE `visits SET updated_at = now()`
11. Return: full weigh-in record with all calculated fields

---

### `POST /api/visits/:id/photos`

**Auth:** `requireVisitOwnership`  
**Body:** multipart/form-data — `category`, `tag`, `systemNumber?`, `label?`, file field `photo`

Multer: `memoryStorage()` — file bytes received and discarded after this handler.

1. Validate `category` ∈ `['weigh_in_scale', 'fan_speed', 'site_evidence']` → 400 `"Invalid category"`
2. Validate `tag` present → 400 `"tag is required"` (any string value accepted — fixed or free text)
3. Fetch address `street` for slug (one query using `req.visit.address_id`)
4. Build slug: `{STREET}_{TAG}` or `{STREET}_{TAG}_SYS{N}` — uppercase, spaces → underscores
5. INSERT `visit_photos`: `{ id: uuid, visit_id, system_number, slug, tag, label, category, stored_at: null }`
6. UPDATE `visits SET updated_at = now()`
7. Return: `{ photoId, slug, storedAt: null }`

---

### `PATCH /api/visits/:id/notes`

**Auth:** `requireVisitOwnership`  
**Body:** `{ notes }`

1. UPDATE `visits SET notes = $notes, updated_at = now() WHERE id = $id`
2. Return: `{ id, notes }`

---

## Private Helpers

### `resolveCompanionCascade(db, visitId, itemName)`

**Add mode** (called from POST /items):
- Query `catalog_item_relations WHERE item_name = $itemName AND relation_type = 'companion'`
- For each `related_item_name`: check if already in `visit_items` for this visit; if not, look up catalog defaults and INSERT
- Return array of inserted item names

**Remove mode** (called from DELETE /items):
- Query `catalog_item_relations WHERE item_name = $itemName AND relation_type = 'companion'`
- DELETE from `visit_items WHERE visit_id = $visitId AND item_name IN (related_item_names)`
- Return array of deleted item names

### `resolveExclusionCascade(db, visitId, itemName)`

- Query `catalog_item_relations WHERE item_name = $itemName AND relation_type = 'exclusion_group'` → get `exclusion_group_id`
- If no exclusion_group_id: return [] (no-op)
- Fetch all item_names in that exclusion group (WHERE exclusion_group_id = $id AND item_name ≠ $itemName)
- For each group member: fetch its companions from `catalog_item_relations`
- Build deletion set: group members ∪ all their companions
- DELETE from `visit_items WHERE visit_id = $visitId AND item_name IN (deletion set)`
- Return deleted item names

---

## Error Handling

| Scenario | Status | Message |
|---|---|---|
| Visit not found | 404 | `Visit not found` |
| Wrong technician | 403 | `This visit is not assigned to you` |
| Wrong visit status | 400 | `Visit cannot be modified — current status: {status}` |
| Invalid serviceName | 400 | `Invalid service name` |
| Cancel has items, unconfirmed | 200 | `{ requiresConfirmation: true, itemsToRemove: [...] }` |
| Item not in catalog | 400 | `Item not found in catalog` |
| custom_price item, no price | 400 | `price is required for this item` |
| visit_items row not found | 404 | `Item not found` |
| System not found | 404 | `System not found` |
| Lineset config not found | 400 | `Lineset config not found` |
| Invalid photo category | 400 | `Invalid category` |
| Missing photo tag | 400 | `tag is required` |

---

## Integration Tests — `tests/workspace.test.js`

Pattern: `beforeEach(truncateTables)`, `afterAll(() => pool.end())`. Catalog rows (services, items, lineset configs, equipment) inserted directly via `pool.query` per test since `truncateTables` preserves catalog tables.

### New seed helper — `seedAssignedVisit()`

Added to `tests/helpers/seeds.js`:
- Calls `seedInLobbyVisit()` (existing)
- Directly UPDATEs visit to `status = 'assigned'`, `technician_id = tech.id`
- Returns `{ visitId, addressId, tech, token }`

### Test coverage

| Endpoint | Cases |
|---|---|
| `calculateVisitPrice` (in `tests/unit.test.js`) | AC only; AC with system-count multiplier; finish addon; Cancel → 0; custom_price item; tech price override |
| `PATCH /:id/services` | sets service + returns totalPrice; overwrites existing; Cancel with items → requiresConfirmation; Cancel confirmed → 0; 400 invalid name; 403 wrong tech |
| `POST /:id/items` | inserts item + companion auto-added; exclusion removes conflict + companions; 400 unknown item; 400 custom_price no price; 403 wrong tech |
| `DELETE /:id/items/:itemId` | deletes item + companions; 404 unknown itemId; totalPrice recalculated |
| `PATCH /:id/systems/:systemNumber` | updates indoorModel; outdoorModel pulls refrigerant from catalog; 404 unknown system |
| `PUT /:id/weigh-in/:systemNumber` | stores against address_id; approx_adjust_oz and subcooling_deviation correct; upserts on second call; 400 bad lineset config |
| `POST /:id/photos` | returns photoId + slug + storedAt null; slug with systemNumber; 400 invalid category |
| `PATCH /:id/notes` | updates notes; returns id + notes |

---

## Success Criteria

1. `PATCH /:id/services` with `{ serviceName: 'AC' }` returns non-zero totalPrice
2. `PATCH /:id/services` with `{ serviceName: 'Cancel' }` on visit with items returns `{ requiresConfirmation: true }`. With `{ confirmed: true }` → totalPrice 0
3. `POST /:id/items` with zone board item removes conflicting zone board and its companions
4. `PUT /:id/weigh-in/1` stores against address_id, calculates approx_adjust_oz and subcooling_deviation correctly
5. `POST /:id/photos` returns `{ photoId, slug, storedAt: null }`
6. `PATCH /:id/notes` updates notes field
7. All endpoints return 403 if technician is not the visit's assignee
