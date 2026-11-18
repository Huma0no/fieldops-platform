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
13. Scale photo — carries GPS (EXIF, else the phone's location), see `/docs/shared/PHOTOS-GPS-INTEGRATIONS.md`; without one it is a warning, never a block
14. Fan Speed photo — same as Scale
15. New Total Charge — computed, read-only output for the technician to write on the outdoor unit

## Never blocks the Report (Kristo, 2026-11-17)

Missing or inconsistent Weigh-In data, including SCALE/FAN photos without a location, never blocks Generate Report, submission or server acceptance; the technician is responsible for the Report.
- Weigh-In is expected for a system when the call bills Weight-In-Data or the system has any Weigh-In entry (Lineset ft, Adjusted oz, Liquid temp, Condenser sat, Fan CFM, Suction temp, or a SCALE/FAN photo). Drive Run and Cancel expect none.
- For an expected system the warnings list the missing essentials (Lineset ft, Adjusted oz, Liquid temp, Condenser sat), a missing SCALE or FAN photo, and a SCALE/FAN photo without location.
- Leaving the Weigh-In step with warnings shows "Missing: … The report will be sent incomplete." [Back] [Continue anyway].
- The DRAFT receipt shows a WEIGH-IN INCOMPLETE block at the top; the Report carries the list (`weighInWarnings`); Dispatch's report view shows an INCOMPLETE tag with it.

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

## Pending changes (QA 2026-11-15, not implemented)

Recorded in `docs/status/QA-TRACKER.md` (WS-08, WS-09). Scheduled for the Workspace pass after Guided Phase 4; until then this spec's current text remains the closed behavior.

- WS-08 (bug against this spec): Subcooling is not calculated; it must be Condenser Sat − Liquid Temp.
- WS-09: the Lineset dropdown is too long to use; propose numeric entry (keypad or stepper).
