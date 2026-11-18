// PDF Intake: OCR the route sheet and parse its calls against the catalog.
// Returns only what was read; an unreadable sheet yields no calls.
const { ocrPdf } = require('./pdfOcr');
const { parseRoute } = require('./routeParser');

async function loadCatalog(db) {
  const [equipment, accessories, builders] = await Promise.all([
    db.query('SELECT model, unit_type FROM catalog_equipment'),
    db.query("SELECT item_name FROM catalog_items WHERE category = 'accessory'"),
    db.query('SELECT DISTINCT builder FROM addresses WHERE builder IS NOT NULL'),
  ]);
  const models = types => equipment.rows.filter(row => types.includes(row.unit_type)).map(row => row.model);
  return {
    indoor: models(['furnace', 'air_handler']),
    outdoor: models(['condenser', 'heat_pump']),
    accessories: accessories.rows.map(row => row.item_name),
    // Known builders split "BUILDER CONTACT NAME" on the city line.
    builders: builders.rows.map(row => row.builder.trim()).filter(Boolean),
  };
}

async function extractCalls(pdfBuffer, db) {
  let pages;
  try {
    pages = await ocrPdf(pdfBuffer);
  } catch (err) {
    // Not a PDF pdf.js can open: nothing was read.
    return { route: {}, calls: [], error: err.message };
  }
  return parseRoute(pages, await loadCatalog(db));
}

module.exports = { extractCalls, loadCatalog };
