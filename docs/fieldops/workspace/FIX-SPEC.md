# Fixes

**Version:** 2.0
**Date:** 2026-11-19
**Status:** Closed design — template layout built in W2 (authorized by `docs/plans/CC-PROMPT-workspace-pass.md` §2 and `docs/plans/CC-REPLY-W0-workspace.md`).

## Purpose

Third step of Workspace: fixes performed during the visit, feeding the running price total.

## Template layout

Same layout and rules as Accessories (`/docs/fieldops/workspace/ACC-SPEC.md`): the template replaces the full grid; 3 columns, wide group tiles span 2; ordered by price high → low; tiles selected on this call always show; **+ Add** last.

- **Template content:** pinned ("yours"), else the 4 most-used tiles from the technician's last 30 completed Reports ("suggested", topped up from the default), else the **default**: Pressure Test · Open eCoil · Leaks, then + Add.
- **+Add sheet:** search, the full catalog with price and usage, **Add** (this call only), **★** (pin), **+ Other** (description + $ + ✓). Fix Others are added to this report only, are not tech supplied, and several can be added per visit.

## Sub-options

Group tiles reveal their options when turned on; options are multi-select; each chosen option is its own line at its own catalog price:
- **Leaks:** eCoil · Cunit · Wall (catalog Leaks Ecoil · Leaks Cunit · Leaks Wall).
- **Ext. Wire:** Furnace · Cunit. At least one location is required: an open Ext. Wire tile with none chosen shows "choose location" and charges nothing. The location-less `Extended Wire` item is retired from selection (`selectable = false`) and kept for history.

## Quantities

Selected lines show **×N with − / +**; every line is charged unit price × quantity (see ACC-SPEC).

## Labels

Labels only; keys and report text unchanged: "Open Ecoil" shows as **Open eCoil**; the Leaks group tile reads **Leaks**.

Fix selection, description and price are durable Local Visit Draft state, delivered in the Generate Report snapshot. See `/docs/OFFLINE-FIRST-CONTRACT.md`.

## Report text

What each fix prints in the Completion Report: `/docs/shared/REPORT-TEXT.md`.

## Resolved

- WS-05 (Leaks options eCoil · Cunit · Wall), WS-06 (Ext. Wire with a required location), WS-11 (options hidden until the tile is on): resolved in W2 (2026-11-19).
