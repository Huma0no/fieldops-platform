# FieldOps — QA Tracker de Control

**Propósito:** única fuente de verdad del estado del QA walkthrough. Todo hallazgo se registra acá, venga del chat que venga — incluyendo los que no corresponden a ninguna sección específica (categoría Cross-cutting).

**Regla:** este documento no se toca en chats de implementación. Solo el Chat de Dirección lo actualiza.

**Nota de reconciliación (2026-07-08):** esta versión corrige un desfase — la primera versión del tracker se armó como plantilla y no importó todos los hallazgos reales de la sesión "QA walkthrough fieldops-platform HVAC". Se reconcilió comparando contra las notas originales de esa sesión. D-01 subió de Media a Alta por decisión explícita (History es inútil si no se puede abrir el detalle).

---

## Estado general

| Superficie | Sección | Estado QA | Notas |
|---|---|---|---|
| Dispatch | PDF Intake | 🟡 Desbloqueado visualmente | `tokens.css` resuelto; pendiente testeo funcional (API de extracción aún sin configurar) |
| Dispatch | Lobby | 🟢 Diseño completo | `LOBBY-CALL-INTAKE-SPEC.md` — listo para build con CC, no implementado aún |
| Dispatch | History | 🟡 En curso / bloqueado | 1 bug real: D-01 (botón Open). D-05 reclasificado a cosmético/baja prioridad tras diagnóstico |
| Dispatch | Inventory | ⬜ No iniciado | |
| Dispatch | Restock | ⬜ No iniciado | |
| Dispatch | Pay Periods | ⬜ No iniciado | |
| Dispatch | Corrections | ⬜ No iniciado | |
| Dispatch | Chat | 🟡 En curso / bloqueado | D-03 (scoping), D-06 (envío falla silenciosamente), + idea Broadcast en backlog |
| Dispatch | Catalog | 🟢 Completo | Edit inline + persistencia confirmados, sin bugs |
| Dispatch | Technicians | 🟡 En curso | Invite code testeado OK; Refresh/Revoke pendientes de testear |
| Dispatch | Home | 🟡 En curso | D-02 (falta indicador de usuario logueado), D-04 (alerta de refrigerante — backlog) |
| PWA técnico | (todas las pantallas) | ⬜ No iniciado | bug conocido: P-01 (labels "undefined"), P-02 (show/hide errático), P-03 (botones "Siguiente" redundantes) |

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
| D-01 | History | Botón "Open" no funcional | bug | **Alta** | Abierto | QA walkthrough | — |
| D-02 | Home | Falta indicador de usuario logueado (sesión global, detectado en flujo de Chat) | missing | Media | Abierto | QA walkthrough | — |
| D-03 | Chat | Mensajes aparecen idénticos entre distintos threads de usuario (scoping) | bug | Alta | Abierto | QA walkthrough | — |
| D-04 | Home | Alerta de bajo refrigerante depende de cálculo que no existe (agregado por sistema/dirección + evento de reemplazo de tanque) | missing / spec pendiente | Media | Backlog — anotado, no bloquea (ship como placeholder) | Protocolo de triage | Pendiente `REFRIGERANT-ALERT-SPEC.md` |
| D-05 | History | ~~Status inválido/truncado~~ Diagnosticado por CC (2026-07-09): `temporarily` es un status legítimo e intencional (reparación temporal, definido en schema). Dato limpio, cero riesgo para Lobby. Solo falta mapa de label en `History.jsx:149` (muestra el valor crudo sin formatear) | UX / cosmético | Baja | Abierto — trivial, diferible, sin urgencia | QA walkthrough | — |
| D-06 | Chat | Envío de mensaje falla silenciosamente en hilo "Christian/owner" | bug | Alta | Abierto | QA walkthrough | — |
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
- **Captura manual de llamadas + Lobby (unificados, actualizado 2026-07-09)** — decisión final: la captura manual **reutiliza el mecanismo de batch existente**, no requiere un release individual nuevo. Un batch manual puede contener 1, 3, o N llamadas — se libera con el mismo `release-to-lobby(batchId)` que ya usa PDF Intake. Esto elimina la necesidad del "Gap 1" (release de visita suelta) por completo. **Decidido:** el batch manual se abre al presionar "+ New Call" desde Home (deja de ser placeholder deshabilitado). Pendiente de diseño real en chat dedicado: (1) `create-manual` debe aceptar `batchId` como parámetro, (2) reusar el mismo flujo de revisión Confirm/Skip/Release que ya existe para PDF, (3) frontend del formulario de captura. **Ideas abiertas, no decididas — llevar a discovery:** renombrar "PDF Intake" a "Captura de Llamadas" o similar (ahora cubre ambos orígenes); acceso directo a "Nueva llamada" tipo botón/chip visible desde cualquier sección, no solo Home. El Gap 2 (reassign directo) sigue sin aplicar a este flujo — bug latente aparte, solo relevante para reasignación de visitas huérfanas. Este tema se diseña junto con Lobby, no por separado.

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
