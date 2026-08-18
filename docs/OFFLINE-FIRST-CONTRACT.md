# FieldOps Offline-First Contract

**Version:** 1.0
**Date:** 2026-08-17
**Status:** Current architectural contract

## Purpose

FieldOps is offline-first. A technician must be able to download an assigned call, perform active Workspace work without a network connection, generate a durable completion submission, and deliver it safely when connectivity returns. This contract defines that boundary without prescribing an IndexedDB schema, transport implementation, or a future event-replay system.

## Core delivery model

```
Dispatch/backend → assigned visit download → durable local working copy
→ technician works locally → Generate Report → immutable submission snapshot
→ local pending submission → send/retry → server ACK → delivered
```

While a visit is active, its **Local Visit Draft** is the technician's operational working source of truth. After a server ACK, persisted structured visit data is the shared operational source of truth. The canonical Completion Report remains derived from the resolved, structured source data; it is never the source record that must be edited or replayed.

Dispatch is not a real-time mirror of Workspace mutations. Chat/notifications are an explicit separate exception. Live technician tracking is deferred.

## Local Visit Draft

The assigned visit download creates or refreshes a durable local working copy. It includes, as applicable:

- visit identity and status; job, address, subdivision, and builder context;
- systems and equipment context;
- service and modifiers;
- thermostat and item selections, including quantity, `Other` / `Other Fix` description, and resolved prices;
- Weight-In-Data item state and Weigh-In measurement records;
- notes, checklist answers, photo/evidence references, cancel/origin state, resolved total, and catalog references needed for valid local work.

The draft must survive navigation, refresh, app close/reopen, and a temporary connectivity loss. This is a behavioral requirement, not a required local database schema.

Workspace edits are local-first: each edit durably updates the active draft and the UI reflects that draft. Normal active-work editing must not require an immediate backend write and must not be designed as replay of every Workspace mutation.

## Download and reopening boundary

Before a technician needs to work offline, FieldOps downloads the assigned visit summary and detail, system/equipment context, relevant catalog/rule configuration, and any existing persisted work. Opening an already downloaded call must not require the network.

Server detail retrieval and Workspace rehydration remain valid for initial download, refresh, and recovery reconciliation, but server-only rehydration is not sufficient for offline-first work. On reopening an active call, FieldOps restores its local draft and reconciles with server data when a safe refresh is available.

## Generate Report and submission snapshot

Generate Report is the local operational finalization action:

1. Validate the Local Visit Draft against the current visit rules.
2. Resolve or confirm the local terminal state and resolved total.
3. Durably create an immutable **Submission Snapshot** and mark it pending before attempting delivery.
4. Attempt delivery; a transport failure leaves the snapshot available for retry.

The snapshot contains the visit identity; terminal intent (`completed`, `temporarily`, or `cancelled`); service/modifier state; item selections, quantities, descriptions, and resolved prices; Weigh-In data; notes; checklist answers; evidence/photo references; total; client timestamp/version metadata; and a stable submission identity/idempotency key. The report is derived from this structured snapshot/server source; it does not independently recreate pricing or act as the mutable source.

## Delivery lifecycle, ACK, and retry

Local submission lifecycle is:

```
draft → pending → delivered
```

- **draft:** active local work, not yet submitted.
- **pending:** an immutable durable snapshot exists and may be sent or retried.
- **delivered:** the backend has acknowledged the snapshot as accepted and persisted with the intended terminal visit outcome.

Failed or unknown delivery attempts remain pending (with local error/retry information); they never destroy the snapshot. Connectivity restoration or authenticated application startup resumes eligible delivery attempts. A submission is delivered only after an explicit server ACK, not merely because a download occurred or a request was attempted.

Every retry uses the same stable submission identity. Backend acceptance must be duplicate-safe: retrying must not create another completion, duplicate items, or duplicate downstream effects.

## Photos, evidence, and GPS

Before upload succeeds, photo/evidence metadata and local blobs must be durable alongside the active draft/submission work so that app closure or connectivity loss does not lose evidence. Evidence upload may retry independently from submission delivery. Existing GPS applicability rules remain unchanged.

**CONTRACT OPEN:** whether every required evidence upload must complete before terminal submission ACK is accepted has not been decided.

## Emergency local report download

An emergency **Download Report** contingency is **FUTURE**. After repeated delivery failure it may produce a local package from the immutable submission snapshot, but it must not mark the visit delivered. The package must retain visit/submission identity and may later include canonical report text, structured JSON, metadata, and evidence/photos; CSV/ZIP format, retry threshold, and archive process remain open.

## Dispatch visibility

Dispatch may rely on assignment state and successfully submitted terminal states. It does not receive every in-progress Workspace edit in real time. Failed or pending local delivery must remain distinguishable from server-confirmed completion through the FieldOps delivery lifecycle.

## Contract opens

The following require their own current decision before implementation:

- Dispatch reassignment or cancellation while a technician has an offline active draft.
- Token expiry while offline and the authenticated recovery path.
- Concurrent work from two devices for the same technician/visit.
- Reconciliation of stale catalog references in an existing local draft.
- Whether evidence upload is required before terminal ACK.

## Boundaries

This contract does not introduce a generic event log, replay every Workspace mutation to Dispatch, change pricing or report formatting rules, define live tracking, or redesign service multi-system behavior. Detailed visit, completion, evidence, and API rules remain in their owning specifications.
