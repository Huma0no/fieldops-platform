# Fixes

**Version:** 1.2
**Date:** 2026-07-30
**Status:** Closed design — built, neomorphic style applied

## Purpose

Third step of Workspace: fixes performed during the visit, feeding the running price total.

## Layout

Multi-select tile grid, tile labels matching catalog `item_name` exactly (tiles render dynamically from the catalog, not hardcoded): **Pressure Test · Open Ecoil · Wires Jammed · Stuck Blower · Cut Sheetrock · Other Fix**, plus flat catalog items for the two fix families that were originally designed as expanding wide tiles but are built as plain direct-add tiles instead — there is no sub-options modal for either:
- **Leaks:** Leaks Ecoil · Leaks Cunit · Leaks Wall (three separate tiles)
- **Extended Wire:** Extended Wire (unspecified location) · Extended Wire(Cunit) · Extended Wire(Furnace) (three separate tiles)

## Custom entry

`Other Fix` is a normal custom-price Fix requiring a short technician-entered description and a price, entered as its own line item. Its description is persisted for Completion Report text. It remains `tech_supplied = false` and does not participate in restock.

Fix selection, description, and resolved price are durable Local Visit Draft state before Generate Report. They must remain available offline and are delivered in the complete submission snapshot rather than requiring an immediate backend write. See `/docs/OFFLINE-FIRST-CONTRACT.md`.

## Report text

What each fix prints in the Completion Report: `/docs/shared/REPORT-TEXT.md`.

## Pending changes (QA 2026-11-15, not implemented)

Recorded in `docs/status/QA-TRACKER.md` (WS-05, WS-06, WS-11). Scheduled for the Workspace pass after Guided Phase 4; until then this spec's current text remains the closed behavior.

- WS-05: Fixed Leaks sub-options: Cunit · Coil · Wall. The label "Coil" replaces "Ecoil".
- WS-06: Extended Wire sub-options stay Furnace · Cunit. Open: whether the plain `Extended Wire` item stays selectable.
- WS-11: Fixed Leaks and Extended Wire become parent tiles whose sub-options stay hidden until the parent is selected.
