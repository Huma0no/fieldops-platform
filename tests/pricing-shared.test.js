const serverPricing = require('../src/services/pricing');

let shared;
beforeAll(async () => {
  shared = await import('../frontend/shared/pricing.mjs');
});

const catalog = {
  services: [
    { service_name: 'AC', default_price: 30, multiplies_by_system_count: true },
    { service_name: 'Heat', default_price: 30, multiplies_by_system_count: true },
    { service_name: 'AC & Heat', default_price: 30, multiplies_by_system_count: false },
    { service_name: 'Prestart', default_price: 20, multiplies_by_system_count: false },
    { service_name: 'Drive Run', default_price: 10, multiplies_by_system_count: false },
    { service_name: 'Finish', default_price: 0, multiplies_by_system_count: false },
  ],
  items: [
    { item_name: 'Weight-In-Data', category: 'accessory', default_price: 10, finish_addon_price: 10, multiplies_by_system_count: true, tech_supplied: false },
    { item_name: 'FIN180P', category: 'accessory', default_price: 10, multiplies_by_system_count: false, tech_supplied: false },
    { item_name: 'RDS', category: 'accessory', default_price: 10, multiplies_by_system_count: true, tech_supplied: true },
    { item_name: 'Other', category: 'accessory', default_price: null, custom_price: true, tech_supplied: true },
    { item_name: 'T-6', category: 'thermostat', default_price: 0, tech_supplied: true },
  ],
};

it('repeats the two one-line rules exactly on the server', () => {
  for (const name of ['AC', 'Heat', 'AC & Heat', 'Prestart', 'Finish', 'Drive Run']) {
    for (const finish of [true, false]) {
      expect(serverPricing.resolveServicePrice(name, finish, 30)).toBe(shared.resolveServicePrice(name, finish, 30));
    }
  }
  for (const finish of [true, false]) {
    expect(serverPricing.resolveWeightInDataPrice(10, 10, finish)).toBe(shared.resolveWeightInDataPrice(10, 10, finish));
  }
});

it('charges each system its own service and Weigh-In per system', () => {
  const result = shared.priceVisit({
    services: [
      { systemNumber: 1, serviceName: 'AC', isFinish: true },
      { systemNumber: 2, serviceName: 'AC & Heat', isFinish: false, isTemporarily: true },
      { systemNumber: 3, serviceName: 'Prestart', isFinish: false },
    ],
    items: [{ itemName: 'Weight-In-Data', category: 'accessory', quantity: 1 }],
    systemCount: 3,
    catalog,
  });
  expect(result.services.map(row => row.price)).toEqual([20, 30, 20]);
  // Services 70 + Weigh-In $10 × 3 systems + $10 Finish addon on system 1.
  expect(result.total).toBe(110);
});

it('charges Drive Run once and resolves custom, tech-supplied and multiplied items', () => {
  const result = shared.priceVisit({
    services: [{ systemNumber: null, serviceName: 'Drive Run', isFinish: false }],
    items: [
      { itemName: 'RDS', category: 'accessory', quantity: 1 },
      { itemName: 'Other', category: 'accessory', quantity: 1, price: 12, description: 'Drain elbow' },
      { itemName: 'T-6', category: 'thermostat', quantity: 2 },
    ],
    systemCount: 2,
    catalog,
  });
  expect(result.items.map(item => [item.price, item.techSupplied])).toEqual([[10, true], [12, true], [0, true]]);
  expect(result.total).toBe(10 + 20 + 12);
});

it('applies a technician override to the total only', () => {
  const result = shared.priceVisit({
    services: [{ systemNumber: 1, serviceName: 'AC', isFinish: false }],
    items: [{ itemName: 'FIN180P', category: 'accessory', quantity: 1 }],
    systemCount: 1,
    catalog,
    overrides: { FIN180P: 15 },
  });
  expect(result.items[0].price).toBe(10);
  expect(result.total).toBe(45);
});

it('prices a Cancel at $0', () => {
  const result = shared.priceVisit({
    services: [{ systemNumber: null, serviceName: 'Cancel', isFinish: false }],
    items: [{ itemName: 'FIN180P', category: 'accessory', quantity: 1 }],
    catalog,
  });
  expect(result.total).toBe(0);
});
