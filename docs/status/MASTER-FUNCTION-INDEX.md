# FieldOps — Master Function Index

**Version:** 0.4
**Date:** 2026-08-15
**Status:** Working audit index

## Purpose

This document is the functional index of FieldOps. It is not a replacement for feature specifications. It provides a single checklist showing what exists in the product map, where the authoritative specification lives, and whether the behavior is specified, implemented, and validated.

The index is derived from `docs/OVERVIEW.md` and the feature specifications it references, then reconciled against the current QA tracker and selected implementation files. A feature marked `SPEC CLOSED` is not automatically considered implemented or QA-validated.

## Status Legend

- `SPEC CLOSED` — intended UX and behavior are sufficiently specified.
- `SPEC PARTIAL` — some behavior remains undefined or explicitly pending decision.
- `IMPLEMENTED` — implementation exists; this does not imply manual QA validation.
- `PARTIAL` — implementation exists but documented behavior is incomplete or differs from the spec.
- `QA VERIFIED` — behavior has been validated according to the current QA record.
- `OPEN` — known issue, missing implementation, or unresolved decision.
- `DEFERRED` — intentionally not part of the current implementation pass.
- `CONFLICT` — documentation and implementation disagree; do not modify code until the owning rule is reconciled.

## 1. Application Shell / Navigation

| Function | Spec | Spec Status | Implementation / QA | Notes |
|---|---|---|---|---|
| Persistent bottom navigation | `docs/fieldops/NAVIGATION.md` | SPEC CLOSED | Implemented; QA overall still in progress | Six destinations: Lobby, My Calls, Reports, Chat, Calc, Menu. Navigation spec explicitly says it matches running code. |
| Lobby | `docs/dispatch/LOBBY-CALL-INTAKE-SPEC.md` | SPEC CLOSED | QA VERIFIED | Unassigned visits available to claim. |
| My Calls | `docs/fieldops/MY-CALLS-SPEC.md` | SPEC CLOSED | Implemented; QA verification tracked globally | Assigned visits; entry point to Workspace. |
| Reports | `docs/fieldops/REPORTS-SPEC.md` | SPEC CLOSED | QA VERIFIED | Daily completions, share/export, correction request entry. |
| Chat | Dispatch/FieldOps Chat docs | SPEC REVIEW REQUIRED | PARTIAL | Dispatch passive sync remains a design decision; PWA polling exists. |
| Quick Charge Calc | `docs/fieldops/CALC-SPEC.md` | SPEC CLOSED | IMPLEMENTED | Standalone tool. |
| Menu / Settings | `docs/fieldops/SETTINGS-SPEC.md` | SPEC CLOSED | QA pending | Menu also owns Transfers entry/badge behavior. |
| Transfers | `docs/fieldops/TRANSFER-SPEC.md` | SPEC CLOSED | QA VERIFIED | Incoming transfer flow implemented. |

## 2. My Calls

| Function | Status | Notes |
|---|---|---|
| Collapsed job card | SPEC CLOSED / IMPLEMENTED | Address, subdivision, builder, Navigate. |
| Expand job card | SPEC CLOSED / IMPLEMENTED | Tap card except Navigate. |
| Equipment/accessory briefing | SPEC CLOSED / IMPLEMENTED | Pre-specified thermostat + accessories + system count. |
| Per-system briefing | SPEC CLOSED / IMPLEMENTED | Equipment, charge, subcooling, ESP/CFM and contextual LV/Blower tools. |
| Start Report | SPEC CLOSED / IMPLEMENTED | Opens Workspace for the visit. |
| Cancel entry point | SPEC CLOSED / IMPLEMENTED (focused automated verification) | Opens Workspace Notes as a Cancel-originated session without calling `/start` or persisting cancellation. Full-suite verification remains inconclusive because PostgreSQL test infrastructure failed in `tests/helpers/db.js:truncateTables`; manual QA remains pending. |
| Load Sheet Summary | SPEC CLOSED / IMPLEMENTATION AUDIT | Aggregates thermostats + accessories across visible jobs. |

## 3. Workspace Shell

| Function | Spec Status | Implementation / QA | Notes |
|---|---|---|---|
| Workspace header | SPEC CLOSED | IMPLEMENTED (focused automated verification) | Separate back/navigation header with address. Full-suite verification remains inconclusive because PostgreSQL test infrastructure failed in `tests/helpers/db.js:truncateTables`; manual QA remains pending. |
| Active Job banner | SPEC CLOSED | IMPLEMENTED (focused automated verification) | Separate compact banner shows address, subdivision, builder, actual `visit.systems.length`, persisted/live running total, and job-level Cancel ✕. Full-suite verification remains inconclusive because PostgreSQL test infrastructure failed in `tests/helpers/db.js:truncateTables`; manual QA remains pending. |
| Five-step rail | SPEC CLOSED | IMPLEMENTED | Service+Tstat → Acc → Fix → Weigh-In → Notes. |
| Direct step navigation | SPEC CLOSED | IMPLEMENTED / QA AUDIT | Rail is jumpable; inline Back/Next also exists. |
| Running price total | SPEC CLOSED | IMPLEMENTED (focused automated verification) | Detail response supplies persisted `totalPrice`; existing Workspace updates keep the banner total live. Full-suite verification remains inconclusive because PostgreSQL test infrastructure failed in `tests/helpers/db.js:truncateTables`; manual QA remains pending. |
| Job-level Cancel | SPEC CLOSED | IMPLEMENTED (focused automated verification) | ✕ opens Notes without confirmation or persistence. Generate Report requires Notes or an answered Checklist item; server enforcement finalizes Cancel by clearing invalid work data, preserving notes/checklist/permitted evidence, persisting `service_name=Cancel`, setting total to $0, and completing as `cancelled`. No separate cancel DB flag or service tile. Full-suite verification remains inconclusive because PostgreSQL test infrastructure failed in `tests/helpers/db.js:truncateTables`; manual QA remains pending. |
| Contextual LV / Blower tools | SPEC CLOSED | IMPLEMENTED | Scoped to active system. |

## 4. Workspace — Service + Thermostat

| Function | Spec Status | Implementation / QA | Notes |
|---|---|---|---|
| AC service | SPEC CLOSED | IMPLEMENTED | Catalog-driven. |
| Heat service | SPEC CLOSED | IMPLEMENTED | Catalog-driven. |
| Prestart service | SPEC CLOSED | IMPLEMENTED | Catalog-driven. |
| Finish modifier | SPEC CLOSED | IMPLEMENTED (automated verification) | Current single-service model: Finish + AC, Heat, or AC & Heat persists the resolved $20 service price; without AC/Heat, `Finish/` remains an independent report marker. The separate Weight-In-Data addon remains independent. |
| Drive Run | SPEC CLOSED | IMPLEMENTED | Separate action. |
| Cancel | SPEC CLOSED | MOVED TO JOB LEVEL | Not a service tile. |
| Thermostat single-select | SPEC CLOSED | IMPLEMENTED | Catalog/SearchableSelect behavior. |
| Thermostat quantity | SPEC CLOSED | IMPLEMENTED | Single model × quantity. |
| Add new thermostat | SPEC CLOSED | OPEN | Known SearchableSelect `+ Add new` issue from implementation history. |
| Multi-system service behavior | SPEC PARTIAL | DEFERRED | `SERVICE-MULTISYSTEM-SPEC.md` is a separate future per-system Service redesign; it is not implemented and does not block the current report generator. |

## 5. Workspace — Accessories

| Function | Spec Status | Implementation / QA | Notes |
|---|---|---|---|
| Accessory catalog tiles | SPEC CLOSED | IMPLEMENTED | Catalog-driven. |
| Zone-board companion activation | SPEC CLOSED | IMPLEMENTED / AUDIT | HZ322 / UT3000 / Harmony rules. |
| LP Kit sub-options | SPEC CLOSED | DEFERRED | Existing inline behavior retained. |
| Other custom accessory | SPEC CLOSED | IMPLEMENTED (automated verification) | Persists technician description + custom price; `tech_supplied=true`; Completion Report uses the description and the existing restock mechanism consumes the item. This does not implement the separate future consumption-level restock workflow. |
| Running price contribution | SPEC CLOSED | IMPLEMENTED | Feeds job total. |
| Weigh-In Data billable accessory | SPEC CLOSED | IMPLEMENTED (automated verification) | Separate from Weigh-In charge-data capture. Persists $10 normally and the resolved $20 price with Finish; toggling Finish synchronizes the persisted price without double-counting. |
| Structured quantity tracking | SPEC PARTIAL | OPEN | Needed for the planned accessory restock workflow. |
| Restock state per consumption record | SPEC PARTIAL | OPEN | Needs canonical consumption/restock model before implementation. |

## 6. Workspace — Fixes

| Function | Spec Status | Implementation / QA | Notes |
|---|---|---|---|
| Standard fix tiles | SPEC CLOSED | IMPLEMENTED | Catalog-driven. |
| Leak variants | SPEC CLOSED | IMPLEMENTED | Ecoil / Cunit / Wall. |
| Extended Wire variants | SPEC CLOSED | IMPLEMENTED | Furnace / Cunit. |
| Custom fix | SPEC CLOSED | IMPLEMENTED (automated verification) | `Other Fix` persists technician description + custom price, reports the description, and remains `tech_supplied=false` / not restockable. |

## 7. Workspace — Weigh-In

| Function | Spec Status | Implementation / QA | Notes |
|---|---|---|---|
| Per-system Weigh-In | SPEC CLOSED | IMPLEMENTED | Independent system data. |
| Auto factory charge | SPEC CLOSED | IMPLEMENTED | Spec says prefilled from catalog. |
| Line configuration | SPEC CLOSED | IMPLEMENTED | Outdoor-brand-aware selector. |
| Approx adjustment | SPEC CLOSED | IMPLEMENTED | Auto-calculated from lineset + configuration. |
| Adjusted charge | SPEC CLOSED | IMPLEMENTED | Technician input. |
| Fan CFM / temperatures | SPEC CLOSED | IMPLEMENTED | Numeric capture. |
| Subcooling calculation | SPEC CLOSED | IMPLEMENTED | Computed. |
| OEM SC goal | SPEC CLOSED | SPEC CONFLICT / USER RULE NEEDS CANONICALIZATION | Current spec fixes 10°F for every system. User's current field rule indicates the goal may need to come from equipment/manual data. Do not change code until the canonical rule is decided and documented. |
| SC deviation | SPEC CLOSED | IMPLEMENTED | Computed. |
| Scale photo GPS/EXIF | SPEC CLOSED | IMPLEMENTED | Required for Company form compliance. |
| Fan Speed photo GPS/EXIF | SPEC CLOSED | IMPLEMENTED | Required for Company form compliance. |
| New Total Charge | SPEC CLOSED | IMPLEMENTED | Read-only computed output. |
| System switcher | SPEC CLOSED | DEFERRED | Existing behavior retained. |
| Refrigerant auto-restock batching | SPEC PARTIAL | OPEN | Business rule exists in project discussion; needs canonical spec and implementation audit. |

## 8. Workspace — Checklist + Notes

| Function | Spec Status | Implementation / QA | Notes |
|---|---|---|---|
| Startup checklist | SPEC CLOSED | IMPLEMENTED | Optional unified list. |
| Checklist No → report text | SPEC CLOSED | IMPLEMENTED / AUDIT | Gas Valve excluded. |
| Checklist No → photo | SPEC CLOSED | IMPLEMENTED | Inline photo capture. |
| Notes | SPEC CLOSED | IMPLEMENTED | Observational notes for report generation. |
| Generate Report | SPEC CLOSED | IMPLEMENTED | Final Workspace action. |
| P-drain behavior | SPEC CLOSED | IMPLEMENTED (automated verification) | Static inline reminder retained. Submission-time advisory/modal and Generate Report gate were removed; Yes/No and checklist report-text behavior remain unchanged. |

## 9. Completion Report

| Function | Spec Status | Implementation / QA | Notes |
|---|---|---|---|
| Report field order | SPEC CLOSED | IMPLEMENTED (automated verification) | Canonical Company-facing line is address, notes/checklist findings, service/thermostat, accessories, fixes, and authoritative stored total. |
| Service phrases | SPEC CLOSED | IMPLEMENTED (automated verification) | Canonical AC, Heat, AC & Heat, Prestart, Drive Run, Cancel, Temporarily, Finish, and current system-count wording use persisted service price. |
| Accessory phrases | SPEC CLOSED | IMPLEMENTED (automated verification) | Canonical phrases use persisted quantity/resolved price; Other uses its technician description and Weight-In-Data uses persisted $10/$20. |
| Fix phrases | SPEC CLOSED | IMPLEMENTED (automated verification) | Canonical phrases use persisted quantity/price; Other Fix uses its technician description. |
| Checklist No text | SPEC CLOSED | IMPLEMENTED (automated verification) | No-answer `reportText` values are included; entries with no report text, including Gas Valve, are naturally excluded. |
| Edit generated report | SPEC CLOSED | OPEN / IMPLEMENTATION AUDIT | Required correction path; current source/spec reconciliation still needed. |
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
| Manual Call Intake | SPEC PARTIAL | Decision exists; design/implementation remains. |
| Lobby | QA VERIFIED | Current tracker marks complete. |
| History | QA VERIFIED with minor backlog | Detail exists; list still lacks some fields. |
| Properties | SPEC CLOSED / implementation audit | Address-level rollup. |
| Inventory | OPEN | Tracker says not started. |
| Restock | QA VERIFIED | Existing restock screen is implemented; future consumption-state model still needs audit against new requirements. |
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

## 15. Current Reconciliation Findings

This section records findings verified during the 2026-08-15 audit reconciliation.

### R-01 — Completion Report implementation gap resolved

`generateReportText()` now generates the canonical Company-facing report line using persisted service/item prices, canonical phrases, notes/checklist findings, and the stored total. Focused and full-suite automated tests passed with commit `14466fd`.

**Resolution:** implemented and automatically verified. The deferred per-system Service redesign remains separate.

### R-02 — Workspace Active Job banner and job-level Cancel implemented

Commit `a5461691e597b8e51ead41dd9e6af64f81a63fb9` implements the separate Active Job banner and the My Calls/Workspace Cancel entry points. Cancel now persists only through Generate Report after Notes-or-Checklist justification, using the existing `service_name=Cancel` representation and preserving Notes, Checklist, and permitted evidence. Focused automated verification passed (4/4 suites, 91/91 tests), `git diff --check`, and relevant `node --check` passed. Full-suite verification remains inconclusive because PostgreSQL test infrastructure failed in `tests/helpers/db.js:truncateTables`; manual QA is not complete.

### R-03 — P-drain behavior conflict resolved

The implementation now matches `CHECKLIST-NOTES-SPEC.md`: P-drain is a static inline reminder with no submission-time popup/advisory and no Generate Report gate. Existing Yes/No and report-text behavior was preserved.

### R-04 — Weigh-In OEM SC goal requires canonical business rule

The current Weigh-In spec says the OEM SC goal is fixed at 10°F for every system. The field requirement discussed during product discovery indicates that equipment-specific information may determine the correct goal. This is a product/business rule question, not an implementation bug. Until resolved, the current 10°F rule remains the documented rule.

### R-05 — Navigation and My Calls specifications are genuinely closed

The current Navigation spec says it matches the running code and explicitly supersedes an older navigation concept. My Calls is also marked closed and describes the current card interaction and Workspace entry. These should not be redesigned during the audit unless a concrete implementation mismatch is found.

### R-06 — Future restock work is not the same as current Dispatch Restock

Dispatch Restock is marked complete in the QA tracker. The newer requirement for consumption-level accessory tracking and technician-controlled `restocked` state is a separate extension. It should not be interpreted as evidence that the existing Restock screen is broken.

### R-07 — Refrigerant auto-restock is a new rule that needs its own canonical spec

The intended behavior is: generate refrigerant restock needs automatically from consumption data, target approximately 20 lb, enforce the agreed maximum, and process oldest consumption first so older report items do not remain stranded. This is not sufficiently represented in the existing document set to be treated as an implementation-ready feature.

## 16. Next Audit Targets

The next pass should focus on the highest-value reconciliation items in this order:

1. Completion Report Edit behavior — audit the correction path separately from the implemented generator.
2. PWA QA findings P-01 / P-02 / P-03 — verify and resolve the currently open FieldOps issues in `QA-TRACKER.md`.
3. Weigh-In — reconcile the current 10°F OEM SC goal with the canonical equipment/OEM rule.
4. Company Google Form integration — verify the end-to-end prefill and required-photo behavior.
5. Accessories/restock data model — define consumption quantity and technician-controlled restock state before coding; existing Other participation does not complete this work.
6. Refrigerant auto-restock — create the canonical implementation spec after the business rule is confirmed.
7. Multi-system Service redesign — schedule the deferred per-system model when intentionally prioritized.

No application behavior should be changed solely because an index entry says so; the index is an audit map, not authorization to redesign a closed UX.
