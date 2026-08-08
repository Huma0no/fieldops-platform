# FieldOps — Navigation

**Version:** 2.0
**Date:** 2026-07-30
**Status:** Closed design — matches actual running code

## Purpose

The persistent navigation structure across all of FieldOps: a single bottom bar. There is no separate top-tab row and bottom-icon-strip split — that was an earlier design that was never built; this document now reflects what's actually implemented.

## Bottom bar — 6 items

One full-width, thumb-reachable, icon-only bar: **Lobby · My Calls · Reports · Chat · Calc · Menu**.

- **Lobby** — unassigned visits available to claim.
- **My Calls** — visits assigned to the technician. See `/docs/fieldops/MY-CALLS-SPEC.md`.
- **Reports** — day's completions, share/export, Request Corrections entry point. See `/docs/fieldops/REPORTS-SPEC.md`.
- **Chat.**
- **Calc** — Quick Charge Calc, opened directly from the bar (not buried in a menu). See `/docs/fieldops/CALC-SPEC.md`.
- **Menu** — contains **Settings** and **Transfers**. Inherits the badge count from whichever of its contents has something pending (e.g. a pending transfer) — the technician sees a badge on Menu itself, not just once they've opened it.

**Workspace is not a bar item.** It's reached only via a job card's "Start Report" / "Open Workspace" action from My Calls — not a persistent destination. Back from Workspace returns to My Calls.

## Contextual additions

LV and Blower Data live inside each system's block in the active-job context within Workspace, not in the bottom bar — see `/docs/fieldops/workspace/WORKSPACE-SHELL.md`.

## Removed / superseded

- The earlier "4 top text-tabs + separate bottom icon strip" design (with Workspace as a top tab) was never built and is superseded by the single 6-item bar above.
- The "FieldOps" wordmark header band was removed (dead space).
- IA Tech Support (placeholder) and a general/job-less Settings-and-Tools menu were considered and deferred — not part of current navigation.
