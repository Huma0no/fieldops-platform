const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.TEST_DATABASE_URL || process.env.DATABASE_URL,
});

async function truncateTables() {
  await pool.query(`
    DELETE FROM edit_log;
    DELETE FROM corrections;
    DELETE FROM chat_reads;
    DELETE FROM chat_messages;
    DELETE FROM notifications;
    DELETE FROM invite_codes;
    DELETE FROM device_tokens;
    DELETE FROM visit_photos;
    DELETE FROM weigh_in_data;
    DELETE FROM visit_items;
    DELETE FROM visit_services;
    DELETE FROM visit_systems;
    DELETE FROM transfers;
    DELETE FROM pay_period_lines;
    DELETE FROM pay_periods;
    DELETE FROM restock_records;
    DELETE FROM inventory_assignments;
    DELETE FROM visits;
    DELETE FROM addresses;
    DELETE FROM pdf_batches;
    DELETE FROM technician_price_overrides;
    DELETE FROM technicians;
  `);
}

module.exports = { pool, truncateTables };
