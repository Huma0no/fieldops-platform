# Package 2 — Implementation Plan: Legacy Sessions & Offline Data Isolation

**Status:** Final Pre-Implementation Verified Plan — **AWAITING IMPLEMENTATION AUTHORIZATION (NOT YET IMPLEMENTED)**  
**Input Documents:**
- [`AGENTS.md`](../../AGENTS.md)
- [`docs/architecture/LEGACY-SESSION-OFFLINE-AUDIT.md`](./LEGACY-SESSION-OFFLINE-AUDIT.md)
- [`docs/architecture/AUTHENTICATION-ARCHITECTURE.md`](./AUTHENTICATION-ARCHITECTURE.md)
- [`docs/architecture/AUTHENTICATION-BOOTSTRAP.md`](./AUTHENTICATION-BOOTSTRAP.md)
- [`docs/OFFLINE-FIRST-CONTRACT.md`](../OFFLINE-FIRST-CONTRACT.md)

---

## Classification Key

Every statement in this plan is explicitly classified:

- **`ESTABLISHED REQUIREMENT`** — Mandatory rule approved in `AGENTS.md`, `AUTHENTICATION-ARCHITECTURE.md`, `AUTHENTICATION-BOOTSTRAP.md`, `OFFLINE-FIRST-CONTRACT.md`, or the Package 2 task specifications.
- **`VERIFIED CODEBASE FACT`** — Behavior confirmed directly in the current repository code (`src/`, `frontend/`, `tests/`).
- **`NEW RECOMMENDATION`** — Proposed minimal technical design for Package 2 awaiting implementation authorization.

---

## 1. Verified Problems & Root Causes

### Problem P-1: Deactivated Technicians Retain Dormant Tokens That Reactivate Silently (`VERIFIED CODEBASE FACT`)
- **Code Evidence:** [`src/routes/technicians.js:64-103`](../../src/routes/technicians.js#L64-L103), [`src/routes/technicians.js:131-145`](../../src/routes/technicians.js#L131-L145), [`src/middleware/auth.js:15-23`](../../src/middleware/auth.js#L15-L23).
- **Root Cause:** `PATCH /api/dispatch/technicians/:id/deactivate` sets `technicians.is_active = false` inside a transaction and returns active visits to the Lobby, but does not delete the technician's rows in `device_tokens` or `invite_codes`. When `PATCH /api/dispatch/technicians/:id/reactivate` later sets `is_active = true`, all historical tokens for that technician become valid again without a new invitation.

### Problem P-2: Legacy Tokens Lack Application Scope and Device Binding (`VERIFIED CODEBASE FACT`)
- **Code Evidence:** [`src/db/schema.sql:423-436`](../../src/db/schema.sql#L423-L436), [`src/middleware/auth.js:7-32`](../../src/middleware/auth.js#L7-L32), [`frontend/shared/api.js:17,39-40`](../../frontend/shared/api.js#L17), [`frontend/dispatch/src/lib/auth.jsx:11-29`](../../frontend/dispatch/src/lib/auth.jsx#L11-L29).
- **Root Cause:** `device_tokens` stores only `(token, technician_id, created_at)` in plaintext with no `application` column (`Dispatch` vs. `FieldOps`) and no `Device` record. Assigning application scope to legacy tokens based solely on `technicians.role` is unsafe because tokens were unscoped and shared via `localStorage.deviceToken`.

### Problem P-3: Completion Submissions Lack Immutable Author Identity and Can Be Accepted Under Another Technician's Identity (`VERIFIED CODEBASE FACT`)
- **Code Evidence:** [`frontend/pwa/src/lib/completion-submission.mjs:42-159`](../../frontend/pwa/src/lib/completion-submission.mjs#L42-L159), [`src/routes/completion.js:120-262`](../../src/routes/completion.js#L120-L262).
- **Root Cause:**
  1. `createCompletionSnapshot()` and `createPendingCompletionSubmission()` omit `technicianId` from both the IndexedDB `completionSubmissions` envelope and its frozen `snapshot`.
  2. `retryPendingCompletionSubmissions()` sends all `lifecycle === 'pending'` records using whatever Bearer token is currently in `localStorage.deviceToken`.
  3. On the backend (`POST /api/visits/:id/complete`), `src/routes/completion.js` checks `lockedVisit.technician_id === req.technician.id` (line 185) and inserts `req.technician.id` into `completion_submissions.technician_id` (line 256), but never verifies who authored the `snapshot`. If a visit was reassigned from Technician A to Technician B, Technician B's client (or a bypassed client guard) can submit Technician A's offline `snapshot` and have it accepted and recorded under Technician B's identity.

### Problem P-4: IndexedDB Stores and Delta Sync Lack Per-Technician Isolation (`VERIFIED CODEBASE FACT`)
- **Code Evidence:** [`frontend/pwa/src/lib/db.js:29-43,87-237`](../../frontend/pwa/src/lib/db.js#L29-L43), [`frontend/pwa/src/screens/my-calls.js:110-151`](../../frontend/pwa/src/screens/my-calls.js#L110-L151), [`frontend/pwa/src/screens/workspace.js:103-121`](../../frontend/pwa/src/screens/workspace.js#L103-L121), [`frontend/pwa/src/screens/reports.js:95-152`](../../frontend/pwa/src/screens/reports.js#L95-L152), [`frontend/pwa/src/lib/sync.js:19-30`](../../frontend/pwa/src/lib/sync.js#L19-L30).
- **Root Cause:** All IndexedDB helpers in `db.js` read and write across a single shared store without filtering or scoping by `technicianId`, and `sync.js` uses a single global `localStorage` key (`sync:lastAt`).

### Problem P-5: Background Polling and Retry Listeners Continue Running After `401` (`VERIFIED CODEBASE FACT`)
- **Code Evidence:** [`frontend/shared/api.js:37-45`](../../frontend/shared/api.js#L37-L45), [`frontend/pwa/app.js:100-104`](../../frontend/pwa/app.js#L100-L104), [`frontend/pwa/src/lib/sync.js:70-81`](../../frontend/pwa/src/lib/sync.js#L70-L81), [`frontend/pwa/src/lib/completion-submission.mjs:161-173`](../../frontend/pwa/src/lib/completion-submission.mjs#L161-L173).
- **Root Cause:** On `401`, `app.js` clears `localStorage.deviceToken` and `localStorage.technician` and renders `AuthScreen`, but never calls `stopSync()`, never detaches the `online` retry listener in `completion-submission.mjs`, and never clears `sessionStorage` workspace/cancel/GPS state.

---

## 2. Verification 1 — IndexedDB Compatibility for Technician-Scoped Visit Keys

### 2.1 Existing Object Store Definitions and Key Paths (`VERIFIED CODEBASE FACT`)

In [`frontend/pwa/src/lib/db.js:12-45`](../../frontend/pwa/src/lib/db.js#L12-L45), database `fieldops` (`DB_VERSION = 2`) defines five object stores:

| Object Store | Definition in `db.js` | Key Type | Indexes |
| :--- | :--- | :--- | :--- |
| `catalog` | `{ keyPath: 'type' }` (`db.js:27`) | Inline string key (`'items'`, `'equipment'`, `'lineset-configs'`, `'version'`) | None |
| `visits` | `{ keyPath: 'id' }` (`db.js:30`) | Inline string key (`record.id`) | None |
| `queue` | `{ keyPath: 'id', autoIncrement: true }` (`db.js:33`) | Auto-increment numeric key | None |
| `completionSubmissions` | `{ keyPath: 'submissionId' }` (`db.js:36`) | Inline string key (`record.submissionId`) | `lifecycle` (`unique: false`), `visitId` (`unique: false`) |
| `photos` | `{ keyPath: 'id', autoIncrement: true }` (`db.js:41`) | Auto-increment numeric key | `visitId` (`unique: false`) |

### 2.2 Existing Records Stored Under `visits` (`keyPath: 'id'`) (`VERIFIED CODEBASE FACT`)

Three record shapes can exist in the `visits` object store today under bare key `record.id === visitId`:

1. **`LocalVisitDraft` only (`workspace.js:119-120` -> `saveLocalVisitDraft` at `db.js:117-120`):**
   - Created by `createLocalVisitDraft(detail, options)` ([`workspace-visit.mjs:170-215`](../../frontend/pwa/src/lib/workspace-visit.mjs#L170-L215)).
   - Has `id: detail.id`, `draftSchemaVersion: 1`, `lifecycle: 'draft'`, `technicianId: detail.technicianId ?? null`, and `_items` (array of items with non-empty string `id`).
2. **My Calls Summary only (`my-calls.js:117` -> `cacheMyCallsVisits` at `db.js:135-146`):**
   - Stored as `{ id: visit.id, _myCallsSummary: visit }`, where `visit` came from `GET /api/visits/mine` ([`src/routes/visits.js:178-188`](../../src/routes/visits.js#L178-L188)) and contains `visit.technicianId`.
3. **Combined `LocalVisitDraft` + `_myCallsSummary` (`db.js:141-143`):**
   - When `cacheMyCallsVisits(visits)` finds an existing `LocalVisitDraft` at `byId.get(visit.id)`, it writes `{ ...existing, _myCallsSummary: visit }`.

### 2.3 Complete Audit of `visits` Store Readers, Writers, Updaters, and Deleters (`VERIFIED CODEBASE FACT`)

| Function in `db.js` | External Call Sites | How Callers Use `record.id` |
| :--- | :--- | :--- |
| `setVisit(visit)` (`db.js:87-90`) | Internal to `db.js`, plus direct test seeding in `tests/local-visit-draft.test.js:47,54`. | IndexedDB extracts inline primary key from `visit.id`. |
| `getVisit(id)` (`db.js:92-95`) | Internal to `db.js` (`getLocalVisitDraft`). | Looks up primary key `id` in `visits`. |
| `getAllVisits()` (`db.js:97-100`) | Internal to `db.js` (`getAllLocalVisitDrafts`, `cacheMyCallsVisits`, `getCachedMyCallsVisits`). | Returns all records in `visits`. |
| `deleteVisit(id)` (`db.js:102-105`) | Internal to `db.js` (`deleteLocalVisitDraft`). | Deletes primary key `id` in `visits`. |
| `saveLocalVisitDraft(draft)` (`db.js:117-120`) | `workspace.js:120` (initial draft save) and `workspace.js:1370` (`persistCurrentDraft`), plus `tests/local-visit-draft.test.js` and `tests/completion-submission.test.js`. | **Critical:** `workspace.js` keeps holding the in-memory `visit` reference after calling `saveLocalVisitDraft(visit)` and uses `visit.id` in API paths (`/visits/${visit.id}/services`, `/items`, `/weigh-in/...`, `/photos`, `/notes`) and in `createPendingCompletionSubmission(draft)` where `snapshot.visitId = draft.id` (`completion-submission.mjs:49`). |
| `getLocalVisitDraft(id)` (`db.js:122-125`) | `workspace.js:104` (mount) and `workspace.js:1296` (before report submit), plus tests. | Expects `draft.id === visitId`. |
| `getAllLocalVisitDrafts()` (`db.js:127-130`) | `my-calls.js:136` (`refreshLocalDraftState`), plus tests. | Passes returned drafts to `localMyCallsVisits` (`my-calls-visit.mjs:21-34`, which maps `id: draft.id` and compares against `serverVisits` IDs) and `confirmedLocalCancelVisitIds` (`workspace-visit.mjs:101-107`, which returns a `Set` of `draft.id`). |
| `cacheMyCallsVisits(visits)` (`db.js:135-146`) | `my-calls.js:117`, plus `tests/completion-submission.test.js:127`. | Passes server `remoteVisits` array where each `visit.id` is the canonical visit UUID. |
| `getCachedMyCallsVisits()` (`db.js:148-153`) | `my-calls.js:137` (`refreshLocalDraftState`), plus `tests/completion-submission.test.js:136`. | Expects each returned summary object to have `summary.id === visitId`. |
| `deleteLocalVisitDraft(id)` (`db.js:155-157`) | Exported by `db.js` (currently no screen call site). | Deletes by `visitId`. |

### 2.4 Technical Safety Evaluation: Retaining `DB_VERSION = 2` with Scoped Internal Keys (`VERIFIED CODEBASE FACT` + `NEW RECOMMENDATION`)

1. **Does changing the internal key string format require a `DB_VERSION` upgrade?**
   - **No (`VERIFIED CODEBASE FACT`).** In IndexedDB, an object store created with `{ keyPath: 'id' }` and no secondary indexes accepts any valid key value (including any string) in the `id` property of stored objects. Changing the string value stored in `storedRecord.id` from `'visit-1'` to `'tech-001::visit-1'` does not change the store's `keyPath` (`'id'`) or index metadata, so no `DB_VERSION` bump or `onupgradeneeded` schema change is required.
2. **What is required so callers and existing records remain 100% compatible?**
   - **Requirement A — Never mutate the caller's in-memory `draft.id`:**
     - Because `workspace.js` continues using the in-memory `visit` object after `saveLocalVisitDraft(visit)` (and `createCompletionSnapshot` sets `snapshot.visitId = draft.id`), `saveLocalVisitDraft` must construct a shallow copy for IndexedDB storage (`{ ...draft, id: makeScopedVisitKey(techId, rawVisitId), visitId: rawVisitId, technicianId: techId }`) without mutating `draft.id` in memory.
   - **Requirement B — Always unwrap `id: record.visitId ?? record.id` on read:**
     - Whenever `getLocalVisitDraft` or `getAllLocalVisitDrafts` reads a record from `visits`, it must restore `id: record.visitId ?? record.id` on the returned object so every caller (`workspace.js`, `my-calls.js`, `my-calls-visit.mjs`, `completion-submission.mjs`) receives the canonical `visitId` in `draft.id`.
   - **Requirement C — Non-destructive co-existence with legacy bare-key records (`id === visitId`):**
     - Pre-Package-2 records in `visits` are stored at bare key `id = visitId`.
     - If Technician A (`tech-001`) has a legacy bare-key record `visits['visit-1']` with `technicianId: 'tech-001'`, and Technician B (`tech-002`) logs into the same device after `visit-1` was reassigned to Technician B:
       - Technician B's `saveLocalVisitDraft` and `cacheMyCallsVisits` write exclusively to scoped key `'tech-002::visit-1'`.
       - Because `'tech-002::visit-1' !== 'visit-1'`, Technician B's writes **never overwrite** Technician A's legacy bare-key record at `'visit-1'`.
     - When Technician A (`tech-001`) reads via `getLocalVisitDraft('visit-1', 'tech-001')` or `getAllLocalVisitDrafts('tech-001')`:
       - `db.js` checks `'tech-001::visit-1'` first; if absent, it reads legacy bare key `'visit-1'` and returns it **only if** `record.technicianId === 'tech-001'`.
       - If the legacy bare-key record had a mismatched `_myCallsSummary` attached by pre-Package-2 `cacheMyCallsVisits` (where `record._myCallsSummary?.technicianId !== 'tech-001'`), `db.js` strips the mismatched `_myCallsSummary` when returning Technician A's draft.
     - If a legacy bare-key record `visits['visit-1']` has `technicianId == null` (ambiguous ownership), it matches no `technicianId`, is never returned by any technician-scoped reader, and is never overwritten by scoped writes (`techId::visit-1`)—remaining safely quarantined in place.
3. **Why Historical `LocalVisitDraft` Records With Non-Null `technicianId` differ from Historical `completionSubmissions` Records:**
   - **Historical `completionSubmissions` (`technicianId === undefined`):** Have **no** `technicianId` property on the record or `snapshot`. As proven in Design Review Issue 1, their author cannot be reliably inferred from `LocalVisitDraft.technicianId` because `visits[visitId]` is a separate mutable store. Thus, all pre-Package-2 `completionSubmissions` lacking `technicianId` are quarantined (`technicianId: null`).
   - **Historical `LocalVisitDraft` (`draft.technicianId`):** Already carries `draft.technicianId` directly on the draft object (`workspace-visit.mjs:195`), populated from `GET /api/visits/:id` (`src/routes/visits.js:243-245,282`). However, if a pre-Package-2 `LocalVisitDraft` has `draft.technicianId == null`, its ownership is ambiguous and it is quarantined in place (`getLocalVisitDraft` / `getAllLocalVisitDrafts` require non-empty `draft.technicianId === activeTechnicianId`).

---

## 3. Verification 2 — Backend Ownership Enforcement Across All Delivery Paths

### 3.1 Inventory of All Backend and Frontend Completion Delivery Paths (`VERIFIED CODEBASE FACT`)

A repository-wide search for `/complete` and `completion_submissions` confirms:

1. **Backend Route:** There is **only one** backend endpoint that accepts completion submissions or transitions a visit to a completed/cancelled/temporarily state with report generation:
   - `POST /api/visits/:id/complete` in [`src/routes/completion.js:120-387`](../../src/routes/completion.js#L120-L387), guarded by `authenticate` and `requireRole('technician')`.
2. **Frontend Call Sites:** There is **only one** frontend function that calls `POST /api/visits/:id/complete`:
   - `deliverCompletionSubmission(record)` in [`frontend/pwa/src/lib/completion-submission.mjs:91-137`](../../frontend/pwa/src/lib/completion-submission.mjs#L91-L137) (line 103: `api.post('/visits/${current.visitId}/complete', { submissionId: current.submissionId, snapshot: current.snapshot })`).
   - All four frontend triggers flow through `deliverCompletionSubmission()`:
     1. Immediate delivery on Workspace submit ([`workspace.js:1301`](../../frontend/pwa/src/screens/workspace.js#L1301)).
     2. Boot / `online` event retry via `startCompletionSubmissionRetry()` -> `retryPendingCompletionSubmissions()` ([`completion-submission.mjs:142-173`](../../frontend/pwa/src/lib/completion-submission.mjs#L142-L173), invoked from [`queue.js:12-14`](../../frontend/pwa/src/lib/queue.js#L12-L14) and [`app.js:114,147`](../../frontend/pwa/app.js#L114)).
     3. Reports screen mount background retry ([`reports.js:76`](../../frontend/pwa/src/screens/reports.js#L76)).
     4. Reports screen manual retry buttons (`retrySingleSubmission` and `retryAllPending` in [`reports.js:190-222`](../../frontend/pwa/src/screens/reports.js#L190-L222)).

### 3.2 Audit of All Execution Branches Inside `POST /api/visits/:id/complete` (`VERIFIED CODEBASE FACT`)

Inspecting [`src/routes/completion.js:120-387`](../../src/routes/completion.js#L120-L387) revealed two critical backend gaps in how request formats and branches are currently handled:

#### Finding B-1: Bypass When `snapshot` Is Sent With `rawSubmissionId == null` (`VERIFIED CODEBASE FACT`)
- **Code Location:** [`src/routes/completion.js:124-148,251-262`](../../src/routes/completion.js#L124-L148).
- **Current Code:**
  ```js
  const { submissionId: rawSubmissionId, snapshot } = req.body ?? {};
  const submissionId = typeof rawSubmissionId === 'string' ? rawSubmissionId.trim() : null;
  const snapshotSubmissionId = typeof snapshot?.submissionId === 'string' ? snapshot.submissionId.trim() : null;
  if (
    rawSubmissionId != null && (
      typeof rawSubmissionId !== 'string' ||
      !submissionId ||
      submissionId.length > MAX_SUBMISSION_ID_LENGTH ||
      !snapshot ||
      snapshotSubmissionId !== submissionId ||
      snapshot.visitId !== id
    )
  ) {
    return res.status(400).json({ error: 'Invalid completion submission' });
  }
  if (rawSubmissionId == null && snapshot?.submissionId != null) {
    if (
      typeof snapshot.submissionId !== 'string' ||
      !snapshotSubmissionId ||
      snapshotSubmissionId.length > MAX_SUBMISSION_ID_LENGTH
    ) {
      return res.status(400).json({ error: 'Invalid completion submission' });
    }
  }
  normalizedSubmissionId = submissionId;
  ```
- **Vulnerability Found:**
  - If a request sends a `snapshot` object with `rawSubmissionId == null` (omitting top-level `submissionId`):
    1. `snapshot.visitId !== id` is **never checked** (it is only inside the `rawSubmissionId != null` branch).
    2. `normalizedSubmissionId` (`submissionId`) remains `null`, so the `completion_submissions` idempotency check (line 190: `if (submissionId)`) and `INSERT INTO completion_submissions` (line 251: `if (submissionId)`) are **completely skipped**.
    3. Yet line 260 (`if (snapshot && !isCancel) resolvedTotal = await applySnapshotWork(client, lockedVisit, snapshot);`) **still executes `applySnapshotWork`**, mutating `visit_services`, `visit_items`, and `weigh_in_data` from an unrecorded `snapshot`!
- **Required Fix (`NEW RECOMMENDATION`):**
  - Any request where `rawSubmissionId != null || snapshot != null` must require **both** `rawSubmissionId` and a plain-object `snapshot` (`typeof snapshot === 'object' && snapshot !== null && !Array.isArray(snapshot)`), with `snapshotSubmissionId === submissionId` and `snapshot.visitId === id`. Sending `snapshot` without top-level `submissionId` (or vice versa) must always return `400 { error: 'Invalid completion submission' }`.

#### Finding B-2: Missing Author Check (`snapshot.technicianId === req.technician.id`) Across Reassigned and Terminal Branches (`VERIFIED CODEBASE FACT`)
- **Code Location:** [`src/routes/completion.js:124-258,324-384`](../../src/routes/completion.js#L124-L258).
- **Trace of All 5 Downstream Execution Branches in `POST /api/visits/:id/complete`:**
  1. **Branch 1 — Preflight Visit Check (`lines 150-162`):** Checks `visit.technician_id === req.technician.id`. Does **not** detect that `snapshot` was created by Technician A if the visit was reassigned to Technician B.
  2. **Branch 2 — In-Transaction `FOR UPDATE` + `completion_submissions` Idempotency Return (`lines 172-209`):** Locks `visits` (`FOR UPDATE`), checks `lockedVisit.technician_id === req.technician.id`, and if `submissionId` already exists in `completion_submissions`, checks `existing.technician_id === req.technician.id`.
  3. **Branch 3 — In-Transaction `TERMINAL_STATUSES` Early Return (`lines 211-215`):** If `lockedVisit.status` is `'completed'`, `'temporarily'`, or `'cancelled'`, generates and returns the report with `{ acknowledged: true, submissionId }` without checking `snapshot.technicianId`.
  4. **Branch 4 — Main Completion Mutation & `INSERT INTO completion_submissions` (`lines 217-288`):** Inserts `req.technician.id` as `completion_submissions.technician_id` and applies `snapshot` work. If `visit` was reassigned from Technician A to Technician B, Technician A's `snapshot` would be applied and attributed to Technician B unless `snapshot.technicianId === req.technician.id` was verified.
  5. **Branch 5 — `23505` Concurrent Duplicate-Key Recovery (`lines 324-384`):** Acquires `recoveryClient`, locks `visits` (`FOR UPDATE`), checks `lockedRecoveryVisit.technician_id === req.technician.id` and `matchingSubmission.technician_id === req.technician.id`, and returns the report.
- **Required Fix (`NEW RECOMMENDATION`):**
  - Validate the declared submission owner **at the very top of `POST /api/visits/:id/complete` (before line 150, prior to any DB query or transaction)** and preserve the existing Package 1 F-02 checks inside the main and recovery transactions:
    1. Whenever `snapshot != null` (or `rawSubmissionId != null`), require `typeof snapshot?.technicianId === 'string' && snapshot.technicianId.trim().length > 0` (else `400 { error: 'Invalid completion submission' }`).
    2. If `req.body?.technicianId !== undefined`, require `typeof req.body.technicianId === 'string' && req.body.technicianId.trim().length > 0`, and if `snapshot != null`, require `req.body.technicianId.trim() === snapshot.technicianId.trim()` (else `400 { error: 'Invalid completion submission' }`).
    3. Compute `declaredTechnicianId = (snapshot?.technicianId ?? req.body?.technicianId)?.trim() ?? null`.
    4. **If `declaredTechnicianId !== null && declaredTechnicianId !== req.technician.id`, immediately return `403 { error: 'This visit is not assigned to you' }`** before executing any SQL query, locking any row, generating any report, or mutating any data.
    5. When inserting into `completion_submissions` (line 256), `declaredTechnicianId` is guaranteed to equal `req.technician.id`.
  - **What about non-snapshot requests (`rawSubmissionId == null && snapshot == null`)?**
    - As verified in Section 3.1, no frontend code in FieldOps or Dispatch ever sends a non-snapshot request to `POST /api/visits/:id/complete`; only legacy server-side integration tests in `tests/completion.test.js` call `/complete` without `{ submissionId, snapshot }` to complete visits whose services/items are already in PostgreSQL.
    - When `rawSubmissionId == null && snapshot == null`, `applySnapshotWork` is never called. If `req.body?.technicianId !== undefined` is provided on such a request, step 2 & 4 above still validate it (`400` if invalid, `403` if `!== req.technician.id`).

### 3.3 Confirming the Frontend Cannot Alter the Effective Owner After Visit Reassignment (`VERIFIED CODEBASE FACT` + `NEW RECOMMENDATION`)

1. **Snapshot Immutability at Creation (`completion-submission.mjs:42-89`):**
   - `createCompletionSnapshot` freezes the snapshot (`Object.freeze(immutableCopy(snapshot))`) with `snapshot.technicianId` set to the authenticated technician who created the submission, and `createPendingCompletionSubmission` requires `draft.technicianId === activeTechnicianId`.
2. **No Re-Signing on Delivery or Retry (`completion-submission.mjs:91-159`):**
   - `deliverCompletionSubmission` and `retryPendingCompletionSubmissions` never rebuild or modify `current.snapshot`; they transmit `current.snapshot` as originally frozen, and only if `current.technicianId === activeTechnicianId && current.snapshot?.technicianId === activeTechnicianId`.
3. **Scoped Pending Lookup Prevents Overwrite (`completion-submission.mjs:70-76`):**
   - When `createPendingCompletionSubmission` checks for an existing pending submission for `draft.id`, it queries `getPendingCompletionSubmissions(resolvedTechId)` (`entry.visitId === draft.id && entry.technicianId === resolvedTechId`), so Technician B can never reuse Technician A's `submissionId` or overwrite Technician A's pending submission record.

---

## 4. Final Recommended Implementation Approach

### 4.1 Backend Changes (`src/routes/technicians.js` & `src/routes/completion.js`) (`NEW RECOMMENDATION`)

1. **[`src/routes/technicians.js`](../../src/routes/technicians.js#L64-L103) (`PATCH /api/dispatch/technicians/:id/deactivate`):**
   - Inside the existing `BEGIN ... COMMIT` transaction, add:
     ```js
     await client.query('DELETE FROM device_tokens WHERE technician_id = $1', [id]);
     await client.query('DELETE FROM invite_codes WHERE technician_id = $1', [id]);
     ```
2. **[`src/routes/completion.js`](../../src/routes/completion.js#L120-L165) (`POST /api/visits/:id/complete`):**
   - Replace the top-of-route `submissionId` / `snapshot` validation (lines 124–148) with:
     ```js
     const { submissionId: rawSubmissionId, technicianId: rawBodyTechnicianId, snapshot } = req.body ?? {};
     const isPlainSnapshot = Boolean(snapshot) && typeof snapshot === 'object' && !Array.isArray(snapshot);
     const submissionId = typeof rawSubmissionId === 'string' ? rawSubmissionId.trim() : null;
     const snapshotSubmissionId = isPlainSnapshot && typeof snapshot.submissionId === 'string'
       ? snapshot.submissionId.trim()
       : null;
     const snapshotTechnicianId = isPlainSnapshot && typeof snapshot.technicianId === 'string'
       ? snapshot.technicianId.trim()
       : null;
     const bodyTechnicianId = typeof rawBodyTechnicianId === 'string'
       ? rawBodyTechnicianId.trim()
       : null;

     if (rawBodyTechnicianId !== undefined && !bodyTechnicianId) {
       return res.status(400).json({ error: 'Invalid completion submission' });
     }

     if (rawSubmissionId != null || snapshot != null) {
       if (
         typeof rawSubmissionId !== 'string' ||
         !submissionId ||
         submissionId.length > MAX_SUBMISSION_ID_LENGTH ||
         !isPlainSnapshot ||
         snapshotSubmissionId !== submissionId ||
         snapshot.visitId !== id ||
         !snapshotTechnicianId ||
         (rawBodyTechnicianId !== undefined && bodyTechnicianId !== snapshotTechnicianId)
       ) {
         return res.status(400).json({ error: 'Invalid completion submission' });
       }
     }

     const declaredTechnicianId = snapshotTechnicianId ?? bodyTechnicianId;
     if (declaredTechnicianId && declaredTechnicianId !== req.technician.id) {
       return res.status(403).json({ error: 'This visit is not assigned to you' });
     }
     normalizedSubmissionId = submissionId;
     ```
   - All existing Package 1 (F-02) `SELECT ... FOR UPDATE` locks, `lockedVisit.technician_id !== req.technician.id` checks, `existing.technician_id !== req.technician.id` checks, and `23505` `recoveryClient` guards remain completely intact.

### 4.2 Frontend Changes (`frontend/pwa/`) (`NEW RECOMMENDATION`)

1. **[`frontend/pwa/src/lib/db.js`](../../frontend/pwa/src/lib/db.js) (Retaining `DB_VERSION = 2`):**
   - Export `getActiveTechnicianId()` reading `localStorage.getItem('deviceToken')` and `JSON.parse(localStorage.getItem('technician') ?? '{}').id` (returns trimmed non-empty string or `null`).
   - Add internal helpers for `visits` store key scoping:
     - `scopedVisitKey(technicianId, visitId)` -> `` `${technicianId}::${visitId}` ``.
     - `unwrapVisitRecord(record)` -> returns `{ ...record, id: record.visitId ?? record.id }`.
   - Enforce fail-closed `technicianId` scoping across all stores:
     - `saveLocalVisitDraft(draft, technicianId = draft?.technicianId ?? getActiveTechnicianId())`: require non-empty `technicianId` (and if `draft.technicianId` is non-null, require `draft.technicianId === technicianId`); set `draft.technicianId = technicianId`; store `{ ...draft, id: scopedVisitKey(technicianId, draft.id), visitId: draft.id, technicianId }` in `visits` without mutating `draft.id` in memory. If a legacy bare-key record `visits[draft.id]` exists with `record.technicianId === technicianId`, delete the bare duplicate in the same transaction.
     - `getLocalVisitDraft(visitId, technicianId = getActiveTechnicianId())`: if `!technicianId`, return `null`. Check `scopedVisitKey(technicianId, visitId)` first; if absent, check bare `visitId` and accept only if `record?.technicianId === technicianId`. Unwrap `id: visitId` (and strip any attached `_myCallsSummary` whose `technicianId !== technicianId`) before validating `isLocalVisitDraft`.
     - `getAllLocalVisitDrafts(technicianId = getActiveTechnicianId())`: if `!technicianId`, return `[]`. Filter `getAllVisits()` for records where `record.technicianId === technicianId`, unwrap `id: record.visitId ?? record.id`, validate `isLocalVisitDraft`, and deduplicate by `id`.
     - `cacheMyCallsVisits(visits, technicianId = getActiveTechnicianId())`: if `!technicianId`, return immediately. Write each summary under `scopedVisitKey(technicianId, visit.id)` with `_myCallsSummary: { ...visit, technicianId }` (preserving any existing `LocalVisitDraft` at that scoped key). Remove stale `_myCallsSummary` entries belonging to that same `technicianId` not present in `visits` (preserving active `LocalVisitDraft` records and never touching other technicians' records).
     - `getCachedMyCallsVisits(technicianId = getActiveTechnicianId())`: if `!technicianId`, return `[]`. Return `_myCallsSummary` entries where `(record._myCallsSummary?.technicianId ?? record.technicianId) === technicianId`.
     - `deleteLocalVisitDraft(visitId, technicianId = getActiveTechnicianId())`: if `!technicianId`, return immediately. Delete `scopedVisitKey(technicianId, visitId)`, and delete bare `visitId` only if `record?.technicianId === technicianId`.
     - `getCompletionSubmission(submissionId, technicianId = getActiveTechnicianId())`, `getPendingCompletionSubmissions(technicianId = getActiveTechnicianId())`, `getAllCompletionSubmissions(technicianId = getActiveTechnicianId())`, `markCompletionSubmissionDelivered(submissionId, acknowledgment, technicianId = getActiveTechnicianId())`: fail-closed (`null`/`[]`) when `!technicianId`; require `record.technicianId === technicianId && record.snapshot?.technicianId === technicianId`. (Pre-Package-2 records without `technicianId` remain quarantined in place.)
     - `addPhoto(visitId, tag, blob, technicianId = getActiveTechnicianId())`, `getPhotosForVisit(visitId, technicianId = getActiveTechnicianId())`, `deletePhotosForVisit(visitId, technicianId = getActiveTechnicianId())`: require/filter by `record.technicianId === technicianId`.
     - `enqueue(entry, technicianId = getActiveTechnicianId())`, `getQueue(technicianId = getActiveTechnicianId())`: require/filter by `record.technicianId === technicianId`.

2. **[`frontend/pwa/src/lib/completion-submission.mjs`](../../frontend/pwa/src/lib/completion-submission.mjs):**
   - `createCompletionSnapshot(draft, { now, id, checklistAnswers, technicianId } = {})`: resolve `resolvedTechId = technicianId ?? draft?.technicianId ?? getActiveTechnicianId()`. Require non-empty `resolvedTechId` (and if both `technicianId` and `draft?.technicianId` are present, require equality). Stamp `technicianId: resolvedTechId` in `snapshot`.
   - `createPendingCompletionSubmission(draft, options)`: resolve `resolvedTechId`; query `getPendingCompletionSubmissions(resolvedTechId)` when reusing an existing `submissionId` for `draft.id`; stamp `technicianId: snapshot.technicianId` on the saved `completionSubmissions` record.
   - `deliverCompletionSubmission(record, { activeTechnicianId = getActiveTechnicianId() } = {})`: require non-empty `activeTechnicianId`; look up string targets via `getPendingCompletionSubmissions(activeTechnicianId)`; verify `current.technicianId === activeTechnicianId && current.snapshot?.technicianId === activeTechnicianId` before calling `api.post('/visits/${current.visitId}/complete', { submissionId: current.submissionId, technicianId: current.technicianId, snapshot: current.snapshot })`; reconcile duplicates only within `getPendingCompletionSubmissions(activeTechnicianId)`.
   - `retryPendingCompletionSubmissions({ activeTechnicianId = getActiveTechnicianId() } = {})`: if `!activeTechnicianId`, return `[]`; iterate over `getPendingCompletionSubmissions(activeTechnicianId)`.
   - Export `stopCompletionSubmissionRetry()` to remove the `window` `'online'` listener and reset `retryStarted = false`.

3. **[`frontend/pwa/src/lib/sync.js`](../../frontend/pwa/src/lib/sync.js) & [`frontend/pwa/app.js`](../../frontend/pwa/app.js) & Screen Call Sites:**
   - `sync.js`: use per-technician key `sync:lastAt:${technicianId}`; if `!getActiveTechnicianId()`, `poll()` calls `stopSync()` and exits before `api.get`.
   - `app.js`: on `auth:expired`, call `stopSync()`, `stopCompletionSubmissionRetry()`, and remove `sessionStorage` keys (`workspace:visitId`, `workspace:cancelConfirmedVisitId`, `workspace:cancelConfirmed`, `fo_gps_state`).
   - `workspace.js`, `my-calls.js`, `reports.js`: pass `activeTechnicianId = getActiveTechnicianId()` to all `db.js` and `completion-submission.mjs` calls, and in `workspace.js` verify `detail.technicianId === activeTechnicianId` before seeding a draft from `GET /api/visits/:id`.

---

## 5. Required Tests and Acceptance Criteria

### 5.1 Required Tests
1. **Backend (`tests/completion.test.js`, `tests/technicians.test.js`):**
   - Deactivating a technician deletes `device_tokens` and `invite_codes`; reactivating does not restore prior tokens (`401`).
   - `POST /api/visits/:id/complete` rejects a `snapshot` whose `snapshot.technicianId !== req.technician.id` with `403`—including when the visit was reassigned to `req.technician.id`, when the visit is in a terminal status, or when `submissionId` is new.
   - `POST /api/visits/:id/complete` rejects a `snapshot` with missing/empty/mismatched `technicianId` or missing top-level `submissionId` (`rawSubmissionId == null && snapshot != null`) with `400`.
   - Existing `snapshot` fixtures in `tests/completion.test.js` include `technicianId` matching the seeded technician.
2. **Frontend (`tests/completion-submission.test.js`, `tests/local-visit-draft.test.js`, `tests/my-calls-visit.test.js`):**
   - `saveLocalVisitDraft` and `getLocalVisitDraft` preserve `draft.id === visitId` in memory and on read while isolating `tech-001` and `tech-002` drafts for the same `visitId` in `visits` (`DB_VERSION = 2`).
   - Legacy bare-key `visits[visitId]` records with matching `technicianId` are read and preserved without being overwritten by another technician's writes for the same `visitId`; legacy bare-key records with `technicianId: null` remain quarantined.
   - `createPendingCompletionSubmission` stamps `technicianId` on `record` and `snapshot`; legacy `completionSubmissions` without `technicianId` remain quarantined (`[]` on read, never backfilled from `LocalVisitDraft`, never sent on retry).
   - When `activeTechnicianId` is `null` (after `401`), all technician-scoped readers return `null`/`[]` and `retryPendingCompletionSubmissions` makes zero network calls; when the original technician logs back in, their drafts and pending submissions recover and deliver idempotently (`lifecycle: 'delivered'`).

### 5.2 Acceptance Criteria
1. **Zero Cross-Technician Attribution (Client & Server):** Neither client retry nor direct `POST /api/visits/:id/complete` can ever submit or attribute Technician A's offline snapshot under Technician B's identity, even after server-side visit reassignment.
2. **Non-Destructive IndexedDB Compatibility (`DB_VERSION = 2`):** `visits` stores technician-scoped keys internally without mutating `draft.id` (`visitId`), preserves legacy bare-key drafts for their matching owner, and prevents Technician B from overwriting Technician A's draft for the same `visitId`.
3. **Strict Quarantine of Unattributed Legacy Data:** Pre-existing `completionSubmissions`, `visits`, `photos`, or `queue` records lacking `technicianId` are never backfilled from mutable state, never assigned to the active technician, and never synced.
4. **Clean `401` Halt & Same-Technician Recovery:** `401` stops `sync.js` and `online` retry listeners and clears `sessionStorage` while preserving IndexedDB records for automatic recovery when the same `technicianId` re-authenticates.
5. **Permanent Token Invalidation on Deactivation:** Deactivating a technician deletes their `device_tokens` and `invite_codes` rows so reactivation requires a new invitation.

---

## 6. Remaining Unresolved Risks or Assumptions

1. **Existing Unit Test Fixture Alignment (Known Implementation Detail, Not an Architectural Blocker):**
   - In `tests/local-visit-draft.test.js` and `tests/completion-submission.test.js`, existing test helpers call `createLocalVisitDraft({ id: 'visit-1', ... })` without setting `detail.technicianId` or `localStorage.technician`, and in `tests/completion.test.js` existing `snapshot` literals omit `snapshot.technicianId`. During Package 2 implementation, those test fixtures will be updated to include `technicianId` alongside the new isolation and quarantine tests.
2. **No Remaining Architectural Blockers:**
   - Both IndexedDB compatibility (`DB_VERSION = 2` with internal key scoping and `id: visitId` unwrapping) and backend ownership enforcement across all `POST /api/visits/:id/complete` branches have been verified against the actual codebase. The plan is ready for implementation upon user authorization.
