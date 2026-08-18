# Startup Checklist + Notes

**Version:** 1.0
**Date:** 2026-07-30
**Status:** Closed design

## Purpose

Fifth and final step of Workspace: the startup checklist on top, free-text notes below, ending in Generate Report.

## Startup Checklist

Single unified list, all items always visible and expanded — no categories, no conditional logic, no hard blockers, no collapse/expand state. All items optional. No inheritance from a previous visit at this address/system — each visit's checklist starts blank, same as every other Workspace section; the checklist's own report text is what carries the record forward through History, not a pre-filled value.

**Item order and report text when answered No** (Gas Valve is the one item excluded from report text):

| Item | Report text when No |
|---|---|
| P-drain [eCoil] | "No/Incomplete pdrain at ecoil" |
| P-drain [Discharge] | "No/Incomplete pdrain" |
| Tstat Locked? | *(reminder only — no report text, no photo)* |
| Media Filter | "Media filter missing" |
| Electric Meter | "No electric meter" |
| Breaker — Condenser | "Disconnect missing at Cond" |
| Breaker — Air Handler | "No breakers in the main breaker panel" |
| Disconnect box | "Disconnect box missing" |
| Whip 220v | "220v not connected/Missing at cond" |
| Furnace disconnect switch | "Furnace disconnect switch missing" |
| 110v cable | "110v cable to furnace not connected" |
| Gas Meter | "gas meter closed/missing" |
| Gas Pipes/Tubing at Furnace | "Gas pipes/Tubing at furnace missing" |
| Gas Valve | *(not included in report text)* |

Selecting "No" on any item reveals an inline photo upload for that item. Scale/Fan photos are **not** part of the checklist — each pair lives per-system, inside `/docs/fieldops/workspace/WEIGHIN-SPEC.md` only.

Photo filename slug format: `{ADDRESS}_{TAG}_SYS{N}` — generated automatically by the backend.

## Notes

Free-text field at the bottom, below the checklist. For observations at report-generation time only — not a correction-tracking mechanism. Post-submission corrections use Request Corrections from Reports, see `/docs/shared/CORRECTIONS.md`.

Checklist answers, Notes, and their evidence references are durable Local Visit Draft state while the visit is active. They must survive navigation, refresh, FieldOps close/reopen, and temporary connectivity loss. They are included in the Generate Report submission snapshot; an immediate server save is not required for Workspace correctness. See `/docs/OFFLINE-FIRST-CONTRACT.md`.

## Generate Report

Final button on this step (not accessible from any earlier step). No blocking or non-blocking advisory dialog on tap — the P-drain reminder lives as static text directly under the P-drain items' labels in the checklist itself (e.g. "Reviewing the P-drain is recommended before completing"), not as a separate popup evaluated at submission time.

**Report text order:** Date · Address · Subdivision · Builder · Notes + checklist "No" items (pipe-separated) · Service · Service $ · Accessories · Acc $ · Fix · Fix $.
