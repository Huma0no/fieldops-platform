const fs = require('fs/promises');
const path = require('path');

let receiptModel;
let describeReportMismatch;
let priceVisit;
let refreshCallData;

function asModule(source) {
  return `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
}

beforeAll(async () => {
  const read = file => fs.readFile(path.join(__dirname, '..', file), 'utf8');
  const pricingUrl = asModule(await read('frontend/shared/pricing.mjs'));
  ({ priceVisit } = await import(pricingUrl));
  ({ receiptModel } = await import(asModule((await read('frontend/pwa/src/lib/receipt.mjs'))
    .replace("'../../../shared/pricing.mjs'", `'${pricingUrl}'`))));
  const lib = file => read(`frontend/pwa/src/lib/${file}`);
  const submission = (await lib('completion-submission.mjs'))
    .replace("'./db.js'", `'${asModule(await lib('db.js'))}'`)
    .replace("'../../../shared/api.js'", `'${asModule('export const api = {};')}'`)
    .replace("'./cancel-justification.mjs'", `'${asModule(await lib('cancel-justification.mjs'))}'`)
    .replace("'./workspace-visit.mjs'", `'${asModule(await lib('workspace-visit.mjs'))}'`);
  ({ describeReportMismatch } = await import(asModule(submission)));
  ({ refreshCallData } = await import(asModule(await lib('workspace-visit.mjs'))));
});

const catalog = {
  services: [
    { service_name: 'AC', default_price: 30, multiplies_by_system_count: true },
    { service_name: 'Prestart', default_price: 20, multiplies_by_system_count: false },
  ],
  items: [
    { item_name: 'UT3000', category: 'accessory', default_price: 40 },
    { item_name: 'Float Switch', category: 'accessory', default_price: 5, multiplies_by_system_count: true },
    { item_name: 'T-6', category: 'thermostat', default_price: 0 },
    { item_name: 'Weight-In-Data', category: 'accessory', default_price: 10, finish_addon_price: 10 },
    { item_name: 'Pressure Test', category: 'fix', default_price: 25, finish_addon_price: 5 },
  ],
};

const snapshot = {
  address: { street: '4821 Cedar Hollow Ln', subdivision: 'Bridgeland', builder: 'Perry Homes' },
  createdAt: '2026-11-17T15:00:00.000Z',
  hasMultipleSystems: true,
  systems: [{ systemNumber: 1 }, { systemNumber: 2 }],
  services: [
    { systemNumber: 1, serviceName: 'AC', isFinish: true, isTemporarily: false, price: 20 },
    { systemNumber: 2, serviceName: 'Prestart', isFinish: false, isTemporarily: false, price: 20 },
  ],
  items: [
    { item_name: 'UT3000', category: 'accessory', quantity: 1, price: 35 },
    { item_name: 'Float Switch', category: 'accessory', quantity: 2, price: 5 },
    { item_name: 'T-6', category: 'thermostat', quantity: 2, price: 0 },
    { item_name: 'Weight-In-Data', category: 'accessory', quantity: 2, price: 20 },
    { item_name: 'Pressure Test', category: 'fix', quantity: 1, price: 25 },
  ],
  weighInData: [{ systemNumber: 1, linesetLength: 55, factoryChargeOz: 133, adjustedOz: 15 }],
  checklistAnswers: [
    { item: 'pdrain_ecoil', answer: 'no', reportText: 'No/Incomplete pdrain at ecoil' },
    { item: 'media_filter', answer: 'yes', reportText: null },
  ],
  notes: 'Recheck zone 2 damper.',
  totalPrice: 0,
};

it('builds the receipt from the snapshot, with lines that add up to the total', () => {
  // The device total for this snapshot (CC-08: the technician's own prices).
  snapshot.totalPrice = 20 + 20 + 35 + 5 * 2 + 0 + (10 * 2 + 10 * 1) + (25 + 5);
  const model = receiptModel(snapshot, { catalog, technicianName: 'Kristo' });
  expect(model).toMatchObject({
    street: '4821 Cedar Hollow Ln',
    place: 'Bridgeland · Perry Homes',
    technicianName: 'Kristo',
    weighIn: ['System 1 · 55 ft · +15 oz · total 9 lb 4 oz'],
    checklist: ['No/Incomplete pdrain at ecoil'],
    notes: 'Recheck zone 2 damper.',
    total: snapshot.totalPrice,
  });
  expect(model.groups).toEqual([
    { title: 'SERVICE', lines: [{ label: 'Finish/ AC · System 1', amount: 20 }, { label: 'Prestart · System 2', amount: 20 }] },
    { title: 'T-STAT', lines: [{ label: 'T-6 × 2', amount: 0 }] },
    { title: 'ACCESSORIES', lines: [
      { label: 'UT3000', amount: 35 }, { label: 'Float Switch × 2', amount: 10 }, { label: 'Weigh-in × 2', amount: 30 },
    ] },
    { title: 'FIX', lines: [{ label: 'Pressure Test', amount: 30 }] },
  ]);
  const sum = model.groups.flatMap(group => group.lines).reduce((total, line) => total + line.amount, 0);
  expect(sum).toBe(model.total);
});

it('priceVisit amounts add up to its total', () => {
  const result = priceVisit({
    services: [{ systemNumber: null, serviceName: 'AC', isFinish: false, isTemporarily: false }],
    items: [{ itemName: 'Float Switch', category: 'accessory', quantity: 3 }, { itemName: 'Pressure Test', category: 'fix' }],
    systemCount: 3,
    catalog,
  });
  expect(result.amounts).toEqual({ services: [90], items: [15, 25] });
  expect(result.total).toBe(130);
});

it('says which parts of a rejected Report differ and what to do (WS-12)', () => {
  expect(describeReportMismatch(['services.serviceName', 'weighInData', 'weighInData.adjustedOz'])).toBe(
    "Not accepted — the office's copy differs in: Service, Weigh-In. Tap Correct report, check those sections and confirm a new submission."
  );
  expect(describeReportMismatch(['address.street'])).toBe(
    "Not accepted — the office's copy differs in: Call details. Tap Correct report, check that section and confirm a new submission. Call details come from the office: ask Dispatch if they look wrong."
  );
  expect(describeReportMismatch(null)).toBe('Correction required — edit the Report and confirm a new submission');
});

it('shows the server prices of a delivered Report and marks what the office adjusted (PP-01)', () => {
  const server = {
    address: { street: '1907 Amber Ridge Dr', subdivision: 'Towne Lake', builder: 'Lennar' },
    generatedAt: '2026-11-17T15:00:00.000Z',
    technicianName: 'Kristo',
    systems: [{ systemNumber: 1 }],
    services: [{ systemNumber: 1, serviceName: 'AC', isFinish: false, isTemporarily: false, price: 35 }],
    items: [{ itemName: 'UT3000', category: 'accessory', quantity: 1, price: 42 }],
    notes: '',
    checklistAnswers: [],
    totalPrice: 77,
    priceDiscrepancies: [
      { field: 'services.price', row: 'System 1 AC', submitted: 30, accepted: 35 },
      { field: 'items.price', row: 'UT3000', submitted: 40, accepted: 42 },
      { field: 'items.techSupplied', row: 'UT3000', submitted: false, accepted: true },
      { field: 'totalPrice', row: null, submitted: 70, accepted: 77 },
    ],
  };
  const model = receiptModel(server, { catalog });
  expect(model.technicianName).toBe('Kristo');
  expect(model.groups).toEqual([
    { title: 'SERVICE', lines: [{ label: 'AC', amount: 35, adjustedFrom: 30 }] },
    { title: 'ACCESSORIES', lines: [{ label: 'UT3000', amount: 42, adjustedFrom: 40 }] },
  ]);
  expect(model).toMatchObject({ total: 77, totalAdjustedFrom: 70 });
});

it('Correct report takes the call data from the server and keeps the technician work', () => {
  const draft = {
    id: 'v1', address: { street: '123 TEST LANE' }, orderNumber: 'A1', notes: 'kept', _items: [{ item_name: 'UT3000' }],
  };
  const refreshed = refreshCallData(draft, { address: { street: '123 TEST LANE NORTH' }, orderNumber: 'A2', notes: 'server' });
  expect(refreshed).toEqual({
    id: 'v1', address: { street: '123 TEST LANE NORTH' }, orderNumber: 'A2', notes: 'kept', _items: [{ item_name: 'UT3000' }],
  });
});
