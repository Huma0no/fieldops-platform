// menu-badge.mjs is a plain ESM module (frontend, no bundler in this test run) —
// dynamic import() lets this CommonJS test load it without any Jest/babel config.
async function loadComputeMenuBadgeCount () {
  const mod = await import('../frontend/pwa/src/lib/menu-badge.mjs');
  return mod.computeMenuBadgeCount;
}

describe('computeMenuBadgeCount', () => {
  it('sums multiple pending sources', async () => {
    const computeMenuBadgeCount = await loadComputeMenuBadgeCount();
    expect(computeMenuBadgeCount([2, 3])).toBe(5);
  });

  it('returns 0 for an empty list', async () => {
    const computeMenuBadgeCount = await loadComputeMenuBadgeCount();
    expect(computeMenuBadgeCount([])).toBe(0);
  });

  it('returns 0 when every source is zero', async () => {
    const computeMenuBadgeCount = await loadComputeMenuBadgeCount();
    expect(computeMenuBadgeCount([0, 0])).toBe(0);
  });

  it('ignores negative values instead of subtracting them', async () => {
    const computeMenuBadgeCount = await loadComputeMenuBadgeCount();
    expect(computeMenuBadgeCount([5, -3])).toBe(5);
  });

  it('ignores non-finite values (NaN, Infinity, undefined)', async () => {
    const computeMenuBadgeCount = await loadComputeMenuBadgeCount();
    expect(computeMenuBadgeCount([4, NaN, Infinity, undefined])).toBe(4);
  });

  it('reflects a single contributing source (todays only real case: Transfers)', async () => {
    const computeMenuBadgeCount = await loadComputeMenuBadgeCount();
    expect(computeMenuBadgeCount([3])).toBe(3);
    expect(computeMenuBadgeCount([0])).toBe(0);
  });
});
