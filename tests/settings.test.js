const request = require('supertest');
const app = require('../src/index');
const { pool, truncateTables } = require('./helpers/db');
const { seedTechnicianWithToken, seedDispatcherWithToken, seedCatalogItem } = require('./helpers/seeds');

beforeEach(truncateTables);
afterAll(() => pool.end());

async function seedCatalogService(serviceName) {
  await pool.query(
    `INSERT INTO catalog_services (service_name, default_price, is_bundle, multiplies_by_system_count)
     VALUES ($1, 100, false, false)
     ON CONFLICT (service_name) DO NOTHING`,
    [serviceName]
  );
}

// ── GET /api/technicians/me/settings ─────────────────────────────────────────

describe('GET /api/technicians/me/settings', () => {
  it('creates a default settings row on first call and returns it', async () => {
    const { token } = await seedTechnicianWithToken();

    const res = await request(app)
      .get('/api/technicians/me/settings')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.theme).toBe('dark');
    expect(res.body.aiProvider).toBe('anthropic');
    expect(res.body.onboardingCompleted).toBe(false);
    expect(res.body.hasKeyAnthropic).toBe(false);
    expect(res.body.hasKeyOpenai).toBe(false);
    expect(res.body.hasKeyGoogle).toBe(false);
  });

  it('returns same row on repeated calls (idempotent)', async () => {
    const { token } = await seedTechnicianWithToken();

    await request(app).get('/api/technicians/me/settings').set('Authorization', `Bearer ${token}`);
    const res = await request(app).get('/api/technicians/me/settings').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.theme).toBe('dark');
  });

  it('never returns raw API key values', async () => {
    const { tech, token } = await seedTechnicianWithToken();
    await pool.query(
      `INSERT INTO technician_settings (technician_id, theme, ai_provider, ai_api_key_anthropic, onboarding_completed)
       VALUES ($1, 'dark', 'anthropic', 'sk-secret', false)`,
      [tech.id]
    );

    const res = await request(app)
      .get('/api/technicians/me/settings')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.hasKeyAnthropic).toBe(true);
    expect(JSON.stringify(res.body)).not.toContain('sk-secret');
  });

  it('returns correct shape', async () => {
    const { token } = await seedTechnicianWithToken();

    const res = await request(app)
      .get('/api/technicians/me/settings')
      .set('Authorization', `Bearer ${token}`);

    expect(res.body).toHaveProperty('technicianId');
    expect(res.body).toHaveProperty('theme');
    expect(res.body).toHaveProperty('aiProvider');
    expect(res.body).toHaveProperty('hasKeyAnthropic');
    expect(res.body).toHaveProperty('hasKeyOpenai');
    expect(res.body).toHaveProperty('hasKeyGoogle');
    expect(res.body).toHaveProperty('onboardingCompleted');
    expect(res.body).not.toHaveProperty('aiApiKeyAnthropic');
    expect(res.body).not.toHaveProperty('aiApiKeyOpenai');
    expect(res.body).not.toHaveProperty('aiApiKeyGoogle');
  });

  it('is accessible to dispatcher role', async () => {
    const { token } = await seedDispatcherWithToken();
    const res = await request(app)
      .get('/api/technicians/me/settings')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
  });
});

// ── PATCH /api/technicians/me/settings ───────────────────────────────────────

describe('PATCH /api/technicians/me/settings', () => {
  it('updates theme', async () => {
    const { token } = await seedTechnicianWithToken();

    const res = await request(app)
      .patch('/api/technicians/me/settings')
      .set('Authorization', `Bearer ${token}`)
      .send({ theme: 'light' });

    expect(res.status).toBe(200);
    expect(res.body.theme).toBe('light');
  });

  it('stores API key and returns hasKey: true', async () => {
    const { token } = await seedTechnicianWithToken();

    const res = await request(app)
      .patch('/api/technicians/me/settings')
      .set('Authorization', `Bearer ${token}`)
      .send({ aiApiKeyAnthropic: 'sk-test-123' });

    expect(res.status).toBe(200);
    expect(res.body.hasKeyAnthropic).toBe(true);
    expect(JSON.stringify(res.body)).not.toContain('sk-test-123');
  });

  it('only updates provided fields — does not reset others', async () => {
    const { token } = await seedTechnicianWithToken();

    await request(app)
      .patch('/api/technicians/me/settings')
      .set('Authorization', `Bearer ${token}`)
      .send({ theme: 'terminal', aiApiKeyOpenai: 'openai-key' });

    const res = await request(app)
      .patch('/api/technicians/me/settings')
      .set('Authorization', `Bearer ${token}`)
      .send({ aiProvider: 'openai' });

    expect(res.status).toBe(200);
    expect(res.body.theme).toBe('terminal');
    expect(res.body.hasKeyOpenai).toBe(true);
    expect(res.body.aiProvider).toBe('openai');
  });

  it('updates onboardingCompleted', async () => {
    const { token } = await seedTechnicianWithToken();

    const res = await request(app)
      .patch('/api/technicians/me/settings')
      .set('Authorization', `Bearer ${token}`)
      .send({ onboardingCompleted: true });

    expect(res.status).toBe(200);
    expect(res.body.onboardingCompleted).toBe(true);
  });

  it('returns 400 for invalid theme', async () => {
    const { token } = await seedTechnicianWithToken();

    const res = await request(app)
      .patch('/api/technicians/me/settings')
      .set('Authorization', `Bearer ${token}`)
      .send({ theme: 'rainbow' });

    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid aiProvider', async () => {
    const { token } = await seedTechnicianWithToken();

    const res = await request(app)
      .patch('/api/technicians/me/settings')
      .set('Authorization', `Bearer ${token}`)
      .send({ aiProvider: 'gpt5' });

    expect(res.status).toBe(400);
  });
});

// ── GET /api/technicians/me/price-overrides ───────────────────────────────────

describe('GET /api/technicians/me/price-overrides', () => {
  it('returns empty array when no overrides exist', async () => {
    const { token } = await seedTechnicianWithToken();

    const res = await request(app)
      .get('/api/technicians/me/price-overrides')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('returns overrides for the authenticated technician only', async () => {
    const { tech, token } = await seedTechnicianWithToken();
    const { tech: other } = await seedTechnicianWithToken({ name: 'Other-Tech' });
    const itemName = 'MY-ITEM';
    await seedCatalogItem(itemName);

    await pool.query(
      `INSERT INTO technician_price_overrides (id, technician_id, item_name, override_price)
       VALUES (gen_random_uuid()::text, $1, $2, 75)`,
      [tech.id, itemName]
    );
    await pool.query(
      `INSERT INTO technician_price_overrides (id, technician_id, item_name, override_price)
       VALUES (gen_random_uuid()::text, $1, $2, 99)`,
      [other.id, itemName]
    );

    const res = await request(app)
      .get('/api/technicians/me/price-overrides')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].itemName).toBe(itemName);
    expect(res.body[0].overridePrice).toBe(75);
  });
});

// ── POST /api/technicians/me/price-overrides ──────────────────────────────────

describe('POST /api/technicians/me/price-overrides', () => {
  it('creates an override for a catalog_items entry', async () => {
    const { tech, token } = await seedTechnicianWithToken();
    await seedCatalogItem('FILTER-A');

    const res = await request(app)
      .post('/api/technicians/me/price-overrides')
      .set('Authorization', `Bearer ${token}`)
      .send({ itemName: 'FILTER-A', overridePrice: 35 });

    expect(res.status).toBe(200);
    expect(res.body.itemName).toBe('FILTER-A');
    expect(res.body.overridePrice).toBe(35);

    const row = await pool.query(
      `SELECT override_price FROM technician_price_overrides WHERE technician_id = $1 AND item_name = $2`,
      [tech.id, 'FILTER-A']
    );
    expect(row.rows[0].override_price).toBe(35);
  });

  it('creates an override for a catalog_services entry', async () => {
    const { token } = await seedTechnicianWithToken();
    await seedCatalogService('AC-EXTRA');

    const res = await request(app)
      .post('/api/technicians/me/price-overrides')
      .set('Authorization', `Bearer ${token}`)
      .send({ itemName: 'AC-EXTRA', overridePrice: 120 });

    expect(res.status).toBe(200);
    expect(res.body.itemName).toBe('AC-EXTRA');
    expect(res.body.overridePrice).toBe(120);
  });

  it('upserts on conflict — updates existing override', async () => {
    const { tech, token } = await seedTechnicianWithToken();
    await seedCatalogItem('FILTER-B');

    await request(app)
      .post('/api/technicians/me/price-overrides')
      .set('Authorization', `Bearer ${token}`)
      .send({ itemName: 'FILTER-B', overridePrice: 30 });

    const res = await request(app)
      .post('/api/technicians/me/price-overrides')
      .set('Authorization', `Bearer ${token}`)
      .send({ itemName: 'FILTER-B', overridePrice: 45 });

    expect(res.status).toBe(200);
    expect(res.body.overridePrice).toBe(45);

    const rows = await pool.query(
      `SELECT * FROM technician_price_overrides WHERE technician_id = $1 AND item_name = 'FILTER-B'`,
      [tech.id]
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0].override_price).toBe(45);
  });

  it('returns 400 for an item not in catalog_items or catalog_services', async () => {
    const { token } = await seedTechnicianWithToken();

    const res = await request(app)
      .post('/api/technicians/me/price-overrides')
      .set('Authorization', `Bearer ${token}`)
      .send({ itemName: 'NONEXISTENT-THING', overridePrice: 50 });

    expect(res.status).toBe(400);
  });
});

// ── DELETE /api/technicians/me/price-overrides/:itemName ──────────────────────

describe('DELETE /api/technicians/me/price-overrides/:itemName', () => {
  it('deletes the override and returns deleted: true', async () => {
    const { tech, token } = await seedTechnicianWithToken();
    await seedCatalogItem('DEL-ITEM');
    await pool.query(
      `INSERT INTO technician_price_overrides (id, technician_id, item_name, override_price)
       VALUES (gen_random_uuid()::text, $1, 'DEL-ITEM', 60)`,
      [tech.id]
    );

    const res = await request(app)
      .delete('/api/technicians/me/price-overrides/DEL-ITEM')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.deleted).toBe(true);
    expect(res.body.itemName).toBe('DEL-ITEM');

    const row = await pool.query(
      `SELECT * FROM technician_price_overrides WHERE technician_id = $1 AND item_name = 'DEL-ITEM'`,
      [tech.id]
    );
    expect(row.rows).toHaveLength(0);
  });

  it('returns 404 when no matching override exists', async () => {
    const { token } = await seedTechnicianWithToken();

    const res = await request(app)
      .delete('/api/technicians/me/price-overrides/MISSING-ITEM')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);
  });

  it('does not delete another technician\'s override', async () => {
    const { tech: other } = await seedTechnicianWithToken({ name: 'Other-Tech' });
    const { token } = await seedTechnicianWithToken({ name: 'Me-Tech' });
    await seedCatalogItem('SHARED-ITEM');
    await pool.query(
      `INSERT INTO technician_price_overrides (id, technician_id, item_name, override_price)
       VALUES (gen_random_uuid()::text, $1, 'SHARED-ITEM', 60)`,
      [other.id]
    );

    const res = await request(app)
      .delete('/api/technicians/me/price-overrides/SHARED-ITEM')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);

    const row = await pool.query(
      `SELECT * FROM technician_price_overrides WHERE technician_id = $1 AND item_name = 'SHARED-ITEM'`,
      [other.id]
    );
    expect(row.rows).toHaveLength(1);
  });
});
