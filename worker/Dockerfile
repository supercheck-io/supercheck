##############################################
# BASE STAGE
##############################################
FROM node:20-slim AS base

RUN apt-get update && apt-get install -y \
    curl tar \
    libglib2.0-0 libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 \
    libdbus-1-3 libxcb1 libxkbcommon0 libx11-6 libxcomposite1 libxdamage1 \
    libxext6 libxfixes3 libxrandr2 libgbm1 libpango-1.0-0 libcairo2 libasound2 \
    libatspi2.0-0 libgtk-3-0 libgdk-pixbuf2.0-0 libxss1 libxshmfence1 \
    ca-certificates iputils-ping \
    && rm -rf /var/lib/apt/lists/*

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

# Install Playwright browsers directly to /ms-playwright (production location)
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN npx playwright install --with-deps

RUN npm run build

##############################################
# RUNNER (FINAL STAGE)
##############################################
FROM base AS runner
WORKDIR /app

# Lightweight Docker CLI (official binary only)
COPY --from=docker:cli /usr/local/bin/docker /usr/local/bin/docker

LABEL org.opencontainers.image.source="https://github.com/supercheck-io/supercheck"

ENV NODE_ENV=production

# non-root user
RUN groupadd --system nodejs && useradd --system --gid nodejs nodejs

COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/playwright.config.js ./
COPY --from=builder /ms-playwright /ms-playwright
COPY --from=k6-builder /k6src/k6 /usr/local/bin/k6

RUN chmod +x /usr/local/bin/k6

# Writable dirs
RUN mkdir -p /app/playwright-reports /app/k6-reports /app/report \
    && chown -R nodejs:nodejs /app

ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

USER nodejs

EXPOSE 3001

##############################################
# ENTRYPOINT: FIX docker.sock group at runtime
##############################################
ENTRYPOINT ["sh", "-c", " \
    if [ -S /var/run/docker.sock ]; then \
        sock_gid=$(stat -c %g /var/run/docker.sock); \
        addgroup --gid $sock_gid dockergroup 2>/dev/null || true; \
        adduser nodejs dockergroup 2>/dev/null || true; \
    fi; \
    exec node dist/src/main.js \
"]
