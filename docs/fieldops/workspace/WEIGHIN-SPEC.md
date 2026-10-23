# Weigh-In

**Version:** 1.1
**Date:** 2026-10-23
**Status:** Canonical behavior specified; implementation and QA pending

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
11. OEM SC Goal °F (numeric field, defaults to 10°F for each system, editable independently by the technician)
12. SC Deviation °F (computed: measured Subcooling − saved OEM SC Goal)
13. Scale photo — GPS/EXIF required, see `/docs/shared/PHOTOS-GPS-INTEGRATIONS.md`
14. Fan Speed photo — GPS/EXIF required
15. New Total Charge — computed, read-only output for the technician to write on the outdoor unit

## OEM subcooling goal

- Initialize the goal to 10°F for each system when no saved value exists.
- The technician can edit the goal independently for each system during the visit.
- Persist the goal in the per-system Local Visit Draft and server `weigh_in_data` record.
- When reopening or switching systems, restore the saved goal; do not reset an existing value to 10°F.
- For legacy records with a missing/null goal, use 10°F as the compatibility default.
- Calculate `SC Deviation = measured Subcooling − OEM SC Goal` using the effective saved/default goal.

## Charge toggle

Small toggle in the section header, per-system. Auto-activates when any numeric field is filled; the technician can manually deactivate without clearing the underlying data. Scoped per-system — N systems can independently have their own charge active.

Weigh-In values and charge-toggle state are durable Local Visit Draft fields. They must survive system switching, navigation, refresh, FieldOps close/reopen, and temporary connectivity loss, then travel in the complete Generate Report submission snapshot. See `/docs/OFFLINE-FIRST-CONTRACT.md`; no local storage schema is prescribed here.

## Deferred (existing behavior kept as-is, not rebuilt in the latest style pass)

Tabbed system switcher, Factory/Revised toggle, GPS badge display on SCALE/FAN photos.
