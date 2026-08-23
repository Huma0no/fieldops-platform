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

History does not expose general report/source editing. Administrative correction remains a separate Dispatch concern; it does not reopen technician Workspace or make a terminal visit technician-editable.

## Properties

Per-address record.

- Visible by default: address, builder, subdivision, unit count.
- Hidden by default: accessories, fixes, detail — expand to view.
- Summary bar: total visits at this address, last visit date, revenue, last technician.
- "+ New call" button — opens Call Intake pre-filled with this address.
- An Edit button is needed here but not yet reflected in the current mockup.
