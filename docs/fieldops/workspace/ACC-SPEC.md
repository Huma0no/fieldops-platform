# Accessories

**Version:** 1.0
**Date:** 2026-07-30
**Status:** Closed design — built, neomorphic style applied (some interactions deferred, see end)

## Purpose

Second step of Workspace: accessory selection, feeding the visit's running price total.

## Layout

Irregular grid of accessory tiles — order matters, since some tiles auto-activate others. Layout: UT3000 (wide) + HZ322 (tall, right) / DAPC · Ecoil Wire · eBypass / Harmony (wide) · Bypass / FIN180P · Float Switch · Dehum / Trane Harness · AprilAire · F/A · FIN6-MD / RDS · LP Kit (wide) · Other.

"Weigh-In Data" is **not** in this grid — it was a legacy item; charge for weigh-in is handled by the per-system toggle inside `/docs/fieldops/workspace/WEIGHIN-SPEC.md`.

## Companion / auto-activation rules

- **UT3000 group** — selecting UT3000 auto-activates DAPC + Ecoil Wire + eBypass, and vice versa (any one activates the whole group). All 4 remain individually toggleable.
- **HZ322 group** — selecting HZ322 auto-activates Bypass only.
- **Harmony** — standalone, no companions.
- **Zone boards** (HZ322, UT3000) are the "master" tiles — their companions are hidden by default, shown only when the zone board is active or individually needed.
- **Mutual exclusivity:** HZ322 and UT3000 groups are mutually exclusive (zone board conflict) — selecting one deselects the other and its companions.

## LP Kit

Hidden sub-options expand on selection: **Lennox 1Stg · Lennox 2Stg · Goodman**.

## Other

Custom entry, price entered per visit — see `/docs/shared/CATALOG.md` (custom-price items).

## Running total

Feeds the price shown in the Active Job banner (top-right) — not tied to any single step, since Generate Report only lives on the last step (Notes).

## Deferred (existing behavior kept as-is, not rebuilt in the latest style pass)

LP Kit inline sub-menu behavior, custom-entry row.
