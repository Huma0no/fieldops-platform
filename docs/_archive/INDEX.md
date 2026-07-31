# INDEX — Guía general de documentación

**Propósito de este archivo:** este es el documento padre. Antes de crear un `.md` nuevo o buscar contexto sobre algo, empieza aquí. Cada documento del proyecto debe estar listado abajo; si creas uno nuevo, agrégalo a este índice en el mismo commit.

**Regla de autoridad:** cuando dos documentos entren en conflicto sobre el mismo tema, gana el que tenga fecha más reciente y esté marcado como "activo" — no el que se creó primero. Este índice señala explícitamente esos casos donde ya sabemos que hay uno viejo y uno nuevo.

---

## 1. Cómo está organizada la documentación

```
Diseño base (arquitectura, de la que todo lo demás parte)
  SYSTEM_DESIGN.md
  DATA_MODEL.md
  API_CONTRACT.md
        │
        ├── DEVELOPMENT_PLAN.md ──── DATA_PLAN.md ──── CATALOG_REVIEW.md
        │   (plan del backend)       (estrategia de       (datos reales
        │                             catálogo/seed)        a revisar antes
        │                                                    de sembrar)
        │
        └── UI_PLAN.md                                   F5-SPEC.md
            (plan del frontend,                           (spec detallada
             PWA + Dispatch,                                de F5, PDF
             fases F0-F10)                                  Intake / Call Intake)
                  │
                  ▼
            F0-F9-AUDIT.md  ← QA histórico (2026-07-01)
            (qué de UI_PLAN.md existe de verdad,
             qué tenía bugs, qué faltaba en esa fecha)
                  │
                  ├── DISPATCH_FEATURE_MAP.md
                  │   (mapa de features de Dispatch derivado del audit,
                  │    usado para planear qué construir con CC)
                  │
                  ▼
            QA-TRACKER.md  ← ESTADO REAL VIGENTE, manda sobre F0-F9-AUDIT.md
            (walkthrough de QA en curso, iniciado post-audit:
             bitácora de hallazgos por sección + backlog + cross-cutting.
             También define el protocolo del Chat de Dirección para
             decidir, ante cada hallazgo, si se resuelve en el chat
             actual, se abre un chat dedicado con CC, se anota para
             después, o se detiene el walkthrough completo)

Specs de features puntuales (no dependen del árbol anterior,
pero sí del modelo de datos):
  SERVICE-MULTISYSTEM-SPEC.md   — PWA, rediseño de Service en Workspace
  TROUBLESHOOTING-ENGINE-SPEC.md — PWA, propuesto como F11 (no confirmado
                                     que exista como archivo — mencionado
                                     en conversación, nunca subido a un chat
                                     para verificar su contenido)
  HOME-SCREEN-SPEC.md            — Dispatch, nueva pantalla Home por defecto
                                     (Lobby pasa a ser pestaña), derivado de
                                     DISPATCH_FEATURE_MAP.md
  REFRIGERANT-ALERT-SPEC.md      — Dispatch (Home), cálculo de alerta de
                                     refrigerante bajo por técnico. Se separó
                                     de HOME-SCREEN-SPEC.md al detectarse que
                                     la fuente de datos original estaba mal
                                     fundamentada. No existe como archivo aún.
  LOBBY-CALL-INTAKE-SPEC.md      — Dispatch, Lobby (hueco más grande de
                                     Dispatch, hoy placeholder) + renombre de
                                     PDF Intake a Call Intake para cubrir
                                     captura manual reutilizando el mismo
                                     mecanismo de batch. Implementado
                                     (2026-07-09) — 4 commits, ver
                                     QA-TRACKER.md para detalle de build.
```

---

## 2. Tabla de documentos

| Documento | Cubre | Estado | Notas |
|---|---|---|---|
| `SYSTEM_DESIGN.md` | Arquitectura general del sistema | Activo — base | Punto de partida de todo lo demás |
| `DATA_MODEL.md` | 27 tablas del schema | Activo — base | |
| `API_CONTRACT.md` | Contrato de endpoints | Activo — base | Fuente de verdad de qué payload espera cada endpoint. `F0-F9-AUDIT.md` lo usa como referencia para detectar mismatches |
| `DEVELOPMENT_PLAN.md` | Plan del backend, fases 0-10 | Completo — histórico | El backend ya se construyó (285 tests). Útil como referencia de cómo se pensó, no como lista de pendientes |
| `DATA_PLAN.md` | Estrategia del catálogo y seed | Activo — seed pendiente de ejecutar | Depende de `CATALOG_REVIEW.md` §6 (checklist de curación) antes de correr el seed |
| `CATALOG_REVIEW.md` | Datos crudos del catálogo para revisión humana | Pendiente de aprobación | Bloquea la ejecución del seed en `DATA_PLAN.md` |
| `UI_PLAN.md` | Plan del frontend, PWA + Dispatch, fases F0-F10 | **Superado parcialmente por `F0-F9-AUDIT.md`** | Describe la intención original. Donde el audit contradiga a este documento, gana el audit — este documento no se ha actualizado post-QA |
| `F5-SPEC.md` | Spec detallada de F5 — PDF Intake | Implementado, spec ya no es "plan" sino referencia | Confirmado limpio en el audit |
| `F0-F9-AUDIT.md` | Estado real de PWA + Dispatch tras QA (2026-07-01) | Histórico — superado por `QA-TRACKER.md` | Sigue siendo válido como referencia de qué se auditó en esa fecha, pero para "¿esto ya está construido / sigue roto?" hoy, gana `QA-TRACKER.md` |
| `DISPATCH_FEATURE_MAP.md` | Inventario de features de Dispatch por sección, derivado del audit | Activo | Generado en esta conversación (2026-07-07). Vive un nivel por encima del audit — es la versión organizada para planear, no para diagnosticar |
| `QA-TRACKER.md` | Bitácora del walkthrough de QA en curso (post-audit): estado por sección, hallazgos, cross-cutting, backlog, protocolo del Chat de Dirección | **Activo — fuente de verdad del estado actual** | Reemplaza a `F0-F9-AUDIT.md` como referencia de "¿esto ya está construido / sigue roto?". Se actualiza únicamente desde el Chat de Dirección — ningún chat de implementación lo edita directamente |
| `SERVICE-MULTISYSTEM-SPEC.md` | Rediseño del modelo de estado de Service (PWA, Workspace) | Planeado, no implementado | Sin preguntas abiertas — lista para pasar a CC cuando le toque turno (PWA) |
| `TROUBLESHOOTING-ENGINE-SPEC.md` | Motor de troubleshooting propuesto (F11) | **Sin verificar** | Mencionado en conversaciones previas como spec propuesta, pero no se ha subido ni leído en ningún chat activo. Confirmar que el archivo existe y su contenido antes de asumir que está listo |
| `HOME-SCREEN-SPEC.md` | Dispatch — nueva pantalla Home por defecto (contenido, layout, estilo), reemplaza el ruteo directo a Lobby de `UI_PLAN.md` F0 | Planeado, no implementado | Documents 4 open backend dependencies CC must diagnose before building (unassigned visit count, refrigerant threshold — now split into its own spec, see `REFRIGERANT-ALERT-SPEC.md`, — username lookup). The "+ New Call" button ships disabled on purpose — its backend architecture (single visit release, status reassignment) is a separate session's topic, not part of this spec. |
| `REFRIGERANT-ALERT-SPEC.md` | Refrigerant alert calculation per technician (aggregation logic + tank replacement event) | Does not exist yet — pending creation | Split off from `HOME-SCREEN-SPEC.md`'s refrigerant dependency once the original data-source assumption was found to be misdiagnosed. Tracked in `QA-TRACKER.md` backlog. Blocks only the refrigerant alert element on Home Screen (ships as placeholder in the meantime) |
| `LOBBY-CALL-INTAKE-SPEC.md` | Lobby (unassigned visits, assignment) + Call Intake (renamed from PDF Intake, unifies PDF and manual capture on the same batch mechanism) | Implementado (2026-07-09) — spec ya no es "plan" sino referencia | Reemplaza la sección de Lobby/creación manual de `DISPATCH_FEATURE_MAP.md`. Build: 4 commits, 319/321 tests. Detalle en `QA-TRACKER.md` |

---

## 3. Mapas visuales (no son `.md`, viven en chat)

Estos no son archivos — son diagramas generados en conversación. Si necesitas verlos de nuevo, pide que se regeneren a partir de este índice y el audit:

- **Árbol de fases por módulo** (Backend / PWA / Dispatch, 2026-07-07) — vista de alto nivel, una fila por fase.
- **Mapa navegable de features** (Dispatch y PWA, 2026-07-07) — un nivel más profundo, features dentro de cada módulo con estado individual.
- **Mockups de Home Screen** (Dispatch, 2026-07-07/08) — propuestas de interfaz aprobadas, formalizadas en `HOME-SCREEN-SPEC.md`. El mockup de "Nueva llamada" no se generó — ese botón queda deshabilitado hasta que se resuelva su arquitectura de backend en otra sesión.

---

## 4. Qué falta en este índice (honestidad, no lo estoy inventando)

- No verifiqué el contenido de `TROUBLESHOOTING-ENGINE-SPEC.md` — no ha sido compartido en ningún chat.
- No sé si existen otros `.md` fuera de los que has subido hasta ahora. Si tienes más en el repo que no hemos visto aquí, agrégalos a la tabla de la sección 2 antes de confiar en este índice como completo.
- `UI_PLAN.md` no se ha actualizado para reflejar los hallazgos del audit — este índice lo señala, pero el documento en sí sigue desactualizado hasta que alguien lo edite.
- `QA-TRACKER.md` recién se creó (2026-07-07) y todavía no cubre todas las secciones — varias siguen "No iniciado". No lo trates como inventario completo hasta que el walkthrough termine.
- `REFRIGERANT-ALERT-SPEC.md` está listado en la tabla de la sección 2 pero el archivo aún no existe — es un placeholder de tracking hasta que se abra su chat dedicado.
- `LOBBY-CALL-INTAKE-SPEC.md` ya está implementado — `DISPATCH_FEATURE_MAP.md` todavía describe Lobby y la creación manual como huecos sin construir (❌); ese documento no se ha actualizado post-build. Para "¿esto ya está construido?", gana `QA-TRACKER.md`, como siempre.

---

*Creado: 2026-07-07 · Última actualización: 2026-07-09 (build de Lobby + Call Intake completado — 4 commits, ver `QA-TRACKER.md` — `DISPATCH_FEATURE_MAP.md` queda desactualizado en su sección de Lobby/F5 manual) · Mantenlo actualizado cada vez que un documento nuevo se agregue o uno viejo cambie de estado.*