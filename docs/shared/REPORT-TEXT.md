# Report Text

**Version:** 1.0
**Date:** 2026-07-30
**Status:** Approved design (originally approved April 2026 for the legacy ACstartup app; carried forward and cross-checked against fieldops-platform's current catalog seed). Implemented by the canonical report generator. This document remains the target behavior for report-text composition.

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
| Finish | "Finish/ " always prints when active | Modifier, not its own catalog service — see Finish rules below |

Multi-system visits append the actual system count to the report (e.g. "3 Systems") — driven by the visit's real system count, not a fixed label. See `/docs/fieldops/workspace/SERVICE-MULTISYSTEM-SPEC.md`.

### Finish rules

- Finish is a visual flag for the dispatcher — it signals that this visit is a return to an address that had a prior, incomplete visit, not a full first-time startup. It is not a description of the work performed.
- **"Finish/ " (the word, a slash, a space) always prints when Finish is active — never skipped.** When AC and/or Heat are active, it immediately prefixes that service: "Finish/ AC started". Without AC/Heat, "Finish/ " prints as its own comma-separated marker before the remaining report content — see the 4th worked example below.
- Finish has no price of its own. Finish-only is a valid $0 Service-section selection and prints only its marker. When AC and/or Heat are active alongside it, Finish sets the service's price to a flat $20 (replacing, not adding to, AC/Heat's normal $30). Weigh-In's own $10 Finish addon (see `/docs/shared/CATALOG.md`) is a separate, independent rule — it fires whenever Finish + Weigh-In-Data are both active, regardless of whether AC/Heat is active.
- Finish may be the first and only Service-section selection; it is not an invented AC/Heat/Prestart/Drive Run charge.
- Temporarily is a valid, non-conflicting companion of Finish.

**Service companion** — AC and/or Heat is the only service companion for the Finish prefix:

| Companion | Finish's report string | Price |
|---|---|---|
| AC and/or Heat | "Finish/ AC started", "Finish/ Heat started", "Finish/ AC & Heat started" | $20 |
| No AC/Heat | "Finish/ " prints as its own marker | — |

Notes, checklist findings, accessories, and fixes always remain independent report content; none becomes a Finish companion.

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

## Full sentence format

The report line for a visit joins address, notes, service, and every priced item into one sentence:

```
[Address], [Notes if any], [Service] [equipment details] $[price], [Accessory 1] $[price], [Accessory 2] $[price], [Fix 1] $[price], total $[total]
```

**Examples:**

```
32122 Waterlily View Court, AC & Heat started 2 Ecobee tstats $60, fin180p $10, float switch $5, opened ecoil to pull out sensor wire $30, weigh-in data $20, total $125
```

```
22022 Matera Vista Lane, Finish/ AC & Heat started 1 T-6 tstat $30, fin180p $10, float switch $5, pressure test $10, weigh-in data $20, total $75
```

```
5011 Wild Bergamot, No P-Drain, AC (Temporarily) started 1 T-6 tstat $30, fin180p $10, pressure test $10, total $50
```

**Example with Finish and no AC/Heat service companion** (only Weigh-In and Pressure Test active — Finish still prints as its own marker):

```
1207 Cedar Bend, Finish/, weigh-in data $20, Pressure Test $10, total $30
```

Multi-system visits append the actual system count, not a fixed "2 Systems" label — e.g. a 3-system Prestart visit reads "System Prestarted (3 Systems) $60", never a hardcoded "(2 Systems)". Not appended at all for a single-system visit.
