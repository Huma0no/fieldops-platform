# FieldOps Report Snapshot Contract

**Status:** Proposed functional and technical contract; documentation only.
**Date:** 2026-11-11

**Proposed Design:** Each substantive statement below is labeled **Established Requirement**, **Existing Implementation**, **Proposed Design**, or **Unresolved Decision**. Established requirements are authoritative for this contract. Existing implementation describes inspected code/schema, not a claim of compliance.

## 1. Purpose and Scope

- **Established Requirement:** Define how FieldOps generates exactly one historical Report for each Service, preserves it, finalizes its Service, and delivers it to Dispatch. A Property is not finalized by these operations.
- **Established Requirement:** Property Service History Context is future and out of scope. No history browsing capability is specified or implemented by this document.
- **Proposed Design:** Treat a Report as a frozen record attached to one Service/Visit; treat its submission/delivery state separately from the Report content and the Service lifecycle.
- **Proposed Design:** Reuse the current `completion_submissions` concept and local completion outbox. Do not add a generic event log, queue service, or report-version system unless an unresolved decision later demonstrates a need.

## 2. Authoritative Operational Model

- **Established Requirement:** A Property is a physical address that can receive an unlimited number of Services. It is never permanently closed to new Services.
- **Established Requirement:** Dispatch creates a Service and assigns it or places it in the Lobby. FieldOps receives or claims it, performs work, reviews a preview, and explicitly confirms Send Report. Only that confirmation creates the definitive Report snapshot and finalizes that Service.
- **Established Requirement:** A Report is sent to Dispatch, which stores it under its Property. Delivery acknowledgment is separate from Property lifecycle; it must not close the Property.
- **Established Requirement:** A later Service at the same Property is an independent operation. Different technicians may perform different Services there. Technician attribution belongs to each Service/Report, never to the Property.
- **Existing Implementation:** The established Visit state journey is `pending_review` → `in_lobby` → `assigned` → `in_progress` → `completed` / `temporarily` / `cancelled`. `POST /api/visits/:id/complete` applies the terminal outcome (`src/routes/completion.js:120-334`).
- **Existing Implementation:** The API currently handles server persistence and ACK in one process/database. No separate Dispatch report-ingestion or human report-approval endpoint was found. Here, “Dispatch stores/accepts” means the server-side persisted completion and its ACK unless the product explicitly establishes a later review stage.

### Review and final submission workflow

- **Established Requirement:** The technician's workflow is Workspace → Review → Workspace (optional edits) → Send Report → Final Confirmation → Submission/Delivery. Review is a preview of the current draft. The technician can return to Workspace, change any information, and reopen Review; the new preview reflects those changes.
- **Established Requirement:** Final Confirmation displays: “Once submitted, this report cannot be modified.” Its actions are “Return to Review” and “Send Report.” Canceling returns to Review without creating a definitive submission or finalizing the Service.
- **Established Requirement:** Only the explicit final Send Report confirmation creates and persists the definitive immutable local snapshot, authorizes Service finalization, and registers its pending delivery. The server-side Visit becomes terminal only when it accepts that same snapshot and commits the completion transaction. Once submitted, that Report cannot be silently edited or replaced. The Property remains open for future Services.
- **Established Requirement:** Opening Review must not finalize the Service, create an accepted Report, or freeze/persist a definitive submission. A transient preview representation is allowed, but it is not the Report record or outbox item.
- **Established Requirement:** Review displays the current Workspace draft using locally available catalog and pricing data, including while offline. It remains non-persisting. Final confirmation creates the definitive local snapshot and pending outbox record from the reviewed values.
- **Proposed Design:** Use the same report projection/formatting rules for Review and final Report rendering, with Review consuming an ephemeral projection of the current editable Workspace draft and final submission consuming the confirmed values. Final confirmation must submit the exact values represented by the last Review; any draft change invalidates that preview and requires Review again. Snapshot-only fields such as accepted identity/time may be attached at confirmation if they are not presented as report content.
- **Existing Implementation:** Workspace currently opens `openGenerateModalDirect()` with a brief Service/items/total/photos summary, then its “Submit report” action persists a draft and calls `createPendingCompletionSubmission()` followed by delivery (`frontend/pwa/src/screens/workspace.js:1278-1330`). There is no separate complete Review screen or final confirmation step. The definitive snapshot is created before network delivery at that submit action.
- **Existing Implementation:** `generateReportJSON()` / `generateReportText()` render from database rows by Visit ID, including current mutable address, Visit children, assignment, and address-keyed Weigh-In values (`src/services/report.js:70-239`). They do not accept a Workspace draft/projection. The existing Reports screen “View report” is a post-submission view, not a pre-submission Review (`frontend/pwa/src/screens/reports.js`). Therefore the current generator cannot be called unchanged to preview an unsaved draft, and its current output can differ from the future definitive snapshot.
- **Proposed Design:** Refactor around one shared, side-effect-free Report projection/formatter that can render an ephemeral Workspace preview and a confirmed snapshot. Do not invoke completion, insert `completion_submissions`, or mutate terminal Visit state during Review. Server validation remains authoritative, but must validate against—not silently replace—the previewed report content. If validation fails or any material user-visible value differs from the locally reviewed snapshot, reject acceptance and roll back the entire completion transaction.
- **Established Requirement:** A validation rejection creates no accepted Report row and does not finalize the server-side Service. The exact original snapshot remains intact in the local outbox and is clearly marked `correction_required`, preventing automatic redelivery. The technician must be told that the submission needs correction and must explicitly review/confirm a corrected payload before another attempt. Never silently overwrite the rejected immutable snapshot.
- **Proposed Design:** Bind each immutable request payload to one idempotency key. On a definitive server rejection, retain the rejected payload as a non-deliverable local attempt and create a corrected attempt with a fresh submission ID only after explicit technician action. Do not add a separate `report_id`: the one accepted submission ID is the canonical Report ID, and rejected attempts are not Reports. Exact retries of either attempt always preserve that attempt's original payload.
- **Existing Implementation:** The completion route already encloses submission-row insert, work application/pricing, terminal status update, and generated response in one transaction (`src/routes/completion.js`, completion handler). A thrown validation error rolls back these writes. Current `applySnapshotWork()` resolves some client values to catalog prices rather than rejecting visible differences, so the required compare-and-reject behavior is not yet present.

## 3. Entity Relationships

- **Established Requirement:** `Property 1 ── many Services`; `Service 1 ── 1 Report`; `Report 1 ── 1 originating technician`. These cardinalities do not make the Property itself a work item.
- **Existing Implementation:** `addresses` represents Property. Each `visits` row references one address; there is no uniqueness constraint limiting visits per address (`src/db/schema.sql:170-196`). Dispatch manual creation resolves or creates an address, then creates a Visit (`src/routes/dispatch.js:223-287`). Therefore a Visit is the current data-model counterpart to a Service.
- **Existing Implementation:** `completion_submissions` references a Visit and technician and stores a JSON snapshot (`src/db/schema.sql:198-208`, migration `src/db/migrations/023_completion_submissions.sql:5-15`). The FK chain `completion_submissions.visit_id → visits.id → visits.address_id` associates a submission with a Property.
- **Existing Implementation:** The `submission_id` primary key is stable identity for a delivery attempt; there is no separate `report_id` today and no database uniqueness constraint on `completion_submissions.visit_id`.
- **Proposed Design:** Use one stable identifier for both the Report and its submission: `reportId = submissionId`. This satisfies unique Report identity and stable delivery idempotency without creating a second ID or identity mapping. Add `UNIQUE (visit_id)` to enforce exactly one accepted Report per Service.
- **Unresolved Decision:** If another system requires an independent Report ID distinct from the idempotency key, establish that integration contract before adding a second identity.

## 4. Report Generation Contract

### Preconditions and validation

- **Established Requirement:** Generate Report is valid only for the currently assigned technician and a Service in `assigned` or `in_progress`. Ownership and state must be checked again while holding the Service/Visit row lock.
- **Existing Implementation:** The completion route checks the authenticated technician against the Visit before and after `SELECT ... FOR UPDATE` (`src/routes/completion.js:162-200`). It accepts active statuses `assigned` and `in_progress` (`:223-235`).
- **Established Requirement:** A valid non-cancelled Report has a selected supported service and validated work data. A Cancel Report requires notes or an answered checklist item; cancellation clears ordinary service/item work and records a $0 cancelled outcome.
- **Existing Implementation:** The frontend validates service selection and Cancel justification (`frontend/pwa/src/lib/completion-submission.mjs:47-64`). The server checks for a service, validates catalog service/item/category, item uniqueness, custom descriptions, quantities, prices, and Cancel justification (`src/routes/completion.js:238-277`; helper `applySnapshotWork` at `:15-117`). Server-side catalog pricing is resolved rather than trusting ordinary submitted prices.
- **Established Requirement:** The Report's technician is the authenticated technician who generates it for the currently assigned Service. Preserve the authenticated technician ID and display name as recorded at acceptance, as well as original content and generation/acceptance timestamps; later profile changes must not alter these historical fields. Property-level technician state must not determine Report authorship.
- **Existing Implementation:** The accepted row stores `req.technician.id` as `technician_id` (`src/routes/completion.js:267-272`). The snapshot's technician claim is compared with authenticated identity (`:156-159`). Middleware resolves `req.technician.name` from the technicians row during authentication (`src/middleware/auth.js:14-26`), but the accepted snapshot/report renderer does not preserve the acceptance-time display name as a historical field.
- **Proposed Design:** Within the acceptance transaction, take technician ID and display name from server-controlled authenticated/database state and freeze both in the accepted snapshot. The client may not supply either as proof of authorship. Preserve the snapshot generation timestamp and server `accepted_at` as the acceptance timestamp.
- **Established Requirement:** The accepted Report preserves the authenticated technician ID and the technician display name as recorded at acceptance, along with original Report content and generation/acceptance timestamps. These fields remain stable if the profile later changes.
- **Proposed Design:** Resolve technician ID/name from authenticated server state within the acceptance transaction; copy both into the accepted snapshot and submission row as appropriate. Never use a client-supplied technician ID/name as proof of authorship. Preserve the local snapshot's generation timestamp as report metadata and use the server's acceptance timestamp as the authoritative acceptance time.
- **Established Requirement:** Every Report has a stable, non-empty submission identifier. Retries reuse it exactly.
- **Existing Implementation:** The PWA creates a UUID (with fallback) and stores it in both the pending record and snapshot (`frontend/pwa/src/lib/completion-submission.mjs:17-21, 66-90`). The server accepts legacy completion requests without a submission ID and then does not create a `completion_submissions` row (`src/routes/completion.js:141-160, 267-274`).
- **Proposed Design:** Require a submission ID for Report generation. Preserve a legacy compatibility path only if it cannot finalize a Service without creating/recoverably identifying its one Report; otherwise remove that path as part of implementation.

### Creation, finalization, and atomicity

- **Established Requirement:** Report creation and Service finalization must be atomic from the shared database's perspective. The system must never commit a terminal Service without a recoverable Report, or create multiple Reports for one Service because of retries or repeated user actions.
- **Existing Implementation:** In a transaction, the route locks the Visit, inserts `completion_submissions`, applies snapshot work, updates Visit terminal status and timestamps, expires pending transfers, generates the response, and commits (`src/routes/completion.js:183-309`). Errors roll back and release the client. This is a useful atomicity boundary: report row plus Service finalization and source-work effects commit or roll back together.
- **Proposed Design:** Retain one server transaction with this ordering: lock Service; validate current state and technician; detect an existing accepted Report; validate and normalize the snapshot; insert the immutable Report row; persist any Service source effects required by existing operational consumers; finalize Service; commit. The database uniqueness constraint on `visit_id` is the final one-Report guard, in addition to the row lock and terminal-state check.
- **Established Requirement:** Compare server-authoritative validation results with the immutable submitted snapshot before commit. A validation error or material report-visible difference rolls back the submission row and every source-work/status/transfer effect in the same transaction, returns a correction-required response, and leaves the Service active. It must not acknowledge the submission or create an accepted Report.
- **Proposed Design:** Compare the final user-visible Report projection, not incidental JSON serialization. Current code may resolve catalog prices and write operational rows inside the transaction; it must reject any material price/content difference and roll back before `COMMIT` rather than silently replacing the reviewed value.
- **Established Requirement:** A retry with the exact accepted submission ID returns the same logical acknowledgment without repeating effects. A different ID must never be reported as the accepted ID or marked delivered by that ACK.
- **Existing Implementation:** The server checks an existing row by `submission_id`; terminal Visits reject an unknown ID with 409; recovery after 23505 checks the exact ID and propagates unmatched errors (`src/routes/completion.js:202-230, 335-400`). The PWA verifies ACK ID, but then marks other pending IDs for that Visit delivered with the first ACK (`frontend/pwa/src/lib/completion-submission.mjs:139-165`).
- **Existing Implementation:** The route checks current Visit ownership before looking up the accepted submission (`src/routes/completion.js:162-220`). If a completed Service is later reassigned, the original technician's exact retry can receive 403 even though the accepted row still identifies that technician.
- **Proposed Design:** Exact same-ID retry returns the stored Report and ACK. A different ID for a Service that already has a Report returns a conflict identifying that the Service already has its Report; it does not generate another Report or ACK that new ID. If client recovery discovers an existing Report after losing its ID, return the canonical existing Report/submission identity and require the client to reconcile to that identity explicitly.
- **Proposed Design:** Resolve an authenticated exact retry against the immutable accepted row using the full `(submission_id, visit_id, technician_id)` identity before applying current-assignment rules for a new generation. An old technician can only receive the acknowledgment/report for that exact Report attributed to them; this does not permit them to create or edit a Report after reassignment.
- **Established Requirement:** A repeated Generate Report action while the original submission is pending must not overwrite that immutable snapshot. An accepted Report cannot be regenerated from mutable Service state.
- **Existing Implementation:** `createPendingCompletionSubmission` may reuse the Visit's pending ID and rebuild/save a different snapshot (`frontend/pwa/src/lib/completion-submission.mjs:93-116`). This violates the existing Offline-First Contract's immutable pending snapshot rule.
- **Proposed Design:** The UI resumes the exact pending snapshot; it does not rebuild it from the draft. Once a Report is pending or accepted, another generation for the same Service cannot mutate it or create another accepted Report.
- **Proposed Design:** After a definitive validation rejection, retain the rejected immutable attempt, show the technician why it needs correction, allow Workspace edits and a fresh Review, then create a corrected attempt with a fresh submission ID only after explicit confirmation. Exact retries always preserve their attempt payload. Do not add a separate `report_id`; the one accepted submission ID is the canonical Report ID, and rejected attempts are not Reports.

### Failure and recovery

- **Established Requirement:** Before network delivery, the generated Report must exist as a durable local pending snapshot. Transport failure must preserve it unchanged. If the server transaction rolls back, the Service remains non-terminal and the same pending Report can retry. If the commit succeeds but the response is lost, retrying the same ID returns the accepted Report.
- **Existing Implementation:** The PWA stores a pending record before delivery, and request errors save retry metadata while retaining `snapshot` (`frontend/pwa/src/lib/completion-submission.mjs:93-116, 139-174`). Server-side transactional changes roll back together (`src/routes/completion.js:305-310`).
- **Proposed Design:** Keep the client record pending until an explicit matching ACK. Treat a 23505 as successful recovery only when the exact submission and Service/technician identity exist; otherwise propagate the original database error. The current route follows this exact-identity recovery shape.
- **Established Requirement:** Notification failure must not roll back an already committed Report/Service; notification is a downstream effect, not the Report persistence boundary.
- **Existing Implementation:** Completion notifications are issued after commit and are described as soft failures (`src/routes/completion.js:312-330`).

## 5. Immutable Snapshot Definition

### Contract fields

- **Established Requirement:** The snapshot freezes the Report as it was generated, including Service identity, Property/address representation, original technician attribution, supported Report/service outcome, operational work and evidence references, generation time, schema version, and stable Report/submission identity.
- **Existing Implementation:** `createCompletionSnapshot` currently serializes `version`, `submissionId`, `visitId`, `technicianId`, `address`, `workType`, `createdAt`, `terminalIntent`, `cancel`, `service`, `items`, `weighInData`, `systems`, `notes`, `checklistAnswers`, `evidenceRefs`, and `totalPrice` (`frontend/pwa/src/lib/completion-submission.mjs:66-90`). `completion_submissions.snapshot` stores JSONB (`src/db/schema.sql:198-205`).
- **Existing Implementation:** The current generated JSON report includes Visit/order/date/time/status/completion time/technician/price/multi-system flag, address fields, system equipment fields, service and item details, photo slugs, and Weigh-In measurements (`src/services/report.js:137-239`).
- **Existing Implementation:** Current source fields include system indoor/outdoor/coil model and refrigerant (`visit_systems`, selected at `report.js:151-155`); service name/modifiers/price; item name/category/description/quantity/resolved price/tech-supplied; notes/checklist; and the measurements selected at `report.js:169-175`.
- **Proposed Design:** Normalize the accepted Report snapshot to include every user-visible field from both current renderers: (1) `reportId`/`submissionId` (same stable value); (2) schema version; (3) Visit/Service ID, order number, scheduled date/time, terminal status and completed time; (4) Property ID and address fields at generation; (5) authenticated technician ID and acceptance-time display name; (6) generation and server acceptance timestamps; (7) total price and multi-system flag; (8) system number/equipment model/refrigerant fields; (9) service name, finish/temporary flags and price; (10) item name/category/description/quantity/price/tech-supplied; (11) photo slug/category references and stable evidence manifest; (12) all Weigh-In fields rendered by JSON; and (13) notes and checklist answers/report text findings used by the text renderer. Compare the final formatted report-visible values, not merely raw JSON field presence.
- **Proposed Design:** Derive Report “type” from the already-supported selected service (`Prestart`, `AC`, `Heat`, `AC & Heat`, `Drive Run`, `Cancel`, etc.) and report status from the terminal intent. Do not add an invented taxonomy when current service name and terminal state already express the concepts.
- **Proposed Design:** Capture `propertyId`, generation-time address, and stable technician ID/name from server-side Service/property/technician records when accepting the snapshot. Keep client-supplied snapshot values for work content only after validation; do not trust the client to set accepted authorship or canonical address identity. Reject rather than silently normalize a material report-visible value mismatch.
- **Proposed Design:** Use a serialized JSONB snapshot in the existing completion record as the minimal fit. It matches the existing payload and migration, supports versioning via `version`, and avoids adding a separate report version tree. Enforce write-once behavior for accepted rows in the application; add a database-level update/delete guard only if the existing DB role/permissions cannot guarantee the write-once rule.

### Supported vs. missing data

- **Existing Implementation:** Service ID, technician ID, address values, work type, generation timestamp, service outcome, service data, items, systems, Weigh-In payload, notes, checklist answers, total, and a version number are present in or available to the current snapshot/report paths.
- **Existing Implementation:** `propertyId` is not included in the client snapshot; report ID is not separate from submission ID; no technician display name, explicit report type, or explicit report status field exists in the snapshot; the Report renderer instead reads current Visit fields. These are not all new concepts: Property ID can come from `visits.address_id`, report type from selected service, status from terminal intent, and one shared report/submission ID avoids redundant identity.
- **Existing Implementation:** Photo data in the report output consists of photo slugs/category references from `visit_photos`; the completion snapshot's `evidenceRefs` is not a validated, complete photo manifest. Current upload stores metadata with `stored_at = null`; the server route does not persist uploaded image bytes (`src/routes/workspace.js:543-589`, `src/db/schema.sql:265-275`).
- **Proposed Design:** Freeze every field the Report actually presents and its exact evidence manifest. Preserve photo identity and association by Service and Report ID; do not imply that a slug/reference contains the image bytes.
- **Unresolved Decision:** Whether every photo is required evidence, and whether Dispatch may acknowledge a Report while some optional evidence bytes are still uploading, is not settled by the existing Offline-First Contract.

## 6. Outbox and Delivery Contract

- **Established Requirement:** The local outbox holds the exact immutable Report snapshot before any delivery attempt. Every retry sends the same bytes/values and stable submission ID; attempts, timestamps, and error text may change without mutating snapshot content.
- **Existing Implementation:** IndexedDB has `completionSubmissions` records with lifecycle and snapshot; `getPendingCompletionSubmissions` retrieves pending records (`frontend/pwa/src/lib/db.js:383-419`). The current generator can overwrite a pending snapshot, so this requirement is not met yet (`completion-submission.mjs:93-116`).
- **Established Requirement:** Dispatch/server recognizes repeated delivery by stable submission identity. ACK applies only to the same report/submission identity. Network or server errors retain pending data.
- **Existing Implementation:** Server primary key `submission_id` and exact retry lookup provide the idempotency anchor (`src/db/schema.sql:198-208`; `src/routes/completion.js:202-220`). Client checks `acknowledged === true` and matching `submissionId` (`frontend/pwa/src/lib/completion-submission.mjs:139-147`) but also cross-marks other pending IDs for that Visit (`:148-153`).
- **Proposed Design:** Local submission states are `pending`, `correction_required`, and `delivered`; active editable work remains the distinct LocalVisitDraft state, not an outbox state. Pending includes network failure, retryable server error, and evidence awaiting upload when required. A definitive content-validation rejection marks the immutable attempt `correction_required`, preventing automatic redelivery while retaining its payload. `delivered` is set only on the exact Report ACK. Keep `attempts`, `lastError`, and `lastAttemptAt` as metadata, not new lifecycle states.
- **Established Requirement:** HTTP 401/revoked authentication stops further authenticated sends until the original technician restores a session. It must not delete or retag local data.
- **Existing Implementation:** `request()` clears session and dispatches `auth:expired` on 401; app stops registered retry triggers and keeps IndexedDB (`frontend/shared/api.js:25-45`; `frontend/pwa/app.js:63-74, 110-114`). A retry loop already running does not re-check session between records (`completion-submission.mjs:181-203`). The upload helper does not emit the same expiry event (`frontend/shared/api.js:64-87`).
- **Proposed Design:** Stop the in-flight retry batch after the first 401, preserve every pending snapshot, and only restart after authentication for the same technician is restored. Upload requests must use the same auth-expiry behavior.
- **Proposed Design:** Do not add a queue service or dispatch-specific infrastructure: persist the local outbox in the existing IndexedDB store and acceptance/idempotency in the existing PostgreSQL completion record.

## 7. Photo and Evidence Contract

- **Established Requirement:** A photo becomes part of a Report when captured and selected/retained as evidence for that Service's Report. Its Service/Report association must be frozen in the Report evidence manifest.
- **Existing Implementation:** The current photo route inserts a `visit_photos` metadata row linked to Visit, including system number, slug, tag, label, category, and `stored_at`, but does not store the multipart image bytes (`src/routes/workspace.js:543-589`; `src/db/schema.sql:265-275`). Workspace capture uploads immediately; on failure it logs and returns without persisting the Blob (`frontend/pwa/src/screens/workspace.js:959-979, 1103-1118`).
- **Existing Implementation:** IndexedDB exposes `addPhoto`, `getPhotosForVisit`, and `deletePhotosForVisit` with Blob-capable storage (`frontend/pwa/src/lib/db.js:438-461`), but inspected Workspace capture does not use these methods.
- **Established Requirement:** Offline capture and failed upload must not silently lose a required image or remove its Report association. The exact generated snapshot must retain an evidence manifest until delivery is resolved.
- **Proposed Design:** Persist the compressed Blob and metadata locally before attempting upload. Keep the local object until upload is explicitly acknowledged; associate its stable photo identity with the Service and frozen Report manifest. Retry the existing upload path when online. Do not mark required evidence complete or Report delivered until its bytes are safely stored according to the decision below.
- **Proposed Design:** For evidence not required for acceptance, allow Report ACK while its local image remains pending, but continue preserving the frozen manifest and Blob until upload success. Do not lose the distinction between Report ACK and evidence upload status.
- **Unresolved Decision:** The existing Offline-First Contract says evidence upload may retry independently and leaves open whether every required upload must finish before terminal submission ACK. Product must identify which categories are required before implementation. The minimum durable-blob rule applies either way.

## 8. Historical Ownership and Reassignment

- **Established Requirement:** Technician A's completed Service Report remains frozen and attributed to A if the Service is later reassigned or another Service is created at the same Property. A later Service assigned to B produces a separate Report attributed to B.
- **Existing Implementation:** `completion_submissions.technician_id` and `snapshot` retain the accepted author/payload. However `generateReportJSON` selects current `visits.technician_id` and current Visit/Property data (`src/services/report.js:137-185`). Dispatch reassignment can update the assignee for any status, including terminal, without modifying the completion record (`src/routes/visits.js:327-368`).
- **Existing Implementation:** Weigh-In rows are unique by `(address_id, system_number)` and are upserted by later completions (`src/db/schema.sql:245-263`; `src/routes/completion.js:77-100`). Report rendering reads those rows by address (`src/services/report.js:169-175`), so a later Service may change the displayed measurements of an earlier Report.
- **Proposed Design:** Render historical Reports from their accepted snapshots, never from current Property assignment or later Service data. Keep the operational Visit mutable only through its authorized lifecycle/correction workflows; those workflows must not rewrite accepted Report snapshots.
- **Proposed Design:** Attribute the Report using the authenticated technician stored at acceptance. Do not store technician ownership on Property or recalculate a historical Report author from the Visit's current assignment.
- **Established Requirement:** A new Service at the same Property is independent and may belong to another technician. Its report content and author must not be joined into or substituted for an older Service's report.

## 9. Database Constraints

| Concern | Existing implementation | Proposed minimum |
|---|---|---|
| Property / Service relationship | **Existing Implementation:** `visits.address_id` is a non-null FK to `addresses`; no one-Visit-per-address constraint (`schema.sql:170-196`). | **Proposed Design:** Keep one-to-many. Do not add a closure state or uniqueness on address. |
| Service / Report cardinality | **Existing Implementation:** `completion_submissions.visit_id` is an FK with a non-unique index; route terminal-state/row-lock logic currently enforces one accepted submission in normal requests (`schema.sql:198-208`; `completion.js:183-230`). | **Proposed Design:** Add `UNIQUE (visit_id)` so database integrity enforces one accepted Report per Service, including races and alternate writers. |
| Report/submission identity | **Existing Implementation:** `submission_id` is primary key; duplicate ID is unique; `snapshot` is `jsonb NOT NULL` (`schema.sql:198-205`). | **Proposed Design:** Keep one stable identifier as both report ID and submission ID. Require it for every generated Report. |
| Report author | **Existing Implementation:** `technician_id` is non-null FK and route inserts the authenticated technician (`schema.sql:202`; `completion.js:267-272`). | **Proposed Design:** Keep the immutable accepted author in the Report snapshot/row; do not derive historical attribution from current Visit assignment. |
| Report content immutability | **Existing Implementation:** Snapshot is stored on insert; schema does not prevent update/delete. No normal route updating accepted rows was found. | **Proposed Design:** Treat accepted row as insert-only in application code. If database-level protection is required by the deployed DB role, add the narrowest update/delete guard after inspecting role permissions. |
| Terminal intent | **Existing Implementation:** Check allows `completed`, `temporarily`, `cancelled` (`schema.sql:203`). | **Proposed Design:** Retain this check and align accepted `terminal_intent` with the finalized Service outcome. |
| Property-level measurements | **Existing Implementation:** Weigh-In is unique by `(address_id, system_number)` (`schema.sql:245-263`). | **Proposed Design:** Freeze the exact measurement values into each Report snapshot. Any later normalization of operational Weigh-In ownership is separate and needs a demonstrated requirement; do not make it a prerequisite to snapshot correctness. |

## 10. Lifecycle and State Transitions

- **Established Requirement:** Service, Report, delivery, and Property lifecycles are distinct. Service finalization is not Property closure. Report generation is not the same event as Dispatch acknowledgment.

- **Proposed Design:** The transitions are:

  ```text
  Service:     pending_review → in_lobby → assigned → in_progress → completed | temporarily | cancelled
  Report:      absent → preview (ephemeral) → definitive snapshot after confirmation → accepted historical record
  Submission:  pending → delivered (matching Dispatch/server ACK)
  Property:    remains open; may accumulate additional Services indefinitely
  ```

- **Existing Implementation:** FieldOps owns the active Service work and current Generate Report request; server completion persists a snapshot and terminal Visit state transactionally. Current API response is the server ACK. There is no separately observable Dispatch review state.
- **Proposed Design:** Final confirmation creates the immutable local snapshot and pending submission; that durable pair is the local recovery boundary. On server receipt, a single transaction accepts the exact snapshot, inserts the one Report record, applies the accepted Service work and terminal outcome, then commits. The matching ACK moves only that local submission to delivered. A failed/unknown request stays pending; a committed-but-lost response is recovered by same-ID retry. The shared Service is terminal only when the server transaction commits, and can never be committed terminal without its recoverable Report row.
- **Proposed Design:** A Service with a submitted Report cannot return to active work through ordinary editing. A later Property issue is a new Service, not a new Report for the old Service. Corrections remain a separate operational/audit mechanism; applying one must not silently rewrite the frozen Report snapshot or its presentation.
- **Established Requirement:** The completion ACK confirms server persistence/delivery to Dispatch. No separate human Dispatch review or acceptance step is part of this workflow; the Review and final confirmation described above are performed by the FieldOps technician before submission.

### Request correction assessment

- **Verified Existing Behavior — UI:** FieldOps Reports shows “Request correction” for a completed visit. The modal requires nonblank free text and offers Cancel / Submit request with inline errors, but no separate confirmation dialog (`frontend/pwa/src/screens/reports.js:383-413`; `frontend/pwa/src/components/correction-modal.js`).
- **Verified Existing Behavior — endpoint and authorization:** `POST /api/visits/:id/request-correction` requires technician role, a message, a terminal Visit, and current assignment to that technician. It creates a separate correction row and sends notifications to active Dispatchers/Owners (`src/routes/corrections.js`).
- **Verified Existing Behavior — persistence/repeat:** `corrections` stores Visit ID, initiator, origin, message/note, status, requested/applied times, and before/after audit state (`src/db/schema.sql`, corrections migration series). The API checks for an open correction before insert, but this check and insert are not in one transaction and no unique constraint enforces it, so concurrent requests could create multiple open rows. After a correction is applied/expired, another request can be created.
- **Verified Existing Behavior — Dispatch processing:** Dispatch has a queue, Finder, detail/editor, and Apply API. Apply locks the correction and Visit, validates changes, updates terminal Visit/Property/child operational records in a transaction, records before/after state, marks the separate correction applied, writes `edit_log`, and may create a pay-period adjustment. Correction detail reads a live operational `visitSnapshot`; evidence is read-only and image preview is unavailable.
- **Verified Existing Behavior — original Report:** Apply does not directly update `completion_submissions.snapshot`. However, it mutates source rows used by the current report generators, so the currently presented historical report can change. The correction remains a separate operational/audit row, but the current report read path does not preserve the original presentation.
- **Classification:** **Partially implemented.** Request, authorization, persistence, Dispatch processing, and audit exist. The immutable historical Report requirement is not satisfied by the current rendered output. This is not UI-only or unimplemented.
- **Established Requirement:** Preserve the existing Request correction mechanism. Applying a correction must not alter the accepted Report snapshot or its historical presentation. Do not replace or redesign correction processing.
- **Proposed Design:** Render original Report presentation from the accepted immutable snapshot so existing Apply operations cannot alter its content or technician attribution. Keep corrected operational state in the correction's existing before/after audit record; do not silently regenerate the submitted Report.
- **Established Requirement — FUTURE UI DECISION:** Showing the immutable original Report alongside correction before/after information in Dispatch is not required for Package 1. The concurrent-open-correction issue is a separate known defect and out of scope.

## 11. Current Implementation Assessment

### Retain

- **Existing Implementation:** `visits` already represents a Service with one Property link, current assignee, lifecycle status, and child work records.
- **Existing Implementation:** `completion_submissions` already stores stable submission ID, Service ID, authenticated technician ID, terminal intent, accepted snapshot, and acceptance time.
- **Existing Implementation:** Completion already locks the Visit and atomically commits the submission row, Service source effects, and terminal state. This is the right transaction boundary to preserve.
- **Existing Implementation:** The PWA already creates a versioned snapshot and pending outbox before delivery, checks explicit matching ACKs, and preserves retry metadata.
- **Existing Implementation:** Existing report/service formatting, catalog validation/pricing, exact-ID recovery, and local technician ownership checks are reusable.
- **Existing Implementation:** The Workspace submit modal is not the required Review → final confirmation flow: it summarizes only selected fields and creates the outbox snapshot directly from the draft when “Submit report” is selected. No explicit irreversible-submission confirmation is shown.
- **Existing Implementation:** Existing report generators are database/Visit based and do not provide an unsaved draft preview. Reusing them unchanged would not accurately preview current Workspace state.
- **Existing Implementation:** Request correction is more than a UI-only feature: technician UI, authenticated endpoint, `corrections` persistence, dispatcher queue/detail/Apply UI and API, transaction, before/after state, edit log and notifications exist. It is only partially compliant with immutable historical Reports: Apply edits the terminal Visit's source columns/child records and may update Property address or address-keyed Weigh-In; the accepted `completion_submissions.snapshot` row is not directly updated, but current Report rendering rereads those mutable records and can therefore change the apparent original Report.

### Correct or add

- **Existing Implementation:** One Report per Service is enforced only through route locking/status flow; no `UNIQUE (visit_id)` constraint exists. Legacy requests can finalize without a submission/report row.
- **Existing Implementation:** Pending snapshot creation can overwrite the snapshot under a reused ID; successful delivery can mark different IDs delivered from one ACK.
- **Existing Implementation:** The server report generator renders current mutable Visit data, uses current assignee, and reads address-level Weigh-In. It does not render the accepted snapshot.
- **Existing Implementation:** Photo blobs are not persisted by Workspace capture; server persists only photo metadata with no stored image path. Upload failure has no offline retryable blob.
- **Existing Implementation:** A completion retry batch can continue after a 401, and photo upload 401 does not trigger the shared auth-expiry handling.
- **Proposed Design:** Group the main corrective work around two roots: (1) one immutable accepted Report per Service with atomic finalization and historical rendering; (2) exact durable local delivery of that Report, including evidence and auth interruption. The report-cardinality correction does not require multiple reports per Service or closing a Property.

## 12. Recommended Implementation Packages

### Package A — Authoritative per-Service Report snapshot

- **Proposed Design:** Before adding `UNIQUE(visit_id)`, audit accepted submission rows for duplicate Visits and terminal Visits with no submission row. Abort the migration if duplicates exist; preserve all rows and require explicit record-level adjudication rather than silently deleting, merging, or choosing a canonical row. Do not synthesize historical snapshots for legacy no-ID completions because original content/identity cannot be proven from mutable current rows; keep them explicitly legacy and do not represent a reconstructed view as an immutable accepted Report. Full historical immutability rollout is gated on disposition of any such records.
- **Proposed Design:** Require a stable submission ID; add one-Report-per-Service uniqueness; assemble/finalize the accepted snapshot with server-authoritative Service, Property, and technician ID/display name; preserve generation time and server acceptance time; preserve existing transaction/row lock; return exact stored report on exact retry; render reports from immutable snapshots rather than mutable Visit/Property values; freeze current Weigh-In values per Report.
- **Established Requirement:** Server validation must reject, not normalize, any material difference from reviewed report content. A validation failure or such difference rolls back the whole transaction, leaves no accepted submission row and no terminal server-side Service, and returns a correction-required result. The local attempt remains immutable. Any corrected payload requires explicit technician correction, Review, and confirmation.
- **Proposed Design:** Bind each immutable request payload to its existing `submission_id` idempotency key. After definitive rejection, retain that payload and create a corrected attempt with a fresh value in that same field only after explicit technician action. The accepted submission ID remains the sole Report ID; do not add a separate `report_id` or second kind of identity.
- **Proposed Design:** Complete snapshot field inventory against every field emitted by both current JSON and text Report renderers: identity/order/schedule/status/timestamps, Property/address, technician ID/name, total/multi-system, systems/equipment, services/modifiers/prices, items, photo references, all rendered Weigh-In values, notes, and checklist findings. Report renderers must read only the accepted snapshot for historical output.
- **Proposed Design:** Keep one Report ID equal to the accepted submission ID; do not add a second identity. Keep Dispatch ACK as receipt/persistence; technician Review and confirmation happen before submission and do not create a Dispatch review state.
- **Proposed Design:** Dependencies: this is the authoritative data/API contract. Implement before changing Dispatch report rendering. Existing database backup/migration practices apply; schema change requires a separate implementation authorization.

### Package B — Immutable local outbox and delivery recovery

- **Proposed Design:** Own the Workspace → Review → final confirmation interface and client-side creation of the definitive snapshot/outbox. Review is an ephemeral projection with no submission; Workspace edits invalidate the preview. Final confirmation displays “Once submitted, this report cannot be modified.” with “Return to Review” and “Send Report.” Only Send Report persists the definitive snapshot and pending outbox record.
- **Proposed Design:** Preserve the confirmed snapshot unchanged; retries only change delivery metadata. ACK only the exact ID, never other IDs for the same Visit. Stop a running retry batch on 401, preserve pending content, and resume after the original technician reauthenticates.
- **Proposed Design:** Coordinate with Package A so preview and final output use one pure projection/formatting path; server normalization must not silently alter the reviewed report after confirmation.
- **Proposed Design:** Dependencies: align payload identity/version with Package A. Client can be corrected independently once the contract shape is frozen.

### Package C — Photo evidence durability

- **Proposed Design:** Persist image Blob and evidence metadata locally before network attempt; retain until successful upload; freeze evidence references in the Report snapshot; route upload 401 through session expiry. Gate Report delivery on evidence only for categories declared required by the unresolved product decision.
- **Proposed Design:** Dependencies: Package A's report evidence-manifest shape and the evidence-required decision. Reuse existing IndexedDB photo store; no new queue service.

### Package D — Dispatch historical report access

- **Proposed Design:** Make the accepted Report retrievable by Service/Report ID and present it under the associated Property without using current assignment or later mutable Service measurements. Verify multiple Services at one Property remain separate history records.
- **Proposed Design:** Dependency: Package A's immutable server representation. This package is about Dispatch access to reports already required by the current model; future assigned-technician Property history context remains out of scope.

## 13. Acceptance Criteria

### Package A

- **Proposed Design:** For each Service, zero reports exist before generation and exactly one accepted Report exists after success; database uniqueness rejects a second accepted Report even under concurrent requests.
- **Proposed Design:** A committed Report and terminal Service transition are atomic. Injected failures before commit leave neither partially committed; response loss followed by same-ID retry returns the stored Report without duplicate source effects.
- **Proposed Design:** A second/different submission ID cannot be acknowledged as the original Report. A same-ID retry returns the same Report ID, Service ID, author, snapshot version, and content.
- **Proposed Design:** After generating A's Report, reassigning the Service, changing the technician profile name, applying a correction, or creating/completing another Service at the same Property does not alter A's Report content, technician ID/display name, or timestamps.
- **Established Requirement:** A server validation failure or material Report-content mismatch does not create an accepted submission, does not finalize the Service, preserves the original pending snapshot, and requires explicit correction/review/confirmation.
- **Proposed Design:** Add integration coverage for rejection rollback, corrected attempt retention, correction Apply regression, and acceptance-time technician name preservation.
- **Proposed Design:** A legacy no-ID request cannot finalize a Service without one recoverable Report identity.

### Package B

- **Proposed Design:** Closing/reopening the app and network failure leave snapshot bytes and submission ID unchanged.
- **Proposed Design:** The client marks only the record whose exact ID matches an explicit ACK as delivered; a mismatched ACK leaves it pending.
- **Proposed Design:** A 401 during a multi-record retry batch produces no later authenticated attempts, deletes no pending data, and retry resumes only after reauthentication as the original technician.

### Package C

- **Proposed Design:** Offline photo capture stores a readable Blob and metadata durably before upload; restart and retry retain both.
- **Proposed Design:** Upload success removes or marks the local Blob according to the agreed retention policy; upload failure preserves it and its Service/Report reference.
- **Proposed Design:** No Report ACK claims required evidence is present unless the agreed upload/durability condition is met. Optional evidence can remain pending without changing frozen Report content.

### Package D

- **Proposed Design:** Dispatch can access the immutable Report for each Service under its Property; two Services at one address show as distinct records.
- **Proposed Design:** Report author and captured contents remain the original values after assignment changes or subsequent Services.
- **Established Requirement:** These criteria do not include read-only prior Service/Report context in a technician's new-Service workflow; that is future/out of scope.

## 14. Future Requirements

- **Established Requirement — FUTURE / OUT OF SCOPE:** When Dispatch creates a new Service for an existing Property, FieldOps should eventually provide the assigned technician read-only access to previous Services and Reports associated with that Property.
- **Established Requirement:** This context must not modify the current Service or change historical Report ownership.
- **Proposed Design:** No implementation, schema, API, or detailed UX design for this future capability is included here. The only architectural implication recorded is that historical Service/Report identity and association with Property must remain queryable.

## 15. Unresolved Decisions

- **Unresolved Decision:** Which photo/evidence categories are mandatory for report acceptance, and may server ACK precede upload of optional image bytes?

**Proposed Design:** The application has no update/delete writer for accepted completion rows in the inspected code. Enforce write-once behavior in the application and use the existing submission constraints; this package does not add a database trigger for privileged manual SQL changes. Production database credential governance is an operational control outside the Report workflow contract.

**Package 1 data gate:** The repository does not establish whether deployed data contains duplicate submission rows per Visit or terminal no-ID completions. Run the pre-migration audit before rollout. If duplicates exist, preserve every row and stop the migration until explicit row-level adjudication. Do not synthesize legacy snapshots from mutable rows; preserve legacy records and do not present reconstructed data as an immutable Report. Any such records block full historical immutability rollout until dispositioned. This is a data-dependent rollout gate, not an unresolved product rule.

## Per-system services (2026-11-17, Workspace pass W1a)

- Submission snapshot **version 2** replaces the single `service` object with `services`: one row per system `{ systemNumber, serviceName, isFinish, isTemporarily, price }`, or a lone `{ systemNumber: null, serviceName: "Drive Run" }`, or the Cancel row. Each price is the one the server confirmed for that exact selection (`PATCH /services` response). `terminalIntent` is `temporarily` when any system is Temporarily.
- The server rewrites the per-system rows from the snapshot (`applySnapshotWork`), rejects a snapshot that leaves a system without a service ("System N: no service selected"), and compares the rows one to one, system number included. A version 1 snapshot (`service`) is still compared as before.
- Several thermostat models are separate item rows and compare like any item.
- Weigh-In measurements belong to the address; a Drive Run Report, like a Cancel Report, carries none.
- PP-01 and field names in rejections: implemented in W-LF, see the next section.

## Local-first Workspace and PP-01 (2026-11-17, W-LF)

- The Workspace prices the draft on the device with `frontend/shared/pricing.mjs`, the same module the server uses for the visit total. Workspace edits no longer write to the server; the snapshot carries every selection with its device price.
- On submission the server rebuilds the work from the snapshot, prices it from its own catalog, and compares (`compareSubmission` in `src/services/report.js`):
  - **Structural differences** (identity, address, terminal intent, services' system/name/Finish/Temporarily, items' name/category/description/quantity, systems, Weigh-In, notes, checklist findings, evidence) still reject with 409 `REPORT_CONTENT_MISMATCH`; the response lists the differing fields (`fields`).
  - **Catalog-derived differences** (service and item prices, item `tech_supplied`, the total) are accepted (PP-01). The canonical Report keeps the server values; the embedded `sourceSubmission` keeps the device values; `priceDiscrepancies` lists each difference (`field`, `row`, `submitted`, `accepted`).
- Dispatch shows the discrepancies on the Report view (History → visit details: a header flag and a "Price check" section).
- The server no longer re-adds catalog companions on submission: a companion the technician turned off stays off.
- Pending: the Ledger weekly review of discrepancies with an owner threshold (deferred, QA-TRACKER PP-01b) and the technician-facing rejection wording (WS-12, W4).
