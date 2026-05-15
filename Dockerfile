FROM oven/bun:1.3.11-alpine AS base

WORKDIR /app
ENV NODE_ENV=production

COPY package.json bun.lock tsconfig.json ./
COPY apps/admin-console/client/package.json ./apps/admin-console/client/package.json
COPY apps/admin-console/server/package.json ./apps/admin-console/server/package.json
COPY packages/admin-contracts/package.json ./packages/admin-contracts/package.json
# Runtime modules still import the TypeScript compiler API through the server module graph.
RUN bun install --frozen-lockfile

COPY src ./src
COPY migrations ./migrations
COPY packages ./packages
COPY apps/admin-console ./apps/admin-console

FROM base AS admin-console
RUN bun run admin:client:build
ENV ADMIN_STATIC_ASSETS_DIR=/app/apps/admin-console/client/dist
EXPOSE 3100
CMD ["bun", "apps/admin-console/server/src/index.ts"]

FROM base AS mcp-http-server
EXPOSE 3000
CMD ["bun", "src/http.ts"]
