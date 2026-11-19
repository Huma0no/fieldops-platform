# First-Launch Runbook

**Date:** 2026-11-15
**Scope:** Bringing up a FieldOps server and its first accounts. FieldOps is pre-production; existing data is test data.

## 1. Database

- **New database:** `npm run db:setup` applies `src/db/schema.sql` and the catalog seed, then records every migration as applied in `schema_migrations` (`schema.sql` already contains them). The script refuses to run on a database that already has visits.
- **Existing database:** `npm run db:migrate` applies the pending files of `src/db/migrations/` in filename order, each in its own transaction, and records them in `schema_migrations`. Deploys run it before starting the server.
- **Existing database without `schema_migrations`** (built before the runner): bring it up to migration 027 by hand (`npm run db:migrate025`, `026`, `027`; 025 aborts without changes if any visit has more than one completion submission, 027 removes existing sessions), then run `npm run db:migrate -- --baseline` once.
- **Adding a migration:** a new numbered file in `src/db/migrations/` without `BEGIN`/`COMMIT` (the runner wraps it), and the same change folded into `schema.sql` in the same commit.

## 2. Server environment

- `DISPATCH_BOOTSTRAP_PASSWORD`: initial password for the `Dispatcher` owner account (12–256 characters). Remove it from the environment once the account exists.
- `TRUST_PROXY`: number of reverse proxies in front of the server (for example `1` on a PaaS). Leave it empty when the server is exposed directly.
- `COMPANY_TIME_ZONE`: time zone for sessions that end at 03:00 (default `America/Chicago`). The server refuses to start with an invalid zone.
- `NODE_ENV=production` so the session cookie is `Secure` (requires HTTPS).
- Node 22.13 or later (`engines` in `package.json`; pdf.js needs it). PDF Intake OCR runs in-process and offline: `pdfjs-dist`, `@napi-rs/canvas` (prebuilt binaries, no system libraries) and `tesseract.js` with the English model from `@tesseract.js-data/eng`. No OCR service or download at runtime. A route page takes about 5–10 s.
- `PHOTO_STORAGE_DIR`: folder where photos are stored (default `data/photos/` in the app folder). It must persist across deploys (a mounted disk on a PaaS).

**Backup:** with each database backup, take a dated copy of the photos folder, for example `tar -czf photos-$(date +%F).tar.gz -C "$PHOTO_STORAGE_DIR" .` next to `fieldops-$(date +%F).sql.gz`. Restore both from the same date.

Start the server. On first start it creates the `Dispatcher` owner account (`docs/architecture/AUTHENTICATION-BOOTSTRAP.md`).

## 3. Accounts

1. Sign in to Dispatch as `Dispatcher` with the bootstrap password and set a new password when prompted.
2. In Technicians, for each person: create the account with a username and a temporary password, or provision credentials on an existing technician row.
3. Give each person their username and temporary password through a private channel.

## 4. Verify on a device

1. Open FieldOps on the technician's phone and sign in with the temporary password.
2. Set a new password when prompted.
3. Confirm My Calls loads, then sign out and sign in again with the new password.

## 5. Pilot hosting (decided 2026-11-19 — not built yet)

Decision by Kristo for the pilot (QA-TRACKER PP-02). Today the server serves only `/api`; FieldOps and Dispatch run on Vite dev servers, and nothing below exists yet. The next task builds it and replaces this section with the exact steps.

- **Server:** on Kristo's PC (API, PostgreSQL, the photos folder, and both apps served).
- **Access:** private, through Tailscale; no public exposure. The phone and the Dispatch computer join the same tailnet. FieldOps needs HTTPS on the phone (service worker for offline, camera, location).
- **Backup:** every night, a database dump plus a dated copy of the photos folder (see the Backup note in §2) into a cloud-synced folder. One restore test before the first real job.
