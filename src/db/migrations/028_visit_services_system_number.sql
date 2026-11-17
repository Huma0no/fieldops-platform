-- Per-system services: a row with system_number is that system's service and
-- is charged on its own. A row without it is a visit-level service (Drive Run,
-- Cancel, rows written before per-system services, Dispatch corrections) and
-- keeps the system-count multiplier rule.
ALTER TABLE visit_services ADD COLUMN system_number integer CHECK (system_number >= 1);
