# Accessories

**Version:** 1.0
**Date:** 2026-07-30
**Status:** Closed design — built, neomorphic style applied (some interactions deferred, see end)

## Purpose

Second step of Workspace: accessory selection, feeding the visit's running price total.

## Layout

Irregular grid of accessory tiles — order matters, since some tiles auto-activate others. Layout: UT3000 (wide) + HZ322 (tall, right) / DAPC · Ecoil Wire · eBypass / Harmony (wide) · Bypass / FIN180P · Float Switch · Dehum / Trane Harness · AprilAire · F/A · FIN6-MD / RDS · LP Kit (wide) · Other.

"Weigh-In Data" is still seeded as a catalog item and still appears in this grid — an earlier version of this doc said it had been removed as legacy; that was wrong. Its relationship to the per-system toggle in `/docs/fieldops/workspace/WEIGHIN-SPEC.md` needs to be clarified (see Open Items).

## Companion / auto-activation rules

- **UT3000 group** — selecting UT3000 auto-activates DAPC + Ecoil Wire + eBypass, and vice versa (any one activates the whole group). All 4 remain individually toggleable.
- **HZ322 group** — selecting HZ322 auto-activates Bypass only.
- **Harmony** — no companions of its own, but is part of the same mutual-exclusion group as the two zone boards (see below).
- **Zone boards** (HZ322, UT3000) are the "master" tiles — their companions are hidden by default, shown only when the zone board is active or individually needed.
- **Mutual exclusivity:** HZ322, UT3000, and Harmony are a 3-way mutual exclusion, not just HZ322-vs-UT3000 — selecting any one of the three deselects the other two and their companions.

## LP Kit

Hidden sub-options expand on selection: **Lennox 1Stg · Lennox 2Stg · Goodman**.

## Other

Custom-price accessory entry requiring a short technician-entered description and a price per visit. `Other` remains a normal accessory: its catalog `tech_supplied = true` value makes it participate in the existing restock mechanism, and its persisted description identifies it in the Completion Report. See `/docs/shared/CATALOG.md` (custom-price items).

## Running total

Feeds the price shown in the Active Job banner (top-right) — not tied to any single step, since Generate Report only lives on the last step (Notes).

## Deferred (existing behavior kept as-is, not rebuilt in the latest style pass)

LP Kit inline sub-menu behavior, custom-entry row.

## Report text

What each accessory prints in the Completion Report: `/docs/shared/REPORT-TEXT.md`.

## Resolved

- "Weigh-In Data" (accessory tile, this grid) and the per-system charge toggle (`/docs/fieldops/workspace/WEIGHIN-SPEC.md`) are two different things, confirmed 2026-07-30 against the catalog seed: "Weigh-In Data" is a billable $10 accessory line (with a documented +$10 addon when Finish is active — see `/docs/shared/REPORT-TEXT.md`). The Weigh-In panel's own toggle is about whether that system has refrigerant charge data recorded at all — unrelated to this charge.
