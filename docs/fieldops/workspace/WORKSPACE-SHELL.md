# Workspace — Shell

**Version:** 1.0
**Date:** 2026-07-30
**Status:** Closed design. Rail + step content built with neomorphic style. The Active Job banner described in §2 below is NOT built — current header is a back button + address only, no subdivision/builder/system-count/price/Cancel control.

## Purpose

The frame that holds every Workspace sub-section: the rail, the active-job banner, and the flow between steps. Sub-section content lives in its own doc — see the list at the end.

## Structure, top to bottom

1. **Header** — back button + address. Workspace is reached from a job card's "Start Report" action, not from a persistent nav item — see `/docs/fieldops/NAVIGATION.md`.
2. **Active Job banner** — compact: address, subdivision, builder, system count. Carries the running price total (top-right) and the job-level Cancel control.
3. **Step rail** — 5 steps, horizontally scrollable, jumpable directly or via inline Back/Next: **Service+Tstat · Acc · Fix · Weigh-In · Notes**. Current step raised/accent-colored; completed steps marked; pending steps muted. Styled distinct from the top text-tabs.
4. **Scrollable section content** — the active step's content, see per-section docs.
5. **Inline Back/Next** — Next becomes **Generate Report** only on the last step (Notes), never earlier.

The bottom bar (see `/docs/fieldops/NAVIGATION.md`) stays present and unchanged throughout Workspace.

## Offline-first Workspace state

Service, thermostat, accessories, fixes, Weigh-In, Checklist, Notes, and evidence are fields of the active **Local Visit Draft**. Technician edits must durably update that draft and remain available through step navigation, refresh, FieldOps close/reopen, and temporary loss of connectivity; Workspace correctness must not depend on an immediate backend write. Generate Report is the normal submission boundary. Full contract: `/docs/OFFLINE-FIRST-CONTRACT.md`.

**IMPLEMENTATION GAP:** existing Workspace/API mutation behavior is not evidence that the durable local-draft and submission-outbox contract has been implemented. A future implementation may communicate with the backend during active work, but that communication cannot be required for correctness.

## Cancel

A small ✕ button lives in the Active Job banner (job-level). Tapping it opens the Notes step directly — no confirmation dialog. It is not part of the Service step's tile set. Full mechanism: `/docs/fieldops/CANCEL-SPEC.md`.

## Contextual tools (LV / Blower)

Not in the bottom strip. They live per-system, inside each system's block in the job briefing/context — scoped to that system's registered equipment only. No general/job-less mode.

## Sub-section specs

- `/docs/fieldops/workspace/SERVICE-TSTAT-SPEC.md`
- `/docs/fieldops/workspace/SERVICE-MULTISYSTEM-SPEC.md`
- `/docs/fieldops/workspace/ACC-SPEC.md`
- `/docs/fieldops/workspace/FIX-SPEC.md`
- `/docs/fieldops/workspace/WEIGHIN-SPEC.md`
- `/docs/fieldops/workspace/CHECKLIST-NOTES-SPEC.md`
