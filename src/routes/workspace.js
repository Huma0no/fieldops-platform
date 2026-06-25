const express = require('express');
const { pool } = require('../db/pool');
const { requireRole } = require('../middleware/auth');
const { calculateVisitPrice } = require('../services/pricing');
const multer = require('multer');

const router = express.Router();

const upload = multer({ storage: multer.memoryStorage() });

const VALID_SERVICES = ['AC', 'Heat', 'AC & Heat', 'Prestart System', 'Drive Run', 'Cancel'];
const VALID_CATEGORIES = ['accessory', 'fix', 'thermostat'];
const VALID_PHOTO_CATEGORIES = ['weigh_in_scale', 'fan_speed', 'site_evidence'];

async function requireVisitOwnership(req, res, next) {
  try {
    const result = await pool.query(
      `SELECT id, status, technician_id, address_id FROM visits WHERE id = $1`,
      [req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Visit not found' });
    const visit = result.rows[0];
    if (visit.technician_id !== req.technician.id) {
      return res.status(403).json({ error: 'This visit is not assigned to you' });
    }
    if (!['assigned', 'in_progress'].includes(visit.status)) {
      return res.status(400).json({
        error: `Visit cannot be modified — current status: ${visit.status}`,
      });
    }
    req.visit = visit;
    next();
  } catch (err) {
    next(err);
  }
}

async function resolveCompanionCascade(db, visitId, itemName, mode) {
  const relRes = await db.query(
    `SELECT related_item_name FROM catalog_item_relations
     WHERE item_name = $1 AND relation_type = 'companion'`,
    [itemName]
  );
  const companions = relRes.rows.map(r => r.related_item_name);
  if (companions.length === 0) return [];

  if (mode === 'remove') {
    // Check which companions actually exist in visit_items for this visit
    const existingRes = await db.query(
      `SELECT item_name FROM visit_items WHERE visit_id = $1 AND item_name = ANY($2)`,
      [visitId, companions]
    );
    const actualCompanions = existingRes.rows.map(r => r.item_name);

    if (actualCompanions.length > 0) {
      await db.query(
        `DELETE FROM visit_items WHERE visit_id = $1 AND item_name = ANY($2)`,
        [visitId, actualCompanions]
      );
    }
    return actualCompanions;
  }

  // add mode
  const added = [];
  for (const name of companions) {
    const existing = await db.query(
      `SELECT id FROM visit_items WHERE visit_id = $1 AND item_name = $2`,
      [visitId, name]
    );
    if (existing.rows.length > 0) continue;
    const cat = await db.query(
      `SELECT default_price, tech_supplied, category FROM catalog_items WHERE item_name = $1`,
      [name]
    );
    if (cat.rows.length === 0) continue;
    const c = cat.rows[0];
    await db.query(
      `INSERT INTO visit_items (id, visit_id, item_name, category, quantity, price, tech_supplied)
       VALUES (gen_random_uuid()::text, $1, $2, $3, 1, $4, $5)`,
      [visitId, name, c.category, c.default_price ?? 0, c.tech_supplied]
    );
    added.push(name);
  }
  return added;
}

async function resolveExclusionCascade(db, visitId, itemName) {
  const relRes = await db.query(
    `SELECT exclusion_group_id FROM catalog_item_relations
     WHERE item_name = $1 AND relation_type = 'exclusion_group'
     LIMIT 1`,
    [itemName]
  );
  if (relRes.rows.length === 0 || !relRes.rows[0].exclusion_group_id) return [];

  const groupId = relRes.rows[0].exclusion_group_id;
  const membersRes = await db.query(
    `SELECT item_name FROM catalog_item_relations
     WHERE exclusion_group_id = $1 AND item_name <> $2 AND relation_type = 'exclusion_group'`,
    [groupId, itemName]
  );
  const memberNames = membersRes.rows.map(r => r.item_name);
  if (memberNames.length === 0) return [];

  const companionRes = await db.query(
    `SELECT related_item_name FROM catalog_item_relations
     WHERE item_name = ANY($1) AND relation_type = 'companion'`,
    [memberNames]
  );
  const companionNames = companionRes.rows.map(r => r.related_item_name);

  const toDelete = [...new Set([...memberNames, ...companionNames])];

  // Don't delete companions that belong to the newly-added item
  const newItemCompsRes = await db.query(
    `SELECT related_item_name FROM catalog_item_relations
     WHERE item_name = $1 AND relation_type = 'companion'`,
    [itemName]
  );
  const newItemCompanions = new Set(newItemCompsRes.rows.map(r => r.related_item_name));
  const toDeleteFiltered = toDelete.filter(name => name !== itemName && !newItemCompanions.has(name));

  if (toDeleteFiltered.length === 0) return [];
  await db.query(
    `DELETE FROM visit_items WHERE visit_id = $1 AND item_name = ANY($2)`,
    [visitId, toDeleteFiltered]
  );
  return toDeleteFiltered;
}

// PATCH /api/visits/:id/services
router.patch(
  '/:id/services',
  requireRole('technician'),
  requireVisitOwnership,
  async (req, res, next) => {
    const { id } = req.params;
    const { serviceName, isFinish = false, isTemporarily = false, confirmed = false } = req.body;
    try {
      if (!VALID_SERVICES.includes(serviceName)) {
        return res.status(400).json({ error: 'Invalid service name' });
      }

      if (serviceName === 'Cancel') {
        const items = await pool.query(
          `SELECT id, item_name FROM visit_items WHERE visit_id = $1`,
          [id]
        );
        if (items.rows.length > 0 && !confirmed) {
          return res.json({
            requiresConfirmation: true,
            itemsToRemove: items.rows.map(r => ({ id: r.id, itemName: r.item_name })),
          });
        }
        const now = new Date().toISOString();
        await pool.query(`DELETE FROM visit_items WHERE visit_id = $1`, [id]);
        await pool.query(`DELETE FROM visit_services WHERE visit_id = $1`, [id]);
        await pool.query(
          `UPDATE visits SET total_price = 0, updated_at = $1 WHERE id = $2`,
          [now, id]
        );
        return res.json({ id, serviceName: 'Cancel', isFinish: false, isTemporarily: false, totalPrice: 0 });
      }

      const catalogRes = await pool.query(
        `SELECT default_price FROM catalog_services WHERE service_name = $1`,
        [serviceName]
      );
      if (!catalogRes.rows.length) {
        return res.status(400).json({ error: 'Invalid service name' });
      }
      const catalogPrice = catalogRes.rows[0].default_price;

      await pool.query(`DELETE FROM visit_services WHERE visit_id = $1`, [id]);
      await pool.query(
        `INSERT INTO visit_services (id, visit_id, service_name, is_finish, is_temporarily, price)
         VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5)`,
        [id, serviceName, isFinish, isTemporarily, catalogPrice]
      );

      const totalPrice = await calculateVisitPrice(pool, id);
      const now = new Date().toISOString();
      await pool.query(
        `UPDATE visits SET total_price = $1, updated_at = $2 WHERE id = $3`,
        [totalPrice, now, id]
      );

      res.json({ id, serviceName, isFinish, isTemporarily, totalPrice });
    } catch (err) {
      next(err);
    }
  }
);

// POST /api/visits/:id/items
router.post(
  '/:id/items',
  requireRole('technician'),
  requireVisitOwnership,
  async (req, res, next) => {
    const { id } = req.params;
    const { category, itemName, quantity = 1, price } = req.body;
    try {
      if (!VALID_CATEGORIES.includes(category)) {
        return res.status(400).json({ error: 'Invalid category' });
      }

      const catRes = await pool.query(
        `SELECT * FROM catalog_items WHERE item_name = $1`,
        [itemName]
      );
      if (catRes.rows.length === 0) {
        return res.status(400).json({ error: 'Item not found in catalog' });
      }
      const catalog = catRes.rows[0];

      if (catalog.custom_price && price == null) {
        return res.status(400).json({ error: 'price is required for this item' });
      }

      const resolvedPrice = catalog.custom_price ? price : (catalog.default_price ?? 0);

      const insertRes = await pool.query(
        `INSERT INTO visit_items (id, visit_id, item_name, category, quantity, price, tech_supplied)
         VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6) RETURNING id`,
        [id, itemName, catalog.category, quantity, resolvedPrice, catalog.tech_supplied]
      );
      const newId = insertRes.rows[0].id;

      const addedCompanions = await resolveCompanionCascade(pool, id, itemName, 'add');
      const removedItems = await resolveExclusionCascade(pool, id, itemName);

      const totalPrice = await calculateVisitPrice(pool, id);
      const now = new Date().toISOString();
      await pool.query(
        `UPDATE visits SET total_price = $1, updated_at = $2 WHERE id = $3`,
        [totalPrice, now, id]
      );

      res.json({
        id: newId,
        totalPrice,
        addedItems: [itemName, ...addedCompanions],
        removedItems,
      });
    } catch (err) {
      next(err);
    }
  }
);

// DELETE /api/visits/:id/items/:itemId
router.delete(
  '/:id/items/:itemId',
  requireRole('technician'),
  requireVisitOwnership,
  async (req, res, next) => {
    const { id, itemId } = req.params;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const itemRes = await client.query(
        `SELECT item_name FROM visit_items WHERE id = $1 AND visit_id = $2`,
        [itemId, id]
      );
      if (itemRes.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Item not found' });
      }
      const { item_name } = itemRes.rows[0];

      await client.query(`DELETE FROM visit_items WHERE id = $1`, [itemId]);

      const deletedCompanions = await resolveCompanionCascade(client, id, item_name, 'remove');

      const totalPrice = await calculateVisitPrice(client, id);
      await client.query(
        `UPDATE visits SET total_price = $1, updated_at = $2 WHERE id = $3`,
        [totalPrice, new Date().toISOString(), id]
      );

      await client.query('COMMIT');
      res.json({ totalPrice, removedItems: [item_name, ...deletedCompanions] });
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      next(err);
    } finally {
      client.release();
    }
  }
);

// PATCH /api/visits/:id/systems/:systemNumber
router.patch(
  '/:id/systems/:systemNumber',
  requireRole('technician'),
  requireVisitOwnership,
  async (req, res, next) => {
    const { id, systemNumber } = req.params;
    const sysNum = parseInt(systemNumber, 10);
    const { indoorModel, outdoorModel } = req.body;
    try {
      const sysRes = await pool.query(
        `SELECT * FROM visit_systems WHERE visit_id = $1 AND system_number = $2`,
        [id, sysNum]
      );
      if (sysRes.rows.length === 0) {
        return res.status(404).json({ error: 'System not found' });
      }
      const current = sysRes.rows[0];

      let refrigerant = current.refrigerant;
      if (outdoorModel !== undefined) {
        const equipRes = await pool.query(
          `SELECT refrigerant FROM catalog_equipment WHERE model = $1`,
          [outdoorModel]
        );
        if (equipRes.rows.length > 0 && equipRes.rows[0].refrigerant != null) {
          refrigerant = equipRes.rows[0].refrigerant;
        }
      }

      const newIndoor = indoorModel !== undefined ? indoorModel : current.indoor_model;
      const newOutdoor = outdoorModel !== undefined ? outdoorModel : current.outdoor_model;

      await pool.query(
        `UPDATE visit_systems SET indoor_model = $1, outdoor_model = $2, refrigerant = $3
         WHERE visit_id = $4 AND system_number = $5`,
        [newIndoor, newOutdoor, refrigerant, id, sysNum]
      );
      await pool.query(
        `UPDATE visits SET updated_at = $1 WHERE id = $2`,
        [new Date().toISOString(), id]
      );

      res.json({ systemNumber: sysNum, indoorModel: newIndoor, outdoorModel: newOutdoor, refrigerant });
    } catch (err) {
      next(err);
    }
  }
);

// PATCH /api/visits/:id/notes
router.patch(
  '/:id/notes',
  requireRole('technician'),
  requireVisitOwnership,
  async (req, res, next) => {
    const { id } = req.params;
    const { notes } = req.body;
    try {
      await pool.query(
        `UPDATE visits SET notes = $1, updated_at = $2 WHERE id = $3`,
        [notes, new Date().toISOString(), id]
      );
      res.json({ id, notes });
    } catch (err) {
      next(err);
    }
  }
);

// PUT /api/visits/:id/weigh-in/:systemNumber
router.put(
  '/:id/weigh-in/:systemNumber',
  requireRole('technician'),
  requireVisitOwnership,
  async (req, res, next) => {
    const { id, systemNumber } = req.params;
    const sysNum = parseInt(systemNumber, 10);
    const {
      linesetLength,
      factoryLineConfig,
      factoryChargeUsed,
      adjustedOz,
      fanSpeedCfm,
      liquidLineTemp,
      suctionLineTemp,
      condenserSatTemp,
      subcoolingValue,
    } = req.body;
    const addressId = req.visit.address_id;

    try {
      const linesetRes = await pool.query(
        `SELECT reference_length_ft, adjust_rate_oz_per_ft
         FROM catalog_lineset_configs WHERE config_key = $1`,
        [factoryLineConfig]
      );
      if (linesetRes.rows.length === 0) {
        return res.status(400).json({ error: 'Lineset config not found' });
      }
      const { reference_length_ft, adjust_rate_oz_per_ft } = linesetRes.rows[0];
      const approxAdjustOz = (linesetLength - reference_length_ft) * adjust_rate_oz_per_ft;

      const sysRes = await pool.query(
        `SELECT outdoor_model FROM visit_systems WHERE visit_id = $1 AND system_number = $2`,
        [id, sysNum]
      );
      const outdoorModel = sysRes.rows[0]?.outdoor_model;

      let factoryChargeOz = null;
      if (outdoorModel) {
        const equipRes = await pool.query(
          `SELECT factory_charge_oz, revised_charge_oz FROM catalog_equipment WHERE model = $1`,
          [outdoorModel]
        );
        if (equipRes.rows.length > 0) {
          const e = equipRes.rows[0];
          factoryChargeOz = factoryChargeUsed === 'revised' ? e.revised_charge_oz : e.factory_charge_oz;
        }
      }

      const oemSubcoolingGoal = 10;
      const subcoolingDeviation = subcoolingValue - oemSubcoolingGoal;

      const upsertRes = await pool.query(
        `INSERT INTO weigh_in_data
           (id, address_id, system_number, lineset_length, factory_charge_oz,
            factory_line_config, approx_adjust_oz, adjusted_oz, fan_speed_cfm,
            liquid_line_temp, suction_line_temp, condenser_sat_temp,
            subcooling_value, oem_subcooling_goal, subcooling_deviation)
         VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
         ON CONFLICT (address_id, system_number) DO UPDATE SET
           lineset_length       = EXCLUDED.lineset_length,
           factory_charge_oz    = EXCLUDED.factory_charge_oz,
           factory_line_config  = EXCLUDED.factory_line_config,
           approx_adjust_oz     = EXCLUDED.approx_adjust_oz,
           adjusted_oz          = EXCLUDED.adjusted_oz,
           fan_speed_cfm        = EXCLUDED.fan_speed_cfm,
           liquid_line_temp     = EXCLUDED.liquid_line_temp,
           suction_line_temp    = EXCLUDED.suction_line_temp,
           condenser_sat_temp   = EXCLUDED.condenser_sat_temp,
           subcooling_value     = EXCLUDED.subcooling_value,
           oem_subcooling_goal  = EXCLUDED.oem_subcooling_goal,
           subcooling_deviation = EXCLUDED.subcooling_deviation
         RETURNING *`,
        [
          addressId, sysNum, linesetLength, factoryChargeOz, factoryLineConfig,
          approxAdjustOz, adjustedOz, fanSpeedCfm, liquidLineTemp, suctionLineTemp,
          condenserSatTemp, subcoolingValue, oemSubcoolingGoal, subcoolingDeviation,
        ]
      );

      await pool.query(
        `UPDATE visits SET updated_at = $1 WHERE id = $2`,
        [new Date().toISOString(), id]
      );

      const r = upsertRes.rows[0];
      res.json({
        id: r.id,
        addressId: r.address_id,
        systemNumber: r.system_number,
        linesetLength: r.lineset_length,
        factoryChargeOz: r.factory_charge_oz,
        factoryLineConfig: r.factory_line_config,
        approxAdjustOz: r.approx_adjust_oz,
        adjustedOz: r.adjusted_oz,
        fanSpeedCfm: r.fan_speed_cfm,
        liquidLineTemp: r.liquid_line_temp,
        suctionLineTemp: r.suction_line_temp,
        condenserSatTemp: r.condenser_sat_temp,
        subcoolingValue: r.subcooling_value,
        oemSubcoolingGoal: r.oem_subcooling_goal,
        subcoolingDeviation: r.subcooling_deviation,
      });
    } catch (err) {
      next(err);
    }
  }
);

// POST /api/visits/:id/photos
router.post(
  '/:id/photos',
  requireRole('technician'),
  requireVisitOwnership,
  upload.single('photo'),
  async (req, res, next) => {
    const { id } = req.params;
    const { category, tag, systemNumber, label } = req.body;
    try {
      if (!VALID_PHOTO_CATEGORIES.includes(category)) {
        return res.status(400).json({ error: 'Invalid category' });
      }
      if (!tag) {
        return res.status(400).json({ error: 'tag is required' });
      }

      const addrRes = await pool.query(
        `SELECT street FROM addresses WHERE id = $1`,
        [req.visit.address_id]
      );
      const street = addrRes.rows[0].street;

      const slugBase = `${street}_${tag}`.toUpperCase().replace(/\s+/g, '_');
      const slug = systemNumber ? `${slugBase}_SYS${systemNumber}` : slugBase;

      const photoRes = await pool.query(
        `INSERT INTO visit_photos (id, visit_id, system_number, slug, tag, label, category, stored_at)
         VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, null) RETURNING id`,
        [id, systemNumber ? parseInt(systemNumber, 10) : null, slug, tag, label ?? null, category]
      );
      const photoId = photoRes.rows[0].id;

      await pool.query(
        `UPDATE visits SET updated_at = $1 WHERE id = $2`,
        [new Date().toISOString(), id]
      );

      res.json({ photoId, slug, storedAt: null });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
