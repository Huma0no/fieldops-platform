# Legacy Sessions and Offline Data Isolation Audit (Package 2)

**Audit Type:** Read-Only Technical Audit & Migration Strategy  
**Target Architecture:** `docs/architecture/AUTHENTICATION-ARCHITECTURE.md`, `docs/architecture/AUTHENTICATION-BOOTSTRAP.md`  
**Baseline Commit:** `7ea37c783c143a46adde6bc7fec80bf3a737f086` (+ accepted Package 1 F-02 local changes in `src/routes/completion.js` and `tests/completion.test.js`)

---

## 1. Executive Summary

This audit evaluates the legacy authentication tables (`device_tokens`, `invite_codes`), middleware (`src/middleware/auth.js`), authentication endpoints (`src/routes/auth.js`, `src/routes/technicians.js`), and client-side offline persistence across the FieldOps PWA (`frontend/pwa/`) and Dispatch (`frontend/dispatch/`) prior to implementing the approved persistent session and unified identity architecture.

### Key Verified Facts

1. **Legacy `device_tokens` lack application scope, device metadata, and hash protection:** `device_tokens` (`src/db/schema.sql:423-427`) stores only `(token, technician_id, created_at)` in plaintext. There is no `application` column (`DISPATCH` vs `FIELDOPS`), no device identifier, no revocation timestamp, and no `last_seen_at` tracking.
2. **Legacy tokens are not invalidated upon new invite redemption or technician deactivation:**
   - Despite comments stating otherwise (`src/routes/auth.js:49`), `POST /api/auth/redeem` (`src/routes/auth.js:51-91`) never deletes previous rows in `device_tokens`; a single technician can accumulate multiple concurrent active tokens across devices.
   - `PATCH /api/dispatch/technicians/:id/deactivate` (`src/routes/technicians.js:64-103`) sets `technicians.is_active = false` without deleting rows in `device_tokens` or `invite_codes`. When `PATCH /api/dispatch/technicians/:id/reactivate` (`src/routes/technicians.js:131-145`) sets `is_active = true`, **all historical unrevoked `device_tokens` for that technician silently become active again**.
3. **One legacy token can authenticate across both surfaces on shared/unscoped endpoints and UI shells:**
   - `authenticate` (`src/middleware/auth.js:7-32`) validates only `dt.token = $1 AND t.is_active = true`. Any endpoint without `requireRole(...)` (e.g., `/api/visits/:id`, `/api/visits/:id/report-preview`, `/api/visits/:id/download`, `/api/catalog/*`, `/api/sync/changes`, `/api/chat/*`, `/api/notifications/*`, `/api/corrections/*`) accepts any valid token regardless of role or originating surface.
   - Dispatch's client auth state (`frontend/dispatch/src/lib/auth.jsx:11-29`) does not verify `technician.role` before rendering the authenticated Dispatch shell, and both apps share `localStorage.deviceToken` and `localStorage.technician` on the same origin (`frontend/shared/api.js:17,39-40`).
4. **Frontend/backend contract mismatches currently break UI-initiated invite generation, redemption, and revocation:**
   - FieldOps (`frontend/pwa/src/screens/auth.js:68,80-81`) and Dispatch (`frontend/dispatch/src/screens/Auth.jsx:27,39-40`) enforce `code.length < 8`, POST `{ inviteCode }` to `/api/auth/redeem-invite`, and read `data.deviceToken`, whereas `src/routes/auth.js:13-19,51-91` generates 6-character codes, serves `POST /api/auth/redeem` expecting `{ code }`, and returns `{ token, technician }`.
   - Dispatch's `TechnicianManager` (`frontend/dispatch/src/screens/TechnicianManager.jsx:159,174`) POSTs `{ technicianId }` to `/api/auth/generate-invite` and `/api/auth/revoke`, whereas `src/routes/auth.js:26-46,97-115` serves `POST /api/auth/invite` and `POST /api/auth/revoke` expecting snake_case `{ technician_id }`.
5. **Client-side offline storage in FieldOps is not isolated by technician or device, and `completionSubmissions` strips owner identity:**
   - While `LocalVisitDraft` in IndexedDB `visits` (`frontend/pwa/src/lib/workspace-visit.mjs:186-237`) preserves `technicianId: detail.technicianId ?? null`, `createPendingCompletionSubmission()` (`frontend/pwa/src/lib/completion-submission.mjs:21-89`) **omits `technicianId`** from both the `completionSubmissions` envelope and its embedded `snapshot`.
   - IndexedDB stores `photos` (`frontend/pwa/src/lib/db.js:204-227`) and `queue` (`frontend/pwa/src/lib/db.js:166-197`) also store no `technicianId` or `deviceId`.
6. **HTTP `401` wipes the only local session owner record (`localStorage.technician`) while background sync and online retry listeners remain active:**
   - On any `401` response, `frontend/shared/api.js:37-45` deletes both `localStorage.deviceToken` and `localStorage.technician` and dispatches `auth:expired`.
   - `frontend/pwa/app.js:101-104` does **not** call `stopSync()` (`frontend/pwa/src/lib/sync.js:77-81`), and `startCompletionSubmissionRetry()` (`frontend/pwa/src/lib/completion-submission.mjs:161-173`) never unregisters its `online` listener or filters pending submissions by owner.
   - If Technician B subsequently logs in on the same device, `retryPendingCompletionSubmissions()` (`frontend/pwa/src/lib/completion-submission.mjs:142-159`) attempts to submit Technician A's pending `completionSubmissions` using Technician B's Bearer token, and `My Calls` (`frontend/pwa/src/screens/my-calls.js:126-142`) and `Reports` (`frontend/pwa/src/screens/reports.js:95-118`) display Technician A's local drafts and pending/completed submissions to Technician B.

---

## 2. Current Legacy Session Behavior (Scope A)

### 2.1 Database Schema (`device_tokens` and `invite_codes`)

- **Verified Facts:**
  - `device_tokens` (`src/db/schema.sql:423-427`):
    ```sql
    CREATE TABLE IF NOT EXISTS device_tokens (
      token         text PRIMARY KEY,
      technician_id text NOT NULL REFERENCES technicians(id),
      created_at    text NOT NULL
    );
    ```
    Index: `idx_device_tokens_tech ON device_tokens(technician_id)` (`src/db/schema.sql:464`).
  - `invite_codes` (`src/db/schema.sql:429-436`, `src/db/migrations/001_invite_codes.sql:10-17`):
    ```sql
    CREATE TABLE IF NOT EXISTS invite_codes (
      code          text PRIMARY KEY,
      technician_id text NOT NULL REFERENCES technicians(id),
      created_at    text NOT NULL,
      expires_at    text NOT NULL,
      used          boolean NOT NULL DEFAULT false
    );
    ```
    Index: `idx_invite_codes_tech ON invite_codes(technician_id)` (`src/db/schema.sql:465`).
  - Neither table stores an application identifier (`DISPATCH` vs `FIELDOPS`), device/installation identifier, token/code hash, revocation actor/reason, or session activity timestamp.

### 2.2 Token Creation, Redemption, Authentication, and Revocation

- **Verified Facts:**
  1. **Invite creation (`POST /api/auth/invite`, `src/routes/auth.js:26-46`):**
     - Guarded by `authenticate, requireRole('owner')`.
     - Requires `req.body.technician_id` pointing to an active row in `technicians` (`is_active = true`).
     - Deletes only unused invites (`DELETE FROM invite_codes WHERE technician_id = $1 AND used = false`) and inserts a 6-character plaintext alphanumeric code with a 60-second TTL (`INVITE_TTL_MS = 60_000`).
  2. **Invite redemption (`POST /api/auth/redeem`, `src/routes/auth.js:51-91`):**
     - Public route (rate-limited at 5 requests/minute/IP in `src/server.js:50-56`).
     - Checks `invite.used === false`, `new Date(invite.expires_at) >= new Date()`, and `tech.is_active === true`.
     - Marks `invite_codes.used = true` and inserts a new plaintext UUIDv4 into `device_tokens`.
     - **Does not delete existing `device_tokens` for `technician_id`**, despite the comment on line 49 (`"Invalidates previous tokens for that tech"`).
  3. **Request authentication (`authenticate`, `src/middleware/auth.js:7-32`):**
     - Extracts `Authorization: Bearer <token>` and runs:
       ```sql
       SELECT t.id, t.name, t.role, t.commission_rate, t.is_active
       FROM device_tokens dt
       JOIN technicians t ON t.id = dt.technician_id
       WHERE dt.token = $1 AND t.is_active = true
       ```
     - Populates `req.technician = { id, name, role, commission_rate }`.
  4. **Explicit revocation (`POST /api/auth/revoke`, `src/routes/auth.js:97-115`):**
     - Guarded by `authenticate, requireRole('owner')`.
     - Executes `DELETE FROM device_tokens WHERE technician_id = $1` and `DELETE FROM invite_codes WHERE technician_id = $1`.
     - Revocation is all-or-nothing per technician; an administrator cannot revoke a single device session without revoking all tokens for that technician.

### 2.3 Answers to Scope A Audit Questions

| Audit Question | Verified Finding | Evidence |
| :--- | :--- | :--- |
| **Are legacy tokens application-scoped?** | **No.** Tokens are bound solely to `technician_id`. No column in `device_tokens` or `invite_codes` records whether the token is for `DISPATCH` or `FIELDOPS`. | `src/db/schema.sql:423-436`, `src/middleware/auth.js:15-19` |
| **Can one token currently authenticate against both Dispatch and FieldOps?** | **Yes, partially at the API layer and fully in shared storage.** (1) Any endpoint lacking `requireRole()` accepts any valid token from either surface. (2) A user with `role = 'owner'` can call `requireRole('owner')` and `requireRole('dispatcher', 'owner')` endpoints AND any unscoped FieldOps endpoint (e.g., `/api/visits/:id`, `/api/sync/changes`, `/api/catalog/*`, `/api/chat/*`), though strict technician-only endpoints (`requireRole('technician')` such as `/api/visits/mine` or `/api/visits/:id/complete`) reject `owner`/`dispatcher` roles with `403`. (3) Conversely, Dispatch's React shell (`frontend/dispatch/src/lib/auth.jsx:11-29`) accepts any `localStorage.deviceToken` without checking `technician.role`, rendering the Dispatch UI shell for a `technician` token (API calls to `/api/dispatch/*` then fail with `403`). | `src/middleware/auth.js:7-45`, `src/routes/visits.js:24,62`, `src/routes/completion.js:33`, `src/routes/dispatch.js:29`, `frontend/dispatch/src/lib/auth.jsx:11-29` |
| **Can inactive or deactivated technicians retain usable tokens?** | **They retain dormant token rows in `device_tokens`, blocked only by `t.is_active = true` at query time.** `PATCH /api/dispatch/technicians/:id/deactivate` sets `technicians.is_active = false` and unassigns active visits, but **does not delete rows from `device_tokens` or `invite_codes`**. While `is_active = false`, `authenticate` returns `401`. | `src/routes/technicians.js:64-103`, `src/middleware/auth.js:15-23` |
| **Can reactivation restore previously issued access?** | **Yes (Verified Vulnerability).** `PATCH /api/dispatch/technicians/:id/reactivate` flips `technicians.is_active = true` without clearing `device_tokens`. Every token that existed prior to deactivation immediately becomes valid again unless an owner also manually invoked `POST /api/auth/revoke`. | `src/routes/technicians.js:131-145` |
| **Can multiple devices exist for one technician?** | **Yes.** `POST /api/auth/redeem` inserts a new row into `device_tokens` on each invite redemption without deleting prior rows for that `technician_id`. | `src/routes/auth.js:74-80` |
| **Do token records contain sufficient information to identify their owner and application?** | **Owner: Yes (`technician_id`). Application: Only indirectly via `technicians.role`, which is single-valued per row (`technician`, `dispatcher`, or `owner`). Device identity: No.** Because `technicians.role` is a single value, a token for `role = 'technician'` was issued to a FieldOps technician, and a token for `role IN ('dispatcher', 'owner')` was issued to a Dispatch user—provided no person row was manually mutated between roles after token issuance. However, `device_tokens` has zero metadata to distinguish individual physical devices when multiple tokens exist for one `technician_id`. | `src/db/schema.sql:303-310,423-427` |
| **Can existing sessions be safely migrated into `device_sessions`?** | **Partially, under strict conditions.** Active tokens (`t.is_active = true`) can be migrated into `device_sessions` by hashing `device_tokens.token` (`SHA-256`) into `session_token_hash`, mapping `person_id = technician_id`, and deriving `application` from `technicians.role` (`'technician' -> 'FIELDOPS'`, `'dispatcher'/'owner' -> 'DISPATCH'`). Tokens belonging to inactive technicians (`t.is_active = false`) **must not** be migrated as active sessions and must be invalidated. | See Section 6 |

---

## 3. Offline Storage Inventory (Scope B)

### 3.1 Complete Client-Side Storage Inventory

| Storage Mechanism | Store / Key Name | Application Surface | Stored Data Shape & Purpose | Owning Person / Technician Field | Device / Installation ID Field | Cleared on Logout / `401`? |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **`localStorage`** | `deviceToken` | Shared (FieldOps PWA & Dispatch) | Plaintext UUID bearer token string (`frontend/shared/api.js:17,39`, `frontend/pwa/app.js:51,140`, `frontend/dispatch/src/lib/auth.jsx:12,27,36,42`). | None on key itself; paired with `localStorage.technician`. | None | **Yes**, deleted immediately on any HTTP `401` (`frontend/shared/api.js:39`) and on Dispatch `logout()` (`auth.jsx:36`). |
| **`localStorage`** | `technician` | Shared (FieldOps PWA & Dispatch) | JSON `{ id, name, role, commission_rate }` (`frontend/pwa/app.js:52,141`, `frontend/dispatch/src/lib/auth.jsx:13,28,37,43`). | `id` (the authenticated `technician_id`). | None | **Yes**, deleted immediately on any HTTP `401` (`frontend/shared/api.js:40`), **erasing the local record of who was logged in**. |
| **`localStorage`** | `sync:lastAt` | FieldOps PWA | ISO timestamp string for `/api/sync/changes?since=` delta polling (`frontend/pwa/src/lib/sync.js:10,43`). | **None** (global across technicians on the browser). | None | **No.** Persists across `401` and re-authentication. |
| **`sessionStorage`** | `workspace:visitId` | FieldOps PWA | Active `visit.id` string opened in Workspace (`frontend/pwa/src/screens/my-calls.js:502`, `frontend/pwa/src/screens/workspace.js:94,352,1306`). | **None.** | None | **No** on `401`; cleared only when cancelling or submitting a visit. |
| **`sessionStorage`** | `workspace:confirmCancelVisitId` | FieldOps PWA | Visit ID string awaiting cancel confirmation in Workspace (`frontend/pwa/src/lib/workspace-visit.mjs:11,134-158`). | **None.** | None | **No** on `401`; cleared when read in Workspace (`workspace.js:98`). |
| **`sessionStorage`** | `fo_gps_state` | FieldOps PWA | JSON `{ lat, lon, source, denied }` for SCALE/FAN compliance photo GPS (`frontend/pwa/src/screens/workspace.js:81,1195-1204`). | **None.** | None | **No** on `401`. |
| **`IndexedDB` (`fieldops` v2)** | `catalog` (`keyPath: 'type'`) | FieldOps PWA | Cached reference catalog (`services`, `items`, `equipment`, `lineset-configs`, `checklist`, `version`) (`frontend/pwa/src/lib/db.js:29,51-67`). | None (shared reference data). | None | **No.** |
| **`IndexedDB` (`fieldops` v2)** | `visits` (`keyPath: 'id'`) — **LocalVisitDraft** | FieldOps PWA | Mutable offline visit draft (`draftSchemaVersion: 1`, `lifecycle: 'draft'`, `id`, `technicianId`, `status`, `_service`, `_items`, `_weighInData`, `notes`, `_checklist`, `_checklistPhotoCounts`, `_weighInPhotos`, `dirty`, `updatedAt`) (`frontend/pwa/src/lib/workspace-visit.mjs:186-237`, `frontend/pwa/src/lib/db.js:73-131`). | **Yes:** `technicianId: detail.technicianId ?? null` (`workspace-visit.mjs:193`), populated when `detail` came from `GET /api/visits/:id` (`src/routes/visits.js:244`). Can be `null` if constructed from incomplete detail. | **None.** | **No.** |
| **`IndexedDB` (`fieldops` v2)** | `visits` (`keyPath: 'id'`) — **My Calls Summary (`_myCallsSummary`)** | FieldOps PWA | Cached visit summary from `GET /api/visits/mine` stored either as `{ id, _myCallsSummary }` or attached as a property on an existing `LocalVisitDraft` (`frontend/pwa/src/lib/db.js:135-157`). | **Yes, nested:** `_myCallsSummary.technicianId` (`src/routes/visits.js:222`). | **None.** | **No.** Furthermore, `cacheMyCallsVisits()` (`db.js:135-146`) only calls `store.put()` for returned visits and **never deletes prior visits** belonging to a previous technician or reassigned away. |
| **`IndexedDB` (`fieldops` v2)** | `completionSubmissions` (`keyPath: 'submissionId'`) | FieldOps PWA | Immutable completion submission record (`submissionId`, `visitId`, `lifecycle: 'pending' \| 'completed'`, `createdAt`, `updatedAt`, `attempts`, `lastError`, `acknowledgment`, `snapshot`) (`frontend/pwa/src/lib/completion-submission.mjs:21-89`, `frontend/pwa/src/lib/db.js:35-39,233-286`). | **NONE.** `createCompletionSnapshot()` (`completion-submission.mjs:21-65`) and `createPendingCompletionSubmission()` (`completion-submission.mjs:67-89`) **do not copy `visitDraft.technicianId`** into the record or `snapshot`. | **None.** | **No.** |
| **`IndexedDB` (`fieldops` v2)** | `photos` (`keyPath: 'id'`, `autoIncrement: true`) | FieldOps PWA | Offline photo blobs (`{ id, visitId, tag, blob, capturedAt }`) (`frontend/pwa/src/lib/db.js:40-43,204-227`). Note: Current `workspace.js` uploads photos directly via `api.upload('/visits/:id/photos')` (`workspace.js:966,1104`), while `savePhotoLocal`/`getPendingPhotos` remain in `db.js`. | **None** (linked only by `visitId`). | **None.** | **No.** |
| **`IndexedDB` (`fieldops` v2)** | `queue` (`keyPath: 'id'`, `autoIncrement: true`) | FieldOps PWA | Generic offline mutation queue (`{ id, action, payload, createdAt, attempts }`) (`frontend/pwa/src/lib/db.js:32,166-197`, `frontend/pwa/src/lib/queue.js:1-130`). Note: Currently unused by `app.js`/`workspace.js`, which use `completionSubmissions` instead, though `queue.js` remains in the codebase. | **None.** | **None.** | **No.** |

### 3.2 Per-Data-Type Audit Matrix (Scope B Questions 1–6)

| Offline Data Type | 1. Identifies Owning Technician / Person? | 2. Identifies Device / Installation? | 3. Validates Ownership Before Sync? | 4. Stops Pending Sync After `401` / Auth Failure? | 5. Can Be Submitted Using a Different Technician's Token? | 6. Can Be Safely Preserved & Recovered After Revocation? |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **`LocalVisitDraft` (`visits` store, including service, items, weigh-in, notes, checklist)** | **Yes**, via `draft.technicianId` (`workspace-visit.mjs:193`), unless `detail.technicianId` was missing (`null`). | **No.** | **No client-side check.** Workspace loads any draft by `visitId` (`workspace.js:244`). | **Immediate interactive API writes fail with `401`**, which clears `localStorage` and shows `AuthScreen`, while the local draft remains in IndexedDB. | **Yes (client attempts it).** If Tech B opens Tech A's cached visit in Workspace, Tech B's edits/completion use Tech B's token (server rejects with `403` unless visit was reassigned to Tech B). | **Yes, if `draft.technicianId` is non-null** and matched against the reauthorized `person_id`. |
| **`_myCallsSummary` (`visits` store)** | **Yes**, via `_myCallsSummary.technicianId`. | **No.** | **No.** `getCachedMyCallsVisits()` (`db.js:148-157`) returns all records in `visits` with `_myCallsSummary` without filtering by `technicianId`. | N/A (read cache, though `sync.js` keeps polling `/api/sync/changes` every 20s after `401`). | N/A (read cache), but leaks Tech A's cached calls into Tech B's offline `My Calls` list (`my-calls.js:126-131`). | **Yes** (or safely rebuilt from server on re-login). |
| **`completionSubmissions` (`completionSubmissions` store)** | **No direct field.** Only indirectly inferable if a `LocalVisitDraft` with the same `visitId` and non-null `technicianId` still exists in `visits`. | **No.** | **No.** `retryPendingCompletionSubmissions()` (`completion-submission.mjs:142-159`) iterates over **all** `lifecycle === 'pending'` records without checking who created them. | **Partially:** On `401`, `api.js` clears `deviceToken`; subsequent `online` events still trigger `retryPendingCompletionSubmissions()`, which calls `/api/visits/:id/complete` without a token (failing with `401`) until someone logs in. | **Yes (CRITICAL).** As soon as Tech B logs in on the device, `retryPendingCompletionSubmissions()` (or `Reports` screen retry) POSTs Tech A's pending submission using **Tech B's Bearer token**. | **Conditionally:** Recoverable for the same technician after re-login, **provided** ownership is first bound (via matching `LocalVisitDraft.technicianId`) before any other technician logs into that browser. |
| **`photos` (`photos` store) & in-memory Workspace photos** | **No** (only `visitId`). Note: `workspace.js:966,1104` currently uploads photos directly via `api.upload` without falling back to `savePhotoLocal`. | **No.** | **No.** | Direct `api.upload` fails on `401` and is not queued offline in `workspace.js`. | If `savePhotoLocal` is used, `getPendingPhotos(visitId)` has no owner field beyond `visitId`. | Only by joining `photo.visitId` to a `LocalVisitDraft` with known `technicianId`. |
| **`queue` (`queue` store)** | **No.** | **No.** | **No** (`queue.js:33-69`). | `flushQueue()` (`queue.js:56-62`) catches errors and increments `attempts` up to `MAX_ATTEMPTS = 5`. | **Yes**, if `flushQueue()` is invoked under a new token. |Currently dead/legacy code path (`queue.js` is not imported by `app.js`), but any existing items in IndexedDB `queue` have no owner metadata. |
| **`sessionStorage` (`workspace:visitId`, `workspace:confirmCancelVisitId`, `fo_gps_state`)** | **No.** | **No.** | **No.** | **No** — `auth:expired` in `app.js:101-104` does not clear `sessionStorage`. | If Tech B logs in within the same tab session, `workspace:visitId` or `fo_gps_state` from Tech A remains in `sessionStorage`. | Ephemeral UI state; should be cleared on session termination or scoped per `person_id`. |

---

## 4. Ownership and Synchronization Findings

### 4.1 How `401` Destroys Session Ownership Context in the Browser

- **Verified Fact (`frontend/shared/api.js:37-45`):**
  ```js
  if (res.status === 401) {
    localStorage.removeItem('deviceToken')
    localStorage.removeItem('technician')
    window.dispatchEvent(new CustomEvent('auth:expired'))
    throw new ApiError(401, 'Session expired. Please re-authenticate.')
  }
  ```
- **Consequence:** The moment a technician's token is revoked (or the technician is deactivated) and the PWA makes any API request (including the background 20-second `/api/sync/changes` poll in `frontend/pwa/src/lib/sync.js:24`), `api.js` deletes `localStorage.technician`.
- Because `completionSubmissions` records do not contain `technicianId` (`frontend/pwa/src/lib/completion-submission.mjs:21-89`), deleting `localStorage.technician` removes the browser's top-level record of which technician was authenticated when those pending submissions were created. Ownership of a pending `completionSubmission` can then only be reconstructed by joining `completionSubmission.visitId` against `visits[visitId].technicianId` in IndexedDB.

### 4.2 Background Sync and Retry Behavior After `401`

- **Verified Fact 1 — `sync.js` interval never stops on `auth:expired`:**
  - `startSync()` (`frontend/pwa/src/lib/sync.js:68-75`) starts `setInterval(poll, 20_000)` and registers `window.addEventListener('online', poll)`.
  - `stopSync()` (`frontend/pwa/src/lib/sync.js:77-81`) is exported by `sync.js`, **but is never imported or called anywhere in `frontend/pwa/app.js`**.
  - After `auth:expired`, `poll()` continues running every 20 seconds when online, calling `GET /api/sync/changes` without a `deviceToken`, receiving `401`, and repeatedly firing `auth:expired`.
- **Verified Fact 2 — `startCompletionSubmissionRetry()` registers duplicate, unauthenticated `online` listeners:**
  - `startCompletionSubmissionRetry()` (`frontend/pwa/src/lib/completion-submission.mjs:161-173`) is called inside `onAuthenticated()` (`frontend/pwa/app.js:97`).
  - It registers `window.addEventListener('online', retrySafely)` **without removing previous listeners** and **without checking whether an authenticated session currently exists**.
  - When offline-to-online transitions occur while unauthenticated, `retryPendingCompletionSubmissions()` still attempts `POST /api/visits/:visitId/complete` for every pending submission in IndexedDB.
- **Verified Fact 3 — `sync:lastAt` cursor pollution (`frontend/pwa/src/lib/sync.js:10,43`):**
  - `localStorage.getItem('sync:lastAt')` is global. When `/api/sync/changes?since=<sync:lastAt>` runs (`src/routes/sync.js`), the backend filters visits by `technician_id = req.technician.id AND updated_at > since`. If Technician B logs in on a device previously used by Technician A, Technician A's `sync:lastAt` timestamp causes Technician B's delta sync to skip any visits assigned to Technician B whose `updated_at` is older than Technician A's last sync timestamp.

### 4.3 Unfiltered UI Rendering in `My Calls` and `Reports`

- **Verified Fact 1 — `My Calls` (`frontend/pwa/src/screens/my-calls.js:116-147`):**
  - When `GET /api/visits/mine` fails (e.g., offline), `loadVisits()` calls `getCachedMyCallsVisits()`, which returns **all** `_myCallsSummary` records in IndexedDB `visits` regardless of `technicianId`.
  - Even when `GET /api/visits/mine` succeeds online, `loadVisits()` calls `getAllLocalVisitDrafts()` (`my-calls.js:133`) and `getAllCompletionSubmissions()` (`my-calls.js:134`) and overlays their state (`applyLocalVisitStateToMyCalls`, `frontend/pwa/src/lib/my-calls-visit.mjs:46-97`). While `applyLocalVisitStateToMyCalls` only maps over the `visits` array passed to it, `cacheMyCallsVisits()` (`frontend/pwa/src/lib/db.js:135-146`) never purges old `_myCallsSummary` entries from IndexedDB, so any offline fallback merges **all** historical cached visits from prior technicians on that device.
- **Verified Fact 2 — `Reports` (`frontend/pwa/src/screens/reports.js:95-118`):**
  - `Reports` calls `getAllCompletionSubmissions()` (`reports.js:97`) and `getAllLocalVisitDrafts()` (`reports.js:98`) and renders **every** pending/completed submission stored in IndexedDB (`mergeCompletedVisitsWithSubmissions`, `reports.js:35-69`), regardless of which technician is currently logged in!
  - Furthermore, when `Reports` mounts while online (`reports.js:100-104`), it immediately invokes `retryPendingCompletionSubmissions()`, attempting to submit every pending submission in IndexedDB under the currently logged-in technician's token.

---

## 5. Risk Scenarios and Reproducible Evidence (Scope C)

### Scenario 1: Technician A loses access while offline data remains

- **Trace & Evidence:**
  1. Technician A (`tech-001`) works offline in `workspace.js`, saving a `LocalVisitDraft` (`visits` store, `workspace.js:1367-1371`) and clicking **Submit report** (`workspace.js:1290-1305`), which creates a `pending` record in `completionSubmissions` (`completion-submission.mjs:67-89`).
  2. An owner revokes Technician A's access (`DELETE FROM device_tokens WHERE technician_id = 'tech-001'`) or deactivates Technician A (`technicians.is_active = false`).
  3. Technician A's device regains connectivity. Either `retryPendingCompletionSubmissions()` (`completion-submission.mjs:168`) or `sync.js` (`sync.js:24`) fires a request.
  4. The server returns `401 Unauthorized`.
  5. `frontend/shared/api.js:37-45` deletes `localStorage.deviceToken` and `localStorage.technician` and dispatches `auth:expired`.
  6. `frontend/pwa/app.js:101-104` renders `AuthScreen`.
- **Verified Outcome:**
  - The `LocalVisitDraft` in `visits` and the `pending` record in `completionSubmissions` **remain intact in IndexedDB** (`deliverCompletionSubmission` in `completion-submission.mjs:115-125` catches the `401` error, increments `attempts`, sets `lastError = 'Session expired. Please re-authenticate.'`, and keeps `lifecycle = 'pending'`).
  - **Risk:** `localStorage.technician` is now gone, and the `completionSubmissions` record has no `technicianId` field of its own.

### Scenario 2: Technician B subsequently uses the same device (Shared Device / Reassigned Device)

- **Trace & Evidence:**
  1. Following Scenario 1, Technician B (`tech-002`) logs into the same browser/PWA.
  2. `onAuthenticated()` (`frontend/pwa/app.js:90-99`) runs `startCompletionSubmissionRetry()`, which immediately invokes `retryPendingCompletionSubmissions()` (`completion-submission.mjs:162-167`).
  3. `retryPendingCompletionSubmissions()` loads Technician A's pending submission from `completionSubmissions` and sends `POST /api/visits/:visitId/complete` with **Technician B's Bearer token**.
- **Verified Outcome (Two Sub-Cases):**
  - **Sub-Case 2A (Visit is still assigned to Technician A or in Lobby `technician_id = NULL`):**
    - With the Package 1 (F-02) fix in `src/routes/completion.js:97-111`, the server locks the visit row (`FOR UPDATE`), checks `visit.technician_id !== req.technician.id`, rolls back, and returns `403 Forbidden ("This visit is not assigned to you")`.
    - However, on the client (`completion-submission.mjs:115-125`), `deliverCompletionSubmission` catches the `403`, writes `lastError = 'This visit is not assigned to you'`, leaves `lifecycle = 'pending'`, and **Technician B sees Technician A's visit and report data inside Technician B's `Reports` screen** (`frontend/pwa/src/screens/reports.js:95-118`) and offline `My Calls` screen (`frontend/pwa/src/screens/my-calls.js:126-142`)!
  - **Sub-Case 2B (CRITICAL: Visit was reassigned to Technician B after Technician A was deactivated):**
    - When Technician A was deactivated (`PATCH /api/dispatch/technicians/:id/deactivate`, `src/routes/technicians.js:76-81`), the server moved Technician A's non-terminal visits to Lobby (`technician_id = NULL`). A dispatcher then assigned that visit (`visit-123`) to Technician B (`tech-002`).
    - Now Technician B logs into the shared tablet where Technician A had queued an offline `completionSubmission` for `visit-123`.
    - `retryPendingCompletionSubmissions()` automatically fires `POST /api/visits/visit-123/complete` using Technician B's token and Technician A's offline `snapshot`!
    - Because `visit.technician_id` on the server is now `'tech-002'` (`=== req.technician.id`), **the server accepts the request**, completes the visit under Technician B's identity, and generates the immutable `completed_reports` record attributing Technician A's offline snapshot to Technician B!

### Scenario 3: Closing and reopening the app

- **Trace & Evidence:**
  - `localStorage` (`deviceToken`, `technician`, `sync:lastAt`) and `IndexedDB` (`fieldops`) persist across browser restarts and device reboots.
  - `sessionStorage` (`workspace:visitId`, `workspace:confirmCancelVisitId`, `fo_gps_state`) is cleared when the top-level browsing context / standalone PWA process is fully closed, though mobile OS tab restoration can preserve `sessionStorage` across app switches.
  - On reopen (`frontend/pwa/app.js:128-149`), if `localStorage.deviceToken` and `localStorage.technician` exist, the app boots directly into the authenticated shell and runs `startCompletionSubmissionRetry()`.

### Scenario 4: Clearing browser storage or reinstalling the PWA

- **Trace & Evidence:**
  - Clearing site data removes both `localStorage` (`deviceToken`, `technician`) and `IndexedDB` (`fieldops` database containing `visits`, `completionSubmissions`, `photos`, `catalog`, `queue`).
  - On the server, the corresponding `device_tokens` row remains active in PostgreSQL indefinitely with no `last_seen_at` or device identifier, creating an orphaned active token row that cannot be distinguished from a live device in `device_tokens`.

### Scenario 5: Token revocation while sync queue is pending

- **Trace & Evidence:**
  - If `POST /api/auth/revoke` is called while a technician has pending `completionSubmissions` or unsynced `LocalVisitDraft` changes (`notes`, `_weighInData`, `_service`, `_items`):
  - The next online request returns `401`, wiping `localStorage.deviceToken` and `localStorage.technician`.
  - Pending `completionSubmissions` and `LocalVisitDraft` records remain in IndexedDB, but `sync.js` continues polling every 20 seconds (`frontend/pwa/src/lib/sync.js:72`).

### Scenario 6: Previously authenticated technician receives a new invitation

- **Trace & Evidence:**
  - Suppose Technician A (`tech-001`) had offline drafts and pending `completionSubmissions` on Device 1, lost access (`401`), and then received and redeemed a **new** invitation on the **same** Device 1 as `tech-001`.
  - Under the current code (once the `/auth/redeem` endpoint contract is working), `localStorage.deviceToken` and `localStorage.technician` are populated again for `tech-001`, and `startCompletionSubmissionRetry()` (`app.js:97`) retries the pending `completionSubmissions`.
  - If the visit is still assigned to `tech-001` on the server, the pending completion submission succeeds.
  - **However**, if the visit was unassigned to Lobby when `tech-001` was deactivated (`src/routes/technicians.js:76-81`) and has not yet been re-assigned to `tech-001` in Dispatch, `POST /api/visits/:id/complete` will return `403 This visit is not assigned to you` until Dispatch reassigns the visit back to `tech-001`.

### Scenario 7: Ambiguous historical offline records

- **Trace & Evidence:**
  - Because `completionSubmissions` records do not store `technicianId` (`frontend/pwa/src/lib/completion-submission.mjs:21-89`), if a `completionSubmissions` record exists in IndexedDB whose `visitId` no longer has a matching `LocalVisitDraft` in `visits` with a non-null `technicianId` (or if `queue` / `photos` records exist without a matching `LocalVisitDraft.technicianId`), the original creator of that record **cannot be deterministically proven** from client storage alone.
  - **Strict Rule (`Scope C`):** Historical records with ambiguous ownership **must never** be automatically assigned to the currently authenticated technician.

---

## 6. Legacy Session Migration Recommendations (Scope D.1 & D.2)

> **Distinction Note:** The items in Sections 6 and 7 are **Recommendations** designed to satisfy `docs/architecture/AUTHENTICATION-ARCHITECTURE.md` and `docs/architecture/AUTHENTICATION-BOOTSTRAP.md` based on the **Verified Facts** in Sections 2–5. Any open policy choices are isolated in Section 8.

### 6.1 Disposition of Legacy `device_tokens` and `invite_codes`

1. **All legacy `invite_codes` rows must be invalidated (not migrated):**
   - **Verified Fact:** Legacy `invite_codes` have a 60-second TTL (`src/routes/auth.js:11`), store plaintext codes, and lack an `application` column (`src/db/schema.sql:429-436`).
   - **Recommendation:** Do not migrate any rows from `invite_codes` into `user_invitations`. Drop or archive `invite_codes` after cutover.

2. **Legacy `device_tokens` belonging to inactive technicians (`technicians.is_active = false`) must be invalidated:**
   - **Verified Fact:** `PATCH /api/dispatch/technicians/:id/deactivate` left historical tokens in `device_tokens` (`src/routes/technicians.js:64-103`).
   - **Recommendation:** During migration, do **not** migrate `device_tokens` rows where `technicians.is_active = false` (or migrate them only as `status = 'REVOKED'`, `revoked_reason = 'LEGACY_INACTIVE_PERSON'`). Delete or revoke them so that subsequent reactivation of the person can never silently restore pre-deactivation tokens.

3. **Legacy `device_tokens` belonging to active records (`technicians.is_active = true`):**
   - **Verified Fact:** Every active row in `technicians` has a single `role` (`'owner'`, `'dispatcher'`, or `'technician'`).
   - **Migration Mapping (Recommended Option A — Seamless In-Place Migration for Active Single-Surface Roles):**
     - For each row in `device_tokens dt JOIN technicians t ON t.id = dt.technician_id WHERE t.is_active = true`:
       - Create a synthetic `devices` record (`id = gen_random_uuid()`, `person_id = dt.technician_id`, `device_Label = 'Legacy Migrated Device'`, `created_at = dt.created_at`).
       - Insert into `device_sessions`:
         - `person_id = dt.technician_id`
         - `device_id = <synthetic device id>`
         - `application = CASE WHEN t.role = 'technician' THEN 'FIELDOPS' ELSE 'DISPATCH' END`
         - `session_token_hash = encode(digest(dt.token, 'sha256'), 'hex')`
         - `status = 'ACTIVE'`
         - `created_at = dt.created_at`
         - `last_seen_at = dt.created_at`
     - **Why this is safe:** In the legacy system, `role = 'technician'` could only use FieldOps (`requireRole('technician')`), and `role IN ('dispatcher', 'owner')` could only use Dispatch (`requireRole('dispatcher', 'owner')`) because strict technician mutation routes rejected non-technicians (`403`). Thus, mapping `technician -> FIELDOPS` and `dispatcher/owner -> DISPATCH` preserves existing field technicians' persistent sessions (preventing offline data loss during upgrade) while enforcing strict `application` scoping going forward.
     - **Exception (Dual-Surface Edge Case):** If any `owner` or `dispatcher` previously used the same `device_tokens.token` inside the FieldOps PWA to view visits, that token will become strictly `DISPATCH`-scoped after migration; to use FieldOps, that person must be granted a `FIELDOPS` access grant (`role = 'TECHNICIAN'`) and redeem a `FIELDOPS` invitation on their FieldOps device.

### 6.2 Fixing Deactivation / Reactivation Semantics

- **Recommendation:** In accordance with `docs/architecture/AUTHENTICATION-ARCHITECTURE.md` (Revocation Rules), deactivating a person or revoking an `application_access_grants` record must permanently transition all associated `device_sessions` to `status = 'REVOKED'` (with `revoked_at`, `revoked_by_person_id`, `revoked_reason`) and revoke pending `user_invitations`. Reactivating a person or re-enabling an access grant **must never** un-revoke historical `device_sessions`; a new invitation is always required.

---

## 7. Offline Data Preservation and Recovery Recommendations (Scope D.3 – D.7)

### 7.1 Required Ownership Metadata on All Client-Side Records (Scope D.4)

- **Recommendation:** Every mutable or syncable client-side record in `IndexedDB` (`fieldops`) must carry explicit, immutable ownership metadata stamped at creation time:
  1. `ownerPersonId` (string, required): The authenticated `person.id` (`technician.id`) who created or cached the record.
  2. `deviceId` (string, optional/recommended): A persistent per-browser installation UUID stored in `localStorage.getItem('fieldops:deviceId')` (never cleared on `401`).
  3. Specifically:
     - **`completionSubmissions`:** Stamp `ownerPersonId: session.personId` (and fallback `visitDraft.technicianId`) at the top level of the `completionSubmissions` record **and** inside `snapshot.ownerPersonId` in `createPendingCompletionSubmission()` (`frontend/pwa/src/lib/completion-submission.mjs`). Add an IndexedDB index on `ownerPersonId` in `db.js` (bumping `DB_VERSION` from `2` to `3`).
     - **`visits` (`LocalVisitDraft` and `_myCallsSummary`):** Stamp `ownerPersonId` on every `LocalVisitDraft` (`workspace-visit.mjs`) and every `_myCallsSummary` envelope (`db.js:135-146`).
     - **`photos`:** Stamp `ownerPersonId` on every local photo record (`db.js:204-212`).

### 7.2 Preserving Last-Known Owner Across HTTP `401` (Scope D.3 & D.5)

- **Recommendation:**
  1. **Stop destroying owner identity on `401`:** When `frontend/shared/api.js` receives `401`, delete `deviceToken`, but **preserve** `localStorage.setItem('fieldops:lastAuthenticatedPersonId', currentTechnician.id)` before clearing the active session state.
  2. **Stop background polling and auto-retry on `401`:**
     - When `auth:expired` fires in `frontend/pwa/app.js:101-104`, immediately call `stopSync()` (`frontend/pwa/src/lib/sync.js:77-81`) and stop the completion submission retry listener until a new valid session is established.
     - Guard `retryPendingCompletionSubmissions()` (`completion-submission.mjs:142-159`) so that it exits immediately if no active `session.personId` and `deviceToken` are present.
  3. **Namespace `localStorage` keys by application surface:**
     - Separate Dispatch and FieldOps storage keys (`fieldops:deviceToken`, `fieldops:session` vs `dispatch:deviceToken`, `dispatch:session`) so logging into or getting a `401` in Dispatch on the same origin does not overwrite or wipe a FieldOps session (and vice versa), and scope `sync:lastAt` per person (`fieldops:sync:lastAt:<personId>`).
  4. **Clear `sessionStorage` navigation/GPS state on session change:**
     - Clear `workspace:visitId`, `workspace:confirmCancelVisitId`, and `fo_gps_state` whenever the active `personId` changes or logs out.

### 7.3 One-Time Client-Side Migration & Quarantine of Ambiguous Historical Records (Scope D.6 & D.7)

When the upgraded FieldOps PWA boots and opens IndexedDB (`DB_VERSION = 3` upgrade / startup migration):

1. **Deterministic Ownership Attribution for Legacy `LocalVisitDraft` and `_myCallsSummary`:**
   - If a `LocalVisitDraft` in `visits` has a non-null `draft.technicianId`, set `draft.ownerPersonId = draft.technicianId`.
   - If a `_myCallsSummary` record in `visits` has a non-null `_myCallsSummary.technicianId`, set `record.ownerPersonId = record._myCallsSummary.technicianId`.
2. **Deterministic Ownership Attribution for Legacy `completionSubmissions`:**
   - For any existing record in `completionSubmissions` lacking `ownerPersonId`:
     - Look up `visits.get(submission.visitId)` in IndexedDB.
     - **If and only if** the matching `visits` record exists and has a non-null `technicianId` (or `ownerPersonId`), set `submission.ownerPersonId = visitRecord.technicianId`.
     - **Alternative deterministic source:** If the browser currently has an uninterrupted active session in `localStorage.technician` (i.e., `localStorage.deviceToken` and `localStorage.technician.id` are still present at the moment of the app upgrade and no other technician's drafts exist in `visits`), `localStorage.technician.id` corroborates ownership.
3. **Quarantine Rule for Ambiguous Records (Scope C & Scope D.7 Mandatory Constraint):**
   - If a legacy `completionSubmissions`, `LocalVisitDraft`, `photos`, or `queue` record has **no** `ownerPersonId` and cannot be deterministically linked to a specific `technicianId` via its `visitId` in `visits`:
     - **NEVER automatically assign it to the currently authenticated technician.**
     - Mark the record with `ownerPersonId = null` and `ownershipStatus = 'QUARANTINED_AMBIGUOUS_OWNER'` (and for `completionSubmissions`, transition `lifecycle` from `'pending'` to `'quarantined'` so `retryPendingCompletionSubmissions()` will never auto-submit it under any technician's token).
     - Preserve the raw record in IndexedDB so no field data is destroyed, and allow export/inspection without risking cross-technician attribution.

### 7.4 Strict Data Isolation Between Technicians on Shared Devices (Scope D.5 & D.6)

- **Recommendation:**
  1. **Filter all IndexedDB reads and sync retries by `activeSession.personId`:**
     - `retryPendingCompletionSubmissions(activePersonId)` must only retry submissions where `submission.lifecycle === 'pending' && submission.ownerPersonId === activePersonId`.
     - `getCachedMyCallsVisits(activePersonId)`, `getAllLocalVisitDrafts(activePersonId)`, and `getAllCompletionSubmissions(activePersonId)` must filter strictly by `record.ownerPersonId === activePersonId`.
  2. **Prevent Cross-Technician Stale Submission After Server-Side Visit Reassignment (Closing Sub-Case 2B):**
     - Because `retryPendingCompletionSubmissions(activePersonId)` only retries records where `submission.ownerPersonId === activePersonId`, if Technician A queued an offline submission on a shared tablet (`ownerPersonId = 'tech-001'`) and the visit was later reassigned on the server to Technician B (`'tech-002'`), Technician B logging into the shared tablet will **neither see nor submit** Technician A's queued submission (`'tech-001' !== 'tech-002'`).
  3. **Same-Technician Recovery After Re-Authorization (Scope B.6 & Scenario 6):**
     - If Technician A's session is revoked while offline data is pending (`ownerPersonId = 'tech-001'`), Technician A's drafts and pending `completionSubmissions` remain untouched in IndexedDB.
     - When an administrator issues a new invitation to Technician A (`'tech-001'`) and Technician A redeems it on the same device, the new session has `personId = 'tech-001'`.
     - Because `submission.ownerPersonId === 'tech-001'` matches the newly authenticated `personId`, Technician A immediately regains visibility of their drafts and pending submissions, and `retryPendingCompletionSubmissions('tech-001')` safely resumes syncing them (once the visit is assigned to `'tech-001'` in Dispatch).

---

## 8. Unresolved Decisions Requiring Explicit Approval

Before implementing the migration and offline isolation changes, the following product/operational decisions require explicit confirmation:

1. **Decision 1 — Legacy `device_tokens` Migration Policy (In-Place Hash Migration vs. Forced Re-Invitation for Dispatch):**
   - *Option 1A (Recommended):* Migrate all `device_tokens` belonging to active records (`technicians.is_active = true`) into `device_sessions` by hashing `token` (`SHA-256`) and assigning `application = 'FIELDOPS'` for `role = 'technician'` and `application = 'DISPATCH'` for `role IN ('owner', 'dispatcher')`. Invalidate all tokens for `is_active = false`.
   - *Option 1B:* Migrate active `role = 'technician'` tokens to `FIELDOPS` (to protect active field technicians with offline work), but invalidate all `owner`/`dispatcher` tokens and require Dispatch users to re-authenticate via bootstrap/invitation.
2. **Decision 2 — UX Handling of Quarantined Ambiguous Offline Records (`QUARANTINED_AMBIGUOUS_OWNER`):**
   - If a browser upgrades with a legacy `completionSubmissions` record whose `visitId` cannot be matched to any `technicianId` in `visits`, it will be quarantined and never auto-submitted. Should the PWA:
     - *Option 2A (Recommended):* Keep the record silently quarantined in IndexedDB (preventing cross-technician leakage or false attribution) and provide a read-only "Download Offline Backup JSON" action on the Auth/Settings screen for support recovery?
     - *Option 2B:* Display a warning banner on the Reports screen when quarantined records exist on the device?
3. **Decision 3 — Retention of Another Technician's Scoped Offline Data on a Shared Device:**
   - When Technician B logs into a device that still holds `ownerPersonId = 'tech-001'` pending submissions in IndexedDB:
     - *Option 3A (Recommended):* Keep Technician A's records hidden and inert in IndexedDB (invisible to Technician B, never synced by Technician B) so that if Technician A logs back into that device later, Technician A's pending work is still preserved.
     - *Option 3B:* Prompt or block login when another technician has unsynced pending `completionSubmissions` on the same browser.

---

## 9. Proposed Implementation Sequence & Pre-Migration Test Requirements (Scope D.8)

### 9.1 Proposed Implementation Sequence

1. **Step 1 — Client-Side Offline Ownership Tagging & Isolation (Pre-Cutover Safety):**
   - Update `frontend/pwa/src/lib/db.js`, `workspace-visit.mjs`, and `completion-submission.mjs` to stamp `ownerPersonId` and `deviceId` on all `LocalVisitDraft`, `_myCallsSummary`, `completionSubmissions`, and `photos` records.
   - Implement the IndexedDB startup migration that attributes existing legacy records via `LocalVisitDraft.technicianId` and quarantines any unattributable records (`lifecycle = 'quarantined'`).
   - Filter `retryPendingCompletionSubmissions()`, `My Calls`, `Workspace`, and `Reports` by `ownerPersonId === activeSession.personId`.
   - Update `frontend/shared/api.js`, `frontend/pwa/app.js`, and `frontend/pwa/src/lib/sync.js` so `401` stops `sync.js` polling, stops unauthenticated retry loops, namespaces storage keys by surface (`fieldops:*` vs `dispatch:*`), and scopes `sync:lastAt` by `personId`.
2. **Step 2 — Database Schema & Legacy Session Migration:**
   - Create `persons` (or evolve `technicians`), `application_access_grants`, `devices`, `device_sessions`, `user_invitations`, and `security_audit_logs` per `docs/architecture/AUTHENTICATION-ARCHITECTURE.md`.
   - Migrate active `device_tokens` (`is_active = true`) to `device_sessions` using `SHA-256` token hashes and role-derived `application` scope; permanently revoke/drop tokens for `is_active = false` and drop `invite_codes`.
3. **Step 3 — Backend Authentication, Bootstrap & Revocation Implementation:**
   - Implement `FIRST_ADMIN_BOOTSTRAP_TOKEN` bootstrap flow (`docs/architecture/AUTHENTICATION-BOOTSTRAP.md`).
   - Update `authenticate` middleware to validate `SHA-256` session token hash, `device_sessions.status = 'ACTIVE'`, `persons.status = 'ACTIVE'`, `application_access_grants.is_enabled = true`, and surface-specific `application` scope (`DISPATCH` vs `FIELDOPS`).
   - Enforce permanent revocation on person deactivation, grant revocation, device revocation, and session revocation (preventing reactivation from restoring old tokens).
4. **Step 4 — Frontend Auth Contract & Surface Alignment:**
   - Align FieldOps (`frontend/pwa/src/screens/auth.js`) and Dispatch (`frontend/dispatch/src/screens/Auth.jsx`, `TechnicianManager.jsx`) with the canonical backend invitation and revocation endpoints and response payloads.

### 9.2 Required Automated Tests Before Migration (Scope D.8)

1. **Offline Ownership & Quarantine Tests (`tests/completion-submission.test.js`, `tests/my-calls-visit.test.js`):**
   - Verify `createPendingCompletionSubmission()` stamps `ownerPersonId` on the submission envelope and `snapshot`.
   - Verify legacy `completionSubmissions` with a matching `LocalVisitDraft.technicianId` migrate to `ownerPersonId = draft.technicianId`.
   - Verify legacy `completionSubmissions` without a deterministically provable owner transition to `lifecycle = 'quarantined'` and are **never** assigned to the current technician.
2. **Cross-Technician Shared-Device Isolation Tests:**
   - Verify that when Technician A has a `pending` submission (`ownerPersonId = 'tech-001'`) and Technician B (`'tech-002'`) logs in on the same device:
     - `retryPendingCompletionSubmissions('tech-002')` does **not** send Technician A's submission—even if the visit was reassigned to Technician B on the server.
     - Technician B's `My Calls` and `Reports` screens do **not** render Technician A's drafts, cached summaries, or pending/completed submissions.
3. **`401` Termination & Recovery Tests:**
   - Verify that on `401`, `stopSync()` halts `/api/sync/changes` polling, pending offline records remain intact in IndexedDB with `ownerPersonId = 'tech-001'`, and subsequent re-authentication by `'tech-001'` recovers and syncs those records.
4. **Session Migration & Deactivation/Reactivation Security Tests (`tests/auth.test.js`, `tests/technicians.test.js`):**
   - Verify active legacy tokens migrate to `SHA-256` hashed `device_sessions` scoped to their respective `application`.
   - Verify deactivated technicians' legacy tokens are invalidated during migration.
   - Verify that deactivating and then reactivating a technician **never** restores previously issued session tokens.
   - Verify that a `FIELDOPS` session token is rejected on `DISPATCH` endpoints and vice versa.

---

## 10. Exact Files and Code Locations Inspected

| File Path | Lines Inspected | Relevance to Audit |
| :--- | :--- | :--- |
| `AGENTS.md` | `1-130` | Repository governance, source-of-truth hierarchy, and read-only audit rules. |
| `docs/architecture/AUTHENTICATION-ARCHITECTURE.md` | `1-670` | Approved target authentication, access grant, invitation, persistent session, and revocation specification. |
| `docs/architecture/AUTHENTICATION-BOOTSTRAP.md` | `1-378` | Approved first-admin bootstrap and persistent session specification. |
| `src/db/schema.sql` | `300-470` | `technicians`, `visits`, `completion_submissions`, `device_tokens` (`423-427`), `invite_codes` (`429-436`), and indexes (`464-465`). |
| `src/db/migrations/001_invite_codes.sql` | `1-20` | Historical migration creating `invite_codes` and `idx_invite_codes_tech`. |
| `src/middleware/auth.js` | `1-46` | `authenticate` (`7-32`) and `requireRole` (`37-45`) implementation. |
| `src/routes/auth.js` | `1-118` | `generateCode()` (`13-19`), `POST /api/auth/invite` (`26-46`), `POST /api/auth/redeem` (`51-91`), `POST /api/auth/revoke` (`97-115`). |
| `src/routes/technicians.js` | `1-178` | `PATCH /api/dispatch/technicians/:id/deactivate` (`64-103`) and `PATCH /api/dispatch/technicians/:id/reactivate` (`131-145`). |
| `src/routes/completion.js` | `1-310` | Accepted Package 1 F-02 transactional lock and ownership checks in `POST /api/visits/:id/complete`. |
| `src/routes/visits.js` | `1-260` | `GET /api/visits/mine` (`24-56`), `GET /api/visits/:id` (`62-82`), `formatVisitSummary` (`218-238`), `formatVisitDetail` (`240-260`). |
| `frontend/shared/api.js` | `1-70` | Shared `localStorage.deviceToken` injection (`17`), `401` handler deleting `deviceToken` and `technician` (`37-45`), and `auth` helper methods (`62-66`). |
| `frontend/pwa/app.js` | `1-166` | Session hydration from `localStorage` (`49-59`), `onAuthenticated` starting sync and completion retry (`90-99`), `auth:expired` listener (`101-104`). |
| `frontend/pwa/src/lib/db.js` | `1-287` | IndexedDB `fieldops` v2 schema (`12-44`) and CRUD functions for `catalog`, `visits`, `queue`, `photos`, and `completionSubmissions`. |
| `frontend/pwa/src/lib/completion-submission.mjs` | `1-174` | `createCompletionSnapshot` (`21-65`), `createPendingCompletionSubmission` (`67-89`), `deliverCompletionSubmission` (`91-140`), `retryPendingCompletionSubmissions` (`142-159`), `startCompletionSubmissionRetry` (`161-173`). |
| `frontend/pwa/src/lib/workspace-visit.mjs` | `1-334` | `CONFIRM_CANCEL_STORAGE_KEY` (`11`), `createLocalVisitDraft` (`186-237`), draft mutation helpers. |
| `frontend/pwa/src/lib/my-calls-visit.mjs` | `1-98` | `applyLocalVisitStateToMyCalls` (`46-97`) overlaying IndexedDB drafts and completion submissions onto `My Calls`. |
| `frontend/pwa/src/lib/sync.js` | `1-82` | `LAST_SYNC_KEY = 'sync:lastAt'` (`10`), `poll()` (`21-60`), `startSync()` (`68-75`), unused `stopSync()` (`77-81`). |
| `frontend/pwa/src/lib/queue.js` | `1-130` | Legacy offline mutation queue (`queueMutation`, `flushQueue`, `startQueueSync`). |
| `frontend/pwa/src/screens/auth.js` | `1-118` | FieldOps PWA invite code screen calling `/auth/redeem-invite` (`80-81`) with 8-character check (`68`). |
| `frontend/pwa/src/screens/my-calls.js` | `1-520` | `loadVisits` (`116-147`) reading cached visits, local visit drafts, and completion submissions; `sessionStorage.setItem('workspace:visitId')` (`502`). |
| `frontend/pwa/src/screens/workspace.js` | `1-1515` | `GPS_STORAGE_KEY = 'fo_gps_state'` (`81`), `loadVisitData` (`242-300`), weigh-in sync (`826-865`), photo upload (`951-973`, `1095-1113`), notes sync (`1115-1135`), report submission (`1269-1321`). |
| `frontend/pwa/src/screens/reports.js` | `1-335` | `mergeCompletedVisitsWithSubmissions` (`35-69`) and `loadCompletedVisits` (`95-118`) rendering all IndexedDB submissions and triggering `retryPendingCompletionSubmissions()`. |
| `frontend/dispatch/src/lib/auth.jsx` | `1-53` | Dispatch `AuthProvider` reading/writing `localStorage.deviceToken` and `localStorage.technician` without role/surface validation. |
| `frontend/dispatch/src/screens/Auth.jsx` | `1-106` | Dispatch invite screen calling `/auth/redeem-invite` (`39-40`) with 8-character check (`27`). |
| `frontend/dispatch/src/screens/TechnicianManager.jsx` | `1-297` | Dispatch technician management calling `/auth/generate-invite` (`159`), `/auth/revoke` (`174`), `/dispatch/technicians/:id/deactivate` (`32`), and `/dispatch/technicians/:id/reactivate` (`46`). |
| `tests/completion.test.js` | `1-952` | Accepted Package 1 F-02 authorization and concurrency test suite. |

