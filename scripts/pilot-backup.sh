#!/bin/zsh
# Nightly pilot backup (docs/architecture/FIRST-LAUNCH-RUNBOOK.md §5): a
# database dump plus a dated copy of the photos folder, written to BACKUP_DIR
# (an iCloud Drive folder on the pilot Mac); files older than KEEP_DAYS go.
#
# Env: PILOT_DATABASE_URL, PHOTO_STORAGE_DIR, BACKUP_DIR; optional KEEP_DAYS
# (default 14) and PG_BIN (default /Library/PostgreSQL/18/bin).
set -euo pipefail

: "${PILOT_DATABASE_URL:?PILOT_DATABASE_URL is required}"
: "${PHOTO_STORAGE_DIR:?PHOTO_STORAGE_DIR is required}"
: "${BACKUP_DIR:?BACKUP_DIR is required}"
KEEP_DAYS="${KEEP_DAYS:-14}"
PG_BIN="${PG_BIN:-/Library/PostgreSQL/18/bin}"

stamp="$(date +%F)"
mkdir -p "$BACKUP_DIR" "$PHOTO_STORAGE_DIR"

# Write to .partial first so a failed run never leaves a file that looks complete.
"$PG_BIN/pg_dump" --format=custom --file="$BACKUP_DIR/fieldops-$stamp.dump.partial" "$PILOT_DATABASE_URL"
mv "$BACKUP_DIR/fieldops-$stamp.dump.partial" "$BACKUP_DIR/fieldops-$stamp.dump"

tar -czf "$BACKUP_DIR/photos-$stamp.tar.gz.partial" -C "$PHOTO_STORAGE_DIR" .
mv "$BACKUP_DIR/photos-$stamp.tar.gz.partial" "$BACKUP_DIR/photos-$stamp.tar.gz"

# Keep the last KEEP_DAYS days (today counts as one).
find "$BACKUP_DIR" -maxdepth 1 -type f \( -name 'fieldops-*.dump' -o -name 'photos-*.tar.gz' -o -name '*.partial' \) \
  -mtime +"$((KEEP_DAYS - 1))" -delete

echo "$(date '+%F %T') backup ok: fieldops-$stamp.dump, photos-$stamp.tar.gz"
