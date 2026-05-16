# Task 17: Final Cleanup And Traceability

## Goal

Remove temporary migration scaffolding and prove the PRD is implemented end to end.

## Scope

- Remove temporary re-export shims that are no longer needed.
- Mark traceability checklist rows complete.
- Update tracker conclusion.
- Run final focused and root verification.
- Document any residual risks.

## Out Of Scope

- Do not add new product behavior.
- Do not make unrelated refactors.
- Do not remove compatibility wrappers unless docs and tests agree.

## Required Tests

```text
bun test
bun run typecheck
bun run check
bun run build:admin
```

If the baseline OpenAI provider test remains environment-sensitive, fix or isolate that test before claiming final completion.

## Acceptance Criteria

- Traceability checklist is complete.
- Tracker marks all tasks done.
- Temporary shims are removed or explicitly tracked.
- Full deterministic gates pass.
- Final implementation matches the PRD definition of done.

