# Phase 4 — Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the on-site workspace surface — services, items (with companion/exclusion cascades), system model updates, weigh-in, photos, and notes — backed by a standalone pricing engine that recalculates `total_price` after every write.

**Architecture:** Two new source files: `src/services/pricing.js` (exported `calculateVisitPrice(db, visitId)` function, zero side-effects) and `src/routes/workspace.js` (seven route handlers + private `requireVisitOwnership` middleware + cascade helpers). Workspace router mounts at `/api/visits` in `index.js` alongside the existing visits routers — Express cascades multiple routers at the same prefix without conflict. All SQL is inline in handlers following the project convention.

**Tech Stack:** Node.js, Express, `pg` (raw PostgreSQL, no ORM), multer 2.x (memoryStorage — file bytes discarded), Jest + Supertest.

## Global Constraints

- All PKs: `text DEFAULT gen_random_uuid()::text` — never SERIAL or uuid type
- All timestamps: ISO 8601 via `new Date().toISOString()` — text columns, never Date objects
- Test command: `npm test` (runs `jest --runInBand`)
- Error messages must match verbatim: `"Visit not found"`, `"This visit is not assigned to you"`, `"Visit cannot be modified — current status: {status}"`, `"Invalid service name"`, `"Item not found in catalog"`, `"price is required for this item"`, `"Item not found"`, `"System not found"`, `"Lineset config not found"`, `"Invalid category"`, `"tag is required"`
- `oem_subcooling_goal` is **hardcoded to 10** — never read from catalog. `subcooling_deviation = subcoolingValue - 10`
- `calculateVisitPrice(db, visitId)` is imported from `src/services/pricing.js` — never duplicated inline
- `requireVisitOwnership` is a private function in `workspace.js` — not exported, not a separate file
- Valid service names: `['AC', 'Heat', 'AC & Heat', 'Prestart System', 'Drive Run', 'Cancel']`
- Valid item categories: `['accessory', 'fix', 'thermostat']`
- Valid photo categories: `['weigh_in_scale', 'fan_speed', 'site_evidence']`
- Photo `stored_at` is always `null` in Phase 4 (Drive upload deferred to Phase 5)
- `catalog_item_relations` rows have `id` text PK (uuid) with no additional UNIQUE constraint — use explicit DELETE before INSERT in test setup to avoid accumulation

---

## File Map

| Action | File | Purpose |
|--------|------|---------|
| Create | `src/services/pricing.js` | Standalone pricing engine |
| Create | `src/routes/workspace.js` | All 7 workspace endpoints + private helpers |
| Modify | `src/index.js` | Mount workspace router |
| Modify | `tests/helpers/seeds.js` | Add `seedAssignedVisit` helper |
| Modify | `tests/unit.test.js` | Add `calculateVisitPrice` unit tests |
| Create | `tests/workspace.test.js` | Integration tests for all 7 endpoints |

---

### Task 1: Pricing Engine + `seedAssignedVisit`

**Files:**
- Create: `src/services/pricing.js`
- Modify: `tests/helpers/seeds.js` (append `seedAssignedVisit`, update exports)
- Modify: `tests/unit.test.js` (append `calculateVisitPrice` describe block)

**Interfaces:**
- Produces:
  - `calculateVisitPrice(db, visitId) → Promise<number>` — exported from `src/services/pricing.js`; `db` is any pg pool or client with a `.query(sql, params)` method
  - `seedAssignedVisit() → Promise<{ visitId, addressId, street, tech, token }>` — exported from `tests/helpers/seeds.js`

---

- [ ] **Step 1: Write the failing unit tests for `calculateVisitPrice`**

Append to the bottom of `tests/unit.test.js` (after the last `});` line):

```js
// ── calculateVisitPrice ───────────────────────────────────────────────────────
describe('calculateVisitPrice', () => {
  const { calculateVisitPrice } = require('../src/services/pricing');

  async function makePricingVisit({ systemCount = 1 } = {}) {
    const addrRes = await pool.query(
      `INSERT INTO addresses (id, street) VALUES (gen_random_uuid()::text, '1 PRICING ST') RETURNING id`
    );
    const techRes = await pool.query(
      `INSERT INTO technicians (id, name, role, is_active, created_at)
       VALUES (gen_random_uuid()::text, 'PT', 'technician', true, $1) RETURNING id`,
      [new Date().toISOString()]
    );
    const visitRes = await pool.query(
      `INSERT INTO visits (id, address_id, technician_id, status, has_multiple_systems, is_deferred, created_at, updated_at)
       VALUES (gen_random_uuid()::text, $1, $2, 'assigned', $3, false, $4, $4) RETURNING id`,
      [addrRes.rows[0].id, techRes.rows[0].id, systemCount > 1, new Date().toISOString()]
    );
    const visitId = visitRes.rows[0].id;
    const techId = techRes.rows[0].id;
    for (let i = 1; i <= systemCount; i++) {
      await pool.query(
        `INSERT INTO visit_systems (id, visit_id, system_number) VALUES (gen_random_uuid()::text, $1, $2)`,
        [visitId, i]
      );
    }
    return { visitId, techId };
  }

  beforeEach(async () => {
    await pool.query(`
      INSERT INTO catalog_services (service_name, default_price, is_bundle, multiplies_by_system_count)
      VALUES
        ('PT-SVC',        150, false, false),
        ('PT-SVC-MULTI',   50, false, true),
        ('Cancel',          0, false, false)
      ON CONFLICT (service_name) DO NOTHING
    `);
    await pool.query(`
      INSERT INTO catalog_items (item_name, category, default_price, tech_supplied, multiplies_by_system_count, custom_price, finish_addon_price)
      VALUES
        ('PT-ITEM-A',    'accessory', 25, false, false, false, 15),
        ('PT-ITEM-MULTI','accessory', 40, false, true,  false, null),
        ('PT-ITEM-CUST', 'fix',        0, false, false, true,  null)
      ON CONFLICT (item_name) DO NOTHING
    `);
  });

  it('returns service default_price for basic service with no items', async () => {
    const { visitId } = await makePricingVisit();
    await pool.query(
      `INSERT INTO visit_services (id, visit_id, service_name, is_finish, is_temporarily, price)
       VALUES (gen_random_uuid()::text, $1, 'PT-SVC', false, false, 150)`,
      [visitId]
    );
    const total = await calculateVisitPrice(pool, visitId);
    expect(total).toBe(150);
  });

  it('returns 0 when Cancel is the service regardless of items', async () => {
    const { visitId } = await makePricingVisit();
    await pool.query(
      `INSERT INTO visit_services (id, visit_id, service_name, is_finish, is_temporarily, price)
       VALUES (gen_random_uuid()::text, $1, 'Cancel', false, false, 0)`,
      [visitId]
    );
    await pool.query(
      `INSERT INTO visit_items (id, visit_id, item_name, category, quantity, price, tech_supplied)
       VALUES (gen_random_uuid()::text, $1, 'PT-ITEM-A', 'accessory', 1, 25, false)`,
      [visitId]
    );
    const total = await calculateVisitPrice(pool, visitId);
    expect(total).toBe(0);
  });

  it('multiplies service price by systemCount when multiplies_by_system_count = true', async () => {
    const { visitId } = await makePricingVisit({ systemCount: 3 });
    await pool.query(
      `INSERT INTO visit_services (id, visit_id, service_name, is_finish, is_temporarily, price)
       VALUES (gen_random_uuid()::text, $1, 'PT-SVC-MULTI', false, false, 50)`,
      [visitId]
    );
    const total = await calculateVisitPrice(pool, visitId);
    expect(total).toBe(150); // 50 * 3 systems
  });

  it('adds finish_addon_price when service is_finish = true', async () => {
    const { visitId } = await makePricingVisit();
    await pool.query(
      `INSERT INTO visit_services (id, visit_id, service_name, is_finish, is_temporarily, price)
       VALUES (gen_random_uuid()::text, $1, 'PT-SVC', true, false, 150)`,
      [visitId]
    );
    await pool.query(
      `INSERT INTO visit_items (id, visit_id, item_name, category, quantity, price, tech_supplied)
       VALUES (gen_random_uuid()::text, $1, 'PT-ITEM-A', 'accessory', 1, 25, false)`,
      [visitId]
    );
    const total = await calculateVisitPrice(pool, visitId);
    expect(total).toBe(190); // 150 (service) + 25 (item default) + 15 (finish addon)
  });

  it('uses visit_items.price directly for custom_price items', async () => {
    const { visitId } = await makePricingVisit();
    await pool.query(
      `INSERT INTO visit_services (id, visit_id, service_name, is_finish, is_temporarily, price)
       VALUES (gen_random_uuid()::text, $1, 'PT-SVC', false, false, 150)`,
      [visitId]
    );
    await pool.query(
      `INSERT INTO visit_items (id, visit_id, item_name, category, quantity, price, tech_supplied)
       VALUES (gen_random_uuid()::text, $1, 'PT-ITEM-CUST', 'fix', 1, 99, false)`,
      [visitId]
    );
    const total = await calculateVisitPrice(pool, visitId);
    expect(total).toBe(249); // 150 + 99 (custom stored price)
  });

  it('uses technician price override when available', async () => {
    const { visitId, techId } = await makePricingVisit();
    await pool.query(
      `INSERT INTO visit_services (id, visit_id, service_name, is_finish, is_temporarily, price)
       VALUES (gen_random_uuid()::text, $1, 'PT-SVC', false, false, 150)`,
      [visitId]
    );
    await pool.query(
      `INSERT INTO visit_items (id, visit_id, item_name, category, quantity, price, tech_supplied)
       VALUES (gen_random_uuid()::text, $1, 'PT-ITEM-A', 'accessory', 1, 25, false)`,
      [visitId]
    );
    await pool.query(
      `INSERT INTO technician_price_overrides (id, technician_id, item_name, override_price)
       VALUES (gen_random_uuid()::text, $1, 'PT-ITEM-A', 30)`,
      [techId]
    );
    const total = await calculateVisitPrice(pool, visitId);
    expect(total).toBe(180); // 150 (service) + 30 (override, not catalog 25)
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npm test -- --testPathPattern=unit 2>&1 | tail -20
```

Expected: tests in the `calculateVisitPrice` describe block fail with `Cannot find module '../src/services/pricing'`.

- [ ] **Step 3: Create `src/services/pricing.js`**

```js
async function calculateVisitPrice(db, visitId) {
  const [servicesRes, itemsRes, systemsRes, visitRes] = await Promise.all([
    db.query(
      `SELECT vs.service_name, vs.is_finish,
              cs.default_price, cs.multiplies_by_system_count
       FROM visit_services vs
       JOIN catalog_services cs ON cs.service_name = vs.service_name
       WHERE vs.visit_id = $1`,
      [visitId]
    ),
    db.query(
      `SELECT vi.item_name, vi.price AS stored_price,
              ci.default_price, ci.multiplies_by_system_count,
              ci.custom_price, ci.finish_addon_price
       FROM visit_items vi
       JOIN catalog_items ci ON ci.item_name = vi.item_name
       WHERE vi.visit_id = $1`,
      [visitId]
    ),
    db.query(
      `SELECT COUNT(*)::int AS cnt FROM visit_systems WHERE visit_id = $1`,
      [visitId]
    ),
    db.query(
      `SELECT technician_id FROM visits WHERE id = $1`,
      [visitId]
    ),
  ]);

  if (servicesRes.rows.some(r => r.service_name === 'Cancel')) return 0;

  const systemCount = systemsRes.rows[0].cnt || 1;
  const techId = visitRes.rows[0]?.technician_id;

  const overridesMap = new Map();
  if (techId) {
    const ovRes = await db.query(
      `SELECT item_name, override_price FROM technician_price_overrides WHERE technician_id = $1`,
      [techId]
    );
    ovRes.rows.forEach(r => overridesMap.set(r.item_name, r.override_price));
  }

  const hasFinish = servicesRes.rows.some(r => r.is_finish);

  let serviceTotal = 0;
  for (const s of servicesRes.rows) {
    let price = s.default_price ?? 0;
    if (s.multiplies_by_system_count) price *= systemCount;
    serviceTotal += price;
  }

  let finishAddonTotal = 0;
  if (hasFinish) {
    for (const item of itemsRes.rows) {
      if (item.finish_addon_price != null) finishAddonTotal += item.finish_addon_price;
    }
  }

  let itemTotal = 0;
  for (const item of itemsRes.rows) {
    let price;
    if (item.custom_price) {
      price = item.stored_price ?? 0;
    } else if (overridesMap.has(item.item_name)) {
      price = overridesMap.get(item.item_name);
    } else {
      price = item.default_price ?? 0;
    }
    if (item.multiplies_by_system_count) price = (price ?? 0) * systemCount;
    itemTotal += price ?? 0;
  }

  return serviceTotal + itemTotal + finishAddonTotal;
}

module.exports = { calculateVisitPrice };
```

- [ ] **Step 4: Add `seedAssignedVisit` to `tests/helpers/seeds.js`**

Append before the `module.exports` line:

```js
async function seedAssignedVisit() {
  const tech = await seedTech({ role: 'technician' });
  const token = await seedToken(tech.id);
  const street = `${crypto.randomBytes(4).toString('hex')} WORKSPACE ST`;
  const addrRes = await pool.query(
    `INSERT INTO addresses (id, street, city, subdivision, builder)
     VALUES (gen_random_uuid()::text, $1, 'Houston', 'TEST SUB', 'DR HORTON') RETURNING id`,
    [street]
  );
  const addressId = addrRes.rows[0].id;
  const now = new Date().toISOString();
  const visitRes = await pool.query(
    `INSERT INTO visits
       (id, address_id, technician_id, status, has_multiple_systems, is_deferred, scheduled_time, date, created_at, updated_at)
     VALUES (gen_random_uuid()::text, $1, $2, 'assigned', false, false, '2026-07-01T09:00:00Z', '2026-07-01', $3, $3)
     RETURNING id`,
    [addressId, tech.id, now]
  );
  const visitId = visitRes.rows[0].id;
  await pool.query(
    `INSERT INTO visit_systems (id, visit_id, system_number) VALUES (gen_random_uuid()::text, $1, 1)`,
    [visitId]
  );
  return { visitId, addressId, street, tech, token };
}
```

Replace the `module.exports` line with:

```js
module.exports = { seedTech, seedToken, seedDispatcherWithToken, seedTechnicianWithToken, seedInLobbyVisit, seedAssignedVisit };
```

- [ ] **Step 5: Run tests to confirm they pass**

```bash
npm test -- --testPathPattern=unit 2>&1 | tail -20
```

Expected: all unit tests pass, including the 6 new `calculateVisitPrice` tests. Full suite count increases by 6.

- [ ] **Step 6: Commit**

```bash
git add src/services/pricing.js tests/unit.test.js tests/helpers/seeds.js
git commit -m "feat: add pricing engine and seedAssignedVisit helper"
```

---

### Task 2: Workspace Scaffold + `PATCH /api/visits/:id/services`

**Files:**
- Create: `src/routes/workspace.js`
- Modify: `src/index.js` (add one mount line)
- Create: `tests/workspace.test.js`

**Interfaces:**
- Consumes: `calculateVisitPrice(db, visitId)` from `src/services/pricing.js` (Task 1)
- Consumes: `seedAssignedVisit()` from `tests/helpers/seeds.js` (Task 1)
- Produces: `PATCH /api/visits/:id/services` → `200 { id, serviceName, isFinish, isTemporarily, totalPrice }` or `200 { requiresConfirmation, itemsToRemove }` (Cancel path)

---

- [ ] **Step 1: Write the failing tests for `PATCH /api/visits/:id/services`**

Create `tests/workspace.test.js`:

```js
const request = require('supertest');
const app = require('../src/index');
const { pool, truncateTables } = require('./helpers/db');
const {
  seedTechnicianWithToken,
  seedAssignedVisit,
} = require('./helpers/seeds');

beforeEach(truncateTables);
afterAll(() => pool.end());

// ── PATCH /api/visits/:id/services ───────────────────────────────────────────
describe('PATCH /api/visits/:id/services', () => {
  beforeEach(async () => {
    await pool.query(`
      INSERT INTO catalog_services (service_name, default_price, is_bundle, multiplies_by_system_count)
      VALUES
        ('AC',     150, false, false),
        ('Heat',   100, false, false),
        ('Cancel',   0, false, false)
      ON CONFLICT (service_name) DO NOTHING
    `);
  });

  it('sets service and returns totalPrice from catalog', async () => {
    const { visitId, token } = await seedAssignedVisit();
    const res = await request(app)
      .patch(`/api/visits/${visitId}/services`)
      .set('Authorization', `Bearer ${token}`)
      .send({ serviceName: 'AC' });
    expect(res.status).toBe(200);
    expect(res.body.serviceName).toBe('AC');
    expect(res.body.isFinish).toBe(false);
    expect(res.body.isTemporarily).toBe(false);
    expect(res.body.totalPrice).toBe(150);
  });

  it('overwrites existing service — only one row in visit_services after second call', async () => {
    const { visitId, token } = await seedAssignedVisit();
    await request(app)
      .patch(`/api/visits/${visitId}/services`)
      .set('Authorization', `Bearer ${token}`)
      .send({ serviceName: 'AC' });
    const res = await request(app)
      .patch(`/api/visits/${visitId}/services`)
      .set('Authorization', `Bearer ${token}`)
      .send({ serviceName: 'Heat' });
    expect(res.status).toBe(200);
    expect(res.body.serviceName).toBe('Heat');
    const rows = await pool.query('SELECT * FROM visit_services WHERE visit_id = $1', [visitId]);
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0].service_name).toBe('Heat');
  });

  it('Cancel with items returns requiresConfirmation without modifying DB', async () => {
    const { visitId, token } = await seedAssignedVisit();
    await pool.query(`
      INSERT INTO catalog_items (item_name, category, default_price, tech_supplied)
      VALUES ('WS-ITEM-X', 'accessory', 10, false)
      ON CONFLICT (item_name) DO NOTHING
    `);
    await pool.query(
      `INSERT INTO visit_items (id, visit_id, item_name, category, quantity, price, tech_supplied)
       VALUES (gen_random_uuid()::text, $1, 'WS-ITEM-X', 'accessory', 1, 10, false)`,
      [visitId]
    );
    const res = await request(app)
      .patch(`/api/visits/${visitId}/services`)
      .set('Authorization', `Bearer ${token}`)
      .send({ serviceName: 'Cancel' });
    expect(res.status).toBe(200);
    expect(res.body.requiresConfirmation).toBe(true);
    expect(res.body.itemsToRemove).toHaveLength(1);
    expect(res.body.itemsToRemove[0].itemName).toBe('WS-ITEM-X');
    const items = await pool.query('SELECT * FROM visit_items WHERE visit_id = $1', [visitId]);
    expect(items.rows).toHaveLength(1); // unchanged
  });

  it('Cancel with confirmed:true deletes all items and sets totalPrice to 0', async () => {
    const { visitId, token } = await seedAssignedVisit();
    await pool.query(`
      INSERT INTO catalog_items (item_name, category, default_price, tech_supplied)
      VALUES ('WS-ITEM-X', 'accessory', 10, false)
      ON CONFLICT (item_name) DO NOTHING
    `);
    await pool.query(
      `INSERT INTO visit_items (id, visit_id, item_name, category, quantity, price, tech_supplied)
       VALUES (gen_random_uuid()::text, $1, 'WS-ITEM-X', 'accessory', 1, 10, false)`,
      [visitId]
    );
    const res = await request(app)
      .patch(`/api/visits/${visitId}/services`)
      .set('Authorization', `Bearer ${token}`)
      .send({ serviceName: 'Cancel', confirmed: true });
    expect(res.status).toBe(200);
    expect(res.body.totalPrice).toBe(0);
    const items = await pool.query('SELECT * FROM visit_items WHERE visit_id = $1', [visitId]);
    expect(items.rows).toHaveLength(0);
    const visit = await pool.query('SELECT total_price FROM visits WHERE id = $1', [visitId]);
    expect(visit.rows[0].total_price).toBe(0);
  });

  it('returns 400 for unrecognised serviceName', async () => {
    const { visitId, token } = await seedAssignedVisit();
    const res = await request(app)
      .patch(`/api/visits/${visitId}/services`)
      .set('Authorization', `Bearer ${token}`)
      .send({ serviceName: 'BOGUS' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid service name');
  });

  it('returns 403 when token belongs to a different technician', async () => {
    const { visitId } = await seedAssignedVisit();
    const { token: otherToken } = await seedTechnicianWithToken({ name: 'Other-Tech' });
    const res = await request(app)
      .patch(`/api/visits/${visitId}/services`)
      .set('Authorization', `Bearer ${otherToken}`)
      .send({ serviceName: 'AC' });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('This visit is not assigned to you');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- --testPathPattern=workspace 2>&1 | tail -20
```

Expected: FAIL — cannot GET `/api/visits/:id/services` (route not found, or cannot find module).

- [ ] **Step 3: Create `src/routes/workspace.js`**

```js
const express = require('express');
const { pool } = require('../db/pool');
const { requireRole } = require('../middleware/auth');
const { calculateVisitPrice } = require('../services/pricing');

const router = express.Router();

const VALID_SERVICES = ['AC', 'Heat', 'AC & Heat', 'Prestart System', 'Drive Run', 'Cancel'];

async function requireVisitOwnership(req, res, next) {
  try {
    const result = await pool.query(
      `SELECT id, status, technician_id, address_id FROM visits WHERE id = $1`,
      [req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Visit not found' });
    const visit = result.rows[0];
    if (visit.technician_id !== req.technician.id) {
      return res.status(403).json({ error: 'This visit is not assigned to you' });
    }
    if (!['assigned', 'in_progress'].includes(visit.status)) {
      return res.status(400).json({
        error: `Visit cannot be modified — current status: ${visit.status}`,
      });
    }
    req.visit = visit;
    next();
  } catch (err) {
    next(err);
  }
}

// PATCH /api/visits/:id/services
router.patch(
  '/:id/services',
  requireRole('technician'),
  requireVisitOwnership,
  async (req, res, next) => {
    const { id } = req.params;
    const { serviceName, isFinish = false, isTemporarily = false, confirmed = false } = req.body;
    try {
      if (!VALID_SERVICES.includes(serviceName)) {
        return res.status(400).json({ error: 'Invalid service name' });
      }

      if (serviceName === 'Cancel') {
        const items = await pool.query(
          `SELECT id, item_name FROM visit_items WHERE visit_id = $1`,
          [id]
        );
        if (items.rows.length > 0 && !confirmed) {
          return res.json({
            requiresConfirmation: true,
            itemsToRemove: items.rows.map(r => ({ id: r.id, itemName: r.item_name })),
          });
        }
        const now = new Date().toISOString();
        await pool.query(`DELETE FROM visit_items WHERE visit_id = $1`, [id]);
        await pool.query(`DELETE FROM visit_services WHERE visit_id = $1`, [id]);
        await pool.query(
          `UPDATE visits SET total_price = 0, updated_at = $1 WHERE id = $2`,
          [now, id]
        );
        return res.json({ id, serviceName: 'Cancel', isFinish: false, isTemporarily: false, totalPrice: 0 });
      }

      const catalogRes = await pool.query(
        `SELECT default_price FROM catalog_services WHERE service_name = $1`,
        [serviceName]
      );
      const catalogPrice = catalogRes.rows[0]?.default_price ?? 0;

      await pool.query(`DELETE FROM visit_services WHERE visit_id = $1`, [id]);
      await pool.query(
        `INSERT INTO visit_services (id, visit_id, service_name, is_finish, is_temporarily, price)
         VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5)`,
        [id, serviceName, isFinish, isTemporarily, catalogPrice]
      );

      const totalPrice = await calculateVisitPrice(pool, id);
      const now = new Date().toISOString();
      await pool.query(
        `UPDATE visits SET total_price = $1, updated_at = $2 WHERE id = $3`,
        [totalPrice, now, id]
      );

      res.json({ id, serviceName, isFinish, isTemporarily, totalPrice });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
```

- [ ] **Step 4: Mount workspace router in `src/index.js`**

After line `app.use('/api/dispatch/visits', dispatchVisitsRouter);`, add:

```js
app.use('/api/visits', require('./routes/workspace'));
```

- [ ] **Step 5: Run tests to confirm they pass**

```bash
npm test -- --testPathPattern=workspace 2>&1 | tail -20
```

Expected: all 6 service tests pass.

- [ ] **Step 6: Run full suite to verify no regressions**

```bash
npm test 2>&1 | tail -10
```

Expected: all existing tests still pass. Count increases by 6.

- [ ] **Step 7: Commit**

```bash
git add src/routes/workspace.js src/index.js tests/workspace.test.js
git commit -m "feat: add workspace scaffold and PATCH /services endpoint"
```

---

### Task 3: `POST /api/visits/:id/items`

**Files:**
- Modify: `src/routes/workspace.js` (add companion + exclusion helpers + POST /items route)
- Modify: `tests/workspace.test.js` (append items describe block)

**Interfaces:**
- Consumes: `requireVisitOwnership` (already in workspace.js), `calculateVisitPrice` (already imported)
- Produces: `POST /api/visits/:id/items` → `200 { id, totalPrice, addedItems, removedItems }`

---

- [ ] **Step 1: Write the failing tests for `POST /api/visits/:id/items`**

Append to `tests/workspace.test.js`:

```js
// ── POST /api/visits/:id/items ────────────────────────────────────────────────
describe('POST /api/visits/:id/items', () => {
  beforeEach(async () => {
    // Clean test catalog_item_relations to avoid accumulation across runs
    await pool.query(`
      DELETE FROM catalog_item_relations
      WHERE item_name LIKE 'TEST-%' OR related_item_name LIKE 'TEST-%'
    `);
    await pool.query(`
      INSERT INTO catalog_items
        (item_name, category, default_price, tech_supplied, multiplies_by_system_count, custom_price)
      VALUES
        ('TEST-PARENT',    'accessory', 50, false, false, false),
        ('TEST-COMPANION', 'accessory', 20, false, false, false),
        ('TEST-EXCL-A',    'accessory', 30, false, false, false),
        ('TEST-EXCL-B',    'accessory', 30, false, false, false),
        ('TEST-EXCL-COMP', 'accessory', 10, false, false, false),
        ('TEST-CUSTOM',    'fix',        0, false, false, true)
      ON CONFLICT (item_name) DO NOTHING
    `);
    await pool.query(`
      INSERT INTO catalog_item_relations (id, item_name, relation_type, related_item_name, exclusion_group_id)
      VALUES
        (gen_random_uuid()::text, 'TEST-PARENT', 'companion',       'TEST-COMPANION', null),
        (gen_random_uuid()::text, 'TEST-EXCL-A', 'exclusion_group', 'TEST-EXCL-B',    'TEST-EXG'),
        (gen_random_uuid()::text, 'TEST-EXCL-B', 'exclusion_group', 'TEST-EXCL-A',    'TEST-EXG'),
        (gen_random_uuid()::text, 'TEST-EXCL-B', 'companion',       'TEST-EXCL-COMP', null)
    `);
    await pool.query(`
      INSERT INTO catalog_services (service_name, default_price, is_bundle, multiplies_by_system_count)
      VALUES ('AC', 150, false, false)
      ON CONFLICT (service_name) DO NOTHING
    `);
  });

  it('inserts item and auto-adds companion', async () => {
    const { visitId, token } = await seedAssignedVisit();
    const res = await request(app)
      .post(`/api/visits/${visitId}/items`)
      .set('Authorization', `Bearer ${token}`)
      .send({ category: 'accessory', itemName: 'TEST-PARENT' });
    expect(res.status).toBe(200);
    expect(res.body.addedItems).toContain('TEST-PARENT');
    expect(res.body.addedItems).toContain('TEST-COMPANION');
    expect(res.body.removedItems).toHaveLength(0);
    const rows = await pool.query(
      `SELECT item_name FROM visit_items WHERE visit_id = $1 ORDER BY item_name`,
      [visitId]
    );
    expect(rows.rows.map(r => r.item_name)).toEqual(['TEST-COMPANION', 'TEST-PARENT']);
  });

  it('removes conflicting exclusion-group item (and its companion) when adding', async () => {
    const { visitId, token } = await seedAssignedVisit();
    // Pre-seed TEST-EXCL-A in the visit (simulate it was previously added)
    await pool.query(
      `INSERT INTO visit_items (id, visit_id, item_name, category, quantity, price, tech_supplied)
       VALUES (gen_random_uuid()::text, $1, 'TEST-EXCL-A', 'accessory', 1, 30, false)`,
      [visitId]
    );
    const res = await request(app)
      .post(`/api/visits/${visitId}/items`)
      .set('Authorization', `Bearer ${token}`)
      .send({ category: 'accessory', itemName: 'TEST-EXCL-B' });
    expect(res.status).toBe(200);
    expect(res.body.addedItems).toContain('TEST-EXCL-B');
    expect(res.body.addedItems).toContain('TEST-EXCL-COMP');
    expect(res.body.removedItems).toContain('TEST-EXCL-A');
    const rows = await pool.query(
      `SELECT item_name FROM visit_items WHERE visit_id = $1 ORDER BY item_name`,
      [visitId]
    );
    const names = rows.rows.map(r => r.item_name);
    expect(names).toContain('TEST-EXCL-B');
    expect(names).toContain('TEST-EXCL-COMP');
    expect(names).not.toContain('TEST-EXCL-A');
  });

  it('returns 400 for item not in catalog', async () => {
    const { visitId, token } = await seedAssignedVisit();
    const res = await request(app)
      .post(`/api/visits/${visitId}/items`)
      .set('Authorization', `Bearer ${token}`)
      .send({ category: 'accessory', itemName: 'NO-SUCH-ITEM' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Item not found in catalog');
  });

  it('returns 400 when custom_price item sent without price', async () => {
    const { visitId, token } = await seedAssignedVisit();
    const res = await request(app)
      .post(`/api/visits/${visitId}/items`)
      .set('Authorization', `Bearer ${token}`)
      .send({ category: 'fix', itemName: 'TEST-CUSTOM' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('price is required for this item');
  });

  it('returns 403 when token belongs to a different technician', async () => {
    const { visitId } = await seedAssignedVisit();
    const { token: otherToken } = await seedTechnicianWithToken({ name: 'Other-Tech' });
    const res = await request(app)
      .post(`/api/visits/${visitId}/items`)
      .set('Authorization', `Bearer ${otherToken}`)
      .send({ category: 'accessory', itemName: 'TEST-PARENT' });
    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- --testPathPattern=workspace 2>&1 | tail -20
```

Expected: FAIL — `POST /api/visits/:id/items` returns 404 (route not registered yet).

- [ ] **Step 3: Add cascade helpers and `POST /items` route to `src/routes/workspace.js`**

Add after the `VALID_SERVICES` constant and before `requireVisitOwnership`:

```js
const VALID_CATEGORIES = ['accessory', 'fix', 'thermostat'];
```

Add after `requireVisitOwnership` and before the PATCH /services route:

```js
async function resolveCompanionCascade(db, visitId, itemName, mode) {
  const relRes = await db.query(
    `SELECT related_item_name FROM catalog_item_relations
     WHERE item_name = $1 AND relation_type = 'companion'`,
    [itemName]
  );
  const companions = relRes.rows.map(r => r.related_item_name);
  if (companions.length === 0) return [];

  if (mode === 'remove') {
    await db.query(
      `DELETE FROM visit_items WHERE visit_id = $1 AND item_name = ANY($2)`,
      [visitId, companions]
    );
    return companions;
  }

  // add mode
  const added = [];
  for (const name of companions) {
    const existing = await db.query(
      `SELECT id FROM visit_items WHERE visit_id = $1 AND item_name = $2`,
      [visitId, name]
    );
    if (existing.rows.length > 0) continue;
    const cat = await db.query(
      `SELECT default_price, tech_supplied, category FROM catalog_items WHERE item_name = $1`,
      [name]
    );
    if (cat.rows.length === 0) continue;
    const c = cat.rows[0];
    await db.query(
      `INSERT INTO visit_items (id, visit_id, item_name, category, quantity, price, tech_supplied)
       VALUES (gen_random_uuid()::text, $1, $2, $3, 1, $4, $5)`,
      [visitId, name, c.category, c.default_price ?? 0, c.tech_supplied]
    );
    added.push(name);
  }
  return added;
}

async function resolveExclusionCascade(db, visitId, itemName) {
  const relRes = await db.query(
    `SELECT exclusion_group_id FROM catalog_item_relations
     WHERE item_name = $1 AND relation_type = 'exclusion_group'
     LIMIT 1`,
    [itemName]
  );
  if (relRes.rows.length === 0 || !relRes.rows[0].exclusion_group_id) return [];

  const groupId = relRes.rows[0].exclusion_group_id;
  const membersRes = await db.query(
    `SELECT item_name FROM catalog_item_relations
     WHERE exclusion_group_id = $1 AND item_name <> $2 AND relation_type = 'exclusion_group'`,
    [groupId, itemName]
  );
  const memberNames = membersRes.rows.map(r => r.item_name);
  if (memberNames.length === 0) return [];

  const companionRes = await db.query(
    `SELECT related_item_name FROM catalog_item_relations
     WHERE item_name = ANY($1) AND relation_type = 'companion'`,
    [memberNames]
  );
  const companionNames = companionRes.rows.map(r => r.related_item_name);

  const toDelete = [...new Set([...memberNames, ...companionNames])];
  await db.query(
    `DELETE FROM visit_items WHERE visit_id = $1 AND item_name = ANY($2)`,
    [visitId, toDelete]
  );
  return toDelete;
}
```

Add after the PATCH /services route (before `module.exports`):

```js
// POST /api/visits/:id/items
router.post(
  '/:id/items',
  requireRole('technician'),
  requireVisitOwnership,
  async (req, res, next) => {
    const { id } = req.params;
    const { category, itemName, quantity = 1, price } = req.body;
    try {
      if (!VALID_CATEGORIES.includes(category)) {
        return res.status(400).json({ error: 'Invalid category' });
      }

      const catRes = await pool.query(
        `SELECT * FROM catalog_items WHERE item_name = $1`,
        [itemName]
      );
      if (catRes.rows.length === 0) {
        return res.status(400).json({ error: 'Item not found in catalog' });
      }
      const catalog = catRes.rows[0];

      if (catalog.custom_price && price == null) {
        return res.status(400).json({ error: 'price is required for this item' });
      }

      const resolvedPrice = catalog.custom_price ? price : (catalog.default_price ?? 0);

      const insertRes = await pool.query(
        `INSERT INTO visit_items (id, visit_id, item_name, category, quantity, price, tech_supplied)
         VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6) RETURNING id`,
        [id, itemName, category, quantity, resolvedPrice, catalog.tech_supplied]
      );
      const newId = insertRes.rows[0].id;

      const addedCompanions = await resolveCompanionCascade(pool, id, itemName, 'add');
      const removedItems = await resolveExclusionCascade(pool, id, itemName);

      const totalPrice = await calculateVisitPrice(pool, id);
      const now = new Date().toISOString();
      await pool.query(
        `UPDATE visits SET total_price = $1, updated_at = $2 WHERE id = $3`,
        [totalPrice, now, id]
      );

      res.json({
        id: newId,
        totalPrice,
        addedItems: [itemName, ...addedCompanions],
        removedItems,
      });
    } catch (err) {
      next(err);
    }
  }
);
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npm test -- --testPathPattern=workspace 2>&1 | tail -20
```

Expected: all workspace tests pass (6 services + 5 items = 11 total).

- [ ] **Step 5: Run full suite**

```bash
npm test 2>&1 | tail -10
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/routes/workspace.js tests/workspace.test.js
git commit -m "feat: add POST /items with companion and exclusion cascade"
```

---

### Task 4: `DELETE /api/visits/:id/items/:itemId`

**Files:**
- Modify: `src/routes/workspace.js` (add DELETE route)
- Modify: `tests/workspace.test.js` (append delete-items describe block)

**Interfaces:**
- Consumes: `resolveCompanionCascade(db, visitId, itemName, 'remove')` (Task 3), `calculateVisitPrice` (Task 1)
- Produces: `DELETE /api/visits/:id/items/:itemId` → `200 { totalPrice, removedItems }`

---

- [ ] **Step 1: Write the failing tests**

Append to `tests/workspace.test.js`:

```js
// ── DELETE /api/visits/:id/items/:itemId ──────────────────────────────────────
describe('DELETE /api/visits/:id/items/:itemId', () => {
  beforeEach(async () => {
    await pool.query(`
      DELETE FROM catalog_item_relations
      WHERE item_name LIKE 'TEST-%' OR related_item_name LIKE 'TEST-%'
    `);
    await pool.query(`
      INSERT INTO catalog_items
        (item_name, category, default_price, tech_supplied, multiplies_by_system_count, custom_price)
      VALUES
        ('TEST-PARENT',    'accessory', 50, false, false, false),
        ('TEST-COMPANION', 'accessory', 20, false, false, false)
      ON CONFLICT (item_name) DO NOTHING
    `);
    await pool.query(`
      INSERT INTO catalog_item_relations (id, item_name, relation_type, related_item_name, exclusion_group_id)
      VALUES (gen_random_uuid()::text, 'TEST-PARENT', 'companion', 'TEST-COMPANION', null)
    `);
    await pool.query(`
      INSERT INTO catalog_services (service_name, default_price, is_bundle, multiplies_by_system_count)
      VALUES ('AC', 150, false, false)
      ON CONFLICT (service_name) DO NOTHING
    `);
  });

  it('deletes item and cascades removal of its companions', async () => {
    const { visitId, token } = await seedAssignedVisit();
    // Seed parent + companion directly in visit_items
    const parentRes = await pool.query(
      `INSERT INTO visit_items (id, visit_id, item_name, category, quantity, price, tech_supplied)
       VALUES (gen_random_uuid()::text, $1, 'TEST-PARENT', 'accessory', 1, 50, false) RETURNING id`,
      [visitId]
    );
    const parentId = parentRes.rows[0].id;
    await pool.query(
      `INSERT INTO visit_items (id, visit_id, item_name, category, quantity, price, tech_supplied)
       VALUES (gen_random_uuid()::text, $1, 'TEST-COMPANION', 'accessory', 1, 20, false)`,
      [visitId]
    );
    const res = await request(app)
      .delete(`/api/visits/${visitId}/items/${parentId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.removedItems).toContain('TEST-PARENT');
    expect(res.body.removedItems).toContain('TEST-COMPANION');
    const rows = await pool.query(`SELECT * FROM visit_items WHERE visit_id = $1`, [visitId]);
    expect(rows.rows).toHaveLength(0);
  });

  it('returns 404 for unknown itemId', async () => {
    const { visitId, token } = await seedAssignedVisit();
    const res = await request(app)
      .delete(`/api/visits/${visitId}/items/no-such-id`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Item not found');
  });

  it('recalculates totalPrice after deletion', async () => {
    const { visitId, token } = await seedAssignedVisit();
    await pool.query(
      `INSERT INTO visit_services (id, visit_id, service_name, is_finish, is_temporarily, price)
       VALUES (gen_random_uuid()::text, $1, 'AC', false, false, 150)`,
      [visitId]
    );
    const itemRes = await pool.query(
      `INSERT INTO visit_items (id, visit_id, item_name, category, quantity, price, tech_supplied)
       VALUES (gen_random_uuid()::text, $1, 'TEST-PARENT', 'accessory', 1, 50, false) RETURNING id`,
      [visitId]
    );
    const itemId = itemRes.rows[0].id;
    const res = await request(app)
      .delete(`/api/visits/${visitId}/items/${itemId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.totalPrice).toBe(150); // AC service remains
  });
});
```

- [ ] **Step 2: Run to verify tests fail**

```bash
npm test -- --testPathPattern=workspace 2>&1 | tail -20
```

Expected: FAIL — DELETE route returns 404.

- [ ] **Step 3: Add DELETE route to `src/routes/workspace.js`**

Add after the POST /items route (before `module.exports`):

```js
// DELETE /api/visits/:id/items/:itemId
router.delete(
  '/:id/items/:itemId',
  requireRole('technician'),
  requireVisitOwnership,
  async (req, res, next) => {
    const { id, itemId } = req.params;
    try {
      const itemRes = await pool.query(
        `SELECT item_name FROM visit_items WHERE id = $1 AND visit_id = $2`,
        [itemId, id]
      );
      if (itemRes.rows.length === 0) {
        return res.status(404).json({ error: 'Item not found' });
      }
      const { item_name } = itemRes.rows[0];

      await pool.query(`DELETE FROM visit_items WHERE id = $1`, [itemId]);

      const deletedCompanions = await resolveCompanionCascade(pool, id, item_name, 'remove');

      const totalPrice = await calculateVisitPrice(pool, id);
      const now = new Date().toISOString();
      await pool.query(
        `UPDATE visits SET total_price = $1, updated_at = $2 WHERE id = $3`,
        [totalPrice, now, id]
      );

      res.json({ totalPrice, removedItems: [item_name, ...deletedCompanions] });
    } catch (err) {
      next(err);
    }
  }
);
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npm test -- --testPathPattern=workspace 2>&1 | tail -20
```

Expected: all workspace tests pass (11 previous + 3 delete = 14 total).

- [ ] **Step 5: Run full suite**

```bash
npm test 2>&1 | tail -10
```

- [ ] **Step 6: Commit**

```bash
git add src/routes/workspace.js tests/workspace.test.js
git commit -m "feat: add DELETE /items/:itemId with companion cascade"
```

---

### Task 5: `PATCH /api/visits/:id/systems/:systemNumber` + `PATCH /api/visits/:id/notes`

**Files:**
- Modify: `src/routes/workspace.js` (add two routes)
- Modify: `tests/workspace.test.js` (append two describe blocks)

**Interfaces:**
- Produces:
  - `PATCH /api/visits/:id/systems/:systemNumber` → `200 { systemNumber, indoorModel, outdoorModel, refrigerant }`
  - `PATCH /api/visits/:id/notes` → `200 { id, notes }`

---

- [ ] **Step 1: Write the failing tests**

Append to `tests/workspace.test.js`:

```js
// ── PATCH /api/visits/:id/systems/:systemNumber ───────────────────────────────
describe('PATCH /api/visits/:id/systems/:systemNumber', () => {
  it('updates indoorModel and returns merged system state', async () => {
    const { visitId, token } = await seedAssignedVisit();
    const res = await request(app)
      .patch(`/api/visits/${visitId}/systems/1`)
      .set('Authorization', `Bearer ${token}`)
      .send({ indoorModel: 'AH1234' });
    expect(res.status).toBe(200);
    expect(res.body.systemNumber).toBe(1);
    expect(res.body.indoorModel).toBe('AH1234');
    const row = await pool.query(
      `SELECT indoor_model FROM visit_systems WHERE visit_id = $1 AND system_number = 1`,
      [visitId]
    );
    expect(row.rows[0].indoor_model).toBe('AH1234');
  });

  it('pulls refrigerant from catalog_equipment when outdoorModel is provided', async () => {
    const { visitId, token } = await seedAssignedVisit();
    await pool.query(`
      INSERT INTO catalog_equipment (model, unit_type, brand, refrigerant)
      VALUES ('TEST-CONDENSER', 'outdoor', 'TEST', 'R-410A')
      ON CONFLICT (model) DO NOTHING
    `);
    const res = await request(app)
      .patch(`/api/visits/${visitId}/systems/1`)
      .set('Authorization', `Bearer ${token}`)
      .send({ outdoorModel: 'TEST-CONDENSER' });
    expect(res.status).toBe(200);
    expect(res.body.outdoorModel).toBe('TEST-CONDENSER');
    expect(res.body.refrigerant).toBe('R-410A');
  });

  it('returns 404 for systemNumber that does not exist on this visit', async () => {
    const { visitId, token } = await seedAssignedVisit();
    const res = await request(app)
      .patch(`/api/visits/${visitId}/systems/99`)
      .set('Authorization', `Bearer ${token}`)
      .send({ indoorModel: 'X' });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('System not found');
  });
});

// ── PATCH /api/visits/:id/notes ───────────────────────────────────────────────
describe('PATCH /api/visits/:id/notes', () => {
  it('updates notes and returns id + notes', async () => {
    const { visitId, token } = await seedAssignedVisit();
    const res = await request(app)
      .patch(`/api/visits/${visitId}/notes`)
      .set('Authorization', `Bearer ${token}`)
      .send({ notes: 'Check both systems carefully.' });
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(visitId);
    expect(res.body.notes).toBe('Check both systems carefully.');
    const row = await pool.query(`SELECT notes FROM visits WHERE id = $1`, [visitId]);
    expect(row.rows[0].notes).toBe('Check both systems carefully.');
  });

  it('returns 403 when token belongs to a different technician', async () => {
    const { visitId } = await seedAssignedVisit();
    const { token: otherToken } = await seedTechnicianWithToken({ name: 'Other-Tech' });
    const res = await request(app)
      .patch(`/api/visits/${visitId}/notes`)
      .set('Authorization', `Bearer ${otherToken}`)
      .send({ notes: 'Unauthorized' });
    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- --testPathPattern=workspace 2>&1 | tail -20
```

Expected: FAIL — routes return 404.

- [ ] **Step 3: Add both routes to `src/routes/workspace.js`**

Add after the DELETE /items route (before `module.exports`):

```js
// PATCH /api/visits/:id/systems/:systemNumber
router.patch(
  '/:id/systems/:systemNumber',
  requireRole('technician'),
  requireVisitOwnership,
  async (req, res, next) => {
    const { id, systemNumber } = req.params;
    const sysNum = parseInt(systemNumber, 10);
    const { indoorModel, outdoorModel } = req.body;
    try {
      const sysRes = await pool.query(
        `SELECT * FROM visit_systems WHERE visit_id = $1 AND system_number = $2`,
        [id, sysNum]
      );
      if (sysRes.rows.length === 0) {
        return res.status(404).json({ error: 'System not found' });
      }
      const current = sysRes.rows[0];

      let refrigerant = current.refrigerant;
      if (outdoorModel !== undefined) {
        const equipRes = await pool.query(
          `SELECT refrigerant FROM catalog_equipment WHERE model = $1`,
          [outdoorModel]
        );
        if (equipRes.rows.length > 0 && equipRes.rows[0].refrigerant != null) {
          refrigerant = equipRes.rows[0].refrigerant;
        }
      }

      const newIndoor = indoorModel !== undefined ? indoorModel : current.indoor_model;
      const newOutdoor = outdoorModel !== undefined ? outdoorModel : current.outdoor_model;

      await pool.query(
        `UPDATE visit_systems SET indoor_model = $1, outdoor_model = $2, refrigerant = $3
         WHERE visit_id = $4 AND system_number = $5`,
        [newIndoor, newOutdoor, refrigerant, id, sysNum]
      );
      await pool.query(
        `UPDATE visits SET updated_at = $1 WHERE id = $2`,
        [new Date().toISOString(), id]
      );

      res.json({ systemNumber: sysNum, indoorModel: newIndoor, outdoorModel: newOutdoor, refrigerant });
    } catch (err) {
      next(err);
    }
  }
);

// PATCH /api/visits/:id/notes
router.patch(
  '/:id/notes',
  requireRole('technician'),
  requireVisitOwnership,
  async (req, res, next) => {
    const { id } = req.params;
    const { notes } = req.body;
    try {
      await pool.query(
        `UPDATE visits SET notes = $1, updated_at = $2 WHERE id = $3`,
        [notes, new Date().toISOString(), id]
      );
      res.json({ id, notes });
    } catch (err) {
      next(err);
    }
  }
);
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npm test -- --testPathPattern=workspace 2>&1 | tail -20
```

Expected: all workspace tests pass (14 previous + 5 new = 19 total).

- [ ] **Step 5: Run full suite**

```bash
npm test 2>&1 | tail -10
```

- [ ] **Step 6: Commit**

```bash
git add src/routes/workspace.js tests/workspace.test.js
git commit -m "feat: add PATCH /systems/:systemNumber and PATCH /notes"
```

---

### Task 6: `PUT /api/visits/:id/weigh-in/:systemNumber`

**Files:**
- Modify: `src/routes/workspace.js` (add PUT weigh-in route)
- Modify: `tests/workspace.test.js` (append weigh-in describe block)

**Interfaces:**
- Consumes: `req.visit.address_id` from `requireVisitOwnership`
- Produces: `PUT /api/visits/:id/weigh-in/:systemNumber` → `200 { id, addressId, systemNumber, linesetLength, factoryChargeOz, factoryLineConfig, approxAdjustOz, adjustedOz, fanSpeedCfm, liquidLineTemp, suctionLineTemp, condenserSatTemp, subcoolingValue, oemSubcoolingGoal, subcoolingDeviation }`

---

- [ ] **Step 1: Write the failing tests**

Append to `tests/workspace.test.js`:

```js
// ── PUT /api/visits/:id/weigh-in/:systemNumber ────────────────────────────────
describe('PUT /api/visits/:id/weigh-in/:systemNumber', () => {
  beforeEach(async () => {
    await pool.query(`
      INSERT INTO catalog_lineset_configs (config_key, reference_length_ft, adjust_rate_oz_per_ft)
      VALUES ('STANDARD-25', 25, 0.5)
      ON CONFLICT (config_key) DO NOTHING
    `);
    await pool.query(`
      INSERT INTO catalog_equipment (model, unit_type, brand, factory_charge_oz, revised_charge_oz)
      VALUES ('TEST-COND-WI', 'outdoor', 'TEST', 80, 70)
      ON CONFLICT (model) DO NOTHING
    `);
  });

  const body = {
    linesetLength: 35,
    factoryLineConfig: 'STANDARD-25',
    factoryChargeUsed: 'factory',
    adjustedOz: 82,
    fanSpeedCfm: 1200,
    liquidLineTemp: 90,
    suctionLineTemp: 55,
    condenserSatTemp: 105,
    subcoolingValue: 18,
  };

  it('stores weigh-in against address_id and returns all calculated fields', async () => {
    const { visitId, addressId, token } = await seedAssignedVisit();
    await pool.query(
      `UPDATE visit_systems SET outdoor_model = 'TEST-COND-WI' WHERE visit_id = $1 AND system_number = 1`,
      [visitId]
    );
    const res = await request(app)
      .put(`/api/visits/${visitId}/weigh-in/1`)
      .set('Authorization', `Bearer ${token}`)
      .send(body);
    expect(res.status).toBe(200);
    expect(res.body.addressId).toBe(addressId);
    expect(res.body.systemNumber).toBe(1);
    // approxAdjustOz = (35 - 25) * 0.5 = 5.0
    expect(res.body.approxAdjustOz).toBeCloseTo(5.0);
    // oemSubcoolingGoal hardcoded to 10
    expect(res.body.oemSubcoolingGoal).toBe(10);
    // subcoolingDeviation = 18 - 10 = 8
    expect(res.body.subcoolingDeviation).toBeCloseTo(8);
    expect(res.body.factoryChargeOz).toBe(80); // factory, not revised
    const row = await pool.query(
      `SELECT * FROM weigh_in_data WHERE address_id = $1 AND system_number = 1`,
      [addressId]
    );
    expect(row.rows).toHaveLength(1);
  });

  it('upserts on second call — only one row per (address_id, system_number)', async () => {
    const { visitId, addressId, token } = await seedAssignedVisit();
    await pool.query(
      `UPDATE visit_systems SET outdoor_model = 'TEST-COND-WI' WHERE visit_id = $1 AND system_number = 1`,
      [visitId]
    );
    await request(app)
      .put(`/api/visits/${visitId}/weigh-in/1`)
      .set('Authorization', `Bearer ${token}`)
      .send(body);
    const secondBody = { ...body, subcoolingValue: 12 };
    const res = await request(app)
      .put(`/api/visits/${visitId}/weigh-in/1`)
      .set('Authorization', `Bearer ${token}`)
      .send(secondBody);
    expect(res.status).toBe(200);
    expect(res.body.subcoolingDeviation).toBeCloseTo(2); // 12 - 10
    const rows = await pool.query(
      `SELECT * FROM weigh_in_data WHERE address_id = $1 AND system_number = 1`,
      [addressId]
    );
    expect(rows.rows).toHaveLength(1);
  });

  it('uses revised_charge_oz when factoryChargeUsed is "revised"', async () => {
    const { visitId, token } = await seedAssignedVisit();
    await pool.query(
      `UPDATE visit_systems SET outdoor_model = 'TEST-COND-WI' WHERE visit_id = $1 AND system_number = 1`,
      [visitId]
    );
    const revisedBody = { ...body, factoryChargeUsed: 'revised' };
    const res = await request(app)
      .put(`/api/visits/${visitId}/weigh-in/1`)
      .set('Authorization', `Bearer ${token}`)
      .send(revisedBody);
    expect(res.status).toBe(200);
    expect(res.body.factoryChargeOz).toBe(70); // revised_charge_oz
  });

  it('returns 400 for unknown linesetConfig', async () => {
    const { visitId, token } = await seedAssignedVisit();
    const res = await request(app)
      .put(`/api/visits/${visitId}/weigh-in/1`)
      .set('Authorization', `Bearer ${token}`)
      .send({ ...body, factoryLineConfig: 'NO-SUCH-CONFIG' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Lineset config not found');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- --testPathPattern=workspace 2>&1 | tail -20
```

Expected: FAIL — PUT route returns 404.

- [ ] **Step 3: Add weigh-in route to `src/routes/workspace.js`**

Add after the PATCH /notes route (before `module.exports`):

```js
// PUT /api/visits/:id/weigh-in/:systemNumber
router.put(
  '/:id/weigh-in/:systemNumber',
  requireRole('technician'),
  requireVisitOwnership,
  async (req, res, next) => {
    const { id, systemNumber } = req.params;
    const sysNum = parseInt(systemNumber, 10);
    const {
      linesetLength,
      factoryLineConfig,
      factoryChargeUsed,
      adjustedOz,
      fanSpeedCfm,
      liquidLineTemp,
      suctionLineTemp,
      condenserSatTemp,
      subcoolingValue,
    } = req.body;
    const addressId = req.visit.address_id;

    try {
      const linesetRes = await pool.query(
        `SELECT reference_length_ft, adjust_rate_oz_per_ft
         FROM catalog_lineset_configs WHERE config_key = $1`,
        [factoryLineConfig]
      );
      if (linesetRes.rows.length === 0) {
        return res.status(400).json({ error: 'Lineset config not found' });
      }
      const { reference_length_ft, adjust_rate_oz_per_ft } = linesetRes.rows[0];
      const approxAdjustOz = (linesetLength - reference_length_ft) * adjust_rate_oz_per_ft;

      const sysRes = await pool.query(
        `SELECT outdoor_model FROM visit_systems WHERE visit_id = $1 AND system_number = $2`,
        [id, sysNum]
      );
      const outdoorModel = sysRes.rows[0]?.outdoor_model;

      let factoryChargeOz = null;
      if (outdoorModel) {
        const equipRes = await pool.query(
          `SELECT factory_charge_oz, revised_charge_oz FROM catalog_equipment WHERE model = $1`,
          [outdoorModel]
        );
        if (equipRes.rows.length > 0) {
          const e = equipRes.rows[0];
          factoryChargeOz = factoryChargeUsed === 'revised' ? e.revised_charge_oz : e.factory_charge_oz;
        }
      }

      const oemSubcoolingGoal = 10;
      const subcoolingDeviation = subcoolingValue - oemSubcoolingGoal;

      const upsertRes = await pool.query(
        `INSERT INTO weigh_in_data
           (id, address_id, system_number, lineset_length, factory_charge_oz,
            factory_line_config, approx_adjust_oz, adjusted_oz, fan_speed_cfm,
            liquid_line_temp, suction_line_temp, condenser_sat_temp,
            subcooling_value, oem_subcooling_goal, subcooling_deviation)
         VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
         ON CONFLICT (address_id, system_number) DO UPDATE SET
           lineset_length       = EXCLUDED.lineset_length,
           factory_charge_oz    = EXCLUDED.factory_charge_oz,
           factory_line_config  = EXCLUDED.factory_line_config,
           approx_adjust_oz     = EXCLUDED.approx_adjust_oz,
           adjusted_oz          = EXCLUDED.adjusted_oz,
           fan_speed_cfm        = EXCLUDED.fan_speed_cfm,
           liquid_line_temp     = EXCLUDED.liquid_line_temp,
           suction_line_temp    = EXCLUDED.suction_line_temp,
           condenser_sat_temp   = EXCLUDED.condenser_sat_temp,
           subcooling_value     = EXCLUDED.subcooling_value,
           oem_subcooling_goal  = EXCLUDED.oem_subcooling_goal,
           subcooling_deviation = EXCLUDED.subcooling_deviation
         RETURNING *`,
        [
          addressId, sysNum, linesetLength, factoryChargeOz, factoryLineConfig,
          approxAdjustOz, adjustedOz, fanSpeedCfm, liquidLineTemp, suctionLineTemp,
          condenserSatTemp, subcoolingValue, oemSubcoolingGoal, subcoolingDeviation,
        ]
      );

      await pool.query(
        `UPDATE visits SET updated_at = $1 WHERE id = $2`,
        [new Date().toISOString(), id]
      );

      const r = upsertRes.rows[0];
      res.json({
        id: r.id,
        addressId: r.address_id,
        systemNumber: r.system_number,
        linesetLength: r.lineset_length,
        factoryChargeOz: r.factory_charge_oz,
        factoryLineConfig: r.factory_line_config,
        approxAdjustOz: r.approx_adjust_oz,
        adjustedOz: r.adjusted_oz,
        fanSpeedCfm: r.fan_speed_cfm,
        liquidLineTemp: r.liquid_line_temp,
        suctionLineTemp: r.suction_line_temp,
        condenserSatTemp: r.condenser_sat_temp,
        subcoolingValue: r.subcooling_value,
        oemSubcoolingGoal: r.oem_subcooling_goal,
        subcoolingDeviation: r.subcooling_deviation,
      });
    } catch (err) {
      next(err);
    }
  }
);
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npm test -- --testPathPattern=workspace 2>&1 | tail -20
```

Expected: all workspace tests pass (19 previous + 4 weigh-in = 23 total).

- [ ] **Step 5: Run full suite**

```bash
npm test 2>&1 | tail -10
```

- [ ] **Step 6: Commit**

```bash
git add src/routes/workspace.js tests/workspace.test.js
git commit -m "feat: add PUT /weigh-in/:systemNumber with upsert and subcooling calculation"
```

---

### Task 7: `POST /api/visits/:id/photos`

**Files:**
- Modify: `src/routes/workspace.js` (add multer import + POST /photos route)
- Modify: `tests/workspace.test.js` (append photos describe block)

**Interfaces:**
- Produces: `POST /api/visits/:id/photos` → `200 { photoId, slug, storedAt: null }`

---

- [ ] **Step 1: Write the failing tests**

Append to `tests/workspace.test.js`:

```js
// ── POST /api/visits/:id/photos ───────────────────────────────────────────────
describe('POST /api/visits/:id/photos', () => {
  it('returns photoId, slug, and storedAt null', async () => {
    const { visitId, token } = await seedAssignedVisit();
    const res = await request(app)
      .post(`/api/visits/${visitId}/photos`)
      .set('Authorization', `Bearer ${token}`)
      .field('category', 'weigh_in_scale')
      .field('tag', 'SCALE_READING')
      .attach('photo', Buffer.from('fake-image-bytes'), 'scale.jpg');
    expect(res.status).toBe(200);
    expect(res.body.photoId).toBeTruthy();
    expect(res.body.storedAt).toBeNull();
    expect(res.body.slug).toMatch(/SCALE_READING/);
    expect(res.body.slug).not.toMatch(/ /); // no spaces in slug
  });

  it('includes SYS{N} suffix in slug when systemNumber is provided', async () => {
    const { visitId, token } = await seedAssignedVisit();
    const res = await request(app)
      .post(`/api/visits/${visitId}/photos`)
      .set('Authorization', `Bearer ${token}`)
      .field('category', 'fan_speed')
      .field('tag', 'FAN_READING')
      .field('systemNumber', '1')
      .attach('photo', Buffer.from('fake'), 'fan.jpg');
    expect(res.status).toBe(200);
    expect(res.body.slug).toMatch(/SYS1/);
  });

  it('returns 400 for invalid photo category', async () => {
    const { visitId, token } = await seedAssignedVisit();
    const res = await request(app)
      .post(`/api/visits/${visitId}/photos`)
      .set('Authorization', `Bearer ${token}`)
      .field('category', 'INVALID')
      .field('tag', 'X')
      .attach('photo', Buffer.from('fake'), 'x.jpg');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid category');
  });

  it('returns 400 when tag is missing', async () => {
    const { visitId, token } = await seedAssignedVisit();
    const res = await request(app)
      .post(`/api/visits/${visitId}/photos`)
      .set('Authorization', `Bearer ${token}`)
      .field('category', 'weigh_in_scale')
      .attach('photo', Buffer.from('fake'), 'x.jpg');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('tag is required');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- --testPathPattern=workspace 2>&1 | tail -20
```

Expected: FAIL — POST /photos returns 404.

- [ ] **Step 3: Add multer and the photos route to `src/routes/workspace.js`**

At the top of `workspace.js`, add the multer import after the existing requires:

```js
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage() });
```

Add `VALID_PHOTO_CATEGORIES` constant immediately after `VALID_CATEGORIES` (the line `const VALID_CATEGORIES = [...]`):

```js
const VALID_PHOTO_CATEGORIES = ['weigh_in_scale', 'fan_speed', 'site_evidence'];
```

Add after the PUT /weigh-in route (before `module.exports`):

```js
// POST /api/visits/:id/photos
router.post(
  '/:id/photos',
  requireRole('technician'),
  requireVisitOwnership,
  upload.single('photo'),
  async (req, res, next) => {
    const { id } = req.params;
    const { category, tag, systemNumber, label } = req.body;
    try {
      if (!VALID_PHOTO_CATEGORIES.includes(category)) {
        return res.status(400).json({ error: 'Invalid category' });
      }
      if (!tag) {
        return res.status(400).json({ error: 'tag is required' });
      }

      const addrRes = await pool.query(
        `SELECT street FROM addresses WHERE id = $1`,
        [req.visit.address_id]
      );
      const street = addrRes.rows[0].street;

      const slugBase = `${street}_${tag}`.toUpperCase().replace(/\s+/g, '_');
      const slug = systemNumber ? `${slugBase}_SYS${systemNumber}` : slugBase;

      const photoRes = await pool.query(
        `INSERT INTO visit_photos (id, visit_id, system_number, slug, tag, label, category, stored_at)
         VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, null) RETURNING id`,
        [id, systemNumber ? parseInt(systemNumber, 10) : null, slug, tag, label ?? null, category]
      );
      const photoId = photoRes.rows[0].id;

      await pool.query(
        `UPDATE visits SET updated_at = $1 WHERE id = $2`,
        [new Date().toISOString(), id]
      );

      res.json({ photoId, slug, storedAt: null });
    } catch (err) {
      next(err);
    }
  }
);
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npm test -- --testPathPattern=workspace 2>&1 | tail -20
```

Expected: all workspace tests pass (23 previous + 4 photos = 27 total).

- [ ] **Step 5: Run full suite and confirm overall pass count**

```bash
npm test 2>&1 | tail -10
```

Expected: all tests pass. Count reflects 6 new pricing unit tests + 27 workspace integration tests added this phase.

- [ ] **Step 6: Commit**

```bash
git add src/routes/workspace.js tests/workspace.test.js
git commit -m "feat: add POST /photos with multer memoryStorage and slug generation"
```
