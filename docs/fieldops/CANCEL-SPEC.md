# Cancel

**Version:** 1.0
**Date:** 2026-07-30
**Status:** Closed design

## Purpose

Lets a technician formally close a visit where they've determined there's no action to take (system already resolved, customer not present, condition out of scope) — without forcing the full work flow (Service/Tstat/Acc/Fix/Weigh-In), but without any exception to the rule that every call requires a Completion Report. Prevents visits going unrecorded, and avoids unnecessary friction when there's objectively nothing to do.

## Entry points

Two, same mechanism:
- **My Calls** — from the expanded card, before Start Report.
- **Workspace** — from the Active Job banner, mid-flow.

Not a distinct flow — it reuses the Notes step and ends in the same Generate Report. Independent of Transfer (Transfer moves the visit to another technician; Cancel closes it with no action taken).

## Flow

Either entry point first shows the irreversible confirmation dialog: **“Cancel this call? This action is irreversible. Current Service, items, Weigh-In data, and pricing will be cleared. Notes and Checklist will be kept.”** Its actions are **Keep Working** and **Cancel Call**. Dismissing it leaves the current context and Local Visit Draft unchanged.

After confirmation, FieldOps enters Cancel mode in the Local Visit Draft and opens the Notes step. Service/Finish, thermostat, accessories, fixes, Weight-In-Data, local Weigh-In work, and the local total are cleared; normal work options are unavailable. Existing Notes and Checklist answers remain available as the justification. This local mode is durable across reopen/offline recovery. It does not itself mutate shared visit work or finalize the visit.

Freely interruptible: leaving Workspace without Generate Report does not finalize cancellation. The confirmed Cancel draft remains locally pending under the offline-first contract; no cancellation is delivered until the Generate Report submission is acknowledged by the backend. In My Calls, this local state is shown as **Cancel Pending** with **Continue Cancel**; it is not the backend terminal `cancelled` state, does not offer a second Cancel action, and opens the existing Notes/Checklist Cancel mode without another confirmation. See `/docs/OFFLINE-FIRST-CONTRACT.md`.

Once in Notes, the technician sees the same Checklist + Notes + photo evidence structure as any normal visit — see `/docs/fieldops/workspace/CHECKLIST-NOTES-SPEC.md`. Cancel mode is not a separate workflow or screen; it is the active-draft state that leaves only this justification content editable.

## Justification rule

Generate Report is blocked only if **both** Notes and Checklist are empty — either one on its own is enough to proceed.

## Confirmation

Same Generate Report button as any visit. Produces the Completion Report with empty work sections (no Service/Acc/Fix/Weigh-In data) and Checklist + Notes as the main content. No exception for Cancel in P-drain handling — same static-reminder-text behavior as any other visit.

## History

Same record structure as any visit — it shows the `Cancel $0` service representation, preserves Notes and Checklist as the justification, and suppresses normal work sections and work-specific evidence. No separate Cancel flag or distinct History treatment.
