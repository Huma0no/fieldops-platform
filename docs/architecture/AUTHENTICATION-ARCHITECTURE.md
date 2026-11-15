# FieldOps Authentication Architecture

**Status:** Approved model; implementation in progress  
**Date:** 2026-11-12

This document supersedes the prior device invitation and device authorization model. Dispatch and FieldOps use one username/password identity system, as authorized in the Authentication Redesign request. Accounts are not paired to devices.

## Identity and roles

Each account is one existing `technicians` row. Its `id` remains the stable operational identity referenced by Services, Reports, corrections, inventory, and other history. Authentication changes must preserve this ID and must never merge people by display name or username.

The API exposes these roles:

| API role | Existing stored role | Access |
| --- | --- | --- |
| `DISPATCH_OWNER` | `owner` | Dispatch administration, including account management |
| `DISPATCHER` | `dispatcher` | Dispatch operational access |
| `TECHNICIAN` | `technician` | FieldOps operational access |

The backend enforces roles at route boundaries and in sensitive handlers. A valid account does not grant access to both application surfaces. A person who needs both roles requires an explicitly resolved identity model; the current `technicians.role` constraint represents one role per identity and this package does not merge duplicate historical identities.

## Passwords and sessions

- Usernames are unique case-insensitively.
- Passwords are hashed with Node.js `scrypt` using a random salt; plaintext passwords and password hashes are never returned.
- Owner-created accounts receive an initial temporary password and must replace it before using operational routes. Password changes require the current password.
- Password reset marks the next login as temporary and revokes all current sessions.
- Login creates a random server-managed session token. PostgreSQL stores only its SHA-256 hash. Each session ends at a fixed time chosen at sign-in (`auth_sessions.expires_at`, migration `027_auth_session_expiry.sql`): with **Keep me signed in on this device** (checked by default, FieldOps and Dispatch) 7 days after sign-in; otherwise at the next 03:00 in the company time zone (`COMPANY_TIME_ZONE`, default America/Chicago), or the following 03:00 when less than an hour remains. There is no inactivity timeout (reference: NIST SP 800-63B-4, AAL1). A session also ends on logout, owner revocation, password reset, a password change (every other session of the account), or account deactivation.
- Login responds identically, and in comparable time, for an unknown username, a wrong password, or an inactive account. Password verification never runs while a row lock is held.
- Browser clients use a same-origin `HttpOnly`, `SameSite=Strict` cookie (`Secure` in production). Unsafe cookie-authenticated requests require `X-FieldOps-Request: 1`. Non-browser API clients may present the same opaque session token as a Bearer credential.
- Disabling an account revokes its sessions in the same transaction as deactivation. Re-enabling does not restore them.

## Bootstrap

The first Dispatch Owner is username `Dispatcher`, internal role `owner`, and receives its initial password only from `DISPATCH_BOOTSTRAP_PASSWORD`. Startup bootstrap uses a PostgreSQL transaction advisory lock, stores a password hash, and sets `must_change_password`.

Bootstrap does not reset an existing account. If exactly one legacy owner identity exists without credentials, bootstrap provisions that row without changing its ID or display name. Multiple legacy owners, a username conflict, or an incomplete conflicting account stop bootstrap for manual resolution. A missing/short password stops bootstrap if initialization is still required. Once `Dispatcher` has an owner account with a password hash, later starts leave it untouched, including if an Owner later disables it.

## Database migration and legacy compatibility

Migration `026_username_password_auth.sql` adds nullable account columns, a case-insensitive username index, and `auth_sessions`. Existing technician rows and foreign keys remain unchanged. The migration does not infer usernames or copy credentials from names.

Legacy `device_tokens` and `invite_codes` tables remain in place for compatibility and historical inspection; they are no longer accepted for authentication. Deactivation continues to remove legacy tokens and invitations as well as revoke new sessions. Existing technician rows remain unmerged and retain all their relationships. The Owner can attach credentials to an existing active row through account provisioning, preserving its ID; new people can be created with credentials in one operation. Existing sessions do not migrate because their device-token credentials are not password accounts.

## Offline FieldOps data

Offline visit drafts, completion submissions, and photos remain associated with the existing technician ID. A login does not reassign offline data. Authentication failure or session revocation must not delete locally stored work. The client uses the server session for synchronization when connectivity returns.

## Explicitly out of scope

This model does not add device registration, device authorization, invitation redemption, refresh tokens, inactivity timeouts, identity consolidation, or changes to Service and Report workflows.
