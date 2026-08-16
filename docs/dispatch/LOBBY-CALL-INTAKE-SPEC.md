# Lobby + Call Intake (Dispatch Panel)

**fieldops-platform · Dispatch**
**Status:** Fase 1 (contenido), Fase 2 (layout) y Fase 3 (estilo) cerradas — diseño completo, listo para build con CC
**Fecha:** 2026-07-09

---

## Overview

Diseño unificado de dos piezas que comparten arquitectura: **Call Intake** (renombre de "PDF Intake", cubre ahora ambos orígenes de llamadas — PDF y captura manual) y **Lobby** (lista de visitas sin asignar, hoy inexistente en el código). Se diseñaron juntas porque la captura manual reutiliza el mismo mecanismo de batch que ya usa PDF Intake — no requiere un release individual nuevo.

Este documento reemplaza la sección de Lobby/creación manual de `DISPATCH_FEATURE_MAP.md` como referencia de diseño. Diseño completo — listo para pasar a build con CC.

---

## Decisión arquitectónica central

La captura manual **no es un flujo nuevo** — es un segundo origen para el mismo mecanismo de batch que PDF Intake ya usa. Un batch manual puede contener 1, N llamadas y se libera con el mismo `release-to-lobby(batchId)`. Esto elimina la necesidad de un release de visita suelta (el "Gap 1" documentado en `DISPATCH_FEATURE_MAP.md`).

`create-manual` acepta `batchId` como parámetro opcional: si no se manda (primera llamada de la sesión), el backend crea el batch y lo devuelve en la respuesta; las llamadas siguientes de la misma sesión sí lo mandan.

---

## Call Intake — Fase 1: Contenido

### Ciclo de vida del batch manual

- El batch **nace con el primer `Confirm`**, no al abrir el formulario. Evita batches vacíos en la base por sesiones abandonadas antes de cargar nada.
- Arranca directo en estado `reviewing` — no hay `processing` (no hay AI de por medio).
- **Sin límite de N** — la sesión queda abierta a agregar llamadas sin restricción hasta que el dispatcher decide liberar o cerrar.
- **Persistencia fuerte**: datos capturados (form en curso + llamadas ya confirmadas) sobreviven refresh y cierre de ventana. Solo se pierden por acción explícita.

### Acciones de descarte/eliminación — tres acciones distintas

| Acción | Alcance | Cuándo aplica |
|---|---|---|
| Descartar | Solo la llamada en curso (form sin confirmar) | Antes de que exista como registro |
| Eliminar llamada individual | Un registro ya confirmado del batch | Post-confirmación |
| Eliminar batch completo | Toda la sesión | Explícito, separado de las anteriores |

### Flujo de revisión

El form de captura **es** la pantalla de revisión — no hay paso intermedio como en PDF (donde la AI extrae primero y el dispatcher revisa después). "Skip" no aplica a manual; su equivalente es "Descartar" antes de confirmar.

### Matching de dirección

- **PDF Intake:** sin cambios — mantiene `addressMatchLevel()` post-extracción y el modal de comparación (`exact`/`partial`/`none`), tal como está en `F5-SPEC.md`. Se evaluó que la AI evitara re-extraer campos de direcciones conocidas; se descartó por complejidad innecesaria frente al beneficio.
- **Captura manual:** **typeahead en vivo** — al escribir la dirección, aparecen coincidencias debajo del campo; al seleccionar una, se autopopulan los campos disponibles (subdivisión, builder) y se genera un nuevo registro de visita bajo la dirección existente. Misma lógica de backend (`normalizeAddress`), componente de UI distinto al modal de PDF.
- Ambos flujos consumen la misma utilidad de backend — solo cambia el componente de presentación.

### Formulario de captura manual — campos

Todos los campos que extrae PDF están disponibles en captura manual: `scheduledTime`, dirección, subdivisión, builder, `orderNumber`, `builderContactName`, `builderContactPhone`, `workType`, `systems[]` (indoor/outdoor/coil, multisistema soportado), termostato, accesorios, `companyNotes`.

**Tres niveles de campo:**

| Nivel | Campos | Tratamiento |
|---|---|---|
| Obligatorio | Dirección | Bloquea `Confirm` si falta |
| Recomendado | Subdivisión, Builder | Tratamiento visual distinto (color de campo/label) — opcional pero deseado para localización física |
| Opcional puro | Resto de los campos | Sin marca especial |

**Campos visibles por default:** Dirección, Subdivisión, Builder, Sistema(s), Termostato, Accesorios, Notas.

**Bloque colapsado por default** ("Detalles de la llamada" — hora, orden #, contacto builder, tipo de trabajo): detrás de un link expandible, para priorizar velocidad de captura sobre completitud inmediata.

**Sistema(s):** Sistema 1 siempre visible por default; `[+ Agregar sistema]` para adicionales.

### Selección respaldada por catálogo

Termostato y accesorios son campos respaldados por `catalog_items` en ambos modos de Call Intake:

- El dispatcher selecciona únicamente entradas existentes del catálogo; no hay opción de texto libre ni `+ Add new` para estos campos.
- Intake manual y la revisión asistida por PDF aplican la misma regla. Si la extracción de PDF no reconoce un termostato o accesorio, ese texto permanece como contexto en `companyNotes`; no se convierte en un ítem seleccionable ni crea un catálogo nuevo.
- Call Intake nunca crea, actualiza ni hace upsert de filas globales de catálogo. Cada `visit_item` debe referenciar una entrada de catálogo válida de la categoría correcta.
- El backend rechaza un nombre desconocido o de categoría incorrecta con un error de cliente controlado; no debe dejar que la FK de `visit_items` produzca un error 500.

Esta regla se limita a Termostato y Accesorios, que son campos respaldados por catálogo. No cambia el texto libre de campos cuyo spec no los define como catálogo.

El catálogo todavía no tiene un ciclo de activación/desactivación. Cuando exista, los selectores operativos excluirán las entradas desactivadas sin afectar referencias históricas.

### Lobby — tags

| Tag | Origen |
|---|---|
| Prioritario (renombrado de "Urgente") | **Manual** — checkbox en el form, criterio del dispatcher. No se deriva de `scheduledTime` ni ningún otro campo (baja frecuencia, no justifica lógica automática) |
| A2L | Derivado del catálogo de equipos (refrigerante del modelo indoor/outdoor) |
| Multisistema | Derivado — `systems.length > 1` |

### Lobby — contenido de tarjeta

Dirección + subdivisión, builder, tags, tipo de trabajo. **Hora descartada** de la tarjeta.

### Lobby — comportamiento de Assign

- Dropdown/control lista todos los técnicos activos, **orden alfabético**, sin favoritos ni orden por carga de trabajo (backlog si se vuelve necesario).
- Un click = `PATCH /reassign` inmediato, sin confirmación adicional.
- **Sin estado optimista** — la tarjeta no cambia visualmente al click. Desaparece recién en el próximo poll, consistente con el patrón ya usado en el resto de Dispatch.
- Si el `PATCH` falla, la tarjeta sigue sin cambios — manejo de error genérico, sin mensaje especial.

### Origen mixto (PDF vs. manual)

**Irrelevante** una vez que la visita está en Lobby — sin distinción visual entre orígenes.

---

## Fase 2: Layout

### Call Intake

Estructura de **dos columnas mantenida en ambos modos** (PDF y manual) — el dispatcher no reaprende la pantalla al cambiar de origen:

- **Modo PDF:** columna izquierda = PDF renderizado (referencia visual). Columna derecha = campos extraídos, editables.
- **Modo manual:** columna izquierda = lista acumulada de llamadas ya confirmadas en el batch (`+ Agregar otra llamada` / `Release to Lobby`). Columna derecha = form de captura.

La columna izquierda cumple el mismo rol conceptual en ambos modos — dar contexto sin competir con el form — cambiando solo el contenido según el origen del batch.

### Lobby

- **Grilla de 2 columnas**, no lista de una sola columna — la pantalla real es más grande que el mockup y una sola columna resulta en scroll excesivo.
- **Flujo horizontal continuo**: las tarjetas se acomodan de a pares dentro de cada grupo de subdivisión, siguiendo el flujo general de la lista (no bloques fijos separados). Un grupo con número impar de tarjetas deja la última sola en su fila; el siguiente grupo (nueva subdivisión) arranca en la fila siguiente.
- **Agrupación por Subdivisión** — no orden cronológico plano.
- **Control de Assign compacto** — botón del tamaño del texto ("Assign ▾"), no dropdown de ancho completo. Reduce la altura real de la tarjeta a la mitad frente a la primera iteración del mockup.
- Sin botón `[+ New Call]` propio en Lobby — depende exclusivamente del acceso global futuro (ver Pendientes).

---

## Fase 3: Estilo — cerrada

Aplicación directa del lenguaje visual ya establecido en el resto de Dispatch — sin desviaciones de estilo para estas pantallas: monocromo, Georgia serif solo en masthead, Courier New monospace para números/conteos, bordes negros sólidos (2px en paneles, 1px en tarjetas y divisores), sin esquinas redondeadas.

**Mockup final:** `call-intake-lobby-mockup.html` (adjunto a esta sesión). Cubre ambas pantallas:

- **Call Intake (modo manual):** columna izquierda con batch acumulado y conteo en monospace; columna derecha con el form — typeahead de dirección inline, campos "recomendado" (Subdivisión/Builder) diferenciados con borde y label en ámbar (`#BA7517` / fondo `#FAEEDA`) frente al resto en negro/gris estándar, bloque de sistemas con `+ Add system`, detalles colapsados detrás de un link de texto subrayado.
- **Lobby:** grilla de 2 columnas, agrupada por subdivisión (label en mayúsculas, gris, tracking amplio — mismo tratamiento que otros headers de sección en Dispatch), tags como chips con borde simple sin relleno, botón de Assign compacto alineado a la derecha de la tarjeta.

Sin componentes ni tokens de color nuevos — todo reutiliza la paleta ya en uso (`#EAEAE6` fondo, `#141414` texto/bordes, `#5A5A5A` texto secundario, `#F4F4F1` fondo de panel).

---

## Pendientes / fuera de alcance de este chat

| Ítem | Nota |
|---|---|
| Acceso directo a "Nueva llamada" desde cualquier sección (no solo Home) | Decisión de navegación global — pendiente #15, se lleva al Chat de Dirección para asignar sesión |
| Campo de búsqueda global | Sugerencia deseada, fuera de alcance de esta sesión — backlog |
| Drag-and-drop de tarjeta a perfil de técnico | Idea evaluada, descartada por complejidad frente a la opción simple ya decidida (control de Assign) |
| Selección múltiple + asignación batch | Idea evaluada, descartada por complejidad — requeriría contenedor de selección nuevo |
| Renombrar "PDF Intake" a "Call Intake" | **Ya decidido**, no pendiente — incluido arriba, pendiente solo de ejecución en build |

---

## Decisions log

| Decisión | Resolución |
|---|---|
| Mecanismo de batch manual | Reutiliza `release-to-lobby(batchId)` existente de PDF — sin release individual nuevo |
| Nacimiento del batch | Con el primer `Confirm`, no al abrir el form |
| Límite de llamadas por sesión | Sin límite (N abierto) |
| Persistencia de datos capturados | Fuerte — sobrevive refresh/cierre de ventana |
| Alcance de "Descartar" | Solo la llamada en curso, no el batch |
| Eliminación de llamadas/batch confirmados | Dos acciones explícitas separadas (individual / batch completo) |
| Matching de dirección — PDF | Sin cambios (modal post-extracción) |
| Matching de dirección — manual | Typeahead en vivo, mismo backend |
| Campos obligatorios en captura manual | Solo dirección |
| Origen del tag "Prioritario" | Manual (checkbox), no derivado |
| Distinción visual de origen en Lobby | Ninguna — irrelevante |
| Layout de Lobby | Grilla de 2 columnas, agrupada por subdivisión, flujo horizontal continuo |
| Botón "+ New Call" en Lobby | No tiene uno propio — depende del acceso global futuro |
| Naming | "PDF Intake" → "Call Intake" |

---

## Out of scope

- Acceso directo global a "Nueva llamada" (pendiente #15)
- Búsqueda global
- Drag-and-drop y selección múltiple en Lobby
