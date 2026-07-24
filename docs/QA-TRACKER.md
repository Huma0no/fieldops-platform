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
| Dispatch | Pay Periods | 🟢 Completo | Sesión 2026-07-24: adjustments (Add/Deduct), Ghost Deduction y auto-close implementados; field-name mismatches corregidos. Falta `totalGross` en la respuesta del list (ver Backlog) |
| Dispatch | Corrections | 🟢 Completo | Sesión 2026-07-24: two-tier review con evidence photos, endpoint de detail, y field-name mismatches implementados/corregidos |
| Dispatch | Chat | 🟡 Fix aplicado, falta verificación manual | D-03 y D-06 resueltos en commit `84c54c4` (tests pasan); idea Broadcast sigue en backlog |
| Dispatch | Catalog | 🟢 Completo | Edit inline + persistencia confirmados, sin bugs |
| Dispatch | Technicians | 🟡 En curso | Invite code testeado OK; Refresh/Revoke pendientes de testear |
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
| CC-03 | Bug secundario, menor: `auth.js:68` regresa HTTP 401 para invite code inválido/faltante, y el frontend interpreta todo 401 como expiración de sesión → muestra "Connection error" en vez del mensaje correcto. Pre-existente, no bloqueante, solo confunde el diagnóstico. | Baja | Abierto — diferible | Chat de Dirección (2026-07-09) | — |
| CC-04 | PWA deslogueó sesión — confirmado: los tests rotos (antes del fix de aislamiento) borraron `device_tokens` junto con 22 tablas más. "Tech-technician" era un artefacto sembrado por una corrida rota, no una cuenta real. **Resuelto:** el fix de aislamiento de DB ya cierra la fuga por completo — sin leak restante, confirmado. Nada que reparar. | Alta | 🟢 Resuelto — sin acción necesaria | Chat de Dirección (2026-07-11) | — |
| CC-05 | Mismatch de invite code — **causa raíz real (revisada 2026-07-11):** el formato de 8 caracteres con guión (`XXXX-XXXX`) fue la decisión original y deliberada del build de F0 (Auth Shell, 2026-07-05) — confirmado en el código original de `Auth.jsx`. El generador del backend (`generateCode()`, 6 caracteres sin guión) fue el que se desvió del diseño original, no al revés — la primera conclusión de CC (citando un "plan doc" sin identificar) fue incorrecta. **Resuelto y confirmado E2E (2026-07-11):** `Auth.jsx` revertido a 8 caracteres con guión; `generateCode()` corregido para generar ese mismo formato; PWA no se tocó (nunca estuvo mal) — código generado desde Dispatch, usado exitosamente en PWA, confirmado por el usuario en dispositivo real. | Alta | 🟢 Resuelto | Chat de Dirección (2026-07-11) | — |

| CC-06 | Corrección de documentación (2026-07-11): `API_CONTRACT.md` nunca especificaba el formato del invite code — causa raíz de que backend y frontend divergieran sin que nadie lo notara. Agregadas 2 líneas después de `generate-invite` fijando el formato canónico (8 caracteres, `XXXX-XXXX`). Además, se identificó la fuente del dato incorrecto que citó CC ("plan doc line 334"): `docs/superpowers/plans/2026-06-19-phase1-auth-technicians-notifications-sync.md`, líneas 323 y 334, decían 6 caracteres — corregidas a 8. Documento conservado (no superado, solo tenía ese detalle mal). | — | 🟢 Resuelto | Chat de Dirección (2026-07-11) | — |

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

---

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
- ~~Catalog: falta seed data~~ **Resuelto (verificado 2026-07-24, sin cambios en DB):** `catalog_services`/`catalog_items`/`catalog_equipment`/`catalog_item_relations` ya están poblados en dev — 49/288/286/11 filas respectivamente, todas por encima de lo que trae `scripts/seed-catalog.sql` (6/40/144/10), vía el Catalog Editor de Dispatch. **No se corrió el seed**: hacerlo hoy hubiera truncado esas filas extra y cascadeado sobre `visit_items`/`visit_services` (22/3 filas reales). `scripts/seed-catalog.sql` queda como referencia de valores canónicos, no como fuente activa — la DB ya divergió de él.

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
