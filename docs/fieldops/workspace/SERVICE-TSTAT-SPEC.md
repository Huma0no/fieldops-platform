# Service + Thermostat

**Version:** 1.0
**Date:** 2026-07-30
**Status:** Closed design — built, neomorphic style applied

## Purpose

First step of Workspace: the base service and thermostat for the visit. Merged into one step (the rail shows 5 steps total, not 6).

## Service

Big tiles: **AC · Heat · Prestart · Finish · Drive Run · Cancel**. Base services per `/docs/shared/CATALOG.md`; Finish is a modifier tile, not a separate base service.

**Active-state color:**
- AC active: `--fo-blue` text + blue inset glow ring.
- Heat active: `--fo-no` (red) text + red inset glow ring.
- Both keep the neomorphic inset shadow as the base — color is additive, never a replacement.

Drive Run is a distinct action button placed after the Service tiles (not folded into the tile grid). Cancel is not part of this tile set — it's the job-level ✕ in the Active Job banner (see `/docs/fieldops/workspace/WORKSPACE-SHELL.md`).

**Multi-system visits:** see `/docs/fieldops/workspace/SERVICE-MULTISYSTEM-SPEC.md` for per-system override behavior.

## Report text

What each service prints in the Completion Report, and the full Finish priority-hierarchy rules: `/docs/shared/REPORT-TEXT.md`.

## Thermostat

Compact single-line control: a narrow (~60% width), vertically-scrollable picker, about 1.5 line-heights tall (peek-scroll, larger font), with **"+ Add new"** as a row inside the scroll itself. No checkbox, no chips, no separate Add button — selecting a row is the add. A quantity stepper sits beside the scroll (~40% width), matched in height, completing one horizontal line.

A job always has exactly one thermostat model (× quantity) — single-select + quantity is correct; no multi-model display is needed.
