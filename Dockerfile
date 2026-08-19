# Scriptorium — production image
# Multi-stage: build the SvelteKit app (adapter-node), then a slim runtime
# with production dependencies (native prebuilds for better-sqlite3/argon2).

# ---------------------------------------------------------------- build ----
FROM node:22-bookworm AS build
WORKDIR /repo

# Workspace manifests first for layer caching.
COPY package.json package-lock.json* ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci --no-audit --no-fund

# Full source (excluding data/git via .dockerignore).
COPY . .

# Production build of the SvelteKit app → web/build (adapter-node).
RUN npm run build -w web

# --------------------------------------------------------------- runtime ---
FROM node:22-slim AS runtime
ENV NODE_ENV=production \
    PORT=8787 \
    DATA_DIR=/data \
    HOST=0.0.0.0

# Non-root user.
RUN useradd --create-home --uid 10001 scribe
WORKDIR /repo

COPY package.json package-lock.json* ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci --omit=dev --no-audit --no-fund \
    && npm cache clean --force

# App: the framework-agnostic backend + the built SvelteKit server.
COPY server/ server/
COPY --from=build /repo/web/build web/build/

RUN mkdir -p /data && chown -R scribe:scribe /data /repo
USER scribe
VOLUME ["/data"]
EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "web/build/index.js"]