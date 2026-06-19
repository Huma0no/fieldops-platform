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
