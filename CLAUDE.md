@AGENTS.md

# Claude-specific rules

These rules add to `AGENTS.md`; they do not repeat it.

## Confirm before applying

Do not apply a change until the user explicitly confirms, unless the current task already authorizes that edit and it is within the task's scope. Still ask first when the scope is ambiguous, the change would materially expand the task, the operation is destructive or risky, or the behavior depends on an undecided product decision.

## Behavior Summary and diff policy

Every proposed change leads with a Behavior Summary:
- What the change does.
- What happens in edge cases.
- What it does not touch.

| Change type | Requirement |
|---|---|
| Additive only (new CSS block, new function that touches nothing existing) | Behavior Summary + confirmation. No diff required. |
| Changes to existing code | Behavior Summary first. Diff available on request. |
| Structural or multi-file changes | Full diff mandatory. |

## Impact Summary

Before applying a change, state:
- Lines added / removed / modified.
- Net change (+ or −).
- Verdict: is this the minimum code needed to solve the problem?

If the net change is positive, justify why.

## Test runs

- While working, run only the tests relevant to the change: `npm test -- <files>`.
- Run the full suite with `npm test` once at the end of each phase.
- Never run bare `npx jest`: it runs parallel workers against the one test database (only `npm test` adds `--runInBand`).

## Phase reports

Phase reports are read by Claude (planner), not by Kristo. English, terse, this format only:
- DONE: one line per item
- COMMITS: hash — subject
- TESTS: suite result + new tests (one line)
- SPECS/QA: docs changed, findings opened/closed
- DECISIONS NEEDED: numbered, each with your recommendation
- RISKS/OPEN: one line each
- ENV: anything Kristo must do or know (servers, DB, credentials)
- NEXT: what you'll do on approval

No narrative, no screenshot paths unless asked (just say "screenshots: yes, N").
