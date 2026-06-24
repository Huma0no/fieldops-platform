# Data Model
## Field Ops + Dispatch — HVAC Startup Platform
**Version:** 1.0
**Date:** 2026-06-15
**Authors:** Christian Huerta + Claude (planning session)
**Status:** Design baseline — pre-development

---

## Overview

27 tables covering all entities defined in SYSTEM_DESIGN.md, including five catalog tables (`catalog_equipment`, `catalog_lineset_configs`, `catalog_items`, `catalog_item_relations`, `catalog_services`), a centralized `role_permissions` table for scalable, multi-tenant-ready authorization, per-technician `technician_settings` / `technician_price_overrides` / `restock_records`, `corrections` backing the post-submission correction request flow, and `pdf_batches` coordinating PDF intake review and Lobby release. Designed for PostgreSQL.

All primary keys are UUIDs. All timestamps are stored as ISO 8601 text.

---

## Tables

### catalog_equipment
Indoor and outdoor equipment models — the single source for refrigerant, factory charge, and reference specs used across visit_systems and weigh_in_data.

| Column | Type | Notes |
|---|---|---|
| model | text PK | Normalized (uppercase, trim, standard format) — same rationale as `addresses.street`, since model numbers also arrive via AI extraction from the PDF and exact-string catalog lookup would otherwise break silently on formatting variance (e.g. "5TTR5048" vs "5TTR-5048") |
| unit_type | text | "Furnace", "AirHandler", "Condenser", "Heat Pump" |
| brand | text | "Lennox", "Trane", "Goodman", "Daikin" |
| series | text | e.g. "ML180UH SERIES", "5TTR" |
| refrigerant | text | "R-454B", "R-32" — null for indoor-only models |
| is_a2l | boolean | Outdoor models only — drives the Lobby's "A2L" tag (SYSTEM_DESIGN §6). Cannot be derived from `refrigerant` text alone; must be explicit. |
| btu | integer | Outdoor models only |
| factory_charge_oz | real | Nameplate factory charge — outdoor models only |
| revised_charge_oz | real | Alternate factory charge value — applies to Trane models only. Trane is the only brand where factory refrigerant charge varies by manufacture date, and that date cannot be looked up; the technician must read it from the physical equipment nameplate in the field. There is no calculable cutoff — both values are offered, technician picks per nameplate. |
| pesp | real | Possible ESP — Furnace/AirHandler models only (a blower characteristic, not a condenser one). Null when no data exists. Edited manually by dispatcher as real field readings come in via technician notes. |
| oem_subcooling_goal | real | Fixed at 10 for all models — informational only. New-construction work is verified via weigh-in by lineset length, not subcooling, so brand/model differentiation here is intentionally not implemented. |

**Rules:**
- This table is the catalog referenced by `visit_systems.refrigerant` and `weigh_in_data.oem_subcooling_goal` — those columns are populated from here at visit creation and then stored explicitly for immutable history.
- Seed data source: `src/data.js` (ACstartup repo) — `INDOOR_CATALOG` / `OUTDOOR_CATALOG`. `pESP` placeholder value `9.9` converts to `null`.
- Editing a value here never changes historical visit records — only future visits read the updated value.
- CFM min/max are deliberately NOT columns here — calculated server-side from `btu` (max = btu/12000 × 400, min = 85% of max) whenever needed, since this table is the live catalog, not a historical record.

---

### catalog_lineset_configs
Factory lineset presets used to calculate `approx_adjust_oz` during weigh-in.

| Column | Type | Notes |
|---|---|---|
| config_key | text PK | Preset identifier — matches `weigh_in_data.factory_line_config`. Brands with a revised-charge variant (currently Trane, Lennox) have two separate preset rows — e.g. "Trane 10ft" and "Trane 25ft Revised" — the technician selects whichever matches the equipment nameplate. |
| reference_length_ft | real | Factory reference lineset length this preset is based on |
| adjust_rate_oz_per_ft | real | Refrigerant adjustment per foot of difference from the reference length |

**Rules:**
- `approx_adjust_oz` in `weigh_in_data` is calculated server-side from `lineset_length` against this table's `reference_length_ft` and `adjust_rate_oz_per_ft` for the visit's selected `factory_line_config`.
- Seed data source: `src/data.js` / `utils.js` (ACstartup repo). Current presets: Trane 10ft, Trane 25ft Revised, Lennox 15ft, Lennox 30ft Revised, Daikin 10ft, Goodman 10ft.

---

### catalog_items
Accessories, fixes, and thermostats — the single source for default pricing, restock classification, and price-anomaly ranges used across visit_items.

| Column | Type | Notes |
|---|---|---|
| item_name | text PK | Canonical name, e.g. "FIN180P", "Pressure Test", "T-10" |
| category | text | "accessory", "fix", "thermostat" — fixed set, enforced via CHECK constraint, matching `visit_items.category` exactly |
| default_price | real | Used unless overridden at the visit level (custom-price items) |
| tech_supplied | boolean | True if the item impacts restock — see rules below |
| multiplies_by_system_count | boolean | True if this item is charged once per system on the visit (price × visit's system count) rather than once per visit, regardless of how many systems exist. There is no fixed cap at two systems — the platform supports any number of systems via +Add Systems. |
| custom_price | boolean | True for free-form-price items (e.g. "Other", "Out of town fee") — no default_price applies |
| expected_price_min | real | Lower bound for anomaly detection — null if not applicable |
| expected_price_max | real | Upper bound for anomaly detection — null if not applicable |
| finish_addon_price | real | Extra amount added when this specific item is selected together with the Finish modifier on the same visit (e.g. Weigh-In-Data + Finish = +$10). Lives here rather than on catalog_services because the addon is tied to which accessory is present, not to the service itself. |

**Rules:**
- `category = "thermostat"` → `tech_supplied = true` always.
- `category = "fix"` → `tech_supplied = false` always.
- `category = "accessory"` → `tech_supplied` set per item per catalog definition.
- These three rules are enforced with a database CHECK constraint, not by seed-data convention alone — the schema should not permit a row that violates them.
- Seed data source: `src/data.js` (ACstartup repo) — `ACCESSORIES`, `FIXES`, `THERMOSTATS`, `DEFAULT_PRICES`. `PVC_WORK` and `Service Other` are excluded from migration.
- This table is the catalog referenced by `visit_items.tech_supplied` (resolved automatically at item creation) and by the pay-period anomaly detection endpoint (`expected_price_min`/`max`).

---

### catalog_item_relations
Companion auto-activation and mutual-exclusion groups between catalog items. Closes a gap found in review: these are row-to-row relationships, not scalar columns, and cannot be expressed as fields on `catalog_items` regardless of how that table is structured.

| Column | Type | Notes |
|---|---|---|
| id | text PK | UUID |
| item_name | text FK | References catalog_items.item_name — the trigger item |
| relation_type | text | "companion" or "exclusion_group" |
| related_item_name | text FK | References catalog_items.item_name — companion that gets auto-activated/deactivated, or fellow member of the same exclusion group |
| exclusion_group_id | text | Only populated when relation_type = "exclusion_group" — items sharing the same group id are mutually exclusive |

**Rules:**
- Companion relation (e.g. HZ322 → Bypass): selecting `item_name` auto-activates every row's `related_item_name`; deselecting `item_name` auto-deactivates them too.
- Exclusion relation (e.g. HZ322, Harmony, UT3000 as zone boards): selecting any item in an `exclusion_group_id` deselects every other item in that same group, including their companions.
- Seed data source: `src/data.js` (ACstartup repo) — companion and zone board groupings.

---

### catalog_services
Base services and their pricing/modifier rules — the single source for the server-side pricing engine.

| Column | Type | Notes |
|---|---|---|
| service_name | text PK | "AC", "Heat", "AC & Heat", "Prestart System", "Drive Run", "Cancel" |
| default_price | real | Base price before modifiers |
| is_bundle | boolean | True for "AC & Heat" — priced as one service, not the sum of AC + Heat |
| multiplies_by_system_count | boolean | True if this service is charged once per system on the visit (price × visit's system count) rather than once per visit. There is no fixed cap at two systems. |

**Rules:**
- Seed data source: `src/data.js` (ACstartup repo) — `SERVICES`, `DEFAULT_PRICES.SERVICE`.
- Finish and Temporarily are modifiers applied on top of a base service (see `visit_services.is_finish` / `is_temporarily`), not separate rows here.
- The Finish + accessory price addon (e.g. Weigh-In-Data + Finish = +$10) lives on `catalog_items.finish_addon_price`, not here — the addon is tied to which accessory is present, not to the service itself.
- This table backs the pricing engine described in `API_CONTRACT.md` §7 (bundle rule, system-count multiplier, Cancel rule) — built once, reused by both the technician Workspace and the dispatcher full-edit endpoint.

---

### role_permissions
Explicit permission grants per role per action. Centralizes authorization so adding a new role — or customizing roles per contractor when this platform is sold to others — never requires editing endpoint-by-endpoint logic.

| Column | Type | Notes |
|---|---|---|
| id | text PK | UUID |
| role | text | "owner", "dispatcher", "technician" — fixed set, same CHECK constraint as `technicians.role` |
| action | text | Canonical action key, e.g. "visits.claim", "pay_periods.close", "chat.broadcast" — one row per action this role is allowed to perform |

**Rules:**
- Every `auth:` line in `API_CONTRACT.md` maps to one `action` key here. The server checks this table at request time instead of having the allowed role(s) hardcoded per endpoint.
- A role with no row for a given action is denied by default — permissions are additive (allow-list), never subtractive.
- Adding a new role (e.g. "accountant") is a data operation — insert rows here — not a code change to existing endpoints. New actions a new role needs that don't exist yet for any role do still require new endpoint logic, same as today.
- When this platform serves multiple contractors, each contractor's `role_permissions` rows can differ — one company might grant collaborators access to `inventory.view`, another might not — without forking the codebase.

---

### pdf_batches
Tracks a PDF intake batch from parse through Lobby release. Not historical — exists only to coordinate the review-and-release flow and to confirm delivery before cleanup. Closes a gap where `batchId` appeared in five endpoints with no table backing it, which would silently break if two PDFs were ever reviewed concurrently.

| Column | Type | Notes |
|---|---|---|
| id | text PK | UUID — this is the `batchId` referenced throughout API_CONTRACT.md §5 |
| total_calls | integer | Total calls extracted from the PDF by the AI |
| skipped_count | integer | Calls marked skipped during review — default 0 |
| status | text | "in_review", "released" |
| created_at | text | ISO 8601 |

**Rules:**
- Confirmed calls create `visits` rows with `status = "pending_review"` and a `batch_id` reference (see `visits` table) — that reference is how delivery gets verified at release time, not a separate counter on this table.
- `release-to-lobby` verifies delivery with a simple count check: the number of `visits` rows with this `batch_id` and `status = "pending_review"` must equal `total_calls − skipped_count`. This confirms nothing was lost in transit — it does not re-validate each visit's content, since that was already validated individually at each call's `confirm` step.
- If the count matches: all matching visits move to `status = "in_lobby"`, and this batch's `status → "released"`.
- If the count does not match: nothing is released, the batch stays visible with an alert for manual dispatcher intervention — it is never silently discarded on a mismatch.
- A released batch is not deleted immediately. The next call to `parse-pdf` deletes any existing batch with `status = "released"` before creating the new one — there is no time-based expiry, just displacement by the next batch. This keeps a released batch inspectable for a short while without growing into permanent history.

---

### addresses
The central and permanent entity. One record per physical property.

| Column | Type | Notes |
|---|---|---|
| id | text PK | UUID |
| street | text | Normalized, unique index — collision detection on insert |
| city | text | From PDF on first visit |
| state | text | From PDF on first visit |
| zip | text | From PDF on first visit |
| subdivision | text | From PDF on first visit |
| builder | text | From PDF on first visit |

**Rules:**
- `street` is normalized before insert (uppercase, trim, standard abbreviations).
- If an incoming address is similar but not identical to an existing one, the system presents a side-by-side comparison modal. Dispatcher chooses: create new, merge keeping new data, or merge keeping existing data.
- Visit history is never affected by address merges — only address fields change.

---
The central and permanent entity. One record per physical property.

| Column | Type | Notes |
|---|---|---|
| id | text PK | UUID |
| street | text | Normalized, unique index — collision detection on insert |
| city | text | From PDF on first visit |
| state | text | From PDF on first visit |
| zip | text | From PDF on first visit |
| subdivision | text | From PDF on first visit |
| builder | text | From PDF on first visit |

**Rules:**
- `street` is normalized before insert (uppercase, trim, standard abbreviations).
- If an incoming address is similar but not identical to an existing one, the system presents a side-by-side comparison modal. Dispatcher chooses: create new, merge keeping new data, or merge keeping existing data.
- Visit history is never affected by address merges — only address fields change.
- Weigh-in data for all systems at this address lives in `weigh_in_data` (address_id reference), not in visits. Visible to both technician and dispatcher when viewing the address.

---

### technicians
System users — owner, dispatcher, and technician (field collaborators), per the fixed role set below.

| Column | Type | Notes |
|---|---|---|
| id | text PK | UUID |
| name | text | Display name |
| role | text | "owner", "dispatcher", "technician" — fixed set, enforced via CHECK constraint. Adding a new role always requires new permission logic in code; it is never just a new string value. |
| is_active | boolean | Default true. A deactivated technician's row is never deleted — visit history, pay_period_lines, and edit_log all reference technician_id, so the row must persist for historical integrity. |
| created_at | text | ISO 8601 |

**Rules:**
- Authentication is per-device, not per-user-session — see `API_CONTRACT.md` §1 (one-time invite code, permanent device token, no PIN or daily login). Device tokens are not stored on this table; they live in a separate auth/device-tokens mechanism owned by the auth layer.
- A technician sees only their own assigned visits.
- Financial data of other technicians is not visible between collaborators.
- `role = "owner"` applies Christian's 100% income rule. `role = "technician"` who is not the owner applies the 80/20 split (described as "collaborator" in SYSTEM_DESIGN.md's business context — a relationship descriptor, not a separate role value).
- Personal app configuration (theme, AI provider, API keys) and catalog price overrides live in `technician_settings` and `technician_price_overrides` respectively — not as columns here, since both are per-technician variable-length data, not scalar attributes of identity.
- Deactivating a technician (`is_active → false`) does not block on, move, or reassign their active visits (status `assigned` or `in_progress`) automatically. Those visits become orphaned — still pointing at the now-inactive `technician_id` — and the system creates a dispatcher notification listing them. The dispatcher resolves each one explicitly via `PATCH /api/dispatch/visits/:id/reassign` (to a specific technician) or by releasing it back to the Lobby. There is no automatic Lobby return and no automatic reassignment.

---

### technician_settings
Per-technician app configuration (SYSTEM_DESIGN.md §4.5 — "Personal configuration: theme, AI provider, API keys").

| Column | Type | Notes |
|---|---|---|
| technician_id | text PK, FK | References technicians.id — one row per technician |
| theme | text | "dark", "light", "terminal" |
| ai_provider | text | "anthropic", "openai", "google" |
| ai_api_key_anthropic | text | Stored encrypted — null if not set |
| ai_api_key_openai | text | Stored encrypted — null if not set |
| ai_api_key_google | text | Stored encrypted — null if not set |
| onboarding_completed | boolean | Default false |

**Rules:**
- One row per technician, created on first device-token redemption with defaults.
- A technician can only read/write their own row.

---

### technician_price_overrides
Per-technician customized prices on catalog defaults (SYSTEM_DESIGN.md §4.5 — "Customized prices: overrides on defaults").

| Column | Type | Notes |
|---|---|---|
| id | text PK | UUID |
| technician_id | text FK | References technicians.id |
| item_name | text FK | References catalog_items.item_name or catalog_services.service_name |
| override_price | real | Replaces the catalog default_price for this technician only |

**Rules:**
- A row here takes precedence over `catalog_items.default_price` / `catalog_services.default_price` when this technician creates a visit_item or visit_service for that item.
- Does not affect `custom_price` items (e.g. "Other") — those are already free-form per visit and have no default to override.
- A technician can only read/write their own overrides.

---

### visits
A service call to an address on a specific date, executed by a specific technician. Unifies what the current system calls "job" (pre-completion) and "completion" (post-completion) into a single entity with a status field.

| Column | Type | Notes |
|---|---|---|
| id | text PK | UUID |
| address_id | text FK | References addresses.id |
| technician_id | text FK | References technicians.id |
| batch_id | text FK | References pdf_batches.id — null for visits not created via PDF intake. Used by `release-to-lobby` to verify delivery count for the batch (see pdf_batches rules). Retained after release for traceability, even though pdf_batches itself gets displaced/cleaned up. |
| order_number | text | From The Company's PDF |
| status | text | See states below |
| date | date | Scheduled date |
| scheduled_time | text | e.g. "8:00 AM" |
| work_type | text | As specified in PDF e.g. "AC Startup" |
| company_notes | text | Free-text IMPORTANT NOTES from PDF |
| has_multiple_systems | boolean | Renamed from "is_two_systems" — quick flag, avoids count query on visit_systems. The platform supports any number of systems, not just two, so the name no longer implies a binary cap. |
| is_deferred | boolean | Default false. Set to true by the system automatically when new visits are released to the Lobby for a technician who already has this visit in `assigned` status from a previous day. Never set manually. Allows the PWA to surface carry-over visits distinctly from fresh ones. |
| contact_name | text | Builder contact name |
| contact_phone | text | Builder contact phone |
| contact_channel | text | e.g. "EMAIL", "SUPPLY PRO" |
| total_price | real | Calculated by server on completion |
| created_at | text | ISO 8601 |
| completed_at | text | ISO 8601 — null until completed |

**Status values:**
- `pending_review` — confirmed by dispatcher from PDF batch, not yet visible to technicians
- `in_lobby` — released to Lobby, published, unassigned
- `assigned` — technician claimed or was assigned
- `in_progress` — technician opened workspace
- `completed` — work done, report generated
- `temporarily` — system left on provisionally
- `cancelled` — no work performed, price = $0

A technician-to-technician transfer does not introduce a separate status value here — the visit keeps its current status (typically `assigned` or `in_progress`) throughout. Transfer progress is tracked entirely in the `transfers` table (pending/accepted/rejected/expired); see that table's rules.

**Rules:**
- `cancelled` status deletes all visit_items and visit_services rows for the visit, sets `total_price = 0`. No accessories, fixes, or services are retained — only `notes` remains editable.
- Any visit type can have child visits on future dates — lineage is tracked via address history.
- `has_multiple_systems` is a denormalized convenience flag kept in sync with `visit_systems` row count.

---

### visit_systems
Equipment per system per visit. One row per system (system_number = 1, 2, 3...).

| Column | Type | Notes |
|---|---|---|
| id | text PK | UUID |
| visit_id | text FK | References visits.id |
| system_number | integer | 1-based index |
| indoor_model | text | Furnace or air handler model number |
| outdoor_model | text | Condenser or heat pump model number |
| refrigerant | text | Stored explicitly from catalog at visit time |

**Rules:**
- `refrigerant` is read from the equipment catalog at visit creation and stored explicitly. If the catalog changes later, historical records are unaffected.
- `system_number` increments sequentially per visit starting at 1.

---

### visit_services
Services performed during a visit.

| Column | Type | Notes |
|---|---|---|
| id | text PK | UUID |
| visit_id | text FK | References visits.id |
| service_name | text | "AC", "Heat", "AC & Heat", "Prestart System", "Cancel", "Drive Run" — base service only, matches `catalog_services.service_name` exactly. Finish and Temporarily are never values of this column — see is_finish/is_temporarily below. |
| is_finish | boolean | Finish modifier applied to service_name — has a real pricing effect (see catalog_items.finish_addon_price) |
| is_temporarily | boolean | Temporarily modifier applied to service_name — label only, no pricing effect. Its only consequence is setting the visit's final status to "temporarily" instead of "completed". |
| price | real | Final price after all rules applied |

**Rules:**
- `is_finish` and `is_temporarily` are separate modifiers. "Finish/AC" = service_name "AC" + is_finish true.
- Pricing rules (bundle, system-count multiplier, cancel) are applied by the server before storing price.

---

### visit_items
Accessories, fixes, and thermostats installed during a visit. Unified into one table with a category field.

| Column | Type | Notes |
|---|---|---|
| id | text PK | UUID |
| visit_id | text FK | References visits.id |
| category | text | "accessory", "fix", "thermostat" — fixed set, enforced via CHECK constraint, matching `catalog_items.category` exactly |
| quantity | integer | Default 1 |
| price | real | Price per unit × quantity |
| tech_supplied | boolean | True if item impacts restock |

**Rules:**
- `tech_supplied` is assigned automatically by the server from the catalog — never set manually.
- `category = "thermostat"` → `tech_supplied = true` always.
- `category = "fix"` → `tech_supplied = false` always.
- `category = "accessory"` → `tech_supplied` depends on catalog definition per item.
- If visit status is `cancelled`, no new items can be created — the server rejects the request. Existing items are deleted, not zeroed, when a visit transitions to `cancelled` (see `visits` status rules).

---

### weigh_in_data
Refrigerant charge data per system per address. Captured during a visit but belongs to the address permanently.

| Column | Type | Notes |
|---|---|---|
| id | text PK | UUID |
| address_id | text FK | References addresses.id |
| system_number | integer | System this weigh-in belongs to (1, 2, 3...) |
| lineset_length | real | Feet |
| factory_charge_oz | real | OEM factory charge in oz. For equipment with a `catalog_equipment.revised_charge_oz` value (currently Trane, Lennox), this stores whichever of the two catalog values the technician selected based on the physical nameplate — see `factoryChargeUsed` in API_CONTRACT.md §7. For all other equipment, this is simply `catalog_equipment.factory_charge_oz`. |
| factory_line_config | text | Preset config key |
| approx_adjust_oz | real | Calculated from lineset + config |
| adjusted_oz | real | Recorded by technician |
| fan_speed_cfm | real | Measured CFM |
| liquid_line_temp | real | °F |
| suction_line_temp | real | °F |
| condenser_sat_temp | real | °F |
| subcooling_value | real | Measured subcooling °F |
| oem_subcooling_goal | real | From equipment catalog — stored explicitly |
| subcooling_deviation | real | subcooling_value − oem_subcooling_goal |

**Rules:**
- One row per system per address. Created during the visit where the data is captured, but belongs to the address permanently.
- If data changes (edge case — equipment replacement, major repair): dispatcher updates the existing row. Change is recorded in edit_log.
- A system's weigh-in may be captured across different visits — system 1 on visit 1, system 2 on visit 2. This is normal operating behavior.
- If The Company never reassigns the address, some systems may remain without weigh-in data. This is acceptable — no row is created until data is actually captured.
- `oem_subcooling_goal` is read from the catalog at capture time and stored explicitly for immutable history.
- `approx_adjust_oz` is calculated dynamically from `lineset_length` and `factory_line_config` but stored as evidence of what the technician saw in field.
- `subcooling_deviation` is calculated by the server: positive = overcharged, negative = undercharged.

---

### visit_photos
Photos taken during a visit.

| Column | Type | Notes |
|---|---|---|
| id | text PK | UUID |
| visit_id | text FK | References visits.id |
| system_number | integer | null for non-system-specific photos |
| slug | text | Unique storage key |
| tag | text | "SCALE", "FAN", "NO_GAS_METER", "NO_ELECTRIC_METER", "NO_PDRAIN", "BREAKERS_MISSING", or free text from +Other — used to build filename |
| label | text | Only populated when tag comes from +Other (free text description) |
| category | text | "weigh_in_scale", "fan_speed", "site_evidence" |
| stored_at | text | Google Drive file URL — see rules below |

**Rules:**
- Photos are compressed client-side before upload (already done today in the current PWA, typically 1.3-1.5MB down to 500KB-1MB) — this behavior carries over unchanged.
- The completion ZIP (photos + report) uploads to a Google Drive folder belonging to the company, via a Google service account configured for this purpose. Photos captured during the visit (API_CONTRACT.md §7 `POST /visits/:id/photos`) stay local on the device as the technician works — they are bundled into one ZIP per visit only at completion time (§8), never uploaded individually. The server stores the resulting Drive file URL in `stored_at` once that upload succeeds — `stored_at` is null until then.
- Upload happens in the background as part of the completion send flow (API_CONTRACT.md §8) — same offline-queue-and-retry behavior as the rest of completion, no separate technician action required.
- Retention is not automatic: files are kept in Drive for roughly 60-90 days and cleaned up manually (or via a future Cowork-assisted routine) rather than through an automatic expiration policy on the storage provider itself.
- `category` and `tag` are assigned automatically based on which fixed button the technician pressed (SCALE, FAN, NO_GAS_METER, NO_ELECTRIC_METER, NO_PDRAIN, BREAKERS_MISSING) — except when the technician uses +Other, where they write `tag` and `label` freely as plain text.
- `tag` corresponds to a fixed button or free text when the technician uses +Other.
- `system_number` is null for `site_evidence` photos not tied to a specific system.
- Filename convention: `{address}_{tag}` or `{address}_{tag}_SYS{system_number}` when system-specific, e.g. `5523_SILK_PETAL_NO_GAS_METER`, `7746_TRIBUTE_CIR_SCALE_SYS2`.
- Multiple site_evidence photos per visit are allowed — each documented condition is an independent photo.
- Photos are sent to The Company as evidence with the completion report.

---

### transfers
Technician-to-technician visit reassignment. No dispatcher approval required.

| Column | Type | Notes |
|---|---|---|
| id | text PK | UUID |
| visit_id | text FK | References visits.id |
| from_tech_id | text FK | References technicians.id |
| to_tech_id | text FK | References technicians.id |
| reason | text | Brief reason documented by Tech1 |
| status | text | "pending", "accepted", "rejected", "expired" |
| created_at | text | ISO 8601 |
| accepted_at | text | ISO 8601 — null until accepted |
| resolved_at | text | ISO 8601 — accepted_at or rejected_at |

**Flow:**
1. Tech1 initiates transfer in PWA — selects Tech2, writes reason.
2. Visit remains assigned to Tech1 while status = pending.
3. Tech2 accepts → status = accepted → visit moves to Tech2 → Dispatch notified automatically.
4. Tech2 rejects or ignores → status = rejected or remains pending → visit stays with Tech1.

**Rules:**
- Visit never returns to Lobby during a transfer.
- Dispatcher is informed, not an approver.
- Transfer reason is permanently recorded in visit history.
- If Tech2 never responds and the visit is completed by Tech1 through normal workflow, the pending transfer is marked "expired" and Tech2's notification is cleared automatically.

---

### inventory_assignments
Stock assigned to each technician per period.

| Column | Type | Notes |
|---|---|---|
| id | text PK | UUID |
| technician_id | text FK | References technicians.id |
| item_name | text | Canonical name from catalog |
| quantity_assigned | integer | Units assigned at period start |
| period_start | date | Monday of the period |
| created_at | text | ISO 8601 |

**Rules:**
- Current balance is calculated dynamically: quantity_assigned − SUM(visit_items where tech_supplied = true) for the period. Never stored as a column.
- All technicians handle the same accessory catalog.
- The Company provides all material — the system tracks consumption, not purchases.
- Technicians can view their own current balance only. Dispatcher sees all.

---

### restock_records
Per-item restock status per period, tracking what The Company still needs to replenish. Distinct from `inventory_assignments` — that table tracks what a technician currently holds, this one tracks the replenishment request itself, matching SYSTEM_DESIGN.md §4.8's "Restock Report" entity.

| Column | Type | Notes |
|---|---|---|
| id | text PK | UUID |
| period_start | date | Monday of the period this restock report covers |
| period_end | date | Sunday of the period |
| item_name | text FK | References catalog_items.item_name |
| total_consumed | integer | Sum across all technicians for this item, this period |
| status | text | "pending", "restocked" |
| restocked_at | text | ISO 8601 — null until marked restocked |

**Rules:**
- One row per item per period — not per technician. Per-technician breakdown is derived on demand from `visit_items` (tech_supplied = true) for the report view, not stored here.
- `POST /api/dispatch/restock-report/mark-restocked` (API_CONTRACT.md §10) writes `status = "restocked"` and sets `restocked_at` here — this is the actual persistence target that endpoint was missing.
- Does not deduct or adjust `inventory_assignments` — The Company provides material, so this is an audit/tracking record, not an inventory transaction.

---

### pay_periods
Weekly settlement header. One record per Monday–Sunday week.

| Column | Type | Notes |
|---|---|---|
| id | text PK | UUID |
| week_start | date | Monday |
| week_end | date | Sunday |
| status | text | "open", "closed", "paid" |
| gross_total | real | Sum of all completed visit totals in period |
| tax_amount | real | Informational — pending accounting confirmation |
| paid_at | text | ISO 8601 — null until paid |

**Status values:**
- `open` — current week, accumulating visits.
- `closed` — week ended, totals calculated, pending payment.
- `paid` — check received from The Company.

**Payment cycle:**
- The Company pays Christian by check the Friday following the worked period.
- Christian pays collaborators within 48 business hours of receiving the check.

---

### pay_period_lines
Per-technician breakdown within a pay period.

| Column | Type | Notes |
|---|---|---|
| id | text PK | UUID |
| period_id | text FK | References pay_periods.id |
| technician_id | text FK | References technicians.id |
| gross_amount | real | Total generated by technician in period |
| commission_retained | real | 20% if technician (non-owner), 0% if owner |
| net_amount | real | Amount technician receives |

**Rules:**
- `role = "owner"` → commission_retained = 0, net_amount = gross_amount.
- `role = "technician"` (non-owner) → commission_retained = gross_amount × 0.20, net_amount = gross_amount × 0.80.
- Tax is calculated at the pay_periods level on Christian's total income.

---

### chat_messages
Direct and broadcast messages between system users.

| Column | Type | Notes |
|---|---|---|
| id | text PK | UUID |
| sender_id | text FK | References technicians.id |
| recipient_id | text FK | References technicians.id — null if broadcast |
| body | text | Message content |
| type | text | "direct", "broadcast" |
| created_at | text | ISO 8601 |

**Rules:**
- `type = "direct"` → one sender, one recipient.
- `type = "broadcast"` → recipient_id is null, visible to all technicians.
- Only owner and dispatcher roles can send broadcasts.
- Read receipts for broadcasts are tracked in chat_reads.

---

### chat_reads
Read receipts per message per technician.

| Column | Type | Notes |
|---|---|---|
| id | text PK | UUID |
| message_id | text FK | References chat_messages.id |
| technician_id | text FK | References technicians.id |
| read_at | text | ISO 8601 |

**Rules:**
- One row per technician per broadcast message when read.
- Direct messages have one row for the recipient.
- Only owner and dispatcher can see read receipts.

---

### notifications
System-generated alerts per user.

| Column | Type | Notes |
|---|---|---|
| id | text PK | UUID |
| recipient_id | text FK | References technicians.id |
| type | text | See types below |
| body | text | Human-readable notification text |
| link_to | text | Direct path to relevant system area |
| payload | text | JSON metadata — file paths, visit IDs, etc. |
| read | boolean | Default false |
| created_at | text | ISO 8601 |

**Notification types:**
- `assignment` — visit assigned to technician
- `transfer_request` — incoming transfer request from another tech
- `transfer_accepted` — Tech2 accepted transfer
- `transfer_rejected` — Tech2 rejected transfer
- `message` — new direct chat message
- `broadcast` — new broadcast message
- `completion_received` — dispatcher: technician submitted completion
- `day_report_ready` — dispatcher: end-of-day files generated (JSON, CSV, TXT)
- `restock_ready` — dispatcher: restock report ready for review

**Rules:**
- Notifications are system-generated — never created manually.
- `link_to` navigates directly to the relevant area on tap.
- End-of-day report notification includes file paths in `payload`.
- The notification list shows a truncated preview of `body` — long enough to understand the notification without opening it.
- An X button marks a notification as read without navigating anywhere.
- Notifications are never deleted — they persist as a permanent log, marked read or unread.

---

### corrections
Technician-submitted requests to change a visit after it was already submitted. Distinct from `edit_log`: this table is the form and its review status (pending/approved/rejected); `edit_log` is the permanent record that a change actually occurred, regardless of whether it came from here or from a direct dispatcher edit.

| Column | Type | Notes |
|---|---|---|
| id | text PK | UUID |
| visit_id | text FK | References visits.id |
| requested_by | text FK | References technicians.id — the technician requesting the change on their own submitted visit |
| corrected_fields | text | JSON object of proposed field changes |
| reason | text | Technician's explanation — may be empty |
| status | text | "pending", "approved", "rejected" |
| requested_at | text | ISO 8601 |
| resolved_at | text | ISO 8601 — null until approved or rejected |
| dispatcher_note | text | Dispatcher's explanation when rejecting — null otherwise. Optional but encouraged, so the technician understands why their request didn't go through. |

**Rules:**
- Only the technician who was originally assigned to the visit can submit a correction for it.
- A visit must already be submitted (status completed/temporarily/cancelled) for a correction to apply — pre-submission edits happen freely in the technician's own Reports view and never touch this table.
- On approval, the dispatcher applies `corrected_fields` to the visit and an `edit_log` row is created using this row's `reason` as the log entry's basis — the technician's stated reason becomes the record of why the change happened, the dispatcher doesn't have to re-type it.
- On rejection, no changes are applied to the visit and no `edit_log` entry is created.
- Pay-period cutoff logic (before/after cutoff determines which period the correction lands in) is evaluated at approval time — see API_CONTRACT.md §9.

---

### edit_log
Change history for visits — what changed and when, not who requested it.

| Column | Type | Notes |
|---|---|---|
| id | text PK | UUID |
| visit_id | text FK | References visits.id |
| changed_at | text | ISO 8601 |
| summary | text | Human-readable description of what changed |
| source | text | "dispatch_direct" — dispatcher edited the visit directly via `PATCH /api/dispatch/visits/:id`. "correction_approved" — change originated from a technician's `corrections` request that the dispatcher approved; in this case `corrections.reason` is carried into `summary`. |

**Rules:**
- One row per edit action — not per field.
- Displayed in History as an expandable mini-log per visit (e.g. "06-15 20:15 — edited from Dispatch").
- Does not track which user made the change — only when, what, and which of the two sources it came from.

---

## Relationships Summary

| Table | Relates to | Via |
|---|---|---|
| visits | addresses | address_id |
| visits | technicians | technician_id |
| visit_systems | visits | visit_id |
| visit_systems | catalog_equipment | indoor_model, outdoor_model |
| visit_services | visits | visit_id |
| visit_services | catalog_services | service_name |
| visit_items | visits | visit_id |
| visit_items | catalog_items | item_name |
| weigh_in_data | addresses | address_id |
| weigh_in_data | catalog_lineset_configs | factory_line_config |
| visit_photos | visits | visit_id |
| transfers | visits | visit_id |
| transfers | technicians | from_tech_id, to_tech_id |
| inventory_assignments | technicians | technician_id |
| inventory_assignments | catalog_items | item_name |
| catalog_item_relations | catalog_items | item_name, related_item_name |
| role_permissions | technicians | role |
| pay_period_lines | pay_periods | period_id |
| pay_period_lines | technicians | technician_id |
| chat_messages | technicians | sender_id, recipient_id |
| chat_reads | chat_messages | message_id |
| chat_reads | technicians | technician_id |
| notifications | technicians | recipient_id |
| edit_log | visits | visit_id |

---

*Document generated in planning session — 2026-06-15*
*Version 1.0 — first formal data model*
*Next step: API contract definition and development plan*
