# Phase 1: Auth, Technician Lifecycle, Notifications, Sync — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add invite-based auth, technician CRUD, notifications, and a polling sync endpoint — all infrastructure, no business logic.

**Architecture:** Each concern lives in its own route file under `src/routes/`, mounted in `src/index.js`. Auth routes mount *before* the global `authenticate` middleware so `redeem-invite` runs unauthenticated; `generate-invite` and `revoke` call `authenticate` inline. The `notify.js` helper is a plain async function (not a route) used by other routes.

**Tech Stack:** Node.js, Express 4, pg (Pool), Node built-in `crypto`, Jest + Supertest for integration tests.

## Global Constraints

- All PKs: `text` with `DEFAULT gen_random_uuid()::text`
- All timestamps: ISO 8601 `text` strings (`new Date().toISOString()` in JS — no PostgreSQL timestamp types)
- Error shape: `{ error: "Human-readable message" }`
- No ORM, no external crypto libraries
- Do NOT modify `src/db/schema.sql` or `src/middleware/auth.js`
- New endpoints go in new files under `src/routes/`
- `DATABASE_URL` env var controls DB connection; tests use `TEST_DATABASE_URL`

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src/db/migrations/001_invite_codes.sql` | Create | Adds `invite_codes` table and `updated_at` to `visits` |
| `src/helpers/notify.js` | Create | `createNotification(db, opts)` — internal only |
| `src/routes/auth.js` | Create | `generate-invite`, `redeem-invite`, `revoke` |
| `src/routes/technicians.js` | Create | CRUD for technician lifecycle |
| `src/routes/notifications.js` | Create | `GET /mine`, `PATCH /:id/mark-read` |
| `src/routes/sync.js` | Create | `GET /changes?since=` |
| `src/index.js` | Modify | Mount all new route files |
| `jest.config.js` | Create | Jest config pointing at `tests/` |
| `tests/helpers/db.js` | Create | Test DB pool + truncate helper |
| `tests/auth.test.js` | Create | Integration tests for auth routes |
| `tests/technicians.test.js` | Create | Integration tests for technician routes |
| `tests/notifications.test.js` | Create | Integration tests for notification routes |
| `tests/sync.test.js` | Create | Integration tests for sync route |

---

## Task 1: Migration + Test Infrastructure

**Files:**
- Create: `src/db/migrations/001_invite_codes.sql`
- Create: `jest.config.js`
- Create: `tests/helpers/db.js`
- Modify: `package.json` (add test script + devDependencies)

**Interfaces:**
- Produces: `invite_codes` table in DB; `pool` and `truncateTables()` from `tests/helpers/db.js`

- [ ] **Step 1: Write the migration SQL**

Create `src/db/migrations/001_invite_codes.sql`:
```sql
CREATE TABLE IF NOT EXISTS invite_codes (
  code         TEXT PRIMARY KEY,
  technician_id TEXT NOT NULL REFERENCES technicians(id),
  expires_at   TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
);

ALTER TABLE visits ADD COLUMN IF NOT EXISTS updated_at TEXT;
```

- [ ] **Step 2: Run the migration**

```bash
psql $DATABASE_URL -f src/db/migrations/001_invite_codes.sql
```

Expected output:
```
CREATE TABLE
ALTER TABLE
```

- [ ] **Step 3: Install test dependencies**

```bash
npm install --save-dev jest supertest
```

- [ ] **Step 4: Write `jest.config.js`**

```javascript
module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.js'],
  testTimeout: 15000,
};
```

- [ ] **Step 5: Add test script to `package.json`**

In `package.json`, add to `"scripts"`:
```json
"test": "jest --runInBand",
"db:migrate": "psql $DATABASE_URL -f src/db/migrations/001_invite_codes.sql"
```

Also add to `package.json`:
```json
"devDependencies": {
  "jest": "^29.0.0",
  "supertest": "^7.0.0"
}
```

- [ ] **Step 6: Write `tests/helpers/db.js`**

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
    DELETE FROM visits;
    DELETE FROM technicians;
  `);
}

module.exports = { pool, truncateTables };
```

- [ ] **Step 7: Verify test runner is wired**

```bash
npx jest --listTests
```

Expected: lists `tests/auth.test.js` etc. (files don't need to exist yet — just verify jest config resolves).

- [ ] **Step 8: Commit**

```bash
git add src/db/migrations/001_invite_codes.sql jest.config.js tests/helpers/db.js package.json package-lock.json
git commit -m "chore: add invite_codes migration and jest test infrastructure"
```

---

## Task 2: Notification Helper

**Files:**
- Create: `src/helpers/notify.js`

**Interfaces:**
- Consumes: `pool` from `../db/pool`; parameters `{ recipientId, type, message, linkTo, payload }`
- Produces: `createNotification(db, opts)` — async function, returns the inserted row

> **Schema note:** `notifications` table uses column `body` (not `message`), `link_to` (not `linkTo`), and `payload` is stored as a JSON text string.

- [ ] **Step 1: Write the failing test**

Create `tests/notifications.test.js` with just the helper test first:
```javascript
const request = require('supertest');
const app = require('../src/index');
const { pool, truncateTables } = require('./helpers/db');
const { createNotification } = require('../src/helpers/notify');

beforeEach(truncateTables);
afterAll(() => pool.end());

describe('createNotification helper', () => {
  it('inserts a notification row and returns it', async () => {
    // seed a technician to act as recipient
    const tech = await pool.query(
      `INSERT INTO technicians (id, name, role, is_active, created_at)
       VALUES (gen_random_uuid()::text, 'Alice', 'technician', true, $1)
       RETURNING id`,
      [new Date().toISOString()]
    );
    const recipientId = tech.rows[0].id;

    const result = await createNotification(pool, {
      recipientId,
      type: 'test_type',
      message: 'Hello world',
      linkTo: '/visits/123',
      payload: { visitId: '123' },
    });

    expect(result.id).toBeDefined();
    expect(result.recipient_id).toBe(recipientId);
    expect(result.body).toBe('Hello world');
    expect(result.link_to).toBe('/visits/123');
    expect(result.read).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to confirm failure**

```bash
npx jest tests/notifications.test.js -t "inserts a notification row" --no-coverage
```

Expected: FAIL — `Cannot find module '../src/helpers/notify'`

- [ ] **Step 3: Implement `src/helpers/notify.js`**

```javascript
const crypto = require('crypto');

async function createNotification(db, { recipientId, type, message, linkTo = null, payload = null }) {
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const payloadStr = payload !== null ? JSON.stringify(payload) : null;

  const result = await db.query(
    `INSERT INTO notifications (id, recipient_id, type, body, link_to, payload, read, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, false, $7)
     RETURNING *`,
    [id, recipientId, type, message, linkTo, payloadStr, createdAt]
  );

  return result.rows[0];
}

module.exports = { createNotification };
```

- [ ] **Step 4: Run test to confirm pass**

```bash
npx jest tests/notifications.test.js -t "inserts a notification row" --no-coverage
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/helpers/notify.js tests/notifications.test.js
git commit -m "feat: add createNotification helper"
```

---

## Task 3: Auth Routes

**Files:**
- Create: `src/routes/auth.js`
- Modify: `src/index.js` (mount auth router BEFORE global authenticate)

**Interfaces:**
- Consumes: `pool` from `../db/pool`; `authenticate`, `requireRole` from `../middleware/auth`; `crypto.randomBytes`
- Produces: `POST /api/auth/generate-invite`, `POST /api/auth/redeem-invite`, `POST /api/auth/revoke`

> **Critical:** The auth router must be mounted in `src/index.js` **before** `app.use(authenticate)` so that `redeem-invite` runs unauthenticated. The `generate-invite` and `revoke` endpoints call `authenticate` inline as route-level middleware.

- [ ] **Step 1: Write failing tests**

Create `tests/auth.test.js`:
```javascript
const request = require('supertest');
const app = require('../src/index');
const { pool, truncateTables } = require('./helpers/db');

beforeEach(truncateTables);
afterAll(() => pool.end());

async function seedTech({ role = 'technician', isActive = true } = {}) {
  const r = await pool.query(
    `INSERT INTO technicians (id, name, role, is_active, created_at)
     VALUES (gen_random_uuid()::text, $1, $2, $3, $4)
     RETURNING id, name, role`,
    [`Tech ${role}`, role, isActive, new Date().toISOString()]
  );
  return r.rows[0];
}

async function seedDispatcher() {
  return seedTech({ role: 'dispatcher' });
}

async function seedToken(technicianId) {
  const token = require('crypto').randomBytes(32).toString('hex');
  await pool.query(
    `INSERT INTO device_tokens (token, technician_id, created_at) VALUES ($1, $2, $3)`,
    [token, technicianId, new Date().toISOString()]
  );
  return token;
}

describe('POST /api/auth/generate-invite', () => {
  it('returns 403 for technician role', async () => {
    const tech = await seedTech();
    const token = await seedToken(tech.id);
    const res = await request(app)
      .post('/api/auth/generate-invite')
      .set('Authorization', `Bearer ${token}`)
      .send({ technicianId: tech.id });
    expect(res.status).toBe(403);
  });

  it('returns 400 for inactive technician', async () => {
    const dispatcher = await seedDispatcher();
    const dispToken = await seedToken(dispatcher.id);
    const inactiveTech = await seedTech({ isActive: false });

    const res = await request(app)
      .post('/api/auth/generate-invite')
      .set('Authorization', `Bearer ${dispToken}`)
      .send({ technicianId: inactiveTech.id });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Technician is inactive. Reactivate before generating an invite.');
  });

  it('generates a 6-char uppercase code and returns expiresAt', async () => {
    const dispatcher = await seedDispatcher();
    const dispToken = await seedToken(dispatcher.id);
    const tech = await seedTech();

    const res = await request(app)
      .post('/api/auth/generate-invite')
      .set('Authorization', `Bearer ${dispToken}`)
      .send({ technicianId: tech.id });

    expect(res.status).toBe(200);
    expect(res.body.inviteCode).toMatch(/^[A-Z0-9]{6}$/);
    expect(res.body.expiresAt).toBeDefined();
  });

  it('replaces existing unused invite for same technician', async () => {
    const dispatcher = await seedDispatcher();
    const dispToken = await seedToken(dispatcher.id);
    const tech = await seedTech();

    await request(app)
      .post('/api/auth/generate-invite')
      .set('Authorization', `Bearer ${dispToken}`)
      .send({ technicianId: tech.id });
    await request(app)
      .post('/api/auth/generate-invite')
      .set('Authorization', `Bearer ${dispToken}`)
      .send({ technicianId: tech.id });

    const codes = await pool.query(
      'SELECT * FROM invite_codes WHERE technician_id = $1',
      [tech.id]
    );
    expect(codes.rows).toHaveLength(1);
  });
});

describe('POST /api/auth/redeem-invite', () => {
  it('returns 401 for unknown code', async () => {
    const res = await request(app)
      .post('/api/auth/redeem-invite')
      .send({ inviteCode: 'XXXXXX' });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Invalid invite code');
  });

  it('returns 401 for expired code', async () => {
    const tech = await seedTech();
    const expiredAt = new Date(Date.now() - 1000).toISOString();
    await pool.query(
      `INSERT INTO invite_codes (code, technician_id, expires_at) VALUES ('EXPIRY', $1, $2)`,
      [tech.id, expiredAt]
    );
    const res = await request(app)
      .post('/api/auth/redeem-invite')
      .send({ inviteCode: 'EXPIRY' });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Invite code has expired');
  });

  it('exchanges valid code for device token and deletes code', async () => {
    const tech = await seedTech();
    const expiresAt = new Date(Date.now() + 86400000).toISOString();
    await pool.query(
      `INSERT INTO invite_codes (code, technician_id, expires_at) VALUES ('VALID1', $1, $2)`,
      [tech.id, expiresAt]
    );

    const res = await request(app)
      .post('/api/auth/redeem-invite')
      .send({ inviteCode: 'VALID1' });

    expect(res.status).toBe(200);
    expect(res.body.deviceToken).toHaveLength(64);
    expect(res.body.technician.id).toBe(tech.id);
    expect(res.body.technician.name).toBe('Tech technician');
    expect(res.body.technician.role).toBe('technician');

    const remaining = await pool.query('SELECT * FROM invite_codes WHERE code = $1', ['VALID1']);
    expect(remaining.rows).toHaveLength(0);
  });
});

describe('POST /api/auth/revoke', () => {
  it('deletes all device tokens for a technician', async () => {
    const dispatcher = await seedDispatcher();
    const dispToken = await seedToken(dispatcher.id);
    const tech = await seedTech();
    await seedToken(tech.id);
    await seedToken(tech.id);

    const res = await request(app)
      .post('/api/auth/revoke')
      .set('Authorization', `Bearer ${dispToken}`)
      .send({ technicianId: tech.id });

    expect(res.status).toBe(200);
    expect(res.body.revoked).toBe(true);

    const remaining = await pool.query(
      'SELECT * FROM device_tokens WHERE technician_id = $1',
      [tech.id]
    );
    expect(remaining.rows).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run tests to confirm all fail**

```bash
npx jest tests/auth.test.js --no-coverage
```

Expected: All FAIL — `Cannot find module '../src/routes/auth'` or 404 errors.

- [ ] **Step 3: Implement `src/routes/auth.js`**

```javascript
const express = require('express');
const crypto = require('crypto');
const { pool } = require('../db/pool');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();

function generateCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  const bytes = crypto.randomBytes(6);
  for (const b of bytes) {
    code += chars[b % chars.length];
  }
  return code;
}

// POST /api/auth/generate-invite
router.post(
  '/generate-invite',
  authenticate,
  requireRole('owner', 'dispatcher'),
  async (req, res, next) => {
    try {
      const { technicianId } = req.body;

      const techResult = await pool.query(
        'SELECT id, is_active FROM technicians WHERE id = $1',
        [technicianId]
      );
      if (techResult.rows.length === 0) {
        return res.status(404).json({ error: 'Technician not found' });
      }
      if (!techResult.rows[0].is_active) {
        return res.status(400).json({
          error: 'Technician is inactive. Reactivate before generating an invite.',
        });
      }

      // Delete any existing unused invite for this technician
      await pool.query('DELETE FROM invite_codes WHERE technician_id = $1', [technicianId]);

      const code = generateCode();
      const expiresAt = new Date(Date.now() + 86400000).toISOString(); // 24h

      await pool.query(
        'INSERT INTO invite_codes (code, technician_id, expires_at) VALUES ($1, $2, $3)',
        [code, technicianId, expiresAt]
      );

      res.json({ inviteCode: code, expiresAt });
    } catch (err) {
      next(err);
    }
  }
);

// POST /api/auth/redeem-invite  (no auth)
router.post('/redeem-invite', async (req, res, next) => {
  try {
    const { inviteCode } = req.body;

    const inviteResult = await pool.query(
      'SELECT * FROM invite_codes WHERE code = $1',
      [inviteCode]
    );
    if (inviteResult.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid invite code' });
    }

    const invite = inviteResult.rows[0];
    if (new Date(invite.expires_at) < new Date()) {
      return res.status(401).json({ error: 'Invite code has expired' });
    }

    const deviceToken = crypto.randomBytes(32).toString('hex');
    const createdAt = new Date().toISOString();

    await pool.query(
      'INSERT INTO device_tokens (token, technician_id, created_at) VALUES ($1, $2, $3)',
      [deviceToken, invite.technician_id, createdAt]
    );

    await pool.query('DELETE FROM invite_codes WHERE code = $1', [inviteCode]);

    const techResult = await pool.query(
      'SELECT id, name, role FROM technicians WHERE id = $1',
      [invite.technician_id]
    );
    const technician = techResult.rows[0];

    res.json({ deviceToken, technician });
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/revoke
router.post(
  '/revoke',
  authenticate,
  requireRole('owner', 'dispatcher'),
  async (req, res, next) => {
    try {
      const { technicianId } = req.body;
      await pool.query('DELETE FROM device_tokens WHERE technician_id = $1', [technicianId]);
      res.json({ revoked: true });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
```

- [ ] **Step 4: Mount auth router in `src/index.js` BEFORE global authenticate**

Edit `src/index.js` to add the auth routes before `app.use(authenticate)`:
```javascript
require('dotenv').config();
const express = require('express');
const { pool } = require('./db/pool');
const { authenticate } = require('./middleware/auth');

const app = express();
app.use(express.json());

// Health check — unauthenticated
app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', db: 'connected' });
  } catch (err) {
    res.status(503).json({ status: 'error', db: 'unreachable', message: err.message });
  }
});

// Auth routes — mounted BEFORE global authenticate so redeem-invite needs no token
app.use('/api/auth', require('./routes/auth'));

// All routes below require a valid bearer token
app.use(authenticate);

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

> Note: `if (require.main === module)` guard prevents the server from starting when imported by tests. `module.exports = app` lets supertest import it.

- [ ] **Step 5: Run auth tests**

```bash
npx jest tests/auth.test.js --no-coverage
```

Expected: All PASS

- [ ] **Step 6: Commit**

```bash
git add src/routes/auth.js src/index.js tests/auth.test.js
git commit -m "feat: add auth routes (generate-invite, redeem-invite, revoke)"
```

---

## Task 4: Technician Routes

**Files:**
- Create: `src/routes/technicians.js`
- Modify: `src/index.js` (mount under `/api/dispatch`)

**Interfaces:**
- Consumes: `pool`, `requireRole`, `createNotification` from `../helpers/notify`
- Produces: `POST /api/dispatch/technicians`, `GET /api/dispatch/technicians`, `PATCH /api/dispatch/technicians/:id/deactivate`, `PATCH /api/dispatch/technicians/:id/reactivate`

> **Schema note:** `notifications.body` stores the message text. The deactivate endpoint notifies all active dispatchers/owners (not just one).

- [ ] **Step 1: Write failing tests**

Create `tests/technicians.test.js`:
```javascript
const request = require('supertest');
const crypto = require('crypto');
const app = require('../src/index');
const { pool, truncateTables } = require('./helpers/db');

beforeEach(truncateTables);
afterAll(() => pool.end());

async function seedTech({ role = 'technician', isActive = true, name = 'Alice' } = {}) {
  const r = await pool.query(
    `INSERT INTO technicians (id, name, role, is_active, created_at)
     VALUES (gen_random_uuid()::text, $1, $2, $3, $4)
     RETURNING id, name, role, is_active, created_at`,
    [name, role, isActive, new Date().toISOString()]
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

async function dispatcherToken() {
  const d = await seedTech({ role: 'dispatcher', name: 'Dispatcher' });
  return { dispatcher: d, token: await seedToken(d.id) };
}

describe('POST /api/dispatch/technicians', () => {
  it('creates technician and returns it', async () => {
    const { token } = await dispatcherToken();
    const res = await request(app)
      .post('/api/dispatch/technicians')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Bob', role: 'technician' });

    expect(res.status).toBe(201);
    expect(res.body.id).toBeDefined();
    expect(res.body.name).toBe('Bob');
    expect(res.body.role).toBe('technician');
    expect(res.body.isActive).toBe(true);
    expect(res.body.createdAt).toBeDefined();
  });

  it('returns 400 for invalid role', async () => {
    const { token } = await dispatcherToken();
    const res = await request(app)
      .post('/api/dispatch/technicians')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Bob', role: 'superadmin' });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/dispatch/technicians', () => {
  it('returns only active technicians by default', async () => {
    const { token } = await dispatcherToken();
    await seedTech({ name: 'Active1' });
    await seedTech({ name: 'Inactive1', isActive: false });

    const res = await request(app)
      .get('/api/dispatch/technicians')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    const names = res.body.map((t) => t.name);
    expect(names).toContain('Active1');
    expect(names).toContain('Dispatcher');
    expect(names).not.toContain('Inactive1');
  });

  it('returns all technicians when includeInactive=true', async () => {
    const { token } = await dispatcherToken();
    await seedTech({ name: 'Active1' });
    await seedTech({ name: 'Inactive1', isActive: false });

    const res = await request(app)
      .get('/api/dispatch/technicians?includeInactive=true')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    const names = res.body.map((t) => t.name);
    expect(names).toContain('Inactive1');
  });
});

describe('PATCH /api/dispatch/technicians/:id/deactivate', () => {
  it('sets is_active to false and returns orphanedVisitIds', async () => {
    const { token } = await dispatcherToken();
    const tech = await seedTech({ name: 'TechToDeactivate' });

    const res = await request(app)
      .patch(`/api/dispatch/technicians/${tech.id}/deactivate`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.isActive).toBe(false);
    expect(res.body.orphanedVisitIds).toEqual([]);

    const row = await pool.query('SELECT is_active FROM technicians WHERE id = $1', [tech.id]);
    expect(row.rows[0].is_active).toBe(false);
  });
});

describe('PATCH /api/dispatch/technicians/:id/reactivate', () => {
  it('sets is_active to true', async () => {
    const { token } = await dispatcherToken();
    const tech = await seedTech({ name: 'InactiveTech', isActive: false });

    const res = await request(app)
      .patch(`/api/dispatch/technicians/${tech.id}/reactivate`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.isActive).toBe(true);

    const row = await pool.query('SELECT is_active FROM technicians WHERE id = $1', [tech.id]);
    expect(row.rows[0].is_active).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to confirm failure**

```bash
npx jest tests/technicians.test.js --no-coverage
```

Expected: All FAIL — 404 for missing routes.

- [ ] **Step 3: Implement `src/routes/technicians.js`**

```javascript
const express = require('express');
const { pool } = require('../db/pool');
const { requireRole } = require('../middleware/auth');
const { createNotification } = require('../helpers/notify');

const router = express.Router();
const VALID_ROLES = ['owner', 'dispatcher', 'technician'];

// POST /api/dispatch/technicians
router.post('/', requireRole('owner', 'dispatcher'), async (req, res, next) => {
  try {
    const { name, role } = req.body;
    if (!VALID_ROLES.includes(role)) {
      return res.status(400).json({ error: `role must be one of: ${VALID_ROLES.join(', ')}` });
    }

    const createdAt = new Date().toISOString();
    const result = await pool.query(
      `INSERT INTO technicians (id, name, role, is_active, created_at)
       VALUES (gen_random_uuid()::text, $1, $2, true, $3)
       RETURNING id, name, role, is_active, created_at`,
      [name, role, createdAt]
    );
    const row = result.rows[0];

    res.status(201).json({
      id: row.id,
      name: row.name,
      role: row.role,
      isActive: row.is_active,
      createdAt: row.created_at,
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/dispatch/technicians
router.get('/', requireRole('owner', 'dispatcher'), async (req, res, next) => {
  try {
    const includeInactive = req.query.includeInactive === 'true';
    const query = includeInactive
      ? 'SELECT id, name, role, is_active, created_at FROM technicians ORDER BY created_at'
      : 'SELECT id, name, role, is_active, created_at FROM technicians WHERE is_active = true ORDER BY created_at';

    const result = await pool.query(query);
    res.json(
      result.rows.map((r) => ({
        id: r.id,
        name: r.name,
        role: r.role,
        isActive: r.is_active,
        createdAt: r.created_at,
      }))
    );
  } catch (err) {
    next(err);
  }
});

// PATCH /api/dispatch/technicians/:id/deactivate
router.patch('/:id/deactivate', requireRole('owner', 'dispatcher'), async (req, res, next) => {
  try {
    const { id } = req.params;

    const techResult = await pool.query(
      'UPDATE technicians SET is_active = false WHERE id = $1 RETURNING name',
      [id]
    );
    if (techResult.rows.length === 0) {
      return res.status(404).json({ error: 'Technician not found' });
    }
    const { name } = techResult.rows[0];

    // Find visits now orphaned
    const visitResult = await pool.query(
      `SELECT id FROM visits WHERE technician_id = $1 AND status IN ('assigned', 'in_progress')`,
      [id]
    );
    const orphanedVisitIds = visitResult.rows.map((r) => r.id);

    if (orphanedVisitIds.length > 0) {
      // Notify all active dispatchers and owners
      const staffResult = await pool.query(
        `SELECT id FROM technicians WHERE role IN ('owner', 'dispatcher') AND is_active = true`
      );
      const message = `Technician ${name} was deactivated. ${orphanedVisitIds.length} visit(s) are now unassigned: ${orphanedVisitIds.join(', ')}`;
      for (const staff of staffResult.rows) {
        await createNotification(pool, {
          recipientId: staff.id,
          type: 'technician_deactivated',
          message,
        });
      }
    }

    res.json({ id, isActive: false, orphanedVisitIds });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/dispatch/technicians/:id/reactivate
router.patch('/:id/reactivate', requireRole('owner', 'dispatcher'), async (req, res, next) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      'UPDATE technicians SET is_active = true WHERE id = $1 RETURNING id',
      [id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Technician not found' });
    }
    res.json({ id, isActive: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
```

- [ ] **Step 4: Mount in `src/index.js`** — add after the existing auth mount:

```javascript
app.use('/api/dispatch/technicians', require('./routes/technicians'));
```

Place this line after `app.use(authenticate)`.

- [ ] **Step 5: Run tests**

```bash
npx jest tests/technicians.test.js --no-coverage
```

Expected: All PASS

- [ ] **Step 6: Commit**

```bash
git add src/routes/technicians.js src/index.js tests/technicians.test.js
git commit -m "feat: add technician lifecycle routes"
```

---

## Task 5: Notification Routes

**Files:**
- Create: (tests already started in Task 2; add route tests)
- Create: `src/routes/notifications.js`
- Modify: `src/index.js`

**Interfaces:**
- Consumes: `pool`, `req.technician.id` from auth middleware, `createNotification`
- Produces: `GET /api/notifications/mine`, `PATCH /api/notifications/:id/mark-read`

> **Schema note:** DB column `body` → API field `message`; `link_to` → `linkTo`; `created_at` → `createdAt`. `payload` is stored as a JSON text string — parse it before returning.

- [ ] **Step 1: Expand `tests/notifications.test.js` with route tests**

Add to the existing `tests/notifications.test.js` (below the helper test):
```javascript
const crypto = require('crypto');

async function seedTech({ role = 'technician', name = 'Alice' } = {}) {
  const r = await pool.query(
    `INSERT INTO technicians (id, name, role, is_active, created_at)
     VALUES (gen_random_uuid()::text, $1, $2, true, $3)
     RETURNING id`,
    [name, role, new Date().toISOString()]
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

describe('GET /api/notifications/mine', () => {
  it('returns empty array when no notifications exist', async () => {
    const tech = await seedTech();
    const token = await seedToken(tech.id);

    const res = await request(app)
      .get('/api/notifications/mine')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('returns only caller notifications, newest first', async () => {
    const tech = await seedTech();
    const token = await seedToken(tech.id);
    const other = await seedTech({ name: 'Bob' });

    await createNotification(pool, { recipientId: tech.id, type: 'a', message: 'First' });
    await createNotification(pool, { recipientId: tech.id, type: 'b', message: 'Second' });
    await createNotification(pool, { recipientId: other.id, type: 'c', message: 'Other' });

    const res = await request(app)
      .get('/api/notifications/mine')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[0].message).toBe('Second');
    expect(res.body[1].message).toBe('First');
  });

  it('filters by unreadOnly=true', async () => {
    const tech = await seedTech();
    const token = await seedToken(tech.id);

    const n = await createNotification(pool, { recipientId: tech.id, type: 'a', message: 'Unread' });
    await pool.query('INSERT INTO notifications (id, recipient_id, type, body, read, created_at) VALUES (gen_random_uuid()::text, $1, $2, $3, true, $4)', [tech.id, 'b', 'Read', new Date().toISOString()]);

    const res = await request(app)
      .get('/api/notifications/mine?unreadOnly=true')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].message).toBe('Unread');
  });
});

describe('PATCH /api/notifications/:id/mark-read', () => {
  it('marks notification as read', async () => {
    const tech = await seedTech();
    const token = await seedToken(tech.id);
    const n = await createNotification(pool, { recipientId: tech.id, type: 'a', message: 'M' });

    const res = await request(app)
      .patch(`/api/notifications/${n.id}/mark-read`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.read).toBe(true);
  });

  it('returns 403 for notification belonging to another user', async () => {
    const tech = await seedTech();
    const token = await seedToken(tech.id);
    const other = await seedTech({ name: 'Bob' });
    const n = await createNotification(pool, { recipientId: other.id, type: 'a', message: 'M' });

    const res = await request(app)
      .patch(`/api/notifications/${n.id}/mark-read`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 2: Run to confirm new tests fail**

```bash
npx jest tests/notifications.test.js --no-coverage
```

Expected: Helper test PASS, new route tests FAIL (404).

- [ ] **Step 3: Implement `src/routes/notifications.js`**

```javascript
const express = require('express');
const { pool } = require('../db/pool');

const router = express.Router();

// GET /api/notifications/mine
router.get('/mine', async (req, res, next) => {
  try {
    const { id } = req.technician;
    const unreadOnly = req.query.unreadOnly === 'true';

    const query = unreadOnly
      ? `SELECT id, type, body, link_to, payload, read, created_at
         FROM notifications
         WHERE recipient_id = $1 AND read = false
         ORDER BY created_at DESC`
      : `SELECT id, type, body, link_to, payload, read, created_at
         FROM notifications
         WHERE recipient_id = $1
         ORDER BY created_at DESC`;

    const result = await pool.query(query, [id]);

    res.json(
      result.rows.map((r) => ({
        id: r.id,
        type: r.type,
        message: r.body,
        linkTo: r.link_to,
        payload: r.payload ? JSON.parse(r.payload) : null,
        read: r.read,
        createdAt: r.created_at,
      }))
    );
  } catch (err) {
    next(err);
  }
});

// PATCH /api/notifications/:id/mark-read
router.patch('/:id/mark-read', async (req, res, next) => {
  try {
    const notifId = req.params.id;
    const { id: callerId } = req.technician;

    const check = await pool.query(
      'SELECT recipient_id FROM notifications WHERE id = $1',
      [notifId]
    );
    if (check.rows.length === 0) {
      return res.status(404).json({ error: 'Notification not found' });
    }
    if (check.rows[0].recipient_id !== callerId) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    await pool.query('UPDATE notifications SET read = true WHERE id = $1', [notifId]);
    res.json({ id: notifId, read: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
```

- [ ] **Step 4: Mount in `src/index.js`**

Add after `app.use(authenticate)`:
```javascript
app.use('/api/notifications', require('./routes/notifications'));
```

- [ ] **Step 5: Run all notification tests**

```bash
npx jest tests/notifications.test.js --no-coverage
```

Expected: All PASS

- [ ] **Step 6: Commit**

```bash
git add src/routes/notifications.js src/index.js tests/notifications.test.js
git commit -m "feat: add notification routes (mine, mark-read)"
```

---

## Task 6: Sync Route

**Files:**
- Create: `src/routes/sync.js`
- Create: `tests/sync.test.js`
- Modify: `src/index.js`

**Interfaces:**
- Consumes: `pool`, `req.technician.{ id, role }`
- Produces: `GET /api/sync/changes?since=<ISO8601>`

> **Schema notes:**
> - `visits` has no `updated_at` before migration; after Task 1 migration it exists but will be NULL for existing rows — filter `COALESCE(updated_at, created_at) > since`.
> - `corrections` uses `requested_at` as creation time (no separate `created_at`). Use `requested_at > since` throughout for corrections.
> - For technician role: `visits` filtered by `technician_id = req.technician.id`; for owner/dispatcher: all visits.
> - `chat_messages` for broadcast (type = 'broadcast', recipient_id IS NULL) are included for all users — the schema check is `recipient_id = id OR sender_id = id` but broadcast messages have no recipient. Include broadcast messages with `created_at > since` for all roles.

- [ ] **Step 1: Write failing tests**

Create `tests/sync.test.js`:
```javascript
const request = require('supertest');
const crypto = require('crypto');
const app = require('../src/index');
const { pool, truncateTables } = require('./helpers/db');

beforeEach(truncateTables);
afterAll(() => pool.end());

async function seedTech({ role = 'technician', name = 'Alice' } = {}) {
  const r = await pool.query(
    `INSERT INTO technicians (id, name, role, is_active, created_at)
     VALUES (gen_random_uuid()::text, $1, $2, true, $3)
     RETURNING id`,
    [name, role, new Date().toISOString()]
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

describe('GET /api/sync/changes', () => {
  it('returns 400 when since is missing', async () => {
    const tech = await seedTech();
    const token = await seedToken(tech.id);

    const res = await request(app)
      .get('/api/sync/changes')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Missing required query param: since');
  });

  it('returns empty arrays and serverTime for fresh DB', async () => {
    const tech = await seedTech();
    const token = await seedToken(tech.id);

    const res = await request(app)
      .get('/api/sync/changes?since=2026-01-01T00:00:00Z')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.visits).toEqual([]);
    expect(res.body.notifications).toEqual([]);
    expect(res.body.chatMessages).toEqual([]);
    expect(res.body.corrections).toEqual([]);
    expect(res.body.serverTime).toBeDefined();
  });

  it('returns notifications created after since', async () => {
    const tech = await seedTech();
    const token = await seedToken(tech.id);
    const { createNotification } = require('../src/helpers/notify');

    const since = new Date(Date.now() - 5000).toISOString();
    await createNotification(pool, { recipientId: tech.id, type: 'test', message: 'New notif' });

    const res = await request(app)
      .get(`/api/sync/changes?since=${encodeURIComponent(since)}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.notifications).toHaveLength(1);
    expect(res.body.notifications[0].body).toBe('New notif');
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
npx jest tests/sync.test.js --no-coverage
```

Expected: All FAIL — 404.

- [ ] **Step 3: Implement `src/routes/sync.js`**

```javascript
const express = require('express');
const { pool } = require('../db/pool');

const router = express.Router();

// GET /api/sync/changes?since=<ISO8601>
router.get('/changes', async (req, res, next) => {
  try {
    const { since } = req.query;
    if (!since) {
      return res.status(400).json({ error: 'Missing required query param: since' });
    }

    const { id: callerId, role } = req.technician;
    const isTech = role === 'technician';

    // Visits
    const visitQuery = isTech
      ? `SELECT * FROM visits
         WHERE technician_id = $1
           AND COALESCE(updated_at, created_at) > $2`
      : `SELECT * FROM visits
         WHERE COALESCE(updated_at, created_at) > $2`;
    const visitParams = isTech ? [callerId, since] : [since];
    // Adjust param index for non-technician query (only one param)
    const visitResult = await pool.query(
      isTech
        ? `SELECT * FROM visits WHERE technician_id = $1 AND COALESCE(updated_at, created_at) > $2`
        : `SELECT * FROM visits WHERE COALESCE(updated_at, created_at) > $1`,
      isTech ? [callerId, since] : [since]
    );

    // Notifications for caller
    const notifResult = await pool.query(
      `SELECT * FROM notifications WHERE recipient_id = $1 AND created_at > $2`,
      [callerId, since]
    );

    // Chat messages: direct messages involving caller OR broadcast messages
    const chatResult = await pool.query(
      `SELECT * FROM chat_messages
       WHERE created_at > $1
         AND (
           sender_id = $2
           OR recipient_id = $2
           OR type = 'broadcast'
         )`,
      [since, callerId]
    );

    // Corrections
    const corrResult = isTech
      ? await pool.query(
          `SELECT * FROM corrections WHERE requested_by = $1 AND requested_at > $2`,
          [callerId, since]
        )
      : await pool.query(
          `SELECT * FROM corrections WHERE status = 'pending' AND requested_at > $1`,
          [since]
        );

    res.json({
      visits: visitResult.rows,
      notifications: notifResult.rows,
      chatMessages: chatResult.rows,
      corrections: corrResult.rows,
      serverTime: new Date().toISOString(),
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
```

- [ ] **Step 4: Mount in `src/index.js`**

Add after `app.use(authenticate)`:
```javascript
app.use('/api/sync', require('./routes/sync'));
```

- [ ] **Step 5: Run sync tests**

```bash
npx jest tests/sync.test.js --no-coverage
```

Expected: All PASS

- [ ] **Step 6: Full test suite**

```bash
npx jest --no-coverage
```

Expected: All tests across all files PASS.

- [ ] **Step 7: Commit**

```bash
git add src/routes/sync.js src/index.js tests/sync.test.js
git commit -m "feat: add sync/changes polling endpoint"
```

---

## Task 7: Final Integration Verification

**Files:** No new files — verification only.

- [ ] **Step 1: Confirm final `src/index.js` shape**

After all tasks, `src/index.js` should look like this (verify it matches):
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

- [ ] **Step 2: Run full test suite**

```bash
npx jest --no-coverage
```

Expected: All tests PASS, zero failures.

- [ ] **Step 3: Start server and run spec's manual verification flows**

```bash
node src/index.js &

# 1. Create a technician
curl -s -X POST http://localhost:3001/api/dispatch/technicians \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer NEED_BOOTSTRAP_TOKEN" \
  -d '{"name":"Jane","role":"technician"}' | jq .

# 2. Generate invite
curl -s -X POST http://localhost:3001/api/auth/generate-invite \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer NEED_BOOTSTRAP_TOKEN" \
  -d '{"technicianId":"<id from step 1>"}' | jq .

# 3. Redeem invite
curl -s -X POST http://localhost:3001/api/auth/redeem-invite \
  -H "Content-Type: application/json" \
  -d '{"inviteCode":"<code from step 2>"}' | jq .

# 4. Use device token
curl -s http://localhost:3001/api/notifications/mine \
  -H "Authorization: Bearer <deviceToken from step 3>" | jq .

# 5. Sync
curl -s "http://localhost:3001/api/sync/changes?since=2026-01-01T00:00:00Z" \
  -H "Authorization: Bearer <deviceToken from step 3>" | jq .
```

> **Bootstrap token:** For step 1 you need an existing dispatcher token. Seed one directly in psql: `INSERT INTO technicians (id,name,role,is_active,created_at) VALUES (gen_random_uuid()::text,'Admin','dispatcher',true,now()::text); INSERT INTO device_tokens (token,technician_id,created_at) VALUES ('bootstrap','<id>',now()::text);`

- [ ] **Step 4: Final commit**

```bash
git add .
git commit -m "chore: phase 1 complete — auth, technicians, notifications, sync"
```

---

## Self-Review

**Spec coverage check:**

| Requirement | Task |
|---|---|
| `invite_codes` migration | Task 1 |
| `updated_at` on visits | Task 1 |
| `createNotification` helper | Task 2 |
| `POST /api/auth/generate-invite` | Task 3 |
| `POST /api/auth/redeem-invite` (no auth) | Task 3 |
| `POST /api/auth/revoke` | Task 3 |
| `POST /api/dispatch/technicians` | Task 4 |
| `GET /api/dispatch/technicians?includeInactive=` | Task 4 |
| `PATCH /api/dispatch/technicians/:id/deactivate` | Task 4 |
| `PATCH /api/dispatch/technicians/:id/reactivate` | Task 4 |
| Notify dispatchers/owners on deactivate | Task 4 |
| `GET /api/notifications/mine?unreadOnly=` | Task 5 |
| `PATCH /api/notifications/:id/mark-read` | Task 5 |
| `GET /api/sync/changes?since=` | Task 6 |
| Sync: visits (role-scoped) | Task 6 |
| Sync: notifications | Task 6 |
| Sync: chatMessages (direct + broadcast) | Task 6 |
| Sync: corrections (role-scoped) | Task 6 |
| Sync: serverTime | Task 6 |
| Mount all routes in index.js | Tasks 3–7 |

**No gaps found.**
