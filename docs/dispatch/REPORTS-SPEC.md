# Reports (to The Company)

**Version:** 1.0
**Date:** 2026-07-30
**Status:** Closed design

## Purpose

The formal reports Dispatch generates and delivers to The Company — distinct from a technician's own Completion Report in FieldOps.

## Report types

Two reports, generated independently:
1. **Equipment/accessory usage**
2. **Refrigerant usage**

## Generation

- Filters: date range (required) + technician (optional).
- Each run produces **one document**, with each report category on its own page.
- Curation before generating: visits shown as address-grouped chips; any address can be excluded from the run individually. A live summary reflects the current selection as items are excluded/included.
