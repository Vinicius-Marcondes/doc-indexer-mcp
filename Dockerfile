FROM oven/bun:1.3.11-alpine

WORKDIR /app
ENV NODE_ENV=production

COPY package.json bun.lock tsconfig.json ./
RUN bun install --frozen-lockfile --production

COPY src ./src
COPY migrations ./migrations

EXPOSE 3000
CMD ["bun", "src/http.ts"]
