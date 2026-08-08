-- Pre-production: no real correction data to preserve, replace rather than migrate.
DELETE FROM corrections;

ALTER TABLE corrections DROP CONSTRAINT corrections_status_check;
ALTER TABLE corrections DROP COLUMN corrected_fields;
ALTER TABLE corrections DROP COLUMN reason;
ALTER TABLE corrections DROP COLUMN dispatcher_note;
ALTER TABLE corrections DROP COLUMN has_evidence;
ALTER TABLE corrections DROP COLUMN evidence_photo_id;
ALTER TABLE corrections ADD COLUMN message text NOT NULL DEFAULT '';
ALTER TABLE corrections ALTER COLUMN message DROP DEFAULT;
ALTER TABLE corrections RENAME COLUMN resolved_at TO applied_at;
ALTER TABLE corrections ADD CONSTRAINT corrections_status_check
  CHECK (status IN ('open', 'applied', 'expired'));

-- The evidence-photo sub-flow (migration 014) is fully dropped; revert the category it added.
ALTER TABLE visit_photos DROP CONSTRAINT visit_photos_category_check;
ALTER TABLE visit_photos ADD CONSTRAINT visit_photos_category_check
  CHECK (category IN ('weigh_in_scale', 'fan_speed', 'site_evidence'));
