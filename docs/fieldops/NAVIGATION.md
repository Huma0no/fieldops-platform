# FieldOps — Navigation

**Version:** 3.0
**Date:** 2026-11-15
**Status:** Closed design — matches actual running code (Guided Phase 4)

## Purpose

The persistent navigation structure across FieldOps: a bottom bar of tools plus, inside Home, header tabs for the three work screens. Reference mockup: `docs/mockups/fieldops-nav-home-mockup.html` (Proposed).

## Bottom bar — 5 items

Icon-only, one tap each: **Home · Menu · Chat · Guided · Calc** (Calc at the most thumb-reachable end). No divider.

- **Home** — groups Lobby, My Calls and Reports (see Home). Tapping Home opens the last-used tab; the first time, My Calls. Home is highlighted on all three tabs.
- **Menu** — sheet with **Settings** and **Transfers**. Inherits the badge count from its contents (e.g. a pending transfer), so the badge shows on Menu itself.
- **Chat** — keeps its unread badge.
- **Guided** — opens the Guided module with the active call's context. See `/docs/fieldops/GUIDED-SPEC.md`.
- **Calc** — Quick Charge Calc, opened directly from the bar. See `/docs/fieldops/CALC-SPEC.md`.

**Labels.** A small handle above the bar shows or hides text labels under the icons. Labels are never required to use an icon. The state is remembered per device (`localStorage['fo:navLabels']`) and is collapsed by default.

**Tap targets** are at least 44 px at 360 px width.

## Home

The Home header shows text tabs **Lobby | My Calls | Reports** in place of the section title. The active tab is raised with the accent color (neumorphic tokens). Names are unchanged.

- **Lobby** — unassigned visits available to claim.
- **My Calls** — visits assigned to the technician. See `/docs/fieldops/MY-CALLS-SPEC.md`.
- **Reports** — completions, share/export, Request Corrections entry point. See `/docs/fieldops/REPORTS-SPEC.md`.

A horizontal swipe on the content switches to the neighbouring tab (a mostly vertical gesture is ignored, so scrolling and pull-to-refresh are unaffected). The header tabs act as indicator and shortcut. The last-used tab is remembered per device (`localStorage['fo:homeTab']`). Screen-specific header controls stay beside the tabs (My Calls notification bell, Lobby count, Reports "Retry pending").

## Workspace

**Workspace is not a bar item.** It is reached only through a job card's "Start Report" / "Open Workspace" action. The bottom bar is not mounted in Workspace. Instead, two floating buttons sit bottom-right: **Calc** (lowest) and **Guided** above it. Workspace's scrolling body has 60 px extra bottom padding so Next is never covered. Guided opened from Workspace shows "Back to Workspace" instead of the bar. See `/docs/fieldops/workspace/WORKSPACE-SHELL.md`.

Back from Workspace returns to My Calls; active work is restored from its durable Local Visit Draft rather than requiring the backend to be continuously reachable. See `/docs/OFFLINE-FIRST-CONTRACT.md`.

## Contextual additions

LV and Blower Data live inside each system's block in the active-job context within Workspace, not in the bottom bar — see `/docs/fieldops/workspace/WORKSPACE-SHELL.md`.

## Removed / superseded

- Version 2.0's six-item bar (Lobby · My Calls · Reports · Chat · Calc · Menu) is superseded by the five-item bar with Home tabs.
- The intermediate seven-icon proposal (Lobby · My Calls · Reports | Settings · Chat · Guided · Calc) was never built.
- The earlier "4 top text-tabs + separate bottom icon strip" design (with Workspace as a top tab) was never built.
- The "FieldOps" wordmark header band was removed (dead space).
- IA Tech Support (placeholder) and a general/job-less Settings-and-Tools menu were considered and deferred — not part of current navigation.
