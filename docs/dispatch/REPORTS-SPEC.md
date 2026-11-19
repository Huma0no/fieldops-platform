# Reports (Dispatch)

**Version:** 1.1
**Date:** 2026-11-19
**Status:** Describes the running screen (`frontend/dispatch/src/screens/Reports.jsx`, endpoints in `src/routes/reports.js`). The technician's Reports screen is a different surface: `/docs/fieldops/REPORTS-SPEC.md`.

## Purpose

Usage reports for The Company: which equipment, accessories and refrigerant were used, where, and by whom, over a date range. Owner and dispatcher only.

## Filters

- **From / To** (required): completion date range, inclusive.
- **Technician**: one technician or all.
- **Generate** loads both reports. Visits count when their status is `completed` or `temporarily`.

## Equipment & Accessory usage (05A)

- Grouped by address. Each group lists items with category and quantity.
- **Include / exclude:** a checkbox per address and per item. Unchecking an address excludes all its items. Excluded rows are struck through on screen and left out of the printout.
- **Totals register:** totals of the included items only, also shown as a table with the total quantity and a per-technician breakdown.

## Refrigerant usage (05B)

- Grouped by address, one row per system: System, Service, Adj. Oz, Factory Charge, **Manufacturer + factory length** (e.g. "Lennox 30 ft", from the reading's `manufacturer` and `factory_length_ft`, W3; readings recorded before W3 show their legacy lineset config), Date, Tech (technician name).
  - _Implementation note (2026-11-19, A16):_ the running screen still shows the legacy "Lineset Config" column, which is empty for W3 readings; the screen change is pending authorization (Reports is a CLOSED section).
- Values are the latest Weigh-In stored for each address and system.
- Include / exclude per address, as above.

## Print / Export

**Print / Export** prints the page through the browser, so it can be saved as a PDF. The printout adds a letterhead (report title, date range, technician) and hides the controls and the excluded rows. Exclusions are not saved; they reset on each Generate.

## Not included

The mockup's printable document layout (summary page first, document number, "generated", operator, page footers) is a future item: FF-08 in `docs/status/QA-TRACKER.md`.
