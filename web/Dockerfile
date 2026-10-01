FROM node:26-slim AS base
# Node 26 no longer bundles corepack; install pnpm directly instead.
RUN npm install -g pnpm@12.6.0
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

# Live-reloading dev server -- this is the stage docker-compose.yml builds
# for local development (source is bind-mounted over it).
FROM deps AS dev
COPY . .
EXPOSE 3000
CMD ["pnpm", "dev"]

FROM deps AS builder
COPY . .
RUN pnpm run build \
 && mkdir -p /sharp-bundle \
 && cp -aL node_modules/sharp /sharp-bundle/sharp

# Production image -- this is the default target, used by Kamal.
FROM base AS runner
ENV NODE_ENV=production
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
# Standalone tracing skips sharp's libvips directory (see next.config.ts).
# This copy follows pnpm's symlinks so the decoder is a real directory.
COPY --from=builder /sharp-bundle/sharp ./node_modules/sharp

EXPOSE 3000
ENV PORT=3000
CMD ["node", "server.js"]
