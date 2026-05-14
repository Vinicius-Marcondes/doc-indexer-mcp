# Task 08: Build Search Lab and result diagnostics

## Goal

Implement the Search Lab page for admin-only retrieval debugging.

## Why

Admins need to see how indexed docs search behaves, including freshness, confidence, citations, and scores.

## Scope

- Query form.
- Source selector.
- Mode segmented control:
  - hybrid
  - keyword
  - semantic
- Limit input.
- Optional force refresh toggle.
- Results list with:
  - title
  - URL
  - heading path
  - snippet
  - score
  - keyword score
  - vector score
  - rerank score
  - freshness
  - confidence
  - warnings
  - page/chunk links
  - citations
- Empty and low-confidence states.

## Out Of Scope

- No public docs search.
- No query autocomplete.

## Required Tests

- Frontend tests:
  - search form submits contracted input.
  - mode selection changes request mode.
  - warnings render.
  - page and chunk links are generated.
  - zero-result state renders.

## Acceptance Criteria

- Search Lab uses admin API, not direct MCP browser calls.
- Search result diagnostics expose enough scoring metadata to debug ranking.
- Force refresh status is visible when requested.
