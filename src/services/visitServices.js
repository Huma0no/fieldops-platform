// Per-system services (docs/fieldops/workspace/SERVICE-TSTAT-SPEC.md).
// Each system has its own service row, charged on its own. Drive Run is the
// only call-wide service: a single row without a system number.
const { resolveServicePrice, syncWeightInDataPrice } = require('./pricing');

const SYSTEM_SERVICES = new Set(['AC', 'Heat', 'AC & Heat', 'Prestart', 'Finish']);
const AC_HEAT = new Set(['AC', 'Heat', 'AC & Heat']);

function badRequest(message) {
  return Object.assign(new Error(message), { status: 400 });
}

async function visitSystemNumbers(db, visitId) {
  const { rows } = await db.query(
    'SELECT system_number FROM visit_systems WHERE visit_id = $1 ORDER BY system_number',
    [visitId]
  );
  return rows.length ? rows.map(row => row.system_number) : [1];
}

function normalizeServiceRows(rows, systemNumbers) {
  if (!Array.isArray(rows)) throw badRequest('services must be an array');
  const seen = new Set();
  return rows.map((row) => {
    const serviceName = row?.serviceName;
    if (serviceName === 'Drive Run') {
      if (rows.length !== 1) throw badRequest('Drive Run replaces every other service');
      return { systemNumber: null, serviceName, isFinish: false, isTemporarily: false };
    }
    if (!SYSTEM_SERVICES.has(serviceName)) throw badRequest('Invalid service name');
    const systemNumber = Number(row.systemNumber);
    if (!systemNumbers.includes(systemNumber)) throw badRequest('Invalid system number');
    if (seen.has(systemNumber)) throw badRequest(`System ${systemNumber} has more than one service`);
    seen.add(systemNumber);
    return {
      systemNumber,
      serviceName,
      isFinish: serviceName === 'Finish' || (row.isFinish === true && serviceName !== 'Prestart'),
      isTemporarily: row.isTemporarily === true && AC_HEAT.has(serviceName),
    };
  }).sort((a, b) => (a.systemNumber ?? 0) - (b.systemNumber ?? 0));
}

function missingServiceSystems(rows, systemNumbers) {
  if (rows.some(row => row.serviceName === 'Drive Run')) return [];
  const covered = new Set(rows.map(row => row.systemNumber));
  return systemNumbers.filter(number => !covered.has(number));
}

// Replaces the visit's service rows; returns them with their resolved prices.
async function writeServiceRows(db, visitId, rows) {
  const names = [...new Set(rows.map(row => row.serviceName))];
  const catalog = await db.query(
    'SELECT service_name, default_price FROM catalog_services WHERE service_name = ANY($1)',
    [names]
  );
  const basePrice = new Map(catalog.rows.map(row => [row.service_name, row.default_price]));
  await db.query('DELETE FROM visit_services WHERE visit_id = $1', [visitId]);
  const saved = [];
  for (const row of rows) {
    if (!basePrice.has(row.serviceName)) throw badRequest('Invalid service name');
    const price = resolveServicePrice(row.serviceName, row.isFinish, basePrice.get(row.serviceName));
    await db.query(
      `INSERT INTO visit_services (id, visit_id, service_name, is_finish, is_temporarily, price, system_number)
       VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6)`,
      [visitId, row.serviceName, row.isFinish, row.isTemporarily, price, row.systemNumber]
    );
    saved.push({ ...row, price });
  }
  await syncWeightInDataPrice(db, visitId, rows.some(row => row.isFinish));
  return saved;
}

module.exports = {
  missingServiceSystems,
  normalizeServiceRows,
  visitSystemNumbers,
  writeServiceRows,
};
