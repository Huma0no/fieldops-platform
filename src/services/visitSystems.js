// W1b: the Report carries the call's systems as the technician left them. On
// acceptance the server applies them: a new system (added in the Workspace) is
// inserted and flagged added_by_technician; changed equipment updates the row.
// Each change is logged with its before/after for Dispatch ("changed by tech").
// Office systems are never removed: a Report that omits one is rejected.

const EQUIPMENT_FIELDS = [
  ['indoorModel', 'indoor_model'],
  ['outdoorModel', 'outdoor_model'],
  ['coilModel', 'coil_model'],
  ['refrigerant', 'refrigerant'],
];
const MAX_MODEL_LENGTH = 120;

function systemsMismatch(message) {
  return Object.assign(new Error(message), { status: 409, code: 'REPORT_CONTENT_MISMATCH', fields: ['systems'] });
}

function readEquipment(row, snake) {
  return Object.fromEntries(EQUIPMENT_FIELDS.map(([camel, column]) => {
    const value = snake ? row[column] : (row[camel] ?? row[column]);
    return [camel, typeof value === 'string' && value.trim() ? value.trim() : null];
  }));
}

function sameEquipment(a, b) {
  return EQUIPMENT_FIELDS.every(([camel]) => a[camel] === b[camel]);
}

async function applySystemChanges(client, visitId, submittedSystems, technicianId, changedAt) {
  if (!Array.isArray(submittedSystems)) return;
  const { rows } = await client.query(
    `SELECT system_number, indoor_model, outdoor_model, coil_model, refrigerant
     FROM visit_systems WHERE visit_id = $1 ORDER BY system_number`,
    [visitId]
  );
  const existing = new Map(rows.map(row => [row.system_number, readEquipment(row, true)]));
  let nextNumber = Math.max(0, ...existing.keys()) + 1;

  const submitted = submittedSystems
    .map(row => ({ systemNumber: Number(row?.systemNumber ?? row?.system_number), equipment: readEquipment(row ?? {}, false) }))
    .sort((a, b) => a.systemNumber - b.systemNumber);
  if (new Set(submitted.map(row => row.systemNumber)).size !== submitted.length) throw systemsMismatch('Duplicate system');
  const missing = [...existing.keys()].filter(number => !submitted.some(row => row.systemNumber === number));
  if (missing.length) throw systemsMismatch(`System ${missing.join(', ')} is missing from the Report`);

  let added = false;
  for (const { systemNumber, equipment } of submitted) {
    if (Object.values(equipment).some(value => value != null && value.length > MAX_MODEL_LENGTH)) {
      throw systemsMismatch('Equipment model too long');
    }
    const before = existing.get(systemNumber);
    if (before) {
      if (sameEquipment(before, equipment)) continue;
      await client.query(
        `UPDATE visit_systems SET indoor_model = $1, outdoor_model = $2, coil_model = $3, refrigerant = $4
         WHERE visit_id = $5 AND system_number = $6`,
        [equipment.indoorModel, equipment.outdoorModel, equipment.coilModel, equipment.refrigerant, visitId, systemNumber]
      );
      await logChange(client, visitId, systemNumber, 'equipment_modified', before, equipment, technicianId, changedAt);
      continue;
    }
    // A new system takes the next number and needs its outdoor equipment.
    if (systemNumber !== nextNumber) throw systemsMismatch(`System ${systemNumber} is not the next system of this call`);
    if (!equipment.outdoorModel) throw systemsMismatch(`System ${systemNumber}: outdoor equipment is required`);
    await client.query(
      `INSERT INTO visit_systems (id, visit_id, system_number, indoor_model, outdoor_model, coil_model, refrigerant, added_by_technician)
       VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, true)`,
      [visitId, systemNumber, equipment.indoorModel, equipment.outdoorModel, equipment.coilModel, equipment.refrigerant]
    );
    await logChange(client, visitId, systemNumber, 'added', null, equipment, technicianId, changedAt);
    nextNumber += 1;
    added = true;
  }
  if (added) {
    await client.query(
      `UPDATE visits SET has_multiple_systems = (SELECT COUNT(*) > 1 FROM visit_systems WHERE visit_id = $1) WHERE id = $1`,
      [visitId]
    );
  }
}

function logChange(client, visitId, systemNumber, change, before, after, technicianId, changedAt) {
  return client.query(
    `INSERT INTO visit_system_changes (visit_id, system_number, change, before, after, technician_id, changed_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [visitId, systemNumber, change, before ? JSON.stringify(before) : null, JSON.stringify(after), technicianId, changedAt]
  );
}

// For the visit detail (Dispatch report view).
async function systemChangesForVisit(db, visitId) {
  const { rows } = await db.query(
    `SELECT c.system_number, c.change, c.before, c.after, c.changed_at, t.name AS technician_name
     FROM visit_system_changes c JOIN technicians t ON t.id = c.technician_id
     WHERE c.visit_id = $1 ORDER BY c.changed_at, c.system_number`,
    [visitId]
  );
  return rows.map(row => ({
    systemNumber: row.system_number,
    change: row.change,
    before: row.before,
    after: row.after,
    technicianName: row.technician_name,
    changedAt: row.changed_at,
  }));
}

module.exports = { applySystemChanges, systemChangesForVisit };
