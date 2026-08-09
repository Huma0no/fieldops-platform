# FieldOps — Design System

**Version:** 1.0
**Date:** 2026-07-30
**Status:** Live — applied across all FieldOps screens (My Calls, Workspace, NavBar)

## Purpose

Visual language for FieldOps only. Dispatch has its own, separate system: `/docs/dispatch/DESIGN-SYSTEM.md`. Deliberately different from it — FieldOps is mobile, technician-facing, full-viewport, and reads as a soft physical device, not a paper log.

## Concept

High-key neumorphic soft-UI. One unified surface — the page background and the card color are the same value — with light and shadow doing the work color normally would: raised elements read as pressed up out of the surface, inset elements read as pressed into it.

## Color

| Token | Value | Use |
|---|---|---|
| `--fo-panel` | `#e7e4df` | Page background = card/surface color (the "one unified surface") |
| `--fo-panel-hi` | `#f7f5f1` | Highlight side of the raised/inset shadow pair |
| `--fo-panel-lo` (shadow) | `#c3bfb8` | Shadow side of the raised/inset shadow pair |
| `--fo-well` | `#dcd9d3` | Recessed containers (active-job banner, wells) |
| `--fo-tile` | `#faf9f6` | Brighter near-white tiles for data cells |
| `--fo-ink` | `#1a1714` | Primary text |
| `--fo-ink-soft` | `#6b665f` | Secondary text, inactive labels |
| `--fo-accent` | `#b5641e` | Oxide-amber accent |
| `--fo-accent-deep` | `#8a4a13` | Active/pressed accent state |
| `--fo-blue` | `#2563eb` | AC active state text |
| `--fo-blue-glow` | `rgba(37, 99, 235, 0.18)` | AC active state inset glow ring |
| `--fo-no` | `#9e2b1e` | Heat active state text; also general danger/No |
| `--fo-red-glow` | `rgba(158, 43, 30, 0.18)` | Heat active state inset glow ring |
| `--fo-ok` | `#3d6b3f` | Positive/Yes state |

## Depth — the core mechanic

Every surface is either **raised** or **inset**, never flat:
- **Raised** (cards, buttons, tiles): light shadow up-left, dark shadow down-right — e.g. `-3px -3px 6px var(--fo-panel-hi), 3px 4px 7px var(--fo-panel-lo)`.
- **Inset** (wells, chips, trays, active/selected state): the same pair, inverted — e.g. `inset 3px 3px 6px var(--fo-panel-lo), inset -3px -3px 6px var(--fo-panel-hi)`.
- A selected tile/button switches from raised to inset — pressed-in reads as "on."
- Active-state color (blue for AC, red for Heat) is additive on top of the inset shadow, never a replacement for it.

## Typography

- **Archivo** — UI text (labels, buttons, headers).
- **Azeret Mono** — data and technical labels (measurements, step labels, monospace figures).

## Layout

- Full-viewport: `100dvw` / `100dvh` plus safe-area insets (`env(safe-area-inset-top/bottom)`) — no browser chrome assumptions.
- No rounded-corner exceptions the way Dispatch has no rounded corners — here it's the reverse: every raised/inset element uses generous border-radius (11-20px range) as part of the soft-device feel.
