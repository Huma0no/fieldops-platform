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
- Manual download (PWA Reports, the per-report Download button, 2026-11-17): JSON (the Report) · ZIP (all photos of that Report) · All (JSON + photos in one ZIP). Photos are named with the filename convention above (`{address}_{tag}[_SYS{n}].jpg`; a repeated name gets `_2`, `_3`). Upload state does not matter: a photo comes from the phone when its copy is there, otherwise from the server when online; without a connection it is listed as "needs connection". The Report JSON is built by the server, so it also needs a connection.
- The Report lists its photos; a photo still on the phone shows as pending until it arrives (`docs/architecture/REPORT-SNAPSHOT-CONTRACT.md`).
- Filename convention: `{address}_{tag}` or `{address}_{tag}_SYS{system_number}` when system-specific.
- `category`/`tag` are assigned automatically from the fixed button pressed (SCALE, FAN, NO_GAS_METER, NO_ELECTRIC_METER, NO_PDRAIN, BREAKERS_MISSING), or written freely via +Other.

## GPS / EXIF requirement

- Required (hard requirement) on exactly two photos per system: **Scale** (jug-after-charge) and **Fan Speed** (fan-speed-setting) — because The Company's Google Form only accepts photo uploads and needs the location embedded in-file (EXIF), not as separate metadata.
- All other photos: GPS captured if available, not required.
- Source of the coordinates: the photo's own EXIF GPS, read on the phone by the EXIF library bundled with the PWA (`frontend/pwa/src/vendor/exifr-lite.mjs`, exifr 7.1.3, no remote code at runtime, works offline); when the photo has none, the phone's last known location.
- Multi-system visits: N systems = N Scale/Fan Speed submissions, each disambiguated with a "– System N" suffix.
- Permission flow: requested on first load with a pre-prompt explaining why; on denial, retryable. The requirement applies to capture, but whether missing required evidence blocks terminal submission ACK is **CONTRACT OPEN** under `/docs/OFFLINE-FIRST-CONTRACT.md`; it must not prevent durable local draft/snapshot creation.

## The Company's Google Form

- 16 of 18 fields are prefillable via URL parameters (confirmed against the form's real HTML source).
- The "Company Form" button in FieldOps is dimmed/disabled when that system's weigh-in data is incomplete, or when the record was manually edited after being captured. One link per system.

## Server storage (current)

**Status: built 2026-11-17.** The server stores each photo on its local disk under `PHOTO_STORAGE_DIR` (default `data/photos/`, one folder per visit, `{photoId}.jpg`), behind a small storage interface (`put`/`read` in `src/services/photos.js`) that an object store can replace later. GPS is embedded in SCALE and FAN photos on upload. `visit_photos.stored_at` holds the storage key. Dispatch sees the photos in the Report view. Backup: a dated copy of the photos folder taken alongside the database backup (`docs/architecture/FIRST-LAUNCH-RUNBOOK.md`).

## Google Drive storage

**Status: decided earlier, not built; superseded for now by Server storage above** — this section describes the design, not current behavior. Design: server-side upload only, via a Google service account. Folders organized by address name. Upload failure is retryable and does not destroy the local evidence; final ACK policy while evidence remains pending is **CONTRACT OPEN**, and the future emergency Download Report does not mark a visit delivered. The database stores the resulting Drive link only, never a duplicate copy of the file. Retention is not automatic — files are kept roughly 60-90 days and cleaned up manually rather than through an expiration policy on the storage provider.
