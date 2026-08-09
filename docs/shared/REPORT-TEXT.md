# Report Text

**Version:** 1.0
**Date:** 2026-07-30
**Status:** Approved design (originally approved April 2026 for the legacy ACstartup app; carried forward and cross-checked against fieldops-platform's current catalog seed). **Not yet built** — the current report generator writes raw catalog values only, no templated phrase. This document is the target behavior for the report-text generator.

## Purpose

How a technician's selections (Service, Accessories, Fixes) turn into the prose that appears in the Completion Report — as opposed to the short label shown on the button/tile itself. Item pricing and combination rules live in `/docs/shared/CATALOG.md`; this document owns only the text.

## The label / report distinction

Every catalog item (Service, Accessory, Fix) has two separate strings, for two separate audiences:

| Field | Audience | Context | Characteristics |
|---|---|---|---|
| `label` | Technician, in the field | Chip/tile in the UI | Short, recognizable, technical shorthand |
| `report` | Dispatcher / Company / anyone reading the report | Completion report text | Descriptive, complete, plain language |

**Rule: never use the same string for both.** If a `label` and `report` are identical, that's technical debt to flag and correct, not a default to build toward.

## Services

| Service | Report text | Notes |
|---|---|---|
| AC | "AC started" | With Temporarily → "AC (Temporarily) started" |
| Heat | "Heat started" | With Temporarily → "Heat (Temporarily) started" |
| AC & Heat | "AC & Heat started" | Generated internally when AC + Heat are both active (catalog's `is_bundle` service) |
| Prestart | "System Prestarted" | Catalog `service_name`: "Prestart" (not "Prestart System" — see the naming bug fix in DATA_MODEL.md/API_CONTRACT.md) |
| Drive Run | "Drive Run" | System-count multiplier never applies |
| Cancel | "service canceled" | Voids all charge |
| Finish | "Finish/ [active companion]" | Modifier, not its own catalog service — see Finish rules below |

Multi-system visits append the actual system count to the report (e.g. "3 Systems") — driven by the visit's real system count, not a fixed label. See `/docs/fieldops/workspace/SERVICE-MULTISYSTEM-SPEC.md`.

### Finish rules

- Finish is a **context flag** — it does not change how the rest of the report is built, only prefixes the active companion's report string with "Finish/ ".
- Finish has no price of its own. When AC and/or Heat are active alongside it, Finish sets the service's price to a flat $20 (replacing, not adding to, AC/Heat's normal $30). Weigh-In's own $10 Finish addon (see `/docs/shared/CATALOG.md`) is a separate, independent rule.
- The Finish tile is disabled if the workspace is otherwise completely empty — Finish is never the only thing active.
- Temporarily is a valid, non-conflicting companion of Finish.

**Companion priority** — if more than one candidate is active, Finish attaches to the highest-priority one; everything else still appears in the report as its own independent line, unrelated to Finish:

| Priority | Companion | Finish's report string | Price |
|---|---|---|---|
| 1 | AC and/or Heat | "Finish/ AC started", "Finish/ Heat started", "Finish/ AC & Heat started" | $20 |
| 2 | Notes | "Finish/ [notes text]" | $0 |
| 3 | Other (an Accessory or Fix named "Other") | "Finish/ [Other's text]" | custom |
| — | Nothing active | Finish is ignored, doesn't appear in the report | — |

Fixes and Accessories other than "Other" are never Finish companions — they always appear as independent report lines.

## Accessories

Catalog item names below match `scripts/seed-catalog.sql` exactly (cross-checked 2026-07-30 — all match the originally-approved April names/prices).

| Item | Report text | Price | Notes |
|---|---|---|---|
| UT3000 | "UT3000 zone board" | $30 | Companion group: DAPC, eBypass, Ecoil Wire |
| HZ322 | "HZ322 zone board" | $30 | Companion: Bypass |
| Harmony | "Harmony zone board" | $40 | Same exclusion group as HZ322/UT3000 |
| DAPC | "DAPC" | $10 | — |
| eBypass | "Electronic Bypass Damper wired" | $10 | — |
| Bypass | "Bypass damper controller" | $5 | — |
| FIN180P | "FIN180P wired and set" | $10 | — |
| Dehum | "Dehum Box wired" | $10 | — |
| Float Switch | "Float Switch" | $5 | ×2 with 2 systems |
| Weight-In-Data | "weigh-in data" | $10 | +$10 addon when Finish is active |
| Ecoil Wire | "Ecoil wire to furnace wired" | $10 | ×2 with 2 systems |
| AprilAir | "AprilAire" | $10 | — |
| F/A | "Fresh Air damper wired" | $10 | — |
| FIN6-MD | "FIN6-MD wired" | $10 | — |
| Trane Harness | "Trane Harness wired" | $10 | ×2 with 2 systems |
| RDS | "RDS" | $10 | ×2 with 2 systems |
| LP Kit Lennox 1stg | "Lennox LP Kit 1 Stage" | $20 | Sub-option of LP Kit |
| LP Kit Lennox 2stg | "Lennox LP Kit 2 Stage" | $20 | Sub-option of LP Kit |
| LP Kit Goodman | "Goodman LP Kit" | $20 | Sub-option of LP Kit |
| Extended Wire(Furnace) | "extended wire to furnace" | $5 | Sub-option of Extended Wire |
| Extended Wire(Cunit) | "extended wire to cunit" | $5 | Sub-option of Extended Wire |
| Out of town fee | "Out of town fee" | custom | Free-entry price |
| Other | [technician's own text] | custom | Free-entry price |

**Grouping tiles** — reveal sub-options on tap; the grouping tile itself never produces its own report line, only its sub-options do:

| Grouping tile | Sub-options |
|---|---|
| LP Kit | Lennox 1Stg, Lennox 2Stg, Goodman |
| Extended Wire | Furnace, Cunit |

## Fixes

| Item (catalog `item_name`) | Report text | Price | Notes |
|---|---|---|---|
| Pressure Test | "Pressure Test" | $10 | — |
| Open Ecoil | "I had to open the ecoil to pull out the sensor wire" | $30 | — |
| Leaks Ecoil | "Fixed Leaks at Ecoil" | $20 | Sub-option of Leaks |
| Leaks Cunit | "Fixed Leaks at Cunit" | $20 | Sub-option of Leaks |
| Leaks Wall | "Fixed Leaks Inside the Wall" | $50 | Sub-option of Leaks |
| Wires Jammed | "Compressor wires jammed, fixed them to prevent electrical short" | $5 | — |
| Stuck Blower | "Fixed Stuck/Out of balance Blower" | $20 | — |
| Cut Sheetrock | "I had to cut sheetrock to locate tstat wire" | $15 | — |
| Other Fix | [technician's own text] | custom | Named "Other Fix" (not "Other") to avoid colliding with the Accessories "Other" item |

**Grouping tile** — same pattern as Accessories:

| Grouping tile | Sub-options |
|---|---|
| Leaks | Ecoil, Cunit, Inside Wall |

## The one price-modifier exception

The only case where context changes an item's price is **Weight-In-Data + Finish active → $10 base + $10 addon = $20**. Every other non-standard price case is handled via the "Other"/"Other Fix" free-entry item — there are no other context-based price modifiers.
