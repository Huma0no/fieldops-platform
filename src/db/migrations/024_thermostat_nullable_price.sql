-- Thermostats have no price contribution in the FieldOps domain model.
-- Allow NULL price on visit_items for thermostat rows while keeping
-- price required (NOT NULL) for billable categories (accessory, fix).

ALTER TABLE visit_items
  ALTER COLUMN price DROP NOT NULL;

ALTER TABLE visit_items
  DROP CONSTRAINT IF EXISTS visit_item_price_required,
  ADD CONSTRAINT visit_item_price_required CHECK (category = 'thermostat' OR price IS NOT NULL);

