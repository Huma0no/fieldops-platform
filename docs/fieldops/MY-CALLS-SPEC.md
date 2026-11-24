# My Calls

**Version:** 1.1
**Date:** 2026-11-19
**Status:** Closed — built, neomorphic style applied

## Purpose

The technician's list of assigned visits — the entry point into a job.

## Collapsed card

Minimal: address, subdivision, builder, and a Navigate button only. No delete/edit. No explicit expand control — tapping anywhere except Navigate expands the card. Navigate opens maps (`https://maps.google.com/maps?q={encoded_address}`) in a new tab.

## Expanded card

Reveals, in order: work type label (single free-text field, no phase/scope split) → equipment/accessory chips (pre-specified thermostat + accessories + system count, already inserted as real visit items at visit creation) → intake notes line → per-system briefing → **Start Report**, alongside a **Cancel (✕)** entry point. Cancel first uses the shared confirmation dialog; dismissing keeps the technician on the card, while confirmation opens Workspace in durable Cancel mode. A card with a confirmed local Cancel draft, before backend acknowledgement, shows **Cancel Pending** and **Continue Cancel** instead of another Cancel entry point; it resumes the existing Notes/Checklist Cancel mode without another confirmation. Full mechanism: `/docs/fieldops/CANCEL-SPEC.md`.

**Per-system briefing** shows: indoor model + outdoor model, indoor/outdoor type, tonnage, refrigerant, factory charge (oz + lb) for the outdoor model's manufacturer at its default factory length (`catalog_equipment_charges`, W3; empty when the catalog has none), over-charge threshold, subcooling, ESP, CFM max/min. Each system block carries its own LV and Blower Data buttons, scoped to that system's equipment.

_Implementation note (FT-03, 2026-11-23; replaces the A15 audit note):_ the expanded card shows the work type, the chips (pre-specified thermostats and accessories with their quantity, plus the system count), the intake notes and, per system, the indoor and outdoor models with their catalog type, tonnage (the outdoor unit's catalog BTU ÷ 12,000), refrigerant, factory charge and ESP (the indoor unit's catalog `pesp`). A value the catalog lacks for a model is left out. It opens from the downloaded Local Visit Draft and the cached catalog, so it works offline, and refreshes from the server when reachable. The order number and builder contact follow the briefing. **Not built (no data source yet):** over-charge threshold, subcooling, CFM max/min, and the LV and Blower Data buttons.

When one card is expanded, sibling cards visually recede. The active job's address stays fixed in the header context.

## Load Sheet Summary

Collapsed by default, at the foot of the card list. Aggregates thermostats + accessories (not refrigerant) across all visible jobs, with quantities; collapsed header shows a total piece count. Shows a hint to expand cards if not all visits have been fetched yet.

## Start Report

Launches Workspace for that visit (navigates away from My Calls — see `/docs/fieldops/NAVIGATION.md`). Assignment and Lobby claim remain shared online lifecycle actions. Once an assigned visit has been downloaded locally, the technician can open and work it offline; FieldOps must not imply that an offline technician can claim a new Lobby call. See `/docs/OFFLINE-FIRST-CONTRACT.md`.
