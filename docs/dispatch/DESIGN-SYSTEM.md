# Dispatch — Design System

**Version:** 1.0
**Date:** 2026-07-30
**Status:** Live — matches built mockups (Home, Call Intake + Lobby)

## Purpose

Visual language for Dispatch only. FieldOps has its own, separate system: `/docs/fieldops/DESIGN-SYSTEM.md`. The two are deliberately different — Dispatch is desktop, dispatcher-only, and reads as an industrial paper-trail tool; FieldOps is mobile, technician-facing, and reads as a soft physical device.

## Concept

Vintage industrial radio-dispatch. Monochrome, hard edges, typewriter data — the visual grammar of a paper log, not a modern app.

## Color

| Token | Value | Use |
|---|---|---|
| Page background | `#D8D8D2` | Outermost background |
| Panel background | `#EAEAE6` | Main panel, inputs |
| Box/card background | `#F4F4F1` | Nested boxes within a panel |
| Recommended-field background | `#FAEEDA` | Fields flagged as recommended-but-optional |
| Ink (primary text/borders) | `#141414` | Text, all structural borders |
| Muted text | `#5A5A5A` | Secondary text, meta info, labels |
| Recommended-field accent | `#854F0B` label / `#BA7517` border | Recommended-field emphasis |

No accent color beyond the recommended-field amber — everything else is ink-on-panel.

## Typography

- **Masthead/brand:** Georgia or Times New Roman serif, ~22px, weight 500, letter-spacing 0.5px. Reserved for the app wordmark only — never used for data or body text.
- **Data/timestamps/mono values:** Courier New, monospace.
- **Everything else (labels, nav, body):** system sans-serif (-apple-system, Helvetica, Arial).
- Section labels and box titles: ~11-12px, bold, letter-spacing 1px, uppercase.

## Structure

- **No rounded corners anywhere.** Every border is a hard edge.
- **Borders carry the hierarchy**, not shadows or color: 3px solid ink for the outer panel and masthead divider, 2px solid ink for boxes and box-title dividers, 1px solid ink for inputs and smaller dividers.
- Active nav item: solid ink background, panel-color text (inverted, not highlighted).
- Buttons: `btn-solid` = 2px ink border, no fill; `btn-ghost` = 1px muted-gray border, muted text — used for secondary/discard actions.
- Tags/pills: 10px text, 1px ink border, no fill, uppercase letter-spacing.

## Icons

Tabler Icons (line style), sized to match surrounding text — never decorative or oversized.
