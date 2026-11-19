# Reply to W0 — Workspace pass: decisions and authorizations

Good diagnostic. Below: answers to every open point, then the go-ahead. Everything not mentioned here stays as you proposed in W0.

## Working copy
- Include the four new mockups in `docs/mockups/` and the two deleted files (`fieldops-workspace-fix.html`, `fieldops-workspace-weighin.html`) in the first docs commit.

## Authorizations (new)
- **(8a) REPORT-SNAPSHOT-CONTRACT:** authorized to change the submission comparison **together with PP-01** in this pass. It must accept per-system services, multiple T-stat models, tech-added/removed systems and quantities, and it must return **which field differs** (feeds WS-12).
- **(8b) Dispatch:** authorized **one** entry to show "changed by tech": the **report view** in Dispatch. Show what changed (system added / removed / equipment modified), who, and when, with before → after. Nothing else in Dispatch changes.

## Pricing and service rules
- **Service prices (keep the existing rule):**
  - AC alone, Heat alone, or the AC & Heat combo: **$30**.
  - With **Finish** on: **$20** (alone or combo).
  - **Temporarily has no price effect**, with or without Finish.
  - Finish and Temporarily do not add their own price. Correct the prompt's "each adds its own price".
- **Finish alone is valid, at $0.** It covers visits where only an accessory, an adjustment, a refrigerant charge or a repair is needed. It counts as a service for the "no service selected" validation.
  - **UI change vs. the mockup:** Finish is always visible below the AC · HEAT · PRESTART tiles, not only inside the AC/Heat tray. Temporarily still appears only when AC or Heat is on. Prestart and Drive Run clear Finish like everything else.
- **Finish also changes the Weigh-In accessory price: $10 → $20.** This rule is already defined in an existing doc; find it, follow it and quote it in the W1a report. With mixed systems, price Weigh-In per system: $20 for a system with Finish, $10 otherwise. If the doc says otherwise, the doc wins; report the difference. No other accessory is affected by Finish.
- **Per system:** service, Finish and Temporarily are all chosen per system, and each system is charged its own service.
- **T-stats:** no price ($0). The mockup's $15 is a placeholder.
- **Quantities:** for every item, price = **unit × quantity**. The multiply-by-number-of-systems flag only sets the **initial** quantity.
- **Drive Run:**
  - Show **one** confirmation, only when something is selected and would be cleared. With nothing selected, apply it directly.
  - On confirm, clear every other section on every system.
  - Drop the double confirmation from SERVICE-MULTISYSTEM §4.4.

## Acc + Fix
- **Multiple "Other" per visit:** allowed. Each one is its own line with its own description and price; change the one-row-per-item rule for these two items. Acc Other stays tech supplied; Fix Other does not.
- **Default template (new technician):**
  - **Acc (5):** UT3000 · HZ322 · Fin180p · Float Switch · Weight-In-Data (label "Weigh-in"), then + Add.
  - **Fix (3):** Pressure Test · Open eCoil · Leaks, then + Add.
  - With 5 and 3 items, the "6 Acc / 4 Fix" counts in the prompt apply only to history-based templates.
- **Labels only (keys and history untouched):**
  - "Ecoil Wire" → **EEV Wire**. The report text becomes just **"EEV Wire"** (replaces "Ecoil wire to furnace wired").
  - "Open Ecoil" → **Open eCoil**. Report text unchanged.
  - "Fixed Leaks" → **Leaks**. The button label only; the generated report text is unchanged.
- **Usage history, pins and default template:** go with your proposal (last 30 completed reports, offline cache, pins per technician, default template rank from the seed).
- **Sub-options:** go with your proposed parent → sub-option relation. Retire the location-less Extended Wire from selection.

## Weigh-In + Calc
- **Trane:**
  - Default length **15 ft** for every series (4TTR50, 5TTR50, 5TTR60).
  - Migrate the current Trane "factory" charge to the **15 ft** config; keep "revised" → 25 ft as you proposed.
  - 5TTR60 catalog data is not up to date: list the 5TTR60 models with missing or suspect charges in the W3 report. Kristo will supply the values; don't invent them.
- **Daikin and Goodman:** 15 ft. **Lennox:** 30 ft.
- **Data model and migration:** go with your proposal (charges per manufacturer + length, manufacturers with oz/ft and default length, new weigh-in fields, lineset config optional).
- **Dev database:** delete the ~30 brandless `LC-xxxx` configs.
- **Calc:** stays the floating panel opened from the Calc button, with the new single-screen content from the mockup; size the panel to fit it.

## Order and process
1. **First: the migrations runner (P5-1).** W1a–W3 depend on it.
2. Then W1a → W1b → W2 → W3 → W4, as you proposed.
3. Stop after each phase with tests, screenshots at 390 px and a short report. Update each owning spec and close the related WS-xx in QA-TRACKER as you go.
4. No push without approval.
