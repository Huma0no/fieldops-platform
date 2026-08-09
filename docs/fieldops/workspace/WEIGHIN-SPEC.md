# Weigh-In

**Version:** 1.0
**Date:** 2026-07-30
**Status:** Closed design — built, neomorphic style applied (system switcher deferred, see end)

## Purpose

Fourth step of Workspace, its own dedicated step (not folded into Accessories). Refrigerant charge measurement, per system.

## Structure

Per-system data-entry form with a System 1/2 (etc.) switcher. Header shows system number + indoor/outdoor model chips.

## Canonical fields

1. Lineset ft
2. Factory Charge oz (prefilled from `/docs/shared/CATALOG.md`)
3. Line Config (dropdown, outdoor-brand preselected)
4. Approx Adjust oz (auto-calculated: lineset ft + config)
5. Adjusted oz
6. Fan CFM
7. Liquid Temp °F
8. Suction Temp °F
9. Condenser Sat °F
10. Subcooling °F (computed: Condenser Sat − Liquid Temp). Tooltip: "Auto-calculated: Condenser Sat − Liquid Temp. Take both readings first."
11. OEM SC Goal °F (fixed at 10°F for every system — not derived per-equipment from the catalog)
12. SC Deviation °F (computed)
13. Scale photo — GPS/EXIF required, see `/docs/shared/PHOTOS-GPS-INTEGRATIONS.md`
14. Fan Speed photo — GPS/EXIF required
15. New Total Charge — computed, read-only output for the technician to write on the outdoor unit

## Charge toggle

Small toggle in the section header, per-system. Auto-activates when any numeric field is filled; the technician can manually deactivate without clearing the underlying data. Scoped per-system — N systems can independently have their own charge active.

## Deferred (existing behavior kept as-is, not rebuilt in the latest style pass)

Tabbed system switcher, Factory/Revised toggle, GPS badge display on SCALE/FAN photos.
