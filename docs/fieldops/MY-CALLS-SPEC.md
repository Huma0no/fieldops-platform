# My Calls

**Version:** 1.0
**Date:** 2026-07-30
**Status:** Closed — built, neomorphic style applied

## Purpose

The technician's list of assigned visits — the entry point into a job.

## Collapsed card

Minimal: address, subdivision, builder, and a Navigate button only. No delete/edit. No explicit expand control — tapping anywhere except Navigate expands the card. Navigate opens maps (`https://maps.google.com/maps?q={encoded_address}`) in a new tab.

## Expanded card

Reveals, in order: work type label (single free-text field, no phase/scope split) → equipment/accessory chips (pre-specified thermostat + accessories + system count, already inserted as real visit items at visit creation) → intake notes line → per-system briefing → **Start Report**.

**Per-system briefing** shows: indoor model + outdoor model, indoor/outdoor type, tonnage, refrigerant, factory/revised charge (oz + lb), over-charge threshold, subcooling, ESP, CFM max/min. Each system block carries its own LV and Blower Data buttons, scoped to that system's equipment.

When one card is expanded, sibling cards visually recede. The active job's address stays fixed in the header context.

## Load Sheet Summary

Collapsed by default, at the foot of the card list. Aggregates thermostats + accessories (not refrigerant) across all visible jobs, with quantities; collapsed header shows a total piece count. Shows a hint to expand cards if not all visits have been fetched yet.

## Start Report

Launches Workspace for that visit (navigates away from My Calls — see `/docs/fieldops/NAVIGATION.md`).
