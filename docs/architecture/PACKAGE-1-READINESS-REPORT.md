# Package 1 — Canonical Server Report Snapshot Readiness

**Inspection date:** 2026-11-11
**Scope:** Read-only review of the configured PostgreSQL database, current Report generation and completion paths, correction Apply, Package 1 tests, and the governing architecture documents. No database or application changes were made.

## 1. Environment and database access

The repository `.env` configures `DATABASE_URL` for a PostgreSQL database named `fieldops` on `localhost:5432`; `.env.test` separately names `fieldops_test`. The configured `fieldops` endpoint was reachable after requesting network access. The audit ran in an explicit `BEGIN READ ONLY` transaction and rolled back. PostgreSQL reported version 18.4, database role `postgres`, server address `::1`, port 5432, and `transaction_read_only = on`.

This establishes that the inspected endpoint is a local, non-test-named database. The repository and database metadata do not establish whether its contents are development-only, a production copy, or another environment. Treat it as **environment provenance unverified**; do not use this audit as a substitute for an audit of the actual deployment target.

## 2. Duplicate submission audit

The configured database contains 8 `completion_submissions` rows for 8 distinct Visits. No duplicate `visit_id` groups were found. All rows have non-null JSONB snapshots and `accepted_at` values. No submission row points to a nonterminal Visit.

The current schema has `PRIMARY KEY (submission_id)` and a non-unique index on `visit_id`; it has no `UNIQUE (visit_id)` constraint. The audit found no current data conflict with that proposed constraint on this database. This result is limited to the local endpoint and audit time.

## 3. Terminal Visit audit

The configured database contains 20 terminal Visits: 12 `completed` and 8 `cancelled`; no `temporarily` Visits were present. Twelve terminal Visits have no `completion_submissions` row:

| Visit ID | Status |
|---|---|
| `4fa1964b-5ad2-4879-a6b2-b4e1d6e6b55d` | completed |
| `6a1e3def-6802-401f-b3c2-c0942a93fcc2` | cancelled |
| `6f2b31d9-4827-4173-8586-34bfa6cd3a28` | cancelled |
| `7e59317f-1773-428a-8448-9996c12abf6b` | completed |
| `853e19f4-977c-4cb8-bea1-cde8c549625f` | completed |
| `9ca8fb48-010c-40d6-ac80-864ffa135332` | cancelled |
| `b1a7bf19-ca96-4736-adab-393ead433764` | cancelled |
| `b635d53a-e590-4a43-9308-1e694b06eacb` | completed |
| `d3202736-ad0c-4b69-8638-c0ef211033fa` | completed |
| `db6c034f-1262-4a3b-8581-cfd89a974fe6` | completed |
| `eb2249e8-3a38-4f59-b0c6-75d74f8742fb` | completed |
| `fe811721-0899-40e6-9708-cd0ddf290740` | completed |

These are legacy terminal completions for snapshot purposes. Their original Report content, original display name, and acceptance-time data cannot be established from the submission table. Preserve the Visits and related operational/audit records; do not synthesize snapshots from mutable current rows or select a canonical Report automatically. A disposition policy must say how these legacy records remain available and distinguish them from immutable snapshot-backed Reports.

## 4. Snapshot-to-Report field comparison

`generateReportJSON()` currently reads live Visit, address, child, photo, and address-keyed Weigh-In rows. `generateReportText()` independently reads live Visit notes/checklist, address street, services, systems, and items. The accepted JSONB snapshot does not currently power either renderer.

| Current Report output | Current source | Accepted snapshot coverage / gap |
|---|---|---|
| JSON: Visit ID, order number, scheduled date/time, status, completed time | `visits` | Snapshot has `visitId`; `terminalIntent` can represent the terminal status. It lacks order number, schedule, and completion timestamp. `createdAt` is generation time, not server completion time. |
| JSON: technician ID | `visits.technician_id` | `completion_submissions.technician_id` preserves the authenticated acceptance identity, but the inspected JSONB snapshots lack a technician ID. The client snapshot code now includes one, and the route checks it against authenticated identity; historical rendering should use the trusted accepted row/snapshot value, never live assignment. |
| Historical technician display name | Not currently returned by the JSON generator; current profile is used in other live views/notifications | Missing from all inspected snapshots and the accepted-row schema. Must be captured from server-controlled technician state at acceptance. |
| JSON/text: Property street; JSON also city, state, ZIP, subdivision, builder | Current `addresses` row | Snapshot has an `address` object with those address fields in the inspected records, but no stable Property/address ID. Preserve both stable association and the acceptance-time field values. |
| JSON: total, multiple-system flag | `visits` | Snapshot has `totalPrice`; `hasMultipleSystems` is missing. |
| JSON: systems and equipment models/refrigerant | `visit_systems` | Snapshot `systems` covers the domain; preserve the complete values at acceptance and render from them. |
| JSON/text: service name, finish/temporary flags, price; text service wording/system count | `visit_services`, `visit_systems` | Snapshot `service` covers selected service data, but system count should be frozen explicitly or derived from the frozen systems array. Preserve all fields and current formatter rules. |
| JSON: item name, description, category, quantity, price, tech-supplied; text item wording and quantities | `visit_items` plus `ITEM_REPORT_TEXT` formatting map | Snapshot `items` covers the source domain. Ensure it contains all fields used by both renderers and retain the deterministic report text mapping. |
| JSON photos: slug (category is currently queried then discarded) | `visit_photos` | Snapshot has `evidenceRefs`, but it is not the same field/shape as the current `photos` response. No snapshot-backed equivalence is established. Preserve stable photo references and the fields required by Report output. |
| JSON Weigh-In measurements | Address-keyed `weigh_in_data` | Snapshot `weighInData` covers the measurement domain. Render the accepted values; current live address-keyed rows can change on later Services/corrections. |
| JSON/text notes and text checklist findings | `visits.notes`, `visits.checklist_answers` | Snapshot has `notes` and `checklistAnswers`; verify the text renderer's filtered `no`/`reportText` behavior against the frozen values. |
| Generation/acceptance timestamps | Snapshot `createdAt`; accepted row `accepted_at` | Both data points exist at separate locations for the inspected rows. The canonical snapshot/render contract must expose them consistently and preserve the server acceptance time. |

The configured database contains 8 accepted snapshots. For all 8, `snapshot` lacks top-level `technicianId`, `technicianName`, `orderNumber`, `scheduledDate`, `scheduledTime`, `completedAt`, `hasMultipleSystems`, and `photos`; all 8 have `evidenceRefs`. The rows have `technician_id` and `accepted_at` columns. Snapshot keys include `visitId`, `createdAt`, `terminalIntent`, `address`, `service`, `systems`, `items`, `weighInData`, `notes`, `checklistAnswers`, `totalPrice`, and `evidenceRefs`.

The current `generateReportText()` output fields are: address street; trimmed Visit notes; checklist `reportText` for `no` answers; formatted service/finish/temporary text and system count; thermostat item names/quantities; accessory/fix item labels, descriptions, quantities and prices; and total. The current JSON field inventory is covered row by row above. Package 1 needs a snapshot renderer for both output formats, rather than merely returning JSONB with a few additional fields.

## 5. Historical attribution assessment

For newly accepted records, the authenticated technician ID is stored in `completion_submissions.technician_id`; the route rejects a declared snapshot technician ID that differs from `req.technician.id`. The current JSON renderer instead reads mutable `visits.technician_id`. The snapshot does not contain a technician display name, and no acceptance-time name is stored in the accepted row. A profile rename or Visit reassignment can therefore change the existing live presentation.

Package 1 must freeze the authenticated ID and the server-resolved display name at acceptance, plus the immutable Report content, generation time, and server acceptance time. Client-supplied technician ID/name cannot establish authorship. Existing accepted records can retain their row-level technician ID, but the original display name is not recoverable from the inspected data alone.

## 6. Retry and reassignment assessment

The normal completion path checks current Visit assignment before entering the transaction and again after `SELECT ... FOR UPDATE`. It then looks up an existing exact `submission_id`; an accepted row is checked against Visit ID and authenticated technician ID. Terminal Visits reject an unknown submission ID with 409. The `23505` recovery path also locks the Visit and acknowledges only an exact submission/Visit/technician match; unmatched unique violations propagate.

Consequently, an exact retry after reassignment is currently rejected with 403: current ownership is checked before accepted-submission lookup. This preserves ownership for new writes but prevents the established original-technician retry behavior. Package 1 needs a narrowly scoped exact accepted-identity retry path that returns the stored original Report only to the accepted technician and does not authorize writes. The new `UNIQUE(visit_id)` violation from a different submission ID must not become an ACK; current exact-ID recovery has the right failure shape for that case.

There is a second historical-content issue: both the normal exact retry and `23505` recovery currently call `generateReportJSON()` against mutable operational rows. An ACK may therefore return content changed by reassignment, later address-level Weigh-In changes, or correction Apply, rather than the accepted payload.

## 7. Correction compatibility

`PATCH /api/dispatch/corrections/:id/apply` locks the correction and Visit and transactionally updates selected Visit, address, service, item, system, Weigh-In, note, checklist, and derived price data. It writes correction before/after state and an edit-log record; it does not update `completion_submissions.snapshot`.

The proposal to render accepted Reports exclusively from their accepted snapshot will protect the original content and attribution from these source-row updates. That protection does **not** exist yet because report JSON/text generators read mutable source rows. Add a regression test that captures an accepted snapshot/report, applies a correction, and proves the snapshot-backed original output stays unchanged while correction before/after details remain available. Existing correction tests currently assert the mutable Report-source view changes after Apply; revise that expectation for an accepted snapshot-backed Report, while retaining coverage of the corrected operational state and audit. No redesign of correction Apply is needed.

## 8. Test coverage gaps

Existing coverage includes completion transaction/ownership checks, concurrent different-ID completion serialization, 23505 exact-match and unmatched-error behavior, Report JSON/text formatting, and correction Apply/update/audit. The completion suite also has PostgreSQL-backed row-lock tests. These are the baseline to preserve; this inspection did not run tests.

Minimum Package 1 additions or corrections:

1. Snapshot completeness tests covering every JSON and text output field, including Property ID/address, order/schedule/completion time, multiple-system data, photos, every Weigh-In field, technician ID/name, and generation/acceptance timestamps.
2. Snapshot-only historical JSON and text rendering tests after mutating/reassigning Visit, Property, child, and address-keyed Weigh-In rows.
3. Exact retry after reassignment: original authenticated technician gets the same accepted snapshot/ACK; the new assignee and mismatched identities cannot claim it or write through the retry path.
4. Database migration preflight test: duplicate Visit rows abort without deletion/merge; legacy terminal rows are reported/preserved and no synthetic snapshots are created.
5. Correction regression described above: Apply changes operational state/audit, not the accepted Report snapshot or its rendering.
6. Server validation rejection tests: no accepted submission row, child/source effects, transfer expiry, or terminal Visit are committed; the client’s original snapshot remains untouched and requires explicit correction.
7. Retain existing F-02 concurrent completion, transaction rollback, ownership, terminal-state, and exact `23505` tests. Add a `UNIQUE(visit_id)` race case only if the migration/transaction test fixture can exercise the actual constraint without replacing the existing real PostgreSQL lock coverage with mocks.

## 9. Migration readiness

**`UNIQUE(visit_id)` is not approved for rollout yet.** The inspected local database has 0 duplicate groups, so its current rows would not conflict with the constraint. However, it has 12 terminal legacy Visits without accepted submission records, and this endpoint’s environment provenance is unverified. Per the established Package 1 data policy, do not proceed with the migration until the deployment target is audited and an explicit disposition for these legacy records is approved.

Preservation strategy: keep all 8 accepted rows and all 20 terminal Visit records unchanged; never delete, merge, reassign, or fabricate accepted snapshots. Record a reviewed disposition for each legacy Visit, retain its operational/correction audit history, and clearly distinguish any legacy presentation from immutable snapshot-backed Reports. Do not switch all historical reads to snapshot-only behavior until those records have an approved access/display treatment. Repeat the duplicate/legacy preflight against the actual migration target immediately before rollout.

## 10. Recommended implementation sequence

1. Identify the actual Package 1 deployment database and repeat the read-only duplicate/legacy audit; obtain explicit disposition for every legacy terminal Visit before migration approval.
2. Finalize the accepted snapshot shape against the complete JSON/text inventory and historical author/timestamp requirements.
3. Implement server-authoritative snapshot completion and snapshot-backed JSON/text rendering within the existing completion transaction; preserve the existing F-02 locks, ownership checks for new writes, side effects, and rollback boundary.
4. Implement exact retry recovery from the accepted snapshot, including original-technician retry after reassignment, without permitting a retry to create or mutate work.
5. Add the `UNIQUE(visit_id)` migration with a fail-safe duplicate preflight; preserve all existing rows. Do not use a migration to adjudicate legacy records.
6. Add the focused migration, snapshot, retry/reassignment, validation rollback, and correction regression tests; run the completion/report/correction suites and PostgreSQL concurrency cases, then review the complete diff.

## 11. Explicit blockers

- **Deployment environment is unverified.** `localhost/fieldops` is the configured local endpoint; its data provenance is unknown. A production/staging readiness claim requires identifying and auditing the actual target.
- **Twelve legacy terminal Visits lack accepted submission records.** Their historical Report and acceptance-time display name cannot be reconstructed safely from current mutable data. Product/operations must approve a preservation and presentation disposition before migration/full historical snapshot rollout.
- **Accepted snapshots are incomplete for canonical historical rendering.** The eight inspected JSONB snapshots lack multiple Report fields and technician display name; the current generators read live state.
- **Original-technician retry after reassignment is not supported.** Current assignment checks return 403 before exact accepted retry lookup.
- **Correction Apply currently changes data used by existing Report renderers.** Snapshot-only rendering and a correction regression are prerequisites to protecting original Reports.

No Package 1 implementation or migration was started.
