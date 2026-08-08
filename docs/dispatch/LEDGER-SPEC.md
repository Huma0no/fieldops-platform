# Ledger

**Version:** 1.0
**Date:** 2026-07-30
**Status:** Closed design — matches `ledger-mockup.html`. Verify against current implementation before treating as fully built (see Open Items).

## Purpose

Weekly compensation. Called "Pay Periods" in the data model (`pay_periods` / `pay_period_lines` / `pay_period_adjustments`) — "Ledger" is the product/UI name. Data model detail: `/docs/shared/DATA_MODEL.md`. Endpoints: `/docs/shared/API_CONTRACT.md` §11.

## Cycle

Monday–Sunday work week → auto-closes the following Wednesday (a scheduled job, not a dispatcher action) → The Company's check arrives Friday → technician distribution by Sunday.

States: `open` (accumulating) → `closed` (auto, totals locked) → `paid` (check received, dispatcher marks it).

## Money In

One screen: the single check for the period, covering every technician in it — "the whole of what came in." A line for deductible expenses (gas · tools · vehicle) exists but its handling is **TBD**. Taxes are shown here for visibility only — they aren't paid from this screen; only technician compensation actually leaves the system from Ledger.

## Per-technician payout

- Each technician has an individually editable **commission %** — the percentage withheld as commission, not what they keep — defaulting to 20% when added, changeable at any time. There is no single global split.
- At week close, the rate in effect is snapshotted as `commission_rate_applied` on that week's line — editing a technician's rate later never rewrites historical weeks.
- **Payout = gross × (1 − commission_rate_applied), ± that technician's own Add/Deduct lines.** Nothing else touches it. (Default 20% commission → technician nets 80% of gross.)
- **Add/Deduct:** free-form lines per technician per week (e.g. "+$78 bonus", "−$40 tool advance") — as many as needed, added directly on their row.
- **Exclude from this run:** a checkbox per technician. Unchecking removes them from this week's run without losing their data — checking it back in restores them with their numbers intact.

## Ghost Deduction — owner-only

`Ghost Deduction = Calculated (the whole period, everyone's work, the same figure behind Money In) − Actual Received (what the check for the period actually was)`.

This gap is Kristo's alone. It never touches technician payouts — those stay fixed at `gross × (1 − commission_rate_applied) ± their own lines`, regardless of this number.

## Open Items

- Deductible expenses (gas/tools/vehicle) line: shown in the mockup as TBD, no defined behavior yet.
- Confirm the auto-close-Wednesday job and the `commission_rate_applied` snapshot are both actually implemented as designed — QA-TRACKER's most recent pass predates some of these specifics.
