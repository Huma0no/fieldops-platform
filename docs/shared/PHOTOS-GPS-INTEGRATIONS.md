# Photos, GPS & External Integrations

**Version:** 1.0
**Date:** 2026-07-30
**Status:** Mixed — see per-section status and Open Items

## Purpose

Cross-app infrastructure: photo capture and storage, GPS/EXIF requirements, and the two external systems FieldOps/Dispatch talk to (The Company's Google Form, Google Drive). Table reference: `/docs/shared/DATA_MODEL.md` → `visit_photos`.

## Photo capture (FieldOps)

- Compressed client-side after local capture and before upload — target 300kb–1MB.
- Photos captured during the visit are durable local evidence while the technician works: each one is saved on the phone (IndexedDB) the moment it is taken, with its evidence reference in the Local Visit Draft. They survive FieldOps close/reopen and connectivity loss.
- Upload (decided 2026-11-17, replaces the earlier one-ZIP-per-visit design): each photo uploads on its own whenever the server is reachable — on app start, on reconnect, right after capture, and every minute while photos are waiting and the device is online — before or after its Report. The phone's photo id makes a retried upload store the photo once. A photo is marked sent only after the server stored it, and its local copy stays on the phone 7 more days (offline download), then is deleted; a rejected photo stays on the phone (no UI for it yet, QA-TRACKER P-04).
- Manual download (PWA Reports, the per-report Download button, 2026-11-17): JSON (the Report) · ZIP (all photos of that Report) · All (JSON + photos in one ZIP). Photos are named with the filename convention above (`{address}_{tag}[_SYS{n}].jpg`; a repeated name gets `_2`, `_3`). A photo comes from the phone when its copy is there, otherwise from the server when online; without a connection it is listed as "needs connection". **Exception — SCALE and FAN (CC-17, 2026-11-19):** always the server copy, the only one with GPS embedded (the phone keeps a compressed copy without EXIF); offline they are listed as "needs connection", and before their upload as "still uploading". The phone copy is never substituted. The JSON is the server's Report (`source: "server"`, with the report text and any PP-01 price corrections) when the Report was delivered and the server answers; otherwise the snapshot the phone built (`source: "local, unconfirmed by server"`), so JSON and All also work offline and for Reports still pending (their cards also have Download).
- The Report lists its photos; a photo still on the phone shows as pending until it arrives (`docs/architecture/REPORT-SNAPSHOT-CONTRACT.md`).
- Filename convention: `{address}_{tag}` or `{address}_{tag}_SYS{system_number}` when system-specific.
- `category`/`tag` are assigned automatically from the fixed button pressed (SCALE, FAN, NO_GAS_METER, NO_ELECTRIC_METER, NO_PDRAIN, BREAKERS_MISSING), or written freely via +Other.

## GPS / EXIF requirement

- Required (hard requirement) on exactly two photos per system: **Scale** (jug-after-charge) and **Fan Speed** (fan-speed-setting) — because The Company's Google Form only accepts photo uploads and needs the location embedded in-file (EXIF), not as separate metadata.
- **Never blocks (Kristo, 2026-11-17):** the GPS comes from the photo's EXIF, else the phone's location; with neither, the photo is kept and the Report carries a "photo without location" warning (`/docs/fieldops/workspace/WEIGHIN-SPEC.md`). Before this, a SCALE/FAN photo taken with no EXIF GPS and no stored phone location disabled Confirm & send until the Workspace was reopened.
- All other photos: no GPS needed.
- Source of the coordinates: the photo's own EXIF GPS, read on the phone by the EXIF library bundled with the PWA (`frontend/pwa/src/vendor/exifr-lite.mjs`, exifr 7.1.3, no remote code at runtime, works offline); when the photo has none, the phone's last known location.
- Multi-system visits: N systems = N Scale/Fan Speed submissions, each disambiguated with a "– System N" suffix.
- Permission flow: requested on first load with a pre-prompt explaining why; on denial, retryable. Missing required evidence never blocks submission or its ACK (Kristo, 2026-11-17; see "Never blocks" above).

## The Company's Google Form

**Status: specified 2026-11-20 (PP-03); rules decided by Kristo.** Form: "Refrigerant Charge Weigh-In Data", `https://docs.google.com/forms/d/e/1FAIpQLSfUeFILu20Amgas2beSG5wd2ZJfW7sEgvPKUy4BJFjd3sbHLg/viewform`. One page, 18 fields: 16 prefillable, 2 file uploads. Read from a page Kristo saved on 2026-11-19 (kept out of git: it holds the signed-in account). The form requires a Google sign-in and records the submitter's name, email and photo, so the phone's browser must be signed in to the Google account that can open it.

**Prefilled link:** `…/viewform?usp=pp_url&entry.<ID>=<value>&…`, every value URL-encoded (`encodeURIComponent`).

| # | Form field | Entry ID | Type | Value |
|---|---|---|---|---|
| 1 | Address: | 1124000801 | text, required | Visit address street; with more than one system on the visit, followed by " – System N" |
| 2 | HVAC Contractor Company Name: | 284031722 | dropdown, required | Constant "Big Tex Air Conditioning" |
| 3 | Length of lineset. | 37391195 | text, required | Weigh-In `linesetLength` |
| 4 | Factory supplied liquid line length. | 1317202447 | dropdown, required (only option "15 ft.") | Constant "15 ft.", whatever the real factory length; FieldOps lengths and calculations are unchanged |
| 5 | Weight of factory supplied refrigerant (oz) | 961493071 | text, required | `factoryChargeOz` |
| 6 | Diameter of liquid line. | 1678145086 | dropdown, required | Constant "3/8" |
| 7 | Approx weight of refrigerant to add/remove (oz) | 799811941 | text, required | `approxAdjustOz` |
| 8 | Weight of refrigerant added/removed (oz) | 1078120223 | text, required | `adjustedOz` |
| 9 | Photos of jug after system charge. | — | file upload, required | Technician uploads the SCALE photo on the form (Reports download carries GPS) |
| 10 | Photos of fan speed setting. | — | file upload, required | Technician uploads the FAN photo on the form |
| 11 | Fan speed setting (CFM) | 1404438998 | text, required | `fanSpeedCfm` |
| 12 | Liquid line temp. (*F) | 1295748710 | text, required | `liquidLineTemp` |
| 13 | Suction line temp. (*F) | 183118902 | text, required | `suctionLineTemp` |
| 14 | Condenser saturation temp. (*F) | 565216059 | text, required | `condenserSatTemp` |
| 15 | Subcooling value (*F) | 119493154 | text, required | `subcoolingValue` |
| 16 | OEM subcooling goal (*F) | 375059625 | text, required | `oemSubcoolingGoal` |
| 17 | Subcooling deviation (*F) | 1208255497 | text, required | `subcoolingDeviation` |
| 18 | Test holes | 197292571 | checkboxes, optional (Return, Supply) | Technician completes on the form; not prefilled |

**Rules (Kristo, 2026-11-20):**
- **Numbers:** plain, no units, ASCII "-" for negatives, at most one decimal (e.g. `15`, `-2.4`).
- **One link per system** of the visit, from that system's Weigh-In reading.
- **Always opens (FT-05, Kristo 2026-11-23; replaces the earlier rule that disabled the link until all 11 required numbers had a value):** values that exist are prefilled; missing ones, including the address, are left empty for the technician to complete on the form. The system's entry names what is missing. A visit without Weigh-In (Prestart, Drive Run) gets the address and the constants only. The "edited after capture" rule stays **deferred** (second round).
- **Location:** FieldOps Reports, on each delivered (Sent) visit card, a **Company form** button next to Download; it lists the visit's systems, one link each. Values come from the server's Report when loaded, otherwise the snapshot on the phone.
- **Opens in a new tab.**
- **Deferred to the second round (FT-05, Kristo 2026-11-23):**
  - On return to the FieldOps or Dispatch window after opening the form, ask "Was the form sent?".
  - Yes marks it sent, with the date. It never locks: the form can be opened and sent again.
  - Record each use (who, when, which visit and system).
  - A Company form entry point in Dispatch.
  - Open questions for that design: per system or per visit; whether both Dispatch and the technician can mark it sent; where "sent" is shown; marking it while offline.

## Server storage (current)

**Status: built 2026-11-17.** The server stores each photo on its local disk under `PHOTO_STORAGE_DIR` (default `data/photos/`, one folder per visit, `{photoId}.jpg`), behind a small storage interface (`put`/`read` in `src/services/photos.js`) that an object store can replace later. GPS is embedded in SCALE and FAN photos on upload. `visit_photos.stored_at` holds the storage key. Dispatch sees the photos in the Report view. Backup: a dated copy of the photos folder taken alongside the database backup (`docs/architecture/FIRST-LAUNCH-RUNBOOK.md`).

## Google Drive storage

**Status: decided earlier, not built; superseded for now by Server storage above** — this section describes the design, not current behavior. Design: server-side upload only, via a Google service account. Folders organized by address name. Upload failure is retryable and does not destroy the local evidence; final ACK policy while evidence remains pending is **CONTRACT OPEN**, and the future emergency Download Report does not mark a visit delivered. The database stores the resulting Drive link only, never a duplicate copy of the file. Retention is not automatic — files are kept roughly 60-90 days and cleaned up manually rather than through an expiration policy on the storage provider.
