# Service Multi-System — Spec funcional

**⚠ PENDING TRANSLATION TO ENGLISH — flagged 2026-07-30, content below still in Spanish.**

Estado: confirmado como el enfoque vigente (2026-07-30) — planeado, no implementado.
Alcance: PWA técnico (`frontend/pwa/src/screens/workspace.js`, sección Service) + cambios de backend requeridos (rutas, schema, pricing — el archivo/módulo exacto queda a interpretación de quien implemente).

## 1. Problema que resuelve

Hoy el estado de Service (`visit._service`) es un solo objeto plano por visita. No existe forma de representar
que distintos sistemas de una misma visita estén en estados distintos (ej. sistema 1 = AC, sistema 2 = Prestart).
El flag `twoSystems` es un vestigio que asume máximo 2 sistemas, mientras que el resto de la plataforma
(`visit_systems`, `weigh_in_data`, `visit_photos`) ya soporta N sistemas vía `system_number`.

## 2. Fuente de verdad del conteo de sistemas

`visit.systems` (ya viene en la respuesta de `GET /api/visits/:id`) es la única fuente de verdad para cuántos
sistemas tiene la visita. Ni Service ni ninguna otra sección deben derivar el conteo de un flag local
(`twoSystems` desaparece por completo).

**Nota cruzada (no se implementa en esta spec, pero queda documentado):** Weigh-in (`buildWeighInSection`,
`workspace.js` línea ~665) hoy calcula su conteo de paneles con `visit._service?.twoSystems ? 2 : 1`. Al
eliminar `twoSystems`, esa línea queda huérfana y debe migrar a `visit.systems.length` en una sesión aparte
que toque explícitamente Weigh-in.

## 3. Modelo de estado

### 3.1 Nivel visita (global — no varía por sistema)

| Campo | Tipo | Descripción |
|---|---|---|
| `cancel` | boolean | Llamada cancelada por completo. |
| `driveRun` | boolean | Cargo por visita sin acciones realizadas. Tiene precio (única diferencia funcional con `cancel`). |
| `finish` | boolean | Término interno de la compañía: visita de seguimiento. No implica que el trabajo esté completado. Aditivo — no excluyente. |

`cancel` y `driveRun` son mutuamente excluyentes entre sí y excluyentes con todo lo demás (ver sección 5).
`finish` es independiente: puede combinarse con cualquier estado de cualquier sistema, o existir solo (ej. una
visita donde solo hubo Accessories/Fixes/Weigh-in, sin ningún sistema en AC/Heat).

### 3.2 Nivel sistema (uno por cada `system_number`, 1..N)

| Campo | Tipo | Descripción |
|---|---|---|
| `ac` | boolean | AC iniciado en este sistema. |
| `heat` | boolean | Heat iniciado en este sistema. |
| `prestart` | boolean | Ni AC ni Heat funcionan en este sistema, por cualquier motivo. |
| `temporarily` | boolean | Iniciado temporalmente. Solo relevante si `ac` y/o `heat` están activos en este mismo sistema. |

### 3.3 Control "All systems" (derivado, no es un campo nuevo de estado)

No se persiste como campo propio. Es una vista maestra calculada por el cliente comparando los N estados de
sistema. El cálculo es **por campo, no global**: cada uno de los 4 campos (`ac`, `heat`, `prestart`,
`temporarily`) tiene su propio estado independiente, determinado comparando ese campo entre los N sistemas:

- **ON** — todos los sistemas coinciden en `true` para ese campo.
- **OFF** — todos los sistemas coinciden en `false` para ese campo.
- **MIXED** — hay desacuerdo entre sistemas para ese campo.

Ejemplo: si los 3 sistemas coinciden en `ac:true` y `heat:false`, pero difieren en `temporarily`, el maestro
muestra `ac` en ON, `heat` en OFF, y solo `temporarily` en MIXED — no se apagan/neutralizan los campos que sí
coinciden solo porque otro campo diverge.

Además del estado por campo, existe un **indicador único de resumen en el encabezado** de "All systems"
(independiente de las opciones): representa dos estados posibles — "todo sincronizado" (los 4 campos en ON u
OFF, ninguno en MIXED) o "hay divergencia" (al menos un campo en MIXED). La marca exacta usada para cada
estado (por ejemplo `✓` / `-`, u otra representación) es una decisión de estilo, no de este spec — lo único
que se especifica aquí es que deben existir dos estados distintos y visualmente diferenciables. Es un resumen
a nivel encabezado, no reemplaza el estado individual de cada opción.

## 4. Comportamiento de interacción

### 4.1 Exclusividad dentro de un mismo sistema

- `ac` y `heat` son combinables entre sí (un sistema puede ser AC + Heat).
- `prestart` es excluyente con `ac`/`heat` **dentro del mismo sistema**: activar `prestart` apaga `ac` y `heat`
  de ese sistema; activar `ac` o `heat` apaga `prestart` de ese sistema.
- `temporarily` solo se muestra/aplica si ese sistema tiene `ac` y/o `heat` activos. Se oculta si el sistema
  está en `prestart` o no tiene nada activo.
- Ningún estado de un sistema afecta a otro sistema directamente (la única vía de propagación entre sistemas
  es a través del control "All systems").

### 4.2 Control "All systems" — colapsado (comportamiento por defecto)

- Visible siempre, colapsado por defecto.
- Muestra el indicador de resumen del encabezado ("sincronizado" / "hay divergencia", ver 3.3).
- Muestra una fila de opciones (AC, Heat, Prestart, Temporarily condicional) donde **cada opción refleja su
  propio estado por campo** (ON / OFF / MIXED, ver 3.3) — no un valor único compartido para toda la fila.
- Tocar cualquiera de estas opciones aplica el mismo cambio a **todos** los sistemas de la visita, solo para
  ese campo (sobreescribe cualquier divergencia previa en ese campo específico — ver 4.3). No afecta el
  estado de los demás campos.

### 4.3 Control "All systems" — expandido

- Se expande/colapsa con una interacción separada sobre el encabezado (no sobre las opciones de estado).
- Al expandir, cada panel de sistema muestra **su propio estado actual** (sincronizado o divergente) — no
  hereda nada del maestro en ese momento. Si un campo estaba en MIXED, los paneles muestran los valores reales
  y distintos de cada sistema, para que el usuario vea cuál es la excepción.
- El usuario modifica cada sistema individualmente desde ahí, con las mismas reglas de 4.1.
- Al volver a colapsar: el indicador de resumen del encabezado y el estado por campo se recalculan según
  quedaron los sistemas (ver 3.3).
- Tocar una opción del maestro (fila que sigue visible arriba de los paneles individuales) en cualquier momento
  — colapsado o expandido — **siempre sobreescribe a todos los sistemas** con ese valor, solo para ese campo,
  sin importar divergencias previas. No existe una versión de "aplicar solo a los sistemas sincronizados"; el
  maestro es una acción de "fijar todos a X en este campo", no una herencia condicional. Si el panel está
  expandido, los paneles hijos se actualizan en tiempo real para reflejar ese cambio. La exclusividad de 4.1
  (ej. `prestart` apaga `ac`/`heat`) sigue aplicando en cada sistema aunque el cambio venga forzado desde el
  maestro.

### 4.4 Cancel y Drive Run (nivel visita)

- Ambos son excluyentes entre sí (activar uno apaga el otro).
- Ambos requieren el mismo flujo de confirmación (resuelto — ya no es pregunta abierta):
  1. Si hay cualquier dato modificado en cualquier sección de la visita (Service, Thermostat, Accessories,
     Fixes, Weigh-in, Checklist, items) al momento de activar Cancel o Drive Run, se pide confirmación.
  2. Tras confirmar, se muestra un segundo mensaje de advertencia explícito: la pérdida de esos datos es
     **irreversible**.
  3. Solo después de la doble confirmación se ejecuta la limpieza. No se preserva ningún dato para un
     eventual "deshacer" — se optó por esta doble confirmación en vez de mantener estado en memoria/backend
     para revertir, por ser más simple de implementar y mantener.
- Al confirmar, se ejecuta:
  - Se limpia todo el estado de Service: todos los sistemas vuelven a `{ac:false, heat:false, prestart:false, temporarily:false}`, el maestro vuelve a sincronizado (ON/OFF, sin MIXED) en ese mismo valor vacío, y `finish` se apaga.
  - Se desactivan **todas las demás secciones de la visita** (Thermostat, Accessories, Fixes, Weigh-in,
    Checklist) y sus datos se eliminan. Solo quedan disponibles Notes y Photos.
- Diferencia funcional entre ambos: `driveRun` tiene precio asociado (cargo por visita); `cancel` no.

### 4.5 Finish (nivel visita)

- Toggle independiente, sin efectos de cascada sobre otras secciones.
- No disponible mientras `cancel` o `driveRun` estén activos (la sección entera está bloqueada en ese estado).
- Combinable con cualquier combinación de estados de sistema, o sin ninguno.

## 5. Impacto de backend (a decidir en sesión de backend aparte — no se implementa aquí)

- `visit_services` hoy es un registro único por visita (`DELETE FROM visit_services WHERE visit_id=$1` +
  insert de una fila). No tiene `system_number`. No soporta este modelo tal cual.
- Recomendación a evaluar (no es decisión final): **no** mover estos campos a `visit_systems` — esa tabla
  representa inventario/equipo del cliente (modelo, refrigerante, etc.), es data histórica del equipo, no el
  estado operativo de la visita de hoy. Mezclar ambas cosas ahí conflictúa la semántica de la tabla.
  Alternativa preferida: mantener `visit_services`, agregando una columna `system_number` **nullable**:
  - Filas con `system_number IS NULL` → guardan los flags de nivel visita (`cancel`, `driveRun`, `finish`).
  - Filas con `system_number = 1..N` → guardan los campos per-system (`ac`, `heat`, `prestart`,
    `temporarily`).
  Esto evita crear una tabla nueva y no rompe la semántica de `visit_systems` como catálogo de equipo.
- El endpoint `PATCH /:id/services` necesita rediseño: hoy asume una sola fila por visita; tendría que
  aceptar `systemNumber` para las escrituras per-system, y una ruta/acción separada para `cancel`/`driveRun`/
  `finish` a nivel visita.
- `calculateVisitPrice` probablemente necesita ajuste si el pricing de `driveRun`/servicios per-system no
  coincide con la lógica actual de `multiplies_by_system_count`.

## 6. Fuera de alcance de esta spec

- Estilos, colores, tipografía, layout visual (definido por el design system de la PWA, no por esta spec).
- La corrección de la línea de Weigh-in que depende de `twoSystems` (documentada en sección 2, a resolver en
  sesión propia).
- El rediseño real de schema/endpoints de backend (sección 5 es una recomendación, no una decisión).

## 7. Preguntas abiertas

Ninguna pendiente. Las dos preguntas de la versión anterior de este spec (confirmación de Drive Run, y forma
del schema de backend) quedaron resueltas en las secciones 4.4 y 5 respectivamente. La sección 5 sigue
marcada como recomendación, no decisión final de implementación — a validar en la sesión de backend.
