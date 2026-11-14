# FieldOps — Report Snapshot Implementation Plan

**Status:** Planning only — not implemented
**Date:** 2026-11-11

## 1. Executive Summary

**Established requirement:** Each Service/Visit produces exactly one Report. A Property can have unlimited Services. Generating a Report finalizes that Service; Dispatch acknowledgment is a separate event and does not close the Property. A Report must retain its accepted content and technician attribution through later operational changes. Offline retries must send the same generated snapshot and identity, and authentication failure must stop further authenticated delivery until the original technician restores a session.

**Verified existing behavior:** The PWA creates a JSON snapshot and stores it in an IndexedDB completion outbox. The server stores accepted snapshots as JSONB in `completion_submissions` and transactionally writes that row, applies work, finalizes the Visit, and returns an acknowledgment. These are strong existing foundations. They do not yet form a definitive historical Report: the client can rebuild an existing pending snapshot, the server has no unique constraint on `visit_id`, report rendering reads mutable Visit/Property data, and completion acknowledgments are not a separate Dispatch acceptance event. Photo bytes are not durably stored by the current upload endpoint.

**Proposed change:** Reuse the existing outbox and JSONB submission as the single Report record. Freeze a submission once generated; enforce one accepted submission per Visit in PostgreSQL; render historical reports from the accepted snapshot; preserve the authenticated author from that record; make retries and acknowledgments exact-identity operations; stop a retry batch on authentication expiry; and durably retain evidence bytes and their association. Do not add a separate Report table or versioning system unless a decision below establishes a need.

**Established workflow:** Workspace → Review → (return to Workspace and edit if needed) → Send Report → Final Confirmation → Submission/Delivery. Review is non-persisting. Only explicit confirmation creates the definitive local snapshot, locks the local Service draft for editing, and registers the outbox delivery. The server-side Service becomes terminal only when it accepts that same snapshot and commits. A submitted Report is immutable.

**Established offline-validation behavior:** Review may use locally available catalog/pricing data. Server acceptance must not silently normalize any material Report content. A validation error or material difference must reject acceptance, roll back the completion transaction, leave no accepted Report and no terminal server-side Service, retain the exact rejected local snapshot, and tell the technician correction is required. Correction, re-review, and resubmission require explicit action.

**Proposed local outbox handling:** Mark a definitively rejected immutable attempt `correction_required` so automatic delivery cannot resend it. Preserve the payload. After explicit correction, Review, and confirmation, create a corrected attempt with a fresh value in the existing `submission_id` field. The accepted submission ID remains the only Report ID.

**Proposed correction-attempt handling:** Bind each immutable payload attempt to a value in the existing `submission_id` field. After definitive rejection, preserve that attempt and only create a corrected attempt with a fresh value in the same field after explicit correction, Review, and confirmation. The accepted submission ID is the sole Report ID; do not add a separate `report_id` or a second kind of identity.

Implementation should proceed in four packages: server-side accepted snapshot and report read path; client Review/outbox and authentication recovery; durable photo evidence; and Dispatch access to immutable Reports. This is a plan only; no implementation is authorized by this document.

## 2. Current Implementation Map

| Area | Verified existing behavior | Relevant code |
| --- | --- | --- |
| Snapshot creation | `createCompletionSnapshot()` creates a frozen object with version, submission/visit/technician IDs, address, work type, time, terminal intent, work, measurements, notes, checklist, evidence references, and price. | `frontend/pwa/src/lib/completion-submission.mjs` |
| Pending outbox | `createPendingCompletionSubmission()` finds a pending record for the Visit and can reuse its ID while rebuilding and saving its snapshot from the current draft. IndexedDB `put` replaces the record. | `completion-submission.mjs`; `frontend/pwa/src/lib/db.js` (`saveCompletionSubmission`) |
| Delivery | `deliverCompletionSubmission()` sends `submissionId` and the stored snapshot, checks the returned acknowledgment, and updates local lifecycle state. The batch retry loop can mark other same-Visit IDs delivered and continues its previously loaded batch after an awaited failure. | `completion-submission.mjs` (`deliverCompletionSubmission`, `retryPendingCompletionSubmissions`) |
| Server acceptance | `POST /api/visits/:id/complete` validates ownership, locks the Visit `FOR UPDATE`, checks for an existing submission, rejects a new ID for a terminal Visit, writes the accepted JSONB row, applies submitted work, terminalizes the Visit, and commits these operations together. The Package 1 F-02 transaction and ownership checks are present and must remain. | `src/routes/completion.js` (`applySnapshotWork`, completion handler) |
| Submission schema | `submission_id` is the primary key; `visit_id` and `technician_id` are foreign keys; snapshot is JSONB. `visit_id` has a non-unique index only. | `src/db/schema.sql`; `src/db/migrations/023_completion_submissions.sql` |
| Report output | `generateReportJSON()` and `generateReportText()` query current Visit, address, child rows, photos, and address-keyed Weigh-In data. Preview/download routes authorize using the Visit's current assignee and render by Visit ID. | `src/services/report.js`; `src/routes/completion.js` (`GET /:id/report-preview`, `GET /:id/download`) |
| Assignment/history | Reassignment can change the Visit's technician after completion without changing the accepted submission. | `src/routes/visits.js` (`PATCH /:id/reassign`); `src/routes/transfers.js` |
| Dispatch reports | Dispatch's Reports screen aggregates equipment and refrigerant usage; it is not a per-Service Report acceptance or ingestion interface. | `src/routes/reports.js`; `frontend/dispatch` Reports screen (source/build should be confirmed before implementation) |
| Authentication expiry | Normal API requests dispatch `auth:expired` on 401; `app.js` stops sync and the registered retry listener and clears credentials. Upload requests throw 401 without dispatching the event. A running retry batch and direct Reports-screen retry triggers need explicit post-401 guards. | `frontend/shared/api.js`; `frontend/pwa/app.js`; `completion-submission.mjs`; `frontend/pwa/src/screens/reports.js` |
| Photo evidence | IndexedDB has `photos` Blob helpers, but Workspace capture uploads directly and does not call `addPhoto`. The server route inserts metadata with `stored_at = null` and discards the uploaded memory buffer. | `frontend/pwa/src/lib/db.js` (`addPhoto`, `getPhotosForVisit`, `deletePhotosForVisit`); `frontend/pwa/src/screens/workspace.js`; `src/routes/workspace.js` (`POST /:id/photos`); `src/db/schema.sql` (`visit_photos`) |
| Review and submission UX | Workspace opens a short summary modal and immediately creates a pending submission on “Submit report”; there is no complete draft Review and no separate irreversible final confirmation. | `frontend/pwa/src/screens/workspace.js` (`openGenerateModalDirect`); `frontend/pwa/src/lib/completion-submission.mjs` (`createPendingCompletionSubmission`) |
| Request correction | Technician UI and endpoint create a separate correction row; Dispatch queue/detail/Apply edits operational Visit/Property data transactionally and records before/after state. The accepted JSONB is not directly updated, but report rendering reads the changed operational records. | `frontend/pwa/src/screens/reports.js`; `frontend/pwa/src/components/correction-modal.js`; `src/routes/corrections.js`; `frontend/dispatch/src/screens/Corrections.jsx`; `src/db/schema.sql` (`corrections`, `edit_log`) |

**Dispatch Report acceptance:** No separate per-Report acceptance endpoint or persisted Dispatch acceptance state was found in the inspected routes. Current completion ACK means server transaction accepted the Service completion submission. Treating this as Dispatch acceptance would conflate distinct events. The target's precise human review/acceptance workflow is an unresolved product decision; do not add one implicitly.

## 3. Snapshot Architecture Assessment

### Existing JSONB and alternatives

1. **Reuse and enforce the existing JSONB (recommended).** It already carries the accepted submission identity, authenticated technician, terminal intent, and work payload and is written in the Visit-finalization transaction. Make it immutable after acceptance, enforce one row per Visit, and make historical rendering read it.
2. **Separate immutable Report record.** This would duplicate the same identity and payload already present in `completion_submissions`, requiring extra synchronization and transaction rules without a demonstrated benefit. Not recommended absent a distinct Report lifecycle/storage requirement.
3. **Versioned Report representation.** There is no current requirement for report revisions; versioning would introduce lifecycle and correction semantics beyond this scope. Keep the existing snapshot `version` as a schema version, not as a report history system.

### Answers to the required assessment

| Question | Verified answer |
| --- | --- |
| Where created? | `createCompletionSnapshot()` in `frontend/pwa/src/lib/completion-submission.mjs`. |
| What does it contain? | Identity, address/work context, terminal intent, service/item/measurement data, systems, notes, checklist answers, evidence references, and total price (see map above). |
| Copied or referenced? | A new snapshot object is constructed and frozen for the call; the outbox stores the snapshot object with `put`. Structured cloning stores a value, but later `put` can replace the record. The server inserts JSONB from the request. |
| Can later operational data affect stored JSONB? | No direct mutation of the database JSONB is performed by the inspected routes, but report generation ignores it and reads mutable operational tables. |
| Can the outbox overwrite it? | Yes. A pending record may reuse the ID but rebuild and `put` a different snapshot. |
| Does Dispatch/rendering use it? | Current report preview/download generator does not; it queries current tables. Dispatch's operational Reports aggregates are not a Report record consumer. |
| Can original technician be recovered? | Yes, from `completion_submissions.technician_id` and current snapshot, but generated output currently uses `visits.technician_id`, which can change. A same-ID retry after reassignment also needs to be handled as an exact accepted-record lookup before ownership checks for a *new* completion, without authorizing a new mutation. |
| Are photo refs and bytes preserved? | Snapshot can carry evidence references, but client capture does not durably enqueue Blob data, and server upload does not persist bytes. Neither currently guarantees a retrievable image. |
| Existing constraints? | `submission_id` primary key; FKs from `visit_id` and `technician_id`; terminal intent check; non-unique Visit index. `weigh_in_data` is unique on `(address_id, system_number)`, so later service measurements overwrite address-level operational values. |
| Minimum reliable change? | Treat accepted JSONB as canonical Report, prevent replacement of generated pending outbox snapshots, enforce `UNIQUE(visit_id)` after duplicate-data audit, render from frozen JSONB, and persist the bytes for evidence required by policy. |

The snapshot must contain every value needed for the Report's historical presentation, including the original technician identity/name as required by the chosen display contract, Property address at generation, service data and measurements, and evidence references. Current snapshot fields should be reconciled with the Report contract during implementation; avoid adding fields without a Report requirement. A snapshot's author must derive from authenticated server identity, not a client-asserted `technicianId`.

## 4. Root-Cause Analysis

### A. Snapshot and outbox integrity

These are connected but distinct defects. The local outbox can replace a pending generated payload; independently, the server's report projection reads mutable Visit and address-level measurement rows rather than the accepted JSONB. One shared remedy is to establish a single immutable snapshot as the Report source, but it requires both client write-once behavior and server snapshot-based reading. Server accepted-row identity/constraints also prevent alternate writers or races from creating a second Report. Historical author data exists on the accepted row but is not used by the renderer.

### B. Authentication interruption

This is a separate delivery state-machine defect. `api.request()` turns 401 into `auth:expired`; `app.js` clears session state and stops listeners; `stopCompletionSubmissionRetry()` does not cancel an already-running async batch. Direct Reports screen retry entry points also call retry/delivery helpers. `api.upload()` does not dispatch expiry. A minimal correction centralizes 401 expiry across request and upload paths, gates every delivery on the currently active original technician/session, and stops the current batch immediately after authentication expiry while retaining pending records and their snapshots. On restoration, only records belonging to the same original technician are eligible.

### C. Offline photo persistence

This is an independent durability defect with a dependency on Report evidence references. Local Blob helper functions already exist, but capture does not use them, and the server drops image bytes. Persisting locally before network upload and retrying/cleaning up after confirmed durable upload fixes offline capture loss. To make a generated historical Report's required evidence retrievable after delivery, a durable server-side byte store and stable association are also required; the current Postgres metadata row alone cannot meet that requirement. There is no verified object-storage implementation in the inspected application source. The narrowest choice of durable byte storage is unresolved (see §14); do not assume in-memory multer storage is durable.

## 5. Recommended Implementation Packages

### Package 1 — Canonical server Report snapshot

- **Objective / root causes:** Make the accepted JSONB the one immutable Report for a Service, preserve its author, and prevent later operational changes or duplicate requests from changing/duplicating it.
- **Likely files/functions:** `src/routes/completion.js` completion transaction and report preview/download routes; `src/services/report.js` generators; `src/db/schema.sql`; new migration under `src/db/migrations/`; focused tests in `tests/completion.test.js`, `tests/report.test.js`, and relevant correction/report tests.
- **Database:** Add unique `visit_id` after a pre-migration duplicate audit; retain the submission primary key and existing foreign keys. Migration must fail safely with actionable evidence if duplicates exist, not silently delete accepted rows. No separate Report table.
- **Proposed existing-data policy:** Preflight audit counts both repeated `visit_id` values in `completion_submissions` and terminal Visits without a submission row. If duplicates exist, abort the unique-constraint migration; preserve every row and require explicit record-level adjudication before retrying. Never automatically delete, merge, or pick a canonical Report. Do not synthesize snapshots for legacy no-ID completions from mutable rows: original content, technician name, and timestamps cannot be proven. Keep them explicitly identified as legacy and do not label reconstructed output immutable. Full historical immutability rollout is blocked until any such records receive an approved disposition.
- **API/frontend:** Keep stable `submissionId`/Visit endpoint unless a concrete response shape gap is found. Exact retries return the accepted stored snapshot/report and ACK only for matching submission ID, Visit ID, and authenticated technician, including after reassignment; this retry path must not authorize new writes. New acceptance must keep current ownership validation and Package 1 transaction boundary. Resolve technician ID and display name from server-authenticated state at acceptance and freeze them, plus generation and server acceptance timestamps. Render/download/preview must use the accepted snapshot. Dispatch aggregation is not acceptance.
- **Established validation behavior:** Compare server-authoritative validation/pricing against the reviewed snapshot's material Report-visible content before commit. Any validation failure or material difference returns a clear correction-required error and rolls back all transaction work, including the inserted submission row, child/source changes, transfer expiry, and terminal status. Preserve Package 1 F-02 ownership, row locks, transaction, and exact identity recovery. The rejected local snapshot remains intact and correction requires explicit review/confirmation.
- **Proposed correction-attempt handling:** A corrected payload is a new immutable attempt using a fresh value in the existing `submission_id` field only after explicit correction, Review, and confirmation. Preserve the rejected snapshot. The accepted submission ID remains the only Report ID; no separate `report_id` or second type of identity is added.
- **Snapshot completeness:** Audit every field returned by `generateReportJSON()` and every field rendered by `generateReportText()`: Visit/order/schedule/status/completion time, Property/address, technician ID and acceptance-time display name, total/multi-system, systems and equipment, services/modifiers/prices, items, photo references, all rendered Weigh-In measurements, notes, checklist findings, generation and acceptance timestamps. Historical renderers read only the accepted snapshot.
- **Tests to add/modify:** One Report per Visit; duplicate delivery idempotency; competing IDs cannot both be accepted; change measurements/address/assignee/profile name after acceptance and verify content, technician ID/name, and timestamps unchanged; exact accepted retry after reassignment returns original ACK only to original identity; server validation error and material mismatch leave no submission row, no source side effects, and nonterminal Visit; corrected attempt retains original rejected snapshot and accepts only after explicit confirmation; correction Apply leaves original snapshot/rendering unchanged; preserve ownership, rollback, and F-02 race tests.
- **Must remain passing:** Existing `tests/completion.test.js`, `tests/report.test.js`, and directly affected `tests/corrections.test.js` behavior, especially Package 1 transaction/ownership guarantees.
- **Dependency / risks / rollback:** First package. The migration preflight preserves every existing row and aborts if duplicate Visit submissions remain; no silent deletion, merge, or canonical-row guess. Terminal no-ID legacy completions cannot be faithfully backfilled from mutable data and remain explicitly legacy unless a trusted historical source is available. These records block full historical immutability rollout until dispositioned. Rollback must not weaken existing ownership/F-02 guarantees; dropping the unique constraint requires a deliberate operational decision.
- **Acceptance:** Exactly one accepted JSONB Report per eligible Visit; database enforces cardinality; Report output derives only from that row; technician ID/name/content/timestamps remain stable after reassignment, profile change, correction Apply, or later property measurements; material validation mismatch leaves no accepted row and no Visit finalization; the existing transaction and F-02 guarantees remain intact. Production migration remains gated on audit disposition of duplicate and legacy rows.

**Package 1 readiness:** The functional contract is sufficiently specified to begin implementation. The only identified blocker is data-dependent rollout of the uniqueness constraint and full historical guarantee: the deployed database must first be audited. If duplicate accepted rows or legacy terminal Visits without submission rows exist, preserve them and stop migration/rollout until explicitly adjudicated; no safe record selection or historical snapshot can be inferred from this repository.

### Package 2 — Write-once local outbox and auth-safe retry

- **Objective / root causes:** Own the technician-facing Workspace → Review → final confirmation flow and only then create the definitive snapshot/outbox record; preserve that content/identifier across restart/retries; never cross-acknowledge another ID; stop delivery after expiry and resume only for the original technician.
- **Likely files/functions:** In addition to `frontend/pwa/src/lib/completion-submission.mjs` (`createPendingCompletionSubmission`, `deliverCompletionSubmission`, `retryPendingCompletionSubmissions`, listener start/stop), `frontend/pwa/src/lib/db.js` (`saveCompletionSubmission`, pending/delivered access), `frontend/shared/api.js` (`request`, `upload`), `frontend/pwa/app.js` (`clearSession`), and `frontend/pwa/src/screens/reports.js` retry controls, change `frontend/pwa/src/screens/workspace.js` (`openGenerateModalDirect` and navigation/state for Review and confirmation). `frontend/pwa/src/lib/queue.js` and `sync.js` only if a retry/auth entry point requires a guard.
- **Database/migration:** None expected. Verify current IndexedDB `completionSubmissions` store remains sufficient; avoid schema upgrade absent a demonstrated need.
- **API/frontend:** Keep current completion endpoint payload; compare full ACK identity. Do not mark other Visit submissions delivered. Review uses a transient current-draft projection; returning to Workspace allows edits and reopening Review reflects them. A review projection is not persisted as a definitive Report or outbox item. Final confirmation shows “Once submitted, this report cannot be modified.” and “Return to Review” / “Send Report.” Only explicit Send Report confirmation creates the snapshot and outbox record. Content fields in that snapshot must equal the last reviewed content. On a definitive validation/mismatch rejection, retain the original immutable attempt, exclude it from automatic delivery, explain that correction is required, and allow a corrected payload only through Workspace edit → Review → explicit confirmation. The corrected payload receives a fresh value in the existing `submissionId` field; the accepted one remains the only Report ID and there is no separate `report_id`. 401 handling and same-technician recovery remain as specified above.
- **Tests to add/modify:** Review is non-finalizing and creates no definitive outbox record; workspace edits appear on reopened Review; canceling final confirmation has no submission/finalization effect; confirmation creates exactly one snapshot matching the displayed preview; repeated confirmation cannot create a second Report. Validation failure/mismatch leaves the original local snapshot unchanged and blocked from auto-retry until explicit correction; corrected attempt uses the existing identifier field with a new key and is created only after confirmation. Also retain unit/integration tests for write-once preservation, exact ACK, no cross-ID state update, first/later batch 401, no further requests, pending preservation, original-session recovery, and wrong-technician isolation.
- **Must remain passing:** Existing `tests/completion-submission.test.js`, `tests/local-visit-draft.test.js`, `tests/sync.test.js`, `tests/auth.test.js`, and applicable completion ownership/idempotency tests.
- **Dependency / risks / rollback:** Depends on Package 1's exact accepted identity/ACK semantics. No data deletion; rollback must not re-enable snapshot overwrite or cross-ID acknowledgment. Test every retry trigger, including Reports-screen manual actions, not only the `online` listener.
- **Acceptance:** Review creates no definitive record or terminal state; edits are reflected on reopening Review; canceled confirmation does nothing; confirmed snapshot content matches the final Review and is created exactly once. After restart/retry each attempt has the same ID/snapshot, only exact ACK updates that record, a 401 halts the batch, pending data survives, and only the original technician resumes it.

### Package 3 — Durable evidence capture and association

- **Objective / root causes:** Keep photo bytes through offline capture, restart, upload failure, and authentication interruption; link successfully stored evidence to the correct Service and immutable Report.
- **Likely files/functions:** `frontend/pwa/src/screens/workspace.js` capture handlers (`captureWeighInPhoto`, `captureStartupItemPhoto`); `frontend/pwa/src/lib/db.js` existing Blob helpers; `frontend/pwa/src/lib/completion-submission.mjs` evidence manifest/delivery sequencing as required; `frontend/shared/api.js` shared upload expiry; `src/routes/workspace.js` photo upload handler; `src/db/schema.sql` and a migration only for chosen durable storage/reference; report projection in `src/services/report.js`. Add focused `tests/workspace.test.js`, client photo/outbox tests, and report evidence integration tests.
- **Database/migration:** Current `visit_photos` stores metadata only. Some server-side durable byte store is required if Dispatch/Report consumers must retrieve image bytes after device loss; no existing durable storage was verified. Select the smallest approved option before implementation. Migration should associate stored evidence by stable photo ID and Visit, with no speculative generic media subsystem.
- **API/frontend:** Capture must persist Blob and metadata locally before attempting upload. Upload retry must be idempotent by stable photo ID and clear local bytes only after confirmed durable server storage. The Report snapshot must retain the stable evidence manifest. Required-vs-optional evidence and whether report acceptance waits for required uploads are open decisions; do not silently claim evidence complete when bytes are unavailable.
- **Tests to add/modify:** Offline capture/restart/retry; failed upload preserves Blob; successful durable upload cleans local copy only after confirmation; duplicate upload does not duplicate evidence; evidence is included and associated with the accepted Report; authentication expiry preserves evidence and halts authenticated upload attempts.
- **Must remain passing:** Existing `tests/workspace.test.js`, completion/report tests, and Package 2 auth/outbox tests.
- **Dependency / risks / rollback:** Depends on Package 1's evidence manifest and Package 2's authentication stop behavior. Storage choice, retention, size limits, and privacy are material risks. Rollback must retain bytes or provide a safe export/retry path; never drop stored evidence as cleanup.
- **Acceptance:** Required captured bytes survive offline/restart/auth interruption and are retrievable through their stable Service/Report association after confirmed upload; no report silently loses required evidence.

### Package 4 — Dispatch historical Report access

- **Objective / root causes:** Fulfill the established requirement that Dispatch can retrieve and store/show each immutable Report under its Property, with each Service remaining a separate Report.
- **Likely files/functions:** Inspect and update the maintained Dispatch UI source and API consumer; `src/routes/completion.js` report retrieval API and `src/services/report.js` snapshot renderer as needed. Current Dispatch Reports analytics in `src/routes/reports.js` and `frontend/dispatch` do not provide per-Service Report acceptance/access, so confirm the exact maintained screen before edits.
- **Database/migration:** Reuse Package 1's `completion_submissions` association through Visit → Property; no new Report table or Property history schema.
- **API/frontend:** Read accepted snapshots by Service/Report identity and present each under the linked Property; do not confuse completion ACK with a new human Dispatch approval state. Corrected operational Visit data remains separate from the original submitted Report.
- **Tests to add/modify:** Dispatch can access the correct frozen Report for each Service; multiple Services at one Property remain separate; Report content/author remains stable after reassignment, later Services, and correction Apply.
- **Dependency / risks:** Depends on Package 1's accepted snapshot and API; avoid rebuilding from current Visit rows. Technician prior-Service History Context remains future/out of scope.
- **Acceptance:** Dispatch can retrieve the original immutable Report associated with its Property, without conflating separate Services or changing the accepted snapshot.

### Request correction assessment — preserve existing mechanism

- **Verified Existing Behavior — request UI:** The Reports screen offers “Request correction.” The modal requires nonblank free text and has Cancel / Submit request with inline errors; it does not add a separate confirmation dialog (`frontend/pwa/src/screens/reports.js:383-413`; `frontend/pwa/src/components/correction-modal.js`).
- **Verified Existing Behavior — API/auth:** `POST /api/visits/:id/request-correction` requires technician role, a nonblank message, a terminal Visit, and current Visit assignment to the requester. It creates a separate `corrections` row and notifies active Dispatchers/Owners (`src/routes/corrections.js`).
- **Verified Existing Behavior — Dispatch process:** Dispatch provides a corrections queue, Finder, detail/editor, and Apply endpoint. Apply locks correction and Visit, validates permitted fields, updates Visit/Property/child records transactionally, records `before_state`/`after_state`, marks the correction applied, writes an edit-log record, and may reconcile pay-period adjustments. Detail displays a live operational Visit snapshot; evidence is read-only and image preview is unavailable.
- **Verified Existing Behavior — repeat:** The endpoint checks for an open correction, but check and insert are not transactional and schema has no unique constraint, so concurrent requests can create multiple open rows. A new correction can be requested after a prior one is applied or expired.
- **Verified Existing Behavior — original Report:** Apply does not directly update `completion_submissions.snapshot`; it does update the source rows the current Report generators query. Therefore the displayed historical report can change even though the accepted JSONB itself is untouched.
- **Classification:** **Partially implemented.** The request, authorization, persistence, Dispatch processing, and audit path exist. The immutable original Report presentation is not protected by the current read path. This mechanism is not UI-only and should not be replaced.
- **Proposed Change (Package 1):** Keep the current correction mechanism and separate audit records. Render the submitted Report from its accepted snapshot so existing correction Apply cannot alter the original Report content or technician attribution. Do not silently rewrite the snapshot and do not redesign correction processing in this scope.
- **Established Requirement:** Side-by-side original Report and correction before/after presentation is not required for Package 1 and remains a future UI decision. The race allowing multiple open corrections is a separate known defect, outside this work.

## 6. File and Function Impact Matrix

| File | Planned impact | Package |
| --- | --- | --- |
| `src/routes/completion.js` | Exact accepted identity lookup/ACK; preserve ownership and transaction; historical preview/download source. | 1 |
| `src/services/report.js` | Generate JSON/text from accepted snapshot instead of mutable Visit/Property projection. | 1 |
| `src/db/schema.sql` | Reflect accepted unique Visit constraint and, only if selected, durable evidence storage. | 1, 3 |
| `src/db/migrations/` | New safe unique Visit migration; evidence migration only if storage decision requires it. | 1, 3 |
| `frontend/pwa/src/lib/completion-submission.mjs` | Prevent replacement, exact ACK state changes, stop and resume retry correctly. | 2, 3 |
| `frontend/pwa/src/screens/workspace.js` | Add draft Review navigation and final confirmation; create/persist the definitive snapshot only from explicit confirmation. | 2 |
| `frontend/pwa/src/components/` (existing or new Review UI, implementation choice) | Render the complete ephemeral preview and confirmation warning/actions without creating a submission during Review. | 2 |
| `src/routes/corrections.js`, Dispatch Corrections UI | Preserve existing correction path; no replacement. Verify immutable Report read path is isolated from operational Apply edits. | 1 (regression only) |
| Maintained Dispatch per-Service Report consumer (source to be verified before implementation) | Retrieve/show each accepted snapshot under its Property; do not treat correction state or analytics as the original Report. | 4 |
| `frontend/pwa/src/lib/db.js` | Reuse outbox and photo Blob stores; narrowly adjust write-once or evidence lifecycle behavior. | 2, 3 |
| `frontend/shared/api.js` | Shared 401 expiry behavior for JSON and multipart requests. | 2, 3 |
| `frontend/pwa/app.js` | Ensure session-expiry stop behavior covers active retry work. | 2 |
| `frontend/pwa/src/screens/reports.js` | Gate manual and screen-mount retry paths after expiry. | 2 |
| `frontend/pwa/src/screens/workspace.js` | Persist photo Blobs and metadata before upload. | 3 |
| `src/routes/workspace.js` | Persist uploaded image bytes and return stable durable reference. | 3 |
| `tests/completion.test.js`, `tests/report.test.js`, `tests/corrections.test.js` | Snapshot, cardinality, identity, historical output and regressions. | 1 |
| `tests/completion-submission.test.js`, `tests/local-visit-draft.test.js`, `tests/sync.test.js`, `tests/auth.test.js` | Outbox and auth interruption/recovery. | 2 |
| `tests/workspace.test.js` and focused client evidence tests | Blob durability, upload retry/idempotency, evidence association. | 3 |
| Dispatch source for Reports | Inspect actual maintained source and consumption before changing; current route is aggregate usage, not Report acceptance. | 1 only if a verified Report consumer requires it |

This is a likely impact list, not authorization to modify every listed file. Implementation must re-inspect current code and limit changes to the demonstrated paths.

## 7. Database and API Impact

### Database

- Add `UNIQUE (visit_id)` to `completion_submissions`, retaining `submission_id` as the stable client idempotency key. First query production/test data for duplicate Visit rows; the migration must not guess which accepted Report to preserve.
- Treat `snapshot` as write-once after acceptance. PostgreSQL JSONB is mutable by SQL, so application writer discipline and the constraint protect ordinary paths; if unrestricted direct SQL writers are in scope, decide whether a trigger/permissions policy is needed rather than adding one speculatively.
- Current `weigh_in_data` is address/system keyed and mutable. No schema redesign is required if accepted snapshot captures the values used by that Report and historical rendering stops reading the table.
- `visit_photos` has only metadata and no byte payload/reference guaranteed durable. Durable storage choice is pending; do not add a second store until selected.

### API

- Keep `POST /api/visits/:id/complete` unless implementation exposes a concrete contract gap. ACK/idempotency must match `(submission_id, visit_id, authenticated technician_id)` and return the original accepted Report snapshot for an exact retry.
- A different submission ID for an already accepted Visit must not be acknowledged as the original. A duplicate Visit unique violation is not success unless an exact accepted identity is found; otherwise preserve the error/defined conflict response.
- Preview/download should render accepted Report content, while authorization must still distinguish access to historical output from permission to mutate or newly complete the Visit.
- No Dispatch acceptance endpoint/state is verified. Separate service completion from any future explicit Dispatch review/acceptance event.
- Photo upload should return a stable photo ID/reference only after durable storage succeeds; retrying that ID must be idempotent. Exact required evidence gate and error behavior require the open decision in §14.

## 8. Test Strategy

Tests below are **planned**, not claims that coverage already exists. Unit = isolated function/state test; Integration = real API/database or IndexedDB persistence boundary; End-to-end = user-visible flow across app restart/network/auth state.

| Scenario | Type | Package |
| --- | --- | --- |
| Generate one Report, then duplicate generation/delivery; exactly one stored row and stable ACK. | Integration | 1 |
| Concurrent submissions with distinct IDs for one Visit; one accepted identity only. | Integration (PostgreSQL) | 1 |
| Mutate address-level measurement and reassign Visit after acceptance; Report body and original author unchanged. | Integration | 1 |
| Change technician profile name after acceptance; Report retains acceptance-time technician ID and display name. | Integration | 1 |
| Exact original technician retry after reassignment returns existing Report without new mutation; another technician cannot receive it as a new acceptance. | Integration | 1 |
| Preserve existing Package 1 rollback, owner/assignment checks, and F-02 concurrent completion semantics. | Integration | 1 |
| Server validation error and material report-content mismatch return correction-required without accepted submission, source effects, transfer expiry, or terminal Visit. | Integration | 1 |
| Corrected attempt is created only after explicit correction/review/confirmation; rejected original snapshot remains intact and only one Report is accepted. | Integration + End-to-end | 1 + 2 |
| Unique-Visit migration preflight detects duplicate accepted rows and aborts without deleting/merging them; legacy terminal no-ID records are not synthesized into immutable Reports. | Integration | 1 |
| Pending snapshot cannot be replaced; all post-restart retry attempts send identical ID and snapshot; ACK changes only exact record. | Unit + IndexedDB integration | 2 |
| 401 on first and later batch item stops all later authenticated requests; all pending snapshots remain. | Unit + API integration | 2 |
| Restore original technician session and resume only that technician's pending item; another identity cannot resume it. | Integration / End-to-end | 2 |
| Offline photo capture, restart, failed upload, restored connection/auth and eventual durable upload. | End-to-end | 3 |
| Successful upload is idempotent, returns a durable reference, cleans local Blob only after success, and appears in the correct Report. | Integration | 3 |
| Required evidence unavailable: acceptance follows explicitly approved policy and never silently omits it. | Integration | 3 |
| Review open causes no terminal transition and creates no definitive local/server submission. | Integration + End-to-end | 2 |
| Return to Workspace permits edits; reopening Review shows the updated values. | End-to-end | 2 |
| Cancel final confirmation causes no submission or Service finalization. | End-to-end | 2 |
| Confirm Send Report creates exactly one definitive snapshot; accepted Report content equals the last Review display. | Integration + End-to-end | 1 + 2 |
| Repeated confirmation/double click/retry cannot create a second Report. | Integration | 1 + 2 |
| After submission, Request correction creates a separate record and applying it leaves original snapshot and rendered Report unchanged. | Integration | 1 |
| Dispatch retrieves each Service's accepted Report under its Property without merging multiple Services. | Integration + End-to-end | 4 |

Existing tests verified by inspection include completion idempotency/recovery and ownership cases in `tests/completion.test.js`, snapshot/outbox cases in `tests/completion-submission.test.js`, report generation in `tests/report.test.js`, photo endpoint metadata in `tests/workspace.test.js`, and auth cases in `tests/auth.test.js`. Their exact current assertions must be reviewed before implementation; some reflect earlier behavior such as snapshot overwrite or cross-ID reconciliation and will need correction rather than preservation. Do not weaken F-02, ownership, or exact identity coverage.

## 9. Dependencies and Execution Order

1. **Package 1 first:** establishes canonical accepted Report and API identity semantics. Start with duplicate-row audit and final snapshot fields. Run completion/report/correction regression suites, PostgreSQL concurrency coverage, full diff review, self-review, and `git diff --check` before proceeding.
2. **Package 2 second:** implement immutable local outbox and auth-safe retries against Package 1's stable ACK. Verify restart and 401 timing before photo delivery depends on the same session gate.
   - Package 2 owns the Review UI, final confirmation, and client snapshot creation. It depends on Package 1's shared report projection/formatting contract so the definitive snapshot matches the preview.
3. **Package 3 third:** use the stable Report evidence manifest and Package 2's authenticated retry lifecycle. Resolve durable byte storage and required-evidence policy before code or migration.
4. **Package 4:** expose the Package 1 immutable records through the maintained Dispatch report consumer after its source and API path are verified.

At every package boundary, verify against the authoritative contract, inspect unrelated worktree changes, run focused and directly affected regression tests, review the complete diff, self-review error/rollback/race paths, and run `git diff --check`. Report unverified behavior rather than assuming success. No package is implied authorized by this planning document.

## 10. Risks and Rollback Considerations

- **Existing duplicate accepted rows:** `UNIQUE(visit_id)` cannot be added until duplicates are enumerated and a product-approved preservation policy is applied. Never delete/merge silently.
- **Snapshot completeness:** Any renderer field omitted from the snapshot would remain mutable or disappear. Compare the full current report output and contract before switching readers.
- **Review/final parity:** Existing generators query database rows and cannot preview an unsaved Workspace draft unchanged. Shared formatting is required. Offline local catalog/pricing may preview, but server mismatch must reject and roll back rather than normalize the content.
- **Correction compatibility:** Existing correction Apply edits operational source records. Snapshot-based historical rendering must preserve the submitted original independently while the correction UI continues to show its audited operational state.
- **Legacy rows:** Never fabricate a historical immutable snapshot from mutable current data. Preserve legacy rows and identify them as legacy; full historical immutability rollout waits for explicit disposition of terminal visits without accepted snapshot rows.
- **Authorization after reassignment:** Existing Visit ownership checks must continue to protect new writes. Exact historical retry access is a read/idempotency path, not permission to mutate as the previous owner.
- **Evidence storage:** Durable image storage introduces capacity, retention, privacy, access control, and backup concerns. Current in-memory upload is not a fallback. Resolve storage and retention before Package 3.
- **401 during mixed batch:** Batch cancellation must not clear or corrupt local data; screen/manual triggers must share the same session gate.
- **Rollback:** Preserve accepted JSONB and pending IndexedDB records. Do not roll back by deleting Reports/evidence or restoring overwrite/cross-ID ACK behavior. Any constraint rollback needs an explicit operational choice because it permits duplicate Reports.

## 11. Acceptance Criteria

1. Each Service/Visit has at most one accepted Report enforced by PostgreSQL; separate Services at one Property remain independent and unlimited.
2. The Report is finalized with Service completion; Dispatch acknowledgment/review, if introduced by a future decision, is separately represented and does not close the Property.
3. The accepted snapshot is the sole source for historical Report content and attribution. Later measurement, Property/address, assignment, and operational record changes do not alter it.
4. Same submission ID/Visit/authenticated technician receives an idempotent ACK; mismatched ID, Visit, or technician cannot receive that ACK; failed unmatched unique conflicts remain failures.
5. Local pending snapshot and submission ID cannot be replaced; restart/retries transmit the original values; acknowledgment updates only its exact record.
6. Authentication expiry halts in-flight batch and manual/background authenticated retries, preserves offline records, and recovery is limited to the original technician.
7. Required photo bytes survive offline capture, restart and auth/network interruption and are durably retrievable through the Report's stable evidence association after successful upload.
8. Existing ownership rules, Package 1 F-02 concurrency/transaction guarantees, and unrelated Property/Service workflows remain intact.
9. Each package passes its focused and relevant regression tests, full diff review, self-review, and `git diff --check` before the next package begins.
10. Review is non-persisting and does not finalize; edits are reflected after reopening it; canceled confirmation has no effect; explicit confirmation creates exactly one definitive snapshot whose Report content equals the last Review.
11. Request correction remains a separate, partially implemented operational/audit process; applying it cannot alter the immutable submitted Report or its original attribution.
12. Any server validation error or material content mismatch leaves no accepted submission, no committed source changes, and no terminal server-side Service; the rejected local snapshot remains intact and requires explicit correction/review/confirmation.

## 12. Existing Components to Preserve

- `completion_submissions` JSONB plus stable `submission_id` and authenticated `technician_id` as the Report identity/payload foundation.
- Existing IndexedDB completion outbox and technician-scoped records; correct write/ACK behavior instead of replacing the store or adding a generic queue.
- `POST /api/visits/:id/complete` transaction that locks the Visit and commits accepted submission, applied work, terminal status, and effects together. Preserve Package 1 F-02 guarantees.
- Existing report service as the output boundary, changing its data source rather than rewriting unrelated presentation.
- Existing Request correction endpoint, `corrections` records, Dispatch queue/Apply transaction, and before/after audit. Preserve this mechanism; make the submitted Report read from its accepted snapshot so operational edits are not presented as changes to the original Report.
- Current distinct Visit records per Service and Property relationship; no Property closure.
- Existing local `photos` Blob store and helpers, if verified adequate for capture metadata, extended only as needed for durability.
- Existing photo upload endpoint only if it can be made to durably store bytes; its current metadata-only behavior is insufficient by itself.
- No separate Dispatch Report ingestion component was found. Do not claim or build on one until a maintained Dispatch source/route is verified.

`AUTHENTICATION-ARCHITECTURE.md` is explicitly an approved target specification marked **NOT YET IMPLEMENTED** and proposes broader `Person`/`Device`/`ApplicationAccess` concepts. Those changes are not a demonstrated dependency for this work: current completion snapshots and outbox already carry technician identity, and the established requirement here is recovery by the original technician. Keep that migration out of these packages. `PACKAGE-2-IMPLEMENTATION-PLAN.md` also describes an older baseline in places (including missing technician IDs and unscoped stores); verify current code over that plan and do not reintroduce obsolete findings.

## 13. Out-of-Scope Items

- Property Service History Context, which remains a future requirement.
- Closing or archiving a Property after any Service.
- A generic event log, report-version system, second Report table, or new queue service without a demonstrated requirement.
- Broad authentication identity/device migration from `technicians` to `Person`, `Device`, or `ApplicationAccess`.
- Redesign of address-level Weigh-In operational data beyond snapshotting the values used in a Report.
- Unrelated Dispatch Reports/equipment/refrigerant analytics changes.
- Corrections workflow replacement/redesign. Preserve current Request correction behavior. Showing the immutable Report alongside correction before/after details is a future UI decision and not part of Package 1.
- Speculative media platform, storage vendor, retention system, or infrastructure before the required evidence decision is made.

## 14. Unresolved Decisions

1. **Required evidence policy:** Which photo categories are mandatory for which Service/Report types? Does Report acceptance wait until all required bytes are durably uploaded, or may the Report be accepted with a clearly pending evidence state?
2. **Durable image storage:** Current code has no verified durable image-byte store. Approve the narrowest storage option, retention/deletion policy, size limits, and access authorization before Package 3. This is a demonstrated prerequisite if Reports must retain retrievable images.

**Closed decisions:** The completion ACK means server persistence/delivery to Dispatch; this workflow adds no human Dispatch review state. The inspected application has no update/delete path for accepted submission rows, so this package relies on application write-once behavior and existing constraints; it does not add a trigger for privileged manual SQL changes. Production credential governance remains an operational control.

**Package 1 data gate:** The source tree cannot establish whether deployed data contains duplicate accepted rows or legacy terminal Visits without submission rows. Run the pre-migration audit before rollout. If duplicates exist, migration remains stopped until explicit row-level adjudication; if legacy rows exist, preserve them as legacy and do not fabricate immutable snapshots. This is a data-dependent rollout blocker, not an unresolved product rule.

**Closed by this decision:** Local offline preview is allowed; server material differences reject and roll back; acceptance-time technician name is frozen from server state; corrections preserve the original Report and existing workflow, while concurrent-open correction prevention and Dispatch side-by-side presentation are outside Package 1.

## Self-Review Record

- **Verified against:** `AGENTS.md`, `REPORT-SNAPSHOT-CONTRACT.md`, `REPORT-LIFECYCLE-COMPLIANCE-AUDIT.md`, `AUTHENTICATION-ARCHITECTURE.md`, `PACKAGE-2-IMPLEMENTATION-PLAN.md`, current completion/report/auth/photo source and relevant tests.
- **Classification discipline:** Existing behavior, established requirements, proposed changes, and unverified product/storage decisions are labeled separately. The authentication architecture is not represented as implemented; stale Package 2 claims are subordinated to current code evidence.
- **Scope:** This document is planning only. It does not authorize or perform implementation and does not modify existing architecture documents.

## Self-Review: Review and Correction

- Review is a non-persisting preview and does not finalize the Service. Only explicit final confirmation creates the definitive snapshot/outbox record; cancel returns to Review.
- Current report generators are database-backed and cannot accurately preview an unsaved draft unchanged; use a shared projection/formatter to make Review and final content agree.
- Request correction is classified partially implemented based on verified UI, endpoint authorization, database record, Dispatch Apply transaction, and audit. Apply does not directly update accepted JSONB but changes rows used by current report rendering; snapshot-backed rendering is the smallest correction that protects the original.
