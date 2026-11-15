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
