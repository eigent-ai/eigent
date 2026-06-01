# syntax=docker/dockerfile:1.7
#
# Build the dual-entry web-ui bundle and serve it from nginx:alpine.
#
# Build context is the repo root only to reuse the root package-lock. The
# web-ui source and build config do not import the desktop frontend under src/.
#
# Usage:
#   docker build -f web-ui/Dockerfile -t eigent-web-ui .
#   docker run -p 8080:80 eigent-web-ui

ARG NODE_IMAGE=node:20-bookworm-slim
ARG NGINX_IMAGE=nginx:1.27-alpine

# -----------------------------------------------------------------------------
# Stage 1: build the web-ui dist with vite
# -----------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS build

WORKDIR /repo

# Skip husky during npm ci (no .git inside the build context, would noisy-fail).
ENV HUSKY=0
# Disable optional electron-related downloads we don't need for a web build.
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1
ENV PUPPETEER_SKIP_DOWNLOAD=1

# Install deps first to maximize layer cache reuse.
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --no-audit --no-fund --ignore-scripts

# Copy the standalone web-ui source and config.
COPY web-ui/ ./web-ui/

# Vite needs a valid env file to resolve loadEnv() calls; provide an empty one
# if none was copied in. Real config is injected by Dokploy/Traefik in front.
RUN test -f .env.production || touch .env.production

# Bundle outputs:
#   web-ui/dist/index.html      (full web-app entry: /login, /projects, ...)
#   web-ui/dist/remote.html     (public remote-control entry: /remote-control/*)
#   web-ui/dist/assets/*        (hashed JS/CSS/images)
RUN npm run build:web-ui

# -----------------------------------------------------------------------------
# Stage 2: serve dist via nginx:alpine
# -----------------------------------------------------------------------------
FROM ${NGINX_IMAGE} AS runtime

# Replace the default site config with our dual-SPA-fallback config.
RUN rm /etc/nginx/conf.d/default.conf
COPY web-ui/nginx.conf /etc/nginx/conf.d/default.conf

# Copy the built bundle.
COPY --from=build /repo/web-ui/dist /usr/share/nginx/html

# nginx:alpine entrypoint already runs nginx in foreground; just expose 80.
EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget -qO- --timeout=2 http://127.0.0.1/ >/dev/null 2>&1 || exit 1
