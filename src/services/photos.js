// Photo evidence storage (docs/shared/PHOTOS-GPS-INTEGRATIONS.md).
// Files sit behind a small interface — put(key, buffer) / read(key) — backed by
// the server's local disk (PHOTO_STORAGE_DIR). A later object store only has to
// provide the same two functions. visit_photos.stored_at holds the key.
const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

const PHOTO_CATEGORIES = ['weigh_in_scale', 'fan_speed', 'site_evidence'];
const KEY_PATTERN = /^[A-Za-z0-9-]{1,100}\/[A-Za-z0-9-]{1,100}\.jpg$/;
const PHOTO_ID_PATTERN = /^[A-Za-z0-9-]{1,100}$/;

function storageRoot() {
  return path.resolve(process.env.PHOTO_STORAGE_DIR || path.join(__dirname, '..', '..', 'data', 'photos'));
}

function photoKey(visitId, photoId) {
  const key = `${visitId}/${photoId}.jpg`;
  if (!KEY_PATTERN.test(key)) throw Object.assign(new Error('Invalid photo id'), { status: 400 });
  return key;
}

const localDisk = {
  async put(key, buffer) {
    const file = path.join(storageRoot(), key);
    await fs.mkdir(path.dirname(file), { recursive: true });
    const temp = `${file}.${crypto.randomUUID()}.tmp`;
    await fs.writeFile(temp, buffer);
    await fs.rename(temp, file);
    return key;
  },
  async read(key) {
    if (!KEY_PATTERN.test(key)) throw Object.assign(new Error('Invalid photo key'), { status: 400 });
    return fs.readFile(path.join(storageRoot(), key));
  },
};

// A Report lists its photos (evidenceRefs) even when they are still on the
// phone; each one gets its row now, and the upload fills stored_at later.
async function recordEvidenceRefs(db, visitId, refs) {
  for (const ref of Array.isArray(refs) ? refs : []) {
    if (typeof ref?.id !== 'string' || !PHOTO_ID_PATTERN.test(ref.id)) continue;
    if (!PHOTO_CATEGORIES.includes(ref.category) || typeof ref.slug !== 'string' || typeof ref.tag !== 'string') continue;
    const systemNumber = Number.isInteger(Number(ref.systemNumber)) && ref.systemNumber != null ? Number(ref.systemNumber) : null;
    await db.query(
      `INSERT INTO visit_photos (id, visit_id, system_number, slug, tag, label, category, stored_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, null)
       ON CONFLICT (id) DO NOTHING`,
      [ref.id, visitId, systemNumber, ref.slug, ref.tag, ref.label ?? null, ref.category]
    );
  }
}

module.exports = {
  PHOTO_CATEGORIES,
  PHOTO_ID_PATTERN,
  photoKey,
  photoStorage: localDisk,
  recordEvidenceRefs,
};
