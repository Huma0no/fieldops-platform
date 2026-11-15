# First-Launch Runbook

**Date:** 2026-11-15
**Scope:** Bringing up a FieldOps server and its first accounts. FieldOps is pre-production; existing data is test data.

## 1. Database

- **New database:** `npm run db:setup` applies `src/db/schema.sql` and the catalog seed. `schema.sql` already includes every migration through 027. The script refuses to run on a database that already has visits.
- **Existing database:** apply the pending migrations in order: `npm run db:migrate025`, `npm run db:migrate026`, `npm run db:migrate027` (each needs `DATABASE_URL` in the shell). Migration 025 aborts without changes if any visit has more than one completion submission.

## 2. Server environment

- `DISPATCH_BOOTSTRAP_PASSWORD`: initial password for the `Dispatcher` owner account (12–256 characters). Remove it from the environment once the account exists.
- `TRUST_PROXY`: number of reverse proxies in front of the server (for example `1` on a PaaS). Leave it empty when the server is exposed directly.
- `NODE_ENV=production` so the session cookie is `Secure` (requires HTTPS).

Start the server. On first start it creates the `Dispatcher` owner account (`docs/architecture/AUTHENTICATION-BOOTSTRAP.md`).

## 3. Accounts

1. Sign in to Dispatch as `Dispatcher` with the bootstrap password and set a new password when prompted.
2. In Technicians, for each person: create the account with a username and a temporary password, or provision credentials on an existing technician row.
3. Give each person their username and temporary password through a private channel.

## 4. Verify on a device

1. Open FieldOps on the technician's phone and sign in with the temporary password.
2. Set a new password when prompted.
3. Confirm My Calls loads, then sign out and sign in again with the new password.
