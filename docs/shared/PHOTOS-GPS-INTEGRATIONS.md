# Photos, GPS & External Integrations

**Version:** 1.0
**Date:** 2026-07-30
**Status:** Mixed — see per-section status and Open Items

## Purpose

Cross-app infrastructure: photo capture and storage, GPS/EXIF requirements, and the two external systems FieldOps/Dispatch talk to (The Company's Google Form, Google Drive). Table reference: `/docs/shared/DATA_MODEL.md` → `visit_photos`.

## Photo capture (FieldOps)

- Compressed client-side before upload — target 300kb–1MB.
- Photos captured during the visit stay local on the device as the technician works; they are bundled into one ZIP per visit only at completion time, never uploaded individually.
- Retry queue: held locally until upload succeeds, then cleared.
- Filename convention: `{address}_{tag}` or `{address}_{tag}_SYS{system_number}` when system-specific.
- `category`/`tag` are assigned automatically from the fixed button pressed (SCALE, FAN, NO_GAS_METER, NO_ELECTRIC_METER, NO_PDRAIN, BREAKERS_MISSING), or written freely via +Other.

## GPS / EXIF requirement

- Required (hard requirement) on exactly two photos per system: **Scale** (jug-after-charge) and **Fan Speed** (fan-speed-setting) — because The Company's Google Form only accepts photo uploads and needs the location embedded in-file (EXIF), not as separate metadata.
- All other photos: GPS captured if available, not required.
- Multi-system visits: N systems = N Scale/Fan Speed submissions, each disambiguated with a "– System N" suffix.
- Permission flow: requested on first load with a pre-prompt explaining why; on denial, retryable. Hard block only at Completion Report submission, not earlier in the flow.

## The Company's Google Form

- 16 of 18 fields are prefillable via URL parameters (confirmed against the form's real HTML source).
- The "Company Form" button in FieldOps is dimmed/disabled when that system's weigh-in data is incomplete, or when the record was manually edited after being captured. One link per system.

## Google Drive storage

**Status: decided, not yet built** — this section describes the design, not current behavior. Design: server-side upload only, via a Google service account. Folders organized by address name. Non-blocking on failure — the dispatcher gets an alert plus a manual-download fallback; nothing about the completion flow blocks on this. The database stores the resulting Drive link only, never a duplicate copy of the file. Retention is not automatic — files are kept roughly 60-90 days and cleaned up manually rather than through an expiration policy on the storage provider.
