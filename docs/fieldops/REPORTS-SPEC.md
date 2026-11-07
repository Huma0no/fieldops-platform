# Reports (FieldOps)

**Version:** 0.1 — STUB, needs content
**Date:** 2026-07-30
**Status:** One of the 4 top-nav tabs (`/docs/fieldops/NAVIGATION.md`), and the entry point for Request Corrections (`/docs/shared/CORRECTIONS.md`), but no full screen spec exists yet.

## Known

- Shows the day's completions.
- Share/export capability.
- Hosts the "Request Corrections" action per visit — see `/docs/shared/CORRECTIONS.md`.
- Does not provide direct editing of generated Completion Report text or completed source visit data. After Generate Report, Request Corrections is the technician's correction entry point.
- Generate Report validates and freezes an immutable local submission before
  transport. A pending report is retained and retried at app startup and when
  connectivity returns; it becomes delivered only after the matching explicit
  backend ACK. The canonical report remains derived from accepted structured
  source data. See `/docs/OFFLINE-FIRST-CONTRACT.md`.

## Missing

Full screen layout and behavior — list structure, treatment of pending versus delivered submissions, what's shown per completed visit, export format.
