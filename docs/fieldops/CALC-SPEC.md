# Quick Charge Calc

**Version:** 1.0
**Date:** 2026-07-30
**Status:** Closed design

## Purpose

A standalone refrigerant-charge calculator, available from the bottom utility strip — not fused into Weigh-In, since a technician may need it at any moment outside weigh-in context.

## Formula

`(actual lineset length − config baseline length) × oz/ft`

## Inputs

- **ft1** and **ft2** — the lineset length readings printed/engraved on the 24v cable running between the outdoor and indoor unit.
- Config baseline — driven by outdoor equipment brand/series, per `/docs/shared/CATALOG.md`'s lineset config rules.

## Relationship to Weigh-In

Distinct from Weigh-In's own **Approx Adjust oz** field, which is auto-calculated within that section from lineset ft + factory config dropdown. Calc is a separate, general-purpose tool — not a duplicate of that field.

## Presentation

Opens anchored to the bottom-right of the screen (one-handed reach) — not a centered modal. See `/docs/fieldops/NAVIGATION.md`.
