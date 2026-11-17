const fs = require('fs/promises');
const path = require('path');

let receiptModel;
let describeReportMismatch;
let priceVisit;

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
    { item_name: 'Float Switch', category: 'accessory', quantity: 1, price: 5 },
    { item_name: 'T-6', category: 'thermostat', quantity: 2, price: 0 },
    { item_name: 'Weight-In-Data', category: 'accessory', quantity: 1, price: 20 },
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
      { label: 'UT3000', amount: 35 }, { label: 'Float Switch', amount: 10 }, { label: 'Weigh-in', amount: 30 },
    ] },
    { title: 'FIX', lines: [{ label: 'Pressure Test', amount: 30 }] },
  ]);
  const sum = model.groups.flatMap(group => group.lines).reduce((total, line) => total + line.amount, 0);
  expect(sum).toBe(model.total);
});

it('priceVisit amounts add up to its total', () => {
  const result = priceVisit({
    services: [{ systemNumber: null, serviceName: 'AC', isFinish: false, isTemporarily: false }],
    items: [{ itemName: 'Float Switch', category: 'accessory' }, { itemName: 'Pressure Test', category: 'fix' }],
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
