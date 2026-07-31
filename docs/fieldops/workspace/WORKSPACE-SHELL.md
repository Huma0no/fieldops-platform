# Workspace — Shell

**Version:** 1.0
**Date:** 2026-07-30
**Status:** Closed design — built, neomorphic style applied

## Purpose

The frame that holds every Workspace sub-section: the rail, the active-job banner, and the flow between steps. Sub-section content lives in its own doc — see the list at the end.

## Structure, top to bottom

1. **Top section-tabs** (Lobby · My Calls · Workspace · Reports) — Workspace active. See `/docs/fieldops/NAVIGATION.md`.
2. **Active Job banner** — compact: address, subdivision, builder, system count. Carries the running price total (top-right) and the job-level Cancel control.
3. **Step rail** — 5 steps, horizontally scrollable, jumpable directly or via inline Back/Next: **Service+Tstat · Acc · Fix · Weigh-In · Notes**. Current step raised/accent-colored; completed steps marked; pending steps muted. Styled distinct from the top text-tabs.
4. **Scrollable section content** — the active step's content, see per-section docs.
5. **Inline Back/Next** — Next becomes **Generate Report** only on the last step (Notes), never earlier.

Bottom utility strip (Calc/Chat/Transfers/Settings) stays present and unchanged throughout.

## Cancel

A small guarded ✕ button lives in the Active Job banner (job-level — cancels the whole call, requires confirmation). It is not part of the Service step's tile set.

## Contextual tools (LV / Blower)

Not in the bottom strip. They live per-system, inside each system's block in the job briefing/context — scoped to that system's registered equipment only. No general/job-less mode.

## Sub-section specs

- `/docs/fieldops/workspace/SERVICE-TSTAT-SPEC.md`
- `/docs/fieldops/workspace/SERVICE-MULTISYSTEM-SPEC.md`
- `/docs/fieldops/workspace/ACC-SPEC.md`
- `/docs/fieldops/workspace/FIX-SPEC.md`
- `/docs/fieldops/workspace/WEIGHIN-SPEC.md`
- `/docs/fieldops/workspace/CHECKLIST-NOTES-SPEC.md`
