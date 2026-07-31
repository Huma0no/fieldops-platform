# Phase 3 — Lobby, Assignment & Visit Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add six visit lifecycle endpoints (lobby, claim, mine, start, detail, reassign) behind a two-router `visits.js` file, with full integration test coverage.

**Architecture:** One new file `src/routes/visits.js` exports two routers: `visitsRouter` (mounted at `/api/visits`) and `dispatchVisitsRouter` (mounted at `/api/dispatch/visits`). All SQL is inline in route handlers — no new helper files. `src/index.js` gets two new mount lines.

**Tech Stack:** Node.js, Express, `pg` (PostgreSQL), Jest + Supertest for integration tests.

## Global Constraints

- All PKs are `text` with `DEFAULT gen_random_uuid()::text` — never use SERIAL or uuid type
- All timestamps are ISO 8601 strings — use `new Date().toISOString()`
- Test command: `npm test` (`jest --runInBand`)
- Do not modify `dispatch.js` — all visit lifecycle code lives in `visits.js`
- `GET /mine` must be declared before `GET /:id` in `visitsRouter` to prevent Express param swallowing
- Error messages must match verbatim: `"This visit was just claimed by another technician"`, `"This visit is not assigned to you"`, `"Visit cannot be started — current status: {status}"`, `"Technician not found or inactive"`, `"Visit not found"`

---

### Task 1: Seeds + File Scaffold + `GET /api/visits/lobby`

**Files:**
- Modify: `tests/helpers/seeds.js`
- Create: `src/routes/visits.js`
- Modify: `src/index.js`
- Create: `tests/visits.test.js`

**Interfaces:**
- Produces:
  - `seedTechnicianWithToken({ name? }) → { tech: { id, name, role }, token }`
  - `seedInLobbyVisit({ addressOverrides?, systemCount?, withA2l? }) → { visitId, addressId, street }`
  - `visitsRouter` — Express Router, mounted at `/api/visits`
  - `GET /api/visits/lobby` → `200 []` or `200 [LobbyItem]`

---

- [ ] **Step 1: Add `seedTechnicianWithToken` and `seedInLobbyVisit` to `tests/helpers/seeds.js`**

Append to the bottom of `tests/helpers/seeds.js` (before `module.exports`):

```js
async function seedTechnicianWithToken({ name } = {}) {
  const tech = await seedTech({ role: 'technician', name: name || 'Tech-1' });
  const token = await seedToken(tech.id);
  return { tech, token };
}

async function seedInLobbyVisit({ addressOverrides = {}, systemCount = 1, withA2l = false } = {}) {
  const crypto = require('crypto');
  const street = addressOverrides.street || `${crypto.randomBytes(4).toString('hex')} TEST ST`;
  const addrResult = await pool.query(
    `INSERT INTO addresses (id, street, city, subdivision, builder)
     VALUES (gen_random_uuid()::text, $1, $2, $3, $4) RETURNING id`,
    [
      street,
      addressOverrides.city || 'Houston',
      addressOverrides.subdivision || 'TEST SUB',
      addressOverrides.builder || 'DR HORTON',
    ]
  );
  const addressId = addrResult.rows[0].id;

  const now = new Date().toISOString();
  const visitResult = await pool.query(
    `INSERT INTO visits
       (id, address_id, status, has_multiple_systems, is_deferred, scheduled_time, date, created_at, updated_at)
     VALUES (gen_random_uuid()::text, $1, 'in_lobby', $2, false, $3, $4, $5, $5)
     RETURNING id`,
    [addressId, systemCount > 1, '2026-07-01T09:00:00Z', '2026-07-01', now]
  );
  const visitId = visitResult.rows[0].id;

  let a2lModel = null;
  if (withA2l) {
    a2lModel = `TEST-A2L-${crypto.randomBytes(4).toString('hex')}`;
    await pool.query(
      `INSERT INTO catalog_equipment (model, unit_type, brand, is_a2l)
       VALUES ($1, 'indoor', 'TEST', true)
       ON CONFLICT (model) DO NOTHING`,
      [a2lModel]
    );
  }

  for (let i = 1; i <= systemCount; i++) {
    await pool.query(
      `INSERT INTO visit_systems (id, visit_id, system_number, indoor_model)
       VALUES (gen_random_uuid()::text, $1, $2, $3)`,
      [visitId, i, i === 1 && a2lModel ? a2lModel : null]
    );
  }

  return { visitId, addressId, street };
}
```

Update the `module.exports` line at the bottom:

```js
module.exports = { seedTech, seedToken, seedDispatcherWithToken, seedTechnicianWithToken, seedInLobbyVisit };
```

- [ ] **Step 2: Write failing lobby tests in `tests/visits.test.js`**

Create `tests/visits.test.js`:

```js
const request = require('supertest');
const app = require('../src/index');
const { pool, truncateTables } = require('./helpers/db');
const { seedTechnicianWithToken, seedDispatcherWithToken, seedInLobbyVisit, seedTech, seedToken } = require('./helpers/seeds');

beforeEach(truncateTables);
afterAll(() => pool.end());

// ── GET /api/visits/lobby ────────────────────────────────────────────────────
describe('GET /api/visits/lobby', () => {
  it('returns [] when no in_lobby visits', async () => {
    const { token } = await seedTechnicianWithToken();
    const res = await request(app).get('/api/visits/lobby').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('returns visit with builder tag always present', async () => {
    const { token } = await seedTechnicianWithToken();
    await seedInLobbyVisit();
    const res = await request(app).get('/api/visits/lobby').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    const v = res.body[0];
    expect(v.id).toBeDefined();
    expect(v.address.street).toBeDefined();
    expect(v.hasMultipleSystems).toBe(false);
    expect(v.isDeferred).toBe(false);
    expect(v.tags).toContain('builder');
    expect(v.tags).not.toContain('multiSystem');
    expect(v.tags).not.toContain('a2l');
  });

  it('includes multiSystem tag when has_multiple_systems is true', async () => {
    const { token } = await seedTechnicianWithToken();
    await seedInLobbyVisit({ systemCount: 2 });
    const res = await request(app).get('/api/visits/lobby').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body[0].hasMultipleSystems).toBe(true);
    expect(res.body[0].tags).toContain('multiSystem');
  });

  it('includes a2l tag when visit has a2l equipment', async () => {
    const { token } = await seedTechnicianWithToken();
    await seedInLobbyVisit({ withA2l: true });
    const res = await request(app).get('/api/visits/lobby').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body[0].tags).toContain('a2l');
  });

  it('returns 401 without token', async () => {
    const res = await request(app).get('/api/visits/lobby');
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 3: Run lobby tests to verify they fail**

```bash
npm test -- --testPathPattern=visits
```

Expected: all lobby tests FAIL with `Cannot GET /api/visits/lobby` or route-not-found errors.

- [ ] **Step 4: Create `src/routes/visits.js` with scaffold and lobby route**

```js
const express = require('express');
const { pool } = require('../db/pool');
const { requireRole } = require('../middleware/auth');
const { createNotification } = require('../helpers/notify');

const visitsRouter = express.Router();
const dispatchVisitsRouter = express.Router();

function buildTags(hasMultipleSystems, hasA2l) {
  const tags = ['builder'];
  if (hasMultipleSystems) tags.push('multiSystem');
  if (hasA2l) tags.push('a2l');
  return tags;
}

// GET /api/visits/lobby
visitsRouter.get('/lobby', async (req, res, next) => {
  try {
    const result = await pool.query(`
      SELECT
        v.id,
        v.order_number,
        v.scheduled_time,
        v.has_multiple_systems,
        v.is_deferred,
        a.street,
        a.city,
        a.subdivision,
        a.builder,
        BOOL_OR(ce.is_a2l) AS has_a2l
      FROM visits v
      JOIN addresses a ON a.id = v.address_id
      LEFT JOIN visit_systems vs ON vs.visit_id = v.id
      LEFT JOIN catalog_equipment ce ON ce.model IN (vs.indoor_model, vs.outdoor_model)
      WHERE v.status = 'in_lobby'
      GROUP BY v.id, v.order_number, v.scheduled_time, v.has_multiple_systems, v.is_deferred,
               a.street, a.city, a.subdivision, a.builder
      ORDER BY v.scheduled_time ASC NULLS LAST
    `);

    res.json(result.rows.map((r) => ({
      id: r.id,
      orderNumber: r.order_number,
      scheduledTime: r.scheduled_time,
      address: { street: r.street, city: r.city, subdivision: r.subdivision, builder: r.builder },
      hasMultipleSystems: r.has_multiple_systems,
      isDeferred: r.is_deferred,
      tags: buildTags(r.has_multiple_systems, r.has_a2l === true),
    })));
  } catch (err) {
    next(err);
  }
});

module.exports = { visitsRouter, dispatchVisitsRouter };
```

- [ ] **Step 5: Mount `visitsRouter` in `src/index.js`**

Add after the existing `app.use('/api/addresses', ...)` line:

```js
const { visitsRouter } = require('./routes/visits');
app.use('/api/visits', visitsRouter);
```

- [ ] **Step 6: Run lobby tests to verify they pass**

```bash
npm test -- --testPathPattern=visits
```

Expected: all 5 lobby tests PASS. Full suite: `npm test` — no regressions.

- [ ] **Step 7: Commit**

```bash
git add src/routes/visits.js src/index.js tests/visits.test.js tests/helpers/seeds.js
git commit -m "feat: add GET /api/visits/lobby with seeds and test scaffold"
```

---

### Task 2: `POST /api/visits/:id/claim`

**Files:**
- Modify: `src/routes/visits.js` (add claim route)
- Modify: `tests/visits.test.js` (add claim tests)

**Interfaces:**
- Consumes: `visitsRouter` from Task 1, `requireRole` from auth middleware, `pool`
- Produces: `POST /api/visits/:id/claim` → `200 ClaimResponse | 404 | 409`
  - `ClaimResponse: { id, orderNumber, scheduledTime, technicianId, status, address, hasMultipleSystems, isDeferred, tags }`

---

- [ ] **Step 1: Add claim tests to `tests/visits.test.js`**

Append after the lobby describe block:

```js
// ── POST /api/visits/:id/claim ───────────────────────────────────────────────
describe('POST /api/visits/:id/claim', () => {
  it('assigns visit to technician and returns it', async () => {
    const { tech, token } = await seedTechnicianWithToken();
    const { visitId } = await seedInLobbyVisit();

    const res = await request(app)
      .post(`/api/visits/${visitId}/claim`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(visitId);
    expect(res.body.technicianId).toBe(tech.id);
    expect(res.body.status).toBe('assigned');
    expect(res.body.address.street).toBeDefined();
    expect(res.body.tags).toContain('builder');

    const row = await pool.query('SELECT status, technician_id FROM visits WHERE id = $1', [visitId]);
    expect(row.rows[0].status).toBe('assigned');
    expect(row.rows[0].technician_id).toBe(tech.id);
  });

  it('returns 404 for unknown visit id', async () => {
    const { token } = await seedTechnicianWithToken();
    const res = await request(app)
      .post('/api/visits/nonexistent-id/claim')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Visit not found');
  });

  it('returns 409 when visit already claimed', async () => {
    const { token: tokenA } = await seedTechnicianWithToken({ name: 'Tech-A' });
    const { token: tokenB } = await seedTechnicianWithToken({ name: 'Tech-B' });
    const { visitId } = await seedInLobbyVisit();

    await request(app).post(`/api/visits/${visitId}/claim`).set('Authorization', `Bearer ${tokenA}`);

    const res = await request(app)
      .post(`/api/visits/${visitId}/claim`)
      .set('Authorization', `Bearer ${tokenB}`);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('This visit was just claimed by another technician');
  });

  it('returns 403 for dispatcher role', async () => {
    const { token } = await seedDispatcherWithToken();
    const { visitId } = await seedInLobbyVisit();
    const res = await request(app)
      .post(`/api/visits/${visitId}/claim`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 2: Run claim tests to verify they fail**

```bash
npm test -- --testPathPattern=visits
```

Expected: claim tests FAIL with 404 (route not yet defined). Lobby tests still PASS.

- [ ] **Step 3: Add claim route to `src/routes/visits.js`**

Insert after the lobby route handler, before `module.exports`:

```js
// POST /api/visits/:id/claim
visitsRouter.post('/:id/claim', requireRole('technician'), async (req, res, next) => {
  const { id } = req.params;
  try {
    const preCheck = await pool.query(
      'SELECT status, address_id, has_multiple_systems, is_deferred FROM visits WHERE id = $1',
      [id]
    );
    if (preCheck.rows.length === 0) return res.status(404).json({ error: 'Visit not found' });
    if (preCheck.rows[0].status !== 'in_lobby') {
      return res.status(409).json({ error: 'This visit was just claimed by another technician' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const lockResult = await client.query(
        'SELECT status FROM visits WHERE id = $1 FOR UPDATE',
        [id]
      );
      if (lockResult.rows[0].status !== 'in_lobby') {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'This visit was just claimed by another technician' });
      }

      const now = new Date().toISOString();
      const updateResult = await client.query(
        `UPDATE visits SET status = 'assigned', technician_id = $1, updated_at = $2
         WHERE id = $3 AND status = 'in_lobby'
         RETURNING id, order_number, scheduled_time, has_multiple_systems, is_deferred, technician_id, address_id`,
        [req.technician.id, now, id]
      );
      if (updateResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'This visit was just claimed by another technician' });
      }
      await client.query('COMMIT');

      const v = updateResult.rows[0];
      const addrResult = await pool.query(
        'SELECT street, city, subdivision, builder FROM addresses WHERE id = $1',
        [v.address_id]
      );
      const a = addrResult.rows[0];

      res.json({
        id: v.id,
        orderNumber: v.order_number,
        scheduledTime: v.scheduled_time,
        technicianId: v.technician_id,
        status: 'assigned',
        address: { street: a.street, city: a.city, subdivision: a.subdivision, builder: a.builder },
        hasMultipleSystems: v.has_multiple_systems,
        isDeferred: v.is_deferred,
        tags: buildTags(v.has_multiple_systems, false),
      });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    next(err);
  }
});
```

- [ ] **Step 4: Run claim tests to verify they pass**

```bash
npm test -- --testPathPattern=visits
```

Expected: all claim tests PASS. Full suite: `npm test` — no regressions.

- [ ] **Step 5: Commit**

```bash
git add src/routes/visits.js tests/visits.test.js
git commit -m "feat: add POST /api/visits/:id/claim with FOR UPDATE transaction"
```

---

### Task 3: `GET /api/visits/mine`

**Files:**
- Modify: `src/routes/visits.js` (add mine route — MUST appear before the `/:id` GET)
- Modify: `tests/visits.test.js` (add mine tests)

**Interfaces:**
- Consumes: `visitsRouter`, `requireRole('technician')`, `pool`
- Produces: `GET /api/visits/mine` → `200 MineItem[]`
  - `MineItem` extends lobby shape with `status` and `technicianId`

---

- [ ] **Step 1: Add mine tests to `tests/visits.test.js`**

Append after the claim describe block:

```js
// ── GET /api/visits/mine ─────────────────────────────────────────────────────
describe('GET /api/visits/mine', () => {
  it('returns assigned visits for the authenticated technician', async () => {
    const { tech, token } = await seedTechnicianWithToken();
    const { visitId } = await seedInLobbyVisit();
    await request(app).post(`/api/visits/${visitId}/claim`).set('Authorization', `Bearer ${token}`);

    const res = await request(app).get('/api/visits/mine').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    const v = res.body[0];
    expect(v.id).toBe(visitId);
    expect(v.technicianId).toBe(tech.id);
    expect(v.status).toBe('assigned');
    expect(v.address.street).toBeDefined();
    expect(v.tags).toContain('builder');
  });

  it('excludes visits assigned to other technicians', async () => {
    const { token: tokenA } = await seedTechnicianWithToken({ name: 'Tech-A' });
    const { token: tokenB } = await seedTechnicianWithToken({ name: 'Tech-B' });
    const { visitId } = await seedInLobbyVisit();
    await request(app).post(`/api/visits/${visitId}/claim`).set('Authorization', `Bearer ${tokenA}`);

    const res = await request(app).get('/api/visits/mine').set('Authorization', `Bearer ${tokenB}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(0);
  });

  it('returns deferred visits before non-deferred visits', async () => {
    const { token } = await seedTechnicianWithToken();
    const { visitId: idA } = await seedInLobbyVisit();
    const { visitId: idB } = await seedInLobbyVisit();
    await request(app).post(`/api/visits/${idA}/claim`).set('Authorization', `Bearer ${token}`);
    await request(app).post(`/api/visits/${idB}/claim`).set('Authorization', `Bearer ${token}`);
    await pool.query('UPDATE visits SET is_deferred = true WHERE id = $1', [idB]);

    const res = await request(app).get('/api/visits/mine').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body[0].id).toBe(idB);
    expect(res.body[0].isDeferred).toBe(true);
    expect(res.body[1].id).toBe(idA);
  });

  it('returns 403 for dispatcher role', async () => {
    const { token } = await seedDispatcherWithToken();
    const res = await request(app).get('/api/visits/mine').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 2: Run mine tests to verify they fail**

```bash
npm test -- --testPathPattern=visits
```

Expected: mine tests FAIL. All previous tests still PASS.

- [ ] **Step 3: Add mine route to `src/routes/visits.js`**

Insert after the claim route, **before any `/:id` GET route** (currently just before `module.exports`):

```js
// GET /api/visits/mine — declared before /:id to prevent param capture
visitsRouter.get('/mine', requireRole('technician'), async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT v.id, v.order_number, v.scheduled_time, v.has_multiple_systems,
              v.is_deferred, v.status, v.technician_id,
              a.street, a.city, a.subdivision, a.builder
       FROM visits v
       JOIN addresses a ON a.id = v.address_id
       WHERE v.technician_id = $1
         AND v.status IN ('assigned', 'in_progress', 'temporarily')
       ORDER BY v.is_deferred DESC, v.scheduled_time ASC NULLS LAST`,
      [req.technician.id]
    );

    res.json(result.rows.map((r) => ({
      id: r.id,
      orderNumber: r.order_number,
      scheduledTime: r.scheduled_time,
      technicianId: r.technician_id,
      status: r.status,
      address: { street: r.street, city: r.city, subdivision: r.subdivision, builder: r.builder },
      hasMultipleSystems: r.has_multiple_systems,
      isDeferred: r.is_deferred,
      tags: buildTags(r.has_multiple_systems, false),
    })));
  } catch (err) {
    next(err);
  }
});
```

- [ ] **Step 4: Run mine tests to verify they pass**

```bash
npm test -- --testPathPattern=visits
```

Expected: all mine tests PASS. Full suite: `npm test` — no regressions.

- [ ] **Step 5: Commit**

```bash
git add src/routes/visits.js tests/visits.test.js
git commit -m "feat: add GET /api/visits/mine with deferred-first ordering"
```

---

### Task 4: `POST /api/visits/:id/start`

**Files:**
- Modify: `src/routes/visits.js` (add start route)
- Modify: `tests/visits.test.js` (add start tests)

**Interfaces:**
- Consumes: `visitsRouter`, `requireRole('technician')`, `pool`
- Produces: `POST /api/visits/:id/start` → `200 { id, status: 'in_progress' } | 403 | 400 | 404`

---

- [ ] **Step 1: Add start tests to `tests/visits.test.js`**

Append after the mine describe block:

```js
// ── POST /api/visits/:id/start ───────────────────────────────────────────────
describe('POST /api/visits/:id/start', () => {
  it('transitions assigned visit to in_progress', async () => {
    const { token } = await seedTechnicianWithToken();
    const { visitId } = await seedInLobbyVisit();
    await request(app).post(`/api/visits/${visitId}/claim`).set('Authorization', `Bearer ${token}`);

    const res = await request(app)
      .post(`/api/visits/${visitId}/start`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: visitId, status: 'in_progress' });

    const row = await pool.query('SELECT status FROM visits WHERE id = $1', [visitId]);
    expect(row.rows[0].status).toBe('in_progress');
  });

  it('returns 403 if wrong technician tries to start', async () => {
    const { token: tokenA } = await seedTechnicianWithToken({ name: 'Tech-A' });
    const { token: tokenB } = await seedTechnicianWithToken({ name: 'Tech-B' });
    const { visitId } = await seedInLobbyVisit();
    await request(app).post(`/api/visits/${visitId}/claim`).set('Authorization', `Bearer ${tokenA}`);

    const res = await request(app)
      .post(`/api/visits/${visitId}/start`)
      .set('Authorization', `Bearer ${tokenB}`);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('This visit is not assigned to you');
  });

  it('returns 400 if visit is not in assigned status', async () => {
    const { token } = await seedTechnicianWithToken();
    const { visitId } = await seedInLobbyVisit();
    await request(app).post(`/api/visits/${visitId}/claim`).set('Authorization', `Bearer ${token}`);
    await request(app).post(`/api/visits/${visitId}/start`).set('Authorization', `Bearer ${token}`);

    const res = await request(app)
      .post(`/api/visits/${visitId}/start`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Visit cannot be started — current status: in_progress');
  });

  it('returns 404 for unknown visit', async () => {
    const { token } = await seedTechnicianWithToken();
    const res = await request(app)
      .post('/api/visits/nonexistent-id/start')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run start tests to verify they fail**

```bash
npm test -- --testPathPattern=visits
```

Expected: start tests FAIL. All previous tests still PASS.

- [ ] **Step 3: Add start route to `src/routes/visits.js`**

Insert after the mine route, still before `module.exports`:

```js
// POST /api/visits/:id/start
visitsRouter.post('/:id/start', requireRole('technician'), async (req, res, next) => {
  const { id } = req.params;
  try {
    const result = await pool.query(
      'SELECT status, technician_id FROM visits WHERE id = $1',
      [id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Visit not found' });
    const visit = result.rows[0];

    if (visit.technician_id !== req.technician.id) {
      return res.status(403).json({ error: 'This visit is not assigned to you' });
    }
    if (visit.status !== 'assigned') {
      return res.status(400).json({ error: `Visit cannot be started — current status: ${visit.status}` });
    }

    const now = new Date().toISOString();
    await pool.query(
      `UPDATE visits SET status = 'in_progress', updated_at = $1 WHERE id = $2`,
      [now, id]
    );

    res.json({ id, status: 'in_progress' });
  } catch (err) {
    next(err);
  }
});
```

- [ ] **Step 4: Run start tests to verify they pass**

```bash
npm test -- --testPathPattern=visits
```

Expected: all start tests PASS. Full suite: `npm test` — no regressions.

- [ ] **Step 5: Commit**

```bash
git add src/routes/visits.js tests/visits.test.js
git commit -m "feat: add POST /api/visits/:id/start"
```

---

### Task 5: `GET /api/visits/:id`

**Files:**
- Modify: `src/routes/visits.js` (add detail route — this is the `/:id` GET, must come after `/mine`)
- Modify: `tests/visits.test.js` (add detail tests)

**Interfaces:**
- Consumes: `visitsRouter`, `pool`
- Produces: `GET /api/visits/:id` → `200 DetailResponse | 403 | 404`
  - `DetailResponse: { id, orderNumber, scheduledTime, status, technicianId, hasMultipleSystems, isDeferred, address: { street, city, state, zip, subdivision, builder }, systems: [...], services: [...], items: [...], photos: [...] }`

---

- [ ] **Step 1: Add detail tests to `tests/visits.test.js`**

Append after the start describe block:

```js
// ── GET /api/visits/:id ──────────────────────────────────────────────────────
describe('GET /api/visits/:id', () => {
  it('returns full visit detail with nested arrays', async () => {
    const { token } = await seedTechnicianWithToken();
    const { visitId } = await seedInLobbyVisit({ systemCount: 1 });
    await request(app).post(`/api/visits/${visitId}/claim`).set('Authorization', `Bearer ${token}`);

    const res = await request(app)
      .get(`/api/visits/${visitId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    const v = res.body;
    expect(v.id).toBe(visitId);
    expect(v.status).toBe('assigned');
    expect(v.address.street).toBeDefined();
    expect(v.address.city).toBeDefined();
    expect(Array.isArray(v.systems)).toBe(true);
    expect(v.systems).toHaveLength(1);
    expect(v.systems[0].systemNumber).toBe(1);
    expect(Array.isArray(v.services)).toBe(true);
    expect(Array.isArray(v.items)).toBe(true);
    expect(Array.isArray(v.photos)).toBe(true);
  });

  it('returns 403 if technician does not own the visit', async () => {
    const { token: tokenA } = await seedTechnicianWithToken({ name: 'Tech-A' });
    const { token: tokenB } = await seedTechnicianWithToken({ name: 'Tech-B' });
    const { visitId } = await seedInLobbyVisit();
    await request(app).post(`/api/visits/${visitId}/claim`).set('Authorization', `Bearer ${tokenA}`);

    const res = await request(app)
      .get(`/api/visits/${visitId}`)
      .set('Authorization', `Bearer ${tokenB}`);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('This visit is not assigned to you');
  });

  it('dispatcher can view any visit regardless of assignment', async () => {
    const { token: techToken } = await seedTechnicianWithToken();
    const { token: dispToken } = await seedDispatcherWithToken();
    const { visitId } = await seedInLobbyVisit();
    await request(app).post(`/api/visits/${visitId}/claim`).set('Authorization', `Bearer ${techToken}`);

    const res = await request(app)
      .get(`/api/visits/${visitId}`)
      .set('Authorization', `Bearer ${dispToken}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(visitId);
  });

  it('returns 404 for unknown visit', async () => {
    const { token } = await seedTechnicianWithToken();
    const res = await request(app)
      .get('/api/visits/nonexistent-id')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run detail tests to verify they fail**

```bash
npm test -- --testPathPattern=visits
```

Expected: detail tests FAIL. All previous tests still PASS.

- [ ] **Step 3: Add detail route to `src/routes/visits.js`**

Insert after the start route, before `module.exports`. This is the `/:id` GET — it must come after `/mine`:

```js
// GET /api/visits/:id — declared after /mine to avoid param capture
visitsRouter.get('/:id', async (req, res, next) => {
  const { id } = req.params;
  try {
    const visitResult = await pool.query(
      `SELECT v.id, v.order_number, v.scheduled_time, v.status, v.technician_id,
              v.has_multiple_systems, v.is_deferred,
              a.street, a.city, a.state, a.zip, a.subdivision, a.builder
       FROM visits v
       JOIN addresses a ON a.id = v.address_id
       WHERE v.id = $1`,
      [id]
    );
    if (visitResult.rows.length === 0) return res.status(404).json({ error: 'Visit not found' });
    const v = visitResult.rows[0];

    if (req.technician.role === 'technician' && v.technician_id !== req.technician.id) {
      return res.status(403).json({ error: 'This visit is not assigned to you' });
    }

    const [systems, services, items, photos] = await Promise.all([
      pool.query(
        'SELECT system_number, indoor_model, outdoor_model, refrigerant FROM visit_systems WHERE visit_id = $1 ORDER BY system_number',
        [id]
      ),
      pool.query(
        'SELECT service_name, is_finish, is_temporarily, price FROM visit_services WHERE visit_id = $1',
        [id]
      ),
      pool.query(
        'SELECT category, item_name, quantity, price, tech_supplied FROM visit_items WHERE visit_id = $1',
        [id]
      ),
      pool.query(
        'SELECT id, tag, label, category, system_number, stored_at FROM visit_photos WHERE visit_id = $1',
        [id]
      ),
    ]);

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
```

- [ ] **Step 4: Run detail tests to verify they pass**

```bash
npm test -- --testPathPattern=visits
```

Expected: all detail tests PASS. Full suite: `npm test` — no regressions.

- [ ] **Step 5: Commit**

```bash
git add src/routes/visits.js tests/visits.test.js
git commit -m "feat: add GET /api/visits/:id with full nested detail"
```

---

### Task 6: `PATCH /api/dispatch/visits/:id/reassign`

**Files:**
- Modify: `src/routes/visits.js` (add reassign route to `dispatchVisitsRouter`)
- Modify: `src/index.js` (mount `dispatchVisitsRouter`)
- Modify: `tests/visits.test.js` (add reassign tests)

**Interfaces:**
- Consumes: `dispatchVisitsRouter`, `requireRole('owner', 'dispatcher')`, `pool`, `createNotification`
- Produces: `PATCH /api/dispatch/visits/:id/reassign` → `200 { id, technicianId, status } | 400 | 404 | 403`

---

- [ ] **Step 1: Add reassign tests to `tests/visits.test.js`**

Append after the detail describe block:

```js
// ── PATCH /api/dispatch/visits/:id/reassign ──────────────────────────────────
describe('PATCH /api/dispatch/visits/:id/reassign', () => {
  it('reassigns in_lobby visit to technician and creates notification', async () => {
    const { token: dispToken } = await seedDispatcherWithToken();
    const { tech } = await seedTechnicianWithToken();
    const { visitId } = await seedInLobbyVisit();

    const res = await request(app)
      .patch(`/api/dispatch/visits/${visitId}/reassign`)
      .set('Authorization', `Bearer ${dispToken}`)
      .send({ technicianId: tech.id });

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(visitId);
    expect(res.body.technicianId).toBe(tech.id);
    expect(res.body.status).toBe('assigned');

    const notif = await pool.query(
      `SELECT * FROM notifications WHERE recipient_id = $1 AND type = 'visit_assigned'`,
      [tech.id]
    );
    expect(notif.rows).toHaveLength(1);
    expect(notif.rows[0].body).toMatch(/assigned to/);
  });

  it('sets status to assigned when visit was in_lobby', async () => {
    const { token: dispToken } = await seedDispatcherWithToken();
    const { tech } = await seedTechnicianWithToken();
    const { visitId } = await seedInLobbyVisit();

    await request(app)
      .patch(`/api/dispatch/visits/${visitId}/reassign`)
      .set('Authorization', `Bearer ${dispToken}`)
      .send({ technicianId: tech.id });

    const row = await pool.query('SELECT status FROM visits WHERE id = $1', [visitId]);
    expect(row.rows[0].status).toBe('assigned');
  });

  it('leaves status unchanged when visit is in_progress', async () => {
    const { token: dispToken } = await seedDispatcherWithToken();
    const { tech: techA, token: tokenA } = await seedTechnicianWithToken({ name: 'Tech-A' });
    const { tech: techB } = await seedTechnicianWithToken({ name: 'Tech-B' });
    const { visitId } = await seedInLobbyVisit();
    await request(app).post(`/api/visits/${visitId}/claim`).set('Authorization', `Bearer ${tokenA}`);
    await request(app).post(`/api/visits/${visitId}/start`).set('Authorization', `Bearer ${tokenA}`);

    const res = await request(app)
      .patch(`/api/dispatch/visits/${visitId}/reassign`)
      .set('Authorization', `Bearer ${dispToken}`)
      .send({ technicianId: techB.id });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('in_progress');

    const row = await pool.query('SELECT status FROM visits WHERE id = $1', [visitId]);
    expect(row.rows[0].status).toBe('in_progress');
  });

  it('returns 400 for inactive technician', async () => {
    const { token: dispToken } = await seedDispatcherWithToken();
    const inactive = await seedTech({ role: 'technician', name: 'Inactive', isActive: false });
    const { visitId } = await seedInLobbyVisit();

    const res = await request(app)
      .patch(`/api/dispatch/visits/${visitId}/reassign`)
      .set('Authorization', `Bearer ${dispToken}`)
      .send({ technicianId: inactive.id });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Technician not found or inactive');
  });

  it('returns 404 for unknown visit', async () => {
    const { token: dispToken } = await seedDispatcherWithToken();
    const { tech } = await seedTechnicianWithToken();

    const res = await request(app)
      .patch('/api/dispatch/visits/nonexistent-id/reassign')
      .set('Authorization', `Bearer ${dispToken}`)
      .send({ technicianId: tech.id });

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Visit not found');
  });

  it('returns 403 for technician role', async () => {
    const { tech, token: techToken } = await seedTechnicianWithToken();
    const { visitId } = await seedInLobbyVisit();

    const res = await request(app)
      .patch(`/api/dispatch/visits/${visitId}/reassign`)
      .set('Authorization', `Bearer ${techToken}`)
      .send({ technicianId: tech.id });

    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 2: Run reassign tests to verify they fail**

```bash
npm test -- --testPathPattern=visits
```

Expected: reassign tests FAIL with 404 (route not mounted). All previous tests still PASS.

- [ ] **Step 3: Add reassign route to `dispatchVisitsRouter` in `src/routes/visits.js`**

Insert after the `/:id` GET route, before `module.exports`:

```js
// PATCH /api/dispatch/visits/:id/reassign
dispatchVisitsRouter.patch('/:id/reassign', requireRole('owner', 'dispatcher'), async (req, res, next) => {
  const { id } = req.params;
  const { technicianId } = req.body;
  try {
    const visitResult = await pool.query(
      `SELECT v.id, v.status, a.street
       FROM visits v
       JOIN addresses a ON a.id = v.address_id
       WHERE v.id = $1`,
      [id]
    );
    if (visitResult.rows.length === 0) return res.status(404).json({ error: 'Visit not found' });
    const visit = visitResult.rows[0];

    const techResult = await pool.query(
      'SELECT id FROM technicians WHERE id = $1 AND is_active = true',
      [technicianId]
    );
    if (techResult.rows.length === 0) {
      return res.status(400).json({ error: 'Technician not found or inactive' });
    }

    const now = new Date().toISOString();
    const updateResult = await pool.query(
      `UPDATE visits
       SET technician_id = $1,
           status = CASE WHEN status = 'in_lobby' THEN 'assigned' ELSE status END,
           updated_at = $2
       WHERE id = $3
       RETURNING status`,
      [technicianId, now, id]
    );
    const newStatus = updateResult.rows[0].status;

    await createNotification(pool, {
      recipientId: technicianId,
      type: 'visit_assigned',
      message: `You have been assigned to ${visit.street}`,
    });

    res.json({ id, technicianId, status: newStatus });
  } catch (err) {
    next(err);
  }
});
```

- [ ] **Step 4: Mount `dispatchVisitsRouter` in `src/index.js`**

Update the visits import and add the second mount. The current line added in Task 1 is:

```js
const { visitsRouter } = require('./routes/visits');
app.use('/api/visits', visitsRouter);
```

Replace with:

```js
const { visitsRouter, dispatchVisitsRouter } = require('./routes/visits');
app.use('/api/visits', visitsRouter);
app.use('/api/dispatch/visits', dispatchVisitsRouter);
```

- [ ] **Step 5: Run reassign tests to verify they pass**

```bash
npm test -- --testPathPattern=visits
```

Expected: all reassign tests PASS.

- [ ] **Step 6: Run full test suite**

```bash
npm test
```

Expected: all tests across all files pass, no regressions.

- [ ] **Step 7: Commit**

```bash
git add src/routes/visits.js src/index.js tests/visits.test.js
git commit -m "feat: add PATCH /api/dispatch/visits/:id/reassign with notification"
```

---

## Self-Review

**Spec coverage check:**

| Requirement | Task |
|---|---|
| `GET /api/visits/lobby` — in_lobby visits, joined addresses, a2l/multiSystem/builder tags | Task 1 |
| `POST /api/visits/:id/claim` — FOR UPDATE transaction, 409 on race | Task 2 |
| `GET /api/visits/mine` — deferred first, status filter | Task 3 |
| `POST /api/visits/:id/start` — ownership + status checks | Task 4 |
| `GET /api/visits/:id` — 5-query detail, tech ownership check | Task 5 |
| `PATCH /api/dispatch/visits/:id/reassign` — conditional status, notification | Task 6 |
| Two-router export, separate mounts | Tasks 1 + 6 |
| `GET /mine` declared before `GET /:id` | Tasks 3 + 5 (same file, order enforced) |
| `seedTechnicianWithToken`, `seedInLobbyVisit` added to seeds.js | Task 1 |

**Placeholder scan:** None found. All steps contain complete code.

**Type consistency:**
- `buildTags(hasMultipleSystems, hasA2l)` — used consistently in lobby, claim, and mine routes
- `seedInLobbyVisit` returns `{ visitId, addressId, street }` — only `visitId` is used in tests (consistent)
- `createNotification(pool, { recipientId, type, message })` — matches `helpers/notify.js` signature exactly
- `requireRole('owner', 'dispatcher')` on reassign — matches auth middleware signature
