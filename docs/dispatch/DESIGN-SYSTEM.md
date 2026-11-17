# Dispatch — Design System

**Version:** 2.0
**Date:** 2026-11-17
**Status:** Live — D1 (tokens, components, fonts, shell, navigation, toasts, Auth). Source mockup: `docs/mockups/fieldops-dispatch-mockups.html` (00 Shell). Other screens adopt the components in D2–D6.

## Purpose

Visual language for Dispatch only. FieldOps has its own, separate system: `/docs/fieldops/DESIGN-SYSTEM.md`. The two are deliberately different — Dispatch is desktop, dispatcher-only, and reads as an industrial paper-trail tool; FieldOps is mobile, technician-facing, and reads as a soft physical device.

## Concept

Vintage industrial radio-dispatch. Monochrome, hard edges, typewriter data — the visual grammar of a paper log, not a modern app.

## Color

Tokens `--vd-*` in `frontend/shared/tokens.css`. Dispatch's `<html data-app="dispatch">` also maps the shared legacy tokens (`--surface-*`, `--text-*`, `--border-*`, `--color-*`, radius 0) onto this palette, so screens not yet restyled read in the same tone.

| Token | Value | Use |
|---|---|---|
| `--vd-paper` | `#C6C4BC` | Outer frame only (no small text on it) |
| `--vd-panel` | `#E3E1D9` | Rack, screens, inputs |
| `--vd-plate` | `#F2F1EB` | Units, cards, function-key row |
| `--vd-ink` | `#101010` | Text and all structural borders (14.5:1 on panel) |
| `--vd-dim` | `#57554F` | Secondary text, labels (5.7:1 on panel). The mockup's `#6E6E68` fails AA. |
| `--vd-line` | `#A9A79F` | Hairlines only, never text |
| `--vd-heat` | `#8B1A1A` | Error text only — the one color besides the recommended-field amber (7.1:1 on panel) |
| Recommended-field accent | `#854F0B` label / `#BA7517` border | Recommended-field emphasis (Intake) |

## Typography

Bundled OFL fonts (woff2, latin, `frontend/dispatch/src/styles/fonts/`, no CDN):
- **Masthead/brand:** Gelasio (Georgia metrics), `--vd-font-brand`. Wordmark and page titles only.
- **Data, numbers, dates:** Courier Prime, `--vd-font-data`.
- **Stencil labels, nav keys, table heads:** Archivo Narrow uppercase with letter-spacing, `--vd-font-stencil`.
- **Body:** system sans, `--vd-font-body`.

## Structure

- **No rounded corners anywhere.** Every border is a hard edge.
- Borders carry the hierarchy: 3px ink for the rack and masthead divider, 2px ink for units, fields and keys, 1px `--vd-line` for row dividers.
- Components (`frontend/dispatch/src/styles/dispatch.css`): `vd-rack` with corner `vd-screw`s and `vd-knurl`; `vd-unit` (head/name/body); `vd-key` (variants `dark`, `sm`, `wide`, `off`) with a hard drop shadow that sinks on press; `vd-led`; `vd-fnrow`/`vd-fkey` function keys (active = inverted, LED filled); `vd-label`/`vd-input`; `vd-table`; `vd-alert` (hatched plate, also the toast); `vd-stencil`, `vd-data`, `vd-plaque`.
- Secondary/discard action: `vd-key off` — dim text and a dotted border (the mockup's grey key fails contrast).
- **Focus:** every focusable element shows a 2px ink outline, 2px offset (`:focus-visible`).
- Shell: rack around the viewport; masthead (brand, operator, date plaque); function-key row with Sign out; the screen sits in a bordered well and keeps its own layout and scrolling. Navigation is the real app's (QA-TRACKER FF-04 keeps the mockup's navigation as a future decision).

## Icons

Tabler Icons (line style), sized to match surrounding text — never decorative or oversized.
