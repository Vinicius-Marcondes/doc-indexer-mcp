# Task 00 - Revalidate Official Sources And Implementation Assumptions

## Goal

Verify current official sources before any implementation begins, because MCP Streamable HTTP, SDK package names, OpenAI embedding models, and pgvector deployment details can change.

## Motivation

The existing project already hit an SDK mismatch where the documented stdio export was missing from the installed package. The HTTP work is even more sensitive to SDK package layout and protocol behavior. This task prevents building the architecture on stale documentation.

## Scope

- Read the remote docs HTTP PRD.
- Revalidate MCP Streamable HTTP transport docs.
- Revalidate MCP TypeScript SDK package names, Hono middleware, and Streamable HTTP examples.
- Revalidate OpenAI embedding model names and request/response shape.
- Revalidate pgvector installation, vector column/index behavior, and Docker image options.
- Revalidate Hono on Bun routing and middleware patterns.
- Record findings in a source revalidation note under this task directory.

## Out Of Scope

- No implementation code.
- No dependency installation.
- No database migrations.
- No task tracker status changes beyond this task.

## Implementation Guidance

- Use only official/primary sources.
- Record checked date and exact URLs.
- Include explicit package import candidates for MCP/Hono integration.
- Include whether the current `@modelcontextprotocol/server` dependency can be kept or must be changed.
- If a PRD assumption is wrong, stop and update the PRD before continuing to Task 01.

## Tests To Implement First

No product tests are required for this documentation-only task.

If a docs lint/check system exists by implementation time, add a lightweight test that asserts the revalidation note exists.

## Validation

- The revalidation note exists.
- The note lists checked sources, dates, and conclusions.
- Any PRD mismatch is explicitly captured.

## Acceptance Criteria

- The implementation team knows which MCP SDK package and transport integration path to use.
- The default embedding model choice is confirmed or revised.
- The Postgres/pgvector local development image choice is confirmed or deferred with a reason.
- Hono remains viable or a PRD update is requested.

## Commit Guidance

Commit only the revalidation note and any PRD correction needed by this task.

Suggested message:

```text
docs: revalidate remote docs HTTP implementation sources
```
