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

**Detail view:** opens read-only by default and shows the finalized structured visit context, including Notes, Checklist answers (Yes / No / unanswered), services/items where applicable, permitted evidence, Weigh-In context, property history, and edit log. Cancelled History keeps Notes and Checklist while normal work and work-specific evidence remain suppressed. Structured visit data is the source of truth; canonical report text remains derived from it.

History does not expose general report/source editing. Administrative correction remains a separate Dispatch concern; it does not reopen technician Workspace or make a terminal visit technician-editable.

## Properties

Per-address record.

- Visible by default: address, builder, subdivision, unit count.
- Hidden by default: accessories, fixes, detail — expand to view.
- Summary bar: total visits at this address, last visit date, revenue, last technician.
- "+ New call" button — opens Call Intake pre-filled with this address.
- An Edit button is needed here but not yet reflected in the current mockup.
