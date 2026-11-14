# Package 1 — Independent Implementation Audit

**Audit type:** Read-only code, test, migration, and Git review  
**Recommendation:** **REJECT pending the blockers listed below**  
**Database migration status:** Not applied or verified against a deployment database during this audit.

## Summary

Package 1 establishes a useful atomic acceptance path, server-authored snapshots, snapshot-backed rendering for rows written in the new format, exact retry ownership checks, and a one-Report-per-Service database constraint. The reviewed implementation does not yet prove the required compare-and-reject contract for every Report-visible field: several comparisons are conditional on client fields being present, and evidence references are not compared. A request can therefore be accepted while the canonical Report contains values different from the submitted snapshot.

Deployment readiness is also unproven. Migration 025 is not wired into a migration command, and the migration test executes its SQL as one PostgreSQL multi-statement query inside a transaction. That does not prove that a manual `psql -f` invocation stops after the preflight error. The repository's existing `psql -f` scripts omit `ON_ERROR_STOP`.

## 1. Snapshot integrity — **FAIL**

### Acceptance path and transaction

`POST /api/visits/:id/complete` in `src/routes/completion.js:231-478` validates the request, begins a transaction, and locks the Visit `FOR UPDATE` (`:291-305`). It checks existing submission identity and ownership before terminal handling (`:306-346`), validates current state, applies work, updates the Visit and transfer state (`:353-409`), inserts the submission row, builds the canonical Report snapshot, compares submitted content, updates the row with the canonical snapshot, generates the response from that stored snapshot, and commits (`:411-448`). The submission row, Service finalization, source-work changes, transfer expiry, and snapshot are in the same transaction.

The server derives the accepted technician ID from `req.technician.id`; the row stores that ID (`:268-273`, `:425-428`). `createCanonicalReportSnapshot()` obtains the display name from the technicians table using that authenticated ID (`src/services/report.js:250-270`). The top-level `acceptedAt` is created server-side and persisted in the submission row (`completion.js:411-435`). Client-supplied `technicianName` or `acceptedAt` values are not used to populate those canonical top-level fields. The Report response takes technician ID and acceptance time from the accepted database row (`report.js:293-316`).

The client does supply `createdAt`, which becomes `generatedAt` (`completion.js:430-435`). This is distinct from server acceptance time, but it is not server-verified. If `generatedAt` is intended to be a trusted server event time, this remains an unresolved integrity gap; the implementation currently treats the client creation time as Report metadata.

### Field coverage and comparison gap

`generateLiveReportJSON()` projects the JSON Report fields from Visit, address, systems, services, items, photos, and address-keyed Weigh-In data (`report.js:141-239`). `createCanonicalReportSnapshot()` adds Property ID, work type, server technician name, timestamps, notes/checklist, evidence references, and full photo metadata (`report.js:250-290`). `reportTextFromSnapshot()` uses the snapshot's address, notes/checklist findings, services/system count, items, and total (`report.js:331-363`). Thus the newly created canonical snapshot has the data needed by both renderers.

Acceptance validation is less complete than the snapshot projection:

- Total price is checked only when the submitted value is non-null (`completion.js:37`).
- Address, order, schedule, and Property fields are checked only when supplied (`:39-49`).
- Service name and flags are checked only when supplied; price is also optional (`:51-60`).
- Item price and `techSupplied` can be omitted without comparison (`:62-76`).
- `systems: []` bypasses system comparison even when the server projection contains systems; individual system fields are optional (`:79-95`).
- Weigh-In row count is checked, but every individual field comparison is skipped if the submitted field is omitted (`:97-116`).
- Photo output and submitted `evidenceRefs` are not compared at all. The canonical snapshot takes `photos` from server-side rows and carries source evidence refs separately (`report.js:250-290`).

These conditions allow a payload with omitted or mismatched visible values to pass while the server's canonical snapshot records different values. For example, an empty `systems` array can be accepted when the server has a system, and an evidence reference mismatch is not tested. The canonical snapshot is still server-derived, but the required guarantee that a material difference from the reviewed submission causes rejection is not established.

### Tests

- `tests/completion.test.js:313-375` verifies canonical server identity/name, acceptance metadata, immutable report reads after mutating operational data, exact retry after reassignment, and rejection for a different technician.
- `tests/completion.test.js:377-402` verifies total-price mismatch returns 409 and rolls back Visit finalization, submission insertion, transfer expiry, and work changes.
- `tests/report.test.js:184-249` exercises a canonical snapshot containing address, systems, service, item, photo, Weigh-In, notes/checklist, and generation/acceptance time fields, and checks JSON/text output.

The tests do not cover each conditional omission/mismatch above, or photo/evidence mismatch at acceptance. The static snapshot inventory test proves the builder captures fields, not that acceptance rejects every material submitted-versus-authoritative difference.

## 2. Historical immutability — **PARTIAL**

`generateReportJSON()` and `generateReportText()` first look up `completion_submissions` by Visit ID and render the stored `snapshot` when a row exists (`src/services/report.js:319-329, 366-375`). The snapshot-backed branches do not query mutable Visit, Property, child, or technician records. Completion retries and report endpoints call these generators (`src/routes/completion.js:327-329, 343-345, 447, 530, 570, 592`). The correction Apply regression test changes operational notes and Property builder, then asserts that JSON output, text output, and stored JSONB remain unchanged (`tests/corrections.test.js:250-286`).

Two compatibility paths prevent a blanket PASS:

1. If a terminal/previously accepted Visit has no `completion_submissions` row, both generators fall back to `generateLiveReportJSON()` / `generateLiveReportText()` (`report.js:366-375`). Those functions read mutable operational records. This affects legacy completions without an accepted submission row.
2. Existing rows written before the canonical snapshot format may contain a raw client submission rather than all canonical Report keys. The current renderer treats every row as a canonical snapshot without a version/shape conversion (`report.js:293-316, 366-375`). Such a row avoids live reads but may render incomplete fields.

The audit did not inspect live database records, so it does not assert how many deployed records use either path.

## 3. Retry and reassignment security — **PASS for canonical rows; PARTIAL for legacy rows**

For a canonical accepted row, the transaction locks the Visit, then looks up the exact `submission_id`. It requires the row's Visit and technician ID to match, compares the stored `sourceSubmission` with the retry payload, and generates the response through the snapshot-backed renderer (`completion.js:306-329`). This happens before checking the Visit's current assignment, so the original authenticated technician can retry after reassignment. A different authenticated technician is rejected (`:318-320`); a new submission ID on a terminal Visit is rejected (`:333-345`).

The `23505` recovery begins a new transaction, locks the Visit, looks up the exact submission ID, checks Visit and technician identity, checks `sourceSubmission` when present, and acknowledges only if that exact row exists (`completion.js:484-542`). If no exact matching row exists, it rolls back and propagates the original error through `next(err)`.

Supporting tests:

- `tests/completion.test.js:313-375` — same technician's exact retry after reassignment returns the stored Report; reassigned technician cannot claim it.
- `tests/completion.test.js:545-611` and `:672-747` — real PostgreSQL Visit-row-lock interleavings for reassignment and exact retry.
- `tests/completion.test.js:806-919` — recovery path locks the Visit and acknowledges the original technician's identity after reassignment.
- `tests/completion.test.js:922-976` — exact recovery, no acknowledgment when only Visit/technician match, and propagation of unmatched `23505`.

Legacy rows without `snapshot.sourceSubmission` cannot be checked against the exact original payload; the retry path still checks submission ID, Visit ID, and technician ID, and returns the stored snapshot without overwriting it. This is a content-integrity limitation for pre-canonical records, not a path for another technician to claim the row.

## 4. One Report per Service — **PASS in schema and route; PARTIAL for deployment safety**

Fresh schema defines a unique index on `completion_submissions(visit_id)` (`src/db/schema.sql:198-208`). Migration 025 groups rows by Visit and raises an exception if duplicates exist before issuing `CREATE UNIQUE INDEX`; it does not delete, merge, or update submission rows (`src/db/migrations/025_completion_submissions_one_per_visit.sql:3-24`). It drops the prior nonunique index only after the unique index statement.

`tests/completion-submission-migration.test.js:8-40` executes the actual migration SQL against an isolated schema with clean data and asserts the resulting index is unique. `:43-82` executes it against duplicate rows, expects the preflight error, rolls back to a savepoint, and verifies both records remain unchanged. This is a real PostgreSQL migration test, not a mock.

The only application acceptance insert found is in the completion transaction (`src/routes/completion.js:424-428`); requests without client submission IDs receive a server-generated UUID there (`:411-413`), so the legacy API shape still uses the per-Visit constraint. Other inserts are test fixtures.

Deployment is not proven safe by the current test or repository setup:

- Migration 025 is not listed in `package.json` migration scripts (`package.json:6-14`); there is no observed runner/registry for it.
- The migration file has no explicit transaction wrapper. Existing scripts invoke `psql -f` without `ON_ERROR_STOP` (`package.json:10-12`). With ordinary `psql -f` error-continuation behavior, an error in the preflight does not itself guarantee the remaining statements are skipped. In a duplicate case, the later unique-index creation would also fail, but a later `DROP INDEX` could still run. Rows would not be altered, but the deployment invocation may not cleanly abort and could remove the old nonunique index without installing uniqueness.
- The test sends the whole SQL string through one `client.query()` within an explicit transaction (`migration test:17-34, 51-75`), so it does not exercise `psql -f` continuation behavior.
- No migration was applied or inspected in a deployment database during this audit.

Apply only after verifying the target environment, auditing duplicates, and using an execution procedure that stops on error and keeps the preflight/index/drop sequence atomic. Do not run the migration against an unidentified or production database as part of this audit.

## 5. Transaction and failure behavior — **PASS, with one test-coverage limitation**

The completion transaction catches failures, attempts `ROLLBACK`, and always releases the client in `finally` (`src/routes/completion.js:449-454`). Validation mismatch is raised before commit and the test verifies no accepted row, no Visit finalization, no transfer expiry, and no source-work mutation (`tests/completion.test.js:377-402`). Notifications are issued after the transaction has committed and the client has been released (`completion.js:448-474`). Existing row locking and concurrent completion behavior remain in the handler (`:291-305, 333-346`), with database-lock tests at `tests/completion.test.js:545-611, 672-747, 806-919, 1747-1803`.

The `23505` unit-path tests inject the violation by intercepting the submission insert (`tests/completion.test.js:47-105, 806-919, 922-976`); they exercise recovery logic but do not cause PostgreSQL itself to raise the conflict at that insert. The concurrent completion test does use PostgreSQL row locks and verifies a single accepted row and one notification (`:1747-1803`). There is no focused assertion that the pool client is released after a generic database error, although the `finally` block provides the cleanup in code.

## 6. Test quality and Jest open handle — **PARTIAL**

The prior implementation run reported four suites and 104 tests passing, followed by Jest's “did not exit one second after the test run” warning. This audit did not rerun the suites: `tests/helpers/db.js:8-35` deletes rows from many tables in `beforeEach`, and the user required a read-only audit with no database-record changes.

The 104-test inventory in the four named suites is 44 completion cases, 23 Report cases (14 ordinary tests plus nine `it.each` service-format cases), 35 correction cases, and two migration cases. The Report cases mostly preserve existing formatting behavior; only the new snapshot inventory case checks accepted snapshot rendering. The correction suite mostly covers existing correction lifecycle, authorization, and Ledger behavior; only the added Apply regression directly verifies snapshot immutability. The migration suite has both clean-preflight and duplicate-preflight cases. The completion suite includes baseline finalization, cancellation, pricing/catalog/weigh-in handling, ownership, submission identity, reassignment, recovery, and concurrent requests. This source-level inventory identifies the relevant assertions but does not turn a test result into evidence for branches the tests do not exercise.

Relevant positive coverage includes canonical field inventory (`tests/report.test.js:184-249`), immutable JSON/text after correction (`tests/corrections.test.js:250-286`), mismatch rollback (`tests/completion.test.js:377-402`), reassignment and ownership (`:313-375, 545-611, 672-800`), exact and unmatched recovery (`:806-976`), and concurrent different IDs (`:1747-1803`). Remaining gaps are documented in Sections 1–5; passing assertions do not close the incomplete content comparator or migration execution gap.

The most direct open-handle cause is `tests/corrections.test.js`: it imports `src/index.js` (`:3`), which imports `src/db/pool.js`, but its `afterAll` closes only the separate helper pool (`:12`). Unlike `tests/completion.test.js`, which closes both helper and app pools (`tests/completion.test.js:3-12`), the corrections suite leaves the app pool unclosed. This is strong code evidence for a live PostgreSQL pool handle. `src/index.js` starts its server and daily interval only when `require.main === module` (`src/index.js:79-90`), so those are not started by the test import. No evidence points to a frontend retry timer/listener in these suites. `--detectOpenHandles` was not run because it would require executing suites that mutate test database records; the exact runtime handle was therefore not experimentally confirmed.

## 7. Scope and Git integrity — **PARTIAL (working tree already dirty)**

At audit start, Git status contained pre-existing changes in `AGENTS.md`, the deleted `CLAUDE.md`, PWA files, `src/routes/auth.js`, `src/routes/technicians.js`, their tests, and several architecture documents. Those are unrelated to Package 1 and were not changed by this audit. Package 1 implementation files visible in the current worktree are `src/routes/completion.js`, `src/services/report.js`, `src/db/schema.sql`, migration 025, and the completion/report/correction/migration tests. Some of those files already contained earlier local changes, so their entire diff must not be attributed solely to Package 1.

This audit adds only this report: `docs/architecture/PACKAGE-1-IMPLEMENTATION-AUDIT.md`. No application code, tests, schema, migrations, or database records were changed. No migration was applied; no commit or push was made.

## Recommendation — **REJECT pending remediation**

Do not treat Package 1 as ready for deployment until:

1. Acceptance validation rejects material differences for all Report-visible fields, including omitted fields that the reviewed snapshot is required to contain and photo/evidence references.
2. Legacy terminal Visits and legacy-format submission snapshots have an explicit, verified rendering/disposition policy; do not infer or backfill historical values from mutable rows.
3. Migration 025 has a documented/integrated execution path that stops on preflight errors and runs the preflight, unique-index creation, and old-index removal atomically; duplicate disposition must remain explicit.
4. The test teardown closes the app pool and the warning is confirmed with a safe handle diagnostic in the test environment.

No deployment database was inspected or modified for this audit. Acceptance and migration readiness for any deployed environment therefore remain unverified.
