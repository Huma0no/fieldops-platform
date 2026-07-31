# FieldOps — Navigation

**Version:** 1.0
**Date:** 2026-07-30
**Status:** Closed design — applied

## Purpose

The persistent navigation structure across all of FieldOps: top section tabs and the bottom utility strip.

## Top nav — section tabs

Four text tabs, always visible: **Lobby · My Calls · Workspace · Reports**.

My Calls and Workspace are separate screens, not a morphing slot — "Start Report" from My Calls navigates to Workspace; Back from Workspace returns to My Calls.

## Bottom strip — utility icons

Full-width, thumb-reachable, icon-only (distinct from the top's text tabs). Right-to-left by reach priority: **Calc · Chat · Transfers · Settings** — Calc at the most reachable position, Settings at the least.

- Always present: Calc, Chat, Transfers, Settings.
- Contextual additions (only inside Workspace, per-system): LV and Blower Data live inside each system's block in the active-job context, not in this global strip — see `/docs/fieldops/workspace/WORKSPACE-SHELL.md`.
- Calc opens anchored to the bottom-right of the screen, not as a centered modal — operable one-handed.
- Chat and Transfers show a badge count when there's something pending.

## Removed / superseded

- The "FieldOps" wordmark header band was removed (dead space) — the top band is the section-nav row only.
- IA Tech Support (placeholder) and a general/job-less Settings-and-Tools menu were considered and deferred — not part of current navigation.
