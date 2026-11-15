const app = require('../src/index');
const { pool } = require('../src/db/pool');

afterAll(() => pool.end());

// Guards the jest.setup.js binding: supertest connects to 127.0.0.1, so the
// ephemeral test server must listen there, not on every interface.
it('binds the ephemeral test server to 127.0.0.1', async () => {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  expect(server.address().address).toBe('127.0.0.1');
  await new Promise(resolve => server.close(resolve));
});
