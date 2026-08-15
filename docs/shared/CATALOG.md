# Catalog

**Version:** 1.0
**Date:** 2026-07-30
**Status:** Live — seed data executed and verified against these rules

## Purpose

The catalog (equipment, accessories, fixes, services, thermostats, builders) lives on the server as the single source of truth, seeded via `scripts/seed-catalog.sql`. Both Dispatch and FieldOps consume it through the API — neither app duplicates it locally beyond offline caching. Table structure: `/docs/shared/DATA_MODEL.md` (`catalog_equipment`, `catalog_lineset_configs`, `catalog_items`, `catalog_item_relations`, `catalog_services`).

This document does not reproduce the full equipment/accessory/fix data — that lives in the seed file and the database, not here, to avoid a second copy going stale. It documents the rules that govern how catalog items combine and price.

## Services

Base services: AC · Heat · AC & Heat · Prestart · Drive Run · Cancel.

- **Bundle** — AC & Heat is charged as one unit, not AC + Heat separately.
- **Standalone** — Prestart, Drive Run, and Cancel are mutually exclusive with refrigeration services (AC/Heat/AC & Heat).
- **Finish** is a modifier, not a catalog service — no standalone price, no catalog entry. In the current service model, Finish + AC, Heat, or AC & Heat resolves that visit's service charge to a flat $20, replacing the normal AC/Heat charge rather than adding to it. The Weigh-In-Data Finish addon remains a separate, independent charge.

## Accessories

Governed by five combination rules:
- **Multiplies** — price multiplies by the visit's actual system count (not a fixed "×2" — driven by the real per-visit count, see `/docs/fieldops/workspace/SERVICE-MULTISYSTEM-SPEC.md`).
- **Tech supplied** — the technician carries and charges the item from their own inventory.
- **Custom price** — no fixed price; entered per visit (e.g. "Out of town fee", "Other").
- **Companion items** — auto-activate when their parent item is selected.
- **Zone board** — HZ322, Harmony, and UT3000 are mutually exclusive; selecting one deselects the others and their companions.

Combination rules with modifiers (Finish, etc.) are resolved by the pricing engine, not documented per-item here.

## Lineset Configs

`catalog_lineset_configs` (per `/docs/shared/DATA_MODEL.md`) drives two calculations that share the same baseline-length-and-multiplier data: Weigh-In's **Approx Adjust oz** field and the standalone **Quick Charge Calc** (`/docs/fieldops/CALC-SPEC.md`).

**Formula:** `(actual lineset ft − config's reference length ft) × oz/ft multiplier`

**Multiplier by outdoor brand:**
- Trane: 0.47 oz/ft
- Lennox, Goodman, Daikin: 0.6 oz/ft

## Fixes

Custom-price only where noted (e.g. "Other Fix" — kept as a distinct catalog entry from the accessory "Other" so the two never collide).

## Thermostats

No catalog price of their own (`default_price = 0`) — their cost is derived from the combination of service + accessories + fixes on the visit, resolved by the pricing engine. All thermostats are tech supplied.

## Equipment (indoor/outdoor)

Full model list, factory charge, and revised charge live in `scripts/seed-catalog.sql`, not duplicated here.

- **Revised Charge** applies to units manufactured after May 2025 (R-454B supply-chain adjustment) — the technician determines which charge applies based on manufacture date in the field.
- **R-410A** stays in the catalog as active legacy refrigerant, seeded alongside current equipment — not deprecated.

## Builders

Lennar · MHI · Highland · CastleRock · First America · Chesmar.
