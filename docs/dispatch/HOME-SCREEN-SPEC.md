# HOME-SCREEN-SPEC.md — Dispatch Home Screen

**Status:** Planned, not implemented — ready for CC diagnosis + build
**Scope:** Dispatch only (React + Vite + Tailwind), replaces current post-login routing
**Derived from:** Chat session 2026-07-07/08, using `INDEX.md`, `DISPATCH_FEATURE_MAP.md`, `UI_PLAN.md`, `API_CONTRACT.md`, `DATA_MODEL.md` as reference

---

## 1. Overview

Today, `UI_PLAN.md` F0 routes the dispatcher straight to Lobby after login. This changes: **Home becomes the default view after login**, and **Lobby becomes one tab among others** — no longer the landing screen.

Home's purpose: a quick daily-operations status panel. Not a launcher, not a retrospective analytics dashboard. It answers "what needs my attention right now" plus fast access to start new work. Nothing on this screen shows revenue numbers or dollar amounts.

Full section list (order matters, left to right in nav): **Home, PDF Intake, Lobby, History, Inventory, Restock, Pay Periods, Corrections, Chat, Catalog, Technicians.**

---

## 2. Content — the 5 Home elements

### 2.1 Unassigned visits (count + link)
- Displays a count of visits with no assigned technician (status `pending_review` or equivalent, unassigned).
- Clicking navigates to the Lobby tab.
- Count only — no inline list of visits on Home.
- **Dependency (open):** F2 Lobby was never built (`LobbyPlaceholder` in current code). No endpoint currently exposes a count of unassigned visits. CC must diagnose whether this data is queryable from existing tables/status values, and likely needs to add a lightweight count endpoint (e.g. `GET /api/dispatch/visits/unassigned/count`). This is separate from building Lobby itself.

### 2.2 Pending corrections (count only)
- Displays a count of corrections awaiting dispatcher approval.
- No list, no sender detail — just the number.
- **Dependency:** F8 corrections queue already works (✅ in `DISPATCH_FEATURE_MAP.md`). CC should confirm whether the existing bandeja/list endpoint can be reused for a count, or whether a dedicated count endpoint is cleaner.

### 2.3 Low refrigerant alert (per technician)
- Business rule: each technician's refrigerant tank has a standard capacity of **20oz**. When a technician's tracked consumption reaches **19–20oz** (tank is at 0–1oz remaining, "casi/totalmente vacío"), that technician triggers the alert.
- Home displays: a count of technicians currently in this state, plus (unlike the other two counters) a short identifier of who — technician name and oz consumed (e.g. "R. Delgado — 19.4oz"). This is intentional: knowing *who* is running low has more immediate value than knowing just *how many*.
- Data source: Inventory balance per technician per item, which is a clean read today (✅ in `DISPATCH_FEATURE_MAP.md`). Do NOT use the Restock "mark as restocked" endpoint — it has a known critical bug (C8, broken body shape) and is unrelated to this calculation.
- **Dependency (open):** the 19–20oz threshold rule does not exist anywhere in the current data model. CC must verify whether Inventory balance tracking has enough granularity (oz consumed per technician per refrigerant item) to compute this, or whether a threshold field/config needs to be added. This is refrigerant-only for now — no other inventory items get a threshold alert in this version.

### 2.4 Last 5 reported services
- Fixed count: exactly 5, regardless of date — not "today" or "last 24h", just the 5 most recent.
- Shows per entry: technician name, address, time. No dollar amounts.
- Data source: History (✅ clean, already built).

### 2.5 Quick actions
- **Import PDF** — direct shortcut into the existing PDF Intake flow (✅ already functional, F5). No new backend work.
- **+ New call** — shortcut into manual visit creation.
  - **This form does not exist yet and should NOT be built as part of this Home Screen work.** `DISPATCH_FEATURE_MAP.md` documents two unresolved backend design gaps blocking it:
    1. The contract has no single-visit release to Lobby — `release-to-lobby` only accepts a `batchId`, and a manually created visit doesn't belong to any batch.
    2. `PATCH /reassign` does not transition status out of `pending_review` — assigning a manually created visit to a technician would not make it appear in that technician's My Calls.
  - These two architecture questions need their own dedicated session/spec before the New Call form gets built. Do not resolve them as a side effect of this Home Screen work.
  - **Interim behavior:** the button is visible but disabled, with a tooltip reading "próximamente" (or equivalent "coming soon" copy). It should not link anywhere or throw an error on click.

---

## 3. User indicator

- Display the logged-in dispatcher's name only (no role, no logout button) in the top header area, next to the date.
- The person confirmed the deviceToken already links to a record with a name in the backend. **CC should verify the exact field/endpoint before wiring this up** — this was not independently confirmed against `API_CONTRACT.md` in this session.

---

## 4. Layout

Two-column layout, left column narrow, right column wide:

- **Left column (~240px):** "Acción requerida" block — Unassigned visits (most prominent, largest), then Pending corrections and Low refrigerant alert (no required order between these two).
- **Right column (fills remaining width):** two stacked blocks —
  - "Acciones rápidas" (Import PDF, + New call) on top
  - "Últimos 5 servicios" below

Visually distinct blocks (bordered), not one undifferentiated surface. Nav row sits above both columns, full width, showing all 11 sections (Home first) with icon + label per tab, matching the density of the current live Dispatch nav (screenshot reference: compact single row, icon left of label, ~12px text).

**Width behavior:** fluid/full-bleed. Content should use `width: 100%` / grid `fr` units rather than fixed pixel widths, so it fills whatever desktop viewport it's rendered on. No max-width cap — sizing should scale with the window. Desktop-only; no mobile/tablet layout required (matches rest of Dispatch).

**Refresh behavior:** no polling. Data loads fresh when the dispatcher navigates to or returns focus to the Home tab. This is a deliberate deviation from other parts of the system that do use polling (e.g. Lobby) — Home's counts don't need live updates while the tab is open.

---

## 5. Visual style

New design direction for Dispatch, distinct from the current dark default theme. Reference: vintage industrial radio dispatch panel — functional, blocky, high-contrast, not decorative.

- **Palette:** strictly monochrome — black, white, grays only. No color. (Open to revisiting with a limited accent color after the person sees it in use, but ship monochrome first.)
- **Typography, three-tier system:**
  - Serif (e.g. Georgia) — reserved for the masthead/brand title only ("FieldOps · Dispatch").
  - Sans-serif, compact — all UI chrome: nav tabs, section labels, button text, list text.
  - Monospace (e.g. Courier New) — reserved strictly for numbers and data: counters, timestamps, oz values. Do not use monospace for navigation or section labels — it's wider per character and doesn't fit the 11-tab nav in one row at usable sizes.
- **Structural motifs:** solid black borders (2px on major blocks, 1px on dividers), no rounded corners, no gradients/shadows, active nav tab shown as inverted (black background, light text) like an illuminated panel indicator.
- **Disabled state pattern** (used for + New call): dashed gray border, muted gray text/icon, small caption below the label — distinguishes "not yet available" from "available but low priority" at a glance.

---

## 6. Open dependencies to resolve before/during CC build

1. Endpoint for unassigned visit count (§2.1) — new, small, independent of full Lobby build.
2. Confirm Inventory balance data supports the 19–20oz refrigerant threshold calculation (§2.3), or define what's missing.
3. Confirm the deviceToken → dispatcher name lookup (§3) against `API_CONTRACT.md`.
4. + New call button ships disabled only (§2.5) — its backend architecture (single-visit release, reassign status transition) is explicitly out of scope here and needs its own session.

## 7. Visual reference

An approved mockup exists showing this spec applied — layout, monochrome vintage panel style, three-tier typography (serif masthead / sans UI chrome / monospace data), nav row with all 11 sections, and the disabled state pattern for + New call.

**File:** `HOME-SCREEN-MOCKUP.png` (English-labeled version, saved by the person from this chat session — attach it alongside this spec when starting the CC session).

Use it as the visual source of truth for spacing, borders, and typography choices described in §5 — it resolves ambiguity that prose alone can't (exact border weights, block padding, disabled-state contrast). It is a static reference image, not code — CC should still diagnose the actual component structure in the codebase before implementing, per standard workflow.

---

*This document describes behavior and intent for CC to diagnose against the actual codebase before implementing. It is not implementation-ready code.*
