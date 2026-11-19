-- W2 (Acc + Fix): a technician's pinned template per category ("yours").
-- No row means the suggested template (usage history, or the default rank).
CREATE TABLE IF NOT EXISTS technician_item_templates (
  technician_id text NOT NULL REFERENCES technicians(id),
  category      text NOT NULL CHECK (category IN ('accessory', 'fix')),
  tile_keys     jsonb NOT NULL,
  updated_at    text NOT NULL,
  PRIMARY KEY (technician_id, category)
);
