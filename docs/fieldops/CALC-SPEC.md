# Quick Charge Calc

**Version:** 2.0
**Date:** 2026-11-19
**Status:** Closed design — W3 Weigh-In + Calc pass (authorized by `docs/plans/CC-PROMPT-workspace-pass.md` §5 and `docs/plans/CC-REPLY-W0-workspace.md`).

## Purpose

A standalone refrigerant-charge calculator, available from the bottom bar's **Calc** item (see `/docs/fieldops/NAVIGATION.md`) — not fused into Weigh-In, since a technician may need it at any moment, from anywhere in the app, outside any specific visit's context.

## Inputs (one screen, no mode switch)

- **FT1 / FT2** — the two lineset length marks printed on the 24 V cable between the outdoor and indoor unit, in either order (the difference is always positive).
- **Total lineset ft** — below a subtle "or" divider.
- **Mutually exclusive:** typing Total clears FT1/FT2; typing FT1/FT2 clears Total. With both marks entered, Total shows the computed length as a grey placeholder ("= 55 ft").
- **Manufacturer + Factory length** — the same controls, options and defaults as Weigh-In (`/docs/fieldops/workspace/WEIGHIN-SPEC.md`, Lineset): + New asks oz/ft and refrigerant, + Custom asks the length. With no visit context, the initial manufacturer is the first catalog manufacturer.

## Formula

`(lineset ft − factory length) × oz/ft`. oz/ft and default length per manufacturer: `/docs/shared/CATALOG.md` (Manufacturers).

## Breakdown

No manufacturer name: `|FT1 − FT2| = 55 ft` (when using marks) · `55 ft − 30 ft = 25 ft extra` · `25 ft × 0.6 oz/ft = 15 oz` · result **+15 oz** with a refrigerant badge when the refrigerant is known (typed with + New). Shorter than the factory length: the negative values show with the warning "Lineset shorter than factory baseline — no refrigerant to add."

## Relationship to Weigh-In

Weigh-In's **Approx Adjust oz** uses the same math with the visit's equipment preselected. Calc is the context-free version, usable outside a visit; it stores nothing.

## Presentation

Small overlay anchored to the bottom-right of the screen (one-handed reach), dismissed by tapping the backdrop — not a full-width sheet, not a centered modal. Sized to fit its single screen.
