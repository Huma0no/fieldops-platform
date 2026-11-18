const { compareSubmission, reportContentMatchesSubmission } = require('../src/services/report');

const accepted = {
  orderNumber: 'ORD-1', scheduledDate: '2026-11-12', scheduledTime: '09:00',
  propertyId: 'property-1', workType: 'service', hasMultipleSystems: true,
  terminalIntent: 'completed', totalPrice: 45,
  address: { street: '1 Main', city: 'Houston', state: 'TX', zip: '77001', subdivision: 'North', builder: 'Builder' },
  services: [{ serviceName: 'AC', isFinish: false, isTemporarily: false, price: 30 }],
  items: [{ itemName: 'Filter', category: 'accessory', description: null, quantity: 1, price: 15, techSupplied: false }],
  systems: [{ systemNumber: 1, indoorModel: 'I-1', outdoorModel: 'O-1', coilModel: 'C-1', refrigerant: 'R-410A' }],
  weighInData: [{
    systemNumber: 1, linesetLength: 25, factoryChargeOz: 80, factoryLineConfig: 'L1',
    approxAdjustOz: 6, adjustedOz: 86, fanSpeedCfm: 1200, liquidLineTemp: 95,
    suctionLineTemp: 110, condenserSatTemp: 120, subcoolingValue: 25,
    oemSubcoolingGoal: 10, subcoolingDeviation: 15,
  }],
  notes: 'Reviewed note', checklistAnswers: [{ answer: 'no', reportText: 'Drain needs work' }],
  photoEvidence: [{ id: 'photo-1', slug: 'scale-1', tag: 'SCALE', label: null, category: 'weigh_in_scale', system_number: 1, stored_at: 'stored-1' }],
};

const submission = () => ({
  orderNumber: accepted.orderNumber, scheduledDate: accepted.scheduledDate, scheduledTime: accepted.scheduledTime,
  propertyId: accepted.propertyId, workType: accepted.workType, hasMultipleSystems: accepted.hasMultipleSystems,
  terminalIntent: accepted.terminalIntent, totalPrice: accepted.totalPrice,
  address: { ...accepted.address },
  service: { serviceName: 'AC', isFinish: false, isTemporarily: false, price: 30 },
  items: accepted.items.map(row => ({ ...row })), systems: accepted.systems.map(row => ({ ...row })),
  weighInData: accepted.weighInData.map(row => ({ ...row })), notes: accepted.notes,
  checklistAnswers: accepted.checklistAnswers.map(row => ({ ...row })),
  evidenceRefs: [{ id: 'photo-1', slug: 'scale-1', tag: 'SCALE', label: null, category: 'weigh_in_scale', systemNumber: 1, storedAt: 'stored-1' }],
});

describe('reportContentMatchesSubmission', () => {
  it('accepts matching reviewed Report content', () => {
    expect(reportContentMatchesSubmission(submission(), accepted)).toBe(true);
  });

  const cases = [
    ['order number', s => { delete s.orderNumber }, s => { s.orderNumber = 'ORD-2' }],
    ['scheduled date', s => { delete s.scheduledDate }, s => { s.scheduledDate = '2026-11-13' }],
    ['scheduled time', s => { delete s.scheduledTime }, s => { s.scheduledTime = '10:00' }],
    ['property', s => { delete s.propertyId }, s => { s.propertyId = 'property-2' }],
    ['work type', s => { delete s.workType }, s => { s.workType = 'startup' }],
    ['system count flag', s => { delete s.hasMultipleSystems }, s => { s.hasMultipleSystems = false }],
    ['terminal intent', s => { delete s.terminalIntent }, s => { s.terminalIntent = 'temporarily' }],
    ...Object.keys(accepted.address).flatMap(field => [
      [`address ${field} omission`, s => { delete s.address[field] }, null],
      [`address ${field} mismatch`, null, s => { s.address[field] = `changed ${field}` }],
    ]),
    ...[['serviceName', 'Heat'], ['isFinish', true], ['isTemporarily', true]].flatMap(([field, value]) => [
      [`service ${field} omission`, s => { delete s.service[field] }, null],
      [`service ${field} mismatch`, null, s => { s.service[field] = value }],
    ]),
    ...['itemName', 'category', 'description', 'quantity'].flatMap(field => [
      [`item ${field} omission`, s => { delete s.items[0][field] }, null],
      [`item ${field} mismatch`, null, s => { s.items[0][field] = field === 'quantity' ? 99 : 'changed' }],
    ]),
    ...['systemNumber', 'indoorModel', 'outdoorModel', 'coilModel', 'refrigerant'].flatMap(field => [
      [`system ${field} omission`, s => { delete s.systems[0][field] }, null],
      [`system ${field} mismatch`, null, s => { s.systems[0][field] = 'changed' }],
    ]),
    ['notes omission', s => { delete s.notes }, null],
    ['notes mismatch', null, s => { s.notes = 'different note' }],
    ['checklist finding omission', s => { delete s.checklistAnswers[0].reportText }, null],
    ['checklist finding mismatch', null, s => { s.checklistAnswers[0].reportText = 'different finding' }],
    ...['id', 'slug', 'tag', 'label', 'category', 'systemNumber'].flatMap(field => [
      [`photo ${field} omission`, s => { delete s.evidenceRefs[0][field] }, null],
      [`photo ${field} mismatch`, null, s => { s.evidenceRefs[0][field] = 'changed' }],
    ]),
  ];

  it.each(cases)('rejects a missing or changed visible %s', (_label, omit, change) => {
    if (omit) {
      const candidate = submission();
      omit(candidate);
      expect(reportContentMatchesSubmission(candidate, accepted)).toBe(false);
    }
    if (change) {
      const candidate = submission();
      change(candidate);
      expect(reportContentMatchesSubmission(candidate, accepted)).toBe(false);
    }
  });

  // Weigh-In never rejects: the phone's readings are stored as sent and the
  // earlier values become discrepancies (completion route).
  it('accepts a Report whose Weigh-In differs from the server or is missing', () => {
    const changed = submission();
    changed.weighInData[0].adjustedOz = 999;
    expect(reportContentMatchesSubmission(changed, accepted)).toBe(true);
    const missing = submission();
    missing.weighInData = [];
    expect(reportContentMatchesSubmission(missing, accepted)).toBe(true);
  });

  it('accepts a photo the server has not stored yet (it arrives after the Report)', () => {
    const candidate = submission();
    candidate.evidenceRefs[0].storedAt = null;
    expect(compareSubmission(candidate, accepted)).toEqual({ mismatches: [], discrepancies: [] });
  });

  it('names the differing field', () => {
    const candidate = submission();
    candidate.items[0].quantity = 3;
    candidate.notes = 'different note';
    expect(compareSubmission(candidate, accepted).mismatches).toEqual(['items.quantity', 'notes']);
  });

  // PP-01: catalog-derived values that differ are accepted, keeping both values.
  it.each([
    ['total price', s => { s.totalPrice = 46 }, { field: 'totalPrice', submitted: 46, accepted: 45 }],
    ['service price', s => { s.service.price = 31 }, { field: 'service.price', row: 'AC', submitted: 31, accepted: 30 }],
    ['item price', s => { s.items[0].price = 99 }, { field: 'items.price', row: 'Filter', submitted: 99, accepted: 15 }],
    ['item techSupplied', s => { s.items[0].techSupplied = true }, { field: 'items.techSupplied', row: 'Filter', submitted: true, accepted: false }],
  ])('accepts a different %s as a discrepancy', (_label, change, expected) => {
    const candidate = submission();
    change(candidate);
    const result = compareSubmission(candidate, accepted);
    expect(result.mismatches).toEqual([]);
    expect(result.discrepancies).toEqual([expected]);
  });
});
