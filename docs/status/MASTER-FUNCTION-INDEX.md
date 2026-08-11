# FieldOps — Master Function Index

**Version:** 0.1
**Date:** 2026-08-11
**Status:** Working audit index

## Purpose

This document is the functional index of FieldOps. It is not a replacement for feature specifications. It provides a single checklist showing what exists in the product map, where the authoritative specification lives, and whether the behavior is specified, implemented, and validated.

The index is derived from `docs/OVERVIEW.md` and the feature specifications it references. A feature marked `SPEC CLOSED` is not automatically considered implemented or QA-validated.

## Status Legend

- `SPEC CLOSED` — intended UX and behavior are sufficiently specified.
- `SPEC PARTIAL` — some behavior remains undefined or explicitly pending decision.
- `IMPLEMENTED` — implementation exists; this does not imply manual QA validation.
- `PARTIAL` — implementation exists but documented behavior is incomplete or differs from the spec.
- `QA VERIFIED` — behavior has been validated according to the current QA record.
- `OPEN` — known issue, missing implementation, or unresolved decision.
- `DEFERRED` — intentionally not part of the current implementation pass.

## 1. Application Shell / Navigation

| Function | Spec | Spec Status | Implementation / QA | Notes |
|---|---|---|---|---|
| Persistent bottom navigation | `docs/fieldops/NAVIGATION.md` | SPEC CLOSED | QA in progress | Six destinations: Lobby, My Calls, Reports, Chat, Calc, Menu. |
| Lobby | `docs/dispatch/LOBBY-CALL-INTAKE-SPEC.md` | SPEC CLOSED | QA VERIFIED | Unassigned calls available to claim. |
| My Calls | `docs/fieldops/MY-CALLS-SPEC.md` | SPEC CLOSED | QA VERIFIED | Assigned visits; entry point to Workspace. |
| Reports | `docs/fieldops/REPORTS-SPEC.md` | SPEC CLOSED | QA VERIFIED | Daily completions, share/export, correction request entry. |
| Chat | `docs/dispatch/CHAT-SPEC.md` / FieldOps docs | SPEC CLOSED / audit required | PARTIAL | Dispatch passive sync decision remains open. |
| Quick Charge Calc | `docs/fieldops/CALC-SPEC.md` | SPEC CLOSED | IMPLEMENTED | Standalone tool. |
| Menu / Settings | `docs/fieldops/SETTINGS-SPEC.md` | SPEC CLOSED | QA pending | Menu also owns Transfers entry/badge behavior. |
| Transfers | `docs/fieldops/TRANSFER-SPEC.md` | SPEC CLOSED | QA VERIFIED | Incoming transfer flow implemented. |

## 2. My Calls

| Function | Status | Notes |
|---|---|---|
| Collapsed job card | SPEC CLOSED / QA VERIFIED | Address, subdivision, builder, Navigate. |
| Expand job card | SPEC CLOSED / QA VERIFIED | Tap card except Navigate. |
| Equipment/accessory briefing | SPEC CLOSED / QA VERIFIED | Pre-specified visit items and per-system context. |
| Per-system briefing | SPEC CLOSED / QA VERIFIED | Equipment, charge, subcooling, ESP/CFM and contextual LV/Blower tools. |
| Start Report | SPEC CLOSED / QA VERIFIED | Opens Workspace for the visit. |
| Cancel entry point | SPEC CLOSED / implementation audit | Job-level cancellation mechanism owned by CANCEL-SPEC. |
| Load Sheet Summary | SPEC CLOSED / implementation audit | Aggregates thermostats + accessories across visible jobs. |

## 3. Workspace Shell

| Function | Spec Status | Implementation / QA | Notes |
|---|---|---|---|
| Workspace header | SPEC CLOSED | PARTIAL | Current implementation has back + address only. |
| Active Job banner | SPEC CLOSED | OPEN | Documented as not built; intended to contain context, price and Cancel. |
| Five-step rail | SPEC CLOSED | IMPLEMENTED | Service+Tstat → Acc → Fix → Weigh-In → Notes. |
| Direct step navigation | SPEC CLOSED | IMPLEMENTED / QA audit | Rail is jumpable; Back/Next also available. |
| Running price total | SPEC CLOSED | IMPLEMENTED | Fed by workspace selections. |
| Job-level Cancel | SPEC CLOSED | IMPLEMENTATION AUDIT | Opens Notes directly; no confirmation dialog per current shell spec. |
| Contextual LV / Blower tools | SPEC CLOSED | IMPLEMENTED | Scoped to active system. |

## 4. Workspace — Service + Thermostat

| Function | Spec Status | Implementation / QA | Notes |
|---|---|---|---|
| AC service | SPEC CLOSED | IMPLEMENTED | Catalog-driven. |
| Heat service | SPEC CLOSED | IMPLEMENTED | Catalog-driven. |
| Prestart service | SPEC CLOSED | IMPLEMENTED | Catalog-driven. |
| Finish modifier | SPEC CLOSED | IMPLEMENTED | Modifier, not a base service. |
| Drive Run | SPEC CLOSED | IMPLEMENTED | Separate action. |
| Cancel | SPEC CLOSED | MOVED TO JOB LEVEL | Not a service tile. |
| Thermostat single-select | SPEC CLOSED | IMPLEMENTED | Catalog/SearchableSelect behavior. |
| Thermostat quantity | SPEC CLOSED | IMPLEMENTED | Single model × quantity. |
| Add new thermostat | SPEC CLOSED | OPEN | Known SearchableSelect `+ Add new` behavior issue. |
| Multi-system service behavior | SPEC PARTIAL | OPEN | `SERVICE-MULTISYSTEM-SPEC.md` is specified but remains a redesign/implementation item. |

## 5. Workspace — Accessories

| Function | Spec Status | Implementation / QA | Notes |
|---|---|---|---|
| Accessory catalog tiles | SPEC CLOSED | IMPLEMENTED | Catalog-driven. |
| Zone-board companion activation | SPEC CLOSED | IMPLEMENTED / audit | HZ322 / UT3000 / Harmony rules. |
| LP Kit sub-options | SPEC CLOSED | DEFERRED | Existing inline behavior retained; latest style pass did not rebuild it. |
| Other custom accessory | SPEC CLOSED | DEFERRED | Custom description/price behavior retained. |
| Running price contribution | SPEC CLOSED | IMPLEMENTED | Feeds job total. |
| Weigh-In Data billable accessory | SPEC CLOSED | IMPLEMENTED | Separate from Weigh-In charge-data toggle. |
| Structured quantity tracking | SPEC PARTIAL | OPEN | Required for future restock reporting; current catalog selection model needs extension. |
| Restock state per consumption record | SPEC PARTIAL | OPEN | Future RESTOCKED / PENDING RESTOCK workflow. |

## 6. Workspace — Fixes

| Function | Spec Status | Implementation / QA | Notes |
|---|---|---|---|
| Standard fix tiles | SPEC CLOSED | IMPLEMENTED | Catalog-driven. |
| Leak variants | SPEC CLOSED | IMPLEMENTED | Ecoil / Cunit / Wall. |
| Extended Wire variants | SPEC CLOSED | IMPLEMENTED | Unspecified / Cunit / Furnace. |
| Custom fix | SPEC CLOSED | IMPLEMENTED | Description + price. |

## 7. Workspace — Weigh-In

| Function | Spec Status | Implementation / QA | Notes |
|---|---|---|---|
| Per-system Weigh-In | SPEC CLOSED | IMPLEMENTED | Independent system data. |
| Auto factory charge | SPEC CLOSED | IMPLEMENTED | Prefilled from catalog/equipment. |
| Line configuration | SPEC CLOSED | IMPLEMENTED | Brand-aware selector. |
| Approx adjustment | SPEC CLOSED | IMPLEMENTED | Calculated from lineset + factory configuration. |
| Adjusted charge | SPEC CLOSED | IMPLEMENTED | Technician input. |
| Fan CFM / temperatures | SPEC CLOSED | IMPLEMENTED | Numeric capture. |
| Subcooling calculation | SPEC CLOSED | IMPLEMENTED | Computed. |
| OEM SC goal | SPEC CLOSED | SPEC REVIEW REQUIRED | Current spec says fixed 10°F; field requirement indicates equipment-specific goal may matter. |
| SC deviation | SPEC CLOSED | IMPLEMENTED | Computed. |
| Scale photo GPS/EXIF | SPEC CLOSED | IMPLEMENTED | Required for Company form compliance. |
| Fan Speed photo GPS/EXIF | SPEC CLOSED | IMPLEMENTED | Required for Company form compliance. |
| New Total Charge | SPEC CLOSED | IMPLEMENTED | Read-only computed output. |
| System switcher | SPEC CLOSED | DEFERRED | Existing behavior retained. |
| Refrigerant auto-restock batching | SPEC PARTIAL | OPEN | Business rule defined conversationally; dedicated implementation/spec audit still required. |

## 8. Workspace — Checklist + Notes

| Function | Spec Status | Implementation / QA | Notes |
|---|---|---|---|
| Startup checklist | SPEC CLOSED | IMPLEMENTED | Optional unified list. |
| Checklist No → report text | SPEC CLOSED | IMPLEMENTED / audit | Gas Valve excluded. |
| Checklist No → photo | SPEC CLOSED | IMPLEMENTED | Inline photo capture. |
| Notes | SPEC CLOSED | IMPLEMENTED | Observational notes for report generation. |
| Generate Report | SPEC CLOSED | IMPLEMENTED | Final Workspace action. |
| P-drain behavior | SPEC CLOSED | CONFLICT | Spec says static reminder; implementation previously had advisory modal/gate. Must reconcile. |

## 9. Completion Report

| Function | Spec Status | Implementation / QA | Notes |
|---|---|---|---|
| Report field order | SPEC CLOSED | PARTIAL | `REPORT-TEXT.md` defines target; current generator historically used raw values/order. |
| Service phrases | SPEC CLOSED | PARTIAL | Templated prose remains a known implementation gap. |
| Accessory phrases | SPEC CLOSED | PARTIAL | Same report-generator gap. |
| Fix phrases | SPEC CLOSED | PARTIAL | Same report-generator gap. |
| Checklist No text | SPEC CLOSED | IMPLEMENTED / audit | Gas Valve excluded. |
| Edit generated report | SPEC CLOSED | IMPLEMENTATION AUDIT | Required to correct mistakes after generation. |
| Share/export | SPEC CLOSED | QA VERIFIED | Reports surface. |

## 10. Company Google Form Integration

| Function | Status | Notes |
|---|---|---|
| Per-system prefilled link | SPEC CLOSED | One link per system. |
| Prefill weigh-in fields | SPEC CLOSED | 16/18 fields described as prefillable. |
| Link disabled when data incomplete/edited | SPEC CLOSED | Must remain enforced. |
| Scale/Fan photos | SPEC CLOSED | Technician still uploads required images to Company form. |

## 11. Dispatch Surface

| Function | Status | Notes |
|---|---|---|
| PDF Intake | SPEC CLOSED / QA PARTIAL | Extraction API remains stub/unconfigured. |
| Manual Call Intake | SPEC PARTIAL | Decision exists; implementation/design work remains. |
| Lobby | QA VERIFIED | Current tracker marks complete. |
| History | QA VERIFIED with minor backlog | Detail view exists; list still lacks some fields. |
| Properties | SPEC CLOSED / implementation audit | Address-level rollup. |
| Inventory | OPEN | Tracker says not started. |
| Restock | QA VERIFIED | Existing restock screen is implemented. Future consumption-state model still needs audit against new requirements. |
| Reports to Company | QA VERIFIED | Equipment and refrigerant usage reports implemented. |
| Transfers | QA VERIFIED | Dispatcher and technician flows documented separately. |
| Technicians | PARTIAL | Invite flow verified; refresh/revoke still need testing. |
| Ledger | QA VERIFIED | Compensation workflow implemented. |
| Settings | SPEC CLOSED / audit | Dispatcher configuration. |

## 12. Cross-Cutting / Integrations

| Area | Status | Notes |
|---|---|---|
| Offline-first FieldOps | SPEC CLOSED | Core architectural principle. |
| Shared PostgreSQL backend | SPEC CLOSED | Shared source of truth. |
| Catalog as single source | SPEC CLOSED | Shared by Dispatch and FieldOps. |
| Multi-technician identity | SPEC CLOSED | Technician-scoped entities. |
| Photos / GPS / EXIF | SPEC CLOSED | See shared integration spec. |
| Google Drive | SPEC CLOSED / OPEN implementation | Decided, not yet built per QA backlog. |
| Corrections | QA VERIFIED | Dispatcher-side correction workflow. |
| Notifications / sync | PARTIAL | Dispatch Chat passive-sync decision remains open. |

## 13. Deliberately Out of Scope

These are not missing features:

- Troubleshooting Engine — intentionally cut from the initial build unless later reactivated.
- In-field manuals — intentionally cut.
- Voice-to-report — intentionally cut.

See `docs/OUT-OF-SCOPE.md`.

## 14. Audit Rules

When a node is reviewed, answer these questions before marking it `CLOSED`:

1. Is the intended user experience documented?
2. Is the expected behavior documented?
3. Are the business rules documented?
4. Is the data captured by the feature identified?
5. Is the authoritative specification linked?
6. Does the implementation match the specification?
7. Does QA verify the implemented behavior?
8. Are known exceptions and deferred interactions explicitly recorded?

`SPEC CLOSED` means questions 1–5 are sufficiently answered. `QA VERIFIED` requires questions 6–7 as well.

## 15. Known Reconciliation Targets

These should be resolved during the audit rather than rediscovered in separate conversations:

- Workspace Active Job banner: specified but not built.
- Service multi-system behavior: specified but not fully implemented.
- SearchableSelect `+ Add new`: known interaction bug.
- Accessories LP Kit / Other interactions: specified but deferred.
- P-drain documentation vs implementation conflict.
- Completion Report target spec vs current raw generator.
- Weigh-In OEM subcooling rule: current spec says fixed 10°F; equipment-specific field behavior needs confirmation against actual requirements.
- Restock data model: current structured accessory records need consumption quantity and restock state for the planned restock workflow.
- Refrigerant batching: target ~19.5 lb, hard maximum 20 lb, oldest-first generation; needs a canonical implementation spec.
