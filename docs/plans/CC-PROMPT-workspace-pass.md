# CC Prompt — FieldOps · Workspace pass (+ Reports receipt, Calc)

**Mockups (add to `docs/mockups/`, they are the visual reference):**
- `fieldops-ws-service-tstat-mockup.html` — Service + T-stat (toggle 1/2/3 systems at the top)
- `fieldops-ws-acc-fix-mockup.html` — Acc + Fix with templates and the +Add sheet
- `fieldops-ws-receipt-calc-mockup.html` — Receipt (Reports view + Review before sending) and Quick Charge Calc
- `fieldops-ws-weighin-mockup.html` — Weigh-In (toggle the outdoor brand at the top)

Prices and usage counts in the mockups are sample data. Behavior and layout are the spec.

---

## 0. Ground rules

1. **Phase W0 is diagnostic only.** Map every item below to the current code and specs, list conflicts with CLOSED specs, list data you need, propose phases. **Stop and report.**
2. **Authorization:** Kristo authorizes behavior and layout changes in the CLOSED sections **Workspace** (Service/T-stat, Acc, Fix, Weigh-In, Notes/Generate Report), **Reports** (receipt view), **Calc**, and the **Catalog** equipment charge data (§3), limited to this document. Update each owning spec (SERVICE-TSTAT, ACC, FIX, WEIGHIN, CHECKLIST-NOTES, Reports, Calc) to match, and close the related WS-xx findings in QA-TRACKER.
3. Simplest implementation, surgical diffs, tests per phase, screenshots at 390 px per phase. No push without approval.
4. Before implementing quantities and "Other" accessories, **find and follow the existing docs**:
   - the document that defines which accessories multiply by the number of systems;
   - the rules for free-text accessories being Tech supplied and never entering the catalog.
   Report what they say in W0.

---

## 1. Service + T-stat (step Srv+T)

**Service**
- Tiles: **AC · HEAT · PRESTART**.
- AC and Heat combine. Turning either on reveals a tray with **Finish · Temporarily** (complements; both can be on; each adds its own price).
- **Prestart is exclusive**: selecting it clears everything else.
- **Drive Run is exclusive and call-wide**: selecting it clears every service on every system; selecting any service turns Drive Run off.
- **Multi-system calls:** the default selection applies to all systems. Per-system overrides use the shared **system switcher** (see §1b), replacing "Per system ▾": selecting system N shows its equipment and lets the tech override; overridden systems show **custom** and a reset (↺).
- **Validation:** if any system has no service (and Drive Run is off), Generate Report is blocked with "System N: no service selected".
- Cancel (✕) stays in the Active Job banner, outside Service (unchanged).

**T-stat**
- **Multiple models per call** allowed (single-model restriction removed). Short scrollable picker with **+ Add new** as the last row; tapping a row toggles it (no modal).
- Each selected model gets its own quantity row **below the picker**: quick picks 1 · 2 · 3 · 4 and **+** for higher counts (no upper limit). Each model is its own receipt line.
- Replaces the current quantity modal (WS finding).

## 1b. System switcher (shared: Service and Weigh-In)

One control for everything that is per system, so the tech learns it once.
- Segmented pill at the right of the Active Job banner: **1 · 2 · 3 · +** (Porcelain inset; active system raised). Banner subtitle shows "System N · outdoor model".
- Each system keeps its own state; switching never mixes data. Weigh-In: a green dot marks systems with the essentials filled (lineset ft, adjusted oz, liquid temp, condenser sat). Service: marks systems with **custom** service.
- Single-system calls show **1 · +** (still lets the tech add one).
- **"+" adds a system to the call** (not just to the screen). The new system:
  - asks for its outdoor equipment (catalog picker, or free text if not listed);
  - appears in Service, Weigh-In, Generate Report validation and the receipt like any other system;
  - can be removed by the tech (confirm), only if it was added by the tech.
- **Every tech change to the call's systems (added, removed, equipment modified) is reported to Dispatch** and flagged there as **"changed by tech"** (what changed, who, when). Dispatch never loses the original order data. Propose in W0 how this fits the current call/report sync and the report approval flow.

## 2. Acc + Fix (Template layout only)

- **Template layout replaces the full grid** (full grid is dropped).
- **Template content:** the technician's most-used items, from their report history — 6 in Acc, 4 in Fix. Zone-board companions don't count toward the template; they appear with their board.
- **Pinning:** in the +Add sheet each item has ★ to keep it in the template permanently ("suggested" → "yours"); **reset** returns to suggested.
- **New technician (no history):** default template defined by us (owner/seed config — propose where it lives). If empty, show the grid with only **+ Add**. Optional/later: first-run quick guide.
- **Order:** by price, high → low, regardless of selection order. Exception: companions sit right after their board.
- **Grid:** 3 columns; wide tiles span 2; dense packing so a wide tile shares its row with a normal tile.
- **Always visible regardless of template:** items pre-specified at Intake, and anything selected on this call.
- **+ Add sheet:** search, list of the full catalog with price and usage count, **Add** (this call only) and ★ (pin).
- **+ Other inside the +Add sheet** (no separate line on the screen): description + $ + ✓.
  - **Acc:** marked **TECH SUPPLIED**, never enters the catalog.
  - **Fix:** added to this report only, not tech supplied.
- **Sub-options hidden until the tile is on**, multi-select, **each sub-option charges the tile's price**:
  - LP Kit: Lennox 1Stg · Lennox 2Stg · Goodman (any number).
  - Fixed Leaks: **eCoil** · Cunit · Wall (any number).
  - **Ext. Wire:** Furnace · Cunit — at least one location required ("choose location"); the location-less catalog item is retired from selection.
- **Naming:** accessory "Ecoil Wire" → **EEV Wire**; fix "Open Ecoil" → **Open eCoil**.
- **Rules unchanged:** UT3000 group (UT3000 · DAPC · EEV Wire · eBypass auto-activate together; each can be turned off), HZ322 → Bypass, Harmony standalone, UT3000 and HZ322 mutually exclusive, companions hidden until their board is on.
- **Quantities (no upper limit):** the existing multiply-by-number-of-systems rule sets the **initial** quantity; the technician can raise or lower it freely. Selected tiles show their quantity with a minimal control (e.g. ×N badge with −/+) — propose the smallest design in W0, consistent with the T-stat quantity row.

## 3. Weigh-In (per system)

System selection uses the switcher in §1b. Defaults (manufacturer, factory length, factory charge) load from **that system's** outdoor unit.

**Lineset row (one line, low visual noise):** `Lineset ft` (number, as today) · `Manufacturer` (dropdown) · `Factory length` (dropdown).
- **Manufacturer:** Daikin · Goodman · Lennox · Trane · **+ New**. "+ New" turns the same field into a text input to type the brand (with a small ▾ to go back to the list) and shows a second compact row with **oz/ft** and **refrigerant**.
- **Factory length:** 10 · 15 · 25 · 30 ft · **+ Custom** (shows a ft input in the second row).
- **Any combination is allowed** (no validation against "real" factory configs).
- **Defaults:** manufacturer = the outdoor unit's brand; length by manufacturer — **Lennox 30 ft, Trane 15 ft**, Daikin/Goodman 15 ft.
- **Removed:** the Trane install-date preselection rule (data not confirmed) and the Factory / Revised charge selector.
- **oz/ft** comes from the manufacturer (0.6, Trane 0.47); **refrigerant** from the equipment catalog (not hard-coded).
- A small derived line shows: `oz/ft · baseline · refrigerant` and `lineset − baseline = extra ft · extra × oz/ft = Approx oz`.

**Catalog change (authorized):** the factory charge is stored **per manufacturer + length** for each outdoor model, replacing the Factory/Revised pair (existing values map to their length configs, e.g. old "revised" Trane 25 ft / Lennox 30 ft become the charge for that length). Propose the minimal data change and migration in W0.

**Charge**
- **Factory charge** auto-fills from the catalog for the selected manufacturer + length, and is **editable**; label shows "· catalog" or "· edited". If no catalog value (e.g. + New / + Custom), the field is empty for the tech to type.
- Approx Adjust oz = (lineset ft − baseline ft) × oz/ft — calculated.
- **Adjusted oz** = what the technician actually added; **starts empty**.
- **New Total Charge** = Factory + Adjusted, shown in **lb/oz and oz**.

**Readings**
- **Subcooling** = Condenser Sat − Liquid Temp (computed; currently not computed → bug).
- **SC Deviation** = Subcooling − OEM SC Goal.
- Suction Temp: recorded only. Condenser Sat: entered from the gauge (PT table deferred to the simulation layer).

## 4. Receipt — Review before sending + Reports view

One receipt component, two uses:
- **Content (one address per receipt):** header (address, subdivision, builder, date, technician); tree sections SERVICE, T-STAT, ACCESSORIES, FIX with amounts; WEIGH-IN summary per system; CHECKLIST "No" items; NOTES; **TOTAL**. Paper look with torn bottom edge.
- **Review before sending:** Generate Report opens the receipt with a **DRAFT** stamp and **Edit** / **Confirm & send**. Replaces the current thin "Review before submitting" modal.
- **Reports → View report:** the receipt slides out from behind the card (cards below move down); tapping again collapses it upward.
- **Rejection messages:** say what differs and what to do (WS-12).

## 5. Quick Charge Calc (standalone tool)

- Single screen, no mode switch: **FT1 / FT2** (cable marks) and **Total lineset ft**, separated by a subtle "or" divider.
- **Mutually exclusive:** typing Total clears FT1/FT2; typing FT1/FT2 clears Total. When using marks, Total shows the computed value as a grey placeholder ("= 55 ft").
- **Same manufacturer + factory length controls as Weigh-In** (+ New / + Custom, same defaults).
- **Breakdown** (no manufacturer name): `55 ft − 30 ft = 25 ft extra` · `25 ft × 0.6 oz/ft = 15 oz` · result **+15 oz** with refrigerant badge. If shorter than baseline: warning, nothing to add.

---

## W0 report must include
- Item-by-item map to files/specs and conflicts with CLOSED specs.
- Where usage history comes from and where templates (pinned items, default template) are stored.
- What the quantity and tech-supplied docs say.
- How tech-added / removed / modified systems reach Dispatch today (if at all) and the proposed "changed by tech" flag.
- Proposed phases (suggested: W1 System switcher + Service+T-stat · W2 Acc+Fix · W3 Weigh-In + Calc · W4 Receipt/Review/Reports), with size estimates.
