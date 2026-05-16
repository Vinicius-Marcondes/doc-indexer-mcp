FROM oven/bun:1.3.11-alpine

WORKDIR /app
ENV NODE_ENV=production

COPY package.json bun.lock tsconfig.json ./
COPY apps ./apps
COPY packages ./packages
COPY scripts ./scripts
COPY src ./src
COPY migrations ./migrations

RUN bun install --frozen-lockfile
RUN bun run admin:client:build

EXPOSE 3000
EXPOSE 3100
CMD ["sh", "-c", "bun run db:migrate && exec bun apps/mcp-http/src/index.ts"]
