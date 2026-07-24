-- Extend visit_photos category to allow correction evidence photos
ALTER TABLE visit_photos DROP CONSTRAINT visit_photos_category_check;
ALTER TABLE visit_photos ADD CONSTRAINT visit_photos_category_check
  CHECK (category IN ('weigh_in_scale', 'fan_speed', 'site_evidence', 'correction_evidence'));

-- Add evidence columns to corrections
ALTER TABLE corrections ADD COLUMN IF NOT EXISTS has_evidence boolean NOT NULL DEFAULT false;
ALTER TABLE corrections ADD COLUMN IF NOT EXISTS evidence_photo_id text REFERENCES visit_photos(id);

-- Extend corrections status to include needs_evidence
ALTER TABLE corrections DROP CONSTRAINT corrections_status_check;
ALTER TABLE corrections ADD CONSTRAINT corrections_status_check
  CHECK (status IN ('pending', 'approved', 'rejected', 'needs_evidence'));
