# Data Model
## Field Ops + Dispatch — HVAC Startup Platform
**Version:** 1.0
**Date:** 2026-06-15
**Authors:** Christian Huerta + Claude (planning session)
**Status:** Design baseline — pre-development

---

## Overview

16 tables covering all entities defined in SYSTEM_DESIGN.md. Designed for SQLite (current) with a clean migration path to PostgreSQL when multi-user concurrency requires it.

All primary keys are UUIDs. All timestamps are stored as ISO 8601 text.

---

## Tables

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

### technicians
System users — dispatcher, owner, and field technicians.

| Column | Type | Notes |
|---|---|---|
| id | text PK | UUID |
| name | text | Display name |
| role | text | "owner", "dispatcher", "collaborator" |
| pin_hash | text | Hashed PIN for field authentication |

**Rules:**
- A technician sees only their own assigned visits.
- Financial data of other technicians is not visible between collaborators.
- `role = "owner"` applies Christian's 100% income rule. `role = "collaborator"` applies the 80/20 split.

---

### visits
A service call to an address on a specific date, executed by a specific technician. Unifies what the current system calls "job" (pre-completion) and "completion" (post-completion) into a single entity with a status field.

| Column | Type | Notes |
|---|---|---|
| id | text PK | UUID |
| address_id | text FK | References addresses.id |
| technician_id | text FK | References technicians.id |
| order_number | text | From The Company's PDF |
| status | text | See states below |
| date | date | Scheduled date |
| scheduled_time | text | e.g. "8:00 AM" |
| work_type | text | As specified in PDF e.g. "AC Startup" |
| company_notes | text | Free-text IMPORTANT NOTES from PDF |
| is_two_systems | boolean | Quick flag — avoids count query on visit_systems |
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
- `transferred` — reassignment in progress

**Rules:**
- `cancelled` status sets `total_price = 0`. No accessories or fixes can be charged.
- Any visit type can have child visits on future dates — lineage is tracked via address history.
- `is_two_systems` is a denormalized convenience flag kept in sync with `visit_systems` row count.

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
| service_name | text | "AC", "Heat", "AC & Heat", "Prestart System", "Finish", "Temporarily", "Cancel", "Drive Run" |
| is_finish | boolean | Finish modifier applied to service_name |
| is_temporarily | boolean | Temporarily modifier applied to service_name |
| price | real | Final price after all rules applied |

**Rules:**
- `is_finish` and `is_temporarily` are separate modifiers. "Finish/AC" = service_name "AC" + is_finish true.
- Pricing rules (bundle, two systems, cancel) are applied by the server before storing price.

---

### visit_items
Accessories, fixes, and thermostats installed during a visit. Unified into one table with a category field.

| Column | Type | Notes |
|---|---|---|
| id | text PK | UUID |
| visit_id | text FK | References visits.id |
| category | text | "accessory", "fix", "thermostat" |
| item_name | text | Canonical name from catalog |
| quantity | integer | Default 1 |
| price | real | Price per unit × quantity |
| tech_supplied | boolean | True if item impacts restock |

**Rules:**
- `tech_supplied` is assigned automatically by the server from the catalog — never set manually.
- `category = "thermostat"` → `tech_supplied = true` always.
- `category = "fix"` → `tech_supplied = false` always.
- `category = "accessory"` → `tech_supplied` depends on catalog definition per item.
- If visit status is `cancelled`, all item prices are set to $0.

---

### weigh_in_data
Refrigerant charge data per system per visit.

| Column | Type | Notes |
|---|---|---|
| id | text PK | UUID |
| visit_id | text FK | References visits.id |
| system_number | integer | Matches visit_systems.system_number |
| lineset_length | real | Feet |
| factory_charge_oz | real | OEM factory charge in oz |
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
- `oem_subcooling_goal` is read from the catalog at visit creation and stored explicitly for immutable history.
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
| stored_at | text | File path or URL |

**Rules:**
- `category` is assigned automatically by the system based on the photo action — never written manually.
- `tag` corresponds to a fixed button (SCALE, FAN, NO_GAS_METER, NO_ELECTRIC_METER, NO_PDRAIN, BREAKERS_MISSING) or free text when the technician uses +Other.
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
| commission_retained | real | 20% if collaborator, 0% if owner |
| net_amount | real | Amount technician receives |

**Rules:**
- `role = "owner"` → commission_retained = 0, net_amount = gross_amount.
- `role = "collaborator"` → commission_retained = gross_amount × 0.20, net_amount = gross_amount × 0.80.
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

### edit_log
Change history for visits — what changed and when, not who.

| Column | Type | Notes |
|---|---|---|
| id | text PK | UUID |
| visit_id | text FK | References visits.id |
| changed_at | text | ISO 8601 |
| summary | text | Human-readable description of what changed |
| source | text | "dispatch" or "import" — where the edit originated |

**Rules:**
- One row per edit action — not per field.
- Displayed in History as an expandable mini-log per visit (e.g. "06-15 20:15 — edited from Dispatch").
- Does not track which user made the change — only when and what.

---

## Relationships Summary

| Table | Relates to | Via |
|---|---|---|
| visits | addresses | address_id |
| visits | technicians | technician_id |
| visit_systems | visits | visit_id |
| visit_services | visits | visit_id |
| visit_items | visits | visit_id |
| weigh_in_data | visits | visit_id |
| visit_photos | visits | visit_id |
| transfers | visits | visit_id |
| transfers | technicians | from_tech_id, to_tech_id |
| inventory_assignments | technicians | technician_id |
| pay_period_lines | pay_periods | period_id |
| pay_period_lines | technicians | technician_id |
| chat_messages | technicians | sender_id, recipient_id |
| chat_reads | chat_messages | message_id |
| chat_reads | technicians | technician_id |
| notifications | technicians | recipient_id |

---

*Document generated in planning session — 2026-06-15*
*Version 1.0 — first formal data model*
*Next step: API contract definition and development plan*
