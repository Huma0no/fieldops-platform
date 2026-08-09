// cancel-justification.mjs is a plain ESM module — dynamic import() lets this
// CommonJS test load it without any Jest/babel config (same pattern as
// menu-badge.test.js; npm test already runs with --experimental-vm-modules).
async function loadIsCancelJustificationMissing () {
  const mod = await import('../frontend/pwa/src/lib/cancel-justification.mjs');
  return mod.isCancelJustificationMissing;
}

describe('isCancelJustificationMissing', () => {
  it('blocks when both notes and checklist are empty', async () => {
    const isMissing = await loadIsCancelJustificationMissing();
    expect(isMissing({ notes: '', checklist: {} })).toBe(true);
    expect(isMissing({ notes: null, checklist: null })).toBe(true);
    expect(isMissing({ notes: '   ', checklist: {} })).toBe(true);
  });

  it('allows when only notes are filled in', async () => {
    const isMissing = await loadIsCancelJustificationMissing();
    expect(isMissing({ notes: 'Customer not present', checklist: {} })).toBe(false);
  });

  it('allows when only a checklist item is answered "no"', async () => {
    const isMissing = await loadIsCancelJustificationMissing();
    expect(isMissing({ notes: '', checklist: { gas_meter: 'no' } })).toBe(false);
  });

  it('allows when only a checklist item is answered "yes"', async () => {
    const isMissing = await loadIsCancelJustificationMissing();
    expect(isMissing({ notes: '', checklist: { pdrain_ecoil: 'yes' } })).toBe(false);
  });

  it('still counts as empty when a checklist item was toggled off (key present, value null)', async () => {
    const isMissing = await loadIsCancelJustificationMissing();
    expect(isMissing({ notes: '', checklist: { gas_meter: null } })).toBe(true);
  });

  it('allows when both notes and checklist are filled in', async () => {
    const isMissing = await loadIsCancelJustificationMissing();
    expect(isMissing({ notes: 'Resolved on arrival', checklist: { gas_meter: 'yes' } })).toBe(false);
  });
});
