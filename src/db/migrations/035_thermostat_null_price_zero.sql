-- Thermostats have no catalog price of their own (docs/shared/CATALOG.md):
-- a thermostat added with no price (e.g. S1200 on the dev catalog) gets $0.
UPDATE catalog_items SET default_price = 0 WHERE category = 'thermostat' AND default_price IS NULL;
