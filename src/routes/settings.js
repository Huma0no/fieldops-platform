const crypto = require('crypto');
const express = require('express');
const { pool } = require('../db/pool');

const router = express.Router();

const VALID_THEMES = new Set(['dark', 'light', 'terminal']);
const VALID_AI_PROVIDERS = new Set(['anthropic', 'openai', 'google']);

const DEFAULT_SETTINGS = {
  theme: 'dark',
  ai_provider: 'anthropic',
  ai_api_key_anthropic: null,
  ai_api_key_openai: null,
  ai_api_key_google: null,
  onboarding_completed: false,
};

function toResponse(row) {
  return {
    technicianId: row.technician_id,
    theme: row.theme,
    aiProvider: row.ai_provider,
    hasKeyAnthropic: row.ai_api_key_anthropic !== null,
    hasKeyOpenai: row.ai_api_key_openai !== null,
    hasKeyGoogle: row.ai_api_key_google !== null,
    onboardingCompleted: row.onboarding_completed,
  };
}

async function ensureSettings(technicianId) {
  const existing = await pool.query(
    'SELECT * FROM technician_settings WHERE technician_id = $1',
    [technicianId]
  );
  if (existing.rows.length > 0) return existing.rows[0];

  const result = await pool.query(
    `INSERT INTO technician_settings
       (technician_id, theme, ai_provider, ai_api_key_anthropic, ai_api_key_openai, ai_api_key_google, onboarding_completed)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      technicianId,
      DEFAULT_SETTINGS.theme,
      DEFAULT_SETTINGS.ai_provider,
      DEFAULT_SETTINGS.ai_api_key_anthropic,
      DEFAULT_SETTINGS.ai_api_key_openai,
      DEFAULT_SETTINGS.ai_api_key_google,
      DEFAULT_SETTINGS.onboarding_completed,
    ]
  );
  return result.rows[0];
}

// GET /api/technicians/me/settings
router.get('/me/settings', async (req, res, next) => {
  try {
    const row = await ensureSettings(req.technician.id);
    res.json(toResponse(row));
  } catch (err) {
    next(err);
  }
});

// PATCH /api/technicians/me/settings
router.patch('/me/settings', async (req, res, next) => {
  try {
    const techId = req.technician.id;
    const { theme, aiProvider, aiApiKeyAnthropic, aiApiKeyOpenai, aiApiKeyGoogle, onboardingCompleted } = req.body;

    if (theme !== undefined && !VALID_THEMES.has(theme)) {
      return res.status(400).json({ error: `Invalid theme. Must be one of: ${[...VALID_THEMES].join(', ')}` });
    }
    if (aiProvider !== undefined && !VALID_AI_PROVIDERS.has(aiProvider)) {
      return res.status(400).json({ error: `Invalid aiProvider. Must be one of: ${[...VALID_AI_PROVIDERS].join(', ')}` });
    }

    await ensureSettings(techId);

    const updates = [];
    const values = [];

    if (theme !== undefined) { updates.push(`theme = $${values.push(theme)}`); }
    if (aiProvider !== undefined) { updates.push(`ai_provider = $${values.push(aiProvider)}`); }
    if (aiApiKeyAnthropic !== undefined) { updates.push(`ai_api_key_anthropic = $${values.push(aiApiKeyAnthropic)}`); }
    if (aiApiKeyOpenai !== undefined) { updates.push(`ai_api_key_openai = $${values.push(aiApiKeyOpenai)}`); }
    if (aiApiKeyGoogle !== undefined) { updates.push(`ai_api_key_google = $${values.push(aiApiKeyGoogle)}`); }
    if (onboardingCompleted !== undefined) { updates.push(`onboarding_completed = $${values.push(onboardingCompleted)}`); }

    let row;
    if (updates.length > 0) {
      values.push(techId);
      const result = await pool.query(
        `UPDATE technician_settings SET ${updates.join(', ')} WHERE technician_id = $${values.length} RETURNING *`,
        values
      );
      row = result.rows[0];
    } else {
      const result = await pool.query('SELECT * FROM technician_settings WHERE technician_id = $1', [techId]);
      row = result.rows[0];
    }

    res.json(toResponse(row));
  } catch (err) {
    next(err);
  }
});

// GET /api/technicians/me/price-overrides
router.get('/me/price-overrides', async (req, res, next) => {
  try {
    const result = await pool.query(
      'SELECT item_name, override_price FROM technician_price_overrides WHERE technician_id = $1',
      [req.technician.id]
    );
    res.json(result.rows.map((r) => ({ itemName: r.item_name, overridePrice: r.override_price })));
  } catch (err) {
    next(err);
  }
});

// POST /api/technicians/me/price-overrides
router.post('/me/price-overrides', async (req, res, next) => {
  try {
    const techId = req.technician.id;
    const { itemName, overridePrice } = req.body;

    const [itemRes, svcRes] = await Promise.all([
      pool.query('SELECT 1 FROM catalog_items WHERE item_name = $1', [itemName]),
      pool.query('SELECT 1 FROM catalog_services WHERE service_name = $1', [itemName]),
    ]);
    if (itemRes.rows.length === 0 && svcRes.rows.length === 0) {
      return res.status(400).json({ error: 'Item not found in catalog_items or catalog_services' });
    }

    await pool.query(
      `INSERT INTO technician_price_overrides (id, technician_id, item_name, override_price)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (technician_id, item_name) DO UPDATE SET override_price = $4`,
      [crypto.randomUUID(), techId, itemName, overridePrice]
    );

    res.json({ itemName, overridePrice });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/technicians/me/price-overrides/:itemName
router.delete('/me/price-overrides/:itemName', async (req, res, next) => {
  try {
    const { itemName } = req.params;
    const techId = req.technician.id;

    const result = await pool.query(
      `DELETE FROM technician_price_overrides WHERE technician_id = $1 AND item_name = $2 RETURNING item_name`,
      [techId, itemName]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Override not found' });
    }

    res.json({ deleted: true, itemName });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
