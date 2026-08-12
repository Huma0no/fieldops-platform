# FieldOps — Reconciliation Audit Pass

**Date:** 2026-08-11
**Scope:** Completion Report, Workspace Shell, P-drain, Weigh-In, catalog/report integration
**Type:** Documentation and implementation audit only; no application behavior changed.

## Executive result

The product documentation is substantially ahead of the implementation in several areas. The core Workspace model is sufficiently specified to proceed with implementation/bug-fixing, but a small number of contradictions must be resolved before changing behavior.

## Findings

### 1. Completion Report — implementation gap confirmed

`docs/shared/REPORT-TEXT.md` is the approved target for report prose and explicitly states that the current generator has not implemented the templated phrases.

`src/services/report.js` confirms the gap. `generateReportText()` currently queries one service row, visit metadata, system count, notes, and checklist answers, then produces a raw comma-separated string. It does not build the approved accessory/fix report phrases and does not implement the approved report field order.

**Disposition:** implementation task. The approved report-text rules should be treated as the target, not redesigned during implementation.

### 2. Report data model — current JSON path is richer than text generation

`generateReportJSON()` already exposes systems, services, visit items, photos, and weigh-in data. This means the missing Completion Report prose is not evidence that the underlying visit data model is absent. The primary gap is the text-generation layer and its rules.

**Disposition:** preserve the existing data model while replacing/reworking the text-generation logic to consume the canonical catalog/report fields.

### 3. Workspace Shell — specification is closed, one known UI gap remains

`WORKSPACE-SHELL.md` is closed design. It explicitly documents an Active Job banner containing address, subdivision, builder, system count, running price and job-level Cancel, while also stating that the current implementation has only a back button and address.

**Disposition:** do not reopen the UX. Treat the banner as an implementation gap.

### 4. P-drain — documentation and implementation must be reconciled

`CHECKLIST-NOTES-SPEC.md` explicitly requires no submission-time popup or gate; the reminder is static text under the P-drain checklist items.

`QA-TRACKER.md` records that a P-drain advisory was built during the 2026-07-24 session.

**Disposition:** this is a genuine spec/implementation conflict. Do not change either side until the intended behavior is confirmed. The owning UX spec should be authoritative once reconciled.

### 5. Weigh-In — most behavior is implementation-ready

`WEIGHIN-SPEC.md` defines the canonical per-system fields, automatic factory charge, line configuration, calculated adjustment, technician-adjusted charge, measurements, subcooling, GPS/EXIF photos, and computed total charge.

The current audit does not identify a general Weigh-In design gap. The main unresolved business-rule question is the OEM subcooling goal: the current spec fixes it at 10°F for every system, while field discovery has raised the possibility that the correct goal should be equipment-specific.

**Disposition:** keep the documented 10°F rule for now. Treat equipment-specific OEM goals as a decision item, not an assumed implementation correction.

### 6. Catalog/report separation is correctly designed

`CATALOG.md` establishes the catalog as the server-side source of truth. `REPORT-TEXT.md` deliberately separates technician-facing labels from company-facing report text.

**Disposition:** implementation should not reuse UI labels as report prose merely because they are convenient. The report generator should consume the canonical report text associated with catalog selections.

### 7. Company Google Form integration is well-defined

`PHOTOS-GPS-INTEGRATIONS.md` defines the per-system prefilled-link behavior and the hard GPS/EXIF requirement for Scale and Fan Speed photos. This is sufficiently specified for implementation/QA; no redesign is required in this audit pass.

### 8. QA status is broader than the feature specs suggest

`QA-TRACKER.md` currently reports the technician PWA as globally `In progress` and lists P-01 (undefined labels), P-02 (show/hide behavior), and P-03 (redundant Next buttons) as open. It also records the 2026-07-24 fixes/builds for Workspace, Weigh-In, checklist, and GPS/EXIF.

**Disposition:** these QA findings should be treated as implementation/validation work, not reasons to reopen the product model.

## Decisions not to make during this pass

- Do not redesign Workspace.
- Do not redesign Weigh-In.
- Do not replace the catalog model.
- Do not change the Completion Report format based on current generated output; the approved report-text spec is the target.
- Do not silently resolve the P-drain conflict in code.
- Do not assume the OEM subcooling goal is equipment-specific until the business rule is confirmed.

## Recommended implementation order

1. Reconcile P-drain behavior with the owning UX decision.
2. Implement the approved Completion Report text generator.
3. Implement/verify the Active Job banner.
4. Re-run the PWA QA findings P-01/P-02/P-03 against current code.
5. Validate Weigh-In and Company Form handoff end-to-end.
6. Only then address the accessory/refrigerant restock extensions.

## Audit conclusion

FieldOps does not need another product-discovery cycle for its core Workspace flow. The documentation is sufficiently mature to move from discovery into controlled implementation and verification. Remaining work should be handled as explicit implementation gaps, QA bugs, or isolated product decisions rather than repeatedly reopening the whole UX.
