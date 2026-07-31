# Dispatch — Mapa de Features

**Fecha:** 2026-07-07
**Fuentes:** UI_PLAN.md, F0-F9-AUDIT.md (2026-07-01), API_CONTRACT.md
**Propósito:** inventario completo de lo que Dispatch debería tener, sección por sección, marcando qué está construido, qué tiene bugs, qué falta y qué tiene un hueco de diseño no detectado antes.

**Leyenda:**
- ✅ Construido y funcionando
- ⚠️ Construido con bug o warning (referencia al audit)
- ❌ No implementado
- 🚧 Hueco de diseño — el plan lo describe pero el contrato/backend no lo soporta tal cual está escrito

---

## F0 — Auth (dispatcher)

| Feature | Estado | Nota |
|---|---|---|
| Pantalla de invite code | ✅ | `Auth.jsx` |
| Redimir código → guarda `deviceToken` | ✅ | |
| Ruteo automático a Lobby tras login | ✅ | |
| Envío del código con o sin guión al servidor | ⚠️ | D3 — envía el guión (`XXXX-XXXX`), no está confirmado si el servidor lo espera así |

---

## F2 — Lobby (Dispatch)

| Feature | Estado | Nota |
|---|---|---|
| Lista de visitas sin asignar con tags (urgente, A2L, multisistema) | ❌ | `LobbyPlaceholder` — módulo completo sin construir |
| Botón Assign → dropdown de técnicos activos | ❌ | |
| `PATCH /api/dispatch/visits/:id/reassign` desde Lobby | ❌ | Endpoint existe en backend, nadie lo llama desde Dispatch |
| Desaparición de la tarjeta al siguiente poll tras asignar | ❌ | |

Este módulo es, junto con la creación manual, el hueco más grande de todo Dispatch — es el punto donde nace la asignación de trabajo y hoy no existe.

---

## F5 — PDF Intake + Creación manual

**PDF Intake (flujo automático):**

| Feature | Estado | Nota |
|---|---|---|
| Upload de PDF | ✅ | `PdfIntake.jsx` — limpio |
| Extracción AI + progreso | ✅ | |
| Revisión llamada por llamada (panel PDF + campos editables) | ✅ | |
| Confirmar / Skip por llamada | ✅ | |
| Modal de comparación de dirección (exact/partial/none) | ✅ | `AddressModal.jsx` — limpio, coincide con contrato |
| Release to Lobby (batch) | ✅ | |
| Manejo de mismatch en conteo al liberar | ✅ | |

**Creación manual (`[+ New Visit]`) — descrita en UI_PLAN, nunca construida:**

| Feature | Estado | Nota |
|---|---|---|
| Botón `+ New Visit` | ❌ | No implementado en ningún archivo auditado |
| Formulario (dirección, orden, hora, tipo de trabajo, sistemas, notas) | ❌ | |
| `POST /api/dispatch/visits/create-manual` | ❌ | Endpoint backend existe y funciona; nadie lo llama en frontend |
| Reusar modal de comparación de dirección | ❌ | El componente ya existe (`AddressModal.jsx`), solo falta conectarlo aquí |
| Opción "Liberar a Lobby" desde la visita manual | 🚧 | El contrato no tiene un release de una sola visita — solo `release-to-lobby` por `batchId`. Una visita manual no pertenece a ningún batch. |
| Opción "Asignar directo a técnico" desde la visita manual | 🚧 | `PATCH /reassign` deja el status intacto si la visita está en `pending_review` — el técnico nunca la vería en My Calls aunque quede "asignada". Falta que reassign también transicione el status, o un endpoint distinto para este caso. |

Estos dos 🚧 son el tema que dejamos abierto la vez pasada — hay que resolverlos en el backend antes de construir el frontend de este botón.

---

## F6 — History + Full Edit + Inventory + Restock

**History:**

| Feature | Estado | Nota |
|---|---|---|
| Lista con filtros (fecha, técnico, builder, subdivisión, status) | ✅ | |
| Ícono de anomalía de precio en filas | ✅ | |
| Historial por dirección | ⚠️ | W8 — `GET /dispatch/visits/:id` no existe en el contrato, puede fallar con 404 |
| `GET /dispatch/history/address/:addressId` | ❌ | No implementado en `History.jsx` |

**Full edit:**

| Feature | Estado | Nota |
|---|---|---|
| Edición de cualquier campo de una visita completada | ✅ | Reusa el pricing engine de F4 |
| Edit log visible | ✅ | |

**Inventory:**

| Feature | Estado | Nota |
|---|---|---|
| Balance por técnico por item | ✅ | Lectura limpia |
| Asignar stock | ⚠️ | C7 — crítico: campo `quantity` en vez de `quantityAssigned`, falta `periodStart` por completo. La asignación de stock está rota. |
| Vista de inventario propio en PWA | ❌ | `GET /api/inventory/mine` — no implementada del lado técnico |

**Restock:**

| Feature | Estado | Nota |
|---|---|---|
| Reporte de consumo por rango de fechas | ✅ | Lectura limpia |
| Marcar como restockeado | ⚠️ | C8 — crítico: forma del body completamente distinta a lo que espera el contrato (`itemName` string vs `itemNames` array + `periodStart`/`periodEnd`). No funciona. |

---

## F7 — Pay Periods

| Feature | Estado | Nota |
|---|---|---|
| Lista de periodos con status | ✅ | |
| Detalle por técnico (gross, comisión, neto) | ✅ | |
| Sección de anomalías de precio | ⚠️ | W9 — nombres de campo incorrectos (`actual_price`/`catalog_price` vs `price`/`expectedRange`), los valores se muestran como `undefined` |
| Cerrar periodo | ✅ | |
| Marcar como pagado | ✅ | |

---

## F8 — Corrections

**Dispatch (cola de aprobación):**

| Feature | Estado | Nota |
|---|---|---|
| Bandeja de correcciones | ✅ | |
| Ver detalle con diff | ⚠️ | W10 — `GET /dispatch/corrections/:id` no existe en el contrato, con fallback razonable a los datos de la lista |
| Aprobar | ✅ | |
| Rechazar | ⚠️ | C9 — crítico: envía `note` en vez de `dispatcherNote`. La nota de rechazo nunca llega al servidor. |

*(El lado PWA de este flujo — solicitar corrección — también tiene un bug crítico compartido, C5, ya cubierto en el árbol general.)*

---

## F9 — Chat + Notifications + Transfers (lado Dispatch)

| Feature | Estado | Nota |
|---|---|---|
| Hilos de mensajes directos por técnico | ✅ | |
| Compose de broadcast | ✅ | |
| Read receipts por broadcast | ✅ | Correctamente detrás de auth dispatcher-only |
| Notificación `completion_received` | — | No auditado directamente, se asume vía sync |
| Notificación `technician_deactivated` (visitas huérfanas) | — | Depende de F10 (gestión de técnicos), que no está implementada |
| Aceptar/rechazar transferencia (vista dispatcher informativa) | ❌ | El flujo de aceptar/rechazar es responsabilidad de la PWA; del lado Dispatch solo falta la notificación informativa, que depende de F10 |

---

## F10 — Settings (Dispatch)

**Catalog editor:**

| Feature | Estado | Nota |
|---|---|---|
| Tablas editables (equipment, items, lineset configs) | ❌ | No implementado — ningún archivo llama `PATCH /api/dispatch/catalog/:table/:id` |
| Edición inline con nota de "no afecta histórico" | ❌ | |

**Technician management:**

| Feature | Estado | Nota |
|---|---|---|
| Lista de equipo (`includeInactive`) | ❌ | No implementado |
| Deactivate / Reactivate | ❌ | No implementado |
| Generate Invite Code | ❌ | No implementado |
| Revoke Access | ❌ | No implementado |

Todo F10 de Dispatch es terreno completamente sin construir — ni bugs, ni placeholders, simplemente no existe ningún archivo que lo cubra.

---

## Resumen por severidad

| Estado | Cuenta aproximada |
|---|---|
| ✅ Construido y funcionando | 17 |
| ⚠️ Construido con bug o warning | 8 |
| ❌ No implementado | 15 |
| 🚧 Hueco de diseño (spec vs. backend no coinciden) | 2 |

**Los tres huecos más grandes de Dispatch, de mayor a menor impacto en el flujo:**
1. **F2 Lobby** — no existe, y es el punto donde se asigna todo el trabajo del día.
2. **F10 completo** — gestión de técnicos y editor de catálogo, cero construido.
3. **Creación manual de llamadas (dentro de F5)** — con dos huecos de diseño en el backend que hay que resolver antes de construir el frontend.

---

*Próximo paso sugerido: elegir una sección de este mapa y pasar a mockup + instrucciones para CC.*
