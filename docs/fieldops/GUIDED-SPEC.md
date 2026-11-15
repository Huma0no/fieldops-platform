# Guided

**Version:** 0.1
**Date:** 2026-11-15
**Status:** In progress — Phase 2 (Guided mode) on top of Phase 1 (data, drawing, Explore, standalone page)

## Purpose

Guided walks a technician through wiring an install using **one interactive, data-driven diagram**. Each Guided step pans and zooms the same drawing and highlights only that step's wires. The same drawing has an **Explore** mode for terminal-level reference (function, expected value, source).

Guided runs inside FieldOps (receives the call's equipment) and as its own public page (open access, no login, no FieldOps backend; the user picks the setup manually). Both come from one codebase in `frontend/guided/`.

## Pilot scope

- EWC **UT3000** zone control, **fully communicating** systems only, **install** stage.
- Equipment: Daikin One Touch thermostats · Daikin DR96TC two-stage furnace · Daikin CHPEA CAPE coil · Daikin DC6VS outdoor · EWC SAS · dedicated 40–60 VA transformer.
- Optional add-on: EWC **DAPC** static-pressure controller + EWC **SBD2** smart bypass.
- Out of scope now: Training, Diagnose mode, non-communicating UT3000 configurations, other zone boards (HZ322, Harmony), authoring UI in Dispatch, completion of the damper ficha.

All diagrams are drawn in-house from data. Manufacturer diagrams are never embedded.

## Data (source of truth)

All data lives in `frontend/guided/data/` and is read at load. UI code contains no terminal, part, LED or wiring facts. Each file is the single copy; nothing under `docs/` duplicates it.

| File | Content |
|---|---|
| `frontend/guided/data/guided-component-library.v0.1.json` | Component library (fichas): terminals (`fn`, `desc`, `exp`, `alt?`, `src`), UT3000 `blocks`, `parts`, `leds`, `spec`, `status`, extras. |
| `frontend/guided/data/ut3000-comm.system.json` | One system: board block instances, devices, wires/tubes with their conditions, and the layout order of the drawing. |
| `frontend/guided/data/ut3000-comm.guide.json` | The install guide for that system: requirements, system-map warning, and the step list (see Guided mode). |

Rules:
- Every fact shown comes from the data and is shown with its `src`. A source starting with "Not in manual" renders with a warning style.
- Terminal draw order comes from the system file, never from JSON key order.
- A component with `status: "pending"` is tagged as pending wherever its ficha appears.
- UT3000 dip switch #3 (termination) is drawn neutral.
- The component library is not merged into the Catalog tables in v1.

## Context

The module receives a plain context object and never calls the FieldOps API or IndexedDB itself:

```
{ zones: 1–3, dapc: boolean, equipment?: { board, thermostat }, models?: { indoor, outdoor, coil } }
```

- **Zones** — prefilled from the call's thermostat quantity, capped at 3; the technician can change it with one tap (1 · 2 · 3). Quantity above 3 shows a note that 4–5 zones (twinning) is not covered. Thermostat quantity belongs to the call, not to a system, so the count stays editable.
- **DAPC** — present when the DAPC accessory is selected on the call (UT3000 auto-activates it per `workspace/ACC-SPEC.md`; a technician who deselects it gets the non-DAPC guide).
- **Availability** — each guide declares its required equipment as data (`requires`, e.g. `{ board: ["UT3000"], thermostat: ["Daikin One"] }`). Guided offers only guides whose requirements match the call's `equipment`; with no `equipment` (standalone) the guide is offered. Pilot: the UT3000 · communicating guide requires UT3000 and Daikin One thermostats. UT3000 with another thermostat shows "Guide not available yet for this combination"; component fichas stay available.
- **No context (standalone)** — the page opens on a setup picker: system (pilot: UT3000 · communicating), zone count and DAPC on/off.

Zones not on the call: their blocks, devices and wires dim to ~6% and are not tappable; their Guided steps are skipped.

## Drawing

- Data-driven SVG, portrait-first (360–390 px wide), landscape adapts. Orientation is never forced.
- Board in the center column; terminal blocks down its left and right edges in the order defined by the system file. DAPC sections sit in a middle column between board and devices (only when DAPC is present); external devices in the outer columns.
- Wires are drawn orthogonally in their real colors with a dark outline so light colors stay legible. Pressure tubes are a separate connection type, drawn as a thick gray tube.
- Blocks used only by non-communicating setups (conventional zone inputs, conventional system output, OAS) and the DAPC DATA terminal are drawn dimmed, labeled "Not used in communicating setup".
- The camera animates the SVG `viewBox`. Framing fits the bounding box of the target elements; nothing requires pinch-zoom.
- Back to the full view: ⤢ button or double tap.

## Explore

- Overview shows all devices with wires faint in their real colors.
- Tap a block or device → frame the block plus its connected devices, light its wires, fade the rest.
- Tap a terminal → sheet with function, description, expected value (+ alternate), where each wire goes, and source.
- Device ficha, board parts, LEDs, buttons and the Fichas list: Phase 3.

## Guided mode

The guide is data; a new guide needs no UI code. Each step has:

| Field | Meaning |
|---|---|
| `id`, `title` | Step id and EN/ES title. |
| `frame` | Node ids the camera frames (block + devices, the three elements of a DAPC damper chain, or a tight transformer-area group). This list *is* the framing mode. |
| `wires` | Wire filter: `"a~b"` pairs; every wire between nodes `a` and `b` is lit, the rest of the frame is dimmed. |
| `when` | Option condition, e.g. `{ "dapc": true }`. Also allowed on single notes and facts. |
| `cable`, `notes[]` | EN/ES text; a note with `warn: true` renders as a warning. |
| `facts[]` | `{ ref, label }`: `ref` is a path into the component library (`"sbd2.autoSetup.steps"`), shown with its library `src`. Values are never retyped in the guide. |

Steps inside a `perZone` entry repeat for zones 1..N of the call with `{n}` replaced; zones not on the call get no steps. Step 0 is the system map and is not counted. Counts: 3 zones → 9 steps without DAPC, 17 with DAPC (2 zones → 7 / 14; 1 zone → 5 / 11).

UI:
- Header: two-line setup chip (zones · DAPC / system), Guided | Explore selector, language button (standalone). Guided is the default mode; when the guide is not available for the call, Guided shows "Guide not available yet for this combination" and Explore stays one tap away.
- Step 0 (system map): full drawing, every group that has a step outlined; tapping one jumps to its step. The power-off warning is shown open. Portrait only: a dismissible "Better view in landscape" hint.
- Bottom bar: progress dots, ‹ · step title + "Step N of M" · ›. Step details (cable, notes, facts) are collapsed; tapping the title opens them. Tapping a terminal inside the step lights its wire and shows its detail.
- ⤢ or double tap returns to the map. Rotation re-fits the current step; on short landscape screens the sheet moves to a side column.
- A thermostat count above the board's zone limit shows a note that 4–5 zones (twinning) are not covered.

## Language

- EN/ES. UI strings go through `frontend/shared/i18n.js` (shared string library). The standalone page offers its own toggle; inside FieldOps the module reads the global setting (setting UI: Phase 4).
- Guide content is authored per step in EN and ES. Component library text is EN in v0.1.

## FieldOps integration (Phase 4, after the WIP merge)

- Bottom bar becomes 5 icons: Home · Menu · Chat · Guided · Calc, with expandable labels. Home groups Lobby, My Calls and Reports as header tabs. Details are specified in `NAVIGATION.md` in that phase.
- Workspace: no bar; two floating buttons bottom-right (Calc lowest, Guided above) with 60 px extra bottom padding so Next is never covered.
- Context: the last expanded My Calls card or the open Workspace; otherwise a picker of today's calls plus "None" (standalone).
- Offline: the module's files are precached by the FieldOps service worker.

## Open items

- Damper (Ultra-Zone actuator) manual missing → damper ficha `pending`.
- SBD2 field check: installed units may never have run Auto Setup (yellow LED blinking).
- Coil manual lists BIAS 2.8 / 2.2 generically; the library uses the UT3000 manual's 2.3 / 1.7 for CAPE + 2-stage.
- Multiple dampers per zone (up to 3) and their numbering.
- Hosting of the public page: decided in Phase 5; default proposal is a separate Netlify site for the standalone Guided build.
