# Accessories

**Version:** 2.0
**Date:** 2026-11-19
**Status:** Closed design — template layout built in W2 (authorized by `docs/plans/CC-PROMPT-workspace-pass.md` §2 and `docs/plans/CC-REPLY-W0-workspace.md`).

## Purpose

Second step of Workspace: accessory selection, feeding the visit's running price total.

## Template layout

The template replaces the full grid (the full grid is dropped).

- **Template content**, in this order of precedence:
  1. **Yours** — tiles the technician pinned with ★ in the +Add sheet. **reset** returns to suggested.
  2. **Suggested** — the technician's 6 most-used tiles in their last 30 completed Reports (`GET /api/workspace/acc-fix`). Zone-board companions never count; they appear with their board. With fewer than 6 used tiles, the default template tops it up.
  3. **Default** (no history) — catalog `template_rank`: UT3000 · HZ322 · FIN180P · Float Switch · Weigh-in, then + Add.
- **Always visible regardless of template:** tiles pre-specified at Intake, tiles added from the sheet on this call, and anything selected on this call.
- **Order:** by price, high → low, regardless of selection order. A selected zone board's companions sit right after it (dashed outline).
- **Grid:** 3 columns; wide tiles (UT3000, Harmony, every group tile) span 2; dense packing. The last tile is **+ Add**.
- A bar above the grid names the source: `Template: yours` (with **reset**), `suggested · from your last 30 reports`, or `default`.
- Usage and pins are cached on the phone; a pin made offline is sent when the API answers again.

## +Add sheet

Search, then the full catalog (companions ride with their board) with price and usage count ("used N×"):
- **Add** — shows the tile on this call only (and selects it; a group tile opens).
- **★** — keeps the tile in the template permanently ("suggested" → "yours").
- **+ Other** — description + $ + ✓. Every ✓ adds a new line: several Others per visit, each with its own description and price. Accessory Others are **TECH SUPPLIED** and never enter the catalog.

## Sub-options

**LP Kit** is a group tile: its options **Lennox 1Stg · Lennox 2Stg · Goodman** stay hidden until the tile is on. Options are multi-select; each chosen option is its own line at its own catalog price. Turning the tile off clears its options. (Catalog: `group_label` / `option_label`.)

## Quantities

Selected lines show **×N with − / +** (no upper limit; 1 is the lowest, tap the tile to remove). A new line starts at the call's system count when the catalog item multiplies by systems, otherwise at 1. Every line is charged **unit price × quantity**.

## Companion / auto-activation rules (unchanged)

- **UT3000 group** — selecting UT3000 auto-activates DAPC + EEV Wire + eBypass. All 4 remain individually toggleable.
- **HZ322 group** — selecting HZ322 auto-activates Bypass only.
- **Harmony** — standalone, in the same mutual-exclusion group as the two zone boards.
- **Mutual exclusivity:** HZ322, UT3000 and Harmony — selecting one deselects the others and their companions.
- Companions are hidden until their board is on (or the technician selected one on its own).

## Labels

Labels only; catalog keys and history are unchanged (`catalog_items.label`): "Ecoil Wire" shows as **EEV Wire** (report text "EEV Wire"), "Weight-In-Data" as **Weigh-in**.

## Running total

Feeds the price shown in the Active Job banner. Accessory selection, quantity, description and price belong to the durable Local Visit Draft and are delivered in the Generate Report snapshot. See `/docs/OFFLINE-FIRST-CONTRACT.md`.

## Report text

What each accessory prints in the Completion Report: `/docs/shared/REPORT-TEXT.md`.

## Resolved

- "Weigh-In Data" (accessory tile) and the per-system charge toggle (`/docs/fieldops/workspace/WEIGHIN-SPEC.md`) are two different things (2026-07-30): the accessory is a billable line ($10, +$10 with Finish per system); the Weigh-In panel records charge data.
- WS-04 (EEV Wire label), WS-07 (LP Kit options), WS-11 (LP Kit options hidden until selected): resolved in W2 (2026-11-19).
