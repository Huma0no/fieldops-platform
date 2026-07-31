# Phase 5 — Completion, Transfers & Offline Behavior Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add visit completion (with report generation), transfer lifecycle, and the supporting report service — giving technicians idempotent completion with offline-safe retry and peer-to-peer visit handoff.

**Architecture:** Three new files (`src/services/report.js`, `src/routes/completion.js`, `src/routes/transfers.js`) plus a DB migration. The report service is a pure async function module used by both completion and download endpoints. Completion and transfer routes are mounted on existing `/api/visits` and `/api` prefixes respectively. All endpoints hit the real DB; no file storage in this phase (Drive upload stubbed).

**Tech Stack:** Node.js/Express, pg (postgres), supertest + jest (integration tests against real DB), crypto.randomUUID() for IDs, ISO 8601 text timestamps.

## Global Constraints

- All PKs: `gen_random_uuid()::text` (in SQL) or `crypto.randomUUID()` (in JS)
- All timestamps: ISO 8601 text, `new Date().toISOString()`
- No ORM; raw pg queries only
- No Drive SDK — stub with `console.log`; `visit_photos.stored_at` stays null
- DB column names: `transfers.from_tech_id`, `transfers.to_tech_id` (NOT `from_technician_id`)
- `completed_at` column already exists in `visits` schema; migration is safe no-op with `IF NOT EXISTS`
- Test runner: `jest --runInBand` against real test DB (`TEST_DATABASE_URL` or `DATABASE_URL`)
- No comments in code unless behavior is non-obvious

---

## File Map

| File | Action | Purpose |
|---|---|---|
| `src/db/migrations/004_completion_fields.sql` | Create | Add `completed_at` column if missing |
| `tests/helpers/db.js` | Modify | Add `DELETE FROM transfers` before `DELETE FROM visits` in truncateTables |
| `tests/helpers/seeds.js` | Modify | Add `seedTransferScenario` helper |
| `src/services/report.js` | Create | `generateReportText` + `generateReportJSON` |
| `src/routes/completion.js` | Create | POST complete, GET report-preview, GET download |
| `src/routes/transfers.js` | Create | initiate, accept, reject, pending/mine |
| `src/index.js` | Modify | Mount completion and transfers routers |
| `tests/completion.test.js` | Create | Integration tests for completion endpoints |
| `tests/transfers.test.js` | Create | Integration tests for transfer endpoints |

---

## Task 1: Infrastructure Setup

**Files:**
- Create: `src/db/migrations/004_completion_fields.sql`
- Modify: `tests/helpers/db.js`
- Modify: `tests/helpers/seeds.js`
- Create: `src/routes/completion.js` (stub)
- Create: `src/routes/transfers.js` (stub)
- Modify: `src/index.js`

**Interfaces:**
- Produces: `seedTransferScenario()` → `{ tech1, token1, tech2, token2, visitId, addressId, street }`
- Produces: `completion.js` exports `express.Router()` (empty)
- Produces: `transfers.js` exports `express.Router()` (empty)

---

- [ ] **Step 1: Create migration 004**

File: `src/db/migrations/004_completion_fields.sql`
```sql
ALTER TABLE visits ADD COLUMN IF NOT EXISTS completed_at TEXT;
```

- [ ] **Step 2: Run the migration**

```bash
psql $DATABASE_URL -f src/db/migrations/004_completion_fields.sql
```
Expected output: `ALTER TABLE`

- [ ] **Step 3: Update truncateTables to clear transfers**

In `tests/helpers/db.js`, add `DELETE FROM transfers;` before `DELETE FROM visits;`. The current content is:

```javascript
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.TEST_DATABASE_URL || process.env.DATABASE_URL,
});

async function truncateTables() {
  await pool.query(`
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
    DELETE FROM visits;
    DELETE FROM addresses;
    DELETE FROM pdf_batches;
    DELETE FROM technician_price_overrides;
    DELETE FROM technicians;
  `);
}

module.exports = { pool, truncateTables };
```

Replace the full file with the above.

- [ ] **Step 4: Add `seedTransferScenario` to seeds.js**

Append to `tests/helpers/seeds.js` (keep all existing exports, add the new one):

```javascript
async function seedTransferScenario() {
  const { tech: tech1, token: token1 } = await seedTechnicianWithToken({ name: 'Transfer-Tech1' });
  const { tech: tech2, token: token2 } = await seedTechnicianWithToken({ name: 'Transfer-Tech2' });

  const street = `${require('crypto').randomBytes(4).toString('hex')} TRANSFER ST`;
  const addrRes = await pool.query(
    `INSERT INTO addresses (id, street, city, subdivision, builder)
     VALUES (gen_random_uuid()::text, $1, 'Houston', 'TEST SUB', 'DR HORTON') RETURNING id`,
    [street]
  );
  const addressId = addrRes.rows[0].id;

  const now = new Date().toISOString();
  const visitRes = await pool.query(
    `INSERT INTO visits
       (id, address_id, technician_id, status, has_multiple_systems, is_deferred,
        scheduled_time, date, created_at, updated_at)
     VALUES (gen_random_uuid()::text, $1, $2, 'assigned', false, false,
             '2026-07-01T09:00:00Z', '2026-07-01', $3, $3)
     RETURNING id`,
    [addressId, tech1.id, now]
  );
  const visitId = visitRes.rows[0].id;

  await pool.query(
    `INSERT INTO visit_systems (id, visit_id, system_number)
     VALUES (gen_random_uuid()::text, $1, 1)`,
    [visitId]
  );

  return { tech1, token1, tech2, token2, visitId, addressId, street };
}
```

Also add `seedTransferScenario` to the `module.exports` line.

- [ ] **Step 5: Create stub `src/routes/completion.js`**

```javascript
const express = require('express');
const router = express.Router();
module.exports = router;
```

- [ ] **Step 6: Create stub `src/routes/transfers.js`**

```javascript
const express = require('express');
const router = express.Router();
module.exports = router;
```

- [ ] **Step 7: Mount both routers in `src/index.js`**

Add before the global error handler:

```javascript
app.use('/api/visits', require('./routes/completion'));
app.use('/api', require('./routes/transfers'));
```

The final `src/index.js`:

```javascript
require('dotenv').config();
const express = require('express');
const { pool } = require('./db/pool');
const { authenticate } = require('./middleware/auth');

const app = express();
app.use(express.json());

app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', db: 'connected' });
  } catch (err) {
    res.status(503).json({ status: 'error', db: 'unreachable', message: err.message });
  }
});

// Auth routes mount BEFORE global authenticate (redeem-invite is unauthenticated)
app.use('/api/auth', require('./routes/auth'));

// All routes below require a valid bearer token
app.use(authenticate);

app.use('/api/dispatch/technicians', require('./routes/technicians'));
app.use('/api/dispatch', require('./routes/dispatch'));
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/sync', require('./routes/sync'));
app.use('/api/addresses', require('./routes/addresses'));

const { visitsRouter, dispatchVisitsRouter } = require('./routes/visits');
app.use('/api/visits', visitsRouter);
app.use('/api/dispatch/visits', dispatchVisitsRouter);
app.use('/api/visits', require('./routes/workspace'));
app.use('/api/visits', require('./routes/completion'));
app.use('/api', require('./routes/transfers'));

// Global error handler
app.use((err, req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT || 3001;
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`FieldOps server listening on port ${PORT}`);
  });
}

module.exports = app;
```

- [ ] **Step 8: Verify all existing tests still pass**

```bash
npm test
```
Expected: All 116 tests pass (or whatever count before this phase).

- [ ] **Step 9: Commit**

```bash
git add src/db/migrations/004_completion_fields.sql tests/helpers/db.js tests/helpers/seeds.js src/routes/completion.js src/routes/transfers.js src/index.js
git commit -m "chore: infrastructure for phase 5 — migration, stubs, seed helper"
```

---

## Task 2: Report Service

**Files:**
- Create: `src/services/report.js`
- Create: `tests/report.test.js`

**Interfaces:**
- Produces: `generateReportText(db, visitId)` → `Promise<string>` — comma-separated fields
- Produces: `generateReportJSON(db, visitId)` → `Promise<object>` — full visit payload

---

- [ ] **Step 1: Write failing tests for `generateReportText`**

Create `tests/report.test.js`:

```javascript
const { pool, truncateTables } = require('./helpers/db');
const { seedAssignedVisit } = require('./helpers/seeds');
const { generateReportText, generateReportJSON } = require('../src/services/report');

beforeEach(truncateTables);
afterAll(() => pool.end());

async function setupVisitWithService(visitId, serviceName = 'AC', isFinish = false, isTemporarily = false) {
  await pool.query(`
    INSERT INTO catalog_services (service_name, default_price, is_bundle, multiplies_by_system_count)
    VALUES ('AC', 150, false, false), ('Heat', 100, false, false)
    ON CONFLICT (service_name) DO NOTHING
  `);
  await pool.query(
    `INSERT INTO visit_services (id, visit_id, service_name, is_finish, is_temporarily, price)
     VALUES (gen_random_uuid()::text, $1, $2, $3, $4, 150)`,
    [visitId, serviceName, isFinish, isTemporarily]
  );
  await pool.query(
    `UPDATE visits SET total_price = 150, completed_at = '2026-07-01T10:00:00.000Z' WHERE id = $1`,
    [visitId]
  );
}

describe('generateReportText', () => {
  it('returns comma-separated string with all required fields', async () => {
    const { visitId } = await seedAssignedVisit();
    await setupVisitWithService(visitId);

    const text = await generateReportText(pool, visitId);
    const parts = text.split(',');

    expect(parts).toHaveLength(10);
    expect(parts[3]).toBe('DR HORTON');   // builder
    expect(parts[4]).toBe('AC');           // serviceName
    expect(parts[5]).toBe('false');        // isFinish
    expect(parts[6]).toBe('false');        // isTemporarily
    expect(parts[7]).toBe('1');            // systemCount
    expect(parts[8]).toBe('150');          // totalPrice
    expect(parts[9]).toBe('2026-07-01T10:00:00.000Z'); // completedAt
  });

  it('includes street and subdivision from address', async () => {
    const { visitId, street } = await seedAssignedVisit();
    await setupVisitWithService(visitId);

    const text = await generateReportText(pool, visitId);
    const parts = text.split(',');

    expect(parts[1]).toBe(street);        // street
    expect(parts[2]).toBe('TEST SUB');    // subdivision
  });

  it('reflects isFinish and isTemporarily flags', async () => {
    const { visitId } = await seedAssignedVisit();
    await setupVisitWithService(visitId, 'Heat', true, false);

    const text = await generateReportText(pool, visitId);
    const parts = text.split(',');

    expect(parts[4]).toBe('Heat');
    expect(parts[5]).toBe('true');
    expect(parts[6]).toBe('false');
  });
});

describe('generateReportJSON', () => {
  it('returns visit with nested address, systems, services, items, photos, weighInData', async () => {
    const { visitId, addressId } = await seedAssignedVisit();
    await setupVisitWithService(visitId);

    await pool.query(`
      INSERT INTO catalog_items (item_name, category, default_price, tech_supplied)
      VALUES ('TEST-ITEM', 'accessory', 25, false)
      ON CONFLICT (item_name) DO NOTHING
    `);
    await pool.query(
      `INSERT INTO visit_items (id, visit_id, item_name, category, quantity, price, tech_supplied)
       VALUES (gen_random_uuid()::text, $1, 'TEST-ITEM', 'accessory', 1, 25, false)`,
      [visitId]
    );
    await pool.query(
      `INSERT INTO visit_photos (id, visit_id, system_number, slug, tag, label, category, stored_at)
       VALUES (gen_random_uuid()::text, $1, 1, 'TEST_SLUG', 'scale', null, 'weigh_in_scale', null)`,
      [visitId]
    );

    const report = await generateReportJSON(pool, visitId);

    expect(report.id).toBe(visitId);
    expect(report.status).toBeDefined();
    expect(report.completedAt).toBe('2026-07-01T10:00:00.000Z');
    expect(report.address).toMatchObject({ builder: 'DR HORTON', subdivision: 'TEST SUB' });
    expect(report.systems).toHaveLength(1);
    expect(report.systems[0].systemNumber).toBe(1);
    expect(report.services).toHaveLength(1);
    expect(report.services[0].serviceName).toBe('AC');
    expect(report.items).toHaveLength(1);
    expect(report.items[0].itemName).toBe('TEST-ITEM');
    expect(report.photos).toHaveLength(1);
    expect(report.photos[0]).toEqual({ slug: 'TEST_SLUG' });
    expect(Array.isArray(report.weighInData)).toBe(true);
  });

  it('includes weighInData keyed by address_id', async () => {
    const { visitId, addressId } = await seedAssignedVisit();
    await setupVisitWithService(visitId);

    await pool.query(`
      INSERT INTO catalog_lineset_configs (config_key, reference_length_ft, adjust_rate_oz_per_ft)
      VALUES ('STANDARD', 15, 0.6)
      ON CONFLICT (config_key) DO NOTHING
    `);
    await pool.query(
      `INSERT INTO weigh_in_data
         (id, address_id, system_number, lineset_length, subcooling_value, oem_subcooling_goal, subcooling_deviation)
       VALUES (gen_random_uuid()::text, $1, 1, 25, 12, 10, 2)`,
      [addressId]
    );

    const report = await generateReportJSON(pool, visitId);

    expect(report.weighInData).toHaveLength(1);
    expect(report.weighInData[0].systemNumber).toBe(1);
    expect(report.weighInData[0].subcoolingValue).toBe(12);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- --testPathPattern="report" 2>&1 | tail -15
```
Expected: FAIL — "Cannot find module '../src/services/report'"

- [ ] **Step 3: Implement `src/services/report.js`**

```javascript
async function generateReportText(db, visitId) {
  const [visitRow, serviceRows, systemRows] = await Promise.all([
    db.query(
      `SELECT v.order_number, v.total_price, v.completed_at,
              a.street, a.subdivision, a.builder
       FROM visits v
       JOIN addresses a ON a.id = v.address_id
       WHERE v.id = $1`,
      [visitId]
    ),
    db.query(
      'SELECT service_name, is_finish, is_temporarily FROM visit_services WHERE visit_id = $1',
      [visitId]
    ),
    db.query(
      'SELECT COUNT(*) AS count FROM visit_systems WHERE visit_id = $1',
      [visitId]
    ),
  ]);

  const v = visitRow.rows[0];
  const svc = serviceRows.rows[0] || {};
  const systemCount = parseInt(systemRows.rows[0].count, 10);

  return [
    v.order_number,
    v.street,
    v.subdivision,
    v.builder,
    svc.service_name,
    svc.is_finish,
    svc.is_temporarily,
    systemCount,
    v.total_price,
    v.completed_at,
  ].join(',');
}

async function generateReportJSON(db, visitId) {
  const visitRow = await db.query(
    `SELECT v.id, v.order_number, v.scheduled_time, v.status, v.technician_id,
            v.has_multiple_systems, v.is_deferred, v.total_price, v.completed_at,
            v.address_id,
            a.street, a.city, a.state, a.zip, a.subdivision, a.builder
     FROM visits v
     JOIN addresses a ON a.id = v.address_id
     WHERE v.id = $1`,
    [visitId]
  );
  const v = visitRow.rows[0];

  const [systems, services, items, photos, weighIn] = await Promise.all([
    db.query(
      'SELECT system_number, indoor_model, outdoor_model, refrigerant FROM visit_systems WHERE visit_id = $1 ORDER BY system_number',
      [visitId]
    ),
    db.query(
      'SELECT service_name, is_finish, is_temporarily, price FROM visit_services WHERE visit_id = $1',
      [visitId]
    ),
    db.query(
      'SELECT item_name, category, quantity, price, tech_supplied FROM visit_items WHERE visit_id = $1',
      [visitId]
    ),
    db.query(
      'SELECT slug FROM visit_photos WHERE visit_id = $1',
      [visitId]
    ),
    db.query(
      `SELECT system_number, lineset_length, factory_charge_oz, factory_line_config,
              approx_adjust_oz, adjusted_oz, fan_speed_cfm, liquid_line_temp,
              suction_line_temp, condenser_sat_temp, subcooling_value,
              oem_subcooling_goal, subcooling_deviation
       FROM weigh_in_data WHERE address_id = $1`,
      [v.address_id]
    ),
  ]);

  return {
    id: v.id,
    orderNumber: v.order_number,
    scheduledTime: v.scheduled_time,
    status: v.status,
    completedAt: v.completed_at,
    technicianId: v.technician_id,
    totalPrice: v.total_price,
    hasMultipleSystems: v.has_multiple_systems,
    address: {
      street: v.street,
      city: v.city,
      state: v.state,
      zip: v.zip,
      subdivision: v.subdivision,
      builder: v.builder,
    },
    systems: systems.rows.map((s) => ({
      systemNumber: s.system_number,
      indoorModel: s.indoor_model,
      outdoorModel: s.outdoor_model,
      refrigerant: s.refrigerant,
    })),
    services: services.rows.map((s) => ({
      serviceName: s.service_name,
      isFinish: s.is_finish,
      isTemporarily: s.is_temporarily,
      price: s.price,
    })),
    items: items.rows.map((i) => ({
      itemName: i.item_name,
      category: i.category,
      quantity: i.quantity,
      price: i.price,
      techSupplied: i.tech_supplied,
    })),
    photos: photos.rows.map((p) => ({ slug: p.slug })),
    weighInData: weighIn.rows.map((w) => ({
      systemNumber: w.system_number,
      linesetLength: w.lineset_length,
      factoryChargeOz: w.factory_charge_oz,
      factoryLineConfig: w.factory_line_config,
      approxAdjustOz: w.approx_adjust_oz,
      adjustedOz: w.adjusted_oz,
      fanSpeedCfm: w.fan_speed_cfm,
      liquidLineTemp: w.liquid_line_temp,
      suctionLineTemp: w.suction_line_temp,
      condenserSatTemp: w.condenser_sat_temp,
      subcoolingValue: w.subcooling_value,
      oemSubcoolingGoal: w.oem_subcooling_goal,
      subcoolingDeviation: w.subcooling_deviation,
    })),
  };
}

module.exports = { generateReportText, generateReportJSON };
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- --testPathPattern="report" 2>&1 | tail -10
```
Expected: PASS — all report tests green

- [ ] **Step 5: Commit**

```bash
git add src/services/report.js tests/report.test.js
git commit -m "feat: add report service with generateReportText and generateReportJSON"
```

---

## Task 3: Completion Routes

**Files:**
- Modify: `src/routes/completion.js` (replace stub)
- Create: `tests/completion.test.js`

**Interfaces:**
- Consumes: `generateReportText(db, visitId)` and `generateReportJSON(db, visitId)` from `../services/report`
- Consumes: `createNotification(db, { recipientId, type, message })` from `../helpers/notify`
- Consumes: `requireRole` from `../middleware/auth`
- Produces: `POST /api/visits/:id/complete`, `GET /api/visits/:id/report-preview`, `GET /api/visits/:id/download`

---

- [ ] **Step 1: Write failing tests**

Create `tests/completion.test.js`:

```javascript
const request = require('supertest');
const app = require('../src/index');
const { pool, truncateTables } = require('./helpers/db');
const { seedAssignedVisit, seedDispatcherWithToken, seedTechnicianWithToken } = require('./helpers/seeds');

beforeEach(truncateTables);
afterAll(() => pool.end());

async function addService(visitId, serviceName = 'AC', isTemporarily = false) {
  await pool.query(`
    INSERT INTO catalog_services (service_name, default_price, is_bundle, multiplies_by_system_count)
    VALUES ('AC', 150, false, false),
           ('Heat', 100, false, false),
           ('Cancel', 0, false, false)
    ON CONFLICT (service_name) DO NOTHING
  `);
  await pool.query(
    `INSERT INTO visit_services (id, visit_id, service_name, is_finish, is_temporarily, price)
     VALUES (gen_random_uuid()::text, $1, $2, false, $3, 150)`,
    [visitId, serviceName, isTemporarily]
  );
  await pool.query(
    `UPDATE visits SET total_price = 150 WHERE id = $1`,
    [visitId]
  );
}

// ── POST /api/visits/:id/complete ────────────────────────────────────────────

describe('POST /api/visits/:id/complete', () => {
  it('completes a visit with AC service — returns report JSON and sets status=completed', async () => {
    const { visitId, token, street } = await seedAssignedVisit();
    await addService(visitId, 'AC');

    const res = await request(app)
      .post(`/api/visits/${visitId}/complete`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(visitId);
    expect(res.body.status).toBe('completed');
    expect(res.body.completedAt).toBeTruthy();
    expect(res.body.address).toBeDefined();
    expect(res.body.systems).toBeDefined();
    expect(res.body.services[0].serviceName).toBe('AC');

    const row = await pool.query('SELECT status, completed_at FROM visits WHERE id = $1', [visitId]);
    expect(row.rows[0].status).toBe('completed');
    expect(row.rows[0].completed_at).toBeTruthy();
  });

  it('sets status=temporarily when is_temporarily=true on the service', async () => {
    const { visitId, token } = await seedAssignedVisit();
    await addService(visitId, 'AC', true);

    const res = await request(app)
      .post(`/api/visits/${visitId}/complete`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('temporarily');
  });

  it('sets status=cancelled when service is Cancel', async () => {
    const { visitId, token } = await seedAssignedVisit();
    await addService(visitId, 'Cancel');

    const res = await request(app)
      .post(`/api/visits/${visitId}/complete`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('cancelled');
  });

  it('is idempotent — second call on terminal visit returns report without error', async () => {
    const { visitId, token } = await seedAssignedVisit();
    await addService(visitId, 'AC');

    await request(app)
      .post(`/api/visits/${visitId}/complete`)
      .set('Authorization', `Bearer ${token}`);

    const res = await request(app)
      .post(`/api/visits/${visitId}/complete`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('completed');
  });

  it('idempotency check fires before ownership check — different token still gets 200 on terminal visit', async () => {
    const { visitId, token } = await seedAssignedVisit();
    await addService(visitId, 'AC');

    // Complete it with the real token
    await request(app)
      .post(`/api/visits/${visitId}/complete`)
      .set('Authorization', `Bearer ${token}`);

    // A second technician retrying (offline queue scenario) — should get the same result back
    const { token: otherToken } = await seedTechnicianWithToken({ name: 'Other-Tech' });
    const res = await request(app)
      .post(`/api/visits/${visitId}/complete`)
      .set('Authorization', `Bearer ${otherToken}`);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('completed');
  });

  it('returns 400 if no service is selected', async () => {
    const { visitId, token } = await seedAssignedVisit();

    const res = await request(app)
      .post(`/api/visits/${visitId}/complete`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('No service selected');
  });

  it('returns 403 if technician is not the assignee', async () => {
    const { visitId } = await seedAssignedVisit();
    const { token: otherToken } = await seedTechnicianWithToken({ name: 'Not-Assignee' });
    await addService(visitId, 'AC');

    const res = await request(app)
      .post(`/api/visits/${visitId}/complete`)
      .set('Authorization', `Bearer ${otherToken}`);

    expect(res.status).toBe(403);
  });

  it('returns 404 for unknown visit', async () => {
    const { token } = await seedAssignedVisit();

    const res = await request(app)
      .post(`/api/visits/nonexistent-id/complete`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);
  });

  it('notifies all dispatchers/owners on completion', async () => {
    const { visitId, token } = await seedAssignedVisit();
    await addService(visitId, 'AC');
    const { dispatcher } = await seedDispatcherWithToken();

    await request(app)
      .post(`/api/visits/${visitId}/complete`)
      .set('Authorization', `Bearer ${token}`);

    const notifs = await pool.query(
      `SELECT * FROM notifications WHERE recipient_id = $1 AND type = 'completion_received'`,
      [dispatcher.id]
    );
    expect(notifs.rows).toHaveLength(1);
    expect(notifs.rows[0].body).toContain('completed');
  });

  it('expires pending transfers and notifies recipient on completion', async () => {
    const { visitId, token, tech } = await seedAssignedVisit();
    await addService(visitId, 'AC');
    const { tech: toTech } = await seedTechnicianWithToken({ name: 'Transfer-Target' });

    await pool.query(
      `INSERT INTO transfers (id, visit_id, from_tech_id, to_tech_id, status, created_at)
       VALUES (gen_random_uuid()::text, $1, $2, $3, 'pending', $4)`,
      [visitId, tech.id, toTech.id, new Date().toISOString()]
    );

    await request(app)
      .post(`/api/visits/${visitId}/complete`)
      .set('Authorization', `Bearer ${token}`);

    const xfer = await pool.query(
      `SELECT status FROM transfers WHERE visit_id = $1`,
      [visitId]
    );
    expect(xfer.rows[0].status).toBe('expired');

    const notif = await pool.query(
      `SELECT * FROM notifications WHERE recipient_id = $1 AND type = 'transfer_expired'`,
      [toTech.id]
    );
    expect(notif.rows).toHaveLength(1);
    expect(notif.rows[0].body).toContain('expired');
  });
});

// ── GET /api/visits/:id/report-preview ───────────────────────────────────────

describe('GET /api/visits/:id/report-preview', () => {
  it('returns { reportText: "..." } for the assignee', async () => {
    const { visitId, token } = await seedAssignedVisit();
    await addService(visitId, 'AC');

    const res = await request(app)
      .get(`/api/visits/${visitId}/report-preview`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(typeof res.body.reportText).toBe('string');
    expect(res.body.reportText.split(',')).toHaveLength(10);
  });

  it('allows dispatcher to access report-preview', async () => {
    const { visitId } = await seedAssignedVisit();
    await addService(visitId, 'AC');
    const { token: dispToken } = await seedDispatcherWithToken();

    const res = await request(app)
      .get(`/api/visits/${visitId}/report-preview`)
      .set('Authorization', `Bearer ${dispToken}`);

    expect(res.status).toBe(200);
    expect(res.body.reportText).toBeDefined();
  });

  it('returns 403 if technician is not the assignee', async () => {
    const { visitId } = await seedAssignedVisit();
    const { token: otherToken } = await seedTechnicianWithToken({ name: 'NotAssignee' });

    const res = await request(app)
      .get(`/api/visits/${visitId}/report-preview`)
      .set('Authorization', `Bearer ${otherToken}`);

    expect(res.status).toBe(403);
  });

  it('returns 404 for unknown visit', async () => {
    const { token } = await seedAssignedVisit();

    const res = await request(app)
      .get(`/api/visits/bad-id/report-preview`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);
  });
});

// ── GET /api/visits/:id/download ─────────────────────────────────────────────

describe('GET /api/visits/:id/download', () => {
  it('returns full JSON with nested visit data for assignee', async () => {
    const { visitId, token } = await seedAssignedVisit();
    await addService(visitId, 'AC');

    const res = await request(app)
      .get(`/api/visits/${visitId}/download`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(visitId);
    expect(res.body.address).toBeDefined();
    expect(res.body.systems).toBeDefined();
    expect(res.body.services).toBeDefined();
    expect(res.body.items).toBeDefined();
    expect(res.body.photos).toBeDefined();
    expect(res.body.weighInData).toBeDefined();
  });

  it('allows dispatcher to download', async () => {
    const { visitId } = await seedAssignedVisit();
    await addService(visitId, 'AC');
    const { token: dispToken } = await seedDispatcherWithToken();

    const res = await request(app)
      .get(`/api/visits/${visitId}/download`)
      .set('Authorization', `Bearer ${dispToken}`);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(visitId);
  });

  it('returns 403 if technician is not the assignee', async () => {
    const { visitId } = await seedAssignedVisit();
    const { token: otherToken } = await seedTechnicianWithToken({ name: 'NotAssignee2' });

    const res = await request(app)
      .get(`/api/visits/${visitId}/download`)
      .set('Authorization', `Bearer ${otherToken}`);

    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- --testPathPattern="completion" 2>&1 | tail -10
```
Expected: FAIL — 404 on all endpoints (stub router has no routes)

- [ ] **Step 3: Implement `src/routes/completion.js`**

```javascript
const express = require('express');
const { pool } = require('../db/pool');
const { requireRole } = require('../middleware/auth');
const { createNotification } = require('../helpers/notify');
const { generateReportText, generateReportJSON } = require('../services/report');

const router = express.Router();

const TERMINAL_STATUSES = ['completed', 'temporarily', 'cancelled'];

// POST /api/visits/:id/complete
router.post('/:id/complete', requireRole('technician'), async (req, res, next) => {
  const { id } = req.params;
  try {
    const visitResult = await pool.query(
      `SELECT v.id, v.status, v.technician_id, a.street
       FROM visits v
       JOIN addresses a ON a.id = v.address_id
       WHERE v.id = $1`,
      [id]
    );
    if (visitResult.rows.length === 0) return res.status(404).json({ error: 'Visit not found' });
    const visit = visitResult.rows[0];

    if (TERMINAL_STATUSES.includes(visit.status)) {
      return res.json(await generateReportJSON(pool, id));
    }

    if (visit.technician_id !== req.technician.id) {
      return res.status(403).json({ error: 'This visit is not assigned to you' });
    }

    if (!['assigned', 'in_progress'].includes(visit.status)) {
      return res.status(400).json({ error: `Visit cannot be completed — current status: ${visit.status}` });
    }

    const serviceResult = await pool.query(
      'SELECT service_name, is_temporarily FROM visit_services WHERE visit_id = $1',
      [id]
    );
    if (serviceResult.rows.length === 0) {
      return res.status(400).json({ error: 'No service selected' });
    }
    const svc = serviceResult.rows[0];

    let finalStatus;
    if (svc.service_name === 'Cancel') {
      finalStatus = 'cancelled';
    } else if (svc.is_temporarily) {
      finalStatus = 'temporarily';
    } else {
      finalStatus = 'completed';
    }

    const now = new Date().toISOString();
    await pool.query(
      `UPDATE visits SET status = $1, completed_at = $2, updated_at = $2 WHERE id = $3`,
      [finalStatus, now, id]
    );

    const expiredResult = await pool.query(
      `UPDATE transfers SET status = 'expired', resolved_at = $1
       WHERE visit_id = $2 AND status = 'pending'
       RETURNING to_tech_id`,
      [now, id]
    );
    for (const row of expiredResult.rows) {
      await createNotification(pool, {
        recipientId: row.to_tech_id,
        type: 'transfer_expired',
        message: `A transfer request for ${visit.street} has expired — the visit was completed by the original technician`,
      });
    }

    const dispatchersResult = await pool.query(
      `SELECT id FROM technicians WHERE role IN ('dispatcher', 'owner') AND is_active = true`
    );
    for (const d of dispatchersResult.rows) {
      await createNotification(pool, {
        recipientId: d.id,
        type: 'completion_received',
        message: `${req.technician.name} completed ${visit.street}`,
      });
    }

    console.log('Drive upload pending for visit', id);

    res.json(await generateReportJSON(pool, id));
  } catch (err) {
    next(err);
  }
});

// GET /api/visits/:id/report-preview
router.get('/:id/report-preview', async (req, res, next) => {
  const { id } = req.params;
  try {
    const visitResult = await pool.query(
      'SELECT id, technician_id FROM visits WHERE id = $1',
      [id]
    );
    if (visitResult.rows.length === 0) return res.status(404).json({ error: 'Visit not found' });
    const visit = visitResult.rows[0];

    if (req.technician.role === 'technician' && visit.technician_id !== req.technician.id) {
      return res.status(403).json({ error: 'This visit is not assigned to you' });
    }

    const reportText = await generateReportText(pool, id);
    res.json({ reportText });
  } catch (err) {
    next(err);
  }
});

// GET /api/visits/:id/download
router.get('/:id/download', async (req, res, next) => {
  const { id } = req.params;
  try {
    const visitResult = await pool.query(
      'SELECT id, technician_id FROM visits WHERE id = $1',
      [id]
    );
    if (visitResult.rows.length === 0) return res.status(404).json({ error: 'Visit not found' });
    const visit = visitResult.rows[0];

    if (req.technician.role === 'technician' && visit.technician_id !== req.technician.id) {
      return res.status(403).json({ error: 'This visit is not assigned to you' });
    }

    res.json(await generateReportJSON(pool, id));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- --testPathPattern="completion" 2>&1 | tail -10
```
Expected: PASS — all completion tests green

- [ ] **Step 5: Commit**

```bash
git add src/routes/completion.js tests/completion.test.js
git commit -m "feat: add completion routes — POST complete, GET report-preview, GET download"
```

---

## Task 4: Transfer Routes

**Files:**
- Modify: `src/routes/transfers.js` (replace stub)
- Create: `tests/transfers.test.js`

**Interfaces:**
- Consumes: `createNotification(db, { recipientId, type, message })` from `../helpers/notify`
- Consumes: `requireRole` from `../middleware/auth`
- Consumes: `seedTransferScenario()` from `tests/helpers/seeds`
- Produces: `POST /api/visits/:id/transfer/initiate`, `POST /api/transfers/:id/accept`, `POST /api/transfers/:id/reject`, `GET /api/transfers/pending/mine`

---

- [ ] **Step 1: Write failing tests**

Create `tests/transfers.test.js`:

```javascript
const request = require('supertest');
const app = require('../src/index');
const { pool, truncateTables } = require('./helpers/db');
const {
  seedTransferScenario,
  seedDispatcherWithToken,
  seedTechnicianWithToken,
} = require('./helpers/seeds');

beforeEach(truncateTables);
afterAll(() => pool.end());

// ── POST /api/visits/:id/transfer/initiate ───────────────────────────────────

describe('POST /api/visits/:id/transfer/initiate', () => {
  it('creates a transfer and returns { transferId, status: pending }', async () => {
    const { tech1, token1, tech2, visitId } = await seedTransferScenario();

    const res = await request(app)
      .post(`/api/visits/${visitId}/transfer/initiate`)
      .set('Authorization', `Bearer ${token1}`)
      .send({ toTechnicianId: tech2.id });

    expect(res.status).toBe(200);
    expect(res.body.transferId).toBeDefined();
    expect(res.body.status).toBe('pending');

    const row = await pool.query(
      `SELECT * FROM transfers WHERE visit_id = $1`,
      [visitId]
    );
    expect(row.rows).toHaveLength(1);
    expect(row.rows[0].status).toBe('pending');
    expect(row.rows[0].from_tech_id).toBe(tech1.id);
    expect(row.rows[0].to_tech_id).toBe(tech2.id);
  });

  it('notifies the target technician', async () => {
    const { token1, tech2, visitId, street } = await seedTransferScenario();

    await request(app)
      .post(`/api/visits/${visitId}/transfer/initiate`)
      .set('Authorization', `Bearer ${token1}`)
      .send({ toTechnicianId: tech2.id });

    const notif = await pool.query(
      `SELECT * FROM notifications WHERE recipient_id = $1 AND type = 'transfer_request'`,
      [tech2.id]
    );
    expect(notif.rows).toHaveLength(1);
    expect(notif.rows[0].body).toContain(street);
  });

  it('stores optional reason field', async () => {
    const { token1, tech2, visitId } = await seedTransferScenario();

    await request(app)
      .post(`/api/visits/${visitId}/transfer/initiate`)
      .set('Authorization', `Bearer ${token1}`)
      .send({ toTechnicianId: tech2.id, reason: 'I am sick' });

    const row = await pool.query(`SELECT reason FROM transfers WHERE visit_id = $1`, [visitId]);
    expect(row.rows[0].reason).toBe('I am sick');
  });

  it('returns 400 if a pending transfer already exists', async () => {
    const { tech1, token1, tech2, visitId } = await seedTransferScenario();

    await request(app)
      .post(`/api/visits/${visitId}/transfer/initiate`)
      .set('Authorization', `Bearer ${token1}`)
      .send({ toTechnicianId: tech2.id });

    const res = await request(app)
      .post(`/api/visits/${visitId}/transfer/initiate`)
      .set('Authorization', `Bearer ${token1}`)
      .send({ toTechnicianId: tech2.id });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('already pending');
  });

  it('returns 400 if toTechnicianId is self', async () => {
    const { tech1, token1, visitId } = await seedTransferScenario();

    const res = await request(app)
      .post(`/api/visits/${visitId}/transfer/initiate`)
      .set('Authorization', `Bearer ${token1}`)
      .send({ toTechnicianId: tech1.id });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('yourself');
  });

  it('returns 400 if target technician does not exist', async () => {
    const { token1, visitId } = await seedTransferScenario();

    const res = await request(app)
      .post(`/api/visits/${visitId}/transfer/initiate`)
      .set('Authorization', `Bearer ${token1}`)
      .send({ toTechnicianId: 'nonexistent-tech-id' });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('not found');
  });

  it('returns 403 if caller is not the assignee', async () => {
    const { tech2, token2, visitId } = await seedTransferScenario();

    const res = await request(app)
      .post(`/api/visits/${visitId}/transfer/initiate`)
      .set('Authorization', `Bearer ${token2}`)
      .send({ toTechnicianId: tech2.id });

    expect(res.status).toBe(403);
  });

  it('returns 404 for unknown visit', async () => {
    const { token1, tech2 } = await seedTransferScenario();

    const res = await request(app)
      .post(`/api/visits/bad-visit-id/transfer/initiate`)
      .set('Authorization', `Bearer ${token1}`)
      .send({ toTechnicianId: tech2.id });

    expect(res.status).toBe(404);
  });
});

// ── POST /api/transfers/:id/accept ───────────────────────────────────────────

describe('POST /api/transfers/:id/accept', () => {
  async function createPendingTransfer({ tech1, tech2, visitId }) {
    const transferId = require('crypto').randomUUID();
    await pool.query(
      `INSERT INTO transfers (id, visit_id, from_tech_id, to_tech_id, status, created_at)
       VALUES ($1, $2, $3, $4, 'pending', $5)`,
      [transferId, visitId, tech1.id, tech2.id, new Date().toISOString()]
    );
    return transferId;
  }

  it('reassigns the visit to recipient — does not change visit status', async () => {
    const { tech1, tech2, token2, visitId } = await seedTransferScenario();
    const transferId = await createPendingTransfer({ tech1, tech2, visitId });

    const res = await request(app)
      .post(`/api/transfers/${transferId}/accept`)
      .set('Authorization', `Bearer ${token2}`);

    expect(res.status).toBe(200);
    expect(res.body.technicianId).toBe(tech2.id);
    expect(res.body.status).toBe('assigned');

    const visit = await pool.query(`SELECT technician_id, status FROM visits WHERE id = $1`, [visitId]);
    expect(visit.rows[0].technician_id).toBe(tech2.id);
    expect(visit.rows[0].status).toBe('assigned');

    const xfer = await pool.query(`SELECT status FROM transfers WHERE id = $1`, [transferId]);
    expect(xfer.rows[0].status).toBe('accepted');
  });

  it('notifies dispatchers/owners on accept', async () => {
    const { tech1, tech2, token2, visitId } = await seedTransferScenario();
    const transferId = await createPendingTransfer({ tech1, tech2, visitId });
    const { dispatcher } = await seedDispatcherWithToken();

    await request(app)
      .post(`/api/transfers/${transferId}/accept`)
      .set('Authorization', `Bearer ${token2}`);

    const notif = await pool.query(
      `SELECT * FROM notifications WHERE recipient_id = $1 AND type = 'transfer_accepted'`,
      [dispatcher.id]
    );
    expect(notif.rows).toHaveLength(1);
    expect(notif.rows[0].body).toContain('accepted');
  });

  it('returns full visit object matching GET /api/visits/:id shape', async () => {
    const { tech1, tech2, token2, visitId } = await seedTransferScenario();
    const transferId = await createPendingTransfer({ tech1, tech2, visitId });

    const res = await request(app)
      .post(`/api/transfers/${transferId}/accept`)
      .set('Authorization', `Bearer ${token2}`);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(visitId);
    expect(res.body.address).toBeDefined();
    expect(res.body.systems).toBeDefined();
    expect(res.body.services).toBeDefined();
    expect(res.body.items).toBeDefined();
    expect(res.body.photos).toBeDefined();
  });

  it('returns 403 if caller is not to_tech_id', async () => {
    const { tech1, tech2, token1, visitId } = await seedTransferScenario();
    const transferId = await createPendingTransfer({ tech1, tech2, visitId });

    const res = await request(app)
      .post(`/api/transfers/${transferId}/accept`)
      .set('Authorization', `Bearer ${token1}`);

    expect(res.status).toBe(403);
  });

  it('returns 400 if transfer is not pending', async () => {
    const { tech1, tech2, token2, visitId } = await seedTransferScenario();
    const transferId = await createPendingTransfer({ tech1, tech2, visitId });

    await pool.query(
      `UPDATE transfers SET status = 'rejected', resolved_at = $1 WHERE id = $2`,
      [new Date().toISOString(), transferId]
    );

    const res = await request(app)
      .post(`/api/transfers/${transferId}/accept`)
      .set('Authorization', `Bearer ${token2}`);

    expect(res.status).toBe(400);
  });

  it('returns 404 for unknown transfer', async () => {
    const { token2 } = await seedTransferScenario();

    const res = await request(app)
      .post(`/api/transfers/nonexistent-transfer/accept`)
      .set('Authorization', `Bearer ${token2}`);

    expect(res.status).toBe(404);
  });
});

// ── POST /api/transfers/:id/reject ───────────────────────────────────────────

describe('POST /api/transfers/:id/reject', () => {
  async function createPendingTransfer({ tech1, tech2, visitId }) {
    const transferId = require('crypto').randomUUID();
    await pool.query(
      `INSERT INTO transfers (id, visit_id, from_tech_id, to_tech_id, status, created_at)
       VALUES ($1, $2, $3, $4, 'pending', $5)`,
      [transferId, visitId, tech1.id, tech2.id, new Date().toISOString()]
    );
    return transferId;
  }

  it('sets transfer status to rejected and notifies the from_tech', async () => {
    const { tech1, tech2, token2, visitId, street } = await seedTransferScenario();
    const transferId = await createPendingTransfer({ tech1, tech2, visitId });

    const res = await request(app)
      .post(`/api/transfers/${transferId}/reject`)
      .set('Authorization', `Bearer ${token2}`);

    expect(res.status).toBe(200);
    expect(res.body.transferId).toBe(transferId);
    expect(res.body.status).toBe('rejected');

    const xfer = await pool.query(`SELECT status FROM transfers WHERE id = $1`, [transferId]);
    expect(xfer.rows[0].status).toBe('rejected');

    const notif = await pool.query(
      `SELECT * FROM notifications WHERE recipient_id = $1 AND type = 'transfer_rejected'`,
      [tech1.id]
    );
    expect(notif.rows).toHaveLength(1);
    expect(notif.rows[0].body).toContain('declined');
  });

  it('returns 403 if caller is not to_tech_id', async () => {
    const { tech1, tech2, token1, visitId } = await seedTransferScenario();
    const transferId = await createPendingTransfer({ tech1, tech2, visitId });

    const res = await request(app)
      .post(`/api/transfers/${transferId}/reject`)
      .set('Authorization', `Bearer ${token1}`);

    expect(res.status).toBe(403);
  });

  it('returns 400 if transfer is not pending', async () => {
    const { tech1, tech2, token2, visitId } = await seedTransferScenario();
    const transferId = await createPendingTransfer({ tech1, tech2, visitId });

    await pool.query(
      `UPDATE transfers SET status = 'accepted', resolved_at = $1 WHERE id = $2`,
      [new Date().toISOString(), transferId]
    );

    const res = await request(app)
      .post(`/api/transfers/${transferId}/reject`)
      .set('Authorization', `Bearer ${token2}`);

    expect(res.status).toBe(400);
  });

  it('returns 404 for unknown transfer', async () => {
    const { token2 } = await seedTransferScenario();

    const res = await request(app)
      .post(`/api/transfers/nonexistent/reject`)
      .set('Authorization', `Bearer ${token2}`);

    expect(res.status).toBe(404);
  });
});

// ── GET /api/transfers/pending/mine ──────────────────────────────────────────

describe('GET /api/transfers/pending/mine', () => {
  it('returns pending transfers addressed to the caller', async () => {
    const { tech1, tech2, token2, visitId, street } = await seedTransferScenario();
    const transferId = require('crypto').randomUUID();
    const now = new Date().toISOString();
    await pool.query(
      `INSERT INTO transfers (id, visit_id, from_tech_id, to_tech_id, reason, status, created_at)
       VALUES ($1, $2, $3, $4, 'Emergency', 'pending', $5)`,
      [transferId, visitId, tech1.id, tech2.id, now]
    );

    const res = await request(app)
      .get('/api/transfers/pending/mine')
      .set('Authorization', `Bearer ${token2}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    const item = res.body[0];
    expect(item.transferId).toBe(transferId);
    expect(item.visitId).toBe(visitId);
    expect(item.fromTechnicianId).toBe(tech1.id);
    expect(item.fromTechnicianName).toBe(tech1.name);
    expect(item.address.street).toBe(street);
    expect(item.reason).toBe('Emergency');
    expect(item.createdAt).toBeDefined();
  });

  it('returns empty array when no pending transfers', async () => {
    const { token2 } = await seedTransferScenario();

    const res = await request(app)
      .get('/api/transfers/pending/mine')
      .set('Authorization', `Bearer ${token2}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('does not return non-pending transfers', async () => {
    const { tech1, tech2, token2, visitId } = await seedTransferScenario();
    await pool.query(
      `INSERT INTO transfers (id, visit_id, from_tech_id, to_tech_id, status, created_at, resolved_at)
       VALUES (gen_random_uuid()::text, $1, $2, $3, 'rejected', $4, $4)`,
      [visitId, tech1.id, tech2.id, new Date().toISOString()]
    );

    const res = await request(app)
      .get('/api/transfers/pending/mine')
      .set('Authorization', `Bearer ${token2}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- --testPathPattern="transfers" 2>&1 | tail -10
```
Expected: FAIL — 404 on all endpoints (stub router has no routes)

- [ ] **Step 3: Implement `src/routes/transfers.js`**

```javascript
const crypto = require('crypto');
const express = require('express');
const { pool } = require('../db/pool');
const { requireRole } = require('../middleware/auth');
const { createNotification } = require('../helpers/notify');

const router = express.Router();

// GET /api/transfers/pending/mine — declared before /:id routes to prevent param capture
router.get('/transfers/pending/mine', requireRole('technician'), async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT t.id, t.visit_id, t.from_tech_id, t.reason, t.created_at,
              ft.name AS from_tech_name,
              a.street
       FROM transfers t
       JOIN visits v ON v.id = t.visit_id
       JOIN addresses a ON a.id = v.address_id
       JOIN technicians ft ON ft.id = t.from_tech_id
       WHERE t.to_tech_id = $1 AND t.status = 'pending'
       ORDER BY t.created_at DESC`,
      [req.technician.id]
    );

    res.json(result.rows.map((r) => ({
      transferId: r.id,
      visitId: r.visit_id,
      fromTechnicianId: r.from_tech_id,
      fromTechnicianName: r.from_tech_name,
      address: { street: r.street },
      reason: r.reason,
      createdAt: r.created_at,
    })));
  } catch (err) {
    next(err);
  }
});

// POST /api/visits/:id/transfer/initiate
router.post('/visits/:id/transfer/initiate', requireRole('technician'), async (req, res, next) => {
  const { id } = req.params;
  const { toTechnicianId, reason } = req.body;
  try {
    const visitResult = await pool.query(
      `SELECT v.id, v.technician_id, a.street
       FROM visits v
       JOIN addresses a ON a.id = v.address_id
       WHERE v.id = $1`,
      [id]
    );
    if (visitResult.rows.length === 0) return res.status(404).json({ error: 'Visit not found' });
    const visit = visitResult.rows[0];

    if (visit.technician_id !== req.technician.id) {
      return res.status(403).json({ error: 'This visit is not assigned to you' });
    }

    const toTechResult = await pool.query(
      'SELECT id, name FROM technicians WHERE id = $1 AND is_active = true',
      [toTechnicianId]
    );
    if (toTechResult.rows.length === 0) {
      return res.status(400).json({ error: 'Technician not found or inactive' });
    }

    if (toTechnicianId === req.technician.id) {
      return res.status(400).json({ error: 'Cannot transfer to yourself' });
    }

    const pendingResult = await pool.query(
      `SELECT id FROM transfers WHERE visit_id = $1 AND status = 'pending'`,
      [id]
    );
    if (pendingResult.rows.length > 0) {
      return res.status(400).json({ error: 'A transfer request is already pending for this visit' });
    }

    const transferId = crypto.randomUUID();
    const now = new Date().toISOString();
    await pool.query(
      `INSERT INTO transfers (id, visit_id, from_tech_id, to_tech_id, reason, status, created_at)
       VALUES ($1, $2, $3, $4, $5, 'pending', $6)`,
      [transferId, id, req.technician.id, toTechnicianId, reason ?? null, now]
    );

    await createNotification(pool, {
      recipientId: toTechnicianId,
      type: 'transfer_request',
      message: `${req.technician.name} wants to transfer ${visit.street} to you`,
    });

    res.json({ transferId, status: 'pending' });
  } catch (err) {
    next(err);
  }
});

// POST /api/transfers/:id/accept
router.post('/transfers/:id/accept', requireRole('technician'), async (req, res, next) => {
  const { id } = req.params;
  try {
    const transferResult = await pool.query(
      `SELECT t.id, t.visit_id, t.to_tech_id, t.from_tech_id, t.status,
              ft.name AS from_tech_name, tt.name AS to_tech_name,
              a.street
       FROM transfers t
       JOIN visits v ON v.id = t.visit_id
       JOIN addresses a ON a.id = v.address_id
       JOIN technicians ft ON ft.id = t.from_tech_id
       JOIN technicians tt ON tt.id = t.to_tech_id
       WHERE t.id = $1`,
      [id]
    );
    if (transferResult.rows.length === 0) return res.status(404).json({ error: 'Transfer not found' });
    const transfer = transferResult.rows[0];

    if (transfer.to_tech_id !== req.technician.id) {
      return res.status(403).json({ error: 'This transfer is not addressed to you' });
    }

    if (transfer.status !== 'pending') {
      return res.status(400).json({ error: 'Transfer is not pending' });
    }

    const now = new Date().toISOString();
    await pool.query(
      `UPDATE transfers SET status = 'accepted', resolved_at = $1 WHERE id = $2`,
      [now, id]
    );
    await pool.query(
      `UPDATE visits SET technician_id = $1, updated_at = $2 WHERE id = $3`,
      [req.technician.id, now, transfer.visit_id]
    );

    const dispatchersResult = await pool.query(
      `SELECT id FROM technicians WHERE role IN ('dispatcher', 'owner') AND is_active = true`
    );
    for (const d of dispatchersResult.rows) {
      await createNotification(pool, {
        recipientId: d.id,
        type: 'transfer_accepted',
        message: `${transfer.to_tech_name} accepted transfer of ${transfer.street} from ${transfer.from_tech_name}`,
      });
    }

    const [visitRow, systems, services, items, photos] = await Promise.all([
      pool.query(
        `SELECT v.id, v.order_number, v.scheduled_time, v.status, v.technician_id,
                v.has_multiple_systems, v.is_deferred,
                a.street, a.city, a.state, a.zip, a.subdivision, a.builder
         FROM visits v
         JOIN addresses a ON a.id = v.address_id
         WHERE v.id = $1`,
        [transfer.visit_id]
      ),
      pool.query(
        'SELECT system_number, indoor_model, outdoor_model, refrigerant FROM visit_systems WHERE visit_id = $1 ORDER BY system_number',
        [transfer.visit_id]
      ),
      pool.query(
        'SELECT service_name, is_finish, is_temporarily, price FROM visit_services WHERE visit_id = $1',
        [transfer.visit_id]
      ),
      pool.query(
        'SELECT category, item_name, quantity, price, tech_supplied FROM visit_items WHERE visit_id = $1',
        [transfer.visit_id]
      ),
      pool.query(
        'SELECT id, tag, label, category, system_number, stored_at FROM visit_photos WHERE visit_id = $1',
        [transfer.visit_id]
      ),
    ]);

    const v = visitRow.rows[0];
    res.json({
      id: v.id,
      orderNumber: v.order_number,
      scheduledTime: v.scheduled_time,
      status: v.status,
      technicianId: v.technician_id,
      hasMultipleSystems: v.has_multiple_systems,
      isDeferred: v.is_deferred,
      address: { street: v.street, city: v.city, state: v.state, zip: v.zip, subdivision: v.subdivision, builder: v.builder },
      systems: systems.rows.map((s) => ({ systemNumber: s.system_number, indoorModel: s.indoor_model, outdoorModel: s.outdoor_model, refrigerant: s.refrigerant })),
      services: services.rows.map((s) => ({ serviceName: s.service_name, isFinish: s.is_finish, isTemporarily: s.is_temporarily, price: s.price })),
      items: items.rows.map((i) => ({ category: i.category, itemName: i.item_name, quantity: i.quantity, price: i.price, techSupplied: i.tech_supplied })),
      photos: photos.rows.map((p) => ({ id: p.id, tag: p.tag, label: p.label, category: p.category, systemNumber: p.system_number, storedAt: p.stored_at })),
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/transfers/:id/reject
router.post('/transfers/:id/reject', requireRole('technician'), async (req, res, next) => {
  const { id } = req.params;
  try {
    const transferResult = await pool.query(
      `SELECT t.id, t.to_tech_id, t.from_tech_id, t.status, a.street,
              tt.name AS to_tech_name
       FROM transfers t
       JOIN visits v ON v.id = t.visit_id
       JOIN addresses a ON a.id = v.address_id
       JOIN technicians tt ON tt.id = t.to_tech_id
       WHERE t.id = $1`,
      [id]
    );
    if (transferResult.rows.length === 0) return res.status(404).json({ error: 'Transfer not found' });
    const transfer = transferResult.rows[0];

    if (transfer.to_tech_id !== req.technician.id) {
      return res.status(403).json({ error: 'This transfer is not addressed to you' });
    }

    if (transfer.status !== 'pending') {
      return res.status(400).json({ error: 'Transfer is not pending' });
    }

    const now = new Date().toISOString();
    await pool.query(
      `UPDATE transfers SET status = 'rejected', resolved_at = $1 WHERE id = $2`,
      [now, id]
    );

    await createNotification(pool, {
      recipientId: transfer.from_tech_id,
      type: 'transfer_rejected',
      message: `${transfer.to_tech_name} declined the transfer of ${transfer.street}`,
    });

    res.json({ transferId: id, status: 'rejected' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- --testPathPattern="transfers" 2>&1 | tail -10
```
Expected: PASS — all transfer tests green

- [ ] **Step 5: Run the full test suite**

```bash
npm test 2>&1 | tail -15
```
Expected: All tests pass (116 + new tests)

- [ ] **Step 6: Commit**

```bash
git add src/routes/transfers.js tests/transfers.test.js
git commit -m "feat: add transfer routes — initiate, accept, reject, pending/mine"
```

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Task |
|---|---|
| Migration 004 `completed_at` | Task 1 |
| `generateReportText` — CSV format | Task 2 |
| `generateReportJSON` — full nested payload | Task 2 |
| `weigh_in_data` keyed by `address_id` | Task 2 |
| POST complete — terminal idempotency before ownership | Task 3 |
| POST complete — status derived from visit_services | Task 3 |
| POST complete — expire pending transfers | Task 3 |
| POST complete — notify dispatchers/owners | Task 3 |
| POST complete — Drive stub (console.log) | Task 3 |
| GET report-preview — tech assignee + dispatcher/owner | Task 3 |
| GET download — tech assignee + dispatcher/owner | Task 3 |
| POST transfer/initiate — all guards + notification | Task 4 |
| POST transfers/:id/accept — reassign, no status change, notify dispatchers | Task 4 |
| POST transfers/:id/reject — update, notify from_tech | Task 4 |
| GET transfers/pending/mine — tech only, correct shape | Task 4 |

**Naming consistency check:** `from_tech_id`/`to_tech_id` used in all SQL; `fromTechnicianId`/`toTechnicianId` used in all JSON responses. `generateReportText` and `generateReportJSON` named consistently across service and both route files.

**Placeholder scan:** None found — all steps have concrete code.
