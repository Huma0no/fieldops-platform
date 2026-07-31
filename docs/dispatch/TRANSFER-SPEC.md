# Transfers (Dispatcher view)

**Version:** 1.0
**Date:** 2026-07-30
**Status:** Closed design

## Purpose

How the Dispatcher sees visits reassigned between technicians. The technician-side handshake mechanics live in `/docs/fieldops/`; this document is the Dispatch view only.

## Mechanism

A transfer is a handshake between two technicians — sender proposes, receiver accepts. The visit stays with the sender until accepted; no Dispatcher authorization is required at any point.

## Dispatcher visibility

The Dispatcher is informed via a log entry only — purely informational, no action required and no approval step. Log source: the `transfers` table (`visit_id`, `from_technician_id`, `to_technician_id`, `reason`, `accepted_at`) in `/docs/shared/DATA_MODEL.md`.
