# Initial Dispatch Owner Bootstrap

**Status:** Approved username/password bootstrap  
**Date:** 2026-11-12  
**Related:** [`AUTHENTICATION-ARCHITECTURE.md`](./AUTHENTICATION-ARCHITECTURE.md)

This document supersedes the previous invitation-based bootstrap specification. Bootstrap provisions the first account directly; it does not issue an invitation or a device token.

## Required account

- Username: `Dispatcher` (unique case-insensitively)
- Role: `DISPATCH_OWNER` (stored as the existing `owner` role)
- Initial password: environment variable `DISPATCH_BOOTSTRAP_PASSWORD`
- First-login state: `must_change_password = true`

The password must meet the application minimum length, is hashed with `scrypt`, and is never logged or returned by an API. The process fails with an explicit configuration/account-conflict error if bootstrap is still required but cannot proceed safely.

## Atomic and repeat-safe behavior

Bootstrap runs at server startup in one PostgreSQL transaction while holding a transaction-scoped advisory lock. Concurrent processes serialize before checking or creating the account. It writes either the account changes in full or none of them.

On later starts, an existing `Dispatcher` owner account with a password hash is left unchanged, including if an Owner has disabled it. Bootstrap never reactivates it, resets its password, recreates it, or clears its forced-password-change state.

If no `Dispatcher` username exists and exactly one legacy row has role `owner` without account credentials, bootstrap attaches credentials to that same row, preserving its ID, display name, and historical foreign-key relationships. If multiple legacy owner rows exist, a conflicting `Dispatcher` username is assigned, or the existing account is incomplete, bootstrap aborts and requires manual identity reconciliation. It does not select a person by display name, combine rows, or modify historical records.

If there is no legacy owner, bootstrap creates one `technicians` row with the required username and role. Existing non-owner identities are preserved unchanged.

## Deployment requirements

1. Apply the additive authentication migration to the intended database before starting the new server version.
2. Set `DISPATCH_BOOTSTRAP_PASSWORD` in the server environment for initial provisioning. Remove it from routine deployment configuration after the account exists.
3. Confirm existing owner identities and any conflicting `Dispatcher` username before rollout. The application deliberately aborts instead of guessing when the records are ambiguous.
4. Existing device-token sessions do not become username/password accounts. The old token tables are retained but are not accepted for authentication. The Owner provisions credentials on existing active technician identities without changing their IDs, or creates a new identity with credentials.

Bootstrap is not an HTTP endpoint, recovery mechanism, or recurring seed operation. Password resets and account management after initialization use authenticated Dispatch Owner routes.
