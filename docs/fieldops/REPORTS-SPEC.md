# Reports (FieldOps)

**Version:** 0.1 — STUB, needs content
**Date:** 2026-07-30
**Status:** One of the 6 bottom-bar items (`/docs/fieldops/NAVIGATION.md`), and the entry point for Request Corrections (`/docs/shared/CORRECTIONS.md`), but no full screen spec exists yet.

## Known

- Shows the day's completions.
- View and download completed visit reports.
- Share/export capability.
- Hosts the "Request Corrections" action per visit — see `/docs/shared/CORRECTIONS.md`.
- Does not provide direct editing of generated Completion Report text or completed source visit data. After Generate Report, Request Corrections is the technician's correction entry point.
- Generate Report validates and freezes an immutable local submission before
  transport. A pending report is retained and retried at app startup and when
  connectivity returns; it becomes delivered only after the matching explicit
  backend ACK. The canonical report remains derived from accepted structured
  source data. See `/docs/OFFLINE-FIRST-CONTRACT.md`.

- **View report (W4, 2026-11-17):** the Report receipt (same component as the Workspace review, without the DRAFT stamp) slides out from behind its card; the cards below move down; tapping again (Hide report) collapses it. Pending and correction-required Reports use the snapshot stored on the phone (works offline). A delivered Report uses the server's Report when reachable (W4.1): its prices include PP-01 corrections, and each re-priced line, and the total, read "adjusted by office (was $X)"; until it loads, or offline, the phone's snapshot. A Report not on this phone (sent from another device) is drawn from the server's Report, or says it needs a connection.
- **Correct report (W4.1):** reopens the Workspace with the call data (address, order, date and time, work type, property) refreshed from the server; the technician's work is kept. A Report rejected for changed call details can then be resent.
- After a download, a delivered card reads "Sent · downloaded".
- **Rejected Report (WS-12):** the card says which parts differ and what to do (`docs/architecture/REPORT-SNAPSHOT-CONTRACT.md`).
- **Download:** JSON · ZIP (photos) · All, on delivered and pending Reports (`docs/shared/PHOTOS-GPS-INTEGRATIONS.md`).
- **Company form (PP-03, 2026-11-20):** on delivered (Sent) cards, next to Download. Lists the visit's systems; each opens the Company's Google Form in a new tab, prefilled with the values that exist; missing ones stay empty and are named under the system (FT-05, 2026-11-23). The "Was the form sent?" prompt, the sent flag and the usage record are deferred to the second round. Map and rules: `docs/shared/PHOTOS-GPS-INTEGRATIONS.md` (The Company's Google Form).

## Missing

Full screen layout and behavior — list structure, treatment of pending versus delivered submissions, what's shown per completed visit, export format.
