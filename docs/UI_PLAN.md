# UI Plan
## Field Ops + Dispatch — Frontend Interfaces

**Version:** 1.2
**Date:** 2026-06-28
**Authors:** Christian Huerta + Claude (planning session)
**Status:** Active — ready to begin Phase F0
**Based on:** SYSTEM_DESIGN.md, DATA_MODEL.md, API_CONTRACT.md, DEVELOPMENT_PLAN.md
**Backend status:** Phases 0–10 complete, 285 tests passing — `Huma0no/fieldops-platform`

---

## 1. Purpose

This document sequences frontend development into buildable phases, ordered by actual functional dependency. For each phase: what views and components get built, which backend endpoints they consume, and what "done" means in testable terms.

This is a frontend-only document. It does not re-define business logic, data models, or API behavior — those are locked in the source documents above. The frontend's responsibility is to present and interact with data the backend already manages correctly.

---

## 2. Surfaces

### 2.1 Field Ops PWA

Mobile-first, offline-capable Progressive Web App. Each technician installs it once and uses it daily in the field.

**Stack:** Vanilla JS modules + Service Worker + IndexedDB. No framework — the app must be lean, fast to load, and fully functional without a network connection.

**Key behaviors:**
- Auth via device token stored in `localStorage` after one-time invite redemption. No login screen after first use.
- Catalog data (`/api/catalog/*`) fetched once, stored in IndexedDB. Refreshed on next sync event when the dispatcher makes a catalog change — no manual refresh required.
- Sync via `GET /api/sync/changes?since=` polling every 15–30 seconds while foregrounded. Paused when backgrounded.
- Completion queue in IndexedDB — completions generated locally, sent when online, retried automatically on reconnect.
- All modals close on click outside the modal.

### 2.2 Dispatch Panel

Desktop-first administrative interface. The dispatcher uses it on a computer to manage the day's operations.

**Stack:** React + Vite + Tailwind CSS. State management with React Context — no external state library needed at current scale.

**Key behaviors:**
- Auth via the same bearer token system. Dispatcher authenticates once via invite code; token persists in `localStorage`.
- No offline requirement — Dispatch is used at a desk with reliable internet.
- Polling sync same as PWA: `GET /api/sync/changes?since=` every 15–30 seconds.
- All modals close on click outside the modal.

### 2.3 Design System

Both surfaces share a single set of design tokens defined in `frontend/shared/tokens.css`. A design token is a named variable that holds a visual value — color, spacing, typography scale. Rather than writing a hex value directly in a stylesheet, every file references the token name. If a value changes, it changes in one place and both surfaces reflect it automatically.

The five semantic color tokens:
- `--color-void` — deep background, the base dark surface
- `--color-signal` — electric blue, primary action and interactive elements
- `--color-plasma` — amber/orange, emphasis and alert states
- `--color-heat` — red, errors and critical states
- `--color-static` — neutral gray, secondary text and disabled elements

Extended with Dispatch-specific administrative tones where needed, defined in the same file. Neither surface defines its own color values outside of `tokens.css`.

---

## 3. Repository Structure

```
fieldops-platform/
  backend/              ← existing — Node/Express/PostgreSQL
  frontend/
    pwa/                ← Vanilla JS PWA (Field Ops)
    dispatch/           ← React + Vite (Dispatch Panel)
    shared/
      tokens.css        ← design tokens (single source)
      api.js            ← fetch wrapper with auth header injection
```

`shared/api.js` is the single authenticated fetch helper. Both surfaces import it. It reads the device token from `localStorage` and injects `Authorization: Bearer {token}` on every request. Neither surface writes its own fetch wrapper.

---

## 4. Phase Overview

| Phase | Scope | Surface | Depends on |
|---|---|---|---|
| F0 | Auth shell — invite redemption (PWA) + dispatcher auth (Dispatch) | Both | — |
| F1 | My Calls list + Job Card (expandable, read-only) | PWA | F0 |
| F2 | Lobby — claim visits (PWA) + Lobby module (Dispatch) | Both | F0, F1 |
| F3 | Workspace — services, tstat, items, weigh-in, notes, photos | PWA | F1 |
| F4 | Generate Report flow + offline queue + report download | PWA | F3 |
| F5 | PDF Intake — upload, AI extraction, review, release | Dispatch | F0 |
| F6 | History + full edit + Inventory + Restock | Dispatch | F5 |
| F7 | Pay Periods | Dispatch | F5 (parallel to F6) |
| F8 | Corrections — submit (PWA) + approve/reject (Dispatch) | Both | F4, F7 |
| F9 | Chat + Notifications + Transfers | Both | F0, F1 |
| F10 | Technician Settings + Price Overrides | Both | F6 |

```
F0
 ├── F1
 │    ├── F2
 │    ├── F3
 │    │    └── F4
 │    │         └── F8 ←──────────────────────┐
 │    └── F9 (partial — Transfer UI needs F1)  │
 └── F5                                        │
      ├── F6                                   │
      └── F7 ─────────────────────────────────┘

F9 Chat + Notifications ── parallel from F0
F9 Transfer UI          ── requires F1 (Job Card exists)
F10 ── depends on F0 + F6
```

---

## 5. Phases

---

### Phase F0 — Auth Shell

**Builds:**

**PWA:**
- First-launch screen: invite code input + submit.
- Calls `POST /api/auth/redeem-invite` → stores `deviceToken` and `technician` (id, name, role) in `localStorage`.
- On subsequent launches: reads token from `localStorage`, skips invite screen, routes to My Calls (F1).
- If no token found: invite screen.
- If token found but first `/api/sync/changes` returns 401: clears storage, returns to invite screen with message: "This device has been disconnected. Contact your dispatcher for a new invite code."

**Dispatch:**
- First-launch screen: invite code input + submit (same flow as PWA — dispatcher is created and invited the same way).
- On subsequent loads: reads token, routes to Lobby (F2) as the default view.

**Shared:**
- `shared/api.js` written and verified. All subsequent fetch calls go through it.
- `shared/tokens.css` baseline — five semantic color tokens defined.

**Done when:** a technician can redeem an invite code on a fresh PWA install, then close and reopen the app and land directly on My Calls without re-entering the code. A revoked token produces the disconnection message rather than a generic error. Dispatcher can authenticate and is routed to the default Dispatch view.

---

### Phase F1 — My Calls List + Job Card

**Builds (PWA only):**

**My Calls screen:**
- Lists all visits from `GET /api/visits/mine` (status: assigned, in_progress, temporarily).
- Each card shows: address, builder, work type, scheduled time, status badge.
- Deferred visits (`is_deferred = true`) appear at the top with a distinct "Deferred" label — carry-over from prior day.
- Tapping a card expands it inline — does not navigate away from the list.
- Pull-to-refresh calls `GET /api/sync/changes?since=` directly — not a page reload.
- Empty state: "No visits assigned today."

**Job Card (expandable, read-only at this phase):**
- Expands inline within the My Calls list on tap.
- Collapsed state shows: address, builder, work type, scheduled time, status badge.
- Expanded state additionally shows: order number, builder contact (name + phone, tappable to dial), company notes, system quick info (indoor model, outdoor model, refrigerant, system count).
- Full visit detail pulled from `GET /api/visits/:id` on first expand.
- Previous weigh-in data from `GET /api/addresses/:id/weigh-in` displayed collapsed within the card — reference only, not editable here.
- "Start" button calls `POST /api/visits/:id/start` → status becomes `in_progress` → button replaced by "Open Workspace" (links to Workspace, active in F3).
- `···` (three-dot) menu in the card header — reserved for low-frequency actions. Empty at this phase; Transfer action added in F9.

**Done when:** a technician with assigned visits sees their list on launch, can expand a card inline to see full job context including system quick info, and can start a visit. A technician with no visits sees the empty state. Deferred visits surface at the top. Collapsing the card returns to the list without navigation.

---

### Phase F2 — Lobby

**Builds:**

**PWA — Lobby screen:**
- Navigation tab alongside My Calls.
- Lists visits from `GET /api/visits/lobby`.
- Each card shows: address, subdivision, builder tag, work type, scheduled time, tags (urgent, A2L, multi-system).
- "Claim" button calls `POST /api/visits/:id/claim`.
- Race condition handled: if claim fails, card updates with "Already claimed" and disappears from list on next poll.

**Dispatch — Lobby module:**
- Lists same unassigned visits with the same tags.
- "Assign" button opens a dropdown of active technicians (`GET /api/dispatch/technicians`).
- Selecting a technician calls `PATCH /api/dispatch/visits/:id/reassign`.
- Visit disappears from Lobby on next poll cycle.

**Done when:** a visit released to the Lobby appears in both the PWA Lobby and the Dispatch Lobby. A technician can claim it; a dispatcher can assign it directly. Race condition on simultaneous claim is handled gracefully.

---

### Phase F3 — Workspace

**Builds (PWA only):**

The Workspace is the core field execution screen, reached from the Job Card after starting a visit. The technician is fully responsible for the accuracy of the report — nothing is submitted automatically. The report reflects exactly what the technician actively selects and confirms.

**Workspace sections (in order):** Service → Thermostat → Accessories → Fixes → Weigh-in → Notes → Checklist

**Navigation pattern:**
- Horizontal progress bar at the top advances as sections are completed.
- Sections render as vertical accordions. The active section is expanded; completed sections collapse showing a brief summary of their value (e.g. "AC · Heat", "Honeywell T6 Pro × 1", "$240 · 3 items").
- Each section has a trigger row: `[icon] Section Name` on the left, `[🎤 Speak]` on the right. The technician taps the trigger to expand or taps Speak to input via voice. Both options are always present — the technician chooses.

**Item button states (applies to all selectable items across all sections):**
Three visual states:
- **Normal** — white background, black text, subtle gray outline.
- **Hover/press** — black background, moving shimmer effect, white text.
- **Active/selected** — black background + shimmer + rotating neon outline (`conic-gradient`: cyan → violet → pink → orange, 3s loop).

Exceptions — items with semantic meaning use solid color instead of the neon outline:
- **AC active** — blue tint background (`#eff6ff`), blue text (`#1d4ed8`), solid blue outline.
- **Heat active** — orange tint background (`#fff7ed`), orange text (`#c2410c`), solid orange outline.

**Item states (Thermostat, Accessories, Fixes):**
Three data states for all selectable items:
- **Inactive** — not selected, not included in the report.
- **Pre** — suggested by the PDF (pre-specified thermostat, pre-identified accessories). Visible but not active. Not sent to the server. Not included in the report. The technician must tap to confirm.
- **Active** — confirmed by the technician. Sent to the server. Included in the report and charged.

Pre-state items are surfaced from the visit's context fields (`pre_specified_thermostat`, `pre_identified_accessories`). They are displayed as suggestions only — a Pre item that the technician never taps is never sent to the server.

**Service section:**
- Individual buttons: AC · Heat · Prestart · Cancel · Drive Run.
- AC and Heat are separate buttons. Pressing both sets `serviceName: "AC & Heat"` in the server payload. Both buttons show as active simultaneously; API contract receives the combined value.
- Conditional modifiers — appear only when AC or Heat is active:
  - `2 Systems` toggle — marks visit as multi-system, adds a second system panel in Weigh-in.
  - `Temporarily` toggle — marks visit status as temporarily.
- `Finish` toggle — always available when any base service is active.
- Selecting Cancel with existing active items shows a confirmation modal listing items to be removed. Confirmed → `PATCH /api/visits/:id/services` with `{ confirmed: true }`. All items cleared, total $0, only Notes section remains editable.
- Calls `PATCH /api/visits/:id/services`.
- Price updates from server response after every change — never calculated client-side.

**Thermostat section:**
- Technician selects thermostat model from catalog.
- Quantity selector appears after model is selected.
- Pre-specified thermostat from PDF shown in Pre state — technician confirms or ignores.
- Confirmed selection calls `POST /api/visits/:id/items` with `category: "thermostat"`.

**Accessories section:**
- Catalog items with `category: "accessory"` from IndexedDB cache.
- Pre-identified accessories from PDF shown in Pre state.
- Items with `custom_price = true` (e.g. "Other") show a price input when activated.
- Adding an item calls `POST /api/visits/:id/items`.
- Companion items auto-added per server response — UI reflects immediately.
- Zone board exclusion: selecting a second zone board removes the first and its companions per server response.
- Delete calls `DELETE /api/visits/:id/items/:itemId`.
- All add controls disabled when service = Cancel.

**Fixes section:**
- Same behavior as Accessories, `category: "fix"`.
- No pre-state for fixes — none are pre-identified in the PDF.
- Two items have sub-options that appear when selected:
  - **Fixed Leaks** — sub-options: `cunit` · `ecoil` · `wall` (multi-select).
  - **Extended Wire** — sub-options: `cunit` · `furnace` (multi-select).
- Sub-option selection sends additional metadata with the item payload.

**Weigh-in section:**
- Always present as a dedicated section — not conditionally shown.
- One panel per system. If `2 Systems` toggle is active in Service, a second panel is shown.
- Fields: lineset length, factory line config (dropdown from `GET /api/catalog/lineset-configs`), factory charge selection (factory vs revised — only shown for models with `revised_charge_oz`, currently Trane and Lennox variants — technician reads the physical nameplate), adjusted oz, fan speed CFM, liquid line temp, suction line temp, condenser sat temp, subcooling.
- Calls `PUT /api/visits/:id/weigh-in/:systemNumber`.
- Calculated fields (approx adjust oz, subcooling deviation) returned by server, displayed read-only.

**Systems panel:**
- Equipment picker per system (indoor + outdoor) from catalog.
- `PATCH /api/visits/:id/systems/:systemNumber`.

**Notes section:**
- Free-text area. Calls `PATCH /api/visits/:id/notes` on blur.

**Checklist section:**
- Last section before report generation — marks the Workspace as ready to complete.
- Required photos are generated dynamically based on what was selected (e.g. if weigh-in was filled, SCALE photo is required; if no gas meter present, NO_GAS_METER is required).
- Fixed photo buttons: SCALE · FAN · NO_GAS_METER · NO_ELECTRIC_METER · NO_PDRAIN · BREAKERS_MISSING · +Other.
- Tapping a button opens device camera. Captured photo compressed client-side.
- Calls `POST /api/visits/:id/photos`. Photos stored locally — no Drive upload until report generation.
- Thumbnail strip shows captured photos with tags.
- Checklist also accessible manually via "Start Completion" before reaching the end of the accordion flow.
- A modal version of the Checklist appears when the technician taps "Generate Report" — final gate before submission.

**Price summary:**
- Always visible at bottom of screen, outside the accordion flow.
- Updates from server response after every service/item change.

**Done when:** a complete workspace can be built end-to-end for the backend Phase 4 representative test set: AC only, AC & Heat bundle (both buttons active), multi-system (2 Systems toggle active), Finish + Weigh-In-Data, Temporarily label, Cancel applied over existing items, Fixed Leaks with sub-options, Extended Wire with sub-options. Progress bar advances correctly per section. Conditional toggles (`2 Systems`, `Temporarily`) only appear when AC or Heat is active. Pre-state items from the PDF are visible but not sent to the server until confirmed. The final price on screen matches `total_price` from the server in all cases.

---

### Phase F4 — Generate Report + Offline Queue

**Builds (PWA only):**

**Generate Report flow:**
- "Generate Report" button in Workspace.
- Pre-send: shows visit summary (service, items, total price, photo count) for final review.
- Technician confirms → calls `POST /api/visits/:id/complete`.
- On success: visit moves to Reports section with a sent-success icon.

**Offline queue:**
- If offline at submit time: modal — "No internet connection. Download report or wait for connection?" [Download] [Wait].
- "Wait": queues completion in IndexedDB. PWA retries automatically when online. Visit card shows "Pending send" icon.
- "Download": all completion artifacts generated locally from IndexedDB without any server call — JSON, CSV, photos, and completion report text. Visit card shows "Downloaded, not sent" icon (distinct from sent-success icon).
- Queued completions never block work on other visits.
- When connection returns: background retry processes queue silently. Icons update to success on send.

**Reports section (PWA):**
- List of today's completions.
- Each card: address, service, total, send status icon (sent / pending / downloaded-not-sent).
- "View Report" shows text report preview (`GET /api/visits/:id/report-preview`).
- "Download" always available as manual fallback — generates all artifacts locally.

**Done when:** a completion sent while online produces a sent-success icon. A completion attempted while offline enters the queue, shows the correct icon, and sends automatically when connectivity returns with the icon updating. Downloaded artifacts (JSON, CSV, report text) are complete and match the server's expected shape, generated entirely from local IndexedDB data.

---

### Phase F5 — PDF Intake

**Builds (Dispatch only):**

The entry point of the daily workflow.

**Upload screen:**
- Drag-and-drop or file picker for PDF upload.
- Calls `POST /api/dispatch/parse-pdf` (multipart).
- Shows progress during AI extraction.
- On response: routes to batch review with `batchId` and `totalCalls`.

**Batch review — call-by-call:**
- Shows "Reviewing call X of N."
- Left panel: original PDF rendered for visual reference.
- Right panel: extracted fields pre-filled and fully editable — address, order number, builder, work type, systems, thermostat, accessories, notes, scheduled time, builder contact.
- [Confirm] → `POST /api/dispatch/batch/:batchId/call/:index/confirm`.
  - If address near-match found: comparison modal with three options — use existing, create new, merge. Resolves via `POST /api/addresses/:id/resolve-comparison`.
- [Skip] → `POST /api/dispatch/batch/:batchId/call/:index/skip`.
- Progress bar advances per call.

**Release:**
- After all calls confirmed or skipped: [Release to Lobby] button.
- Calls `POST /api/dispatch/batch/:batchId/release-to-lobby`.
- On success: shows count released, routes to Lobby.
- On count mismatch: error alert with `expected` vs `actual` — batch stays in review, nothing released.

**Manual visit creation:**
- Entry point: [+ New Visit].
- Same fields as batch review (minus batch context).
- Calls `POST /api/dispatch/visits/create-manual`.
- Same address comparison flow.
- Created visit can be released to Lobby or assigned directly to a technician via `PATCH /api/dispatch/visits/:id/reassign` — both actions available from the visit detail view.

**Done when:** a real PDF can be uploaded, all calls reviewed one-by-one against the original, confirmed, and released to the Lobby. Manual creation path functional with both release and direct-assign options. Address comparison modal handles a near-match correctly per all three resolution options.

---

### Phase F6 — History + Full Edit + Inventory + Restock

**Builds (Dispatch only):**

**History module:**
- List view with filters: date range, technician, builder, subdivision, status.
- Calls `GET /api/dispatch/history`.
- Each row: address, date, technician, service, total, status. Price anomaly icon on rows with out-of-range item prices.
- Clicking a row opens the full completed visit.
- Address-level history: `GET /api/dispatch/history/address/:addressId` — all visits at that address, chronological.

**Price anomaly indicator:**
- Any completed visit where one or more item prices differ from their catalog base price (due to technician price override) is flagged with a warning icon in the History list and in the visit detail view.
- This is an informational signal for the dispatcher — it does not block any action.
- Applies to items with catalog base prices only. "Other" items have no base price and are never flagged.

**Full edit (dispatcher):**
- Any field of a completed visit is editable from History.
- Same section layout as Workspace (F3).
- Save calls `PATCH /api/dispatch/visits/:id`. Price recalculates server-side.
- Edit log below the form: `GET /api/dispatch/visits/:id/edit-log` — chronological, with source and summary per entry.

**Inventory module:**
- Per-technician inventory: `GET /api/dispatch/inventory`.
- Current computed balance per item per technician (assigned − consumed). Low-level threshold highlighted.
- Assign stock: `POST /api/dispatch/inventory/assign`.
- Technician's own inventory view in PWA (`GET /api/inventory/mine`) surfaced under Settings or a dedicated tab.

**Restock module:**
- Consumption report: `GET /api/dispatch/restock-report` (date range filter).
- Table: item → total consumed → by-technician breakdown.
- [Mark as Restocked] → `POST /api/dispatch/restock-report/mark-restocked`.

**Done when:** editing a completed visit recalculates price correctly (same test set as F3). Edit log shows change with correct source. Price anomaly icon appears on a visit with a known override price. Inventory balance matches manual calculation. Restock total matches the sum of that item across visits in the range.

---

### Phase F7 — Pay Periods

**Builds (Dispatch only):**

**Pay Periods module:**
- List of pay periods: `GET /api/dispatch/pay-periods` — most recent first.
- Each row: week range, status (open/closed/paid), total gross.
- Clicking a period: full detail with lines per technician.
  - `GET /api/dispatch/pay-periods/:id`.
  - Table: technician → gross → commission (20%, or 0% for owner) → net.
  - Price anomaly section: `GET /api/dispatch/pay-periods/:id/anomalies` — collapsible warning listing out-of-range items. Dispatcher acknowledges before closing — does not block close, draws attention only.
- [Close Period] → `POST /api/dispatch/pay-periods/close`. Requires week_end passed and status = open.
- [Mark as Paid] → `PATCH /api/dispatch/pay-periods/:id/mark-paid`.

**PWA — technician pay view:**
- Own pay lines only: `GET /api/pay/mine`.
- Shows: period range, gross, net. Commission rate and other technicians' data never visible.

**Done when:** closing a period for a known test set produces correct gross, 20% commission, and net for a non-owner technician, and gross = net with zero commission for the owner. Anomaly section surfaces a known out-of-range item. Technician's pay view shows only their own lines.

---

### Phase F8 — Corrections

**Builds (both surfaces):**

**PWA — correction request:**
- In the Reports section, each completed visit card has a [Request Correction] option (accessible via the `···` menu consistent with the low-frequency action pattern).
- Tapping opens a form: fields to correct (checkboxes per editable field) + reason text.
- Submit calls `POST /api/visits/:id/request-correction`.
- Card shows "Correction Pending" badge while status = pending.
- On resolution: badge updates to "Approved" or "Rejected." If rejected with a dispatcher note, a tappable "View Note" link surfaces it.

**Dispatch — corrections queue:**
- Corrections inbox: `GET /api/dispatch/corrections`.
- Each row: technician name, address, date, reason, status.
- Clicking opens detail: original visit data alongside requested changes, highlighted diff.
- [Approve] → `PATCH /api/dispatch/corrections/:id/approve`. Shows which pay period the correction will affect.
- [Reject] → `PATCH /api/dispatch/corrections/:id/reject` — optional note field before confirming.

**Done when:** a technician submits a correction request that appears in Dispatch. Approving it updates the visit and lands in the correct pay period (before-cutoff and after-cutoff cases both tested). Rejecting it stores the note and notifies the technician. The technician's Reports card reflects the resolution.

---

### Phase F9 — Chat + Notifications + Transfers

**Builds (both surfaces):**

Chat and Notifications can begin after F0 with no dependency on visits or workspace. Transfer UI requires F1 (Job Card must exist before the `···` menu can be extended).

**PWA — Chat tab:**
- Contact list: dispatcher + other active technicians (`GET /api/dispatch/technicians`).
- Direct message thread: `GET /api/chat/direct/:technicianId` / `POST /api/chat/direct/:technicianId`.
- Broadcast channel (read-only for technician): `GET /api/chat/broadcast`.
- Unread count badge on Chat tab icon.
- Messages marked read on thread open: `POST /api/chat/:messageId/mark-read`.

**Dispatch — Chat panel:**
- Direct message threads per technician.
- Broadcast compose: `POST /api/chat/broadcast`.
- Read receipts per broadcast: `GET /api/chat/broadcast/:messageId/read-receipts` — "Read by N/M technicians."

**Notifications (both surfaces):**
- Bell icon with unread count — `GET /api/notifications/mine?unreadOnly=true`.
- Notification center: all notifications, most recent first, with deep links to the relevant area.
- Mark read on open: `PATCH /api/notifications/:id/mark-read`.
- PWA notification types: `assignment`, `transfer_request`, `transfer_accepted`, `transfer_rejected`, `message`, `broadcast`, `correction_approved`, `correction_rejected`.
- Dispatch notification types: `completion_received`, `transfer_accepted` (informational), `technician_deactivated` (orphaned visits).

**Transfer UI (PWA — extends F1 Job Card):**
- Transfer action added to the `···` menu in the expanded Job Card.
- Tapping "Transfer Visit" opens a dedicated screen: list of the technician's assigned visits → select visit → technician picker → reason field.
- Calls `POST /api/visits/:id/transfer/initiate`.
- Incoming transfer requests surface via notification. Tapping opens an accept/reject modal.
  - Accept: `POST /api/transfers/:id/accept`.
  - Reject: `POST /api/transfers/:id/reject`.
- Pending transfers polled via `GET /api/transfers/pending/mine` through the sync endpoint.

**Done when:** a direct message creates a notification for the recipient within one poll cycle. A broadcast from Dispatch appears in all technicians' broadcast channels. A transfer request surfaces as a notification on the receiving technician's device, can be accepted or rejected, and Dispatch receives an informational notification on acceptance.

---

### Phase F10 — Technician Settings + Price Overrides

**Builds (both surfaces):**

**PWA — Settings screen:**
- Theme toggle (light/dark) → `PATCH /api/technicians/me/settings` with `{ theme }`. Applied immediately.
- AI provider selector + API key fields (Anthropic / OpenAI / Google) — keys stored server-side, never in localStorage.
- Inventory view: own stock balance (`GET /api/inventory/mine`).
- Price overrides section:
  - Active overrides list: `GET /api/technicians/me/price-overrides`.
  - Add override: item picker (from catalog) + price field → `POST /api/technicians/me/price-overrides`.
  - Delete override: [×] per row → `DELETE /api/technicians/me/price-overrides/:itemName`.

**Dispatch — Catalog editor:**
- Editable catalog tables: equipment, items, lineset configs.
- Primary use: dispatcher updates `pesp` from a technician's field note.
- `PATCH /api/dispatch/catalog/:table/:id`. Inline edit — row enters edit mode, save/cancel. Note displayed: "Changes to the catalog do not affect historical visits."

**Dispatch — Technician management:**
- Team list: `GET /api/dispatch/technicians?includeInactive`.
- Per technician: name, role, status, last activity.
- [Deactivate] → `PATCH /api/dispatch/technicians/:id/deactivate`. If orphaned visits: modal lists them for dispatcher to resolve via reassign or release to Lobby.
- [Reactivate] → `PATCH /api/dispatch/technicians/:id/reactivate`.
- [Generate Invite Code] → `POST /api/auth/generate-invite`. Code displayed for 60 seconds, then hidden.
- [Revoke Access] → `POST /api/auth/revoke`.

**Done when:** theme preference persists across app restarts. A price override for a known item is reflected in the Workspace (F3) price without client-side calculation. Removing the override reverts to the catalog default. Dispatcher can update a `pesp` value and the change appears in the equipment picker on the technician's next catalog sync.

---

## 6. Cross-Cutting Rules for CC

These apply to every phase and every file. They are not negotiable per-phase:

1. **Never calculate price client-side.** All monetary totals come from server responses. Display `total_price` from the API. If the network is unavailable, show the last known value with a stale indicator — never derive a price from the catalog locally.

2. **Never duplicate the catalog.** Catalog data lives in IndexedDB (PWA) or React state (Dispatch) after a single fetch. Never hardcode a service name, item name, or price value in component code. Always read from the cached catalog.

3. **Visit status is server-assigned.** The frontend sends intent ("complete this visit"), not a status value. Never construct a `status` field in a request body — the server decides.

4. **Cancel disables the item UI immediately.** When the technician confirms Cancel, all item add/delete controls must be visually disabled in the same render cycle the confirmation returns. Do not wait for a subsequent fetch.

5. **The offline queue never blocks.** A visit queued for completion must not prevent the technician from opening, starting, or completing other visits. The queue operates entirely in the background.

6. **`shared/api.js` is the only fetch path.** No surface writes its own authenticated fetch. If a new endpoint is needed, add it through the shared wrapper.

7. **Photos accumulate locally until report generation.** Do not attempt Drive uploads during the workspace session. The Drive upload is triggered by `POST /api/visits/:id/complete` on the backend. The frontend tracks which photos have been captured locally — nothing more.

8. **Sync polling is the truth signal for lists.** Do not optimistically update global lists (My Calls, Lobby, Dispatch Lobby) from local state after a mutation. Wait for the next sync poll to confirm. The active workspace (current visit being edited) is the exception — update it immediately from the mutation response.

9. **Pre-state items are never sent to the server.** A Pre-state item exists only in the UI as a suggestion from the PDF context. It becomes an API call only when the technician taps to confirm it (transitions to Active). If the technician never taps it, it is invisible to the backend and does not appear in the report.

10. **All completion artifacts are generatable offline.** JSON, CSV, photos, and report text must be constructible entirely from IndexedDB data — no server call required when offline. Never make a network request as part of local artifact generation.

---

## 7. Parallelization Notes

**F9 Chat + Notifications** can start after F0 with no dependency on any other phase.
**F9 Transfer UI** requires F1 (the `···` menu in the Job Card must exist first).

**F6 and F7** can run in parallel — both depend only on F5, not on each other.

**F5** can begin in parallel with F1–F4 on the PWA side — they share no dependencies beyond F0.

Natural two-track split if two workstreams are running:
- Track A: F0 → F1 → F2 → F3 → F4 → F8 (PWA core) + F9 Chat after F0
- Track B: F0 → F5 → F6 + F7 → F8 (Dispatch core) + F9 Transfer after F1

---

*Document version 1.1*
*Frontend development plan — 11 phases covering Field Ops PWA and Dispatch Panel*
*Next step: Phase F0 — auth shell, shared/api.js, shared/tokens.css, monorepo structure*
