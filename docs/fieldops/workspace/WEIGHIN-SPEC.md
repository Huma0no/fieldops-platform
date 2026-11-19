# Weigh-In

**Version:** 2.0
**Date:** 2026-11-19
**Status:** Closed design — W3 Weigh-In + Calc pass (authorized by `docs/plans/CC-PROMPT-workspace-pass.md` §3 and `docs/plans/CC-REPLY-W0-workspace.md`).

## Purpose

Fourth step of Workspace, its own dedicated step (not folded into Accessories). Refrigerant charge measurement, per system.

## System switcher

The banner's **1 · 2 · 3 · +** switcher (shared with Service, `/docs/fieldops/workspace/SERVICE-TSTAT-SPEC.md`) picks the system shown; Weigh-In has no "All". A dot marks systems with the essentials filled (Lineset ft, Adjusted oz, Liquid temp, Condenser sat). **+** adds a system to the call. Defaults (manufacturer, factory length, factory charge, refrigerant) come from **that system's** outdoor unit.

## Lineset

One row: **Lineset ft** · **Manufacturer** · **Factory length**.
- **Manufacturer:** the catalog manufacturers (`/docs/shared/CATALOG.md`, Manufacturers) · **+ New**. "+ New" turns the field into a text input for the brand (▾ returns to the list) and asks **oz/ft** in a second compact row. Default: the outdoor unit's brand when it is a catalog manufacturer, otherwise none selected.
- **Factory length:** 10 · 15 · 25 · 30 ft (plus the manufacturer's default length if different) · **+ Custom** (asks the length in ft in the second row). Default and reset on a manufacturer change: the manufacturer's default length (Lennox 30 ft; Trane, Daikin, Goodman 15 ft).
- Any combination is allowed (no validation against "real" factory configs).
- **Refrigerant:** from the outdoor unit's catalog row (or the system's own refrigerant). When it is missing, a **Refrigerant** input asks for it in the second row.
- A derived line shows `oz/ft · baseline ft · refrigerant` and, once Lineset ft is entered, `lineset − baseline = extra ft · extra × oz/ft = Approx oz`.

## Charge

- **Factory charge** auto-fills from the catalog charge of the outdoor model for the selected manufacturer + length, and is editable. Its label reads **· catalog** when auto-filled and **· edited** once the technician types. Clearing an edited value returns it to the catalog value. With no catalog value (missing data, + New, + Custom) the field is empty for the technician to type.
- **Approx Adjust oz** = (Lineset ft − factory length) × oz/ft — calculated, signed.
- **Adjusted oz** — what the technician actually added; starts empty.
- **New Total Charge** = Factory + Adjusted, shown in **lb/oz and oz** (e.g. `9 lb 4 oz` · `148 oz`) — the value the technician writes on the outdoor unit.

## Readings

- **Liquid temp °F**, **Suction temp °F** (recorded only), **Condenser sat °F** (entered from the gauge; PT table deferred to the simulation layer), **Fan CFM**.
- **Subcooling °F** = Condenser Sat − Liquid Temp (computed, read-only).
- **OEM SC Goal °F** — numeric field, see below.
- **SC Deviation °F** = Subcooling − OEM SC Goal (computed, read-only).
- **Scale photo** — carries GPS (EXIF, else the phone's location), see `/docs/shared/PHOTOS-GPS-INTEGRATIONS.md`; without one it is a warning, never a block.
- **Fan Speed photo** — same as Scale.

## Missing catalog data

Any value the catalog does not have (a charge for that manufacturer + length, a refrigerant, an oz/ft) shows empty and the technician types it. Nothing blocks.

## Never rejected (Kristo, 2026-11-18)

The phone's Weigh-In is the source of truth: the server stores it as sent; a different earlier reading at the same address is kept in the Report and shown to Dispatch as "Weigh-In changed" (previous → reported). Differences never reject the Report (`/docs/architecture/REPORT-SNAPSHOT-CONTRACT.md`).

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

## Stored per system

Lineset ft, manufacturer, factory length ft, oz/ft, refrigerant, factory charge oz with its source (catalog / edited), Approx Adjust oz, Adjusted oz, Fan CFM, Liquid, Suction and Condenser sat temps, Subcooling, OEM SC Goal, SC Deviation (`/docs/shared/DATA_MODEL.md`, `weigh_in_data`). The legacy lineset config key is no longer written; earlier rows keep it.

## Removed (W3, 2026-11-19)

- The "Line Config" dropdown, the Trane install-date preselection and the Factory / Revised charge selector (replaced by Manufacturer + Factory length).
- The deferred tabbed system switcher (replaced by the banner's 1 · 2 · 3 · +).

## Resolved

- WS-08 (Subcooling not calculated) and WS-09 (Lineset dropdown too long): resolved in W3.
