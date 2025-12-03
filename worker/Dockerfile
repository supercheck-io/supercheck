# Use official Playwright image which includes all browsers and dependencies
# This avoids the heavy "npx playwright install" step that causes OOM on runners
# Includes Chromium, Firefox, and WebKit (Safari) browsers
FROM mcr.microsoft.com/playwright:v1.57.0-noble AS base

# Build k6 with xk6-dashboard extension
FROM golang:1.24-alpine AS k6-builder
RUN apk add --no-cache git
# xk6 requires Go 1.24+. Using golang:1.24-alpine image has it built-in, avoiding memory-intensive downloads
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
# Note: Playwright image includes 'pwuser' (UID 1000) for secure non-root execution
# We also create 'nodejs' user for the worker service itself
# Container execution uses 'pwuser' for security (untrusted user code)
RUN groupadd --system --gid 1002 nodejs && \
    useradd --system --uid 1002 --gid nodejs nodejs

# Copy only necessary files with proper ownership
COPY --from=builder --chown=nodejs:nodejs /worker/package*.json ./

# Install production dependencies with caching and memory limits
RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev --legacy-peer-deps --no-audit --no-fund --max-old-space-size=4096

COPY --from=builder --chown=nodejs:nodejs /worker/dist ./dist
COPY --from=builder --chown=nodejs:nodejs /worker/playwright.config.js ./

# Create directories for test execution with proper permissions
# Note: Container execution runs as 'pwuser' (UID 1000) from Playwright image
# We need /tmp directories writable by pwuser for inline script execution
# Using chmod 777 for /tmp paths since they're ephemeral and pwuser needs write access
RUN mkdir -p playwright-reports report \
    k6-reports \
    /home/nodejs/.npm \
    /home/nodejs/.cache \
    /home/pwuser/.npm \
    /home/pwuser/.cache \
    /root/.npm \
    /tmp/.npm \
    /tmp/playwright-tests \
    /tmp/playwright-videos \
    /tmp/playwright-reports && \
    chown -R nodejs:nodejs playwright-reports report k6-reports /worker /home/nodejs && \
    chown -R pwuser:pwuser /home/pwuser /tmp/playwright-tests /tmp/playwright-videos /tmp/playwright-reports && \
    chmod -R 755 playwright-reports report k6-reports && \
    chmod -R 777 /home/nodejs/.npm /home/nodejs/.cache /home/pwuser/.npm /home/pwuser/.cache /root/.npm /tmp/.npm /tmp/playwright-tests /tmp/playwright-videos /tmp/playwright-reports

# Set node home + npm cache to ensure Playwright/k6 sandboxes can write to npm cache directory
ENV HOME=/home/nodejs
ENV npm_config_cache=/home/nodejs/.npm
ENV NPM_CONFIG_CACHE=/home/nodejs/.npm

# Set Playwright browser cache path to standard location - ALREADY SET in base image but good to be explicit if we wanted to override
# The base image sets PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
# We don't need to install browsers as they are already in the base image!

# Add health check with dynamic port support
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD node -e "const http = require('http'); const port = process.env.PORT || 8000; const req = http.request({hostname: 'localhost', port: port, path: '/health', timeout: 5000}, (res) => process.exit(res.statusCode === 200 ? 0 : 1)); req.on('error', () => process.exit(1)); req.end();"

# EXPOSE 8000 # disabled per user request

CMD ["node", "--max-http-header-size=16384", "dist/src/main.js"]
