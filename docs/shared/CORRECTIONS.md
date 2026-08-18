# Corrections

**Version:** 2.0
**Date:** 2026-07-30
**Status:** Closed — confirmed design

## Purpose

How an error on a visit finalized through Generate Report gets flagged, and until when.

## The two moments, and what each one is for

A visit can need a correction at two different times. They are not the same mechanism.

### 1. Before Generate Report — source-data entry
While the technician is still in Workspace, they can enter and correct the Local Visit Draft, including free-text Notes. The draft is durable offline-first working state; Generate Report submits its immutable snapshot, and accepted server source data becomes the shared operational record. This is not a correction-tracking mechanism. See `/docs/OFFLINE-FIRST-CONTRACT.md`.

### 2. After Generate Report, before that visit's Ledger week closes — Request Corrections
Generate Report is the technician's operational finalization boundary: it places the visit in `completed`, `temporarily`, or `cancelled`. After that boundary, the technician does not reopen or directly edit source visit data, nor directly edit generated report text. The technician uses **Request Corrections** (Reports, FieldOps) to flag the error.

**What it is:** a one-way message channel from the technician to the Dispatcher/Ledger — not a ticket with a formal approve/reject step. It exists so the correction is guaranteed a fixed, visible place and doesn't get lost or mixed in with unrelated job notes, the way it would if it just lived in Notes.

**What happens with it:** the Dispatcher sees it and applies any source-data change manually in Dispatch, at their discretion. The canonical Completion Report is regenerated from that authoritative visit data; report text is not independently editable. It's a courtesy Kristo extends to technicians, not a system obligation Kristo owes them.

**The window:** open from submission until that visit's Ledger week auto-closes (the following Wednesday). At that point, any still-open correction is marked `expired`; there is no reopening of an already-closed Ledger week. Reviewing your own numbers on each Service Call is the technician's responsibility; if nothing is flagged before that week's Ledger closes, the technician carries that consequence. This keeps the mechanism from needing to handle edge cases around retroactive changes to paid weeks.
