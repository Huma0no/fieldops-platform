const express = require('express');
const { pool } = require('../db/pool');
const { requireRole } = require('../middleware/auth');
const { calculateVisitPrice } = require('../services/pricing');

const router = express.Router();

const VALID_SERVICES = ['AC', 'Heat', 'AC & Heat', 'Prestart System', 'Drive Run', 'Cancel'];
const VALID_CATEGORIES = ['accessory', 'fix', 'thermostat'];

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
  const toDeleteFiltered = toDelete.filter(name => !newItemCompanions.has(name));

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

module.exports = router;
