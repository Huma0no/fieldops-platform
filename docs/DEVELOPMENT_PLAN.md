# Development Plan
## Field Ops + Dispatch — HVAC Startup Platform

**Version:** 1.0
**Date:** 2026-06-18
**Authors:** Christian Huerta + Claude (planning session)
**Status:** Active — ready to begin Phase 0
**Based on:** SYSTEM_DESIGN.md, DATA_MODEL.md (27 tables), API_CONTRACT.md (14 sections)

---

## 1. Purpose

This document sequences the system into buildable phases, ordered by actual data and functional dependency. For each phase: what gets built, which tables and endpoints it touches, what it depends on, and what "done" means in testable terms.

All design gaps identified in the original plan (A–G) are now resolved in the source documents. No open questions remain before Phase 0 can begin.

---

## 2. Key decisions already locked

These decisions are reflected in the source documents and do not need to be re-evaluated during development:

- **Database:** PostgreSQL.
- **Auth:** Device-token per phone via one-time invite code. No daily login, no PIN.
- **Technician roles:** Three fixed values — owner, dispatcher, technician. Adding a new role always requires new permission logic in code.
- **Catalog:** Five tables (catalog_equipment, catalog_lineset_configs, catalog_items, catalog_item_relations, catalog_services) seeded from `src/data.js` (ACstartup repo). Single source of truth for pricing, refrigerant, tech_supplied classification, companion/exclusion rules.
- **Photo storage:** Google Drive via service account. Photos captured locally during a visit, compressed client-side, bundled into one ZIP per completed visit, uploaded to Drive at completion time. `visit_photos.stored_at` holds the Drive URL. Retention ~60-90 days, cleaned manually or via Cowork.
- **"Real-time" sync:** Polling, not WebSockets or SSE. `GET /api/sync/changes?since=` returns deltas. Suggested interval: 15-30 seconds in foreground, paused when backgrounded.
- **Cancel behavior:** Deletes all visit_items and visit_services rows. Only notes remain editable after cancellation.
- **Modifier distinction:** Finish is a pricing modifier — adds finish_addon_price when combined with Weigh-In-Data on the same visit.
- **Assignment model:** Dispatcher assigns directly as the typical day-to-day mode. Lobby is the alternative when no preference exists. Technician-to-technician transfers are peer-initiated, no dispatcher approval.
- **Technician lifecycle:** Rows are never deleted. Deactivation orphans active visits and notifies the dispatcher, who resolves via direct reassignment. Reactivation restores the same identity and historical record.
- **Batch verification:** release-to-lobby does a count check (visits with batch_id = this batch and status = pending_review must equal total_calls − skipped_count). Mismatch holds the batch without discarding it.
- **Corrections:** Technician submits a form-based request from Reports. Dispatcher approves or rejects. Approval creates an edit_log entry with source = "correction_approved". Rejection stores an optional dispatcher_note.

---

## 3. Phase Overview

| Phase | Scope | Depends on |
|---|---|---|
| 0 | Schema, catalogs, Drive wiring, auth middleware, Google service account | — |
| 1 | Auth, technician lifecycle, notifications core, sync endpoint | 0 |
| 2 | Addresses + PDF intake → visits (batch state machine) | 0, 1 |
| 3 | Lobby, assignment (Dispatcher direct + Lobby claim), visit lifecycle | 1, 2 |
| 4 | Workspace + pricing engine + photo capture | 3 |
| 5 | Completion, transfers, offline behavior | 4 |
| 6 | History, full edit, inventory, restock | 5 |
| 7 | Pay periods | 5 (parallel to 6) |
| 8 | Post-completion corrections | 5, 6, 7 |
| 9 | Chat | 1 (parallel to 2–8) |
| 10 | Technician settings, price overrides, catalog editing | 1, 6 |

```
Phase 0
  ↓
Phase 1
  ↓
Phase 2
  ↓
Phase 3
  ↓
Phase 4
  ↓
Phase 5
  ↓        ↓
Phase 6   Phase 7    (parallel — both depend only on Phase 5)
  ↓        ↓
     Phase 8

Phase 9  — parallel track, depends only on Phase 1
Phase 10 — depends on Phase 1 (auth) and Phase 6 (for meaningful price override testing)
```

---

## 4. Phases

### Phase 0 — Data substrate & infrastructure

**Builds:**
- PostgreSQL schema for all 27 tables in DATA_MODEL.md — create all tables, constraints, CHECK constraints (role, category enums), foreign keys, and indexes.
- Catalog seed from `src/data.js` (ACstartup repo): catalog_equipment, catalog_lineset_configs, catalog_items (excluding PVC_WORK and Service Other), catalog_item_relations (companion and zone-board groupings), catalog_services.
- role_permissions seed: initial rows for owner, dispatcher, and technician roles covering all actions defined in API_CONTRACT.md.
- Google Drive service account configured and wired up — no upload logic yet, just the connection verified and credentials in place.
- Generic bearer-token auth middleware and role-guard helper wired to role_permissions (not yet connected to the real invite flow — that's Phase 1).

**Depends on:** nothing.

**Done when:** all 27 tables exist with correct constraints; a seed script runs cleanly from empty; the catalog tables contain the full item list per DATA_MODEL.md; the Drive connection authenticates without error; a test request with a valid token and valid role passes the middleware, and one with a missing or wrong role is rejected.

---

### Phase 1 — Auth, technician lifecycle, notifications, sync

**Builds:**
- `POST /api/auth/redeem-invite`, `POST /api/auth/revoke`, `POST /api/auth/generate-invite` (fails if technician.is_active = false).
- Technician lifecycle: `POST /api/dispatch/technicians`, `GET /api/dispatch/technicians`, `PATCH /api/dispatch/technicians/:id/deactivate`, `PATCH /api/dispatch/technicians/:id/reactivate`.
- Notifications infrastructure: the `notifications` table write path — a helper function other phases call when they need to create a notification, and `GET /api/notifications/mine`, `PATCH /api/notifications/:id/mark-read`.
- `GET /api/sync/changes?since=` — delta endpoint returning visits, notifications, chatMessages, corrections since the given timestamp.

**Depends on:** Phase 0.

**Done when:** a new technician is created, an invite code is generated, redeemed on a simulated device, and subsequent requests with that token are authenticated correctly; revoking the token blocks those requests immediately; deactivating a technician with an active visit produces a notification listing the orphaned visit id; reactivating the same technician restores is_active without creating a new row; the sync endpoint returns an empty delta when nothing changed since the last call, and a non-empty delta when a notification was created.

---

### Phase 2 — Addresses + PDF intake → visits

**Builds:**
- `POST /api/dispatch/parse-pdf` — with AI extraction real from the start, but the batch state machine built and tested against a manual stub first (see sequencing note below).
- `GET /api/dispatch/batch/:batchId/call/:index`, `POST /api/dispatch/batch/:batchId/call/:index/confirm`, `POST /api/dispatch/batch/:batchId/call/:index/skip`, `POST /api/dispatch/batch/:batchId/release-to-lobby`.
- Address normalization and near-match comparison modal: `POST /api/addresses/:id/resolve-comparison`.
- pdf_batches table fully wired: displacement cleanup on new parse-pdf, count verification on release, mismatch alert behavior.
- visit_systems rows created during confirm, sized to AI-detected system count.

**Recommended sequencing within the phase:** build the batch state machine (confirm/skip/release) with manually-entered draft fields first — the dispatcher fills them as if AI had pre-filled them. Verify the state machine, address comparison, and batch count verification are all correct. Then swap in real AI extraction. This separates two unrelated risks: "is the workflow correct" and "is the AI extraction accurate" — they should not be debugged simultaneously.

**Depends on:** Phase 0 (catalogs for refrigerant lookup on system creation), Phase 1 (dispatcher must be authenticated).

**Done when:** uploading a PDF produces N draft visits in pending_review; the dispatcher can step through each one, confirm or skip independently; releasing moves only this batch's confirmed visits to in_lobby simultaneously, leaving any other in-flight batch untouched; a near-duplicate address triggers the comparison modal and both resolution branches (create_new and merge) work correctly; starting a second parse-pdf cleans up any previously released batch.

---

### Phase 3 — Lobby, assignment, visit lifecycle

**Builds:**
- `GET /api/visits/lobby`, `POST /api/visits/:id/claim` (first-come-first-served, explicit error on race condition), `GET /api/visits/mine`, `POST /api/visits/:id/start`, `GET /api/visits/:id`.
- `PATCH /api/dispatch/visits/:id/reassign` — dispatcher direct assignment, the typical day-to-day operating mode. Also the resolution path for orphaned visits from technician deactivation.
- Server-enforced visit status state machine (pending_review → in_lobby → assigned → in_progress → completed/temporarily/cancelled).

**Depends on:** Phase 1 (technicians + auth), Phase 2 (visits must exist in in_lobby before any of this is testable with real data).

**Done when:** two simulated technicians racing to claim the same visit — exactly one succeeds and the other receives the documented "already claimed" error; dispatcher direct-assigns a visit to a specific technician, bypassing the Lobby entirely; the assigned technician sees the visit under "mine" with full context; status transitions are enforced correctly (can't start a visit that isn't assigned, can't claim one that isn't in_lobby).

---

### Phase 4 — Workspace & pricing engine

**Builds:**
- `PATCH /api/visits/:id/services` — including Cancel special case with confirmation flow and full deletion of items/services on confirm.
- `POST /api/visits/:id/items` — with catalog resolution of tech_supplied, companion/exclusion cascade via catalog_item_relations, and price validation for custom_price items.
- `DELETE /api/visits/:id/items/:itemId` — with companion cascade on removal.
- `PATCH /api/visits/:id/systems/:systemNumber`, `PUT /api/visits/:id/weigh-in/:systemNumber` (including factoryChargeUsed for Trane/Lennox nameplate selection).
- `POST /api/visits/:id/photos` — local capture only at this point; Drive upload wired in Phase 5 when completion is built.
- `PATCH /api/visits/:id/notes`.
- The server-side pricing engine (bundle rule, system-count multiplier, Cancel rule) — built once here, designed to be reused by Phase 6's dispatcher full-edit endpoint. Not duplicated.

**Depends on:** Phase 3 (a visit must be assigned before its workspace can be touched), Phase 0 (catalog data for pricing, refrigerant, tech_supplied).

**Done when:** a full visit can be built service-by-service through the API and its final price matches the current PWA's output on a representative test set: AC only, AC & Heat bundle, multi-system multiplier (3 systems), Finish + Weigh-In-Data addon, Temporarily label (no price change), and a Cancel applied over existing items (confirmation step fires, all items deleted, price zeroed); selecting HZ322 auto-creates its companion items; selecting a second zone board removes the first zone board and its companions.

---

### Phase 5 — Completion, transfers, offline behavior

**Builds:**
- `POST /api/visits/:id/complete` — status transition per selected service, inventory consumption (tech_supplied items from this visit deducted from technician's balance), dispatcher notification, Drive ZIP upload triggered (photos + report), auto-expiry of any pending transfer for this visit.
- `GET /api/visits/:id/report-preview`, `GET /api/visits/:id/download` — both generated on demand from current visit data, never stored as source of truth.
- Transfers: `POST /api/visits/:id/transfer/initiate`, `POST /api/transfers/:id/accept` (visit status left untouched, only technician_id changes), `POST /api/transfers/:id/reject`, `GET /api/transfers/pending/mine`.
- Client-side offline queue: countdown/manual-submit window pre-send, IndexedDB queue for offline, background retry on reconnect, success/failure icon on Reports card, distinct "downloaded not auto-sent" icon.

**Depends on:** Phase 4 — there is nothing to complete without services, items, and photos existing first.

**Done when:** completing a visit with tech-supplied items correctly reduces that technician's computed inventory balance; the Drive ZIP upload succeeds and stored_at is populated; an accepted transfer reassigns the visit without changing its status; if Tech1 completes before Tech2 responds, the pending transfer is marked expired and Tech2's notification clears automatically; completing while offline produces a downloadable JSON identical in shape to the online path, and it sends itself when connectivity returns.

---

### Phase 6 — History, full edit, inventory, restock

**Builds:**
- `GET /api/dispatch/history` (with filters), `GET /api/dispatch/history/address/:addressId`.
- `PATCH /api/dispatch/visits/:id` — full edit, reuses Phase 4's pricing engine. `GET /api/dispatch/visits/:id/edit-log`.
- `GET /api/inventory/mine`, `GET /api/dispatch/inventory`, `POST /api/dispatch/inventory/assign`.
- `GET /api/dispatch/restock-report`, `POST /api/dispatch/restock-report/mark-restocked` — writes to restock_records.
- Price anomaly detection: `GET /api/dispatch/pay-periods/:id/anomalies`.

**Depends on:** Phase 5 (real completed visits with real items to read history, inventory, and restock from).

**Done when:** editing any field of a completed visit from Dispatch recalculates its price correctly (using the same engine as Phase 4) and writes a readable edit_log entry with the correct source value; the restock total for a known accessory matches the manual sum of a known test set; an item priced outside its catalog range appears in the anomalies list.

---

### Phase 7 — Pay periods

**Builds:**
- `GET /api/dispatch/pay-periods`, `GET /api/dispatch/pay-periods/:id`, `POST /api/dispatch/pay-periods/close`, `PATCH /api/dispatch/pay-periods/:id/mark-paid`, `GET /api/pay/mine`.

**Depends on:** Phase 5 (gross amounts come from completed visit totals). Can run in parallel with Phase 6 — neither depends on the other.

**Done when:** closing a period for a known set of completed visits produces correct gross, 20% commission retained, and net for a non-owner technician, and gross-equals-net with zero commission for the owner; the period close is a manual dispatcher action and cannot be triggered automatically by date rollover.

---

### Phase 8 — Post-completion corrections

**Builds:**
- `POST /api/visits/:id/request-correction`, `PATCH /api/dispatch/corrections/:id/approve` (with pay-period cutoff check), `PATCH /api/dispatch/corrections/:id/reject` (stores optional dispatcher_note, notifies technician), `GET /api/dispatch/corrections`.
- corrections table fully wired to edit_log on approval (source: "correction_approved").

**Depends on:** Phase 5 (a visit must be completed before it can be corrected), Phase 7 (approval branches on pay-period cutoff date).

**Done when:** a correction approved before its period's cutoff is reflected in the current period; one approved after cutoff lands in the following period; the JSON, CSV, and Company-facing report all reflect the corrected data the next time they are generated, with no manual sync step; rejection stores the dispatcher_note and the technician receives a notification.

---

### Phase 9 — Chat

**Builds:**
- `GET /api/chat/direct/:technicianId`, `POST /api/chat/direct/:technicianId`, `GET /api/chat/broadcast`, `POST /api/chat/broadcast`, `POST /api/chat/:messageId/mark-read`, `GET /api/chat/broadcast/:messageId/read-receipts`.

**Depends on:** Phase 1 only (technicians + notifications). No dependency on visits, pricing, or any other domain — can be built entirely in parallel with Phases 2 through 8.

**Done when:** a direct message creates exactly one notification for its recipient; a broadcast from the dispatcher creates one notification per active technician; read receipts accumulate correctly as each technician opens the message; the sync endpoint (Phase 1) returns new chat messages in its delta response.

---

### Phase 10 — Technician settings & price overrides

**Builds:**
- `GET /api/technicians/me/settings`, `PATCH /api/technicians/me/settings` (theme, AI provider, API keys).
- `GET /api/technicians/me/price-overrides`, `POST /api/technicians/me/price-overrides`, `DELETE /api/technicians/me/price-overrides/:itemName`.
- Catalog editing endpoint: `PATCH /api/dispatch/catalog/:table/:id`.

**Depends on:** Phase 1 (auth, technician rows exist), Phase 6 (for meaningful price override testing against real visit pricing data).

**Done when:** a technician's theme preference persists across sessions; a price override for a specific item is respected when that technician creates a visit_item, and falls back to catalog default when the override is deleted; the dispatcher can update a pesp value in catalog_equipment and the change is reflected in subsequent visits without affecting historical ones.

---

## 5. Parallelization notes

Two tracks can run fully independently of the main sequence:

**Chat (Phase 9)** depends only on Phase 1. If a second workstream is available, this is the natural candidate — it touches none of the visit/pricing/completion domain and can be verified in complete isolation.

**Technician settings (Phase 10)** depends on Phase 1 and Phase 6. It's the least operationally critical feature for the first working system, so it naturally lands last without blocking anything.

Within the main sequence, **Phase 6 and Phase 7 can run in parallel** — both depend only on Phase 5 and not on each other. History/inventory/restock and pay periods are independent domains that happen to share the same upstream dependency.

---

## 6. Notes for CC

- Never duplicate the pricing engine. It is built once in Phase 4 and reused in Phase 6's dispatcher edit. If you find yourself writing pricing logic a second time, stop and extract a shared function.
- The catalog is the single source of truth for refrigerant, tech_supplied, companion/exclusion rules, and pricing defaults. No hardcoding of catalog values in endpoint logic — always read from the catalog tables.
- Visit status transitions are server-enforced. The client sends an intent ("complete this visit"), not a status value. The server resolves the correct outcome status based on the selected service.
- The Google Drive upload in Phase 5 is part of the completion flow but should be decoupled enough to retry independently if the upload fails while the visit completion itself succeeded — don't roll back a completed visit because Drive was temporarily unreachable.
- PDF batch state machine (Phase 2): build and verify the workflow logic against manual input before connecting the AI extraction. These are two separate risks and should not be debugged together.

---

*Document version 1.0 — gaps A–G resolved, 27-table schema, Google Drive photo storage, polling sync, technician lifecycle, dispatcher direct-reassignment, and corrections flow.*
