# Use platform-agnostic base image with LTS version for better availability
FROM node:20-slim AS base

# Install base system dependencies for Playwright browsers and k6
# Note: Playwright's --with-deps will install additional required packages including fonts
RUN apt-get update && apt-get install -y \
    curl \
    tar \
    libglib2.0-0 \
    libnss3 \
    libnspr4 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libdbus-1-3 \
    libxcb1 \
    libxkbcommon0 \
    libx11-6 \
    libxcomposite1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    libpango-1.0-0 \
    libcairo2 \
    libasound2 \
    libatspi2.0-0 \
    libgtk-3-0 \
    libgdk-pixbuf2.0-0 \
    libxss1 \
    libxshmfence1 \
    ca-certificates \
    iputils-ping \
    && rm -rf /var/lib/apt/lists/* \
    && apt-get clean

# Build k6 with xk6-dashboard extension
FROM golang:1.23-alpine AS k6-builder
RUN apk add --no-cache git
# Enable Go toolchain auto-download for Go 1.24 requirement
ENV GOTOOLCHAIN=auto
RUN go install go.k6.io/xk6/cmd/xk6@latest
RUN xk6 build --with github.com/grafana/xk6-dashboard@latest
RUN chmod +x k6

# Get Docker CLI
FROM docker:27-cli AS docker-cli


# Build stage with dev dependencies
FROM base AS builder
WORKDIR /worker
COPY package.json package-lock.json* ./

# Install all dependencies for build with caching
RUN --mount=type=cache,target=/root/.npm \
    npm ci --legacy-peer-deps --no-audit --no-fund

COPY . .

# Build the NestJS application
RUN npm run build

# Production image using the same base with dependencies already installed
FROM base AS runner
WORKDIR /worker

# Add OCI labels to link package to repository
LABEL org.opencontainers.image.source=https://github.com/supercheck-io/supercheck
LABEL org.opencontainers.image.title="Supercheck Worker"
LABEL org.opencontainers.image.description="NestJS worker service for Supercheck - Executes Playwright tests, monitors endpoints, and processes background jobs with parallel execution capabilities. Includes all Playwright browsers (Chromium, Firefox, WebKit) and supports multi-architecture deployment."

ENV NODE_ENV=production

# Copy k6 binary with xk6-dashboard extension
COPY --from=k6-builder /go/k6 /usr/local/bin/k6
RUN chmod +x /usr/local/bin/k6
ENV K6_BIN_PATH=/usr/local/bin/k6

# Copy Docker CLI
COPY --from=docker-cli /usr/local/bin/docker /usr/local/bin/docker
RUN chmod +x /usr/local/bin/docker

# Create app user
RUN groupadd --system --gid 1001 nodejs && \
    useradd --system --uid 1001 --gid nodejs nodejs

# Copy only necessary files with proper ownership
COPY --from=builder --chown=nodejs:nodejs /worker/package*.json ./

# Install production dependencies with caching and memory limits
RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev --legacy-peer-deps --no-audit --no-fund --max-old-space-size=4096

COPY --from=builder --chown=nodejs:nodejs /worker/dist ./dist
COPY --from=builder --chown=nodejs:nodejs /worker/playwright.config.js ./

# Create directories for test execution with proper permissions
# Create video output directory for recording on test failures
# Create k6-reports directory for k6 performance test artifacts
RUN mkdir -p playwright-reports report \
    k6-reports \
    /home/nodejs/.npm \
    /home/nodejs/.cache \
    /root/.npm \
    /tmp/.npm \
    /tmp/playwright-tests \
    /tmp/playwright-videos && \
    chown -R nodejs:nodejs playwright-reports report k6-reports /worker /home/nodejs /root/.npm /tmp/.npm /tmp/playwright-tests /tmp/playwright-videos && \
    chmod -R 755 playwright-reports report k6-reports && \
    chmod -R 777 /home/nodejs/.npm /home/nodejs/.cache /root/.npm /tmp/.npm /tmp/playwright-tests /tmp/playwright-videos

# Set node home + npm cache to ensure Playwright/k6 sandboxes can write to npm cache directory
ENV HOME=/home/nodejs
ENV npm_config_cache=/home/nodejs/.npm
ENV NPM_CONFIG_CACHE=/home/nodejs/.npm

# Set Playwright browser cache path to standard location
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

# Install only Chromium browser for Playwright tests with cleanup
RUN npx playwright install chromium --with-deps && \
    npm cache clean --force && \
    rm -rf /tmp/*

# Add health check with dynamic port support
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD node -e "const http = require('http'); const port = process.env.PORT || 3001; const req = http.request({hostname: 'localhost', port: port, path: '/health', timeout: 5000}, (res) => process.exit(res.statusCode === 200 ? 0 : 1)); req.on('error', () => process.exit(1)); req.end();"

EXPOSE 8000

CMD ["node", "--max-http-header-size=16384", "dist/src/main.js"]
