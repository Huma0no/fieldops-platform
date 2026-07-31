# Technicians

**Version:** 1.0
**Date:** 2026-07-30
**Status:** Closed design

## Purpose

The technician roster and each technician's record, as managed by the Dispatcher.

## Roster

Each technician record holds:
- Name and contact info.
- Invite code management (generate / refresh / revoke) — pairs a technician to their device, see `/docs/shared/API_CONTRACT.md` §1 for the auth mechanism this feeds.
- **Commission %** — editable per technician, defaults to 20% when added. Feeds directly into `/docs/dispatch/LEDGER-SPEC.md`.
- A link to that technician's Ledger history.
