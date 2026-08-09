# Quick Charge Calc

**Version:** 1.1
**Date:** 2026-07-30
**Status:** Closed design — built

## Purpose

A standalone refrigerant-charge calculator, available from the bottom bar's **Calc** item (see `/docs/fieldops/NAVIGATION.md`) — not fused into Weigh-In, since a technician may need it at any moment, from anywhere in the app, outside any specific visit's context.

## Formula

`(|ft2 − ft1| − config baseline length) × oz/ft`

## Inputs

- **ft1** and **ft2** — the two lineset length readings printed/engraved on the 24v cable running between the outdoor and indoor unit. Entered in either order — the difference is always taken as a positive value.
- **Config baseline** — a dropdown selection from the lineset config catalog (per `/docs/shared/CATALOG.md`). Manual selection only, no auto-preselect — Calc has no visit/equipment context to auto-detect a brand from, unlike Weigh-In's own config dropdown.

## Relationship to Weigh-In

Distinct from Weigh-In's own **Approx Adjust oz** field, which is auto-calculated within that section from lineset ft + factory config dropdown, with the config auto-preselected from the visit's actual equipment. Calc is the general-purpose, context-free version of the same math — not a duplicate, just usable outside a visit.

## Presentation

Small overlay anchored to the bottom-right of the screen (one-handed reach), dismissed by tapping the backdrop — not a full-width sheet, not a centered modal.
