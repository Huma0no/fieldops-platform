# Phase 3 — Lobby, Assignment & Visit Lifecycle: Design Spec

**Date:** 2026-06-24
**Status:** Approved, ready for implementation planning

---

## Overview

Phase 3 adds the visit lifecycle surface that technicians and dispatchers use after visits are released to the lobby. It covers claiming, starting, viewing detail, and reassigning visits. No workspace logic (services, items, photos, weigh-in) — that is Phase 4.

---

## Architecture

### File structure

One new file:

```
src/routes/visits.js
```

Exports two named routers:

```js
module.exports = { visitsRouter, dispatchVisitsRouter };
```

Mounted in `src/index.js`:

```js
const { visitsRouter, dispatchVisitsRouter } = require('./routes/visits');
app.use('/api/visits',          visitsRouter);
app.use('/api/dispatch/visits', dispatchVisitsRouter);
```

Mount order: `visitsRouter` must be mounted before `dispatchVisitsRouter` is even relevant, but within `visitsRouter` itself `GET /mine` must be declared before `GET /:id` so Express does not swallow `"mine"` as an `:id` param.

### Routing convention

The `/api/dispatch/` URL prefix indicates **access level** (owner/dispatcher only), not file ownership. `visits.js` owns all visit lifecycle endpoints regardless of which roles can reach them. `dispatch.js` owns batch and administrative routes only.

### Pattern

All SQL is inline in route handlers, matching the `dispatch.js` convention. No additional helper files.

---

## Endpoints

### `GET /api/visits/lobby`

Auth: any authenticated user.

Returns all visits where `status = 'in_lobby'`, ordered `scheduled_time ASC`.

Single query joining `visits → addresses`. A second LEFT JOIN on `visit_systems → catalog_equipment` (on `indoor_model` or `outdoor_model`) uses `BOOL_OR(ce.is_a2l)` grouped by visit to determine the `a2l` tag without fan-out duplication.

Response shape per item:

```json
{
  "id": "...",
  "orderNumber": "...",
  "scheduledTime": "...",
  "address": { "street": "...", "city": "...", "subdivision": "...", "builder": "..." },
  "hasMultipleSystems": false,
  "isDeferred": false,
  "tags": ["builder"]
}
```

Tag derivation (server-side):
- `"builder"` — always present
- `"multiSystem"` — if `has_multiple_systems = true`
- `"a2l"` — if `BOOL_OR(ce.is_a2l)` is true
- `"urgent"` — reserved, never set automatically

If a visit has no systems or no systems with matching catalog entries, `a2l` is suppressed (BOOL_OR of NULLs → NULL → treated as false).

---

### `POST /api/visits/:id/claim`

Auth: `requireRole('technician')`.

Race-safe claim using a PostgreSQL transaction with `SELECT … FOR UPDATE`.

Flow:
1. Pre-check: fetch visit without lock — 404 if not found, 409 if `status ≠ 'in_lobby'`
2. Begin transaction
3. `SELECT … FOR UPDATE` on the visit row
4. Re-check status inside the lock
5. `UPDATE visits SET status = 'assigned', technician_id = $techId, updated_at = $now WHERE id = $id AND status = 'in_lobby'`
6. If 0 rows affected: rollback, return 409 `"This visit was just claimed by another technician"`
7. Commit, return full visit object (same shape as lobby item plus `technicianId`)

The pre-lock check is a fast-path optimisation — it does not replace the in-transaction re-check.

---

### `GET /api/visits/mine`

Auth: `requireRole('technician')`.

Returns visits where `technician_id = req.technician.id` AND `status IN ('assigned', 'in_progress', 'temporarily')`.

Order: `is_deferred DESC, scheduled_time ASC` — deferred (carry-over) visits surface first.

Joins `addresses` for street/city/subdivision/builder. Response includes `status` and `technicianId` in addition to the lobby shape.

---

### `POST /api/visits/:id/start`

Auth: `requireRole('technician')`.

1. Fetch visit — 404 if not found
2. `technician_id ≠ req.technician.id` → 403 `"This visit is not assigned to you"`
3. `status ≠ 'assigned'` → 400 `"Visit cannot be started — current status: {status}"`
4. `UPDATE visits SET status = 'in_progress', updated_at = $now WHERE id = $id`
5. Return `{ id, status: 'in_progress' }`

---

### `GET /api/visits/:id`

Auth: any authenticated user.

Five separate queries (avoids 1:many fan-out on a single JOIN):
1. Visit + address (street, city, state, zip, subdivision, builder)
2. `visit_systems` — system_number, indoor_model, outdoor_model, refrigerant
3. `visit_services` — service_name, is_finish, is_temporarily, price
4. `visit_items` — category, item_name, quantity, price, tech_supplied
5. `visit_photos` — id, tag, label, category, system_number, stored_at

If technician role: verify `technician_id = req.technician.id` — 403 if not.
If dispatcher/owner: no ownership check.

Returns a single nested object with all data stitched in JS.

---

### `PATCH /api/dispatch/visits/:id/reassign`

Auth: `requireRole('owner', 'dispatcher')`.

Body: `{ technicianId }`.

1. Fetch visit — 404 if not found
2. Verify technician exists and `is_active = true` — 400 `"Technician not found or inactive"`
3. `UPDATE visits SET technician_id = $techId, updated_at = $now WHERE id = $id`
4. If visit was `in_lobby`: also set `status = 'assigned'` in the same UPDATE
5. If `assigned` or `in_progress`: leave status unchanged
6. Call `createNotification(pool, { recipientId: technicianId, type: 'visit_assigned', message: "You have been assigned to {address.street}" })`
7. Return `{ id, technicianId, status }`

---

## Error Handling

| Scenario | Status | Message |
|---|---|---|
| Visit not found | 404 | `Visit not found` |
| Claim on non-`in_lobby` (pre-lock) | 409 | `This visit was just claimed by another technician` |
| Claim lost to race (0 rows) | 409 | `This visit was just claimed by another technician` |
| Start — wrong technician | 403 | `This visit is not assigned to you` |
| Start — wrong status | 400 | `Visit cannot be started — current status: {status}` |
| Detail — technician, wrong owner | 403 | `This visit is not assigned to you` |
| Reassign — visit not found | 404 | `Visit not found` |
| Reassign — technician inactive/missing | 400 | `Technician not found or inactive` |

All unhandled exceptions bubble to the existing global error handler (500).

---

## Integration Tests

File: `tests/visits.test.js`. Pattern: `beforeEach(truncateTables)`, `afterAll(() => pool.end())`.

### Seeds to add to `tests/helpers/seeds.js`

- `seedTechnicianWithToken()` — mirrors `seedDispatcherWithToken()` with `role: 'technician'`
- `seedInLobbyVisit({ pool, addressOverrides, systemCount, withA2l })` — inserts an address, a visit in `in_lobby`, and `systemCount` `visit_systems` rows. `withA2l: true` inserts a `catalog_equipment` row with `is_a2l = true` and sets `indoor_model` on system 1 to that model.

### Test cases

**`GET /lobby`**
- Returns `[]` when no in_lobby visits
- Returns visit with `builder` tag always present
- Returns `multiSystem` tag when `has_multiple_systems = true`
- Returns `a2l` tag when equipment matches
- Returns 401 without token

**`POST /:id/claim`**
- Assigns visit, returns it with `technicianId` and `status: 'assigned'`
- 404 for unknown id
- 409 when already claimed (status ≠ `in_lobby`)

**`GET /mine`**
- Returns technician's assigned visits only
- Excludes other technician's visits
- Deferred visits sort before non-deferred
- 403 for dispatcher role

**`POST /:id/start`**
- Transitions to `in_progress`, returns `{ id, status }`
- 403 if wrong technician
- 400 if status ≠ `assigned`

**`GET /:id`**
- Returns full detail with nested systems
- 403 if technician and not the assigned technician
- Dispatcher can view any visit

**`PATCH /api/dispatch/visits/:id/reassign`**
- Reassigns and creates notification for receiving technician
- Sets `status = 'assigned'` when visit was `in_lobby`
- Leaves status unchanged when visit was `in_progress`
- 400 for inactive technician
- 403 for technician role

> `catalog_equipment` is not cleared by `truncateTables`. Tests that need `a2l` insert their own rows with unique model names.

---

## Success Criteria

1. `GET /api/visits/lobby` returns released visits with correct tags
2. `POST /api/visits/:id/claim` assigns the visit and returns it
3. Second claim on the same visit returns 409
4. `GET /api/visits/mine` returns the claimed visit for that technician
5. `POST /api/visits/:id/start` moves it to `in_progress`
6. `GET /api/visits/:id` returns full nested detail
7. `PATCH /api/dispatch/visits/:id/reassign` moves the visit and creates a notification
