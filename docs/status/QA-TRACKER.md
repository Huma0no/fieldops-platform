# FieldOps — QA Tracker de Control

**Propósito:** única fuente de verdad del estado del QA walkthrough. Todo hallazgo se registra acá, venga del chat que venga — incluyendo los que no corresponden a ninguna sección específica (categoría Cross-cutting).

**Regla:** este documento no se toca en chats de implementación. Solo el Chat de Dirección lo actualiza.

**Nota de reconciliación (2026-07-08):** esta versión corrige un desfase — la primera versión del tracker se armó como plantilla y no importó todos los hallazgos reales de la sesión "QA walkthrough fieldops-platform HVAC". Se reconcilió comparando contra las notas originales de esa sesión. D-01 subió de Media a Alta por decisión explícita (History es inútil si no se puede abrir el detalle).

**Nota de sesión (2026-07-24):** sesión de desarrollo completa — Intake, Lobby, Workspace (PWA técnico), y en Dispatch: History, Restock, Pay Periods, Corrections, Reports; más el screen de Transfers en FieldOps/PWA. Detalle de fixes/builds en "Estado general" y en los hallazgos actualizados abajo. Verificado con 2 simulaciones E2E completas (todos los critical paths pasan) y 359/359 tests pasando. Deferred de esta sesión listado en "Backlog / pendiente de decisión".

---

## Estado general

| Superficie | Sección | Estado QA | Notas |
|---|---|---|---|
| Dispatch | PDF Intake | 🟡 Bugs corregidos, extracción sigue en stub | `tokens.css` resuelto; sesión 2026-07-24: near-match dropeaba thermostat/accessories (fix), mismatch de campos del form PDF (fix), 404 en PDF near-match (fix), `PdfIntake.jsx` muerto eliminado. Pendiente: API de extracción real sin configurar (falta config de IA en Settings) |
| Dispatch | Lobby | 🟢 Completo | Implementado y verificado E2E; sesión 2026-07-24: mismatches de campo en la card de Lobby y sync refresh corregidos |
| Dispatch | History | 🟢 Completo | Sesión 2026-07-24: full visit detail (services, items, weigh-in, photos) y property history agregados al detail; field-name mismatches corregidos. D-01 probablemente resuelto por el nuevo detail — confirmar en QA manual. D-05 sigue abierto (cosmético, baja prioridad). Falta en el list: nombre de técnico y workType (ver Backlog) |
| Dispatch | Inventory | ⬜ No iniciado | |
| Dispatch | Restock | 🟢 Completo | Sesión 2026-07-24: alerta de low-stock implementada, verificado E2E |
| Dispatch | Pay Periods | 🟢 Completo | Sesión 2026-07-24: adjustments (Add/Deduct) y auto-close implementados; field-name mismatches corregidos. Falta `totalGross` en la respuesta del list (ver Backlog) |
| Dispatch | Corrections | 🟢 Completo | Sesión 2026-07-24: two-tier review con evidence photos, endpoint de detail, y field-name mismatches implementados/corregidos |
| Dispatch | Chat | 🟡 Fix aplicado, falta verificación manual | D-03 y D-06 resueltos en commit `84c54c4` (tests pasan); idea Broadcast sigue en backlog |
| Dispatch | Catalog | 🟢 Completo | Edit inline + persistencia confirmados, sin bugs |
| Dispatch | Technicians | ⬜ Pendiente QA manual | Invite codes reemplazados por usuario/contraseña (2026-11-15): crear cuenta con contraseña temporal, provisionar filas antiguas, reset de contraseña y revocar sesiones. Tests automáticos pasan. |
| Ambas | Autenticación (usuario/contraseña) | ⬜ Pendiente QA manual | Login, cambio obligatorio de contraseña temporal, logout, "Keep me signed in" (7 días / hasta las 3:00 AM de Chicago), sesión vencida sin red: la app sigue funcionando y al reconectar pide login sin perder borradores ni envíos pendientes. Ver `docs/architecture/AUTHENTICATION-ARCHITECTURE.md`. |
| FieldOps | Snapshot canónico del reporte | ⬜ Pendiente QA manual | Un envío aceptado por visita (migración 025); el reporte se sirve desde el snapshot. |
| FieldOps | Datos offline por técnico | ⬜ Pendiente QA manual | Borradores, cola y fotos separados por técnico; cambiar de cuenta en el mismo dispositivo no mezcla datos. |
| Dispatch | Home | 🟡 En curso | D-02 (falta indicador de usuario logueado), D-04 (alerta de refrigerante — backlog). Sesión 2026-07-24: toast de notificación de completado corregido (`n.body`) |
| Dispatch | Reports | 🟢 Completo | Sesión 2026-07-24: reportes de equipment y refrigerant usage implementados |
| PWA técnico | (todas las pantallas) | 🟡 En curso | bug conocido: P-01 (labels "undefined"), P-02 (show/hide errático), P-03 (botones "Siguiente" redundantes) — pendiente reverificar tras fixes de sesión 2026-07-24. Esa sesión: Workspace — service name/photo category/item ID/price reads/weigh-in `factoryChargeUsed` corregidos; lineset config selector + factory/revised logic, Quick Charge Calc, botón Navigate, Startup Checklist + P-drain advisory, y GPS+EXIF en fotos SCALE/FAN construidos |
| PWA técnico | Transfers | 🟢 Completo | Sesión 2026-07-24: screen de transfer incoming (accept/reject) + fix de ruteo de notificaciones (`transfer_request` → `/transfers/incoming`) |

Leyenda: ⬜ no iniciado · 🟡 en curso / bloqueado · 🟢 completo

---

## Hallazgos — Cross-cutting / Global

| ID | Descripción | Prioridad | Estado | Chat dedicado |
|---|---|---|---|---|
| CC-01 | `tokens.css` 404 en Dispatch (dev server root) | Alta | 🟢 Resuelto | Contraste visual crítico en panel de revisión PDF |
| CC-02 | Login en Dispatch falla, código `DISP0002` — causa raíz real: dos pools de conexión (`tests/helpers/db.js` y `src/db/pool.js`) leían variables de entorno distintas, limpiando bases de datos distintas. No fue causado por el build de Lobby. **Resuelto (2026-07-09):** ambos pools unificados, `.env.test` + `jest.setup.js` cargan `TEST_DATABASE_URL` antes de inicializar pools, DB de test separada (`fieldops_test`) confirmada aislada — 321/321 tests verdes, no toca dev. Invite code nuevo: `3ZRK-1BAV`, válido 30 días. Artefacto residual sin importancia: técnico "Tech-technician" en dev DB de las corridas rotas anteriores — limpieza opcional, no bloquea nada. | Crítica | 🟢 Resuelto | Chat de Dirección (2026-07-09) | — |
| CC-03 | Bug secundario, menor: `auth.js:68` regresa HTTP 401 para invite code inválido/faltante, y el frontend interpreta todo 401 como expiración de sesión → muestra "Connection error" en vez del mensaje correcto. Pre-existente, no bloqueante, solo confunde el diagnóstico. | Baja | Abierto — diferible | Chat de Dirección (2026-07-09) | — **Superado (2026-11-15):** los invite codes fueron reemplazados por usuario/contraseña. |
| CC-04 | PWA deslogueó sesión — confirmado: los tests rotos (antes del fix de aislamiento) borraron `device_tokens` junto con 22 tablas más. "Tech-technician" era un artefacto sembrado por una corrida rota, no una cuenta real. **Resuelto:** el fix de aislamiento de DB ya cierra la fuga por completo — sin leak restante, confirmado. Nada que reparar. | Alta | 🟢 Resuelto — sin acción necesaria | Chat de Dirección (2026-07-11) | — |
| CC-05 | Mismatch de invite code — **causa raíz real (revisada 2026-07-11):** el formato de 8 caracteres con guión (`XXXX-XXXX`) fue la decisión original y deliberada del build de F0 (Auth Shell, 2026-07-05) — confirmado en el código original de `Auth.jsx`. El generador del backend (`generateCode()`, 6 caracteres sin guión) fue el que se desvió del diseño original, no al revés — la primera conclusión de CC (citando un "plan doc" sin identificar) fue incorrecta. **Resuelto y confirmado E2E (2026-07-11):** `Auth.jsx` revertido a 8 caracteres con guión; `generateCode()` corregido para generar ese mismo formato; PWA no se tocó (nunca estuvo mal) — código generado desde Dispatch, usado exitosamente en PWA, confirmado por el usuario en dispositivo real. | Alta | 🟢 Resuelto | Chat de Dirección (2026-07-11) | — **Superado (2026-11-15):** los invite codes fueron reemplazados por usuario/contraseña. |

| CC-06 | Corrección de documentación (2026-07-11): `API_CONTRACT.md` nunca especificaba el formato del invite code — causa raíz de que backend y frontend divergieran sin que nadie lo notara. Agregadas 2 líneas después de `generate-invite` fijando el formato canónico (8 caracteres, `XXXX-XXXX`). Además, se identificó la fuente del dato incorrecto que citó CC ("plan doc line 334"): `docs/superpowers/plans/2026-06-19-phase1-auth-technicians-notifications-sync.md`, líneas 323 y 334, decían 6 caracteres — corregidas a 8. Documento conservado (no superado, solo tenía ese detalle mal). | — | 🟢 Resuelto | Chat de Dirección (2026-07-11) | — **Superado (2026-11-15):** los invite codes fueron reemplazados por usuario/contraseña. |
| CC-07 | Test flaky (2026-11-17): `tests/autoClose.test.js` › "a backfilled old week gets closed…" fallaba de lunes a miércoles. El test asumía que la semana anterior ya estaba vencida, pero la regla cierra solo semanas que terminaron hace más de 3 días (`week_end < CURRENT_DATE − 3`). **Resuelto:** solo el test cambia — fija "hoy" en un jueves (`2026-11-19`) reescribiendo `CURRENT_DATE` en las consultas del servicio; la regla de auto-cierre no se tocó. | Media | 🟢 Resuelto | — | — |
| CC-08 | Pre-existing (found 2026-11-17, W-LF): a technician price override changes the visit total but not the line price stored and printed in the Report (`visit_items.price` keeps the catalog price). Kept as is in W-LF; the shared pricing module reproduces it. **Resolved 2026-11-17:** Kristo decided the line shows the price used for the total (the override when one exists); the server prices each Report line with the shared pricing module. | Media | 🟢 Resuelto | — | — |
| CC-09 | Flaky test (2026-11-17, W4.1): one run of `npm test -- tests/report tests/completion` reported "1 failed, 193 passed"; the rerun of the same command and `tests/completion.test.js` alone passed. The failing test's name and error were not captured (the output was filtered to the counts). Not reproduced since (754/754 several times). Next occurrence: keep the full log. | Baja | Abierto — vigilar | — | — |
| CC-11 | Flaky test (2026-11-17, D2 full run): `tests/chat.test.js` › "GET /api/chat/broadcast/:messageId/read-receipts › returns who has read the broadcast" — `expect(res.status).toBe(200)`, received **400** (the route's only 400 is "Message is not a broadcast", although the test inserts a `broadcast` row). The suite passed 3/3 when rerun alone; D2 changed no server code. Possibly the same family as CC-09. **Investigation 2026-11-18 (time-boxed):** not reproduced in 3 full runs (760/760 each) or 3 isolated chat runs. Ruled out: background jobs (startup jobs run only under `require.main`), work that outlives a request (none in `src/`), leaked transactions and connection pressure (≤14 connections, none idle in a transaction during a full run), route shadowing by routers mounted on `/api`, and the port collision already fixed in `jest.setup.js`. Open hypothesis: a second Jest process writing to the same test DB (a stopped run whose child kept going); not verifiable after the fact. Guard built 2026-11-18 (`tests/global/setup.js`): a session advisory lock on the test DB; a second concurrent Jest run now fails fast with "Another test run is using the test database". | Baja | Abierto — vigilar | — | — |
| CC-12 | Dispatch bug (found 2026-11-17, D2): `POST` PDF upload (`src/routes/dispatch.js`) starts with `DELETE FROM pdf_batches WHERE status = 'released'`, but visits still reference released batches (`visits_batch_id_fkey`), so the upload fails with 500 and Intake shows "Extraction failed" as soon as one released batch has visits (the dev data has 27). Not fixed in D2 (behavior). **Resolved 2026-11-18:** the cleanup deletes only released batches no visit references; referenced batches are kept. | Alta | 🟢 Resuelto | — | — |
| CC-13 | PDF Intake (2026-11-18): Review Extraction showed invented calls ("123 MAPLE ST", "ORD-001"…). Cause: `src/services/ai.js` was a placeholder stub (commit `3f7ffc5`) that returned two hard-coded calls for any PDF; the real route PDFs have no text layer. Also found: Confirm dropped the reviewed systems/models, company notes and contact (and manual entry dropped the contact). **Resolved 2026-11-18:** stub removed; offline OCR + CP3000 parser; confirm and manual entry store systems, company notes and contact. | Alta | 🟢 Resuelto | — | — |
| CC-14 | Dependencies (2026-11-18, `npm audit --omit=dev`): 5 known vulnerabilities in the existing Express/multer chain (body-parser, multer, proxy-addr, qs, ip-address; 1 critical, 3 high, 1 moderate). None from the OCR packages. Review before the pilot. **Resolved 2026-11-18 (production):** express 4.22.3, multer 2.5.0 and `npm audit fix` (body-parser 1.20.9, proxy-addr 2.0.8, qs 6.16.2, ip-address 10.7.6); `npm audit --omit=dev` reports 0. Still open (dev tooling only, never shipped): vite 5 and its esbuild need a major upgrade (vite 8); brace-expansion, browserslist, js-yaml, nanoid, postcss, source-map-js have non-breaking fixes. | Alta | 🟢 Resuelto (prod) | — | — |
| CC-15 | Reports rejected with "the office's copy differs in: Weigh-In" (Kristo, 2026-11-18). Causes (reproduced): (1) the Report's Weigh-In was read back from every row stored for the address, so a draft downloaded before another Report at the same address changed those rows never matched; (2) the server kept old factory charge / approx adjust / SC deviation when the phone sent none. "Correct report" could not fix either. **Resolved 2026-11-18:** Weigh-In never rejects; stored as the phone sent it; earlier values kept as `weighInDiscrepancies` and shown in Dispatch. | Alta | 🟢 Resuelto | — | — |
| CC-16 | Corrections Finder → Open Correction failed for a report that already had an open correction (2026-11-19, found in D6 screenshots): the Finder always created a new correction and the server refuses a second open one per visit. **Resolved 2026-11-19:** the Finder and the direct-open path share one open-or-create step (`frontend/dispatch/src/lib/corrections.mjs`) that reuses the open correction; `tests/correction-open-reuse.test.js`. | `shared/CORRECTIONS.md` |
| CC-10 | PWA (2026-11-17, W4.1): after a rejected Report is corrected and resent, the superseded `correction_required` submission record stays in IndexedDB. Reports hides it (the visit is delivered), so it is invisible, but it is never cleaned up. | Baja | Abierto | — | — |

---

## Hallazgos — Dispatch

| ID | Sección | Descripción | Tipo | Prioridad | Estado | Chat de origen | Chat dedicado |
|---|---|---|---|---|---|---|---|
| D-01 | History | Botón "Open" no funcional | bug | **Alta** | 🟡 Probablemente resuelto (sesión 2026-07-24) — confirmar | QA walkthrough | — |
| D-02 | Home | Falta indicador de usuario logueado (sesión global, detectado en flujo de Chat) | missing | Media | Abierto | QA walkthrough | — |
| D-03 | Chat | Mensajes aparecen idénticos entre distintos threads de usuario (scoping). **Resuelto (commit `84c54c4`).** Nota importante (2026-07-11): la verificación manual de PWA → Dispatcher pasó, pero por un mecanismo de recarga (cambiar de hilo dispara fetch nuevo), no por sync en tiempo real — Dispatch no tiene sync pasivo, solo fetch on-open. No es necesariamente un bug, pero es una decisión de diseño pendiente (ver CC-07). | bug | Alta | 🟢 Resuelto | Commit sin reportar (fuera de protocolo) | — |
| D-06 | Chat | Envío de mensaje falla silenciosamente en hilo "Christian/owner". **Causa raíz encontrada y fix aplicado (2026-07-11):** mismatch de campo `newMessages`/`chatMessages` en `onSyncUpdate` (PWA). Verificado a nivel API por CC (send + sync + filtro, los 3 pasos confirman que el mensaje llega). **Pendiente confirmar en navegador real con prueba controlada** (dejar hilo abierto, sin tocar, cronometrar ~20-25s) — intento anterior no fue concluyente (usuario no cronometró el momento exacto). | bug | Alta | 🟡 Fix aplicado, esperando confirmación controlada | Chat de Dirección (2026-07-11) | — |
| D-08 | Chat | Bug secundario confirmado visualmente (captura PWA, 2026-07-11): mensajes que llegan vía sync (no vía carga inicial de hilo) se renderizan sin hora visible y siempre con estilo "recibido" (aunque sean mensajes propios), porque el backend entrega `snake_case` (`sender_id`, `created_at`) en sync pero el frontend espera `camelCase` (`sentByMe`, `createdAt`) como en la carga inicial. No afecta la entrega del mensaje, solo su presentación. | UX / cosmético | Media | Abierto | Chat de Dirección (2026-07-11) | — |
| D-04 | Home | Alerta de bajo refrigerante depende de cálculo que no existe (agregado por sistema/dirección + evento de reemplazo de tanque) | missing / spec pendiente | Media | Backlog — anotado, no bloquea (ship como placeholder) | Protocolo de triage | Pendiente `REFRIGERANT-ALERT-SPEC.md` |
| D-05 | History | ~~Status inválido/truncado~~ Diagnosticado por CC (2026-07-09): `temporarily` es un status legítimo e intencional (reparación temporal, definido en schema). Dato limpio, cero riesgo para Lobby. Solo falta mapa de label en `History.jsx:149` (muestra el valor crudo sin formatear) | UX / cosmético | Baja | Abierto — trivial, diferible, sin urgencia | QA walkthrough | — |
---

## Hallazgos — PWA técnico

| ID | Sección | Descripción | Tipo | Prioridad | Estado | Chat de origen | Chat dedicado |
|---|---|---|---|---|---|---|---|
| P-01 | Varias secciones | Labels de botones muestran "undefined" | bug | Alta | Abierto | QA walkthrough | — |
| P-02 | Varias secciones | Comportamiento show/hide errático | bug | Media | Abierto | QA walkthrough | — |
| P-03 | Varias secciones | Botones "Siguiente" redundantes | UX | Media | Abierto | QA walkthrough | — |
| P-04 | Photos | No UI to view or discard photos the server rejected: they stay on the phone and are retried forever. Logged by Kristo (2026-11-17), no code yet. | UX | Media | Abierto | Photos phase | — |

---

## WIP test findings (2026-11-15) — Workspace pass

Recorded from manual testing of `wip/auth-reports-offline-2026-11`. Not implemented; scheduled for a separate Workspace pass after Guided Phase 4. Owning specs carry a matching "Pending changes" note.

| ID | Area | Finding | Owning spec |
|---|---|---|---|
| WS-01 | Service | AC, Heat, Temporarily and Finish combine freely. Prestart is exclusive and cannot combine with anything. **Resolved in W1a (2026-11-17).** | `workspace/SERVICE-TSTAT-SPEC.md` |
| WS-02 | Service | AC and Heat reveal hidden options: Finish, Temporarily, and the per-system override when the visit has multiple systems. **Resolved in W1a (2026-11-17).** | `workspace/SERVICE-TSTAT-SPEC.md`, `workspace/SERVICE-MULTISYSTEM-SPEC.md` |
| WS-03 | Tstat | Implementation opens a quantity modal; the closed spec requires a single-line control with no modal. New direction: quantity hidden until a tstat is selected, then shown directly below the list with quick picks 1–4 plus open entry for higher counts. **Resolved in W1a (2026-11-17).** | `workspace/SERVICE-TSTAT-SPEC.md` |
| WS-04 | Accessories | Label change only: "Ecoil Wire" is renamed "EEV Wire" (catalog, specs, report text, tests). It stays in the UT3000 accessory group (UT3000 · DAPC · EEV Wire · eBypass); update the Guided UT3000-group reference too. Unrelated to the Fix items in WS-05/WS-06. | `workspace/ACC-SPEC.md` |
| WS-05 | Fix | Fixed Leaks: hidden sub-options eCoil · Cunit · Wall, revealed on tap. Exact casing "eCoil", consistent with the checklist "P-drain [eCoil]" (catalog and spec currently say "Leaks Ecoil"). | `workspace/FIX-SPEC.md` |
| WS-06 | Fix | Extended Wire: tile label becomes "Ext. Wire". Hidden sub-options Furnace · Cunit, revealed on tap. One location is required: it cannot be charged without a location. The location-less `Extended Wire` catalog item is retired from selection. | `workspace/FIX-SPEC.md` |
| WS-07 | Accessories | LP Kit sub-options confirmed: Lennox 1Stg · Lennox 2Stg · Goodman (no change). | `workspace/ACC-SPEC.md` |
| WS-08 | Weigh-In | Bug against spec: Subcooling is not calculated. Spec: computed field = Condenser Sat − Liquid Temp. | `workspace/WEIGHIN-SPEC.md` |
| WS-09 | Weigh-In | Lineset dropdown is too long to use. Propose numeric entry (keypad or stepper) in the Workspace pass. | `workspace/WEIGHIN-SPEC.md` |
| WS-10 | Report | Before submitting, a review screen summarizing services, tstat, accessories, fixes with amounts and total, weigh-in, notes and checklist, with explicit confirmation. (Current modal shows only service, item count, total and photos.) **Resolved in W4 (2026-11-17).** | `workspace/CHECKLIST-NOTES-SPEC.md` |
| WS-11 | Fix / Accessories | Sub-options of Fixed Leaks, Extended Wire and LP Kit are always visible. They must stay hidden until the parent tile is selected. LP Kit: bug against spec (`ACC-SPEC.md` already requires hidden sub-options). Fixed Leaks and Extended Wire: new direction (`FIX-SPEC.md` describes flat tiles). | `workspace/FIX-SPEC.md`, `workspace/ACC-SPEC.md` |
| WS-12 | Report | Report rejection messages must say what differs and what to do. No generic "Correction required". **Resolved in W4 (2026-11-17).** | `architecture/REPORT-SNAPSHOT-CONTRACT.md` |

Verified OK in the same session: Lobby claim flow, GPS permission prompt on the first service, amount calculations.

Blocker found in the same session and fixed on the WIP branch (`272e27e`): a thermostat chosen in the Workspace was sent with `techSupplied=false` while the catalog says `true`, and the strict Report comparison rejected the first submission with "Correction required".

## History findings (2026-11-15) — later History pass

Recorded from WIP testing. Not a bug in the reported case: the completed visit was visible after re-entering History. Not implemented; History is CLOSED and these wait for a dedicated History pass.

| ID | Finding | Owning spec |
|---|---|---|
| HI-01 | The list includes `in_progress` visits, and they sort first (null completion date). Spec: finished visits only. | `dispatch/HISTORY-PROPERTIES-SPEC.md` |
| HI-02 | The list loads every visit. Spec: the most recent 30, then "Load 30 more". | `dispatch/HISTORY-PROPERTIES-SPEC.md` |
| HI-03 | The list has a Total column. Spec: no Total column. Kristo decides in that pass whether to keep it. | `dispatch/HISTORY-PROPERTIES-SPEC.md` |
| HI-04 | The list does not refresh while open; it loads only when the screen mounts. It should refresh at least on screen focus or re-entry. | `dispatch/HISTORY-PROPERTIES-SPEC.md` |

## UI findings (2026-11-15) — later UI pass

Recorded during Phase 4.1 (style homologation). Not implemented.

| ID | Finding | Area |
|---|---|---|
| UI-01 | The Settings Dark/Light theme selector is hidden: FieldOps has a single theme (Porcelain). Reinstate it only if a dark theme is built. | PWA Settings |
| UI-02 | Settings, Chat and Transfers inherit the uppercase mono header title from the Home screens. Each screen injects its own global `.screen-header` / `.screen-title` rules, and the last one injected wins. | PWA shared header classes |
| UI-03 | Settings section cards run edge to edge, with no side margin. | PWA Settings |

## Pre-production requirements

Must be implemented after the WIP merge and before launch.

| ID | Requirement | Reference |
|---|---|---|
| PP-01 | **Implemented 2026-11-17 (W-LF): Report view flag.** Report price snapshot, non-blocking. Each Report stores the prices it was built with; later price changes never alter past Reports. If submitted catalog-derived values (price, tech_supplied) differ from the server catalog, the server accepts the Report, stores both values and flags the discrepancy — never "Correction required" for this reason. Dispatch shows the discrepancy on the Report view and in the Ledger week review (owner-configurable threshold). Dispatch edits a technician's Report only with prior agreement and notice, via the existing corrections channel. Automatic catalog/shell versioning (Guided Phase 4) stays as a secondary safeguard. Authorized to change the CLOSED Reports and Ledger sections for PP-01 only; update `REPORT-SNAPSHOT-CONTRACT.md` as part of the work. | `MASTER-FUNCTION-INDEX.md` R-09 |
| PP-01b | Ledger weekly review of PP-01 price discrepancies, with an owner-configurable threshold. Deferred by Kristo (2026-11-17); the Report view flag is implemented. | `MASTER-FUNCTION-INDEX.md` R-09 |

## Future features (out of current scope)

| ID | Feature | Reference |
|---|---|---|
| FF-01 | Technician-defined price panel, as in the legacy app (hvacstartup-dev.netlify.app); needed if FieldOps is commercialized. Options to evaluate then: preset agreed prices, zero prices filled on first use, or a price panel filled before the first job. | `MASTER-FUNCTION-INDEX.md` R-10 |
| FF-02 | System identifier in report text (2026-11-17). Per-system report lines name systems "System 1/2/3", which another technician cannot match on site. Replace with an unambiguous real-world identifier: preferably a location label captured in Dispatch (e.g. DS/US), falling back to capacity (e.g. 4 ton) when no label exists; capacity alone can repeat. **WITHDRAWN (Kristo, 2026-11-17):** systems stay "System 1..N"; the location goes in Notes. | `shared/REPORT-TEXT.md` (per-system services) |
| FF-03 | Company-level setting "contractors may set their own prices" (2026-11-17). On: a contractor edits a price catalog inside FieldOps (their overrides). Off: company catalog prices only. | `MASTER-FUNCTION-INDEX.md` R-10 (related: FF-01) |
| FF-04 | Dispatch navigation from the mockups (2026-11-17, future UX decision): Home overview, a Dispatch Transfer screen, Properties as its own screen, and Inventory merged with Restock. Not adopted in the restyle; the real navigation stays. | `mockups/fieldops-dispatch-mockups.html` (00, 03, 06), `history-properties-mockup.html` (09) |
| FF-05 | Ledger Money In/Out, Ledger compensation report, and Technicians compensation history (2026-11-17). Shown in the mockups; not built and out of the restyle scope. The mockup's Technicians invite code is dropped: accounts use username and password. | `mockups/ledger-mockup.html` (11a, 11b), `technicians-mockup.html` (10b) |
| FF-06 | Dispatch mockup extras left out of D2 (Kristo, 2026-11-18), for a later round: CATALOG / FREE TEXT tags on Intake fields, Lobby waiting time per call, "Return a visit to lobby" action, and priority calls ordered first within their subdivision. | `docs/mockups/fieldops-dispatch-mockups.html` (01 Intake, 02 Lobby) |
| FF-07 | PDF Intake AI fallback for route PDFs that are not CP3000 (other formats). Out of scope (2026-11-18); Intake reads CP3000 sheets with OCR + a deterministic parser and offers Manual Entry otherwise. | `dispatch/LOBBY-CALL-INTAKE-SPEC.md` (PDF route sheets) |
| FF-08 | Dispatch Reports printable document from the mockup (2026-11-18, later round): summary page first, document number, "generated" timestamp, operator, and page footers. Today Print / Export prints the screen with a letterhead. | `dispatch/REPORTS-SPEC.md` |
| FF-09 | Commission label (2026-11-19, later round). The stored rate is what the office keeps (e.g. 20%); the Technicians mockup shows the technician's share (80%). Meaning stays as stored; a clearer label showing both share and kept is for a later round. | `dispatch/TECHNICIANS-SPEC.md`, `mockups/technicians-mockup.html` (10a, 10b) |

## Backlog / pendiente de decisión

- `SERVICE-MULTISYSTEM-SPEC.md` — rediseño de sección Service multisistema. Especificado, no implementado.
- `TROUBLESHOOTING-ENGINE-SPEC.md` (F11) — motor de troubleshooting. Especificado, spec a medias (pendiente decisión de schema para umbrales numéricos).
- D-04 — alerta de refrigerante, pendiente `REFRIGERANT-ALERT-SPEC.md` dedicado.
- Broadcast (Chat) — propuesta de rediseño: renombrar + botón "Acknowledge". Idea guardada, no especificada.
- CC-07 (confirmado 2026-07-11) — Dispatch Chat **no tiene ningún mecanismo de sync pasivo**, solo `loadContacts()` al montar y `openThread()` al hacer clic o después de enviar. PWA sí tiene `startSync()` cada 20s. CC lo marca como "gap no intencional" — el diseño original parece haber previsto tiempo real para ambos, pero Dispatch nunca lo recibió. Decisión pendiente: ¿agregar polling a Dispatch (espejo de PWA) o dejarlo para un pase de diseño separado?
- **Captura manual de llamadas + Lobby (unificados, actualizado 2026-07-09)** — decisión final: la captura manual **reutiliza el mecanismo de batch existente**, no requiere un release individual nuevo. Un batch manual puede contener 1, 3, o N llamadas — se libera con el mismo `release-to-lobby(batchId)` que ya usa PDF Intake. Esto elimina la necesidad del "Gap 1" (release de visita suelta) por completo. **Decidido:** el batch manual se abre al presionar "+ New Call" desde Home (deja de ser placeholder deshabilitado). Pendiente de diseño real en chat dedicado: (1) `create-manual` debe aceptar `batchId` como parámetro, (2) reusar el mismo flujo de revisión Confirm/Skip/Release que ya existe para PDF, (3) frontend del formulario de captura. **Ideas abiertas, no decididas — llevar a discovery:** renombrar "PDF Intake" a "Captura de Llamadas" o similar (ahora cubre ambos orígenes); acceso directo a "Nueva llamada" tipo botón/chip visible desde cualquier sección, no solo Home. El Gap 2 (reassign directo) sigue sin aplicar a este flujo — bug latente aparte, solo relevante para reasignación de visitas huérfanas. Este tema se diseña junto con Lobby, no por separado.

**Pendientes documentados — sesión 2026-07-24** (no planeados para esa sesión, quedan en backlog):
- Unassign / return-to-lobby — sin endpoint ni UI.
- Priority sort dentro de subdivision — solo badge, falta el sort real.
- Transfer: la lista de peers incluye dispatchers — falta filtro por rol.
- N5 — highlights de thermostat/accessories pre-especificados en Workspace.
- History list: falta nombre de técnico y `workType` en la respuesta del backend (el detail sí los tiene, ver fila History en "Estado general").
- Pay Periods list: falta `totalGross` en la respuesta del backend.
- Integración con Google Drive — decidida, no construida.
- Extracción de PDF — sigue en stub, pendiente configurar IA en Settings (ver fila PDF Intake en "Estado general").
- ~~Catalog: falta seed data~~ **Resuelto (2026-07-24):** la nota original (misma fecha) reportaba `catalog_items`/`catalog_equipment` con más filas que `scripts/seed-catalog.sql` (288/286 vs. 40/144) — investigado y confirmado que el exceso era contaminación de datos fabricados, no catálogo real. Limpieza completa realizada:
  - `catalog_equipment`: eliminadas 142 filas fabricadas (`Carrier` ×16, `TEST` ×10, `TestBrand` ×116, alguna con `unit_type = 'hacked'`) — quedan 144, igual al seed.
  - `catalog_items`: eliminadas 248 filas fabricadas (`ITEM-<hex>` ×226, `TEST-*`, y nombres sueltos tipo `acc1`/`ACC2`/`T10`/`TSTATMODEL`) — quedan 40, igual al seed. 14 filas de `visit_items` y 4 de `visit_systems` referenciaban parte de esos nombres, todas sobre 4 visitas fabricadas (técnico `Tech-technician`, direcciones tipo "TEST ADDRESS") — esas 4 visitas y su `catalog_item_relations` asociada (`TEST-PARENT`/`TEST-COMPANION`) se borraron también.
  - **Causa raíz corregida (commit `e28bc89`):** `src/helpers/visit.js` (`createVisitWithSystems`) hacía upsert de cualquier thermostat/accessory de texto libre ingresado en Intake directamente a `catalog_items` (`ON CONFLICT DO NOTHING`) — cada nombre no catalogado se volvía una fila de catálogo permanente. Eliminado el upsert; el lookup de precio ahora usa fallback (`price 0`, `tech_supplied true`) sin escribir en `catalog_items`. Texto libre vive solo en `visit_items`, nunca en el catálogo. 359/359 tests pasando tras el fix.
  - `scripts/seed-catalog.sql` ahora sí refleja el estado real de la DB — ambas tablas exactas al seed.
  - **Actualización (2026-07-24, misma sesión):** la contaminación también apareció en `catalog_services` (49 filas vs. 6 esperadas — `SVC-<hex>` ×39, `AC-EXTRA`, `PT-SVC`, `PT-SVC-MULTI`). Sin referencias en `visit_services`, eliminadas las 43 filas fabricadas — quedan exactamente 6 (`AC`, `Heat`, `AC & Heat`, `Prestart`, `Drive Run`, `Cancel`), igual al seed. Las tres tablas de catálogo (`catalog_equipment`, `catalog_items`, `catalog_services`) están ahora limpias.
  - **Bug relacionado corregido (commit `1624fdc`):** al reabrir un workspace, `visit._service` (Service section del PWA) se reseteaba siempre a todo-`false`, sin importar el `service_name` ya guardado en `visit_services` — la selección de servicio existente se perdía visualmente (aunque el dato en DB seguía correcto). `frontend/pwa/src/screens/workspace.js` ahora hidrata `visit._service` desde `visit.services[0]` y `visit.hasMultipleSystems` (respuesta de `GET /api/visits/:id`) en vez de resetear. Verificado en vivo contra la visita `b635d53a…` (servicio guardado `AC & Heat`) — ahora carga con AC y Heat activos. 359/359 tests pasando.
  - **Nota aparte, sin acción:** durante este diagnóstico se investigó un reporte de labels "undefined" en el Service section — no se pudo reproducir. El código de `buildServiceSection` usa labels hardcodeados (nunca puede mostrar "undefined") y se confirmó en vivo contra la visita fabricada mencionada en el reporte. Probablemente un estado de navegador desactualizado, ya que el mismatch de nombres de servicio ya había sido corregido en una sesión anterior.

---

## Protocolo del Chat de Dirección

1. Reportás: `[Superficie] > [Sección]: encontré [X]`
2. El Chat de Dirección responde con UNA de estas cuatro acciones:
   - **Seguí en el chat actual** — menor, no bloquea el walkthrough de la sección
   - **Abrí un chat dedicado** — bloqueante, necesita diagnóstico/fix vía CC
   - **Anotalo y seguí** — no bloquea nada, va a backlog o a la tabla de hallazgos
   - **Parar el QA global** — sospecha de problema de raíz que afecta todo (como pasó con `tokens.css`)
3. El Chat de Dirección actualiza este documento (vos pegás el diff o lo actualizás vos mismo).
4. El Chat de Dirección **nunca implementa ni diagnostica a fondo** — esa es tarea del chat dedicado con CC.

**Función proactiva:** cuando preguntes "¿qué sigue?", el Chat de Dirección decide en base a la tabla "Estado general", en este orden de criterio:
1. Secciones 🟡 antes que ⬜ (cerrar lo empezado antes que abrir nuevo).
2. Entre las ⬜, prioridad por riesgo/superficie.
3. Hallazgos Alta sin chat dedicado abierto van primero, aunque interrumpan el orden.
