FROM node:26-slim AS base
# Node 26 no longer bundles corepack; install pnpm directly instead.
RUN npm install -g pnpm@12.6.0
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
# On Linux x64 the postinstall replaces the bundled CPU libonnxruntime
# with the CUDA build. This host has no GPU libraries for that build.
RUN ONNXRUNTIME_NODE_INSTALL_CUDA=skip pnpm install --frozen-lockfile

# Live-reloading dev server -- this is the stage docker-compose.yml builds
# for local development (source is bind-mounted over it).
FROM deps AS dev
COPY . .
EXPOSE 3000
CMD ["pnpm", "dev"]

FROM deps AS builder
COPY . .
# onnxruntime-node is transitive, so pnpm does not hoist it to node_modules/.
RUN pnpm run build \
 && mkdir -p /sharp-bundle /onnx-libs \
 && cp -aL node_modules/sharp /sharp-bundle/sharp \
 && onnx_dir=$(find node_modules/.pnpm -type d -path '*/onnxruntime-node/bin/napi-v3/linux/x64' -print -quit) \
 && test -f "$onnx_dir/libonnxruntime.so.1" \
 && cp -aL "$onnx_dir/." /onnx-libs/ \
 && find .next/standalone -name onnxruntime_binding.node -exec dirname {} \; \
    | while read -r dir; do cp -aL /onnx-libs/. "$dir/"; done

# Production image -- this is the default target, used by Kamal.
FROM base AS runner
ENV NODE_ENV=production
# onnxruntime_binding.node needs libonnxruntime.so.1 beside it ($ORIGIN).
# Standalone tracing copies the .node file and leaves the .so behind, so the
# dynamic linker never finds it. These CPU binaries ship inside the npm package.
ENV LD_LIBRARY_PATH=/onnx-libs
COPY --from=builder /onnx-libs /onnx-libs
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
# Standalone tracing skips sharp's libvips directory (see next.config.ts).
# This copy follows pnpm's symlinks so the decoder is a real directory.
COPY --from=builder /sharp-bundle/sharp ./node_modules/sharp

EXPOSE 3000
ENV PORT=3000
CMD ["node", "server.js"]
