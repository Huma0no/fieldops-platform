# FieldOps — Master Function Index

**Version:** 0.9
**Date:** 2026-11-19
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
- `SUPERSEDED / NOT REQUIRED` — a prior or legacy behavior is intentionally not part of FieldOps.
- `CONFLICT` — documentation and implementation disagree; do not modify code until the owning rule is reconciled.

`SPEC CLOSED` describes a specification. `CLOSED` in the Section Status table below describes a whole product section.

## 0. Section Status

A `CLOSED` section is a finished product area: its code, UX, and specifications are not modified unless the current task explicitly authorizes it (see `AGENTS.md`, Closed Sections). Sections not listed here are open.

| Section | Section Status |
|---|---|
| Intake | CLOSED |
| Lobby | CLOSED |
| Transfers | CLOSED |
| History | CLOSED |
| Reports | CLOSED |
| Inventory | CLOSED |
| Ledger | CLOSED |
| Catalog | CLOSED |
| Settings | CLOSED |
| Technicians | CLOSED |
| My Calls | CLOSED |
| Workspace | CLOSED |

## 1. Application Shell / Navigation

| Function | Spec | Spec Status | Implementation / QA | Notes |
|---|---|---|---|---|
| Persistent bottom navigation | `docs/fieldops/NAVIGATION.md` | SPEC CLOSED | Implemented; QA overall still in progress | Six destinations: Lobby, My Calls, Reports, Chat, Calc, Menu. Navigation spec explicitly says it matches running code. |
| Lobby | `docs/dispatch/LOBBY-CALL-INTAKE-SPEC.md` | SPEC CLOSED | QA VERIFIED | Unassigned visits available to claim. |
| My Calls | `docs/fieldops/MY-CALLS-SPEC.md` | SPEC CLOSED | Implemented; QA verification tracked globally | Assigned visits; entry point to Workspace. |
| Reports | `docs/fieldops/REPORTS-SPEC.md` | SPEC CLOSED | QA VERIFIED | Daily completions, share/export, correction request entry. |
| Chat | Dispatch/FieldOps Chat docs | SPEC REVIEW REQUIRED | PARTIAL | Dispatch passive sync remains a design decision; PWA polling exists. |
| Quick Charge Calc | `docs/fieldops/CALC-SPEC.md` | SPEC CLOSED | IMPLEMENTED (automated verification) | Standalone tool. W3 (2026-11-19): FT1/FT2 or Total (mutually exclusive), Manufacturer + Factory length, breakdown with refrigerant badge. |
| Menu / Settings | `docs/fieldops/SETTINGS-SPEC.md` | SPEC CLOSED | QA pending | Menu also owns Transfers entry/badge behavior. |
| Transfers | `docs/fieldops/TRANSFER-SPEC.md` | SPEC CLOSED | QA VERIFIED | Incoming transfer flow implemented. |

## 2. My Calls

| Function | Status | Notes |
|---|---|---|
| Collapsed job card | SPEC CLOSED / IMPLEMENTED | Address, subdivision, builder, Navigate. |
| Expand job card | SPEC CLOSED / IMPLEMENTED (FT-03, 2026-11-23), device QA pending | Tap anywhere on the card except its buttons; opens offline from the Local Visit Draft. |
| Equipment/accessory briefing | SPEC CLOSED / IMPLEMENTED (FT-03), device QA pending | Work type, pre-specified thermostat + accessory chips + system count, intake notes. |
| Per-system briefing | SPEC CLOSED / PARTIAL (FT-03) | Built: models + type, tonnage, refrigerant, factory charge, ESP. Not built (no data source yet): over-charge threshold, subcooling, CFM max/min, LV/Blower buttons. |
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
| Finish modifier | SPEC CLOSED | IMPLEMENTED (automated verification) | Per system: Finish + AC, Heat, or AC & Heat persists the resolved $20 service price for that system; Finish alone is a valid $0 selection and prints the `Finish/` marker. Weight-In-Data follows Finish per system ($20 with Finish, $10 without). |
| Drive Run | SPEC CLOSED | IMPLEMENTED | Call-wide and exclusive; one confirmation clears the other work sections (W1a, 2026-11-17). |
| Cancel | SPEC CLOSED | MOVED TO JOB LEVEL | Not a service tile. |
| Thermostat models | SPEC CLOSED | IMPLEMENTED | Several models per call; tapping a row toggles it (W1a, 2026-11-17). |
| Thermostat quantity | SPEC CLOSED | IMPLEMENTED | One quantity row per model: 1–4 quick picks and + (W1a, 2026-11-17). |
| Add new thermostat | SPEC CLOSED | OPEN | Known SearchableSelect `+ Add new` issue from implementation history. |
| Multi-system service behavior | SPEC CLOSED | IMPLEMENTED (automated verification) | Per-system services with a default selection and per-system overrides through the banner system switcher; each system charged on its own (`SERVICE-TSTAT-SPEC.md`; W1a, 2026-11-17). `SERVICE-MULTISYSTEM-SPEC.md` is superseded. Dispatch corrections still write one visit-level service. |

## 5. Workspace — Accessories

| Function | Spec Status | Implementation / QA | Notes |
|---|---|---|---|
| Accessory catalog tiles | SPEC CLOSED | IMPLEMENTED | Catalog-driven. |
| Zone-board companion activation | SPEC CLOSED | IMPLEMENTED / AUDIT | HZ322 / UT3000 / Harmony rules. |
| LP Kit sub-options | SPEC CLOSED | IMPLEMENTED | W2 (2026-11-19): group tile, options hidden until on, multi-select (`ACC-SPEC.md`). |
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
| Extended Wire variants | SPEC CLOSED | IMPLEMENTED | W2: "Ext. Wire" group tile, Furnace / Cunit, location required; location-less item retired (`FIX-SPEC.md`). |
| Custom fix | SPEC CLOSED | IMPLEMENTED (automated verification) | `Other Fix` persists technician description + custom price, reports the description, and remains `tech_supplied=false` / not restockable. |

## 7. Workspace — Weigh-In

| Function | Spec Status | Implementation / QA | Notes |
|---|---|---|---|
| Per-system Weigh-In | SPEC CLOSED | IMPLEMENTED (automated verification) | Independent system data; one system at a time via the banner switcher (W3). |
| Auto factory charge | SPEC CLOSED | IMPLEMENTED (automated verification) | Catalog charge for the outdoor model + manufacturer + length (`catalog_equipment_charges`), editable: "· catalog" / "· edited"; empty when the catalog has none (W3). |
| Manufacturer + Factory length | SPEC CLOSED | IMPLEMENTED (automated verification) | Replaces the line configuration and Factory/Revised selector (W3): outdoor-brand default, + New (oz/ft), + Custom length, refrigerant asked when missing. |
| Approx adjustment | SPEC CLOSED | IMPLEMENTED (automated verification) | (Lineset ft − factory length) × oz/ft. |
| Adjusted charge | SPEC CLOSED | IMPLEMENTED | Technician input. |
| Fan CFM / temperatures | SPEC CLOSED | IMPLEMENTED | Numeric capture. |
| Subcooling calculation | SPEC CLOSED | IMPLEMENTED (automated verification) | Condenser Sat − Liquid Temp (WS-08 resolved in W3). |
| OEM SC goal | SPEC CLOSED | IMPLEMENTED / QA PENDING | Canonical rule: default to 10°F per system; technician may edit each system's goal. Persist locally and server-side; restore saved values; legacy missing values default to 10°F. Deviation = measured SC − effective goal. |
| SC deviation | SPEC CLOSED | IMPLEMENTED | Computed. |
| Scale photo GPS/EXIF | SPEC CLOSED | IMPLEMENTED | Required for Company form compliance. |
| Fan Speed photo GPS/EXIF | SPEC CLOSED | IMPLEMENTED | Required for Company form compliance. |
| SCALE/FAN photo download carries GPS | SPEC CLOSED (`PHOTOS-GPS-INTEGRATIONS.md`) | IMPLEMENTED (automated verification) | Reports download takes SCALE/FAN from the server copy, the only one with GPS embedded (CC-17, 2026-11-19). |
| New Total Charge | SPEC CLOSED | IMPLEMENTED (automated verification) | Factory + Adjusted, in lb/oz and oz. |
| System switcher | SPEC CLOSED | IMPLEMENTED | Banner 1 · 2 · 3 · + (W3); dot = essentials filled. |
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
| Edit generated report | SPEC CLOSED | SUPERSEDED / NOT REQUIRED | Legacy standalone-PWA behavior; FieldOps uses Request Correction after Generate Report. Canonical report text is regenerated from source visit data, not edited directly. |
| Share/export | SPEC CLOSED | QA VERIFIED | Reports surface. |
| Canonical report snapshot | SPEC CLOSED (`docs/architecture/REPORT-SNAPSHOT-CONTRACT.md`) | IMPLEMENTED (automated verification) / QA pending | One accepted submission per visit (`UNIQUE(visit_id)`, migration 025); report JSON/text served from the accepted snapshot. |
| Report price snapshot, non-blocking catalog discrepancy | SPEC CLOSED (`REPORT-SNAPSHOT-CONTRACT.md`, W-LF section) | IMPLEMENTED (automated verification) — Report view flag; Ledger weekly review deferred (PP-01b) | See R-09. Supersedes the strict reject-on-difference rule for catalog-derived values. |

## 10. Company Google Form Integration

Spec: `docs/shared/PHOTOS-GPS-INTEGRATIONS.md` (The Company's Google Form) — field map with entry IDs and rules decided by Kristo (2026-11-20).

| Function | Spec Status | Implementation | Notes |
|---|---|---|---|
| Per-system prefilled link | SPEC CLOSED | IMPLEMENTED (automated verification), device QA pending | FieldOps Reports, delivered card → Company form → one link per system; opens in a new tab. |
| Prefill weigh-in fields | SPEC CLOSED | IMPLEMENTED (automated verification) | 16 of 18 fields: 13 from Weigh-In and the address, 3 constants ("Big Tex Air Conditioning", "15 ft.", "3/8"). Plain numbers, ASCII "-", one decimal. |
| Link always opens with partial data | SPEC CLOSED | IMPLEMENTED (automated verification) | FT-05 (2026-11-23): replaces "link disabled when data missing". Values present are prefilled, missing ones stay empty and are named under the system. |
| "Was the form sent?" prompt, sent flag + date, usage record, Dispatch entry point | DEFERRED (second round) | NOT IMPLEMENTED | FT-05; open questions in the spec. |
| Link disabled when record edited after capture | DEFERRED (second round) | NOT IMPLEMENTED | Needs an "edited after capture" marker the data model does not have. |
| Scale/Fan photos, test holes | SPEC CLOSED | Technician on the form | Photos uploaded by the technician (downloads carry GPS, §7, CC-17); test holes ticked on the form. |

## 11. Dispatch Surface

| Function | Status | Notes |
|---|---|---|
| PDF Intake | SPEC CLOSED / IMPLEMENTED (catalog integrity) | Thermostat/Accessory review and the shared persistence path now accept only matching existing catalog entries; unmatched values remain contextual review data and do not create catalog or visit items. The extraction API itself remains stub/unconfigured. |
| Manual Call Intake | SPEC CLOSED / IMPLEMENTED / focused automated + manual flow QA | Catalog-backed Thermostat/Accessory selection is restricted to matching existing entries. Unknown or wrong-category values return controlled 400 errors; no catalog upsert occurs. Manual Create → Release → Assign → FieldOps My Calls QA passed locally. |
| Catalog administration — create/edit | PARTIALLY IMPLEMENTED / automated coverage | Dispatch → Catalog already creates/edits Equipment and Items, and edits supported Service properties; Equipment charges per manufacturer + length and Manufacturers are created/edited there (W3). Equipment is the current successor to the historical Config-Equipment concept; no parallel feature is needed. |
| Catalog lifecycle — deactivate/reactivate | SPEC PARTIAL / FUTURE | No catalog active/inactive or equivalent lifecycle exists. Future work must exclude deactivated entries from new selectors while preserving historical references; normal hard delete is not intended. It does not block the Intake repair. |
| Lobby | QA VERIFIED | Current tracker marks complete. |
| History | QA VERIFIED with minor backlog | Detail exists; list still lacks some fields. |
| Properties | SPEC CLOSED / implementation audit | Address-level rollup. |
| Inventory | IMPLEMENTED / QA pending | Restyled in D6; Assign stock picks an active technician (2026-11-19). |
| Restock | QA VERIFIED | Existing restock screen is implemented; future consumption-state model still needs audit against new requirements. |
| Reports to Company | QA VERIFIED | Equipment and refrigerant usage reports implemented. |
| Transfers | QA VERIFIED | Dispatcher and technician flows documented separately. |
| Technicians | IMPLEMENTED (automated verification) / QA pending | Owner account management: create with username + temporary password, provision credentials on legacy rows, password reset, session revocation. Invite codes are superseded. |
| Ledger | QA VERIFIED | Compensation workflow implemented. |
| Settings | SPEC CLOSED / audit | Dispatcher configuration. |

## 12. Cross-Cutting / Integrations

| Area | Status | Notes |
|---|---|---|
| Offline-first FieldOps | SPEC CLOSED | Core architectural principle. |
| Shared PostgreSQL backend | SPEC CLOSED | Shared source of truth. |
| Catalog as single source | SPEC CLOSED | Shared by Dispatch and FieldOps. Intake selects valid catalog entries and never mutates the global catalog. |
| Multi-technician identity | SPEC CLOSED | Technician-scoped entities. |
| Authentication | IMPLEMENTED (automated verification) / QA pending | Username/password accounts and server sessions for Dispatch and FieldOps (`docs/architecture/AUTHENTICATION-ARCHITECTURE.md`). Temporary passwords must be changed first. Sessions: 7 days with "Keep me signed in", otherwise until 03:00 company time; an ended session does not lock FieldOps offline. Supersedes device invite codes. |
| Offline data scoped per technician | IMPLEMENTED (automated verification) / QA pending | Local Visit Drafts, the queue, and photos are keyed by technician ID (`docs/OFFLINE-FIRST-CONTRACT.md`). Records from earlier builds without a technician ID are not migrated (pre-production test data). |
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

### R-04 — Weigh-In OEM SC goal — resolved and implemented (W3, 2026-11-19)

The canonical rule is 10°F as the default for every system, with a technician-editable goal stored independently per system. Existing saved values must survive system switching, navigation, refresh, and reopening; legacy records with a missing/null goal use 10°F. SC deviation is measured Subcooling minus the effective saved/default goal. The database already contains `oem_subcooling_goal` and `subcooling_deviation` columns; the current UI/API implementation still needs to expose and persist the editable value, and focused tests plus runtime verification remain required.

### R-05 — Navigation and My Calls specifications are genuinely closed

The current Navigation spec says it matches the running code and explicitly supersedes an older navigation concept. My Calls is also marked closed and describes the current card interaction and Workspace entry. These should not be redesigned during the audit unless a concrete implementation mismatch is found.

### R-06 — Future restock work is not the same as current Dispatch Restock

Dispatch Restock is marked complete in the QA tracker. The newer requirement for consumption-level accessory tracking and technician-controlled `restocked` state is a separate extension. It should not be interpreted as evidence that the existing Restock screen is broken.

### R-07 — Refrigerant auto-restock is a new rule that needs its own canonical spec

The intended behavior is: generate refrigerant restock needs automatically from consumption data, target approximately 20 lb, enforce the agreed maximum, and process oldest consumption first so older report items do not remain stranded. This is not sufficiently represented in the existing document set to be treated as an implementation-ready feature.

### R-08 — Intake catalog integrity repaired

The prior free-text Intake path could pass an invalid thermostat/accessory name to the `visit_items.item_name` foreign key and return a 500. Commit `41d15c5` restricts Manual/PDF-assisted catalog-backed selection, validates existence and category before persistence, returns controlled 400 errors, and never creates catalog rows implicitly. Focused automated tests passed; the Manual Create → Release → Assign → FieldOps My Calls flow also passed local manual QA. PDF extraction remains separately stub/unconfigured.

Dispatch → Catalog already provides the administrative create/edit surface, including Equipment as the successor to the historical Config-Equipment concept. The future work is limited to catalog lifecycle management: deactivate/reactivate, selector filtering, and the supporting data-model specification. No parallel Config-Equipment feature is required.

### R-09 — Report price snapshot, non-blocking (pre-production requirement)

Decided 2026-11-15 by Kristo after WIP testing. Implement after the WIP merge and before launch. Catalog prices are the technician's rate for the work.

- Each Report stores the prices it was built with. Later catalog price changes never alter past Reports.
- If submitted catalog-derived values (`price`, `tech_supplied`) differ from the server's catalog, the server **accepts** the Report, stores both values, and flags the discrepancy. It never blocks submission with "Correction required" for this reason.
- Dispatch shows the discrepancy on the Report view. Discrepancies are surfaced automatically in the Ledger week review, with a threshold configurable by the owner.
- Dispatch may edit a technician's Report only with prior agreement and notice to the technician, through the existing corrections channel.
- Automatic catalog/shell versioning (Guided Phase 4) remains a secondary safeguard, not the fix.

**Implemented 2026-11-17 (W-LF)** except the Ledger week review, deferred by Kristo (PP-01b). This supersedes the reject-on-difference rule for catalog-derived values in `docs/architecture/REPORT-SNAPSHOT-CONTRACT.md`. Other material Report differences keep their current rule. Kristo authorized (2026-11-15) changes to the CLOSED Reports and Ledger sections for PP-01 only, when it is implemented; updating `REPORT-SNAPSHOT-CONTRACT.md` is part of that work. Tracked as PP-01 in `docs/status/QA-TRACKER.md`.

### R-10 — Technician-defined price panel (future feature, out of current scope)

Recorded 2026-11-15; not planned. The legacy app (hvacstartup-dev.netlify.app) let the technician define prices. FieldOps needs an equivalent if it is commercialized. Options to evaluate then: preset agreed prices, zero prices filled on first use, or a price panel filled before the first job. Tracked as FF-01 in `docs/status/QA-TRACKER.md`.

## 16. Pilot Readiness (audit 2026-11-19)

Pilot: Kristo as the only technician, real jobs, in parallel with the legacy app. Scope frozen. Statuses below are verified against the code.

| # | Item | Status | Evidence | Minimum work |
|---|---|---|---|---|
| 1 | Server reachable from the phone (HTTPS), daily backups | MISSING | No hosting configuration; `src/index.js` serves only `/api`; the apps run on Vite dev servers; backups are a manual example in the runbook. Decision recorded in `docs/architecture/FIRST-LAUNCH-RUNBOOK.md` §5. | Build per the runbook decision: server on Kristo's PC, private access via Tailscale, nightly database + photos backup to a cloud-synced folder, one restore test. |
| 2 | Username/password sign-in (FieldOps, Dispatch) | READY (automated) | `src/routes/auth.js`, `src/middleware/auth.js` (`auth_sessions`). | Device QA. |
| 3 | Manual intake → Lobby → assign | READY | R-08 manual QA; Lobby assign. | — |
| 4 | Workspace end to end, running total | READY (automated + 390 px runs) | W1–W3; phone and server totals matched. | Device QA. |
| 5 | SCALE/FAN photos with GPS for the Company form | READY (automated) | Server embeds GPS (`src/routes/workspace.js`); downloads use the server copy (CC-17). | Device QA with a real photo. |
| 6 | Company Google Form link | READY (automated) | §10: FieldOps Reports → Company form, one prefilled link per system (`frontend/pwa/src/lib/company-form.mjs`, 2026-11-20). | Device QA: open one link signed in to Google, submit with photos. |
| 7 | Report text and total | READY (automated) | `src/services/report.js` matches `REPORT-TEXT.md`. | — |
| 8 | Offline drafts, queue, photos | PARTIAL | Code ready; the offline app shell needs a service worker, which needs HTTPS (item 1). | Device test after item 1: airplane mode → full call → reconnect. |
| 9 | Catalog: real data, current prices | PARTIAL | 144 equipment models, 21 accessories, 12 fixes, 8 thermostats (S1200 price fixed, migration 035). Gaps: Daikin DC6VSS4810/6010 and most Lennox 30 ft charges; route-sheet models missing. | Kristo reviews prices; adds models and charges in Dispatch → Catalog. |
| 10 | Report price snapshot (R-09) | READY | PP-01 implemented; PP-01b deferred. | — |

**Workday blockers found by the audit:**

| ID | Blocker | Status |
|---|---|---|
| C1 / CC-17 | Downloaded SCALE/FAN photos had no GPS (phone copy) | Resolved 2026-11-19 |
| C2 / CC-18 | Global per-IP request cap (100/15 min) exhausted by Lobby polling | Resolved 2026-11-19: only sign-in is rate limited |
| C3 | No frontend serving / HTTPS | Open — part of item 1 |
| C4 / CC-19 | Intermittent full-suite failures (completion 403 test, Dispatch PDF tests) | Open — investigated, not an authorization race; root cause undetermined (QA-TRACKER CC-19) |
| C5 / CC-20 | `schema.sql` lacked DROPs; `db:setup` could not reset an empty DB | Resolved 2026-11-19 |
| C6 | Most Lennox models have no 30 ft charge (Weigh-In opens empty) | Open — catalog review (item 9) |
| C7 | `cors()` unrestricted | Open — low; private Tailscale access limits exposure |

## 17. Next Targets (pilot order)

1. Audit fixes — CC-17, CC-18, CC-20, S1200 done (2026-11-19); CC-19 watch.
2. Hosting — server on Kristo's PC, Tailscale, HTTPS, served apps, nightly backups (runbook §5).
3. Company Google Form link — after Kristo supplies the form URL and field IDs (§10 pilot rule).
4. Catalog review — prices, route-sheet models, missing charges.
5. Device QA — sign-in, Workspace, photos with GPS, offline, on Kristo's phone over Tailscale.
6. Simulated workday — a full day of calls end to end before the first real job.

Earlier audit targets: OEM SC goal (done W3), multi-system Service (done W1a), Google Form (now item 3); the rest (Properties, Load Sheet Summary, restock data model, refrigerant auto-restock, Workspace Shell wording) stay after the pilot.

No application behavior should be changed solely because an index entry says so; the index is an audit map, not authorization to redesign a closed UX.
