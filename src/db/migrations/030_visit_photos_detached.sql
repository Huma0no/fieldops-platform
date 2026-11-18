-- W1c: a photo of a system the technician removed is detached from the visit:
-- hidden in Dispatch and left out of the Report, its file kept on disk.
ALTER TABLE visit_photos ADD COLUMN detached_reason text CHECK (detached_reason IN ('removed_system'));
