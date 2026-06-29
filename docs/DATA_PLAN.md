# Data Plan
## Field Ops + Dispatch — Catalog & Seed Data

**Version:** 1.0
**Date:** 2026-06-29
**Authors:** Christian Huerta + Claude (planning session)
**Status:** Active — seed pending execution
**Based on:** SYSTEM_DESIGN.md, DATA_MODEL.md, DEVELOPMENT_PLAN.md
**Referenced by:** DEVELOPMENT_PLAN.md Phase 0 ("Done when" criterion)

---

## 1. Purpose

This document defines the catalog data strategy for the Field Ops platform — what the data is, where it comes from, how it gets into the database, how it evolves, and what must be true before each frontend phase can consume it.

---

## 2. What "catalog" means in this system

The catalog is the set of tables that define what can be sold, installed, and tracked — independent of any specific visit. It is the single source of truth for:

- What services exist and what they cost
- What accessories, fixes, and thermostats exist, their default prices, and their rules
- What equipment models exist, their refrigerant type, factory charge, and specs
- What companion and exclusion relationships exist between items
- What lineset configs exist for weigh-in calculations

The catalog does not change per visit. It changes when the business changes — new equipment added, prices updated, new accessories introduced. Those changes propagate to future visits automatically; historical visits are never affected.

**Catalog tables:**
- `catalog_services`
- `catalog_items`
- `catalog_item_relations`
- `catalog_equipment`
- `catalog_lineset_configs`

---

## 3. Source of truth

The canonical source of catalog data is `scripts/seed-catalog.sql`. This file contains:

- `SERVICES` — base service names and standalone classification
- `DEFAULT_PRICES` — prices per service, accessory, fix, and thermostat
- `ACCESSORIES` — full accessory list with all classification arrays:
  - `TWO_SYSTEMS_ACCESSORIES` → `multiplies_by_system_count = true` — priced once per system, multiplied by the actual system count on the visit
  - `TECH_SUPPLIED_ACCESSORIES` → `tech_supplied = true`
  - `CUSTOM_PRICE_ACCESSORIES` → `custom_price = true`
  - `ACCESSORY_COMPANIONS` → `catalog_item_relations` with `relation_type = 'companion'`
  - `ZONE_BOARDS` → `catalog_item_relations` with `relation_type = 'exclusion_group'`
- `FIXES` — fix list with `CUSTOM_PRICE_FIXES`
- `THERMOSTATS` — thermostat names (all `tech_supplied = true`, price to be defined — see curation checklist §6)
- `INDOOR_CATALOG` / `OUTDOOR_CATALOG` — equipment models with specs
- `BUILDERS` — builder names (informational only, not a catalog table)

**Status:** once the seed is executed and verified, the database is the source of truth. Catalog changes are made via the Dispatch catalog editor or via targeted migration scripts — not by re-running the seed.

---

## 4. Known issues to resolve before seeding

The following issues were identified during the seed script generation and must be resolved before executing the seed:

### 4.1 "Other" name collision

`data.js` defines `"Other"` as both an accessory (`CUSTOM_PRICE_ACCESSORIES`) and a fix (`CUSTOM_PRICE_FIXES`). Since `catalog_items.item_name` is the primary key, both cannot coexist with the same name.

**Resolution:** rename the fix variant to `"Other Fix"` in the seed script. The accessory variant keeps the name `"Other"`.

This does not require changing `data.js` — the seed script handles the rename at insert time.

### 4.2 "Finish" as a catalog_service row

`data.js` includes `SERVICES.FINISH = "Finish"` but Finish is a modifier, not a base service. It does not have its own price row in `DEFAULT_PRICES.SERVICE`. Per `DATA_MODEL.md`, Finish is tracked as `visit_services.is_finish` — not as a separate `catalog_services` row.

**Resolution:** exclude "Finish" from the `catalog_services` seed. It is handled by the pricing engine as a modifier, not a catalog entry.

---

## 5. Seed script

**Location:** `scripts/seed-catalog.sql`

**Execution:**
```bash
psql postgresql://postgres:FieldOps2026@localhost:5432/fieldops -f scripts/seed-catalog.sql
```

**Verification — run after seeding:**
```sql
SELECT
  (SELECT COUNT(*) FROM catalog_services)       AS services,
  (SELECT COUNT(*) FROM catalog_items)           AS items,
  (SELECT COUNT(*) FROM catalog_item_relations)  AS relations,
  (SELECT COUNT(*) FROM catalog_equipment)       AS equipment,
  (SELECT COUNT(*) FROM catalog_lineset_configs) AS lineset_configs;
```

**Expected counts:**
- `catalog_services` — 6 rows (AC, Heat, AC & Heat, Prestart, Drive Run, Cancel)
- `catalog_items` — ~40 rows (21 accessories + 12 fixes + 7 thermostats)
- `catalog_item_relations` — ~10 rows (companion pairs + zone board exclusions)
- `catalog_equipment` — ~132 rows (64 indoor + 68 outdoor)
- `catalog_lineset_configs` — 6 rows

---

## 6. Data curation checklist

Before executing the seed, verify the following with the operator (Christian):

- [ ] All accessory names in `ACCESSORIES` are current and in use
- [ ] All fix names in `FIXES` are current and in use
- [ ] Thermostat list matches models currently being installed
- [ ] Thermostat default price defined (not present in source data — must be set explicitly)
- [ ] All prices in `DEFAULT_PRICES` reflect current billing rates
- [ ] `BUILDERS` list matches current active builders
- [ ] Equipment catalog covers all models currently seen in the field
- [ ] "Other Fix" rename is acceptable for the fix variant of "Other"
- [ ] "Finish" exclusion from `catalog_services` is understood and accepted

---

## 7. Frontend phase prerequisites

The following frontend phases require specific catalog data to be present before development or testing can proceed:

| Frontend Phase | Catalog prerequisite |
|---|---|
| F0 — Auth | None |
| F1 — My Calls | None |
| F2 — Lobby | None |
| F3 — Workspace | `catalog_items` (accessories, fixes, thermostats) + `catalog_services` |
| F4 — Reports | None (reads completed visit data, not catalog) |
| F5 — PDF Intake | `catalog_items` (for accessory name matching in AI extraction prompt) |
| F6 — History | `catalog_items` (for price anomaly detection) |
| F7 — Pay Periods | None (reads visit totals, not catalog) |
| F8 — Corrections | None |
| F9 — Chat | None |
| F10 — Settings | `catalog_items` + `catalog_services` (for price override UI) |

**Current status:** catalog not seeded with real data. F3 and beyond cannot be tested against real data until the seed is executed and verified.

---

## 8. Catalog update process (post-seed)

Once the catalog is seeded and the platform is live, updates follow this process:

**For price changes or single item edits:**
Dispatcher uses the catalog editor in Dispatch (`PATCH /api/dispatch/catalog/:table/:id`). No SQL required.

**For bulk changes (new equipment series, new accessories):**
1. Update `data.js` with the new data (maintains the historical record)
2. Generate a targeted migration script (not a full re-seed)
3. Review and execute the script
4. Verify via the verification query in §5

**Rule:** catalog changes never affect historical visit records. `visit_items`, `visit_services`, and `visit_systems` store their values explicitly at visit creation time.

---

## 9. What this document does not cover

- Visit data (created per job, not catalog)
- Technician data (created via invite flow)
- Pay period data (generated by the system)
- Test fixtures (managed per phase in the backend test suite)

---

*Document version 1.0*
*Next action: complete curation checklist (§6), resolve known issues (§4), execute seed (§5)*
