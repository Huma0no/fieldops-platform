const fs = require('node:fs');
const path = require('node:path');

describe('Guided context from a FieldOps call', () => {
  let guidedContextFromVisit, pickableCalls, readGuidedContext, saveGuidedContext, GUIDED_CONTEXT_KEY;
  let guideAvailable, guide;

  beforeAll(async () => {
    ({ guidedContextFromVisit, pickableCalls, readGuidedContext, saveGuidedContext, GUIDED_CONTEXT_KEY } =
      await import('../frontend/pwa/src/lib/guided-context.mjs'));
    ({ guideAvailable } = await import('../frontend/guided/src/guide.mjs'));
    guide = JSON.parse(fs.readFileSync(path.join(__dirname, '../frontend/guided/data/ut3000-comm.guide.json'), 'utf8'));
  });

  const detail = {
    id: 'visit-1',
    address: { street: '111326 TEST' },
    systems: [{ systemNumber: 1, indoorModel: 'DR96TC', outdoorModel: 'DC6VS', coilModel: 'CHPEA' }],
    items: [
      { itemName: 'UT3000', category: 'accessory', quantity: 1 },
      { itemName: 'DAPC', category: 'accessory', quantity: 1 },
      { itemName: 'Daikin One', category: 'thermostat', quantity: 3 },
    ],
  };

  it('reads zones, DAPC, equipment and models from the visit detail', () => {
    expect(guidedContextFromVisit(detail)).toEqual({
      visitId: 'visit-1',
      label: '111326 TEST',
      zones: 3,
      dapc: true,
      equipment: { board: 'UT3000', thermostat: 'Daikin One' },
      models: { indoor: 'DR96TC', outdoor: 'DC6VS', coil: 'CHPEA' },
    });
  });

  it('reads the Workspace draft item shape', () => {
    const draft = { id: 'visit-2', _items: [
      { item_name: 'UT3000', category: 'accessory', quantity: 1 },
      { item_name: 'Daikin One', category: 'thermostat', quantity: 2 },
    ] };
    expect(guidedContextFromVisit(draft)).toMatchObject({ zones: 2, dapc: false, equipment: { board: 'UT3000', thermostat: 'Daikin One' } });
  });

  it('offers the communicating guide only for UT3000 with Daikin One thermostats', () => {
    expect(guideAvailable(guide, guidedContextFromVisit(detail).equipment)).toBe(true);
    const ecobee = { ...detail, items: [{ itemName: 'UT3000', category: 'accessory' }, { itemName: 'Ecobee', category: 'thermostat', quantity: 2 }] };
    expect(guideAvailable(guide, guidedContextFromVisit(ecobee).equipment)).toBe(false);
    const noBoard = { ...detail, items: [{ itemName: 'Daikin One', category: 'thermostat', quantity: 1 }] };
    expect(guideAvailable(guide, guidedContextFromVisit(noBoard).equipment)).toBe(false);
  });

  it('lists only open calls in the picker', () => {
    expect(pickableCalls([
      { id: 'a', status: 'assigned', address: { street: 'A St' } },
      { id: 'b', status: 'in_progress', orderNumber: '42' },
      { id: 'c', status: 'completed', address: { street: 'C St' } },
    ])).toEqual([{ id: 'a', label: 'A St' }, { id: 'b', label: '42' }]);
  });

  it('stores and reads the active call, ignoring unreadable values', () => {
    const values = new Map();
    const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
    expect(readGuidedContext(storage)).toBeNull();
    saveGuidedContext(storage, guidedContextFromVisit(detail));
    expect(readGuidedContext(storage)).toMatchObject({ visitId: 'visit-1', zones: 3 });
    values.set(GUIDED_CONTEXT_KEY, '{broken');
    expect(readGuidedContext(storage)).toBeNull();
  });
});
