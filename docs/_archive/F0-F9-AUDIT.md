# F0–F9 Frontend Audit

**Audited:** 2026-07-01
**Files examined:** 37 source files (shared, pwa, dispatch) + API_CONTRACT.md + UI_PLAN.md

---

## Summary

- 37 files audited across PWA (vanilla JS) and Dispatch (React/Vite)
- **12 critical issues** (API contract field-name mismatches, broken endpoints, SW install failure)
- **13 warnings** (missing cache entries, dead code, CSS token typos, minor contract deviations)
- **3 items needing human decision** (auth level for technician contact list, catalog load location, invite-code dash format)
- **13+ coverage gaps** — backend endpoints defined in contract but never called in any audited file

---

## Issues by Severity

### Critical (must fix before ship)

**C1 — `pwa/sw.js:28` — Non-existent file in SHELL_ASSETS breaks SW install**
`/src/components/modal.js` is listed in `SHELL_ASSETS`. No such file exists in the audited tree (workspace modals are inline functions). `caches.addAll()` rejects if any URL 404s, causing the install event to fail. The PWA will work but the service worker will never install, killing all offline capability.

**C2 — `pwa/src/screens/workspace.js:~591` — Sends `customPrice` instead of `price`**
In `addItem()`, the custom-price field is appended as `body.customPrice = customPrice`. Contract (`POST /api/visits/:id/items`) says the field must be named `price`. Custom-price items ("Other") will never have their price recorded by the server.

**C3 — `pwa/src/screens/workspace.js:~681` — Wrong weigh-in field name; missing required fields**
`buildWeighInPanel` sends `subcooling` but the contract (`PUT /api/visits/:id/weigh-in/:systemNumber`) expects `subcoolingValue`. Additionally, `factoryLineConfig` and `factoryChargeUsed` are absent from the payload entirely; the contract notes `factoryChargeUsed` is required for Trane/Lennox models. Weigh-in data will be silently incomplete or rejected.

**C4 — `pwa/src/screens/workspace.js:~413` — `twoSystems` sent in `/services` PATCH**
`syncService()` sends `{ serviceName, isFinish, isTemporarily, twoSystems }`. The contract for `PATCH /api/visits/:id/services` explicitly says: "`hasMultipleSystems` is NOT part of this payload — it lives on visits, not visit_services." The extra field may be ignored or cause a validation error.

**C5 — `pwa/src/screens/reports.js:~252` — Sends `fields` instead of `correctedFields`**
`openCorrectionModal` calls `api.post('/visits/${visitId}/request-correction', { fields, reason })`. Contract body is `{ correctedFields, reason }`. The correction request will reach the server with no `correctedFields` key; the correction record will have no fields stored.

**C6 — `pwa/src/screens/transfers.js:~191` — Sends `recipientId` instead of `toTechnicianId`**
The transfer submit sends `{ recipientId: selectedTech.id, reason }`. Contract (`POST /api/visits/:id/transfer/initiate`) expects `{ toTechnicianId, reason }`. The server will not find the recipient; all transfers will fail silently or with an error.

**C7 — `dispatch/src/screens/Inventory.jsx:~41` — Wrong field name and missing `periodStart`**
`handleAssign()` posts `{ technicianId, itemName, quantity: Number(quantity) }`. Contract (`POST /api/dispatch/inventory/assign`) expects `{ technicianId, itemName, quantityAssigned, periodStart }`. Field name mismatch (`quantity` vs `quantityAssigned`) and `periodStart` is missing entirely. Stock assignment is broken.

**C8 — `dispatch/src/screens/Restock.jsx:~34` — Wrong request shape for mark-restocked**
`handleRestock(itemName)` posts `{ itemName, dateFrom, dateTo }`. Contract (`POST /api/dispatch/restock-report/mark-restocked`) expects `{ periodStart, periodEnd, itemNames: [...] }` — an array, not a single string, and different field names. Mark-restocked is completely non-functional as written.

**C9 — `dispatch/src/screens/Corrections.jsx:~145` — Sends `note` instead of `dispatcherNote`**
`handleReject()` sends `{ note: rejectNote.trim() || null }`. Contract (`PATCH /api/dispatch/corrections/:id/reject`) expects `{ dispatcherNote? }`. Rejection notes will never reach the server.

**C10 — `pwa/src/screens/reports.js:~172,274` — Wrong CSS variable name**
`statusLabel.style.color = 'var(--static)'` (line ~172) and `wrap.style.color = 'var(--static)'` (line ~274). The design token is `--color-static` (defined in `shared/tokens.css:19`). `var(--static)` resolves to nothing; the "Downloaded, not sent" status icon and label will show with no color applied.

**C11 — `pwa/src/screens/reports.js:~286` — `.rp-overlay` CSS class is undefined**
`openReportPreview()` creates `overlay.className = 'rp-overlay'` and appends it to `document.body`. The `screenStyles` string in this file defines `.rp-modal`, `.rp-modal-header`, etc., but never defines `.rp-overlay`. Without position/background styling, the preview modal is not an overlay — it renders as an in-flow block at the bottom of the body. The report preview modal is effectively broken.

**C12 — `pwa/src/screens/chat.js:57` and `pwa/src/screens/transfers.js:67` — PWA calls a dispatcher-only endpoint**
Both screens call `api.get('/dispatch/technicians?activeOnly=true')`. The contract specifies `GET /api/dispatch/technicians — auth: dispatcher/owner only`. Technicians will receive a 403 on this call. The chat contact list and transfer technician picker will never populate in the PWA.

---

### Warning (fix soon)

**W1 — `pwa/sw.js:~18–33` — Several used files missing from SHELL_ASSETS**
The following files are imported and used at runtime but not pre-cached, so they won't be available offline:
- `/src/screens/pay.js` (routed via `app.js`)
- `/src/screens/transfers.js` (routed via `app.js`)
- `/src/components/correction-modal.js` (imported by `reports.js`)
- `/src/components/notifications.js` (imported by `my-calls.js`)

**W2 — `pwa/src/screens/workspace.js:~279` — Client-side price calculation in section summary**
`getSectionSummary('accessories')` computes `total = items.reduce((s, i) => s + Number(i.price ?? 0), 0)` to display a sub-total in the collapsed accordion header. UI_PLAN.md rule 1: "Never calculate price client-side." The authoritative total at the bottom of the screen is correct (server-sourced), but this summary displays a locally-derived dollar value.

**W3 — `pwa/src/screens/workspace.js:~565,623` — Hardcoded item names violate catalog rule**
`buildItemsSection` checks `item.name === 'Fixed Leaks' || item.name === 'Extended Wire'` (line ~565) to trigger sub-option flow. The `SUB_OPTIONS` map (line ~623) hardcodes `{ 'Fixed Leaks': ['cunit','ecoil','wall'], 'Extended Wire': ['cunit','furnace'] }`. UI_PLAN.md rule 2: "Never hardcode a service name, item name." These should come from catalog_item_relations.

**W4 — `pwa/src/screens/settings.js:~38` — Broken HTML attribute quoting in innerHTML**
```js
body.innerHTML = `<p class=\ph-title\>...</p><p class=\ph-sub\>...</p>`
```
Backslash-escaping is used instead of real quotes. The rendered HTML will have literal backslashes in the attribute value; the CSS classes `ph-title` and `ph-sub` (defined in the same file's inline styles) will not be applied.

**W5 — `pwa/src/screens/my-calls.js:~168–177` — Dead `bell` element created but never appended**
`buildHeader()` creates a `button` element, assigns `className = 'header-bell'`, sets `aria-label` and innerHTML, but then calls `header.appendChild(NotificationBell(navigateTo))` instead of `header.appendChild(bell)`. The `bell` variable goes out of scope unused. The `NotificationBell` component provides the actual bell with full functionality.

**W6 — `pwa/src/lib/sync.js:78` — `stopSync` exported but never imported**
`stopSync` is exported from `sync.js` but no screen in the audited set imports it. Sync cannot be stopped once started; screens accumulate `sync:update` handlers on each re-mount (see W7).

**W7 — Multiple screens — `sync:update` listeners on `window` never removed**
`lobby.js`, `my-calls.js`, `chat.js`, `reports.js`, and `notifications.js` all call `window.addEventListener('sync:update', onSyncUpdate)` in their mount functions without removing the listener when the screen is torn down. The app's routing pattern clears `appEl.innerHTML` and re-mounts, so returning to My Calls after visiting another screen results in two `onSyncUpdate` handlers running concurrently. After N visits to a screen, N handlers fire per event. The `sync:update` on `reports.js` also has this problem with `queue:sent`.

**W8 — `dispatch/src/screens/History.jsx:~39` — `GET /dispatch/visits/:id` not in contract**
`openVisit()` calls `api.get('/dispatch/visits/${visit.id}')`. The contract defines `GET /api/visits/:id` (auth: technician or dispatcher) but no `GET /api/dispatch/visits/:id`. The edit-log endpoint (`GET /api/dispatch/visits/:id/edit-log`) does exist. The GET detail call may 404.

**W9 — `dispatch/src/screens/PayPeriods.jsx:~152` — Wrong field names for anomaly display**
The anomaly list renders `a.actual_price` and `a.catalog_price`. The contract (`GET /api/dispatch/pay-periods/:id/anomalies`) returns `{ visitId, itemName, price, expectedRange }`. Both values will display as `undefined`.

**W10 — `dispatch/src/screens/Corrections.jsx:~46` — `GET /dispatch/corrections/:id` not in contract**
`openCorrection()` calls `api.get('/dispatch/corrections/${c.id}')`. The contract defines no single-correction GET endpoint (only the list and the approve/reject PATCHes). The code falls back to the list-row object `c` if the fetch fails, which is a reasonable fallback, but the endpoint may 404.

**W11 — `pwa/src/screens/workspace.js:~424` — `updatePrice(0)` hardcoded in `clearAllItems`**
After confirming Cancel with active items, `clearAllItems()` calls `updatePrice(0)` directly rather than reading `result.total_price` from the server response. This is a minor UI_PLAN rule 1 violation. The server does return the new price, but the code ignores it.

**W12 — `pwa/src/lib/sync.js:11` — Typo in JSDoc comment**
Comment reads `forcSync` (missing 'e'). The exported name is correctly spelled `forceSync`.

**W13 — `pwa/src/screens/workspace.js` and `pwa/src/screens/workspace.js:~424` — Double PATCH on Cancel-with-items confirmation**
When the user confirms Cancel over existing items, the click handler calls `clearAllItems()` (sends `PATCH /services { serviceName:'Cancel', confirmed:true }`) and then immediately calls `syncService()` (sends a second `PATCH /services { serviceName:'Cancel', ... }`). The second call is redundant. The server will likely handle it idempotently, but it's wasteful and sends the extra `twoSystems` field (C4).

---

### Needs Decision (requires human input before fixing)

**D1 — PWA needs a technician-accessible endpoint to list active technicians**
`chat.js` and `transfers.js` in the PWA need to display other active technicians. They currently call `GET /api/dispatch/technicians` which is dispatcher-only per contract. Options:
- Add a new endpoint `GET /api/technicians/active` accessible to technicians.
- Relax the auth on the existing endpoint for read-only access.
- Return active technician list as part of `GET /api/sync/changes`.
**Recommendation:** add a separate read-only endpoint at `/api/technicians` (no `/dispatch/` prefix) returning id, name, role only. Keeps the dispatcher-management endpoint locked.

**D2 — Catalog fetch initiation is not in any audited file**
`workspace.js` calls `getCatalog('items')` from IndexedDB, and `sw.js` caches `/api/catalog/items` on navigation. But no audited file calls `setCatalog()` (exported from `db.js`) or fetches the catalog endpoints (`/api/catalog/items`, `/api/catalog/equipment`, `/api/catalog/lineset-configs`). If this code lives in the unaudited `pwa/src/screens/auth.js`, no action needed. If it doesn't exist anywhere, the workspace will always have an empty item list on a fresh install.
**Recommendation:** Confirm that auth.js (or another initialization file) fetches and stores all three catalog endpoints into IndexedDB on first login.

**D3 — Dispatch Auth.jsx sends invite code with dash to server**
`handleSubmit` strips the dash for length validation (`code.replace('-', '').trim()`) but then posts `{ inviteCode: code.trim() }` with the dash still present (format: `XXXX-XXXX`). The contract doesn't specify whether the server expects the dash or not.
**Recommendation:** Confirm server behavior and either strip before sending or document that the server accepts both formats.

---

## Coverage Gaps

API endpoints in the contract that are never called in any audited frontend file:

| Endpoint | Notes |
|---|---|
| `GET /api/catalog/item-relations` | Not called or cached; companion/exclusion rules unenforceable without it |
| `GET /api/catalog/services` | Not called or cached |
| `GET /api/catalog/equipment` | In SW cache paths but no JS initiates the fetch (see D2) |
| `GET /api/catalog/lineset-configs` | In SW cache paths but no JS initiates the fetch |
| `PATCH /api/dispatch/catalog/:table/:id` | Catalog editor not implemented |
| `GET /api/dispatch/history/address/:addressId` | Address-level history not in `History.jsx` |
| `POST /api/dispatch/visits/create-manual` | Manual visit creation not implemented |
| `PATCH /api/dispatch/visits/:id/reassign` | Dispatch Lobby is a placeholder (`LobbyPlaceholder`) |
| `PATCH /api/visits/:id/systems/:systemNumber` | Equipment picker not implemented in Workspace |
| `PATCH /api/dispatch/addresses/:id/weigh-in/:systemNumber` | Not implemented |
| `GET /api/transfers/pending/mine` | Incoming transfer requests cannot be viewed or acted upon |
| `POST /api/transfers/:id/accept` | Accept flow not implemented |
| `POST /api/transfers/:id/reject` | Reject flow not implemented |
| `POST /api/auth/generate-invite` | Technician management screens not implemented |
| `POST /api/auth/revoke` | Not implemented |
| `PATCH /api/dispatch/technicians/:id/deactivate` | Not implemented |
| `PATCH /api/dispatch/technicians/:id/reactivate` | Not implemented |
| `GET /api/dispatch/technicians` (full list) | Not implemented (chat/transfers use active-only) |
| `GET /api/technicians/me/settings` | Settings screen is a placeholder |
| `PATCH /api/technicians/me/settings` | Not implemented |
| `GET /api/technicians/me/price-overrides` | Not implemented |
| `POST /api/technicians/me/price-overrides` | Not implemented |
| `DELETE /api/technicians/me/price-overrides/:itemName` | Not implemented |
| `GET /api/inventory/mine` | PWA technician inventory view not implemented |

Most of these are F10 scope (Settings, technician management). The transfer accept/reject endpoints (F9 scope) are a gap — transfers can be initiated but the receiving technician has no UI to respond.

Also noted: `GET /api/visits/mine?status=completed&today=true` in `reports.js` uses query params not defined in the contract for this endpoint. The contract's `GET /api/visits/mine` only lists statuses `assigned, in_progress, temporarily`. If the server doesn't handle these params, the Reports screen will show all visits rather than today's completed ones.

---

## File-by-File Notes

**shared/api.js** — Clean. Correct 401 handling, 204 short-circuit, error parsing, upload path.

**shared/tokens.css** — Clean. All tokens use `--color-*` prefix consistently.

**pwa/index.html** — Clean.

**pwa/app.js** — Clean. Imports `AuthScreen` from unaudited `auth.js`. Route table is complete. `startQueueRetry()` correctly called async after auth.

**pwa/sw.js** — Critical (C1): `modal.js` in SHELL_ASSETS. Warning (W1): `pay.js`, `transfers.js`, `correction-modal.js`, `notifications.js` not cached. `CATALOG_PATHS` do not include `/api/catalog/item-relations` or `/api/catalog/services`.

**pwa/manifest.json** — Clean.

**pwa/src/lib/db.js** — Clean. `deletePhotosForVisit` exported but not called in any audited file (may be called by unaudited auth or workspace completion code).

**pwa/src/lib/queue.js** — Clean. Correct path to `shared/api.js`. Queue retry logic correct. The `processQueue` body sends the visit completion correctly.

**pwa/src/lib/sync.js** — `stopSync` exported but never imported (W6). Typo in JSDoc (W12). Logic is correct.

**pwa/src/components/badge.js** — Clean. `Tag` export is used in `lobby.js` and `job-card.js`.

**pwa/src/components/correction-modal.js** — Clean. The modal collects `{ fields, reason }` and passes to caller's `onSubmit`. The field-name bug (C5) is in the caller (`reports.js`), not here.

**pwa/src/components/job-card.js** — Clean API usage. `console.error` on two error paths (acceptable). `jc-context-item--destructive` CSS class defined but never applied (dead CSS, not a bug).

**pwa/src/components/nav-bar.js** — Clean. `updateChatBadge` exported but not imported in any audited file.

**pwa/src/components/notifications.js** — Module-level `bellEl`/`badgeEl` singletons are fragile on re-mount but functional for the single-screen-at-a-time pattern used here. Event listener on `window` never removed (W7).

**pwa/src/screens/lobby.js** — Clean. Endpoints correct. Event listener accumulates on re-visits (W7).

**pwa/src/screens/my-calls.js** — Dead `bell` element (W5, lines ~168–177). Event listener accumulates (W7). Otherwise clean.

**pwa/src/screens/workspace.js** — Multiple critical issues: C2, C3, C4 (API field mismatches). W2 (client-side price sum), W3 (hardcoded item names), W11 (hardcoded price 0), W13 (double PATCH). `console.error` calls throughout error handlers. Logic otherwise well-structured.

**pwa/src/screens/chat.js** — Critical auth violation C12. Event listener accumulates (W7). `console.error` on error paths.

**pwa/src/screens/pay.js** — Clean. Endpoint correct. `NavBar` correctly shows `active: 'settings'` since this is a sub-screen of Settings.

**pwa/src/screens/reports.js** — C5 (wrong field name), C10 (wrong CSS variable ×2), C11 (missing `.rp-overlay` CSS). Event listener accumulates (W7). `GET /api/visits/mine?status=completed&today=true` uses undefined query params (coverage gap note above).

**pwa/src/screens/settings.js** — W4 (broken innerHTML quoting). Placeholder body only.

**pwa/src/screens/transfers.js** — C6 (wrong field name `recipientId`), C12 (dispatcher-only endpoint). `console.error` on error paths.

**dispatch/src/App.jsx** — Side effect at module level: `document.head.appendChild(spinStyle)` runs outside any component or effect. Works in practice (module loads once) but is architecturally wrong. `LobbyPlaceholder` properly marked as placeholder.

**dispatch/src/main.jsx** — Clean.

**dispatch/src/lib/auth.jsx** — Clean. Session keys match PWA convention. `logout` and `login` correctly symmetric. Auth expiry listener added/removed in `useEffect`.

**dispatch/src/components/AddressModal.jsx** — Clean. Resolution option strings (`merge_keep_existing`, `create_new`, `merge_keep_new`) match contract exactly.

**dispatch/src/components/NavBar.jsx** — Clean.

**dispatch/src/screens/Auth.jsx** — Minor: posts `code.trim()` with dash (D3). Invite code format handling otherwise correct.

**dispatch/src/screens/Chat.jsx** — Clean for dispatcher use. `?activeOnly=true` is an undocumented param but harmless (server returns active-only by default). Read receipts correctly behind dispatcher-only endpoint. `console.error` on error paths.

**dispatch/src/screens/Corrections.jsx** — C9 (wrong reject field name). W10 (`GET /corrections/:id` not in contract). List and approve flows otherwise correct.

**dispatch/src/screens/History.jsx** — W8 (`GET /dispatch/visits/:id` not in contract). W9 is in PayPeriods (not here). Edit and edit-log endpoints correct. Anomaly icon uses `v.has_price_anomaly` from the list response which seems server-provided.

**dispatch/src/screens/Inventory.jsx** — C7 (wrong field names on assign). Inventory read display is clean. `balance = item.assigned - item.consumed` is a local display calculation from server values, not a price calculation — acceptable.

**dispatch/src/screens/PayPeriods.jsx** — W9 (wrong anomaly field names). Commission display `(line.commission_rate * 100).toFixed(0)%` is a display format applied to a server value, not a calculation — acceptable. Close and mark-paid flows correct.

**dispatch/src/screens/PdfIntake.jsx** — Clean. All five endpoints (parse-pdf, get-call, confirm, skip, release, resolve-comparison) match contract exactly including response shape handling. `finally { setConfirming(false) }` correctly fires even on early `return`.

**dispatch/src/screens/Restock.jsx** — C8 (completely wrong request body shape for mark-restocked). Read/display of the report is clean.

**dispatch/vite.config.js** — Clean. `@shared` alias correctly points to `../shared`.

**dispatch/package.json** — Clean.
