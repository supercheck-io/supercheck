##############################################
# BASE STAGE
##############################################
FROM node:20-slim AS base

RUN apt-get update && apt-get install -y \
    curl tar gosu \
    libglib2.0-0 libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 \
    libdbus-1-3 libxcb1 libxkbcommon0 libx11-6 libxcomposite1 libxdamage1 \
    libxext6 libxfixes3 libxrandr2 libgbm1 libpango-1.0-0 libcairo2 libasound2 \
    libatspi2.0-0 libgtk-3-0 libgdk-pixbuf2.0-0 libxss1 libxshmfence1 \
    ca-certificates iputils-ping \
    && rm -rf /var/lib/apt/lists/* \
    && apt-get clean

##############################################
# k6 + xk6-dashboard BUILDER 
##############################################
FROM golang:1.24 AS k6-builder
WORKDIR /k6src

RUN go install go.k6.io/xk6/cmd/xk6@latest

# Explicit output path prevents ambiguity
RUN xk6 build --with github.com/grafana/xk6-dashboard@latest --output /k6src/k6

##############################################
# DEPS
##############################################
FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev --legacy-peer-deps --no-audit --no-fund

##############################################
# BUILD
##############################################
FROM base AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

RUN --mount=type=cache,target=/root/.npm \
    npm ci --legacy-peer-deps --no-audit --no-fund

RUN npm run build

##############################################
# BROWSER BUILDER (separate stage to optimize disk usage)
##############################################
FROM base AS browser-builder
WORKDIR /ms-playwright

ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

# Install only Chromium browser with dependencies
RUN npx playwright install --with-deps chromium

##############################################
# RUNNER (FINAL STAGE)
##############################################
FROM base AS runner
WORKDIR /app

# Lightweight Docker CLI (official binary only)
COPY --from=docker:cli /usr/local/bin/docker /usr/local/bin/docker

LABEL org.opencontainers.image.source="https://github.com/supercheck-io/supercheck"
LABEL org.opencontainers.image.title="Supercheck Worker"
LABEL org.opencontainers.image.description="Worker service for Supercheck - Handles test execution (Playwright, k6), job processing, and monitoring with containerized isolation."

ENV NODE_ENV=production

# Create non-root user with explicit UID/GID for security
RUN groupadd --system --gid 1001 nodejs && \
    useradd --system --uid 1001 --gid nodejs nodejs

COPY --from=deps --chown=nodejs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nodejs:nodejs /app/dist ./dist
COPY --from=builder --chown=nodejs:nodejs /app/playwright.config.js ./
COPY --from=browser-builder --chown=nodejs:nodejs /ms-playwright /ms-playwright
COPY --from=k6-builder /k6src/k6 /usr/local/bin/k6

RUN chmod +x /usr/local/bin/k6

# Create writable directories for reports
RUN mkdir -p /app/playwright-reports /app/k6-reports /app/report \
    && chown -R nodejs:nodejs /app

# Playwright browsers are pre-installed in /ms-playwright
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

EXPOSE 3001

# Health check for container orchestration
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD curl -f http://localhost:3001/health || exit 1

##############################################
# ENTRYPOINT: Configure docker.sock permissions and start app
# Note: Runs as root initially to fix docker socket permissions,
# then switches to nodejs user for the main application
##############################################
ENTRYPOINT ["sh", "-c", " \
    if [ -S /var/run/docker.sock ]; then \
        sock_gid=$(stat -c %g /var/run/docker.sock); \
        addgroup --gid $sock_gid dockergroup 2>/dev/null || true; \
        adduser nodejs dockergroup 2>/dev/null || true; \
    fi; \
    gosu nodejs node dist/src/main.js \
"]
