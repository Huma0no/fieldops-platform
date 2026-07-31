# Corrections

**Version:** 2.0
**Date:** 2026-07-30
**Status:** Closed — confirmed design

## Purpose

How an error on an already-submitted visit gets flagged, and until when.

## The two moments, and what each one is for

A visit can need a correction at two different times. They are not the same mechanism.

### 1. Report-generation time — free-text Notes
While the technician is still in the Notes step of Workspace, generating the Completion Report, anything they notice about the job can go in the free-text Notes field. This is informal and only appropriate because the report hasn't been sent yet — the technician still owns the visit in that moment. It is not a correction-tracking mechanism.

### 2. After submission, before that visit's Ledger week closes — Request Corrections
Once a report is submitted, the technician uses **Request Corrections** (Reports, FieldOps) to flag the error.

**What it is:** a one-way message channel from the technician to the Dispatcher/Ledger — not a ticket with a formal approve/reject step. It exists so the correction is guaranteed a fixed, visible place and doesn't get lost or mixed in with unrelated job notes, the way it would if it just lived in Notes.

**What happens with it:** the Dispatcher sees it and applies the change manually in Dispatch, at their discretion. It's a courtesy Kristo extends to technicians, not a system obligation Kristo owes them.

**The window:** open from submission until that visit's Ledger week auto-closes (the following Wednesday). It closes exactly when the Ledger week closes — there is no separate "expired" state to track, no reopening of an already-closed Ledger week. Reviewing your own numbers on each Service Call is the technician's responsibility; if nothing is flagged before that week's Ledger closes, the technician carries that consequence. This keeps the mechanism from needing to handle edge cases around retroactive changes to paid weeks.
