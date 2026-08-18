# FieldOps Operational Architecture Map

**Version:** 1.0
**Date:** 2026-08-17
**Status:** Current architectural reference

## 1. Source of Truth

**Structured visit data is the operational source of truth.** A visit and its persisted source records — address, assignment/status, systems, services, items, notes, checklist answers, photos, and weigh-in data — record what was scheduled, performed, and finalized. Catalog tables are separate master data: they govern valid operational selections and server-side resolution when source records are created, but do not rewrite historical visit records.

The canonical Completion Report is derived from persisted visit source data. History views, restock/inventory summaries, refrigerant/equipment reports, Ledger amounts, correction context, and Company-facing outputs likewise consume or aggregate that data. Report text, exports, and summaries do not become alternate sources from which business data is reconstructed.

Important exception: a correction request is authoritative workflow metadata about a requested post-completion change; it is not a replacement for source visit data. A Dispatcher applies an accepted correction to the visit data, after which derived artifacts are regenerated.

## 2. Main Operational Journey

```
Intake → pending_review → Lobby (in_lobby) → Assign / Claim (assigned)
       → My Calls → Workspace (in_progress) → Generate Report
       → completed | temporarily | cancelled
```

Dispatch Intake creates a visit in `pending_review`; batch release publishes it to `in_lobby`. A Dispatcher may assign it or a technician may claim it, producing `assigned`. Starting normal FieldOps work changes it to `in_progress`. Generate Report is the operational finalization action and persists one terminal visit state: `completed`, `temporarily`, or `cancelled`. There is no visit-level `closed` state.

## 3. Exception and Alternate Journeys

- **Cancel:** My Calls or the Workspace job control enters Notes; nothing is cancelled until Generate Report finalizes `cancelled` with its required justification and zero total.
- **Temporarily:** a Workspace service modifier; Generate Report finalizes the visit as `temporarily`.
- **Transfer:** a technician-to-technician handshake. Acceptance changes the assignee but is not visit completion and does not create another visit status.
- **Request Correction:** after Generate Report and before the applicable Ledger week closes, a technician asks Dispatch to correct source data. Technicians do not directly edit finalized visits or generated report text.
- **Ledger close:** `pay_periods.closed` is a financial state, separate from the visit lifecycle.

## 4. Derived Consumers

| Consumer | Structured source consumed | Timing / role |
|---|---|---|
| Dispatch / History | Visits, addresses, source work records, status | Dynamic operational/history views; derived, not a second record of work. |
| Completion Report | Persisted visit, service, item, checklist, note, and system data | Generated on demand/finalization; derived presentation. |
| Restock / Inventory | Finalized visit items with catalog-derived `tech_supplied`, assignments, and restock records | Dynamic aggregation plus restock audit records; derived consumption view. |
| Refrigerant / equipment reporting | Visits, systems, address-linked weigh-in data, catalog-resolved values | Dynamic date/technician reporting; derived. |
| Compensation / Ledger | Completed or temporarily finalized visits and persisted resolved totals | Weekly aggregation is finalized into pay-period lines; financial derivative, not visit state. |
| Corrections | Finalized visit data and Ledger-week state | Workflow metadata; Dispatcher changes source visit data, then derivatives regenerate. |
| Company-facing outputs / forms | Canonical report and visit/system/weigh-in source data | Generated or prefilled output; not an editable source snapshot. |

## 5. Catalog Boundary

`Dispatch → Catalog` owns administrative create/edit of the current catalog domains: Equipment, Items, Services, and Lineset Configs. Intake and Workspace consume/select catalog data; they do not implicitly create or mutate master catalog rows. Server-side catalog resolution supplies valid references, operational properties, and initial resolved values to new visit records.

Catalog deactivate/reactivate and selector filtering are future work. They must preserve historical references and are not currently implemented.

## 6. Pricing Boundary

Pricing is resolved centrally from the selected visit source data and persisted as the visit's resolved service/item prices and total. Downstream consumers use those persisted resolved values. Report generators format and present pricing; they do not recreate business pricing rules in the UI or report layer.

## 7. Completion Boundary

Generate Report is the technician operational finalization boundary. It persists the terminal visit outcome and source data. Thereafter, the technician cannot directly reopen finalized source records or edit report text; Request Correction is the post-completion route. The canonical Completion Report remains regenerable from authoritative source data — no report snapshot or versioned editable copy is introduced.

## 8. Offline-First Boundary

For active FieldOps work, a durable Local Visit Draft is the technician's working source of truth. Generate Report creates an immutable submission snapshot; that snapshot remains pending until the backend explicitly acknowledges its accepted, terminal persistence. Retrying the same submission must be duplicate-safe. The backend remains the shared operational source after ACK, while Dispatch does not mirror every intermediate Workspace mutation. The detailed contract is `/docs/OFFLINE-FIRST-CONTRACT.md`.

## 9. Architectural Invariants

- Structured source records remain the single operational truth; derived artifacts do not compete with them.
- Operational screens select catalog data but do not silently mutate master catalog data.
- Pricing rules are resolved once and are not duplicated in UI or report formatting layers.
- Visit lifecycle and payroll lifecycle are separate.
- Active FieldOps work survives temporary offline operation; a transport attempt is not delivery without server ACK.
- Deferred models are not implemented opportunistically as part of adjacent work.

## 10. Deferred Architecture Boundaries

Major explicitly deferred boundaries are the per-system multi-system Service redesign, catalog deactivate/reactivate, a consumption-level restock model, and refrigerant auto-restock. They are not implied by the current architecture and require their own current specification before implementation.
