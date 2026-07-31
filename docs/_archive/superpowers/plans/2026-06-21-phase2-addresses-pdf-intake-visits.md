# Phase 2: Addresses + PDF Intake → Visits Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the PDF batch intake pipeline, address deduplication, and visit creation — the dispatcher's primary daily workflow.

**Architecture:** Three layers: a utility layer (`src/services/ai.js`, `src/helpers/address.js`, `src/helpers/visit.js`) that is tested independently; a dispatch router (`src/routes/dispatch.js`) that orchestrates the batch state machine; and an address router (`src/routes/addresses.js`) that handles near-match resolution. The in-memory `batchCallsCache` Map is intentional and lives in dispatch.js — the AI stub ignores PDF content, so all call data exists only in memory until visits are confirmed.

**Tech Stack:** Node.js, Express 4, pg (Pool), multer (memory storage), Jest + Supertest.

## Global Constraints

- All PKs: `text` with `DEFAULT gen_random_uuid()::text` (JS inserts use `gen_random_uuid()::text` in SQL or `crypto.randomUUID()`)
- All timestamps: ISO 8601 `text` strings via `new Date().toISOString()` — no PostgreSQL timestamp types
- Error shape: `{ error: "Human-readable message" }`
- Do NOT modify `src/db/schema.sql`, `src/middleware/auth.js`, or any existing route file
- Street normalization: `street.trim().toUpperCase()` — no abbreviation expansion needed (all canonical already)
- Near-match threshold: same first 6 chars of normalized street AND same zip AND not an exact match
- `visit_systems`: one row per system, `system_number` starts at 1, `indoor_model`/`outdoor_model` = null
- Today's date for deferred detection: `new Date().toISOString().slice(0, 10)` (YYYY-MM-DD, first 10 chars)
- `has_multiple_systems = systemCount > 1` (defaults to 1 if omitted)
- `batch_id = null` for manual visits
- Mount order in index.js: `/api/dispatch/technicians` BEFORE `/api/dispatch` (prevents technician routes from being shadowed)

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src/db/migrations/002_visits_updated_at_deferred.sql` | Create | Adds `is_deferred` column; `updated_at` guard (already exists from Phase 1) |
| `src/services/ai.js` | Create | Stub returning 2 hardcoded extracted calls |
| `src/helpers/address.js` | Create | `normalizeStreet`, `findNearMatch`, `findOrCreateAddress` |
| `src/helpers/visit.js` | Create | `createVisitWithSystems(pool, opts)` |
| `src/routes/dispatch.js` | Create | parse-pdf, batch state machine (call/:index, confirm, skip, release-to-lobby), create-manual |
| `src/routes/addresses.js` | Create | `POST /api/addresses/:id/resolve-comparison` |
| `src/index.js` | Modify | Mount dispatch + addresses routers |
| `tests/helpers/db.js` | Modify | Expand `truncateTables` to cover new tables |
| `tests/helpers/seeds.js` | Create | Shared seed helpers used across Phase 2 tests |
| `tests/dispatch.test.js` | Create | Integration tests for all dispatch endpoints |
| `tests/addresses.test.js` | Create | Integration tests for resolve-comparison |

---

## Task 1: Migration + Test Infrastructure

**Files:**
- Create: `src/db/migrations/002_visits_updated_at_deferred.sql`
- Modify: `tests/helpers/db.js`
- Modify: `package.json`

**Interfaces:**
- Produces: `is_deferred` column on `visits`; expanded `truncateTables()` that covers `visit_systems`, `addresses`, `pdf_batches`

- [ ] **Step 1: Create the migration file**

Create `src/db/migrations/002_visits_updated_at_deferred.sql`:
```sql
ALTER TABLE visits ADD COLUMN IF NOT EXISTS updated_at TEXT;
ALTER TABLE visits ADD COLUMN IF NOT EXISTS is_deferred BOOLEAN NOT NULL DEFAULT FALSE;
```

- [ ] **Step 2: Run the migration**

```bash
psql $DATABASE_URL -f src/db/migrations/002_visits_updated_at_deferred.sql
```

Expected output:
```
ALTER TABLE
ALTER TABLE
```

- [ ] **Step 3: Install multer**

```bash
npm install multer
```

Expected: multer appears in `dependencies` in `package.json`.

- [ ] **Step 4: Expand `truncateTables` in `tests/helpers/db.js`**

Replace the entire file with:
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
    DELETE FROM visits;
    DELETE FROM addresses;
    DELETE FROM pdf_batches;
    DELETE FROM technicians;
  `);
}

module.exports = { pool, truncateTables };
```

> FK deletion order: child rows before parent rows. `visit_photos`, `weigh_in_data`, `visit_items`, `visit_services`, `visit_systems` all reference `visits`. `visits` references `addresses` and `pdf_batches`.

- [ ] **Step 5: Update `package.json` scripts**

Add to the `"scripts"` block:
```json
"db:migrate2": "psql $DATABASE_URL -f src/db/migrations/002_visits_updated_at_deferred.sql"
```

- [ ] **Step 6: Verify existing tests still pass**

```bash
npx jest --no-coverage --runInBand
```

Expected: all 24 tests pass (truncateTables now runs more DELETEs but touches no new data in existing tests).

- [ ] **Step 7: Commit**

```bash
git add src/db/migrations/002_visits_updated_at_deferred.sql tests/helpers/db.js package.json package-lock.json
git commit -m "chore: add is_deferred migration, expand truncateTables, install multer"
```

---

## Task 2: AI Stub + Address Helper + Visit Helper

**Files:**
- Create: `src/services/ai.js`
- Create: `src/helpers/address.js`
- Create: `src/helpers/visit.js`
- Create: `tests/helpers/seeds.js`
- Create: `tests/unit.test.js`

**Interfaces:**
- Produces:
  - `extractCallsFromPDF(buffer)` → `Promise<Array<CallObject>>` where CallObject = `{ orderNumber, address, city, state, zip, subdivision, builder, scheduledTime, workType, systemCount, notes }`
  - `normalizeStreet(street)` → `string`
  - `findNearMatch(pool, normalizedStreet, zip)` → `Promise<AddressRow | null>`
  - `findOrCreateAddress(pool, { street, city, state, zip, subdivision, builder })` → `Promise<{ address: AddressRow | null, nearMatch: AddressRow | null }>`
  - `createVisitWithSystems(pool, { addressId, batchId, orderNumber, scheduledTime, workType, systemCount, notes })` → `Promise<{ visitId: string }>`
  - Shared seeds in `tests/helpers/seeds.js`: `seedDispatcher()`, `seedToken(techId)`, `seedDispatcherWithToken()`

- [ ] **Step 1: Create `src/services/ai.js`**

```javascript
async function extractCallsFromPDF(pdfBuffer) {
  return [
    {
      orderNumber: 'ORD-001',
      address: '123 MAPLE ST',
      city: 'HOUSTON',
      state: 'TX',
      zip: '77001',
      subdivision: 'MAPLE GROVE',
      builder: 'DR HORTON',
      scheduledTime: new Date().toISOString(),
      workType: 'AC',
      systemCount: 1,
      notes: null,
    },
    {
      orderNumber: 'ORD-002',
      address: '456 OAK AVE',
      city: 'HOUSTON',
      state: 'TX',
      zip: '77002',
      subdivision: 'OAK HILLS',
      builder: 'LENNAR',
      scheduledTime: new Date().toISOString(),
      workType: 'Heat',
      systemCount: 2,
      notes: null,
    },
  ];
}

module.exports = { extractCallsFromPDF };
```

- [ ] **Step 2: Create `src/helpers/address.js`**

```javascript
const { pool: defaultPool } = require('../db/pool');

function normalizeStreet(street) {
  return street.trim().toUpperCase();
}

async function findNearMatch(pool, normalizedStreet, zip) {
  const result = await pool.query(
    `SELECT * FROM addresses
     WHERE LEFT(street, 6) = LEFT($1, 6)
       AND zip = $2
       AND street != $1
     LIMIT 1`,
    [normalizedStreet, zip || '']
  );
  return result.rows[0] || null;
}

async function findOrCreateAddress(pool, { street, city, state, zip, subdivision, builder }) {
  const normalized = normalizeStreet(street);

  // 1. Exact match
  const exact = await pool.query('SELECT * FROM addresses WHERE street = $1', [normalized]);
  if (exact.rows.length > 0) {
    return { address: exact.rows[0], nearMatch: null };
  }

  // 2. Near match
  const near = await findNearMatch(pool, normalized, zip);
  if (near) {
    return { address: null, nearMatch: near };
  }

  // 3. Insert (ON CONFLICT in case of race — returns existing row)
  const insertResult = await pool.query(
    `INSERT INTO addresses (id, street, city, state, zip, subdivision, builder)
     VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6)
     ON CONFLICT (street) DO NOTHING
     RETURNING *`,
    [normalized, city || null, state || null, zip || null, subdivision || null, builder || null]
  );

  if (insertResult.rows.length > 0) {
    return { address: insertResult.rows[0], nearMatch: null };
  }

  // Race-condition fallback: another process inserted the same street
  const fallback = await pool.query('SELECT * FROM addresses WHERE street = $1', [normalized]);
  return { address: fallback.rows[0], nearMatch: null };
}

module.exports = { normalizeStreet, findNearMatch, findOrCreateAddress };
```

- [ ] **Step 3: Create `src/helpers/visit.js`**

```javascript
async function createVisitWithSystems(pool, { addressId, batchId, orderNumber, scheduledTime, workType, systemCount, notes }) {
  const now = new Date().toISOString();
  const count = systemCount || 1;
  const hasMultipleSystems = count > 1;
  const date = scheduledTime ? scheduledTime.slice(0, 10) : null;

  const visitResult = await pool.query(
    `INSERT INTO visits
       (id, address_id, batch_id, order_number, status, has_multiple_systems, is_deferred,
        scheduled_time, date, work_type, notes, created_at, updated_at)
     VALUES (gen_random_uuid()::text, $1, $2, $3, 'pending_review', $4, false,
             $5, $6, $7, $8, $9, $9)
     RETURNING id`,
    [addressId, batchId || null, orderNumber || null, hasMultipleSystems,
     scheduledTime || null, date, workType || null, notes || null, now]
  );

  const visitId = visitResult.rows[0].id;

  for (let i = 1; i <= count; i++) {
    await pool.query(
      `INSERT INTO visit_systems (id, visit_id, system_number)
       VALUES (gen_random_uuid()::text, $1, $2)`,
      [visitId, i]
    );
  }

  return { visitId };
}

module.exports = { createVisitWithSystems };
```

- [ ] **Step 4: Create shared seeds file `tests/helpers/seeds.js`**

```javascript
const crypto = require('crypto');
const { pool } = require('./db');

async function seedTech({ role = 'technician', name, isActive = true } = {}) {
  const techName = name || `Tech-${role}`;
  const r = await pool.query(
    `INSERT INTO technicians (id, name, role, is_active, created_at)
     VALUES (gen_random_uuid()::text, $1, $2, $3, $4)
     RETURNING id, name, role`,
    [techName, role, isActive, new Date().toISOString()]
  );
  return r.rows[0];
}

async function seedToken(technicianId) {
  const token = crypto.randomBytes(32).toString('hex');
  await pool.query(
    'INSERT INTO device_tokens (token, technician_id, created_at) VALUES ($1, $2, $3)',
    [token, technicianId, new Date().toISOString()]
  );
  return token;
}

async function seedDispatcherWithToken() {
  const dispatcher = await seedTech({ role: 'dispatcher', name: 'Dispatcher' });
  const token = await seedToken(dispatcher.id);
  return { dispatcher, token };
}

module.exports = { seedTech, seedToken, seedDispatcherWithToken };
```

- [ ] **Step 5: Write failing tests for the utility layer**

Create `tests/unit.test.js`:
```javascript
const { pool, truncateTables } = require('./helpers/db');
const { extractCallsFromPDF } = require('../src/services/ai');
const { normalizeStreet, findNearMatch, findOrCreateAddress } = require('../src/helpers/address');
const { createVisitWithSystems } = require('../src/helpers/visit');

beforeEach(truncateTables);
afterAll(() => pool.end());

// ── ai.js ────────────────────────────────────────────────────────────────────
describe('extractCallsFromPDF', () => {
  it('returns 2 calls regardless of buffer content', async () => {
    const calls = await extractCallsFromPDF(Buffer.from('anything'));
    expect(calls).toHaveLength(2);
    expect(calls[0].orderNumber).toBe('ORD-001');
    expect(calls[1].orderNumber).toBe('ORD-002');
  });

  it('each call has all required fields', async () => {
    const calls = await extractCallsFromPDF(Buffer.from(''));
    for (const call of calls) {
      expect(call).toHaveProperty('orderNumber');
      expect(call).toHaveProperty('address');
      expect(call).toHaveProperty('city');
      expect(call).toHaveProperty('state');
      expect(call).toHaveProperty('zip');
      expect(call).toHaveProperty('subdivision');
      expect(call).toHaveProperty('builder');
      expect(call).toHaveProperty('scheduledTime');
      expect(call).toHaveProperty('workType');
      expect(call).toHaveProperty('systemCount');
      expect(call).toHaveProperty('notes');
    }
  });
});

// ── address.js ───────────────────────────────────────────────────────────────
describe('normalizeStreet', () => {
  it('uppercases and trims', () => {
    expect(normalizeStreet('  123 maple st  ')).toBe('123 MAPLE ST');
  });

  it('is idempotent on already-normalized input', () => {
    expect(normalizeStreet('456 OAK AVE')).toBe('456 OAK AVE');
  });
});

describe('findNearMatch', () => {
  it('returns null when no addresses exist', async () => {
    const match = await findNearMatch(pool, '123 MAPLE ST', '77001');
    expect(match).toBeNull();
  });

  it('returns existing row when first 6 chars and zip match but street differs', async () => {
    await pool.query(
      `INSERT INTO addresses (id, street, zip) VALUES (gen_random_uuid()::text, '123 MAPLE STREET', '77001')`
    );
    const match = await findNearMatch(pool, '123 MAPLE ST', '77001');
    expect(match).not.toBeNull();
    expect(match.street).toBe('123 MAPLE STREET');
  });

  it('returns null when zip differs even with matching prefix', async () => {
    await pool.query(
      `INSERT INTO addresses (id, street, zip) VALUES (gen_random_uuid()::text, '123 MAPLE STREET', '77002')`
    );
    const match = await findNearMatch(pool, '123 MAPLE ST', '77001');
    expect(match).toBeNull();
  });

  it('returns null for an exact street match (same street is not a near-match)', async () => {
    await pool.query(
      `INSERT INTO addresses (id, street, zip) VALUES (gen_random_uuid()::text, '123 MAPLE ST', '77001')`
    );
    const match = await findNearMatch(pool, '123 MAPLE ST', '77001');
    expect(match).toBeNull();
  });
});

describe('findOrCreateAddress', () => {
  it('creates a new address and returns it', async () => {
    const result = await findOrCreateAddress(pool, {
      street: '  100 pine ln  ',
      city: 'Houston',
      state: 'TX',
      zip: '77010',
      subdivision: 'Pine Park',
      builder: 'DR HORTON',
    });
    expect(result.nearMatch).toBeNull();
    expect(result.address).not.toBeNull();
    expect(result.address.street).toBe('100 PINE LN');
    expect(result.address.city).toBe('Houston');
  });

  it('returns existing address on exact match without inserting', async () => {
    await findOrCreateAddress(pool, { street: '200 ELM ST', zip: '77011' });
    const result = await findOrCreateAddress(pool, { street: '  200 elm st  ', zip: '77011' });
    expect(result.address.street).toBe('200 ELM ST');
    const count = await pool.query("SELECT COUNT(*) FROM addresses WHERE street = '200 ELM ST'");
    expect(parseInt(count.rows[0].count)).toBe(1);
  });

  it('returns nearMatch instead of address when near-match exists', async () => {
    await pool.query(
      `INSERT INTO addresses (id, street, zip) VALUES (gen_random_uuid()::text, '300 OAK AVENUE', '77012')`
    );
    const result = await findOrCreateAddress(pool, { street: '300 OAK AVE', zip: '77012' });
    expect(result.address).toBeNull();
    expect(result.nearMatch).not.toBeNull();
    expect(result.nearMatch.street).toBe('300 OAK AVENUE');
  });
});

// ── visit.js ─────────────────────────────────────────────────────────────────
describe('createVisitWithSystems', () => {
  it('creates a visit with status pending_review and one system row', async () => {
    const addrResult = await pool.query(
      `INSERT INTO addresses (id, street) VALUES (gen_random_uuid()::text, '999 TEST ST') RETURNING id`
    );
    const addressId = addrResult.rows[0].id;

    const { visitId } = await createVisitWithSystems(pool, {
      addressId,
      batchId: null,
      orderNumber: 'ORD-X',
      scheduledTime: '2026-06-21T09:00:00Z',
      workType: 'AC',
      systemCount: 1,
      notes: null,
    });

    const visit = await pool.query('SELECT * FROM visits WHERE id = $1', [visitId]);
    expect(visit.rows[0].status).toBe('pending_review');
    expect(visit.rows[0].has_multiple_systems).toBe(false);
    expect(visit.rows[0].is_deferred).toBe(false);
    expect(visit.rows[0].date).toBe('2026-06-21');

    const systems = await pool.query('SELECT * FROM visit_systems WHERE visit_id = $1 ORDER BY system_number', [visitId]);
    expect(systems.rows).toHaveLength(1);
    expect(systems.rows[0].system_number).toBe(1);
    expect(systems.rows[0].indoor_model).toBeNull();
  });

  it('creates two system rows when systemCount is 2', async () => {
    const addrResult = await pool.query(
      `INSERT INTO addresses (id, street) VALUES (gen_random_uuid()::text, '888 MULTI ST') RETURNING id`
    );
    const addressId = addrResult.rows[0].id;

    const { visitId } = await createVisitWithSystems(pool, {
      addressId,
      batchId: null,
      orderNumber: 'ORD-Y',
      scheduledTime: '2026-06-21T10:00:00Z',
      workType: 'Heat',
      systemCount: 2,
      notes: null,
    });

    const visit = await pool.query('SELECT * FROM visits WHERE id = $1', [visitId]);
    expect(visit.rows[0].has_multiple_systems).toBe(true);

    const systems = await pool.query('SELECT * FROM visit_systems WHERE visit_id = $1 ORDER BY system_number', [visitId]);
    expect(systems.rows).toHaveLength(2);
    expect(systems.rows[0].system_number).toBe(1);
    expect(systems.rows[1].system_number).toBe(2);
  });
});
```

- [ ] **Step 6: Run failing tests**

```bash
npx jest tests/unit.test.js --no-coverage
```

Expected: FAIL — `Cannot find module '../src/services/ai'` and other missing modules.

- [ ] **Step 7: Run tests after all three files are created (Steps 1–3)**

```bash
npx jest tests/unit.test.js --no-coverage
```

Expected: All 12 tests PASS.

- [ ] **Step 8: Run full suite to check no regressions**

```bash
npx jest --no-coverage --runInBand
```

Expected: All 24 (old) + 12 (new) = 36 tests pass.

- [ ] **Step 9: Commit**

```bash
git add src/services/ai.js src/helpers/address.js src/helpers/visit.js tests/helpers/seeds.js tests/unit.test.js
git commit -m "feat: add AI stub, address normalization helper, visit creation helper"
```

---

## Task 3: Dispatch Routes

**Files:**
- Create: `src/routes/dispatch.js`
- Modify: `src/index.js`
- Create: `tests/dispatch.test.js`

**Interfaces:**
- Consumes:
  - `extractCallsFromPDF(buffer)` from `../services/ai`
  - `findOrCreateAddress(pool, opts)` from `../helpers/address`
  - `createVisitWithSystems(pool, opts)` from `../helpers/visit`
  - `requireRole` from `../middleware/auth`
- Produces: All `/api/dispatch/` endpoints except `/technicians` (those stay in technicians.js)
- **Module-level cache:** `const batchCallsCache = new Map()` — keyed by batchId, value is the calls array from `extractCallsFromPDF`

> **Mount order:** In `src/index.js`, add `/api/dispatch/technicians` mount BEFORE `/api/dispatch`. This keeps the technicians router from being shadowed.

- [ ] **Step 1: Write failing tests**

Create `tests/dispatch.test.js`:
```javascript
const request = require('supertest');
const app = require('../src/index');
const { pool, truncateTables } = require('./helpers/db');
const { seedDispatcherWithToken } = require('./helpers/seeds');

beforeEach(truncateTables);
afterAll(() => pool.end());

// ── POST /api/dispatch/parse-pdf ─────────────────────────────────────────────
describe('POST /api/dispatch/parse-pdf', () => {
  it('returns 403 for technician role', async () => {
    const { pool: p } = require('./helpers/db');
    const crypto = require('crypto');
    const tech = await p.query(
      `INSERT INTO technicians (id, name, role, is_active, created_at)
       VALUES (gen_random_uuid()::text, 'T', 'technician', true, $1) RETURNING id`,
      [new Date().toISOString()]
    );
    const token = crypto.randomBytes(32).toString('hex');
    await p.query('INSERT INTO device_tokens (token, technician_id, created_at) VALUES ($1, $2, $3)',
      [token, tech.rows[0].id, new Date().toISOString()]);

    const res = await request(app)
      .post('/api/dispatch/parse-pdf')
      .set('Authorization', `Bearer ${token}`)
      .attach('pdf', Buffer.from('fake pdf'), 'test.pdf');
    expect(res.status).toBe(403);
  });

  it('creates a batch and returns batchId + 2 calls', async () => {
    const { token } = await seedDispatcherWithToken();
    const res = await request(app)
      .post('/api/dispatch/parse-pdf')
      .set('Authorization', `Bearer ${token}`)
      .attach('pdf', Buffer.from('fake pdf content'), 'upload.pdf');

    expect(res.status).toBe(200);
    expect(res.body.batchId).toBeDefined();
    expect(res.body.totalCalls).toBe(2);
    expect(res.body.calls).toHaveLength(2);
    expect(res.body.calls[0].index).toBe(1);
    expect(res.body.calls[1].index).toBe(2);

    const batch = await pool.query('SELECT * FROM pdf_batches WHERE id = $1', [res.body.batchId]);
    expect(batch.rows[0].status).toBe('in_review');
    expect(batch.rows[0].total_calls).toBe(2);
  });

  it('deletes released batches before creating a new one', async () => {
    const { token } = await seedDispatcherWithToken();
    // Seed a released batch
    await pool.query(
      `INSERT INTO pdf_batches (id, total_calls, skipped_count, status, created_at)
       VALUES (gen_random_uuid()::text, 1, 0, 'released', $1)`,
      [new Date().toISOString()]
    );

    await request(app)
      .post('/api/dispatch/parse-pdf')
      .set('Authorization', `Bearer ${token}`)
      .attach('pdf', Buffer.from('pdf'), 'upload.pdf');

    const batches = await pool.query("SELECT * FROM pdf_batches WHERE status = 'released'");
    expect(batches.rows).toHaveLength(0);
  });
});

// ── GET /api/dispatch/batch/:batchId/call/:index ─────────────────────────────
describe('GET /api/dispatch/batch/:batchId/call/:index', () => {
  async function parsePdf(token) {
    const res = await request(app)
      .post('/api/dispatch/parse-pdf')
      .set('Authorization', `Bearer ${token}`)
      .attach('pdf', Buffer.from('pdf'), 'upload.pdf');
    return res.body;
  }

  it('returns call at index 1', async () => {
    const { token } = await seedDispatcherWithToken();
    const { batchId } = await parsePdf(token);

    const res = await request(app)
      .get(`/api/dispatch/batch/${batchId}/call/1`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.index).toBe(1);
    expect(res.body.totalCalls).toBe(2);
    expect(res.body.call.orderNumber).toBe('ORD-001');
  });

  it('returns call at index 2', async () => {
    const { token } = await seedDispatcherWithToken();
    const { batchId } = await parsePdf(token);

    const res = await request(app)
      .get(`/api/dispatch/batch/${batchId}/call/2`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.call.orderNumber).toBe('ORD-002');
    expect(res.body.call.systemCount).toBe(2);
  });

  it('returns 404 for out-of-range index', async () => {
    const { token } = await seedDispatcherWithToken();
    const { batchId } = await parsePdf(token);

    const res = await request(app)
      .get(`/api/dispatch/batch/${batchId}/call/99`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);
  });

  it('returns 404 for unknown batchId', async () => {
    const { token } = await seedDispatcherWithToken();
    const res = await request(app)
      .get('/api/dispatch/batch/nonexistent-id/call/1')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });
});

// ── POST /api/dispatch/batch/:batchId/call/:index/confirm ────────────────────
describe('POST /api/dispatch/batch/:batchId/call/:index/confirm', () => {
  async function parsePdf(token) {
    const res = await request(app)
      .post('/api/dispatch/parse-pdf')
      .set('Authorization', `Bearer ${token}`)
      .attach('pdf', Buffer.from('pdf'), 'upload.pdf');
    return res.body;
  }

  it('creates a visit and returns { created: true, visitId }', async () => {
    const { token } = await seedDispatcherWithToken();
    const { batchId } = await parsePdf(token);

    const res = await request(app)
      .post(`/api/dispatch/batch/${batchId}/call/1/confirm`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        orderNumber: 'ORD-001',
        address: '123 Maple St',
        city: 'Houston',
        state: 'TX',
        zip: '77001',
        subdivision: 'MAPLE GROVE',
        builder: 'DR HORTON',
        scheduledTime: '2026-06-21T09:00:00Z',
        workType: 'AC',
        systemCount: 1,
      });

    expect(res.status).toBe(200);
    expect(res.body.created).toBe(true);
    expect(res.body.visitId).toBeDefined();

    const visit = await pool.query('SELECT * FROM visits WHERE id = $1', [res.body.visitId]);
    expect(visit.rows[0].status).toBe('pending_review');
    expect(visit.rows[0].batch_id).toBe(batchId);
    expect(visit.rows[0].order_number).toBe('ORD-001');

    const systems = await pool.query('SELECT * FROM visit_systems WHERE visit_id = $1', [res.body.visitId]);
    expect(systems.rows).toHaveLength(1);
  });

  it('returns comparisonRequired when near-match address exists', async () => {
    const { token } = await seedDispatcherWithToken();
    await pool.query(
      `INSERT INTO addresses (id, street, zip) VALUES (gen_random_uuid()::text, '123 MAPLE STREET', '77001')`
    );
    const { batchId } = await parsePdf(token);

    const res = await request(app)
      .post(`/api/dispatch/batch/${batchId}/call/1/confirm`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        orderNumber: 'ORD-001',
        address: '123 MAPLE ST',
        city: 'Houston',
        state: 'TX',
        zip: '77001',
        workType: 'AC',
      });

    expect(res.status).toBe(200);
    expect(res.body.comparisonRequired).toBe(true);
    expect(res.body.existingAddress.street).toBe('123 MAPLE STREET');
    expect(res.body.incomingData).toBeDefined();
  });
});

// ── POST /api/dispatch/batch/:batchId/call/:index/skip ──────────────────────
describe('POST /api/dispatch/batch/:batchId/call/:index/skip', () => {
  it('increments skipped_count and returns it', async () => {
    const { token } = await seedDispatcherWithToken();
    const parseRes = await request(app)
      .post('/api/dispatch/parse-pdf')
      .set('Authorization', `Bearer ${token}`)
      .attach('pdf', Buffer.from('pdf'), 'upload.pdf');
    const { batchId } = parseRes.body;

    const res = await request(app)
      .post(`/api/dispatch/batch/${batchId}/call/1/skip`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.skipped).toBe(true);
    expect(res.body.skippedCount).toBe(1);

    const batch = await pool.query('SELECT skipped_count FROM pdf_batches WHERE id = $1', [batchId]);
    expect(batch.rows[0].skipped_count).toBe(1);
  });
});

// ── POST /api/dispatch/batch/:batchId/release-to-lobby ──────────────────────
describe('POST /api/dispatch/batch/:batchId/release-to-lobby', () => {
  async function setupBatchWithConfirmedCalls(token) {
    const parseRes = await request(app)
      .post('/api/dispatch/parse-pdf')
      .set('Authorization', `Bearer ${token}`)
      .attach('pdf', Buffer.from('pdf'), 'upload.pdf');
    const { batchId } = parseRes.body;

    // Confirm call 1
    await request(app)
      .post(`/api/dispatch/batch/${batchId}/call/1/confirm`)
      .set('Authorization', `Bearer ${token}`)
      .send({ orderNumber: 'ORD-001', address: '10 FIRST ST', city: 'Houston', state: 'TX', zip: '77001', workType: 'AC' });

    // Confirm call 2
    await request(app)
      .post(`/api/dispatch/batch/${batchId}/call/2/confirm`)
      .set('Authorization', `Bearer ${token}`)
      .send({ orderNumber: 'ORD-002', address: '20 SECOND ST', city: 'Houston', state: 'TX', zip: '77002', workType: 'Heat', systemCount: 2 });

    return batchId;
  }

  it('returns mismatch when not all calls are confirmed or skipped', async () => {
    const { token } = await seedDispatcherWithToken();
    const parseRes = await request(app)
      .post('/api/dispatch/parse-pdf')
      .set('Authorization', `Bearer ${token}`)
      .attach('pdf', Buffer.from('pdf'), 'upload.pdf');
    const { batchId } = parseRes.body;

    // Confirm only 1 of 2 calls
    await request(app)
      .post(`/api/dispatch/batch/${batchId}/call/1/confirm`)
      .set('Authorization', `Bearer ${token}`)
      .send({ orderNumber: 'ORD-001', address: '10 FIRST ST', city: 'Houston', state: 'TX', zip: '77001', workType: 'AC' });

    const res = await request(app)
      .post(`/api/dispatch/batch/${batchId}/release-to-lobby`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.mismatch).toBe(true);
    expect(res.body.expected).toBe(2);
    expect(res.body.actual).toBe(1);
  });

  it('releases visits to in_lobby and marks batch released', async () => {
    const { token } = await seedDispatcherWithToken();
    const batchId = await setupBatchWithConfirmedCalls(token);

    const res = await request(app)
      .post(`/api/dispatch/batch/${batchId}/release-to-lobby`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.releasedCount).toBe(2);
    expect(res.body.visitIds).toHaveLength(2);

    const batch = await pool.query('SELECT status FROM pdf_batches WHERE id = $1', [batchId]);
    expect(batch.rows[0].status).toBe('released');

    const visits = await pool.query('SELECT status FROM visits WHERE batch_id = $1', [batchId]);
    for (const v of visits.rows) expect(v.status).toBe('in_lobby');
  });
});

// ── POST /api/dispatch/visits/create-manual ──────────────────────────────────
describe('POST /api/dispatch/visits/create-manual', () => {
  it('creates a standalone visit with batch_id = null', async () => {
    const { token } = await seedDispatcherWithToken();

    const res = await request(app)
      .post('/api/dispatch/visits/create-manual')
      .set('Authorization', `Bearer ${token}`)
      .send({
        orderNumber: 'MANUAL-1',
        address: '500 MANUAL RD',
        city: 'Houston',
        state: 'TX',
        zip: '77005',
        workType: 'AC',
        systemCount: 1,
      });

    expect(res.status).toBe(200);
    expect(res.body.visitId).toBeDefined();

    const visit = await pool.query('SELECT * FROM visits WHERE id = $1', [res.body.visitId]);
    expect(visit.rows[0].status).toBe('pending_review');
    expect(visit.rows[0].batch_id).toBeNull();
  });

  it('returns comparisonRequired when near-match address exists', async () => {
    const { token } = await seedDispatcherWithToken();
    await pool.query(
      `INSERT INTO addresses (id, street, zip) VALUES (gen_random_uuid()::text, '500 MANUAL ROAD', '77005')`
    );

    const res = await request(app)
      .post('/api/dispatch/visits/create-manual')
      .set('Authorization', `Bearer ${token}`)
      .send({
        address: '500 MANUAL RD',
        city: 'Houston',
        state: 'TX',
        zip: '77005',
        workType: 'AC',
      });

    expect(res.status).toBe(200);
    expect(res.body.comparisonRequired).toBe(true);
    expect(res.body.existingAddress.street).toBe('500 MANUAL ROAD');
  });
});
```

- [ ] **Step 2: Run failing tests**

```bash
npx jest tests/dispatch.test.js --no-coverage
```

Expected: All FAIL — `Cannot find module '../src/routes/dispatch'` or 404 errors.

- [ ] **Step 3: Implement `src/routes/dispatch.js`**

```javascript
const express = require('express');
const multer = require('multer');
const { pool } = require('../db/pool');
const { requireRole } = require('../middleware/auth');
const { extractCallsFromPDF } = require('../services/ai');
const { findOrCreateAddress, normalizeStreet } = require('../helpers/address');
const { createVisitWithSystems } = require('../helpers/visit');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

// In-memory cache: batchId → calls array (from AI extraction)
const batchCallsCache = new Map();

// POST /api/dispatch/parse-pdf
router.post('/parse-pdf', requireRole('owner', 'dispatcher'), upload.single('pdf'), async (req, res, next) => {
  try {
    // Displacement cleanup: delete previously released batches
    await pool.query("DELETE FROM pdf_batches WHERE status = 'released'");

    const calls = await extractCallsFromPDF(req.file.buffer);
    const now = new Date().toISOString();

    const batchResult = await pool.query(
      `INSERT INTO pdf_batches (id, total_calls, skipped_count, status, created_at)
       VALUES (gen_random_uuid()::text, $1, 0, 'in_review', $2)
       RETURNING id`,
      [calls.length, now]
    );
    const batchId = batchResult.rows[0].id;

    batchCallsCache.set(batchId, calls);

    res.json({
      batchId,
      totalCalls: calls.length,
      calls: calls.map((call, i) => ({ index: i + 1, ...call })),
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/dispatch/batch/:batchId/call/:index
router.get('/batch/:batchId/call/:index', requireRole('owner', 'dispatcher'), async (req, res, next) => {
  try {
    const { batchId, index } = req.params;
    const idx = parseInt(index, 10);

    const batchResult = await pool.query(
      "SELECT * FROM pdf_batches WHERE id = $1 AND status = 'in_review'",
      [batchId]
    );
    if (batchResult.rows.length === 0) {
      return res.status(404).json({ error: 'Batch not found or not in review' });
    }

    const calls = batchCallsCache.get(batchId);
    if (!calls) {
      return res.status(404).json({ error: 'Batch call data not in memory' });
    }
    if (idx < 1 || idx > calls.length) {
      return res.status(404).json({ error: `Call index out of range (1–${calls.length})` });
    }

    res.json({
      index: idx,
      totalCalls: calls.length,
      call: calls[idx - 1],
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/dispatch/batch/:batchId/call/:index/confirm
router.post('/batch/:batchId/call/:index/confirm', requireRole('owner', 'dispatcher'), async (req, res, next) => {
  try {
    const { batchId } = req.params;

    const batchResult = await pool.query(
      "SELECT * FROM pdf_batches WHERE id = $1 AND status = 'in_review'",
      [batchId]
    );
    if (batchResult.rows.length === 0) {
      return res.status(404).json({ error: 'Batch not found or not in review' });
    }

    const { orderNumber, address, city, state, zip, subdivision, builder, scheduledTime, workType, systemCount, notes } = req.body;

    const { address: foundAddress, nearMatch } = await findOrCreateAddress(pool, {
      street: address,
      city,
      state,
      zip,
      subdivision,
      builder,
    });

    if (nearMatch) {
      return res.json({
        comparisonRequired: true,
        incomingData: req.body,
        existingAddress: nearMatch,
      });
    }

    const { visitId } = await createVisitWithSystems(pool, {
      addressId: foundAddress.id,
      batchId,
      orderNumber,
      scheduledTime,
      workType,
      systemCount,
      notes,
    });

    res.json({ created: true, visitId });
  } catch (err) {
    next(err);
  }
});

// POST /api/dispatch/batch/:batchId/call/:index/skip
router.post('/batch/:batchId/call/:index/skip', requireRole('owner', 'dispatcher'), async (req, res, next) => {
  try {
    const { batchId } = req.params;

    const result = await pool.query(
      "UPDATE pdf_batches SET skipped_count = skipped_count + 1 WHERE id = $1 AND status = 'in_review' RETURNING skipped_count",
      [batchId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Batch not found or not in review' });
    }

    res.json({ skipped: true, skippedCount: result.rows[0].skipped_count });
  } catch (err) {
    next(err);
  }
});

// POST /api/dispatch/batch/:batchId/release-to-lobby
router.post('/batch/:batchId/release-to-lobby', requireRole('owner', 'dispatcher'), async (req, res, next) => {
  try {
    const { batchId } = req.params;

    const batchResult = await pool.query(
      "SELECT * FROM pdf_batches WHERE id = $1 AND status = 'in_review'",
      [batchId]
    );
    if (batchResult.rows.length === 0) {
      return res.status(404).json({ error: 'Batch not found or not in review' });
    }
    const batch = batchResult.rows[0];

    const countResult = await pool.query(
      "SELECT COUNT(*) FROM visits WHERE batch_id = $1 AND status = 'pending_review'",
      [batchId]
    );
    const actual = parseInt(countResult.rows[0].count, 10);
    const expected = batch.total_calls - batch.skipped_count;

    if (actual !== expected) {
      return res.json({ mismatch: true, expected, actual });
    }

    const now = new Date().toISOString();

    const releaseResult = await pool.query(
      `UPDATE visits SET status = 'in_lobby', updated_at = $1
       WHERE batch_id = $2 AND status = 'pending_review'
       RETURNING id`,
      [now, batchId]
    );

    await pool.query(
      "UPDATE pdf_batches SET status = 'released' WHERE id = $1",
      [batchId]
    );

    const today = new Date().toISOString().slice(0, 10);
    await pool.query(
      `UPDATE visits SET is_deferred = true, updated_at = $1
       WHERE status = 'assigned'
         AND LEFT(created_at, 10) < $2
         AND is_deferred = false`,
      [now, today]
    );

    const visitIds = releaseResult.rows.map((r) => r.id);
    res.json({ releasedCount: visitIds.length, visitIds });
  } catch (err) {
    next(err);
  }
});

// POST /api/dispatch/visits/create-manual
router.post('/visits/create-manual', requireRole('owner', 'dispatcher'), async (req, res, next) => {
  try {
    const { orderNumber, address, city, state, zip, subdivision, builder, scheduledTime, workType, systemCount, notes } = req.body;

    const { address: foundAddress, nearMatch } = await findOrCreateAddress(pool, {
      street: address,
      city,
      state,
      zip,
      subdivision,
      builder,
    });

    if (nearMatch) {
      return res.json({
        comparisonRequired: true,
        incomingData: req.body,
        existingAddress: nearMatch,
      });
    }

    const { visitId } = await createVisitWithSystems(pool, {
      addressId: foundAddress.id,
      batchId: null,
      orderNumber,
      scheduledTime,
      workType,
      systemCount,
      notes,
    });

    res.json({ visitId });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
```

- [ ] **Step 4: Mount dispatch router in `src/index.js`**

Edit `src/index.js`. Add the two new lines shown — keep the technicians mount BEFORE the dispatch mount:

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

- [ ] **Step 5: Run dispatch tests**

```bash
npx jest tests/dispatch.test.js --no-coverage
```

Expected: All PASS.

- [ ] **Step 6: Run full suite**

```bash
npx jest --no-coverage --runInBand
```

Expected: All 36 (prior) + new dispatch tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/routes/dispatch.js src/index.js tests/dispatch.test.js
git commit -m "feat: add dispatch routes (parse-pdf, batch state machine, create-manual)"
```

---

## Task 4: Address Resolve-Comparison Route

**Files:**
- Create: `src/routes/addresses.js`
- Modify: `src/index.js`
- Create: `tests/addresses.test.js`

**Interfaces:**
- Consumes:
  - `normalizeStreet` from `../helpers/address`
  - `createVisitWithSystems` from `../helpers/visit`
  - `requireRole` from `../middleware/auth`
- Produces: `POST /api/addresses/:id/resolve-comparison`

> **`:id` in the route is the existing address ID** (the one the near-match check returned). The three `action` values:
> - `create_new` — insert a brand-new address row from `incomingData`, then create visit pointing to it
> - `merge_keep_new` — UPDATE the existing address `:id` with `incomingData` fields (street, city, state, zip, subdivision, builder), create visit pointing to `:id`
> - `merge_keep_existing` — leave `:id` unchanged, create visit pointing to `:id`

> **pendingVisitData** is whatever the caller wants stored on the visit (orderNumber, scheduledTime, workType, systemCount, notes, batchId).

- [ ] **Step 1: Write failing tests**

Create `tests/addresses.test.js`:
```javascript
const request = require('supertest');
const app = require('../src/index');
const { pool, truncateTables } = require('./helpers/db');
const { seedDispatcherWithToken } = require('./helpers/seeds');

beforeEach(truncateTables);
afterAll(() => pool.end());

async function seedAddress({ street = '100 EXISTING ST', zip = '77001' } = {}) {
  const r = await pool.query(
    `INSERT INTO addresses (id, street, city, state, zip)
     VALUES (gen_random_uuid()::text, $1, 'Houston', 'TX', $2)
     RETURNING *`,
    [street, zip]
  );
  return r.rows[0];
}

const incomingData = {
  address: '100 EXISTING STREET',
  city: 'Houston',
  state: 'TX',
  zip: '77001',
  subdivision: 'Eastview',
  builder: 'LENNAR',
};

const pendingVisitData = {
  orderNumber: 'ORD-RESOLVE',
  scheduledTime: '2026-06-21T08:00:00Z',
  workType: 'AC',
  systemCount: 1,
  notes: null,
  batchId: null,
};

describe('POST /api/addresses/:id/resolve-comparison', () => {
  it('create_new: inserts a new address and creates a visit pointing to it', async () => {
    const { token } = await seedDispatcherWithToken();
    const existing = await seedAddress();

    const res = await request(app)
      .post(`/api/addresses/${existing.id}/resolve-comparison`)
      .set('Authorization', `Bearer ${token}`)
      .send({ action: 'create_new', incomingData, pendingVisitData });

    expect(res.status).toBe(200);
    expect(res.body.visitId).toBeDefined();
    expect(res.body.addressId).toBeDefined();

    // New address should be different from existing
    expect(res.body.addressId).not.toBe(existing.id);

    const visit = await pool.query('SELECT * FROM visits WHERE id = $1', [res.body.visitId]);
    expect(visit.rows[0].address_id).toBe(res.body.addressId);
    expect(visit.rows[0].status).toBe('pending_review');

    // Original address unchanged
    const orig = await pool.query('SELECT * FROM addresses WHERE id = $1', [existing.id]);
    expect(orig.rows[0].street).toBe('100 EXISTING ST');
  });

  it('merge_keep_new: updates existing address with incomingData and creates visit', async () => {
    const { token } = await seedDispatcherWithToken();
    const existing = await seedAddress();

    const res = await request(app)
      .post(`/api/addresses/${existing.id}/resolve-comparison`)
      .set('Authorization', `Bearer ${token}`)
      .send({ action: 'merge_keep_new', incomingData, pendingVisitData });

    expect(res.status).toBe(200);
    expect(res.body.addressId).toBe(existing.id);

    const updated = await pool.query('SELECT * FROM addresses WHERE id = $1', [existing.id]);
    expect(updated.rows[0].street).toBe('100 EXISTING STREET');
    expect(updated.rows[0].subdivision).toBe('Eastview');

    const visit = await pool.query('SELECT * FROM visits WHERE id = $1', [res.body.visitId]);
    expect(visit.rows[0].address_id).toBe(existing.id);
  });

  it('merge_keep_existing: leaves address unchanged and creates visit pointing to it', async () => {
    const { token } = await seedDispatcherWithToken();
    const existing = await seedAddress();

    const res = await request(app)
      .post(`/api/addresses/${existing.id}/resolve-comparison`)
      .set('Authorization', `Bearer ${token}`)
      .send({ action: 'merge_keep_existing', incomingData, pendingVisitData });

    expect(res.status).toBe(200);
    expect(res.body.addressId).toBe(existing.id);

    const unchanged = await pool.query('SELECT * FROM addresses WHERE id = $1', [existing.id]);
    expect(unchanged.rows[0].street).toBe('100 EXISTING ST');

    const visit = await pool.query('SELECT * FROM visits WHERE id = $1', [res.body.visitId]);
    expect(visit.rows[0].address_id).toBe(existing.id);
  });

  it('returns 400 for unknown action', async () => {
    const { token } = await seedDispatcherWithToken();
    const existing = await seedAddress();

    const res = await request(app)
      .post(`/api/addresses/${existing.id}/resolve-comparison`)
      .set('Authorization', `Bearer ${token}`)
      .send({ action: 'do_something_weird', incomingData, pendingVisitData });

    expect(res.status).toBe(400);
  });

  it('returns 404 when address id does not exist', async () => {
    const { token } = await seedDispatcherWithToken();

    const res = await request(app)
      .post('/api/addresses/nonexistent-id/resolve-comparison')
      .set('Authorization', `Bearer ${token}`)
      .send({ action: 'merge_keep_existing', incomingData, pendingVisitData });

    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run failing tests**

```bash
npx jest tests/addresses.test.js --no-coverage
```

Expected: All FAIL — 404 (route not mounted yet).

- [ ] **Step 3: Implement `src/routes/addresses.js`**

```javascript
const express = require('express');
const { pool } = require('../db/pool');
const { requireRole } = require('../middleware/auth');
const { normalizeStreet } = require('../helpers/address');
const { createVisitWithSystems } = require('../helpers/visit');

const router = express.Router();

const VALID_ACTIONS = ['create_new', 'merge_keep_new', 'merge_keep_existing'];

// POST /api/addresses/:id/resolve-comparison
router.post('/:id/resolve-comparison', requireRole('owner', 'dispatcher'), async (req, res, next) => {
  try {
    const existingId = req.params.id;
    const { action, incomingData, pendingVisitData } = req.body;

    if (!VALID_ACTIONS.includes(action)) {
      return res.status(400).json({ error: `action must be one of: ${VALID_ACTIONS.join(', ')}` });
    }

    // Verify existing address exists
    const existingResult = await pool.query('SELECT * FROM addresses WHERE id = $1', [existingId]);
    if (existingResult.rows.length === 0) {
      return res.status(404).json({ error: 'Address not found' });
    }

    let addressId;

    if (action === 'create_new') {
      const normalized = normalizeStreet(incomingData.address);
      const insertResult = await pool.query(
        `INSERT INTO addresses (id, street, city, state, zip, subdivision, builder)
         VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6)
         RETURNING id`,
        [normalized, incomingData.city || null, incomingData.state || null,
         incomingData.zip || null, incomingData.subdivision || null, incomingData.builder || null]
      );
      addressId = insertResult.rows[0].id;

    } else if (action === 'merge_keep_new') {
      const normalized = normalizeStreet(incomingData.address);
      await pool.query(
        `UPDATE addresses
         SET street = $1, city = $2, state = $3, zip = $4, subdivision = $5, builder = $6
         WHERE id = $7`,
        [normalized, incomingData.city || null, incomingData.state || null,
         incomingData.zip || null, incomingData.subdivision || null,
         incomingData.builder || null, existingId]
      );
      addressId = existingId;

    } else {
      // merge_keep_existing: use existing address unchanged
      addressId = existingId;
    }

    const { visitId } = await createVisitWithSystems(pool, {
      addressId,
      batchId: pendingVisitData.batchId || null,
      orderNumber: pendingVisitData.orderNumber || null,
      scheduledTime: pendingVisitData.scheduledTime || null,
      workType: pendingVisitData.workType || null,
      systemCount: pendingVisitData.systemCount || 1,
      notes: pendingVisitData.notes || null,
    });

    res.json({ visitId, addressId });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
```

- [ ] **Step 4: Mount addresses router in `src/index.js`**

Add one line after the existing mounts:
```javascript
app.use('/api/addresses', require('./routes/addresses'));
```

The complete authenticated section of index.js should now be:
```javascript
app.use('/api/dispatch/technicians', require('./routes/technicians'));
app.use('/api/dispatch', require('./routes/dispatch'));
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/sync', require('./routes/sync'));
app.use('/api/addresses', require('./routes/addresses'));
```

- [ ] **Step 5: Run addresses tests**

```bash
npx jest tests/addresses.test.js --no-coverage
```

Expected: All PASS.

- [ ] **Step 6: Run full suite**

```bash
npx jest --no-coverage --runInBand
```

Expected: All tests pass (36 prior + new dispatch + new addresses + unit = full suite green).

- [ ] **Step 7: Commit**

```bash
git add src/routes/addresses.js src/index.js tests/addresses.test.js
git commit -m "feat: add address resolve-comparison route"
```

---

## Self-Review

**Spec coverage check:**

| Requirement | Task |
|---|---|
| `002_visits_updated_at_deferred.sql` migration | Task 1 |
| `multer` installed | Task 1 |
| `truncateTables` covers new tables | Task 1 |
| `src/services/ai.js` stub (2 calls, exact shape) | Task 2 |
| `normalizeStreet` (uppercase + trim) | Task 2 |
| Near-match: first 6 chars + zip | Task 2 |
| `findOrCreateAddress` (exact → near → insert) | Task 2 |
| `createVisitWithSystems` (visit + N system rows) | Task 2 |
| `POST /api/dispatch/parse-pdf` (multer, displacement cleanup, AI stub, cache) | Task 3 |
| `GET /api/dispatch/batch/:batchId/call/:index` | Task 3 |
| `POST /api/dispatch/batch/:batchId/call/:index/confirm` (near-match guard) | Task 3 |
| `POST /api/dispatch/batch/:batchId/call/:index/skip` (increment skipped_count) | Task 3 |
| `POST /api/dispatch/batch/:batchId/release-to-lobby` (mismatch guard, release, deferred update) | Task 3 |
| `POST /api/dispatch/visits/create-manual` (batch_id = null) | Task 3 |
| `/api/dispatch` mounted AFTER `/api/dispatch/technicians` | Task 3 |
| `POST /api/addresses/:id/resolve-comparison` (create_new, merge_keep_new, merge_keep_existing) | Task 4 |
| Visit created with `status = 'pending_review'` in all create paths | Tasks 3 & 4 |
| `visit_systems` rows created (1 per system, system_number starts at 1) | Task 2 |
| Deferred detection: `LEFT(created_at, 10) < today` on release | Task 3 |
| All timestamps ISO 8601 TEXT | Tasks 2–4 |

**No gaps found.**
