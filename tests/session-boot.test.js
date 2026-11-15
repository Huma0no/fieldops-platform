// Startup screen decision for the FieldOps PWA (frontend/pwa/src/lib/session-boot.mjs).
describe('FieldOps startup session decision', () => {
  let resolveBootScreen;
  const tech = { id: 'tech-001', role: 'TECHNICIAN', mustChangePassword: false };
  const httpError = status => Object.assign(new Error(`HTTP ${status}`), { status });

  beforeAll(async () => {
    ({ resolveBootScreen } = await import('../frontend/pwa/src/lib/session-boot.mjs'));
  });

  it('asks to sign in when no technician is stored', async () => {
    await expect(resolveBootScreen(null, async () => { throw new Error('not called'); })).resolves.toEqual({ screen: 'auth' });
  });

  it('opens the app and refreshes the stored user when the session is valid', async () => {
    const user = { ...tech, name: 'Fresh' };
    await expect(resolveBootScreen(tech, async () => ({ user }))).resolves.toEqual({ screen: 'app', user, store: true });
  });

  it('asks to sign in only when the server answers 401', async () => {
    await expect(resolveBootScreen(tech, async () => { throw httpError(401); })).resolves.toEqual({ screen: 'auth' });
  });

  it('keeps working with local data when the server cannot be reached', async () => {
    await expect(resolveBootScreen(tech, async () => { throw new TypeError('Failed to fetch'); }))
      .resolves.toEqual({ screen: 'app', user: tech });
    await expect(resolveBootScreen(tech, async () => { throw httpError(503); }))
      .resolves.toEqual({ screen: 'app', user: tech });
  });

  it('keeps a pending temporary-password change offline', async () => {
    const temp = { ...tech, mustChangePassword: true };
    await expect(resolveBootScreen(temp, async () => { throw new TypeError('Failed to fetch'); }))
      .resolves.toEqual({ screen: 'passwordChange', user: temp });
  });

  it('clears a stored account without FieldOps access', async () => {
    await expect(resolveBootScreen({ ...tech, role: 'DISPATCHER' }, async () => ({ user: tech }))).resolves.toEqual({ screen: 'auth', clear: true });
    await expect(resolveBootScreen(tech, async () => ({ user: { ...tech, role: 'DISPATCHER' } }))).resolves.toEqual({ screen: 'auth', clear: true });
  });
});
