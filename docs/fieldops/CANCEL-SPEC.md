# Cancel

**Version:** 1.0
**Date:** 2026-07-30
**Status:** Closed design — not yet built (Cancel is currently unreachable in code, see Open Items)

## Purpose

Lets a technician formally close a visit where they've determined there's no action to take (system already resolved, customer not present, condition out of scope) — without forcing the full work flow (Service/Tstat/Acc/Fix/Weigh-In), but without any exception to the rule that every call requires a Completion Report. Prevents visits going unrecorded, and avoids unnecessary friction when there's objectively nothing to do.

## Entry points

Two, same mechanism:
- **My Calls** — from the expanded card, before Start Report.
- **Workspace** — from the Active Job banner, mid-flow.

Not a distinct flow — it reuses the Notes step and ends in the same Generate Report. Independent of Transfer (Transfer moves the visit to another technician; Cancel closes it with no action taken).

## Flow

The ✕ button opens the Notes step directly — no intermediate confirmation dialog. Freely interruptible: closing the sheet without pressing Generate Report has no effect, nothing is saved.

Once in Notes, the technician sees the same Checklist + Notes + photo evidence structure as any normal visit — see `/docs/fieldops/workspace/CHECKLIST-NOTES-SPEC.md`. There is no separate "Cancel mode" for that step.

## Justification rule

Generate Report is blocked only if **both** Notes and Checklist are empty — either one on its own is enough to proceed.

## Confirmation

Same Generate Report button as any visit. Produces the Completion Report with empty work sections (no Service/Acc/Fix/Weigh-In data) and Checklist + Notes as the main content. No exception for Cancel in P-drain handling — same static-reminder-text behavior as any other visit.

## History

Same record structure as any visit — empty work sections plus Notes communicate on their own that it was a no-action visit. No separate Cancel flag or distinct History treatment.

## Open Items

- Not yet built: the Active Job banner (address · subdivision · builder · system count · price · ✕) described in `/docs/fieldops/workspace/WORKSPACE-SHELL.md` doesn't currently exist in code, and Cancel has no other entry point in Workspace right now — a technician mid-job cannot currently cancel at all. The My Calls entry point also isn't built. Both need to be built for this design to be reachable.
