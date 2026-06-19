-- =============================================================================
-- fieldops-platform: schema.sql
-- Single idempotent file: drops all tables then recreates them in FK order.
-- Rules:
--   - All PKs are text with DEFAULT gen_random_uuid()::text
--   - All timestamps and date columns are text (ISO 8601 strings)
--   - No ORM, no uuid type, no SERIAL
-- =============================================================================

-- ---------------------------------------------------------------------------
-- DROP ORDER (reverse FK dependency)
-- ---------------------------------------------------------------------------

DROP TABLE IF EXISTS edit_log CASCADE;
DROP TABLE IF EXISTS corrections CASCADE;
DROP TABLE IF EXISTS notifications CASCADE;
DROP TABLE IF EXISTS chat_reads CASCADE;
DROP TABLE IF EXISTS chat_messages CASCADE;
DROP TABLE IF EXISTS pay_period_lines CASCADE;
DROP TABLE IF EXISTS pay_periods CASCADE;
DROP TABLE IF EXISTS restock_records CASCADE;
DROP TABLE IF EXISTS inventory_assignments CASCADE;
DROP TABLE IF EXISTS transfers CASCADE;
DROP TABLE IF EXISTS visit_photos CASCADE;
DROP TABLE IF EXISTS weigh_in_data CASCADE;
DROP TABLE IF EXISTS visit_items CASCADE;
DROP TABLE IF EXISTS visit_services CASCADE;
DROP TABLE IF EXISTS visit_systems CASCADE;
DROP TABLE IF EXISTS visits CASCADE;
DROP TABLE IF EXISTS technician_price_overrides CASCADE;
DROP TABLE IF EXISTS technician_settings CASCADE;
DROP TABLE IF EXISTS technicians CASCADE;
DROP TABLE IF EXISTS addresses CASCADE;
DROP TABLE IF EXISTS pdf_batches CASCADE;
DROP TABLE IF EXISTS role_permissions CASCADE;
DROP TABLE IF EXISTS catalog_item_relations CASCADE;
DROP TABLE IF EXISTS catalog_services CASCADE;
DROP TABLE IF EXISTS catalog_items CASCADE;
DROP TABLE IF EXISTS catalog_lineset_configs CASCADE;
DROP TABLE IF EXISTS catalog_equipment CASCADE;
DROP TABLE IF EXISTS device_tokens CASCADE;

-- ---------------------------------------------------------------------------
-- CREATE ORDER (FK-dependency order)
-- ---------------------------------------------------------------------------

-- 1. catalog_equipment
CREATE TABLE catalog_equipment (
  model               text PRIMARY KEY,
  unit_type           text NOT NULL,
  brand               text NOT NULL,
  series              text,
  refrigerant         text,
  is_a2l              boolean,
  btu                 integer,
  factory_charge_oz   real,
  revised_charge_oz   real,
  pesp                real,
  oem_subcooling_goal real
);

-- 2. catalog_lineset_configs
CREATE TABLE catalog_lineset_configs (
  config_key            text PRIMARY KEY,
  reference_length_ft   real NOT NULL,
  adjust_rate_oz_per_ft real NOT NULL
);

-- 3. catalog_items
CREATE TABLE catalog_items (
  item_name                  text PRIMARY KEY,
  category                   text NOT NULL CHECK (category IN ('accessory', 'fix', 'thermostat')),
  default_price              real,
  tech_supplied              boolean NOT NULL,
  multiplies_by_system_count boolean NOT NULL DEFAULT false,
  custom_price               boolean NOT NULL DEFAULT false,
  expected_price_min         real,
  expected_price_max         real,
  finish_addon_price         real,
  CONSTRAINT tech_supplied_thermostat CHECK (
    category <> 'thermostat' OR tech_supplied = true
  ),
  CONSTRAINT tech_supplied_fix CHECK (
    category <> 'fix' OR tech_supplied = false
  )
);

-- 4. catalog_item_relations
CREATE TABLE catalog_item_relations (
  id                  text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  item_name           text NOT NULL REFERENCES catalog_items(item_name),
  relation_type       text NOT NULL CHECK (relation_type IN ('companion', 'exclusion_group')),
  related_item_name   text NOT NULL REFERENCES catalog_items(item_name),
  exclusion_group_id  text
);

-- 5. catalog_services
CREATE TABLE catalog_services (
  service_name               text PRIMARY KEY,
  default_price              real NOT NULL,
  is_bundle                  boolean NOT NULL DEFAULT false,
  multiplies_by_system_count boolean NOT NULL DEFAULT false
);

-- 6. role_permissions
CREATE TABLE role_permissions (
  id     text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  role   text NOT NULL CHECK (role IN ('owner', 'dispatcher', 'technician')),
  action text NOT NULL,
  UNIQUE (role, action)
);

-- 7. pdf_batches
CREATE TABLE pdf_batches (
  id            text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  total_calls   integer NOT NULL,
  skipped_count integer NOT NULL DEFAULT 0,
  status        text NOT NULL CHECK (status IN ('in_review', 'released')),
  created_at    text NOT NULL
);

-- 8. addresses
CREATE TABLE addresses (
  id          text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  street      text NOT NULL,
  city        text,
  state       text,
  zip         text,
  subdivision text,
  builder     text
);

CREATE UNIQUE INDEX addresses_street_idx ON addresses (street);

-- 9. technicians
CREATE TABLE technicians (
  id         text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name       text NOT NULL,
  role       text NOT NULL CHECK (role IN ('owner', 'dispatcher', 'technician')),
  is_active  boolean NOT NULL DEFAULT true,
  created_at text NOT NULL
);

-- 10. technician_settings
CREATE TABLE technician_settings (
  technician_id         text PRIMARY KEY REFERENCES technicians(id),
  theme                 text,
  ai_provider           text,
  ai_api_key_anthropic  text,
  ai_api_key_openai     text,
  ai_api_key_google     text,
  onboarding_completed  boolean NOT NULL DEFAULT false
);

-- 11. technician_price_overrides
-- item_name is NOT a FK here: it references either catalog_items.item_name
-- OR catalog_services.service_name, so no single FK is valid.
CREATE TABLE technician_price_overrides (
  id             text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  technician_id  text NOT NULL REFERENCES technicians(id),
  item_name      text NOT NULL,
  override_price real NOT NULL,
  UNIQUE (technician_id, item_name)
);

-- 12. visits
CREATE TABLE visits (
  id                   text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  address_id           text NOT NULL REFERENCES addresses(id),
  technician_id        text REFERENCES technicians(id),
  batch_id             text REFERENCES pdf_batches(id),
  order_number         text,
  status               text NOT NULL CHECK (status IN (
    'pending_review', 'in_lobby', 'assigned', 'in_progress',
    'completed', 'temporarily', 'cancelled'
  )),
  CONSTRAINT visit_assigned_requires_technician CHECK (
    status NOT IN ('assigned', 'in_progress', 'completed', 'temporarily') OR technician_id IS NOT NULL
  ),
  date                 text,
  scheduled_time       text,
  work_type            text,
  company_notes        text,
  has_multiple_systems boolean NOT NULL DEFAULT false,
  contact_name         text,
  contact_phone        text,
  contact_channel      text,
  total_price          real,
  notes                text,
  created_at           text NOT NULL,
  completed_at         text
);

-- 13. visit_systems
CREATE TABLE visit_systems (
  id             text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  visit_id       text NOT NULL REFERENCES visits(id),
  system_number  integer NOT NULL,
  indoor_model   text,
  outdoor_model  text,
  refrigerant    text
);

-- 14. visit_services
CREATE TABLE visit_services (
  id               text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  visit_id         text NOT NULL REFERENCES visits(id),
  service_name     text NOT NULL REFERENCES catalog_services(service_name),
  is_finish        boolean NOT NULL DEFAULT false,
  is_temporarily   boolean NOT NULL DEFAULT false,
  price            real NOT NULL
);

-- 15. visit_items
CREATE TABLE visit_items (
  id            text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  visit_id      text NOT NULL REFERENCES visits(id),
  item_name     text NOT NULL REFERENCES catalog_items(item_name),
  category      text NOT NULL CHECK (category IN ('accessory', 'fix', 'thermostat')),
  quantity      integer NOT NULL DEFAULT 1,
  price         real NOT NULL,
  tech_supplied boolean NOT NULL,
  CONSTRAINT visit_item_qty_positive CHECK (quantity > 0)
);

-- 16. weigh_in_data
CREATE TABLE weigh_in_data (
  id                   text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  visit_id             text NOT NULL REFERENCES visits(id),
  system_number        integer NOT NULL,
  lineset_length       real,
  factory_charge_oz    real,
  factory_line_config  text REFERENCES catalog_lineset_configs(config_key),
  approx_adjust_oz     real,
  adjusted_oz          real,
  fan_speed_cfm        real,
  liquid_line_temp     real,
  suction_line_temp    real,
  condenser_sat_temp   real,
  subcooling_value     real,
  oem_subcooling_goal  real,
  subcooling_deviation real
);

-- 17. visit_photos
CREATE TABLE visit_photos (
  id            text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  visit_id      text NOT NULL REFERENCES visits(id),
  system_number integer,
  slug          text NOT NULL,
  tag           text NOT NULL,
  label         text,
  category      text NOT NULL CHECK (category IN ('weigh_in_scale', 'fan_speed', 'site_evidence')),
  stored_at     text
);

-- 18. transfers
CREATE TABLE transfers (
  id           text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  visit_id     text NOT NULL REFERENCES visits(id),
  from_tech_id text NOT NULL REFERENCES technicians(id),
  to_tech_id   text NOT NULL REFERENCES technicians(id),
  reason       text,
  status       text NOT NULL CHECK (status IN ('pending', 'accepted', 'rejected', 'expired')),
  created_at   text NOT NULL,
  accepted_at  text,
  resolved_at  text
);

-- 19. inventory_assignments
CREATE TABLE inventory_assignments (
  id                 text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  technician_id      text NOT NULL REFERENCES technicians(id),
  item_name          text NOT NULL REFERENCES catalog_items(item_name),
  quantity_assigned  integer NOT NULL,
  period_start       text NOT NULL,
  created_at         text NOT NULL,
  CONSTRAINT inventory_qty_positive CHECK (quantity_assigned > 0)
);

-- 20. restock_records
CREATE TABLE restock_records (
  id              text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  period_start    text NOT NULL,
  period_end      text NOT NULL,
  item_name       text NOT NULL REFERENCES catalog_items(item_name),
  total_consumed  integer NOT NULL DEFAULT 0,
  status          text NOT NULL CHECK (status IN ('pending', 'restocked')),
  restocked_at    text,
  UNIQUE (item_name, period_start, period_end)
);

-- 21. pay_periods
CREATE TABLE pay_periods (
  id           text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  week_start   text NOT NULL,
  week_end     text NOT NULL,
  status       text NOT NULL CHECK (status IN ('open', 'closed', 'paid')),
  gross_total  real,
  tax_amount   real,
  paid_at      text
);

-- 22. pay_period_lines
CREATE TABLE pay_period_lines (
  id                  text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  period_id           text NOT NULL REFERENCES pay_periods(id),
  technician_id       text NOT NULL REFERENCES technicians(id),
  gross_amount        real NOT NULL,
  commission_retained real NOT NULL,
  net_amount          real NOT NULL,
  UNIQUE (period_id, technician_id)
);

-- 23. chat_messages
CREATE TABLE chat_messages (
  id           text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  sender_id    text NOT NULL REFERENCES technicians(id),
  recipient_id text REFERENCES technicians(id),
  body         text NOT NULL,
  type         text NOT NULL CHECK (type IN ('direct', 'broadcast')),
  CONSTRAINT chat_message_recipient_check CHECK (
    (type = 'direct' AND recipient_id IS NOT NULL) OR
    (type = 'broadcast' AND recipient_id IS NULL)
  ),
  created_at   text NOT NULL
);

-- 24. chat_reads
CREATE TABLE chat_reads (
  id             text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  message_id     text NOT NULL REFERENCES chat_messages(id),
  technician_id  text NOT NULL REFERENCES technicians(id),
  read_at        text NOT NULL,
  UNIQUE (message_id, technician_id)
);

-- 25. notifications
CREATE TABLE notifications (
  id           text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  recipient_id text NOT NULL REFERENCES technicians(id),
  type         text NOT NULL,
  body         text NOT NULL,
  link_to      text,
  payload      text,
  read         boolean NOT NULL DEFAULT false,
  created_at   text NOT NULL
);

-- 26. corrections
CREATE TABLE corrections (
  id               text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  visit_id         text NOT NULL REFERENCES visits(id),
  requested_by     text NOT NULL REFERENCES technicians(id),
  corrected_fields text NOT NULL,
  reason           text,
  status           text NOT NULL CHECK (status IN ('pending', 'approved', 'rejected')),
  requested_at     text NOT NULL,
  resolved_at      text,
  dispatcher_note  text
);

-- 27. edit_log
CREATE TABLE edit_log (
  id         text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  visit_id   text NOT NULL REFERENCES visits(id),
  changed_at text NOT NULL,
  summary    text NOT NULL,
  source     text NOT NULL CHECK (source IN ('dispatch_direct', 'correction_approved'))
);

-- 28. device_tokens (auth layer)
CREATE TABLE device_tokens (
  token          text PRIMARY KEY,
  technician_id  text NOT NULL REFERENCES technicians(id),
  created_at     text NOT NULL
);

-- ============================================================
-- INDEXES — high-traffic FK columns
-- ============================================================

CREATE INDEX visits_technician_id_idx ON visits (technician_id);
CREATE INDEX visits_address_id_idx ON visits (address_id);
CREATE INDEX visits_batch_id_idx ON visits (batch_id);

CREATE INDEX visit_systems_visit_id_idx ON visit_systems (visit_id);
CREATE INDEX visit_services_visit_id_idx ON visit_services (visit_id);
CREATE INDEX visit_items_visit_id_idx ON visit_items (visit_id);
CREATE INDEX weigh_in_data_visit_id_idx ON weigh_in_data (visit_id);
CREATE INDEX visit_photos_visit_id_idx ON visit_photos (visit_id);

CREATE INDEX transfers_visit_id_idx ON transfers (visit_id);
CREATE INDEX transfers_to_tech_id_idx ON transfers (to_tech_id);

CREATE INDEX notifications_recipient_id_idx ON notifications (recipient_id);
CREATE INDEX chat_messages_sender_id_idx ON chat_messages (sender_id);
CREATE INDEX chat_messages_recipient_id_idx ON chat_messages (recipient_id);
CREATE INDEX chat_reads_message_id_idx ON chat_reads (message_id);

CREATE INDEX corrections_visit_id_idx ON corrections (visit_id);
CREATE INDEX edit_log_visit_id_idx ON edit_log (visit_id);

CREATE INDEX pay_period_lines_period_id_idx ON pay_period_lines (period_id);
CREATE INDEX pay_period_lines_technician_id_idx ON pay_period_lines (technician_id);

CREATE INDEX inventory_assignments_technician_id_idx ON inventory_assignments (technician_id);
CREATE INDEX device_tokens_technician_id_idx ON device_tokens (technician_id);
