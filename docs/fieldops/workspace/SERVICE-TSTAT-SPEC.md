# Service + Thermostat

**Version:** 2.0
**Date:** 2026-11-17
**Status:** Closed design — built (Workspace pass W1a). Mockup: `docs/mockups/fieldops-ws-service-tstat-mockup.html` (its "Per system ▾" list is replaced by the system switcher below).

## Purpose

First step of Workspace: the service of each system and the call's thermostats. Merged into one step (the rail shows 5 steps total, not 6).

Service and thermostat selection/quantity are durable Local Visit Draft state while the visit is active. They are submitted as part of Generate Report's complete snapshot. See `/docs/OFFLINE-FIRST-CONTRACT.md`.

## Service

- Tiles: **AC · HEAT · PRESTART**. AC and Heat combine. **Prestart is exclusive**: selecting it clears everything else on that system.
- **Finish** is always visible below the tiles. It combines with AC and/or Heat, or stands alone (a valid $0 selection for visits that only need an accessory, an adjustment, a refrigerant charge or a repair). Prestart clears it.
- **Temporarily** appears only when AC or Heat is on, and is cleared when both are off.
- **Drive Run** is a distinct button after the tiles. It is exclusive and call-wide: it replaces every service on every system; selecting any service turns it off. When something is selected, one confirmation is shown first; on confirm it clears T-stat, Accessories, Fixes, Weigh-In and the checklist. Notes and photos stay. With nothing selected it applies directly.
- Tapping a selected tile turns it off; a system may be left without a service while working. Generate Report is blocked while any system has no service (and Drive Run is off): "System N: no service selected" (single-system: "No service selected").
- Cancel is not part of the Service section — it is the job-level ✕ in the Active Job banner (see `WORKSPACE-SHELL.md`).

**Active-state color:** AC active: `--fo-blue` text + blue glow ring. Heat active: `--fo-no` text + red glow ring. Both keep the inset shadow as the base.

### Per system

- The selection is made per system. By default one selection applies to every system ("applies to all N systems").
- The **system switcher** in the Active Job banner (multi-system calls, Service step) selects one system: the banner subtitle shows "System N · outdoor model" and the tiles edit that system only. Tapping the selected system again returns to the default.
- A system edited on its own is **custom**: the switcher marks it with a dot, the section header shows "System N · custom" with a reset ↺ that returns it to the default, and in default mode the header shows "N use default · M custom".
- Each system is charged its own service (see Pricing).

### Pricing

Per system: AC, Heat, or AC & Heat **$30**; with Finish **$20**; Finish alone **$0**; Prestart **$20**. Temporarily has no price effect. Drive Run **$10** once for the call. Weigh-In-Data follows Finish per system: $10 for a system without Finish, $20 for a system with Finish (`/docs/shared/REPORT-TEXT.md`, "The one price-modifier exception"). Prices come from `catalog_services`; see `/docs/shared/CATALOG.md`.

## Report text

What each service prints, and how per-system services are grouped: `/docs/shared/REPORT-TEXT.md`.

## Thermostat

- A short scrollable picker lists the catalog thermostats. Tapping a row toggles that model (no modal). Several models may be selected on one call.
- Each selected model has its own quantity row below the picker: quick picks **1 · 2 · 3 · 4** and **+** for higher counts (no upper limit). Each model is its own report line.
- Thermostats have no price ($0).
- "+ Add new" (a model not in the catalog) remains open — see `MASTER-FUNCTION-INDEX.md`, "Add new thermostat".
