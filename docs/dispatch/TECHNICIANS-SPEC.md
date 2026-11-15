# Technicians

**Version:** 1.0
**Date:** 2026-07-30
**Status:** Closed design

## Purpose

The technician roster and each technician's record, as managed by the Dispatcher.

## Roster

Each technician record holds:
- Name and contact info.
- Account management (Owner only): username and temporary password at creation, credentials for rows created before username/password sign-in, password reset (new temporary password, all sessions revoked), and session revocation for a lost device. See `/docs/shared/API_CONTRACT.md` §1 and Technician lifecycle.
- **Commission %** — editable per technician, defaults to 20% when added. Feeds directly into `/docs/dispatch/LEDGER-SPEC.md`.
- A link to that technician's Ledger history.
