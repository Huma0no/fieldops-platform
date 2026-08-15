# History & Properties

**Version:** 1.0
**Date:** 2026-07-30
**Status:** Closed design

## Purpose

Two related views in Dispatch: the permanent record of completed visits (History), and the per-address rollup (Properties).

## History

- Auto-loads the most recent 30 visits; "Load 30 more" pagination beyond that.
- Single feed across all technicians — not split by technician.
- Row actions: **Detail**, **Property** (jumps to that address's Properties view).
- No Total column in the list view.

**Detail view:** generated canonical Completion Report text, plus a collapsed Weigh-In section — no itemized accessory/fix chips. Structured visit data is the source of truth; the displayed report text is derived from it.

## Properties

Per-address record.

- Visible by default: address, builder, subdivision, unit count.
- Hidden by default: accessories, fixes, detail — expand to view.
- Summary bar: total visits at this address, last visit date, revenue, last technician.
- "+ New call" button — opens Call Intake pre-filled with this address.
- An Edit button is needed here but not yet reflected in the current mockup.
