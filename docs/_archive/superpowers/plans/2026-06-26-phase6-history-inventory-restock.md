# Phase 6: History, Full Edit, Inventory & Restock — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add dispatch history browsing, full-edit with audit log, inventory tracking, and restock reporting routes to the fieldops-platform backend.

**Architecture:** Three new route files (`history.js`, `inventory.js`, `restock.js`) mounted in `src/index.js`. History and restock mount at `/api/dispatch`; inventory mounts at `/api` (covering both `/api/inventory/mine` for technicians and `/api/dispatch/inventory*` for dispatchers). The existing `dispatchVisitsRouter` at `/api/dispatch/visits` only defines `PATCH /:id/reassign`, so `PATCH /:id` falls through to `history.js` cleanly.

**Tech Stack:** Node.js/Express, PostgreSQL via `pg`, Jest + Supertest for tests. All PKs are `gen_random_uuid()::text`; all timestamps are ISO 8601 TEXT.

## Global Constraints

- All PKs: `gen_random_uuid()::text` or `crypto.randomUUID()`
- All timestamps and dates: ISO 8601 TEXT (never Date objects)
- No ORM — raw `pool.query()` only
- `requireRole('owner', 'dispatcher')` guards all `/api/dispatch/*` routes
- `requireRole('technician')` guards `/api/inventory/mine`
- `restock_records` unique constraint is `(item_name, period_start, period_end)` — `ON CONFLICT` must name all three columns
- No migration needed — all tables already exist in `schema.sql`
- Test runner: `jest --runInBand` (tests share one DB, run sequentially)

---

### Task 1: Update test helpers (truncateTables + seeds)

**Files:**
- Modify: `tests/helpers/db.js`
- Modify: `tests/helpers/seeds.js`

**Why:** `truncateTables` currently omits `edit_log`, `inventory_assignments`, `restock_records`, `pay_period_lines`, and `pay_periods`. Phase 6 tests write to all five tables — without cleanup, tests leak state across runs. Two new seed helpers are needed by the new test files: one for completed visits (needed by history and restock tests) and one for catalog item insertion (needed by inventory and restock tests).

- [ ] **Step 1: Add missing tables to truncateTables in `tests/helpers/db.js`**

Replace the existing `truncateTables` function body with:

```javascript
async function truncateTables() {
  await pool.query(`
    DELETE FROM edit_log;
    DELETE FROM corrections;
    DELETE FROM chat_messages;
    DELETE FROM notifications;
    DELETE FROM invite_codes;
    DELETE FROM device_tokens;
    DELETE FROM visit_photos;
    DELETE FROM weigh_in_data;
    DELETE FROM visit_items;
    DELETE FROM visit_services;
    DELETE FROM visit_systems;
    DELETE FROM transfers;
    DELETE FROM pay_period_lines;
    DELETE FROM pay_periods;
    DELETE FROM restock_records;
    DELETE FROM inventory_assignments;
    DELETE FROM visits;
    DELETE FROM addresses;
    DELETE FROM pdf_batches;
    DELETE FROM technician_price_overrides;
    DELETE FROM technicians;
  `);
}
```

- [ ] **Step 2: Add seed helpers to `tests/helpers/seeds.js`**

Add the following two exports at the bottom of `seeds.js` (before `module.exports`):

```javascript
async function seedCompletedVisit({ technicianId, addressId } = {}) {
  let tech, token;
  if (!technicianId) {
    const result = await seedTechnicianWithToken();
    tech = result.tech;
    token = result.token;
    technicianId = tech.id;
  }

  let finalAddressId = addressId;
  let street;
  if (!finalAddressId) {
    street = `${crypto.randomBytes(4).toString('hex')} HISTORY ST`;
    const addrRes = await pool.query(
      `INSERT INTO addresses (id, street, city, subdivision, builder)
       VALUES (gen_random_uuid()::text, $1, 'Houston', 'TEST SUB', 'DR HORTON') RETURNING id`,
      [street]
    );
    finalAddressId = addrRes.rows[0].id;
  }

  const now = new Date().toISOString();
  const visitRes = await pool.query(
    `INSERT INTO visits
       (id, address_id, technician_id, status, has_multiple_systems, is_deferred,
        scheduled_time, date, created_at, updated_at, completed_at, total_price)
     VALUES (gen_random_uuid()::text, $1, $2, 'completed', false, false,
             '2026-07-01T09:00:00Z', '2026-07-01', $3, $3, $3, 150)
     RETURNING id`,
    [finalAddressId, technicianId, now]
  );
  const visitId = visitRes.rows[0].id;

  await pool.query(
    `INSERT INTO visit_systems (id, visit_id, system_number)
     VALUES (gen_random_uuid()::text, $1, 1)`,
    [visitId]
  );

  return { visitId, addressId: finalAddressId, street, tech, token, technicianId };
}

async function seedCatalogItem(itemName, { techSupplied = true, expectedPriceMin = null, expectedPriceMax = null } = {}) {
  await pool.query(
    `INSERT INTO catalog_items (item_name, category, default_price, tech_supplied, expected_price_min, expected_price_max)
     VALUES ($1, 'accessory', 50, $2, $3, $4)
     ON CONFLICT (item_name) DO NOTHING`,
    [itemName, techSupplied, expectedPriceMin, expectedPriceMax]
  );
}
```

Update `module.exports` to include the new helpers:

```javascript
module.exports = {
  seedTech, seedToken, seedDispatcherWithToken, seedTechnicianWithToken,
  seedInLobbyVisit, seedAssignedVisit, seedTransferScenario,
  seedCompletedVisit, seedCatalogItem,
};
```

- [ ] **Step 3: Verify tests still pass**

```bash
cd /Users/chrismaldo/Dropbox/AC/fieldops-platform && npm test 2>&1 | tail -20
```

Expected: all existing tests pass (currently 161).

- [ ] **Step 4: Commit**

```bash
cd /Users/chrismaldo/Dropbox/AC/fieldops-platform && git add tests/helpers/db.js tests/helpers/seeds.js && git commit -m "test: add missing tables to truncateTables, add seedCompletedVisit + seedCatalogItem helpers"
```

---

### Task 2: History routes

**Files:**
- Create: `src/routes/history.js`
- Create: `tests/history.test.js`
- Modify: `src/index.js`

**Interfaces:**
- Consumes: `pool` from `../db/pool`, `requireRole` from `../middleware/auth`, `crypto.randomUUID()`
- Produces: routes mounted at `/api/dispatch`: `GET /history`, `GET /history/address/:addressId`, `PATCH /visits/:id`, `GET /visits/:id/edit-log`

**Route summary:**
| Method | Path | Auth | Behavior |
|--------|------|------|----------|
| GET | /api/dispatch/history | owner/dispatcher | Filtered visit history, `completed_at DESC` |
| GET | /api/dispatch/history/address/:addressId | owner/dispatcher | All visits for address, chronological |
| PATCH | /api/dispatch/visits/:id | owner/dispatcher | Partial update + edit_log row |
| GET | /api/dispatch/visits/:id/edit-log | owner/dispatcher | Audit log for a visit |

- [ ] **Step 1: Write failing tests in `tests/history.test.js`**

```javascript
const request = require('supertest');
const crypto = require('crypto');
const app = require('../src/index');
const { pool, truncateTables } = require('./helpers/db');
const { seedDispatcherWithToken, seedCompletedVisit, seedTechnicianWithToken } = require('./helpers/seeds');

beforeEach(truncateTables);
afterAll(() => pool.end());

// ── GET /api/dispatch/history ─────────────────────────────────────────────────

describe('GET /api/dispatch/history', () => {
  it('returns completed visits ordered by completedAt DESC', async () => {
    const { dispatcher, token } = await seedDispatcherWithToken();
    const { visitId, technicianId } = await seedCompletedVisit();

    const res = await request(app)
      .get('/api/dispatch/history')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    const item = res.body.find((v) => v.id === visitId);
    expect(item).toBeDefined();
    expect(item.status).toBe('completed');
    expect(item.address).toBeDefined();
    expect(item.address.street).toBeDefined();
    expect(item.technicianId).toBe(technicianId);
    expect(item.completedAt).toBeDefined();
  });

  it('filters by technicianId', async () => {
    const { token } = await seedDispatcherWithToken();
    const { visitId: v1, technicianId: t1 } = await seedCompletedVisit();
    const { visitId: v2, technicianId: t2 } = await seedCompletedVisit();

    const res = await request(app)
      .get(`/api/dispatch/history?technicianId=${t1}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    const ids = res.body.map((v) => v.id);
    expect(ids).toContain(v1);
    expect(ids).not.toContain(v2);
  });

  it('filters by addressId', async () => {
    const { token } = await seedDispatcherWithToken();
    const { visitId: v1, addressId } = await seedCompletedVisit();
    const { visitId: v2 } = await seedCompletedVisit();

    const res = await request(app)
      .get(`/api/dispatch/history?addressId=${addressId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    const ids = res.body.map((v) => v.id);
    expect(ids).toContain(v1);
    expect(ids).not.toContain(v2);
  });

  it('returns 403 for technician role', async () => {
    const { tech, token } = await seedTechnicianWithToken();

    const res = await request(app)
      .get('/api/dispatch/history')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
  });
});

// ── GET /api/dispatch/history/address/:addressId ──────────────────────────────

describe('GET /api/dispatch/history/address/:addressId', () => {
  it('returns all visits for the address in chronological order', async () => {
    const { token } = await seedDispatcherWithToken();
    const { visitId, addressId } = await seedCompletedVisit();

    const res = await request(app)
      .get(`/api/dispatch/history/address/${addressId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    const item = res.body.find((v) => v.id === visitId);
    expect(item).toBeDefined();
    expect(item.technicianName).toBeDefined();
    expect(item.createdAt).toBeDefined();
  });

  it('returns empty array for address with no visits', async () => {
    const { token } = await seedDispatcherWithToken();
    const addrRes = await pool.query(
      `INSERT INTO addresses (id, street, city) VALUES (gen_random_uuid()::text, '999 EMPTY ST', 'Houston') RETURNING id`
    );
    const addressId = addrRes.rows[0].id;

    const res = await request(app)
      .get(`/api/dispatch/history/address/${addressId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});

// ── PATCH /api/dispatch/visits/:id ───────────────────────────────────────────

describe('PATCH /api/dispatch/visits/:id', () => {
  it('updates notes and creates an edit_log row', async () => {
    const { token } = await seedDispatcherWithToken();
    const { visitId } = await seedCompletedVisit();

    const res = await request(app)
      .patch(`/api/dispatch/visits/${visitId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ notes: 'updated notes' });

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(visitId);

    const log = await pool.query(
      `SELECT * FROM edit_log WHERE visit_id = $1`,
      [visitId]
    );
    expect(log.rows).toHaveLength(1);
    expect(log.rows[0].summary).toContain('notes');
    expect(log.rows[0].source).toBe('dispatch_direct');
  });

  it('only updates provided fields — other fields unchanged', async () => {
    const { token } = await seedDispatcherWithToken();
    const { visitId } = await seedCompletedVisit();

    await pool.query(`UPDATE visits SET order_number = 'ORD-123' WHERE id = $1`, [visitId]);

    await request(app)
      .patch(`/api/dispatch/visits/${visitId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ notes: 'only notes' });

    const row = await pool.query(`SELECT order_number, notes FROM visits WHERE id = $1`, [visitId]);
    expect(row.rows[0].order_number).toBe('ORD-123');
    expect(row.rows[0].notes).toBe('only notes');
  });

  it('returns 400 if technicianId is invalid', async () => {
    const { token } = await seedDispatcherWithToken();
    const { visitId } = await seedCompletedVisit();

    const res = await request(app)
      .patch(`/api/dispatch/visits/${visitId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ technicianId: 'nonexistent-id' });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Technician');
  });

  it('returns 404 for unknown visit', async () => {
    const { token } = await seedDispatcherWithToken();

    const res = await request(app)
      .patch(`/api/dispatch/visits/bad-id`)
      .set('Authorization', `Bearer ${token}`)
      .send({ notes: 'test' });

    expect(res.status).toBe(404);
  });

  it('returns 403 for technician role', async () => {
    const { tech, token } = await seedTechnicianWithToken();
    const { visitId } = await seedCompletedVisit();

    const res = await request(app)
      .patch(`/api/dispatch/visits/${visitId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ notes: 'test' });

    expect(res.status).toBe(403);
  });
});

// ── GET /api/dispatch/visits/:id/edit-log ─────────────────────────────────────

describe('GET /api/dispatch/visits/:id/edit-log', () => {
  it('returns edit_log entries ordered by changedAt ASC', async () => {
    const { token } = await seedDispatcherWithToken();
    const { visitId } = await seedCompletedVisit();

    // Create two log entries
    await request(app)
      .patch(`/api/dispatch/visits/${visitId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ notes: 'first edit' });

    await request(app)
      .patch(`/api/dispatch/visits/${visitId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ orderNumber: 'ORD-999' });

    const res = await request(app)
      .get(`/api/dispatch/visits/${visitId}/edit-log`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThanOrEqual(2);
    const entry = res.body[0];
    expect(entry.id).toBeDefined();
    expect(entry.changedAt).toBeDefined();
    expect(entry.summary).toBeDefined();
    expect(entry.source).toBe('dispatch_direct');
  });

  it('returns empty array for visit with no edits', async () => {
    const { token } = await seedDispatcherWithToken();
    const { visitId } = await seedCompletedVisit();

    const res = await request(app)
      .get(`/api/dispatch/visits/${visitId}/edit-log`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests — confirm they fail**

```bash
cd /Users/chrismaldo/Dropbox/AC/fieldops-platform && npx jest tests/history.test.js --no-coverage 2>&1 | tail -20
```

Expected: all tests fail with 404 (routes don't exist yet).

- [ ] **Step 3: Create `src/routes/history.js`**

```javascript
const crypto = require('crypto');
const express = require('express');
const { pool } = require('../db/pool');
const { requireRole } = require('../middleware/auth');

const router = express.Router();

// GET /api/dispatch/history
router.get('/history', requireRole('owner', 'dispatcher'), async (req, res, next) => {
  try {
    const { addressId, technicianId, dateFrom, dateTo, status } = req.query;
    const conditions = [];
    const params = [];

    if (addressId) {
      params.push(addressId);
      conditions.push(`v.address_id = $${params.length}`);
    }
    if (technicianId) {
      params.push(technicianId);
      conditions.push(`v.technician_id = $${params.length}`);
    }
    if (dateFrom) {
      params.push(dateFrom);
      conditions.push(`v.completed_at >= $${params.length}`);
    }
    if (dateTo) {
      params.push(dateTo);
      conditions.push(`v.completed_at <= $${params.length}`);
    }
    if (status) {
      params.push(status);
      conditions.push(`v.status = $${params.length}`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const result = await pool.query(
      `SELECT v.id, v.order_number, v.status, v.completed_at, v.total_price, v.technician_id,
              a.street, a.city, a.subdivision, a.builder
       FROM visits v
       JOIN addresses a ON a.id = v.address_id
       ${where}
       ORDER BY v.completed_at DESC`,
      params
    );

    res.json(result.rows.map((r) => ({
      id: r.id,
      orderNumber: r.order_number,
      status: r.status,
      completedAt: r.completed_at,
      totalPrice: r.total_price,
      technicianId: r.technician_id,
      address: { street: r.street, city: r.city, subdivision: r.subdivision, builder: r.builder },
    })));
  } catch (err) {
    next(err);
  }
});

// GET /api/dispatch/history/address/:addressId
router.get('/history/address/:addressId', requireRole('owner', 'dispatcher'), async (req, res, next) => {
  try {
    const { addressId } = req.params;

    const result = await pool.query(
      `SELECT v.id, v.order_number, v.status, v.completed_at, v.total_price,
              v.technician_id, v.created_at,
              t.name AS technician_name
       FROM visits v
       LEFT JOIN technicians t ON t.id = v.technician_id
       WHERE v.address_id = $1
       ORDER BY v.created_at ASC`,
      [addressId]
    );

    res.json(result.rows.map((r) => ({
      id: r.id,
      orderNumber: r.order_number,
      status: r.status,
      completedAt: r.completed_at,
      totalPrice: r.total_price,
      technicianId: r.technician_id,
      technicianName: r.technician_name,
      createdAt: r.created_at,
    })));
  } catch (err) {
    next(err);
  }
});

// PATCH /api/dispatch/visits/:id
router.patch('/visits/:id', requireRole('owner', 'dispatcher'), async (req, res, next) => {
  try {
    const { id } = req.params;

    const visitResult = await pool.query('SELECT id FROM visits WHERE id = $1', [id]);
    if (visitResult.rows.length === 0) return res.status(404).json({ error: 'Visit not found' });

    const EDITABLE = ['orderNumber', 'scheduledTime', 'notes', 'technicianId', 'status'];
    const DB_FIELD = {
      orderNumber: 'order_number',
      scheduledTime: 'scheduled_time',
      notes: 'notes',
      technicianId: 'technician_id',
      status: 'status',
    };

    const fieldsToUpdate = EDITABLE.filter((f) => req.body[f] !== undefined);
    if (fieldsToUpdate.length === 0) {
      const row = await pool.query(
        `SELECT v.id, v.order_number, v.status, v.technician_id, v.notes, v.scheduled_time,
                v.completed_at, v.total_price
         FROM visits v WHERE v.id = $1`,
        [id]
      );
      const v = row.rows[0];
      return res.json({
        id: v.id,
        orderNumber: v.order_number,
        status: v.status,
        technicianId: v.technician_id,
        notes: v.notes,
        scheduledTime: v.scheduled_time,
        completedAt: v.completed_at,
        totalPrice: v.total_price,
      });
    }

    if (req.body.technicianId !== undefined) {
      const techResult = await pool.query(
        'SELECT id FROM technicians WHERE id = $1 AND is_active = true',
        [req.body.technicianId]
      );
      if (techResult.rows.length === 0) {
        return res.status(400).json({ error: 'Technician not found or inactive' });
      }
    }

    const now = new Date().toISOString();
    const setClauses = fieldsToUpdate.map((f, i) => `${DB_FIELD[f]} = $${i + 1}`);
    setClauses.push(`updated_at = $${fieldsToUpdate.length + 1}`);
    const values = fieldsToUpdate.map((f) => req.body[f]);
    values.push(now);
    values.push(id);

    const updated = await pool.query(
      `UPDATE visits SET ${setClauses.join(', ')} WHERE id = $${values.length}
       RETURNING id, order_number, status, technician_id, notes, scheduled_time, completed_at, total_price`,
      values
    );

    const logId = crypto.randomUUID();
    const changedNames = fieldsToUpdate.join(', ');
    await pool.query(
      `INSERT INTO edit_log (id, visit_id, changed_at, summary, source)
       VALUES ($1, $2, $3, $4, 'dispatch_direct')`,
      [logId, id, now, `Dispatcher updated: ${changedNames}`]
    );

    const v = updated.rows[0];
    res.json({
      id: v.id,
      orderNumber: v.order_number,
      status: v.status,
      technicianId: v.technician_id,
      notes: v.notes,
      scheduledTime: v.scheduled_time,
      completedAt: v.completed_at,
      totalPrice: v.total_price,
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/dispatch/visits/:id/edit-log
router.get('/visits/:id/edit-log', requireRole('owner', 'dispatcher'), async (req, res, next) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `SELECT id, changed_at, summary, source
       FROM edit_log
       WHERE visit_id = $1
       ORDER BY changed_at ASC`,
      [id]
    );

    res.json(result.rows.map((r) => ({
      id: r.id,
      changedAt: r.changed_at,
      summary: r.summary,
      source: r.source,
    })));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
```

- [ ] **Step 4: Mount history.js in `src/index.js`**

Add after the existing `app.use('/api/dispatch/visits', dispatchVisitsRouter)` line:

```javascript
app.use('/api/dispatch', require('./routes/history'));
```

The full mount block in index.js should look like:

```javascript
const { visitsRouter, dispatchVisitsRouter } = require('./routes/visits');
app.use('/api/visits', visitsRouter);
app.use('/api/dispatch/visits', dispatchVisitsRouter);
app.use('/api/visits', require('./routes/workspace'));
app.use('/api/visits', require('./routes/completion'));
app.use('/api', require('./routes/transfers'));
app.use('/api/dispatch', require('./routes/history'));
```

- [ ] **Step 5: Run history tests — confirm they pass**

```bash
cd /Users/chrismaldo/Dropbox/AC/fieldops-platform && npx jest tests/history.test.js --no-coverage 2>&1 | tail -20
```

Expected: all history tests pass.

- [ ] **Step 6: Run full test suite — confirm no regressions**

```bash
cd /Users/chrismaldo/Dropbox/AC/fieldops-platform && npm test 2>&1 | tail -20
```

Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
cd /Users/chrismaldo/Dropbox/AC/fieldops-platform && git add src/routes/history.js tests/history.test.js src/index.js && git commit -m "feat: add history routes — GET /dispatch/history, PATCH /dispatch/visits/:id, edit-log"
```

---

### Task 3: Inventory routes

**Files:**
- Create: `src/routes/inventory.js`
- Create: `tests/inventory.test.js`
- Modify: `src/index.js`

**Interfaces:**
- Consumes: `pool`, `requireRole`, `crypto.randomUUID()`
- Produces: routes at `GET /api/inventory/mine`, `GET /api/dispatch/inventory`, `POST /api/dispatch/inventory/assign`

**Period start logic** (Monday of current week):
```javascript
function getCurrentPeriodStart() {
  const today = new Date();
  const day = today.getDay(); // 0 = Sunday
  const diff = day === 0 ? -6 : 1 - day;
  const monday = new Date(today);
  monday.setDate(today.getDate() + diff);
  return monday.toISOString().slice(0, 10); // YYYY-MM-DD
}
```

- [ ] **Step 1: Write failing tests in `tests/inventory.test.js`**

```javascript
const request = require('supertest');
const crypto = require('crypto');
const app = require('../src/index');
const { pool, truncateTables } = require('./helpers/db');
const {
  seedDispatcherWithToken, seedTechnicianWithToken,
  seedCompletedVisit, seedCatalogItem,
} = require('./helpers/seeds');

beforeEach(truncateTables);
afterAll(() => pool.end());

function getCurrentPeriodStart() {
  const today = new Date();
  const day = today.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  const monday = new Date(today);
  monday.setDate(today.getDate() + diff);
  return monday.toISOString().slice(0, 10);
}

async function seedInventoryAssignment(technicianId, itemName, quantityAssigned, periodStart) {
  const id = crypto.randomUUID();
  await pool.query(
    `INSERT INTO inventory_assignments (id, technician_id, item_name, quantity_assigned, period_start, created_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [id, technicianId, itemName, quantityAssigned, periodStart, new Date().toISOString()]
  );
  return id;
}

// ── GET /api/inventory/mine ───────────────────────────────────────────────────

describe('GET /api/inventory/mine', () => {
  it('returns balance = assigned - consumed for current period', async () => {
    const { tech, token } = await seedTechnicianWithToken();
    const itemName = `ITEM-${crypto.randomBytes(4).toString('hex')}`;
    await seedCatalogItem(itemName, { techSupplied: true });

    const periodStart = getCurrentPeriodStart();
    await seedInventoryAssignment(tech.id, itemName, 10, periodStart);

    // Seed a completed visit with a tech-supplied item_visit row for this tech
    const { visitId } = await seedCompletedVisit({ technicianId: tech.id });
    await pool.query(
      `INSERT INTO visit_items (id, visit_id, item_name, category, quantity, price, tech_supplied)
       VALUES (gen_random_uuid()::text, $1, $2, 'accessory', 3, 50, true)`,
      [visitId, itemName]
    );

    // Also update completed_at to be within this period
    await pool.query(
      `UPDATE visits SET completed_at = $1 WHERE id = $2`,
      [new Date().toISOString(), visitId]
    );

    const res = await request(app)
      .get('/api/inventory/mine')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    const item = res.body.find((i) => i.itemName === itemName);
    expect(item).toBeDefined();
    expect(item.quantityAssigned).toBe(10);
    expect(item.quantityConsumed).toBe(3);
    expect(item.balance).toBe(7);
  });

  it('returns balance = assigned when no consumption', async () => {
    const { tech, token } = await seedTechnicianWithToken();
    const itemName = `ITEM-${crypto.randomBytes(4).toString('hex')}`;
    await seedCatalogItem(itemName);

    const periodStart = getCurrentPeriodStart();
    await seedInventoryAssignment(tech.id, itemName, 5, periodStart);

    const res = await request(app)
      .get('/api/inventory/mine')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    const item = res.body.find((i) => i.itemName === itemName);
    expect(item).toBeDefined();
    expect(item.quantityConsumed).toBe(0);
    expect(item.balance).toBe(5);
  });

  it('returns empty array when no assignments for current period', async () => {
    const { token } = await seedTechnicianWithToken();

    const res = await request(app)
      .get('/api/inventory/mine')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('returns 403 for dispatcher role', async () => {
    const { token } = await seedDispatcherWithToken();

    const res = await request(app)
      .get('/api/inventory/mine')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
  });
});

// ── GET /api/dispatch/inventory ───────────────────────────────────────────────

describe('GET /api/dispatch/inventory', () => {
  it('returns inventory grouped by technician', async () => {
    const { dispatcher, token } = await seedDispatcherWithToken();
    const { tech } = await seedTechnicianWithToken();
    const itemName = `ITEM-${crypto.randomBytes(4).toString('hex')}`;
    await seedCatalogItem(itemName);

    const periodStart = getCurrentPeriodStart();
    await seedInventoryAssignment(tech.id, itemName, 8, periodStart);

    const res = await request(app)
      .get('/api/dispatch/inventory')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    const techEntry = res.body.find((e) => e.technicianId === tech.id);
    expect(techEntry).toBeDefined();
    expect(techEntry.technicianName).toBe(tech.name);
    expect(Array.isArray(techEntry.items)).toBe(true);
    const itemEntry = techEntry.items.find((i) => i.itemName === itemName);
    expect(itemEntry.quantityAssigned).toBe(8);
    expect(itemEntry.balance).toBeDefined();
  });

  it('returns 403 for technician role', async () => {
    const { token } = await seedTechnicianWithToken();

    const res = await request(app)
      .get('/api/dispatch/inventory')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
  });
});

// ── POST /api/dispatch/inventory/assign ───────────────────────────────────────

describe('POST /api/dispatch/inventory/assign', () => {
  it('creates an inventory_assignments row', async () => {
    const { token } = await seedDispatcherWithToken();
    const { tech } = await seedTechnicianWithToken();
    const itemName = `ITEM-${crypto.randomBytes(4).toString('hex')}`;
    await seedCatalogItem(itemName);

    const periodStart = getCurrentPeriodStart();

    const res = await request(app)
      .post('/api/dispatch/inventory/assign')
      .set('Authorization', `Bearer ${token}`)
      .send({ technicianId: tech.id, itemName, quantityAssigned: 12, periodStart });

    expect(res.status).toBe(200);
    expect(res.body.id).toBeDefined();
    expect(res.body.technicianId).toBe(tech.id);
    expect(res.body.itemName).toBe(itemName);
    expect(res.body.quantityAssigned).toBe(12);
    expect(res.body.periodStart).toBe(periodStart);

    const row = await pool.query(
      `SELECT * FROM inventory_assignments WHERE id = $1`,
      [res.body.id]
    );
    expect(row.rows).toHaveLength(1);
    expect(row.rows[0].quantity_assigned).toBe(12);
  });

  it('returns 400 if technician does not exist', async () => {
    const { token } = await seedDispatcherWithToken();
    const itemName = `ITEM-${crypto.randomBytes(4).toString('hex')}`;
    await seedCatalogItem(itemName);

    const res = await request(app)
      .post('/api/dispatch/inventory/assign')
      .set('Authorization', `Bearer ${token}`)
      .send({ technicianId: 'bad-id', itemName, quantityAssigned: 5, periodStart: '2026-06-23' });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Technician');
  });

  it('returns 400 if itemName does not exist in catalog', async () => {
    const { token } = await seedDispatcherWithToken();
    const { tech } = await seedTechnicianWithToken();

    const res = await request(app)
      .post('/api/dispatch/inventory/assign')
      .set('Authorization', `Bearer ${token}`)
      .send({ technicianId: tech.id, itemName: 'NONEXISTENT-ITEM', quantityAssigned: 5, periodStart: '2026-06-23' });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('item');
  });

  it('returns 403 for technician role', async () => {
    const { token } = await seedTechnicianWithToken();

    const res = await request(app)
      .post('/api/dispatch/inventory/assign')
      .set('Authorization', `Bearer ${token}`)
      .send({ technicianId: 'x', itemName: 'x', quantityAssigned: 1, periodStart: '2026-06-23' });

    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 2: Run tests — confirm they fail**

```bash
cd /Users/chrismaldo/Dropbox/AC/fieldops-platform && npx jest tests/inventory.test.js --no-coverage 2>&1 | tail -20
```

Expected: all fail (routes don't exist yet).

- [ ] **Step 3: Create `src/routes/inventory.js`**

```javascript
const crypto = require('crypto');
const express = require('express');
const { pool } = require('../db/pool');
const { requireRole } = require('../middleware/auth');

const router = express.Router();

function getCurrentPeriodStart() {
  const today = new Date();
  const day = today.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  const monday = new Date(today);
  monday.setDate(today.getDate() + diff);
  return monday.toISOString().slice(0, 10);
}

async function getInventoryForTechnician(technicianId, periodStart) {
  const assignments = await pool.query(
    `SELECT item_name, quantity_assigned FROM inventory_assignments
     WHERE technician_id = $1 AND period_start = $2`,
    [technicianId, periodStart]
  );

  if (assignments.rows.length === 0) return [];

  const consumedResult = await pool.query(
    `SELECT vi.item_name, SUM(vi.quantity)::integer AS consumed
     FROM visit_items vi
     JOIN visits v ON v.id = vi.visit_id
     WHERE vi.tech_supplied = true
       AND v.technician_id = $1
       AND v.completed_at >= $2
       AND v.status IN ('completed', 'temporarily', 'cancelled')
     GROUP BY vi.item_name`,
    [technicianId, periodStart]
  );

  const consumedMap = {};
  for (const row of consumedResult.rows) {
    consumedMap[row.item_name] = row.consumed;
  }

  return assignments.rows.map((a) => {
    const consumed = consumedMap[a.item_name] || 0;
    return {
      itemName: a.item_name,
      quantityAssigned: a.quantity_assigned,
      quantityConsumed: consumed,
      balance: a.quantity_assigned - consumed,
    };
  });
}

// GET /api/inventory/mine
router.get('/inventory/mine', requireRole('technician'), async (req, res, next) => {
  try {
    const periodStart = getCurrentPeriodStart();
    const items = await getInventoryForTechnician(req.technician.id, periodStart);
    res.json(items);
  } catch (err) {
    next(err);
  }
});

// GET /api/dispatch/inventory
router.get('/dispatch/inventory', requireRole('owner', 'dispatcher'), async (req, res, next) => {
  try {
    const periodStart = getCurrentPeriodStart();

    const techResult = await pool.query(
      `SELECT DISTINCT ia.technician_id, t.name
       FROM inventory_assignments ia
       JOIN technicians t ON t.id = ia.technician_id
       WHERE ia.period_start = $1`,
      [periodStart]
    );

    const result = [];
    for (const tech of techResult.rows) {
      const items = await getInventoryForTechnician(tech.technician_id, periodStart);
      result.push({
        technicianId: tech.technician_id,
        technicianName: tech.name,
        items,
      });
    }

    res.json(result);
  } catch (err) {
    next(err);
  }
});

// POST /api/dispatch/inventory/assign
router.post('/dispatch/inventory/assign', requireRole('owner', 'dispatcher'), async (req, res, next) => {
  try {
    const { technicianId, itemName, quantityAssigned, periodStart } = req.body;

    const techResult = await pool.query(
      'SELECT id FROM technicians WHERE id = $1',
      [technicianId]
    );
    if (techResult.rows.length === 0) {
      return res.status(400).json({ error: 'Technician not found' });
    }

    const itemResult = await pool.query(
      'SELECT item_name FROM catalog_items WHERE item_name = $1',
      [itemName]
    );
    if (itemResult.rows.length === 0) {
      return res.status(400).json({ error: 'Catalog item not found' });
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    await pool.query(
      `INSERT INTO inventory_assignments (id, technician_id, item_name, quantity_assigned, period_start, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, technicianId, itemName, quantityAssigned, periodStart, now]
    );

    res.json({ id, technicianId, itemName, quantityAssigned, periodStart });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
```

- [ ] **Step 4: Mount inventory.js in `src/index.js`**

Add after the history mount:

```javascript
app.use('/api', require('./routes/inventory'));
```

- [ ] **Step 5: Run inventory tests — confirm they pass**

```bash
cd /Users/chrismaldo/Dropbox/AC/fieldops-platform && npx jest tests/inventory.test.js --no-coverage 2>&1 | tail -20
```

Expected: all inventory tests pass.

- [ ] **Step 6: Run full test suite**

```bash
cd /Users/chrismaldo/Dropbox/AC/fieldops-platform && npm test 2>&1 | tail -20
```

Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
cd /Users/chrismaldo/Dropbox/AC/fieldops-platform && git add src/routes/inventory.js tests/inventory.test.js src/index.js && git commit -m "feat: add inventory routes — mine balance, dispatch overview, assign"
```

---

### Task 4: Restock routes

**Files:**
- Create: `src/routes/restock.js`
- Create: `tests/restock.test.js`
- Modify: `src/index.js`

**Interfaces:**
- Consumes: `pool`, `requireRole`, `crypto.randomUUID()`
- Produces: routes at `GET /api/dispatch/restock-report`, `POST /api/dispatch/restock-report/mark-restocked`, `GET /api/dispatch/pay-periods/:id/anomalies`

**Schema constraint note:** `restock_records` unique constraint is `UNIQUE (item_name, period_start, period_end)` — ON CONFLICT must use all three columns.

- [ ] **Step 1: Write failing tests in `tests/restock.test.js`**

```javascript
const request = require('supertest');
const crypto = require('crypto');
const app = require('../src/index');
const { pool, truncateTables } = require('./helpers/db');
const {
  seedDispatcherWithToken, seedTechnicianWithToken,
  seedCompletedVisit, seedCatalogItem,
} = require('./helpers/seeds');

beforeEach(truncateTables);
afterAll(() => pool.end());

async function seedCompletedVisitWithItem(technicianId, itemName, quantity, price) {
  const { visitId } = await seedCompletedVisit({ technicianId });
  await pool.query(
    `UPDATE visits SET completed_at = $1 WHERE id = $2`,
    [new Date().toISOString(), visitId]
  );
  await pool.query(
    `INSERT INTO visit_items (id, visit_id, item_name, category, quantity, price, tech_supplied)
     VALUES (gen_random_uuid()::text, $1, $2, 'accessory', $3, $4, true)`,
    [visitId, itemName, quantity, price]
  );
  return visitId;
}

async function seedPayPeriod(weekStart, weekEnd) {
  const id = crypto.randomUUID();
  await pool.query(
    `INSERT INTO pay_periods (id, week_start, week_end, status)
     VALUES ($1, $2, $3, 'open')`,
    [id, weekStart, weekEnd]
  );
  return id;
}

// ── GET /api/dispatch/restock-report ─────────────────────────────────────────

describe('GET /api/dispatch/restock-report', () => {
  it('returns consumed totals grouped by item with technician breakdown', async () => {
    const { token } = await seedDispatcherWithToken();
    const { tech } = await seedTechnicianWithToken();
    const itemName = `ITEM-${crypto.randomBytes(4).toString('hex')}`;
    await seedCatalogItem(itemName);

    await seedCompletedVisitWithItem(tech.id, itemName, 4, 50);
    await seedCompletedVisitWithItem(tech.id, itemName, 2, 50);

    const res = await request(app)
      .get('/api/dispatch/restock-report')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.items).toBeDefined();
    const entry = res.body.items.find((i) => i.itemName === itemName);
    expect(entry).toBeDefined();
    expect(entry.totalConsumed).toBe(6);
    expect(Array.isArray(entry.byTechnician)).toBe(true);
    const techEntry = entry.byTechnician.find((t) => t.technicianId === tech.id);
    expect(techEntry).toBeDefined();
    expect(techEntry.consumed).toBe(6);
    expect(techEntry.technicianName).toBe(tech.name);
  });

  it('respects dateFrom and dateTo filters', async () => {
    const { token } = await seedDispatcherWithToken();
    const { tech } = await seedTechnicianWithToken();
    const itemName = `ITEM-${crypto.randomBytes(4).toString('hex')}`;
    await seedCatalogItem(itemName);

    // Visit completed today — inside range
    await seedCompletedVisitWithItem(tech.id, itemName, 3, 50);

    const res = await request(app)
      .get('/api/dispatch/restock-report?dateFrom=2020-01-01&dateTo=2030-12-31')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    const entry = res.body.items.find((i) => i.itemName === itemName);
    expect(entry.totalConsumed).toBe(3);
  });

  it('returns 403 for technician role', async () => {
    const { token } = await seedTechnicianWithToken();

    const res = await request(app)
      .get('/api/dispatch/restock-report')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
  });
});

// ── POST /api/dispatch/restock-report/mark-restocked ─────────────────────────

describe('POST /api/dispatch/restock-report/mark-restocked', () => {
  it('creates restock_records rows', async () => {
    const { token } = await seedDispatcherWithToken();
    const item1 = `ITEM-${crypto.randomBytes(4).toString('hex')}`;
    const item2 = `ITEM-${crypto.randomBytes(4).toString('hex')}`;
    await seedCatalogItem(item1);
    await seedCatalogItem(item2);

    const res = await request(app)
      .post('/api/dispatch/restock-report/mark-restocked')
      .set('Authorization', `Bearer ${token}`)
      .send({ periodStart: '2026-06-23', periodEnd: '2026-06-29', itemNames: [item1, item2] });

    expect(res.status).toBe(200);
    expect(res.body.restocked).toBe(2);
    expect(res.body.items).toEqual([item1, item2]);

    const rows = await pool.query(
      `SELECT * FROM restock_records WHERE item_name IN ($1, $2)`,
      [item1, item2]
    );
    expect(rows.rows).toHaveLength(2);
    expect(rows.rows[0].status).toBe('restocked');
    expect(rows.rows[0].restocked_at).toBeDefined();
  });

  it('upserts on repeat call — does not duplicate rows', async () => {
    const { token } = await seedDispatcherWithToken();
    const itemName = `ITEM-${crypto.randomBytes(4).toString('hex')}`;
    await seedCatalogItem(itemName);

    const body = { periodStart: '2026-06-23', periodEnd: '2026-06-29', itemNames: [itemName] };

    await request(app)
      .post('/api/dispatch/restock-report/mark-restocked')
      .set('Authorization', `Bearer ${token}`)
      .send(body);

    const res = await request(app)
      .post('/api/dispatch/restock-report/mark-restocked')
      .set('Authorization', `Bearer ${token}`)
      .send(body);

    expect(res.status).toBe(200);

    const rows = await pool.query(
      `SELECT * FROM restock_records WHERE item_name = $1 AND period_start = $2`,
      [itemName, '2026-06-23']
    );
    expect(rows.rows).toHaveLength(1);
  });

  it('returns 403 for technician role', async () => {
    const { token } = await seedTechnicianWithToken();

    const res = await request(app)
      .post('/api/dispatch/restock-report/mark-restocked')
      .set('Authorization', `Bearer ${token}`)
      .send({ periodStart: '2026-06-23', periodEnd: '2026-06-29', itemNames: [] });

    expect(res.status).toBe(403);
  });
});

// ── GET /api/dispatch/pay-periods/:id/anomalies ───────────────────────────────

describe('GET /api/dispatch/pay-periods/:id/anomalies', () => {
  it('returns items with prices outside catalog bounds', async () => {
    const { token } = await seedDispatcherWithToken();
    const { tech } = await seedTechnicianWithToken();
    const itemName = `ITEM-${crypto.randomBytes(4).toString('hex')}`;
    await seedCatalogItem(itemName, { techSupplied: true, expectedPriceMin: 40, expectedPriceMax: 60 });

    const periodId = await seedPayPeriod('2026-06-23', '2026-06-29');

    // Create completed visit within pay period
    const { visitId } = await seedCompletedVisit({ technicianId: tech.id });
    await pool.query(
      `UPDATE visits SET completed_at = '2026-06-25T10:00:00Z' WHERE id = $1`,
      [visitId]
    );
    // Price below min (40)
    await pool.query(
      `INSERT INTO visit_items (id, visit_id, item_name, category, quantity, price, tech_supplied)
       VALUES (gen_random_uuid()::text, $1, $2, 'accessory', 1, 20, true)`,
      [visitId, itemName]
    );

    const res = await request(app)
      .get(`/api/dispatch/pay-periods/${periodId}/anomalies`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    const anomaly = res.body.find((a) => a.visitId === visitId && a.itemName === itemName);
    expect(anomaly).toBeDefined();
    expect(anomaly.price).toBe(20);
    expect(anomaly.expectedMin).toBe(40);
    expect(anomaly.expectedMax).toBe(60);
  });

  it('does not flag items within bounds', async () => {
    const { token } = await seedDispatcherWithToken();
    const { tech } = await seedTechnicianWithToken();
    const itemName = `ITEM-${crypto.randomBytes(4).toString('hex')}`;
    await seedCatalogItem(itemName, { techSupplied: true, expectedPriceMin: 40, expectedPriceMax: 60 });

    const periodId = await seedPayPeriod('2026-06-23', '2026-06-29');

    const { visitId } = await seedCompletedVisit({ technicianId: tech.id });
    await pool.query(
      `UPDATE visits SET completed_at = '2026-06-25T10:00:00Z' WHERE id = $1`,
      [visitId]
    );
    // Price in-range (50)
    await pool.query(
      `INSERT INTO visit_items (id, visit_id, item_name, category, quantity, price, tech_supplied)
       VALUES (gen_random_uuid()::text, $1, $2, 'accessory', 1, 50, true)`,
      [visitId, itemName]
    );

    const res = await request(app)
      .get(`/api/dispatch/pay-periods/${periodId}/anomalies`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    const anomaly = res.body.find((a) => a.visitId === visitId && a.itemName === itemName);
    expect(anomaly).toBeUndefined();
  });

  it('does not flag items with no catalog bounds', async () => {
    const { token } = await seedDispatcherWithToken();
    const { tech } = await seedTechnicianWithToken();
    const itemName = `ITEM-${crypto.randomBytes(4).toString('hex')}`;
    await seedCatalogItem(itemName, { techSupplied: true, expectedPriceMin: null, expectedPriceMax: null });

    const periodId = await seedPayPeriod('2026-06-23', '2026-06-29');

    const { visitId } = await seedCompletedVisit({ technicianId: tech.id });
    await pool.query(
      `UPDATE visits SET completed_at = '2026-06-25T10:00:00Z' WHERE id = $1`,
      [visitId]
    );
    await pool.query(
      `INSERT INTO visit_items (id, visit_id, item_name, category, quantity, price, tech_supplied)
       VALUES (gen_random_uuid()::text, $1, $2, 'accessory', 1, 999, true)`,
      [visitId, itemName]
    );

    const res = await request(app)
      .get(`/api/dispatch/pay-periods/${periodId}/anomalies`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    const anomaly = res.body.find((a) => a.visitId === visitId);
    expect(anomaly).toBeUndefined();
  });

  it('returns 404 for unknown pay period', async () => {
    const { token } = await seedDispatcherWithToken();

    const res = await request(app)
      .get('/api/dispatch/pay-periods/nonexistent-id/anomalies')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);
  });

  it('returns 403 for technician role', async () => {
    const { token } = await seedTechnicianWithToken();

    const res = await request(app)
      .get('/api/dispatch/pay-periods/some-id/anomalies')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 2: Run tests — confirm they fail**

```bash
cd /Users/chrismaldo/Dropbox/AC/fieldops-platform && npx jest tests/restock.test.js --no-coverage 2>&1 | tail -20
```

Expected: all fail (routes don't exist yet).

- [ ] **Step 3: Create `src/routes/restock.js`**

```javascript
const crypto = require('crypto');
const express = require('express');
const { pool } = require('../db/pool');
const { requireRole } = require('../middleware/auth');

const router = express.Router();

// GET /api/dispatch/restock-report
router.get('/restock-report', requireRole('owner', 'dispatcher'), async (req, res, next) => {
  try {
    const { dateFrom, dateTo } = req.query;
    const conditions = [`v.status IN ('completed', 'temporarily', 'cancelled')`, `vi.tech_supplied = true`];
    const params = [];

    if (dateFrom) {
      params.push(dateFrom);
      conditions.push(`v.completed_at >= $${params.length}`);
    }
    if (dateTo) {
      params.push(dateTo);
      conditions.push(`v.completed_at <= $${params.length}`);
    }

    const where = `WHERE ${conditions.join(' AND ')}`;

    const result = await pool.query(
      `SELECT vi.item_name, SUM(vi.quantity)::integer AS total_consumed,
              v.technician_id, t.name AS technician_name,
              SUM(vi.quantity)::integer AS tech_consumed
       FROM visit_items vi
       JOIN visits v ON v.id = vi.visit_id
       JOIN technicians t ON t.id = v.technician_id
       ${where}
       GROUP BY vi.item_name, v.technician_id, t.name
       ORDER BY vi.item_name, v.technician_id`,
      params
    );

    // Aggregate by item_name
    const itemMap = new Map();
    for (const row of result.rows) {
      if (!itemMap.has(row.item_name)) {
        itemMap.set(row.item_name, { itemName: row.item_name, totalConsumed: 0, byTechnician: [] });
      }
      const item = itemMap.get(row.item_name);
      item.totalConsumed += row.tech_consumed;
      item.byTechnician.push({
        technicianId: row.technician_id,
        technicianName: row.technician_name,
        consumed: row.tech_consumed,
      });
    }

    res.json({ items: Array.from(itemMap.values()) });
  } catch (err) {
    next(err);
  }
});

// POST /api/dispatch/restock-report/mark-restocked
router.post('/restock-report/mark-restocked', requireRole('owner', 'dispatcher'), async (req, res, next) => {
  try {
    const { periodStart, periodEnd, itemNames } = req.body;
    const now = new Date().toISOString();

    for (const itemName of itemNames) {
      const id = crypto.randomUUID();
      await pool.query(
        `INSERT INTO restock_records (id, period_start, period_end, item_name, total_consumed, status, restocked_at)
         VALUES ($1, $2, $3, $4, 0, 'restocked', $5)
         ON CONFLICT (item_name, period_start, period_end)
         DO UPDATE SET status = 'restocked', restocked_at = $5`,
        [id, periodStart, periodEnd, itemName, now]
      );
    }

    res.json({ restocked: itemNames.length, items: itemNames });
  } catch (err) {
    next(err);
  }
});

// GET /api/dispatch/pay-periods/:id/anomalies
router.get('/pay-periods/:id/anomalies', requireRole('owner', 'dispatcher'), async (req, res, next) => {
  try {
    const { id } = req.params;

    const periodResult = await pool.query(
      'SELECT week_start, week_end FROM pay_periods WHERE id = $1',
      [id]
    );
    if (periodResult.rows.length === 0) return res.status(404).json({ error: 'Pay period not found' });
    const { week_start, week_end } = periodResult.rows[0];

    const result = await pool.query(
      `SELECT vi.visit_id, vi.item_name, vi.price,
              ci.expected_price_min, ci.expected_price_max
       FROM visit_items vi
       JOIN visits v ON v.id = vi.visit_id
       JOIN catalog_items ci ON ci.item_name = vi.item_name
       WHERE v.status IN ('completed', 'temporarily', 'cancelled')
         AND v.completed_at >= $1
         AND v.completed_at <= $2
         AND (ci.expected_price_min IS NOT NULL OR ci.expected_price_max IS NOT NULL)
         AND (
           (ci.expected_price_min IS NOT NULL AND vi.price < ci.expected_price_min)
           OR
           (ci.expected_price_max IS NOT NULL AND vi.price > ci.expected_price_max)
         )`,
      [week_start, week_end]
    );

    res.json(result.rows.map((r) => ({
      visitId: r.visit_id,
      itemName: r.item_name,
      price: r.price,
      expectedMin: r.expected_price_min,
      expectedMax: r.expected_price_max,
    })));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
```

- [ ] **Step 4: Mount restock.js in `src/index.js`**

Add after the inventory mount:

```javascript
app.use('/api/dispatch', require('./routes/restock'));
```

The final mount block should be:

```javascript
const { visitsRouter, dispatchVisitsRouter } = require('./routes/visits');
app.use('/api/visits', visitsRouter);
app.use('/api/dispatch/visits', dispatchVisitsRouter);
app.use('/api/visits', require('./routes/workspace'));
app.use('/api/visits', require('./routes/completion'));
app.use('/api', require('./routes/transfers'));
app.use('/api/dispatch', require('./routes/history'));
app.use('/api', require('./routes/inventory'));
app.use('/api/dispatch', require('./routes/restock'));
```

- [ ] **Step 5: Run restock tests — confirm they pass**

```bash
cd /Users/chrismaldo/Dropbox/AC/fieldops-platform && npx jest tests/restock.test.js --no-coverage 2>&1 | tail -20
```

Expected: all restock tests pass.

- [ ] **Step 6: Run full test suite**

```bash
cd /Users/chrismaldo/Dropbox/AC/fieldops-platform && npm test 2>&1 | tail -20
```

Expected: all tests pass (161 existing + new history/inventory/restock tests).

- [ ] **Step 7: Commit**

```bash
cd /Users/chrismaldo/Dropbox/AC/fieldops-platform && git add src/routes/restock.js tests/restock.test.js src/index.js && git commit -m "feat: add restock routes — restock-report, mark-restocked, pay-period anomalies"
```

---

## Self-Review: Spec Coverage Check

| Spec requirement | Task covering it |
|-----------------|------------------|
| GET /api/dispatch/history with filters | Task 2 |
| GET /api/dispatch/history/address/:addressId | Task 2 |
| PATCH /api/dispatch/visits/:id + edit_log | Task 2 |
| GET /api/dispatch/visits/:id/edit-log | Task 2 |
| GET /api/inventory/mine (tech, balance) | Task 3 |
| GET /api/dispatch/inventory (all techs) | Task 3 |
| POST /api/dispatch/inventory/assign | Task 3 |
| GET /api/dispatch/restock-report | Task 4 |
| POST /api/dispatch/restock-report/mark-restocked (upsert) | Task 4 |
| GET /api/dispatch/pay-periods/:id/anomalies | Task 4 |
| Catalog bounds null → no anomaly flagging | Task 4 test |
| edit_log source = 'dispatch_direct' | Task 2 |
| ON CONFLICT uses (item_name, period_start, period_end) | Task 4 (correct, vs spec's typo) |
| truncateTables covers new tables | Task 1 |
