# API Contract
## Field Ops + Dispatch — HVAC Startup Platform
**Version:** 1.0
**Date:** 2026-06-15
**Authors:** Christian Huerta + Claude (planning session)
**Status:** Design baseline — pre-development

---

## Overview

This document defines every API endpoint required by the system described in `SYSTEM_DESIGN.md` and `DATA_MODEL.md`. It is organized by domain in the same order the data model was reviewed.

All endpoints are prefixed `/api`. All authenticated endpoints require a valid bearer token unless noted otherwise. Role-restricted endpoints are marked explicitly.

This contract defines behavior and shape, not implementation. Security details (token expiration, transport requirements, duplicate-device handling) are left to implementation-time best practices and are noted where relevant.

---

## 1. Authentication

Field technicians authenticate once per device via a one-time invite code. No daily login is required — the device holds a permanent token until revoked.

**Flow:**
1. Dispatcher creates technician record in Dispatch, generates a one-time invite code (24-hour validity).
2. Technician opens the PWA for the first time, enters the invite code.
3. Server validates the code, issues a permanent device token, technician never sees it again.
4. Every subsequent request includes `Authorization: Bearer {deviceToken}`.
5. If a device is lost, dispatcher revokes the token from Dispatch — device is blocked immediately.

```
POST /api/auth/redeem-invite
  body: { inviteCode }
  returns: { deviceToken, technician: { id, name, role } }

POST /api/auth/revoke
  auth: dispatcher/owner only
  body: { technicianId }
  effect: invalidates all device tokens for that technician

POST /api/auth/generate-invite
  auth: dispatcher/owner only
  body: { technicianId }
  fails if: technician.is_active = false — must be reactivated first via
            PATCH /api/dispatch/technicians/:id/reactivate
  returns: { inviteCode, expiresAt }
```

**Pending for implementation phase (not blocking design):** token expiration policy, HTTPS enforcement, behavior on duplicate device redemption.

---

## 2. Sync

"Real-time" elsewhere in these documents does not mean instant push — for genuinely urgent communication, a phone call is the right tool, and the platform doesn't need to compete with that. What it means here is that the PWA and Dispatch stay reasonably current with each other without requiring a manual refresh or a full re-download, while staying robust against the weak (rarely zero) signal common at new-construction sites.

The mechanism is polling, not WebSockets or Server-Sent Events — the complexity of a persistent push connection isn't justified when a few seconds of delay is acceptable, and polling degrades more gracefully on flaky connections: each attempt is independent, so a failed poll just gets retried, with no connection state to recover.

```
GET /api/sync/changes
  auth: technician or dispatcher
  query: { since: <ISO 8601 timestamp of last successful sync> }
  returns: { visits: [] of changed visits since `since`, notifications: [] of
            new notifications since `since`, chatMessages: [] of new messages
            since `since`, corrections: [] of new/updated corrections since
            `since` (dispatcher sees pending requests, technician sees
            resolution of their own), serverTime: <ISO 8601, to use as next `since`> }
  note: returns deltas only — never re-sends the full catalog or full visit
        list. Catalog data is fetched separately and far less frequently
        (§6) since it changes rarely compared to visits.
```

**Polling interval:** suggested 15-30 seconds while the app is in the foreground, paused when backgrounded. The exact number is an implementation detail, not a design constraint — adjust based on real battery/data usage once built.

---

### Technician lifecycle

```
POST /api/dispatch/technicians
  auth: dispatcher/owner only
  body: { name, role }
  effect: creates technicians row, is_active = true, created_at set
  returns: { technicianId, name, role, isActive, createdAt }
  note: this is the only way a technician row comes into existence — generate-invite
        above requires the technicianId to already exist, created here first

GET /api/dispatch/technicians
  auth: dispatcher/owner only
  query: ?includeInactive?
  returns: [] of technicians, active only by default

PATCH /api/dispatch/technicians/:id/deactivate
  auth: dispatcher/owner only
  effect: is_active → false. Does not delete the row, does not touch their
          active visits automatically (see DATA_MODEL.md technicians rules).
          If the technician has any visits with status "assigned" or
          "in_progress", creates a dispatcher notification listing them as
          orphaned, to be resolved via PATCH /api/dispatch/visits/:id/reassign
          or by releasing them back to the Lobby.
  returns: updated technician + list of any orphaned visit ids

PATCH /api/dispatch/technicians/:id/reactivate
  auth: dispatcher/owner only
  effect: is_active → true. Same technician_id, same historical visits,
          pay_period_lines, and edit_log entries — reactivation preserves
          continuity rather than starting a new identity, since the same
          person returning should not appear as a second, disconnected record.
  note: does not automatically restore a device token. If their old device
        token was revoked at deactivation time (or they have a new device),
        generate a fresh invite via POST /api/auth/generate-invite after
        reactivating. If the token was never revoked, no new invite is needed.
  returns: updated technician
```

---

## 3. Technician Settings & Price Overrides

```
GET /api/technicians/me/settings
  auth: technician
  returns: technician_settings row for caller (created with defaults on first
           device-token redemption if it doesn't exist yet)

PATCH /api/technicians/me/settings
  auth: technician
  body: any of { theme, aiProvider, aiApiKeyAnthropic, aiApiKeyOpenai, aiApiKeyGoogle, onboardingCompleted }
  effect: updates technician_settings row for caller — a technician can only
          read/write their own row, never another technician's

GET /api/technicians/me/price-overrides
  auth: technician
  returns: [] of technician_price_overrides rows for caller

POST /api/technicians/me/price-overrides
  auth: technician
  body: { itemName, overridePrice }
  effect: creates or updates a technician_price_overrides row for caller —
          takes precedence over catalog default_price for this technician's
          future visit_items/visit_services using this itemName

DELETE /api/technicians/me/price-overrides/:itemName
  auth: technician
  effect: removes the override — caller's visits fall back to catalog default_price
```

---

## 4. Lobby & Visit Assignment

```
GET /api/visits/lobby
  auth: technician
  returns: [] of visits where status = "in_lobby"
  fields: id, address, subdivision, builder, scheduledTime, workType,
          hasMultipleSystems, tags (urgent, a2l, multiSystem, builder)

POST /api/visits/:id/claim
  auth: technician
  effect: status → "assigned", technician_id → caller
  fails if: visit no longer in_lobby (race condition — another tech claimed it first)
  error: "This visit was just claimed by another technician" — first come, first served

GET /api/visits/mine
  auth: technician
  returns: [] of visits where technician_id = caller, status in (assigned, in_progress, temporarily)

POST /api/visits/:id/start
  auth: technician (must be assigned)
  effect: status → "in_progress"

GET /api/visits/:id
  auth: technician (must be assigned) or dispatcher
  returns: full visit object — context fields, systems, pre-selected accessories/thermostat

PATCH /api/dispatch/visits/:id/reassign
  auth: dispatcher/owner only
  body: { technicianId }
  effect: visit.technician_id → technicianId. If visit.status was "in_lobby",
          it also becomes "assigned". Otherwise status is left untouched.
  note: this is the dispatcher's direct-control path — distinct from a
        technician claiming from the Lobby and from a technician-to-technician
        transfer (§14). No acceptance from the receiving technician is
        required; the dispatcher's decision is final. This is the typical
        day-to-day operating mode (see SYSTEM_DESIGN.md §6, step 4) — the
        Lobby is the alternative, used when the dispatcher has no preference.
        The same endpoint resolves orphaned visits after a technician
        deactivation (see §1 Technician lifecycle).
```

---

## 5. Dispatch — PDF Intake & Visit Creation

Calls are reviewed one at a time against the original PDF, confirmed individually, but held in a pre-lobby state (`pending_review`) until the entire batch is reviewed. Confirmed calls are released to the Lobby together once the batch is complete.

```
POST /api/dispatch/parse-pdf
  auth: dispatcher
  body: PDF file (multipart)
  effect: deletes any existing pdf_batches row with status = "released"
          (displacement cleanup — see pdf_batches rules)
          AI extracts fields per call found in PDF
          creates a pdf_batches row: total_calls = N, skipped_count = 0,
            status = "in_review"
  returns: { batchId, totalCalls, calls: [] of draft visits with index (1 of N, 2 of N...) }

GET /api/dispatch/batch/:batchId/call/:index
  auth: dispatcher
  returns: single draft visit pre-filled, plus reference to original PDF page/section
           for side-by-side comparison

POST /api/dispatch/batch/:batchId/call/:index/confirm
  auth: dispatcher
  body: edited draft visit fields
  effect: creates address (or triggers comparison modal if near-match found)
          creates visit with status "pending_review", batch_id = batchId —
            NOT visible to technicians yet
  returns: { created: true, visitId } or { comparisonRequired: true, addressId }

POST /api/dispatch/batch/:batchId/call/:index/skip
  auth: dispatcher
  effect: increments pdf_batches.skipped_count for this batch — marks this
          call as skipped, won't be created, doesn't block other calls in batch

POST /api/dispatch/batch/:batchId/release-to-lobby
  auth: dispatcher
  requires: all calls in batch confirmed or skipped
  effect: verifies delivery — count of visits where batch_id = batchId and
            status = "pending_review" must equal total_calls − skipped_count
          if count matches: moves all matching visits → "in_lobby"
            simultaneously, sets pdf_batches.status → "released"
            for each technician who already has visits in "assigned" status
            from a previous day, sets is_deferred = true on those existing
            assigned visits — signals to the PWA that carry-over work exists
          if count does not match: nothing is released, batch stays
            "in_review" with an alert for manual dispatcher intervention
  returns: { releasedCount, visitIds: [...] } or { mismatch: true, expected, actual }

POST /api/addresses/:id/resolve-comparison
  auth: dispatcher
  body: { action: "create_new" | "merge_keep_new" | "merge_keep_existing", incomingData }
  effect: resolves the address conflict per the chosen action — visit history is
          never affected by the resolution, only address fields change

POST /api/dispatch/visits/create-manual
  auth: dispatcher
  body: { address, orderNumber, scheduledTime, workType, systemCount?, notes? }
  effect: creates address (or triggers comparison modal if near-match found)
          creates visit with status "pending_review" — same starting state as
          PDF-confirmed visits, so the dispatcher can review before releasing.
          No batch is created — the visit stands alone and must be released
          individually via a dedicated release call or included in the next
          release-to-lobby operation.
  note: this is the manual-entry path alongside the PDF extraction path.
        Both produce visits in pending_review with the same downstream flow:
        review → release → Lobby → assign. The origin (PDF vs manual) does
        not affect any subsequent behavior.
  returns: { visitId } or { comparisonRequired: true, addressId }
```

---

## 6. Catalog

The PWA is offline-first (SYSTEM_DESIGN.md §8.1) and must be able to download and cache all catalog data on the device. These endpoints are the only way catalog data reaches the client — server-side resolution (refrigerant, tech_supplied, pricing) consumes the same tables internally, but the client never gets this data any other way.

```
GET /api/catalog/equipment
  auth: technician or dispatcher
  returns: [] of catalog_equipment rows

GET /api/catalog/lineset-configs
  auth: technician or dispatcher
  returns: [] of catalog_lineset_configs rows

GET /api/catalog/items
  auth: technician or dispatcher
  returns: [] of catalog_items rows

GET /api/catalog/item-relations
  auth: technician or dispatcher
  returns: [] of catalog_item_relations rows

GET /api/catalog/services
  auth: technician or dispatcher
  returns: [] of catalog_services rows

PATCH /api/dispatch/catalog/:table/:id
  auth: dispatcher
  body: any editable column for the given catalog row
  effect: updates the catalog row — e.g. dispatcher manually updating pesp
          from a technician's field-reading note
  note: editing a catalog value never changes historical visit records —
        only future visits read the updated value (see catalog_equipment rules)
```

---

## 7. Workspace — Field Execution

```
PATCH /api/visits/:id/services
  auth: technician (must be assigned)
  body: { serviceName, isFinish, isTemporarily }
  note: serviceName carries the base service value, including "Prestart System"
        and "Cancel" — those are NOT separate flags, they are values of
        serviceName itself. isFinish and isTemporarily are modifiers that can
        apply on top of any base service (e.g. serviceName: "AC", isFinish: true
        → "Finish/AC"). hasMultipleSystems is NOT part of this payload — it lives on
        visits, not visit_services, since it describes the visit as a whole.
  effect: creates/updates visit_services row, server recalculates price
          (bundle rule, system-count multiplier, cancel rule)
  
  special case — switching to Cancel with existing items:
    if visit_items exist:
      → returns { requiresConfirmation: true, itemsToRemove: [...] }
      → PWA shows warning modal before proceeding
      → technician confirms → resend with { serviceName: "Cancel", confirmed: true }
      → server deletes all visit_items and visit_services, total_price → 0
    if no visit_items exist: proceeds directly, no confirmation needed
    Cancel only accepts `notes` afterward — no other workspace field is editable.
  
  returns: updated visit with new total_price

POST /api/visits/:id/items
  auth: technician (must be assigned)
  body: { category, itemName, quantity, price? }
  note: price is required when itemName references a catalog_items row with
        custom_price = true (e.g. "Other") — there is no default_price to fall
        back on for those items. For all other items, price is ignored if sent
        and the server uses catalog default_price instead.
  effect: creates visit_items row — server resolves tech_supplied from catalog
          server checks catalog_item_relations for itemName:
            companion rows → auto-creates visit_items rows for each related_item_name
            exclusion_group rows → auto-removes any existing visit_items row for
              other items sharing the same exclusion_group_id
  fails if: visit status = cancelled — server rejects the request, no item is created
  returns: updated visit with new total_price (reflecting any cascaded items)

DELETE /api/visits/:id/items/:itemId
  auth: technician (must be assigned)
  effect: removes item, recalculates total_price
          if the removed item has companion rows in catalog_item_relations,
          those auto-created companion visit_items rows are removed too

PATCH /api/visits/:id/systems/:systemNumber
  auth: technician (must be assigned)
  body: { indoorModel, outdoorModel }
  effect: updates models, re-resolves refrigerant from catalog

PUT /api/visits/:id/weigh-in/:systemNumber
  auth: technician (must be assigned)
  body: { linesetLength, factoryLineConfig, factoryChargeUsed, adjustedOz, fanSpeedCfm,
          liquidLineTemp, suctionLineTemp, condenserSatTemp, subcoolingValue }
  note: factoryChargeUsed is the technician's choice of "factory" or "revised" — required
        whenever the visit's equipment model has a non-null catalog_equipment.revised_charge_oz
        (currently Trane and Lennox lineset config variants). The technician reads the
        physical nameplate in the field and picks accordingly; the server cannot resolve
        this automatically. Ignored (and not required) for models with no revised_charge_oz.
  effect: server calculates approxAdjustOz from catalog_lineset_configs, reads
          oemSubcoolingGoal from catalog_equipment, calculates subcoolingDeviation,
          stores whichever factory_charge_oz value (factory or revised) corresponds
          to factoryChargeUsed
  returns: full weigh-in record with calculated fields

POST /api/visits/:id/photos
  auth: technician (must be assigned)
  body: image file (multipart) + { category, tag, systemNumber?, label? }
  note: tag identifies which fixed button was pressed (SCALE, FAN, NO_GAS_METER,
        NO_ELECTRIC_METER, NO_PDRAIN, BREAKERS_MISSING) or carries free text when
        the technician uses +Other. category alone cannot disambiguate this —
        multiple fixed buttons share category = "site_evidence". label is only
        populated when tag comes from +Other.
  effect: stores the photo locally on the device (compressed, per
          DATA_MODEL.md visit_photos rules) — does NOT upload to Google Drive
          at this point. Photos for a visit accumulate locally as the
          technician works and are only bundled into the visit's ZIP and
          uploaded together when that visit is completed (§8) — one ZIP per
          completed visit, never one upload per photo.
  returns: { photoId, storedAt: null until the visit's ZIP uploads at completion }

PATCH /api/visits/:id/notes
  auth: technician (must be assigned)
  body: { notes }
```

---

## 8. Completion & Offline Behavior

```
POST /api/visits/:id/complete
  auth: technician (must be assigned)
  requires: at least one visit_service exists (unless service = Cancel)
  effect: status set to final outcome per selected service (see visits.status in DATA_MODEL.md)
          completed_at timestamp set
          inventory_assignments consumption reflects tech_supplied items (skipped if cancelled)
          notification created for dispatcher: "completion_received"
          if any pending transfers exist for this visit → marked "expired",
          recipient's notification cleared automatically
  returns: full completion record

GET /api/visits/:id/report-preview
  auth: technician (must be assigned) or dispatcher
  returns: { reportText } — comma-separated string matching current PWA format

GET /api/visits/:id/download
  auth: technician (must be assigned) or dispatcher
  returns: JSON file matching current completion JSON format
  note: must be generable entirely from local device data — no server round-trip
        required when offline
```

**Client-side behavior (PWA) — send-on-completion:**

When the technician finishes a workspace, the completion report (and photo ZIP, if applicable) is generated and stored locally first — it is not sent instantly. Two submission modes are possible (to be decided during development):

- **Countdown mode** — a short countdown (duration TBD) gives the technician a window to review and cancel the send. If the countdown completes without cancellation, the report is sent automatically.
- **Manual submit mode** — the technician taps Submit explicitly, either per visit or once at the end of the route.

Once a report is actually sent and processed by Dispatch, this window has closed. From that point, any change requires the formal correction flow in §9 — the two mechanisms operate at different moments and are not interchangeable: this section covers the pre-send window, §9 covers post-send correction.

1. Technician finishes workspace → report + photos generated locally.
2. Countdown or manual trigger → sends to Dispatch.
3. Online → sends → success icon shown on the visit's Reports card.
4. Offline → completion queued locally (IndexedDB) → modal: "No internet connection — this report cannot be sent. Download to send manually, or wait for connection?" [Download] [Wait]
5. "Wait" → PWA retries automatically in background when connection returns → icon updates to success once sent.
6. "Download" → generates JSON locally, no server call needed → icon reflects "downloaded, not auto-sent" (distinct from the success icon).
7. Queued completions never block work on other visits.

---

## 9. Visit Correction (Post-Completion)

Technicians can edit their own completions freely before submitting, from the Reports section. After submission, changes require a formal correction request.

```
POST /api/visits/:id/request-correction
  auth: technician (must be original assignee)
  requires: visit status = completed/temporarily/cancelled (already submitted)
  body: { correctedFields, reason }
  effect: creates a corrections row, status "pending" — does not apply changes yet
  returns: { correctionId, status: "pending" }

PATCH /api/dispatch/corrections/:id/approve
  auth: dispatcher
  effect: corrections.status → "approved", resolved_at set
          applies corrected_fields to the visit
          creates edit_log entry (source: "correction_approved", summary
            built from corrections.reason)
          checks pay period cutoff date:
            before cutoff → reflected in current period
            after cutoff → reflected in next period
  returns: updated visit + which pay period it affects

PATCH /api/dispatch/corrections/:id/reject
  auth: dispatcher
  body: { dispatcherNote? }
  effect: corrections.status → "rejected", resolved_at set,
          dispatcher_note stored if provided
          no changes applied to the visit, no edit_log entry created
          creates notification for the requesting technician, including
          dispatcher_note if present
  returns: updated correction

GET /api/dispatch/corrections
  auth: dispatcher
  query: ?status?
  returns: [] of corrections, pending first by default — the dispatcher's
           review queue
```

**Note:** the grace period for corrections (how long after submission a correction can be requested) depends on terms from The Company — pending external definition, see `SYSTEM_DESIGN.md` §10.

**Derived artifacts (JSON to Dispatch, CSV, report to The Company) are never edited directly.** They are always regenerated on demand from current `visits` data, so a correction automatically propagates to all three the next time they're generated — no manual file sync required.

---

## 10. Dispatch — History, Edit Log, Inventory, Restock

```
GET /api/dispatch/history
  auth: dispatcher
  query: ?addressId? ?technicianId? ?dateFrom? ?dateTo? ?status?
  returns: [] of visits matching filters, grouped by address by default

GET /api/dispatch/history/address/:addressId
  auth: dispatcher
  returns: full visit history for one address, chronological

PATCH /api/dispatch/visits/:id
  auth: dispatcher
  body: any editable visit field (address, builder, equipment, items, notes, etc.)
  effect: updates visit, recalculates total_price if items/services changed,
          creates edit_log entry automatically
  note: full editability — no restrictions by data origin

GET /api/dispatch/visits/:id/edit-log
  auth: dispatcher
  returns: [] of edit_log entries for this visit, chronological — what changed
           and when, not who (displayed as expandable mini-log, e.g.
           "06-15 20:15 — edited from Dispatch")
```

```
GET /api/inventory/mine
  auth: technician
  returns: [] of { itemName, quantityAssigned, quantityConsumed, balance }
           for caller, current period

GET /api/dispatch/inventory
  auth: dispatcher
  returns: [] of same shape, all technicians

POST /api/dispatch/inventory/assign
  auth: dispatcher
  body: { technicianId, itemName, quantityAssigned, periodStart }
  effect: creates inventory_assignments row
```

```
GET /api/dispatch/restock-report
  auth: dispatcher
  query: ?dateFrom? ?dateTo?
  returns: { items: [{ itemName, totalConsumed, byTechnician: [...] }] }
  note: pulls from visit_items where tech_supplied = true, grouped by item

POST /api/dispatch/restock-report/mark-restocked
  auth: dispatcher
  body: { periodStart, periodEnd, itemNames: [...] }
  effect: creates or updates restock_records rows for each item — status →
          "restocked", restocked_at set (audit trail only — The Company
          provides material, this does not deduct inventory)

GET /api/addresses/:id/weigh-in
  auth: technician or dispatcher
  returns: [] of weigh_in_data rows for this address, ordered by system_number
  note: collapsed by default in UI — reference data, not active input.
        Technician sees this when viewing an address to avoid re-capturing
        data already collected in a prior visit.

PATCH /api/dispatch/addresses/:id/weigh-in/:systemNumber
  auth: dispatcher
  body: any editable weigh-in field
  effect: updates existing weigh_in_data row for this address+system,
          creates edit_log entry automatically
  note: edge case only — use when equipment was replaced or major repair
        changed the system's charge characteristics
```

---

## 11. Pay Periods

```
GET /api/dispatch/pay-periods
  auth: dispatcher
  returns: [] of pay_periods, most recent first

GET /api/dispatch/pay-periods/:id
  auth: dispatcher
  returns: full period with pay_period_lines per technician

POST /api/dispatch/pay-periods/close
  auth: dispatcher
  body: { periodId }
  requires: period status = "open", week_end has passed
  effect: calculates gross_amount per technician from completed visits in range,
          applies commission split (owner: 0%, technician non-owner: 20%),
          creates pay_period_lines, sets period status → "closed"
  returns: full closed period with all lines

PATCH /api/dispatch/pay-periods/:id/mark-paid
  auth: dispatcher
  effect: status → "paid", paid_at timestamp set

GET /api/pay/mine
  auth: technician
  query: ?periodId?
  returns: own pay_period_lines only — never other technicians' data
```

**Note:** period closing is a manual dispatcher action, not automatic on date rollover — daily audit of technician reports happens before closing, allowing discrepancies to be caught and corrected first.

**Price anomaly detection:** manually reviewing every service report line by line is tedious. The catalog can define an expected min/max range per item, particularly relevant for free-form "Other" entries. Visits with any price outside the expected range for its item are flagged visually during the daily audit — this does not block anything, it only draws the dispatcher's attention before approval.

```
GET /api/dispatch/pay-periods/:id/anomalies
  auth: dispatcher
  returns: [] of { visitId, itemName, price, expectedRange } for any line item
           outside its catalog-defined expected range, within this period
```

---

## 12. Chat

```
GET /api/chat/direct/:technicianId
  auth: technician
  returns: [] of chat_messages between caller and :technicianId, chronological

POST /api/chat/direct/:technicianId
  auth: technician
  body: { body }
  effect: creates chat_messages row, type "direct"
          creates notification for recipient: "message"

GET /api/chat/broadcast
  auth: technician
  returns: [] of chat_messages where type = "broadcast", chronological

POST /api/chat/broadcast
  auth: dispatcher or owner only
  body: { body }
  effect: creates chat_messages row, type "broadcast", recipient_id null
          creates notification for ALL technicians: "broadcast"

POST /api/chat/:messageId/mark-read
  auth: technician
  effect: creates chat_reads row for caller + this message

GET /api/chat/broadcast/:messageId/read-receipts
  auth: dispatcher or owner only
  returns: [] of { technicianId, readAt } — who has confirmed reading
```

---

## 13. Notifications

```
GET /api/notifications/mine
  auth: technician
  query: ?unreadOnly?
  returns: [] of notifications for caller, most recent first

PATCH /api/notifications/:id/mark-read
  auth: technician
  effect: read → true
```

---

## 14. Transfers

Technician-to-technician reassignment, no dispatcher approval required.

```
POST /api/visits/:id/transfer/initiate
  auth: technician (must be current assignee)
  body: { toTechnicianId, reason }
  effect: creates transfers row, status "pending"
          visit stays assigned to caller — no change to visit.technician_id yet
          creates notification for toTechnicianId: "transfer_request"
  returns: { transferId, status: "pending" }

POST /api/transfers/:id/accept
  auth: technician (must be the toTechnicianId on this transfer)
  effect: transfers.status → "accepted", resolved_at set
          visit.technician_id → toTechnicianId
          visit.status is left untouched — it keeps whatever status it already
          had (typically "assigned" or "in_progress"); this endpoint never
          writes to visit.status (see SYSTEM_DESIGN.md §4.2 and DATA_MODEL.md's
          visits status rules)
          creates notification for dispatcher: "transfer_accepted" (informational)
  returns: updated visit now assigned to caller

POST /api/transfers/:id/reject
  auth: technician (must be the toTechnicianId on this transfer)
  effect: transfers.status → "rejected", resolved_at set
          visit remains with original technician, unchanged
          creates notification for fromTechnicianId: "transfer_rejected"

GET /api/transfers/pending/mine
  auth: technician
  returns: [] of pending transfer requests where caller is toTechnicianId
```

**Behavior on no response:** if Tech2 never accepts or rejects, the transfer remains "pending" indefinitely — no expiration logic, no scheduled job. If Tech1 completes the visit through normal workflow before Tech2 responds, the transfer is automatically marked "expired" and Tech2's pending notification is cleared silently — no action required from either technician (see §8 for the completion-triggered effect).

---

## Cross-cutting Rules

- All monetary calculations (pricing, commissions, totals) are performed server-side. Clients never calculate or trust client-side totals as authoritative.
- All catalog lookups (refrigerant, subcooling goal, tech_supplied flag) happen server-side at the moment of data creation, then are stored explicitly for immutable history.
- All derived report artifacts (JSON, CSV, TXT) are generated on demand from current data — never stored as the source of truth, never manually synced.
- All endpoints validate that the caller's role and assignment match the action being requested before applying any effect.

---

*Document generated in planning session — 2026-06-15*
*Version 1.0 — first formal API contract*
*Next step: development plan with phases, dependencies, and acceptance criteria*
