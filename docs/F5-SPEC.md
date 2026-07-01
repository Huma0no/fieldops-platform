# F5 — PDF Intake (Dispatch Panel)

**fieldops-platform · Frontend Phase 5**
**Status:** Specification — approved for implementation
**Date:** 2026-06-30

---

## Overview

F5 implements the daily PDF intake workflow in the Dispatch Panel. Each morning, the dispatcher receives a route sheet PDF from The Company. The dispatcher uploads the PDF, the system extracts all service calls via AI, the dispatcher reviews and confirms each call, and confirmed calls are released to the Lobby for technicians to claim.

---

## User Flow

### 1. Upload screen
- Drag-and-drop zone or file picker button
- Accepts PDF only
- On file selection: frontend converts PDF to base64, sends to backend
- Backend calls Anthropic API (claude-sonnet-4-6) with extraction prompt + PDF
- Frontend shows progress indicator during extraction (typically 3–8 seconds)
- On completion: transition to Batch Review screen

### 2. Batch review — call by call
- Two-column layout:
  - Left: original PDF rendered for visual reference
  - Right: extracted fields, pre-filled and fully editable
- Progress bar: "Reviewing call X of N"
- Per call: `[Confirm]` `[Skip]` buttons
- If address match level is `partial`: address comparison modal appears before confirm (see Address Matching section)

### 3. Release to Lobby
- After all calls reviewed: `[Release to Lobby]` button
- Confirmed calls (not skipped) are created as visits in the database
- Visits appear in the Lobby for technicians to claim

---

## AI Extraction

### Transport
```
Browser (PDF → base64)
  → POST /api/pdf-batches
  → Backend → Anthropic API (claude-sonnet-4-6)
  → JSON array of extracted calls
  → Backend runs addressMatchLevel() on each address
  → Response to frontend: calls + match level per call
```

The PDF is not persisted to disk. It is converted to base64 in the browser, sent to the backend, forwarded to the Anthropic API, and discarded after extraction. Cost per PDF: ~$0.02.

### Extraction prompt (system)

```
You are a data extraction assistant for HVAC field operations.

Extract all service calls from the route sheet PDF provided.
Return a JSON array — one object per call. No preamble, no markdown fences.

For each call extract:
{
  "scheduledTime": "HH:MM (24h format)",
  "address": "street number and name only",
  "city": "city name",
  "state": "TX",
  "subdivision": "subdivision/community name if shown",
  "orderNumber": "# followed by digits, as shown",
  "builder": "builder company name only (not contact name)",
  "builderContactName": "contact person full name",
  "builderContactPhone": "digits only, as they appear in the document",
  "workType": "exact phrase from the SERVICE field (e.g. 'AC & Heating Startup', 'Finish Start Up')",
  "systems": [
    {
      "indoorModel": "model number as shown in document",
      "outdoorModel": "model number as shown in document",
      "coilModel": "coil model number if separately listed, else null"
    }
  ],
  "preSpecifiedThermostat": "match against known list or null",
  "preIdentifiedAccessories": ["matched accessory names or empty array"],
  "companyNotes": "full verbatim IMPORTANT NOTES block + newline + ROUGH/TRIM/SET lines if present"
}

Thermostat matching — normalize these variants to their canonical names:
- "ecobee", "ecobee tstat", "ecobee3" → "Ecobee"
- "t10", "t-10", "t10 tstat", "1-t10 tstat" → "T-10"
- "t6", "t-6" → "T-6"
- "t4", "t-4" → "T-4"
- "t8321", "t-8321" → "T-8321"
- "daikin one" → "Daikin One"
- "th2110" → "TH2110"
If no thermostat is identifiable, return null.

Accessory matching — normalize these variants to their canonical names:
- "fin180p", "fin180p(po)", "M#FIN180P", "M#FIN180P(PO)" → "FIN180P"
- "fin6-md", "fin6md" → "FIN6-MD"
- "float switch", "float sw" → "Float Switch"
- "dehum", "DEHUM", "M#DHMO..." → "Dehum"
- "f/a", "fresh air" → "F/A"
- "harmony" → "Harmony"
- "hz322" → "HZ322"
- "ut3000" → "UT3000"
- "bypass" → "Bypass"
- "ebypass" → "eBypass"
- "dapc" → "DAPC"
- "aprilaire", "aprilare" → "AprilAir"
- "rds" → "RDS"
- "trane harness" → "Trane Harness"
- "ecoil wire" → "Ecoil Wire"
- "lp kit lennox 1stg", "lp kit lennox 1 stage" → "LP Kit Lennox 1stg"
- "lp kit lennox 2stg", "lp kit lennox 2 stage" → "LP Kit Lennox 2stg"
- "lp kit goodman" → "LP Kit Goodman"
If no accessories are identifiable, return [].

Rules:
- systems[] is always an array, even for single-system calls
- For multi-system calls, each system is a separate object in the array
- builderContactPhone: return digits as they appear — do not validate or format
- companyNotes: copy verbatim — do not summarize, rephrase, or omit any text
- ROUGH / TRIM / SET lines are appended to companyNotes after a newline
- Do not extract refrigerant type — it is resolved automatically from equipment catalog
- If a field is not present in the document, return null (or [] for arrays)
- Do not infer or hallucinate values not present in the document
```

### Output schema (per call)

```json
{
  "scheduledTime": "08:00",
  "address": "31718 Rosemary Road",
  "city": "Fulshear",
  "state": "TX",
  "subdivision": "Jordan Ranch",
  "orderNumber": "#1691686",
  "builder": "Highland",
  "builderContactName": "William Lack",
  "builderContactPhone": "34643359928",
  "workType": "Finish Start Up",
  "systems": [
    {
      "indoorModel": "S8X1B040M2PSC",
      "outdoorModel": "5TTR5024A1",
      "coilModel": "5TXCB003AS3"
    },
    {
      "indoorModel": "S8X1C080M5PSC",
      "outdoorModel": "5TTR5060A1",
      "coilModel": "5TXCD010AS3"
    }
  ],
  "preSpecifiedThermostat": "Ecobee",
  "preIdentifiedAccessories": ["FIN180P", "Dehum"],
  "companyNotes": "Highland—222 (R454B) plan bedroom opt(bed/clst w/bath)...\n\nROUGH JULIO C LOPEZ 4/24/26\nTRIM ROBERTO MARTINEZ 06/16/26\nSET EVER O GUTIERREZ 6/15/26"
}
```

---

## Address Matching

### Purpose
Prevent duplicate address records caused by minor formatting differences in the PDF (abbreviations, partial street names, typos). When a new address is a variant of an existing one, create a new visit under the existing address record rather than a new address.

### Normalization — `normalizeAddress(raw)`

Applied to both the extracted address and all existing addresses before comparison.

```javascript
// utils/normalizeAddress.js

const STREET_ABBR = {
  'TR': 'TRAIL', 'TRL': 'TRAIL',
  'ST': 'STREET',
  'CT': 'COURT',
  'DR': 'DRIVE',
  'LN': 'LANE',
  'BLVD': 'BOULEVARD',
  'AVE': 'AVENUE',
  'RD': 'ROAD',
  'PKWY': 'PARKWAY',
  'CIR': 'CIRCLE',
  'PL': 'PLACE',
  'HWY': 'HIGHWAY',
  'FWY': 'FREEWAY',
};

function normalizeAddress(raw) {
  return raw
    .toUpperCase()
    .replace(/[.,#]/g, '')
    .split(' ')
    .map(token => STREET_ABBR[token] ?? token)
    .join(' ')
    .trim();
}
```

### Match levels — `addressMatchLevel(extracted, existing)`

| Level | Condition | System action |
|---|---|---|
| `exact` | `normalizeAddress(a) === normalizeAddress(b)` | Silent — new visit under existing address |
| `partial` | Same street number + first meaningful tokens match, strings differ | Modal — dispatcher decides |
| `none` | No match | New address record created |

**`exact` example:**
`"4735 North Star Tr"` vs `"4735 North Star Trail"` → both normalize to `"4735 NORTH STAR TRAIL"` → `exact`

**`partial` example:**
`"4735 North Star"` vs `"4735 North Star Trail"` → same number, shared leading tokens, not identical after normalization → `partial`

**`none` example:**
`"4751 North Star Trail"` vs `"4735 North Star Trail"` → different street number → `none`

**Comparison scope:** Number + street name only. City, state, zip, and subdivision are excluded from the match string. Subdivision is a separate field and is not used in address comparison.

### Partial match modal (UI)

When `addressMatchLevel` returns `partial`, the dispatcher sees a modal before confirming the call:

```
"This address may already exist in the system."

  Extracted:   4735 North Star
  In database: 4735 North Star Trail (Jordan Ranch)

  [Use existing — add as new visit]
  [Create as new address]
```

No merge option — addresses are either the same record or different records. The dispatcher makes the call.

### Implementation location

`normalizeAddress` and `addressMatchLevel` are backend utilities (`utils/normalizeAddress.js`). The frontend never performs address comparison — it only renders the result returned by the backend.

All address-intake flows (PDF Intake, manual entry, future imports) call the same utility.

---

## API Endpoint

### `POST /api/pdf-batches`

**Request:**
```json
{
  "pdf": "<base64 string>",
  "filename": "Christian_0624.pdf"
}
```

**Response:**
```json
{
  "batchId": "uuid",
  "extractedAt": "2026-06-24T08:00:00Z",
  "calls": [
    {
      "index": 0,
      "extracted": { /* call schema as above */ },
      "addressMatch": {
        "level": "exact" | "partial" | "none",
        "existingAddress": { /* address record from DB, or null */ }
      }
    }
  ]
}
```

**State machine** (uses existing `pdf_batches` table):
`uploaded` → `processing` → `ready` → `reviewing` → `released`

---

## Decisions log

| Decision | Resolution |
|---|---|
| Parser method | AI extraction via Anthropic API (claude-sonnet-4-6) |
| PDF persistence | Not persisted — processed in memory and discarded |
| `workType` | Extracted verbatim from PDF SERVICE field — no enum mapping |
| `builderContactPhone` | Returned raw as extracted — dispatcher corrects malformed numbers in review UI |
| `companyNotes` | IMPORTANT NOTES block copied verbatim + ROUGH/TRIM/SET lines appended |
| Refrigerant | Not extracted — resolved automatically from `catalog_equipment` by model number |
| Thermostat/accessories | AI matches against known catalog list; unmatched values remain in companyNotes |
| Address normalization | Uppercase + abbreviation expansion — backend utility, all intake flows |
| Address comparison scope | Street number + street name only (city/state/zip/subdivision excluded) |
| Partial match resolution | Dispatcher modal — no automatic merge |
| API cost | ~$0.02 per PDF (Sonnet 4.6 at $3/$15 per MTok) |

---

## Out of scope for F5

- OCR for scanned/image PDFs (current PDFs are text-based)
- Multi-technician route sheets in a single PDF (one tech per PDF assumed)
- Automatic release without dispatcher review
- PDF format validation beyond file type check
