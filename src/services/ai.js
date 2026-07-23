async function extractCallsFromPDF(pdfBuffer) {
  return [
    {
      orderNumber: 'ORD-001',
      address: '123 MAPLE ST',
      city: 'HOUSTON',
      state: 'TX',
      zip: '77001',
      subdivision: 'MAPLE GROVE',
      builder: 'DR HORTON',
      scheduledTime: new Date().toISOString(),
      workType: 'AC',
      systemCount: 1,
      preSpecifiedThermostat: null,
      preSpecifiedThermostatQty: null,
      preIdentifiedAccessories: [],
      notes: null,
    },
    {
      orderNumber: 'ORD-002',
      address: '456 OAK AVE',
      city: 'HOUSTON',
      state: 'TX',
      zip: '77002',
      subdivision: 'OAK HILLS',
      builder: 'LENNAR',
      scheduledTime: new Date().toISOString(),
      workType: 'Heat',
      systemCount: 2,
      preSpecifiedThermostat: null,
      preSpecifiedThermostatQty: null,
      preIdentifiedAccessories: [],
      notes: null,
    },
  ];
}

module.exports = { extractCallsFromPDF };
