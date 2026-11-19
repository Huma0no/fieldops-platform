# Catalog

**Version:** 1.1
**Date:** 2026-11-19
**Status:** Live — seed data executed and verified against these rules

## Purpose

The catalog (equipment, accessories, fixes, services, thermostats, builders) lives on the server as the single source of truth, seeded via `scripts/seed-catalog.sql`. Both Dispatch and FieldOps consume it through the API — neither app duplicates it locally beyond offline caching. Table structure: `/docs/shared/DATA_MODEL.md` (`catalog_equipment`, `catalog_equipment_charges`, `catalog_manufacturers`, `catalog_items`, `catalog_item_relations`, `catalog_services`).

This document does not reproduce the full equipment/accessory/fix data — that lives in the seed file and the database, not here, to avoid a second copy going stale. It documents the rules that govern how catalog items combine and price.

## Intake selection and catalog administration

Dispatch Intake selects existing catalog entries; it does not create or upsert global catalog data. In particular, its Thermostat and Accessory fields must use valid `catalog_items` entries of the matching category, so the resulting `visit_items` rows retain their catalog references.

Dispatch → Catalog already provides administrative create/edit functionality for Equipment (with its charges), Items, Services, and Manufacturers. The historical Config-Equipment concept is absorbed by its Equipment subsection; no separate Config-Equipment surface is needed.

The remaining future gap is catalog lifecycle management. The catalog tables do not yet have an active/inactive, deactivate, archive, or equivalent behavior. That future work must support administrative deactivate/reactivate, exclude deactivated entries from new operational selectors, and preserve historical references. Hard delete is not the normal lifecycle action.

## Services

Base services: AC · Heat · AC & Heat · Prestart · Drive Run · Cancel. Finish is also a valid standalone Service-section selection.

- **Per system** — each system on the visit has its own service and is charged its own price (AC, Heat or AC & Heat $30; $20 with Finish; Prestart $20; Finish alone $0). Drive Run is call-wide and charged once. Temporarily has no price effect. See `/docs/fieldops/workspace/SERVICE-TSTAT-SPEC.md`.
- **Bundle** — AC & Heat is charged as one unit, not AC + Heat separately.
- **Standalone** — Prestart, Drive Run, and Cancel are mutually exclusive with refrigeration services (AC/Heat/AC & Heat).
- **Finish** has no service price of its own. It is persisted with `is_finish=true`: alongside AC, Heat, or AC & Heat it resolves that visit's service charge to a flat $20, replacing the normal AC/Heat charge rather than adding to it; alone it uses the zero-priced `Finish` catalog persistence entry. The Weigh-In-Data Finish addon remains a separate, independent charge.

## Accessories

Governed by five combination rules:
- **Multiplies** — a new line of this item starts at the visit's system count as its quantity (the real per-visit count, see `/docs/fieldops/workspace/SERVICE-MULTISYSTEM-SPEC.md`); the technician can raise or lower it. Every item is charged **unit price × quantity** (W2, 2026-11-19).
- **Tech supplied** — the technician carries and charges the item from their own inventory.
- **Custom price** — no fixed price; entered per visit (e.g. "Out of town fee", "Other").
- **Companion items** — auto-activate when their parent item is selected.
- **Zone board** — HZ322, Harmony, and UT3000 are mutually exclusive; selecting one deselects the others and their companions.

Combination rules with modifiers (Finish, etc.) are resolved by the pricing engine, not documented per-item here. The existing Weight-In-Data + Finish rule resolves that visit item's price from its $10 base plus its $10 addon to $20; `visit_items.price` persists that resolved price for the visit, and the Completion Report consumes it directly.

## Manufacturers

`catalog_manufacturers` (per `/docs/shared/DATA_MODEL.md`): name, **oz/ft** and **default factory length**. They drive Weigh-In's **Approx Adjust oz** and the standalone **Quick Charge Calc** (`/docs/fieldops/CALC-SPEC.md`), and the default Factory length of both.

**Formula:** `(actual lineset ft − factory length ft) × oz/ft`

| Manufacturer | oz/ft | Default length |
|---|---|---|
| Trane | 0.47 | 15 ft |
| Lennox | 0.6 | 30 ft |
| Goodman | 0.6 | 15 ft |
| Daikin | 0.6 | 15 ft |

Dispatch → Catalog → Manufacturers adds and edits them. The legacy `catalog_lineset_configs` table stays only for Weigh-In rows recorded before W3; it has no date windows and is no longer edited or used for new readings.

## Fixes

Custom-price only where noted (e.g. "Other Fix" — kept as a distinct catalog entry from the accessory "Other" so the two never collide).

## Thermostats

No catalog price of their own (`default_price = 0`) — their cost is derived from the combination of service + accessories + fixes on the visit, resolved by the pricing engine. All thermostats are tech supplied.

## Equipment (indoor/outdoor)

Full model list lives in `scripts/seed-catalog.sql`, not duplicated here.

- **Charges per manufacturer + length** (`catalog_equipment_charges`): an outdoor model has zero or more factory charges, each for one manufacturer + factory length (e.g. Lennox ML14KC1-018: 15 ft 78 oz, 30 ft 92 oz). Weigh-In prefills the charge for the selected manufacturer + length; a missing combination shows empty and the technician types it. Dispatch edits them in the Equipment form (add, edit or remove a length row).
- **Migration from Factory / Revised (W3, 2026-11-19):** old revised values became the charge of their length (Trane 25 ft, Lennox 30 ft); old factory values went to the brand's base length (Trane 15 ft, Daikin and Goodman 15 ft, Lennox 15 ft — the seed's Lennox revised values are the factory value + 15 ft × 0.6 oz/ft, so the factory column is the 15 ft charge). The manufacture-date rule for Revised Charge is removed.
- **R-410A** stays in the catalog as active legacy refrigerant, seeded alongside current equipment — not deprecated.

## Builders

Lennar · MHI · Highland · CastleRock · First America · Chesmar.
