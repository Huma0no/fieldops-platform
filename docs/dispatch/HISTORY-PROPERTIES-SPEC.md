# History & Properties

**Version:** 1.0
**Date:** 2026-07-30
**Status:** Closed design

## Purpose

Two related views in Dispatch: the permanent record of completed visits (History), and the per-address rollup (Properties).

## History

- Auto-loads the most recent 30 visits; "Load 30 more" pagination beyond that.
- Single feed across all technicians — not split by technician.
- Row actions: **Details** opens the read-only terminal record; **Correct** opens that exact visit directly in Corrections. Details also offers **Correct Report**. Both correction entry points use the one audited Corrections editor; History never edits source data inline.
- No Total column in the list view.

**Detail view:** opens read-only by default and shows the useful final service record when data exists: Order #, address, Builder, Subdivision, scheduled/completed context, technician, terminal status, system number with indoor/outdoor equipment and derived refrigerant, services/items, Weigh-In context, Checklist answers (Yes / No / unanswered), Notes, permitted evidence summary, total, property history, and human-readable edit log. Cancelled History keeps Notes and Checklist while normal work and work-specific evidence remain suppressed. Structured visit data is the source of truth; canonical report text remains derived from it.

**Visual update (D3, 2026-11-18):** History list and detail use the Dispatch design system v2 (`docs/dispatch/DESIGN-SYSTEM.md`): a History unit with the filter bar, a "loaded" readout and the record table; the detail as a Visit record unit (details, systems, flags, checklist, price check, services, items, Weigh-In folds, photos) and a Property · Edit log unit. The mockup's inline row expansion, global search and separate Properties screen are not adopted (behavior; see QA-TRACKER FF-04). Services show their system number when per-system.

**Changed by tech (W1b, 2026-11-17 — the one Dispatch entry Kristo authorized):** when the technician added a system or corrected a system's equipment, the detail header shows a hatched CHANGED BY TECH tag, the system carries ADDED BY TECH, and a "Changed by tech" table lists each change: system, what (System added / Equipment modified), before → after (the original order data is the "before"), who and when.

**Incomplete Weigh-In (2026-11-17):** when the technician sent the Report with missing Weigh-In data, the header shows a solid INCOMPLETE tag and an "Incomplete Weigh-In" section lists what was missing per system.

History does not expose general report/source editing. Administrative correction remains a separate Dispatch concern; it does not reopen technician Workspace or make a terminal visit technician-editable.

## Properties

Per-address record.

- Visible by default: address, builder, subdivision, unit count.
- Hidden by default: accessories, fixes, detail — expand to view.
- Summary bar: total visits at this address, last visit date, revenue, last technician.
- "+ New call" button — opens Call Intake pre-filled with this address.
- An Edit button is needed here but not yet reflected in the current mockup.

## Pending changes (2026-11-15, not implemented)

Recorded in `docs/status/QA-TRACKER.md` (HI-01 to HI-04) for a later History pass. Until then this spec's current text remains the closed behavior.
