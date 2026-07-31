# FieldOps + Dispatch — Platform Overview

**Version:** 1.0
**Date:** 2026-07-30
**Status:** Source of truth — entry point for the entire `/docs` tree

## Purpose

This is the map of the platform. Read this first, before touching any code or any other doc. It defines what the system is, who it serves, how work flows end to end, and where to go for detail on any specific area. It intentionally does not duplicate detail that belongs elsewhere — every section below points to the doc that owns it.

This document replaces the old `SYSTEM_DESIGN.md`, which is archived at `/docs/_archive/SYSTEM_DESIGN.md` for history only.

---

## 1. Business Context

Kristo (Christian Huerta) is an independent HVAC contractor specializing in residential new-construction startups in the Houston, TX area.

**Chain of work:**

```
Builders (Constructoras)
    ↓ hire
Big-AC Company (La Compañía)
    ↓ subcontracts
Kristo (The Contractor / Dispatcher)
    ↓ coordinates
Technician collaborators
```

**Operating model:**
- The Company sends a daily PDF by email with the day's route — houses where an HVAC startup must be performed.
- Kristo, as Dispatcher, processes that PDF in **Dispatch** and distributes calls to technicians.
- Technicians execute the work in the field and report what they did, through **FieldOps**.
- Kristo consolidates and reports back to The Company.
- The Company pays Kristo by check the Friday following the worked week; Kristo pays technicians on the following distribution cycle.
- The Company supplies all equipment, accessories, and consumables — Kristo does not purchase or invest in material.

**Compensation model** (full detail: `/docs/dispatch/LEDGER-SPEC.md`):
- Each technician has an individually editable commission %, defaulting to 20% when a technician is added, adjustable at any time.
- Kristo keeps the remainder plus a marginal "Ghost Deduction" (Total Generated − Actual Received) that affects only his own income, never a technician's payout.
- Weekly cycle: Monday–Sunday → auto-closes the following Wednesday → Company check Friday → distribution to technicians by Sunday.

**Scale:**
- Today: Kristo is simultaneously Dispatcher and a Technician.
- Near future: dedicated Dispatcher role + multiple technician collaborators.
- Long-term: a sellable platform for other HVAC subcontractors.

---

## 2. Actors

**Terminology:** "Dispatch" = the administrative panel application. "Dispatcher" (lowercase) = the human role. "FieldOps" = the technician-facing app — never call it "the PWA" in conversation or docs.

| Actor | Role | Access |
|---|---|---|
| The Company (Big-AC) | Origin of all calls, supplies equipment/consumables, receives completion reports | No direct system access |
| The Dispatcher | Processes PDFs, assigns/publishes calls, monitors status, manages inventory, generates reports | Dispatch (desktop) |
| The Technician | Executes field work, records completions, manages own jobs | FieldOps (mobile) |
| The Builder | Site owner where work happens | Appears as an attribute of each call (Chesmar, Lennar, Highland, William David, etc.) — no system access |

---

## 3. System Surfaces

Two apps, one shared backend, two deliberately distinct visual languages.

### Dispatch
Administrative panel, desktop-first, Dispatcher-only access. Visual language: vintage industrial radio-dispatch — monochrome, Georgia serif masthead, Courier New for data, solid black borders, no rounded corners. Full spec: `/docs/dispatch/DESIGN-SYSTEM.md`.

Modules and their specs:
- Home → `/docs/dispatch/HOME-SCREEN-SPEC.md`
- Call Intake + Lobby → `/docs/dispatch/LOBBY-CALL-INTAKE-SPEC.md`
- History + Properties → `/docs/dispatch/HISTORY-PROPERTIES-SPEC.md`
- Reports (to The Company) → `/docs/dispatch/REPORTS-SPEC.md`
- Inventory + Restock → `/docs/dispatch/RESTOCK-INVENTORY-SPEC.md`
- Transfers (dispatcher view) → `/docs/dispatch/TRANSFER-SPEC.md`
- Technicians (roster + commission) → `/docs/dispatch/TECHNICIANS-SPEC.md`
- Ledger (compensation) → `/docs/dispatch/LEDGER-SPEC.md`
- Settings → `/docs/dispatch/SETTINGS-SPEC.md`

### FieldOps
Field tool. Mobile-first, offline-capable, full-viewport. Each technician sees only their own assigned visits. Visual language: high-key neumorphic soft-UI — one unified raised/inset surface, oxide-amber accent, Archivo + Azeret Mono type. Full spec: `/docs/fieldops/DESIGN-SYSTEM.md`. Navigation: `/docs/fieldops/NAVIGATION.md`.

Main views:
- **Lobby** — unassigned visits available to claim
- **My Calls** — visits assigned to the technician → `/docs/fieldops/MY-CALLS-SPEC.md`
- **Workspace** — execution of the active job → `/docs/fieldops/workspace/WORKSPACE-SHELL.md` (see §5 below)
- **Reports** — day's completions, share/export, and the entry point to request a correction

Standalone tools: Quick Charge Calc (`/docs/fieldops/CALC-SPEC.md`), LV/Blower reference (contextual, scoped to the active job's equipment — no general/job-less mode), Chat, Transfers (technician view), Settings (`/docs/fieldops/SETTINGS-SPEC.md`).

---

## 4. Core Entities

Full data model: `/docs/shared/DATA_MODEL.md`. Full endpoint contract: `/docs/shared/API_CONTRACT.md`. Summary:

- **Address** — a house/property; the anchor for all visit history.
- **Visit** — one service call. Carries service, systems, accessories, fixes, pricing, and status.
- **Visit System** — one HVAC system at an address (a visit can span multiple systems).
- **Transfer** — a handshake between two technicians reassigning a visit.
- **Weigh-in Data** — refrigerant charge measurements, per system.
- **Technician** — roster record, commission %, invite-code pairing.
- **Ledger** (formerly "Pay Period") — weekly compensation cycle, per-technician payout, adjustments.
- **Restock Report** — accumulated consumption per period, delivered to The Company.

---

## 5. Catalog & Pricing Logic

Single source of truth for equipment, accessories, fixes, and services: `/docs/shared/CATALOG.md`. Consumed by both apps via API — never duplicated locally beyond offline caching.

**Base services:** AC · Heat · AC & Heat · Prestart System · Cancel · Drive Run.
**Modifiers:** Finish (real pricing effect when combined with Weigh-In Data) · Temporarily (no pricing effect, just sets visit status).
**Critical rule:** Cancel = $0, invalidates charging any accessory or fix on that visit.

Workspace sub-sections that build a visit's price: Service+Tstat, Accessories, Fixes, Weigh-In. Specs: `/docs/fieldops/workspace/`.

---

## 6. End-to-End Workflow

```
1. PDF arrives by email from The Company
        ↓
2. Dispatcher uploads PDF to Dispatch — AI extracts fields (editable) → Confirm → Visits created
        ↓
3. Visits published to the Lobby (tags: priority · A2L · multi-system)
        ↓
4. Dispatcher assigns directly, OR technician self-assigns from Lobby — both coexist
        ↓
5. Technician works the job in FieldOps
   My Calls → Start Report → Workspace (Service/Tstat → Acc → Fix → Weigh-In → Notes+Checklist)
   [Exception: technician transfers the visit to another technician — handshake, Dispatch notified]
        ↓
6. Technician generates the Completion Report
        ↓
7. Dispatch receives it
   History: permanent record per address
   Inventory: consumption deducted per technician
   Restock: accumulated consumption
   Ledger: technician's gross updated
        ↓
8. [If needed] Technician requests a correction from FieldOps Reports, any time before week close
   → Dispatcher applies it in Dispatch (see /docs/shared/CORRECTIONS.md)
        ↓
9. Dispatcher generates the formal report to The Company (includes order number + photos)
        ↓
10. Ledger closes (Wed following the worked week) → Company check (Fri) → technician payouts (by Sun)
```

---

## 7. Technical Architecture — Principles

Full detail: `/docs/shared/API_CONTRACT.md`, `/docs/shared/DATA_MODEL.md`.

- **Offline-first:** FieldOps works fully without connection; syncs when reconnected. Polling, not WebSockets.
- **Shared server:** one backend (Node/Express + PostgreSQL) serves both apps — single source of truth.
- **Catalogs as single source:** live on the server, consumed by both apps via API.
- **Multi-technician by design:** every entity carries a `technicianId` — the system never assumes a single user.
- **Financial privacy:** compensation data visible only to the Dispatcher; a technician sees only their own totals.
- **Photos/GPS/integrations:** `/docs/shared/PHOTOS-GPS-INTEGRATIONS.md` (EXIF GPS requirements, Company Google Form prefill, Google Drive storage).

---

## 8. Explicitly Out of Scope

See `/docs/OUT-OF-SCOPE.md` for the full list and reasoning. Summary: Troubleshooting Engine, in-field manuals, and voice-to-report were considered and deliberately cut from the initial build — not gaps, decisions.

---

## 9. Document Map

| I need... | Go to |
|---|---|
| How the whole system fits together | this document |
| Data model / API contract | `/docs/shared/` |
| Catalog, Ledger, or Corrections rules | `/docs/shared/` |
| A Dispatch screen spec | `/docs/dispatch/` |
| A FieldOps screen or Workspace step spec | `/docs/fieldops/` |
| What's built vs. pending right now | `/docs/status/QA-TRACKER.md` |
| Why something was decided a certain way, historically | `/docs/_archive/` |
| What was deliberately not built | `/docs/OUT-OF-SCOPE.md` |
