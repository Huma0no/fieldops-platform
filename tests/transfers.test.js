const request = require('supertest');
const app = require('../src/index');
const { pool, truncateTables } = require('./helpers/db');
const {
  seedTransferScenario,
  seedDispatcherWithToken,
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

  it('returns 400 if toTechnicianId is missing from body', async () => {
    const { token1, visitId } = await seedTransferScenario();
    const res = await request(app)
      .post(`/api/visits/${visitId}/transfer/initiate`)
      .set('Authorization', `Bearer ${token1}`)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('toTechnicianId');
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

  it('returns 400 when accepting a transfer for an already-completed visit', async () => {
    const { tech1, tech2, token2, visitId } = await seedTransferScenario();
    const transferId = await createPendingTransfer({ tech1, tech2, visitId });

    // Mark the visit as completed
    await pool.query(
      `UPDATE visits SET status = 'completed', completed_at = $1, updated_at = $1 WHERE id = $2`,
      [new Date().toISOString(), visitId]
    );

    const res = await request(app)
      .post(`/api/transfers/${transferId}/accept`)
      .set('Authorization', `Bearer ${token2}`);

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('closed');

    // visit.technician_id must NOT have changed
    const visit = await pool.query('SELECT technician_id FROM visits WHERE id = $1', [visitId]);
    expect(visit.rows[0].technician_id).toBe(tech1.id);
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
