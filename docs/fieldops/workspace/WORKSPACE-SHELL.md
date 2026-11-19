# Workspace — Shell

**Version:** 1.1
**Date:** 2026-11-15
**Status:** Closed design. Rail, step content, and Active Job banner are built with neomorphic style.

## Purpose

The frame that holds every Workspace sub-section: the rail, the active-job banner, and the flow between steps. Sub-section content lives in its own doc — see the list at the end.

## Structure, top to bottom

1. **Header** — back button + address. Workspace is reached from a job card's "Start Report" action, not from a persistent nav item — see `/docs/fieldops/NAVIGATION.md`.
2. **Active Job banner** — compact: address, subdivision, builder, system count. Carries the running price total (top-right) and the job-level Cancel control. On multi-system calls the Service step adds the **system switcher** (segmented pill 1 · 2 · 3, active system raised, a dot on systems with a custom service); with a system selected the Service header reads "System N · outdoor model ✎" (W2: moved out of the banner, which keeps address, subdivision, builder and system count). See `SERVICE-TSTAT-SPEC.md`. Weigh-In adopts the same switcher in its own pass (W3). **"+" (W1b, 2026-11-17)** adds a system to the call: single-system calls show 1 · +, multi-system All · 1 · 2 · +. The new system asks for its outdoor unit (catalog condensers and heat pumps, or free text) and then counts in Service, Weigh-In, the "no service selected" check and the receipt. Tapping "System N · model ✎" corrects that system's outdoor unit. Only the last system, and only one the technician added, can be removed (with confirmation); its service, Weigh-In and photos are discarded (photos already uploaded are detached on the server: hidden in Dispatch, file kept — W1c). Every change travels in the Report and Dispatch sees it as "changed by tech".
3. **Step rail** — 5 steps, horizontally scrollable, jumpable directly or via inline Back/Next: **Service+Tstat · Acc · Fix · Weigh-In · Notes**. Current step raised/accent-colored; completed steps marked; pending steps muted. Styled distinct from the top text-tabs.
4. **Scrollable section content** — the active step's content, see per-section docs.
5. **Inline Back/Next** — Next becomes **Generate Report** only on the last step (Notes), never earlier.

6. **Total bar** — fixed at the bottom with the running total on the left.

The bottom bar (see `/docs/fieldops/NAVIGATION.md`) is **not mounted** in Workspace. Two floating buttons sit bottom-right over the empty right side of the Total bar: **Calc** (lowest) and **Guided** above it, 44 px each, raised neumorphic style, respecting the safe-area inset. The scrollable section content has 60 px extra bottom padding so every tappable control, Next included, can scroll above them.

- **Calc** opens the same Quick Charge Calc panel as the bottom bar.
- **Guided** saves the open visit as Guided's active call and opens Guided with "Back to Workspace", which returns to the same visit and step from the Local Visit Draft. See `/docs/fieldops/GUIDED-SPEC.md`.

## Offline-first Workspace state

Service, thermostat, accessories, fixes, Weigh-In, Checklist, Notes, and evidence are fields of the active **Local Visit Draft**. Technician edits must durably update that draft and remain available through step navigation, refresh, FieldOps close/reopen, and temporary loss of connectivity; Workspace correctness must not depend on an immediate backend write. Generate Report is the normal submission boundary. Full contract: `/docs/OFFLINE-FIRST-CONTRACT.md`.

**IMPLEMENTATION GAP:** existing Workspace/API mutation behavior is not evidence that the durable local-draft and submission-outbox contract has been implemented. A future implementation may communicate with the backend during active work, but that communication cannot be required for correctness.

## Cancel

A small ✕ button lives in the Active Job banner (job-level). Tapping it opens the shared Cancel confirmation dialog; only confirmation enters durable local Cancel mode and opens Notes. It is not part of the Service step's tile set. Full mechanism: `/docs/fieldops/CANCEL-SPEC.md`.

## Contextual tools (LV / Blower)

Not in the bottom strip. They live per-system, inside each system's block in the job briefing/context — scoped to that system's registered equipment only. No general/job-less mode.

## Sub-section specs

- `/docs/fieldops/workspace/SERVICE-TSTAT-SPEC.md`
- `/docs/fieldops/workspace/SERVICE-MULTISYSTEM-SPEC.md`
- `/docs/fieldops/workspace/ACC-SPEC.md`
- `/docs/fieldops/workspace/FIX-SPEC.md`
- `/docs/fieldops/workspace/WEIGHIN-SPEC.md`
- `/docs/fieldops/workspace/CHECKLIST-NOTES-SPEC.md`
