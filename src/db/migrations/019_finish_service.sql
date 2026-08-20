-- Finish-only is a valid Service-section selection. This zero-priced catalog
-- entry satisfies visit_services.service_name's existing foreign key; the
-- row still carries is_finish = true so item addon pricing remains canonical.
INSERT INTO catalog_services (service_name, default_price, is_bundle, multiplies_by_system_count)
VALUES ('Finish', 0, false, false)
ON CONFLICT (service_name) DO NOTHING;
