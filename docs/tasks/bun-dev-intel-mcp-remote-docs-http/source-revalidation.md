# Source Revalidation - Remote Docs HTTP MCP

Checked date: 2026-05-14

Task: [00 - Revalidate Official Sources And Implementation Assumptions](00-revalidate-official-sources.md)

## Summary

The PRD remains implementable without correction. Hono is still viable on Bun, MCP Streamable HTTP remains the current remote transport, OpenAI `text-embedding-3-small` remains a valid default embedding model, and pgvector has current Docker image tags suitable for local development and deployment.

The main implementation conclusion is that new remote HTTP work should use the current MCP TypeScript SDK split-package path already reflected by the local dependency family, not the older `@modelcontextprotocol/sdk` import style. The existing `@modelcontextprotocol/server@2.0.0-alpha.2` dependency can be kept as the MCP server package, but Task 01 should add the HTTP/framework dependencies explicitly.

## Checked Sources

| Area | URL | Conclusion |
| --- | --- | --- |
| MCP Streamable HTTP spec | https://modelcontextprotocol.io/specification/2025-11-25/basic/transports | Streamable HTTP is the current standard HTTP transport. It uses one endpoint supporting POST and GET; DELETE is used for session termination. Origin validation and authentication remain required security controls for HTTP MCP servers. |
| MCP authorization spec | https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization | Authorization is defined for HTTP transports; V1 shared bearer-token auth remains a valid simpler product choice because the PRD explicitly excludes full OAuth. |
| MCP TypeScript SDK repository | https://github.com/modelcontextprotocol/typescript-sdk | Current main branch is v2/pre-alpha and documents split packages: `@modelcontextprotocol/server`, `@modelcontextprotocol/client`, plus optional middleware packages including `@modelcontextprotocol/hono`. The repo still states v1.x is the recommended production line, so the existing v2-alpha choice remains an explicit project risk rather than a new blocker. |
| MCP TypeScript server guide | https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/server.md | V2 server imports use `McpServer` from `@modelcontextprotocol/server`, `StdioServerTransport` from `@modelcontextprotocol/server/stdio`, and `NodeStreamableHTTPServerTransport` from `@modelcontextprotocol/node`. It also points to a Hono/Web Standard Streamable HTTP example. |
| MCP Hono example | https://raw.githubusercontent.com/modelcontextprotocol/typescript-sdk/main/examples/server/src/honoWebStandardStreamableHttp.ts | Official example wires Hono to `WebStandardStreamableHTTPServerTransport` from `@modelcontextprotocol/server` and routes `app.all('/mcp', c => transport.handleRequest(c.req.raw))`. This is the preferred Bun/Hono candidate because it uses Web Standard `Request`/`Response`. |
| MCP middleware README | https://raw.githubusercontent.com/modelcontextprotocol/typescript-sdk/main/packages/middleware/README.md | Middleware packages are intentionally thin adapters. `@modelcontextprotocol/hono` provides Hono helpers, body parsing hooks, and host-header validation; business logic should remain outside middleware. |
| MCP releases | https://github.com/modelcontextprotocol/typescript-sdk/releases | `@modelcontextprotocol/server@2.0.0-alpha.2` and `@modelcontextprotocol/hono@2.0.0-alpha.2` are published pre-release lines; the alpha.2 release notes mention export-resolution fixes. |
| Hono basic docs | https://hono.dev/docs/getting-started/basic | Hono exposes simple route handlers, JSON responses, raw `Response` support, and middleware patterns suitable for the thin HTTP shell required by the PRD. |
| Hono Bun docs | https://hono.dev/docs/getting-started/bun | Hono works on Bun; an existing Bun project adds `hono` with `bun add hono`, exports `fetch: app.fetch`, and can be tested with `bun:test`. |
| Hono Web Standards docs | https://hono.dev/docs/concepts/web-standard | Hono uses Web Standard `Request`/`Response`/`Headers` APIs and supports Bun, matching the MCP Web Standard transport path. |
| Hono bearer auth middleware | https://hono.dev/docs/middleware/builtin/bearer-auth | `hono/bearer-auth` verifies `Authorization: Bearer <token>` headers. Task 03 should still test token format and query-string token rejection per PRD. |
| Hono body limit middleware | https://hono.dev/docs/middleware/builtin/body-limit | `hono/body-limit` supports request-size limits; on Bun, `Bun.serve` also has a default body limit that must be considered if larger limits are configured. |
| Hono secure headers middleware | https://hono.dev/docs/middleware/builtin/secure-headers | `hono/secure-headers` is available for default secure headers in the HTTP shell. |
| OpenAI embeddings guide | https://platform.openai.com/docs/guides/embeddings | `text-embedding-3-small` and `text-embedding-3-large` are still current embedding models. Defaults are 1536 dimensions for small and 3072 for large, with optional dimension reduction. |
| OpenAI embeddings API reference | https://platform.openai.com/docs/api-reference/embeddings/create | Embeddings are created with `POST /v1/embeddings`; input can be a string or array, valid models include `text-embedding-3-small` and `text-embedding-3-large`, and responses include `data[].embedding`, `model`, and token usage. |
| OpenAI model page | https://platform.openai.com/docs/models/text-embedding-3-small | `text-embedding-3-small` supports the `v1/embeddings` endpoint and remains the cost-oriented default candidate. |
| pgvector README | https://github.com/pgvector/pgvector | pgvector supports Postgres 13+, `CREATE EXTENSION vector`, `vector(n)` columns, L2/inner-product/cosine operators, exact search by default, HNSW and IVFFlat indexes, and hybrid search with Postgres full-text search. |
| pgvector Docker tags | https://github.com/pgvector/pgvector#docker | Current Docker image family includes `pgvector/pgvector:pg18-trixie` and pinned `0.8.2-pg18-trixie` tags, plus Postgres 13-18 variants. |
| PostgreSQL full-text search | https://www.postgresql.org/docs/current/textsearch.html | PostgreSQL 18 is current, and Chapter 12 remains the primary reference for full-text search tables, indexes, ranking, and highlighting. |
| Docker Compose services | https://docs.docker.com/reference/compose-file/services/ | Compose service definitions support `image`, `healthcheck`, and service dependency configuration needed later for HTTP, worker, and Postgres services. |
| Docker Compose environment variables | https://docs.docker.com/compose/how-tos/environment-variables/set-environment-variables/ | Compose supports `environment` and `env_file`; Docker docs warn against passing sensitive values as plain environment variables where secrets are more appropriate. The PRD still requires env vars for V1, so examples must avoid checked-in secret values. |
| Bun docs index | https://bun.com/docs/llms.txt | Official Bun docs expose an LLM index with individual `https://bun.com/docs/...` page links. |
| Bun full docs | https://bun.com/docs/llms-full.txt | Official Bun docs full corpus remains available for source-backed fallback and fixture-style deterministic tests. |

## Package And Import Candidates

Preferred MCP server package path for this project:

```ts
import { McpServer, WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
```

Preferred Hono/Bun HTTP shell candidates:

```ts
import { Hono } from 'hono';
import { bearerAuth } from 'hono/bearer-auth';
import { bodyLimit } from 'hono/body-limit';
import { secureHeaders } from 'hono/secure-headers';
```

Optional MCP Hono helper candidate for Task 04:

```ts
import { createMcpHonoApp } from '@modelcontextprotocol/hono';
```

Node/Express fallback candidate only if the Web Standard path fails:

```ts
import { NodeStreamableHTTPServerTransport } from '@modelcontextprotocol/node';
```

Older v1 package style, not preferred for this v2-alpha codebase:

```ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
```

## Implementation Conclusions

- MCP transport: use Streamable HTTP only for the remote server. Do not add deprecated HTTP+SSE routes.
- MCP package plan: keep the existing `@modelcontextprotocol/server@2.0.0-alpha.2` family for continuity, and add Hono/HTTP dependencies in Task 01. The direct Web Standard transport path can satisfy Bun/Hono without Express.
- SDK risk: v2 is still documented as pre-alpha while v1.x remains the production recommendation. This was already an explicit project risk and does not block this PRD, but Task 01 should pin exact versions and include import smoke tests.
- Hono: viable on Bun. Use Hono for the thin HTTP shell, auth, body limits, secure headers, origin/host validation, and `/healthz`/`/readyz`; keep docs business logic outside the app layer.
- Embeddings: keep `text-embedding-3-small` as the default model. Store provider, model, dimensions, and embedding version; default dimension is 1536 unless configured.
- pgvector: use `pgvector/pgvector:0.8.2-pg18-trixie` as the preferred pinned local/deployment image candidate, with `pgvector/pgvector:pg18-trixie` available as the moving Postgres 18 tag. Use `CREATE EXTENSION vector`; prefer HNSW for retrieval-heavy vector search when approximate indexing becomes useful.
- Bun docs source policy: allow only `https://bun.com/docs/llms.txt`, `https://bun.com/docs/llms-full.txt`, and individual `https://bun.com/docs/...` pages for V1 remote docs ingestion.
- PRD correction: none required for Task 00.
