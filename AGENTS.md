# FieldOps Agent Instructions

## Scope

These instructions apply to coding agents working in this repository.

## Source of Truth Hierarchy

Use this order:

1. Explicit user/product decisions made in the current task.
2. `AGENTS.md` for repository-wide agent workflow.
3. `CLAUDE.md` for Claude-specific behavior, when applicable.
4. `docs/OVERVIEW.md` for product/documentation navigation.
5. The owning current feature specification for the requested behavior.
6. `docs/status/MASTER-FUNCTION-INDEX.md` for implementation/specification audit status.
7. `docs/status/QA-TRACKER.md` for QA status.
8. `docs/_archive/` is historical context only and must not be treated as current product direction.

If two current documents conflict, stop and report the conflict rather than inventing a resolution.

## FieldOps Change Protocol

Follow:

DOC → ACTION → TEST → VERIFY → COMMIT → PUSH

Before editing:

* Identify the authoritative documentation for the task.
* Confirm that the requested behavior is sufficiently specified.
* Inspect the current implementation before changing it.
* Identify unrelated pre-existing changes and protect them.

If documentation is incomplete or contradictory:

* Do not invent behavior.
* Report the ambiguity.
* Prefer correcting the authoritative documentation before implementing behavior when appropriate.

During implementation:

* Apply the smallest correct change.
* Do not add anticipatory or speculative code.
* Do not implement future requirements "just in case."
* Do not refactor unrelated code.
* Do not perform opportunistic cleanup.
* Do not modify unrelated files.
* Preserve existing behavior unless the task explicitly changes it.
* Reuse existing components, utilities, services, and patterns when appropriate.
* Do not introduce a new abstraction merely because one could be useful later.

Testing:

* Run relevant existing tests.
* Add focused tests when the changed behavior requires coverage.
* Keep testing proportional to the change.
* Do not create unnecessary test infrastructure.

Verification:

* Verify that the implementation matches the authoritative specification.
* Verify that unrelated behavior was not changed.
* If implementation must deviate from the specification, stop and report why.

Git:

* Keep one conceptual change per commit.
* Do not include unrelated pre-existing changes.
* Use concise English commit messages.
* Push only when the change has been tested and verified, or when explicitly requested.
* Never rewrite, discard, or absorb another person's uncommitted work.

Important distinction:
`SPEC CLOSED` does NOT mean `IMPLEMENTED`.
`IMPLEMENTED` does NOT mean `QA VERIFIED`.

## Language

* Conversational communication with Kristo: Spanish.
* Code: English.
* Identifiers: English.
* Code comments: English.
* Technical documentation: English unless the existing document explicitly uses another language.
* Commit messages: English.

## Product Discipline

FieldOps is an existing product with established UX and operational rules.

Do not redesign an existing workflow while implementing a narrowly scoped fix.

Do not assume that a technically cleaner implementation is automatically a better product decision.

When product behavior is ambiguous, stop and ask/report rather than inventing behavior.

## Out-of-Scope Discipline

Do not implement features listed as intentionally out of scope unless explicitly requested.

Do not reactivate archived or deferred functionality merely because related code exists.

## Completion Requirement

Before considering a task complete, report:

* Files changed.
* Documentation used.
* Implementation performed.
* Tests executed and results.
* Verification result.
* Commit hash if committed.
* Push status if pushed.
* Any remaining issue or ambiguity.
