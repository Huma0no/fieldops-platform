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

## 5. Pilot hosting on Kristo's Mac

Decided 2026-11-19 (QA-TRACKER PP-02). **Status: installed 2026-11-23** at commit `38282c2`; health check over HTTPS, a manual backup to Google Drive and the test restore passed. **[Kristo]** marks steps that need Kristo's hands (installs, sign-ins, passwords, the phone).

**macOS 12 (Monterey) host.** The Mac is a MacBook Air 7,2 and cannot go past macOS 12.7.6, which gets no security updates. Current Tailscale (1.104 and later) and Google Drive for desktop (134 and later) require macOS 13. The pilot runs on the last versions that support Monterey (Tailscale 1.102.4, Drive 126.0) as a trial; decline their update offers. Risk: none of the three gets security fixes, and Google may stop syncing the old Drive client, so check the backup daily on drive.google.com (§5.6). Kristo accepted this on 2026-11-23; a Windows 11 PC was also too old. Any secrets (DB password, bootstrap password) are typed by Kristo, never pasted into an agent chat.

**Layout.** One server, one origin, tailnet only:
- `https://<mac>.<tailnet>.ts.net/` — FieldOps (served as-is from `frontend/pwa`), `/api/…` — the API, `/dispatch/` — Dispatch (its Vite build).
- Tailscale Serve terminates HTTPS with the tailnet certificate and forwards to the server on `127.0.0.1:3100`. Funnel stays off: nothing is reachable from the internet, and `HOST=127.0.0.1` keeps the port off the local network.
- The pilot has its own database (`fieldops_pilot`), photos folder and code checkout under `~/fieldops-pilot/`. Dev keeps its ports (3001, 5173, 5174) and its database.
- The checkout lives outside `~/Documents`, which macOS protects from background services.

### 5.1 Code checkout
1. From the dev repo, add a detached worktree of the approved commit: `git -C ~/Documents/fieldops-platform worktree add --detach ~/fieldops-pilot/app <commit>`.
2. `cd ~/fieldops-pilot/app && npm ci && npm --prefix frontend/dispatch ci && npm run build:dispatch`.
3. `mkdir -p ~/fieldops-pilot/photos ~/fieldops-pilot/logs`.

### 5.2 Pilot database (PostgreSQL 18, already installed at `/Library/PostgreSQL/18`)
1. **[Kristo]** Choose the database password source: the existing `postgres` user (its password goes into the files below) or a new role `fieldops_pilot` (recommended: `CREATE ROLE fieldops_pilot LOGIN PASSWORD '…'`).
2. Create the database: `psql -U postgres -c "CREATE DATABASE fieldops_pilot OWNER fieldops_pilot"` (with the `postgres` user: `OWNER postgres`; the 2026-11-23 install uses `postgres`).
3. Write `~/fieldops-pilot/app/.env` (`chmod 600`; the server reads it at start):
   ```
   DATABASE_URL=postgresql://fieldops_pilot:<password>@localhost:5432/fieldops_pilot
   PORT=3100
   HOST=127.0.0.1
   NODE_ENV=production
   TRUST_PROXY=1
   COMPANY_TIME_ZONE=America/Chicago
   PHOTO_STORAGE_DIR=/Users/chrismaldo/fieldops-pilot/photos
   DISPATCH_BOOTSTRAP_PASSWORD=<12+ characters; remove after first sign-in>
   ```
4. `cd ~/fieldops-pilot/app && npm run db:setup` (schema + catalog seed; records all migrations).

### 5.3 Server at login, restarted on crash (launchd)
1. Create `~/Library/LaunchAgents/com.fieldops.pilot.plist`:
   ```xml
   <?xml version="1.0" encoding="UTF-8"?>
   <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
   <plist version="1.0"><dict>
     <key>Label</key><string>com.fieldops.pilot</string>
     <key>ProgramArguments</key><array><string>/usr/local/bin/node</string><string>src/index.js</string></array>
     <key>WorkingDirectory</key><string>/Users/chrismaldo/fieldops-pilot/app</string>
     <key>RunAtLoad</key><true/>
     <key>KeepAlive</key><true/>
     <key>ThrottleInterval</key><integer>10</integer>
     <key>StandardOutPath</key><string>/Users/chrismaldo/fieldops-pilot/logs/server.log</string>
     <key>StandardErrorPath</key><string>/Users/chrismaldo/fieldops-pilot/logs/server-error.log</string>
   </dict></plist>
   ```
2. `launchctl load -w ~/Library/LaunchAgents/com.fieldops.pilot.plist`, then `curl -s http://127.0.0.1:3100/api/health` → `{"status":"ok","db":"connected"}`. Confirm with `launchctl list | grep fieldops` that the service is loaded (a first attempt by hand did not load it and left no logs).
3. Restart after an update: `launchctl kickstart -k gui/$(id -u)/com.fieldops.pilot`.
4. LaunchAgents run while Kristo is logged in. After a reboot, log in (FileVault prevents automatic login).

### 5.4 Tailscale and HTTPS
1. **[Kristo]** Install Tailscale for macOS and sign in. On macOS 12 use `https://pkgs.tailscale.com/stable/Tailscale-1.102.4-macos.pkg` (needs macOS 12.4; notarized), not the download page, which offers 1.104+ (macOS 13+).
2. **[Kristo]** In the Tailscale admin console → DNS: enable **MagicDNS** and **HTTPS Certificates**.
3. Serve the pilot over HTTPS on the tailnet only: `/Applications/Tailscale.app/Contents/MacOS/Tailscale serve --bg 3100`. Check with `… serve status`; it prints `https://<mac>.<tailnet>.ts.net`. Do **not** run `funnel`.
4. Do step 5 first: the phone needs a technician account, which Dispatch creates (§3). After the Dispatcher's first sign-in, delete the `DISPATCH_BOOTSTRAP_PASSWORD` line from `.env` and restart (§5.3 step 3).
   **[Kristo]** Phone: install the Tailscale app, sign in to the same tailnet, open `https://<mac>.<tailnet>.ts.net/` in Chrome, sign in to FieldOps, and add it to the home screen. Then turn on airplane mode once and confirm FieldOps still opens (offline shell).
5. Dispatch on the Mac: `https://<mac>.<tailnet>.ts.net/dispatch/`. FieldOps and Dispatch share one origin, so in the same browser they share the sign-in cookie: use Dispatch on the Mac and FieldOps on the phone.

### 5.5 Keep the Mac awake during work
1. **[Kristo]** Keep the MacBook Air plugged in with the lid open.
2. **[Kristo]** `sudo pmset -c sleep 0 disksleep 0 displaysleep 15` (on power: never sleeps; the display may).
3. System Preferences → Battery → Power Adapter (macOS 12 laptops; "Energy Saver" on desktops): tick "Prevent your Mac from automatically sleeping when the display is off". Step 2 already ticks it; check it. Before step 2 the Mac slept after 1 minute on power.

### 5.6 Nightly backup to Google Drive (14 days)
1. **[Kristo]** Install **Google Drive for desktop** (google.com/drive/download) and sign in. The current installer (134.0.1) refuses macOS 12, and Google offers no older installer; this Mac already had Drive 126.0 (needs macOS 12.1), signed in to the account that receives the backups. Decline update offers.
2. **[Kristo]** Find the Drive folder on disk: `ls ~/Library/CloudStorage` (current versions: `GoogleDrive-<account>/My Drive`); older versions mount `/Volumes/GoogleDrive/My Drive`. Create `FieldOps-backups` inside it. Below, `<drive>` is the full path of `My Drive`. Keep Drive running and signed in; it uploads what the job writes.
3. Create `~/Library/LaunchAgents/com.fieldops.pilot-backup.plist` (runs at 22:30; a run missed while asleep runs at wake):
   ```xml
   <?xml version="1.0" encoding="UTF-8"?>
   <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
   <plist version="1.0"><dict>
     <key>Label</key><string>com.fieldops.pilot-backup</string>
     <key>ProgramArguments</key><array>
       <string>/bin/zsh</string><string>-c</string>
       <string>set -a; source /Users/chrismaldo/fieldops-pilot/app/.env; set +a; PILOT_DATABASE_URL="$DATABASE_URL" BACKUP_DIR="<drive>/FieldOps-backups" exec /Users/chrismaldo/fieldops-pilot/app/scripts/pilot-backup.sh</string>
     </array>
     <key>StartCalendarInterval</key><dict><key>Hour</key><integer>22</integer><key>Minute</key><integer>30</integer></dict>
     <key>StandardOutPath</key><string>/Users/chrismaldo/fieldops-pilot/logs/backup.log</string>
     <key>StandardErrorPath</key><string>/Users/chrismaldo/fieldops-pilot/logs/backup-error.log</string>
   </dict></plist>
   ```
4. `launchctl load -w ~/Library/LaunchAgents/com.fieldops.pilot-backup.plist`, then run it once now: `launchctl start com.fieldops.pilot-backup` and check `backup.log`, and that the two files appear in Google Drive on the web.
5. **[Kristo]** If `backup-error.log` shows "Operation not permitted" for the Drive folder, add `/bin/zsh` to System Preferences → Security & Privacy → Privacy → Full Disk Access, and run step 4 again. Expected on the first run: the dump and photo files are written, then the 14-day cleanup (`find`) is refused and the job exits 1 without the "backup ok" line.
6. `scripts/pilot-backup.sh` writes `fieldops-YYYY-MM-DD.dump` (pg_dump custom format) and `photos-YYYY-MM-DD.tar.gz`, and deletes those older than 14 days. Deleted files go to Google Drive's trash, which empties itself after 30 days.
7. **[Kristo]** Daily: confirm the day's two files are on drive.google.com (the Drive client is unsupported on macOS 12).

### 5.7 Test restore (once, before the first real job)
Done 2026-11-23 from `fieldops-2026-11-23.dump` in Drive: tables, catalog, visits, submissions, Weigh-In rows, accounts and migrations matched the pilot; the photo archive extracted (no photos yet).
1. `psql -U postgres -c "CREATE DATABASE fieldops_restorecheck"`.
2. `/Library/PostgreSQL/18/bin/pg_restore --no-owner -d postgresql://postgres:<password>@localhost:5432/fieldops_restorecheck "<backup folder>/fieldops-<date>.dump"`.
3. `psql …/fieldops_restorecheck -c "select count(*) from catalog_items"` (and, once there are jobs, `visits`) matches the pilot.
4. `mkdir /tmp/photos-check && tar -xzf "<backup folder>/photos-<date>.tar.gz" -C /tmp/photos-check` and spot-check one photo.
5. `psql -U postgres -c "DROP DATABASE fieldops_restorecheck"`; `rm -rf /tmp/photos-check`.

### 5.8 Updating the pilot
Run a backup (§5.6 step 3), then in `~/fieldops-pilot/app`: `git checkout --detach <commit>`, `npm ci`, `npm --prefix frontend/dispatch ci`, `npm run build:dispatch`, `npm run db:migrate`, and restart (§5.3 step 3).
