# Use official Playwright image which includes all browsers and dependencies
# This avoids the heavy "npx playwright install" step that causes OOM on runners
# Includes Chromium, Firefox, and WebKit (Safari) browsers
FROM mcr.microsoft.com/playwright:v1.58.2-noble AS base

# Build k6 with xk6-dashboard extension
# Pin golang to specific patch version for reproducible builds
FROM golang:1.25.8-alpine AS k6-builder
RUN apk add --no-cache git
RUN go install go.k6.io/xk6/cmd/xk6@v1.3.6
# Pin k6 to v1.6.1 and xk6-dashboard to v0.8.1 for reproducible builds
RUN xk6 build v1.6.1 --with github.com/grafana/xk6-dashboard@v0.8.1
RUN chmod +x k6

# NOTE: Docker CLI removed — execution is orchestrated through Kubernetes Jobs.
# This image is used both for the long-lived worker control plane and the
# ephemeral gVisor execution Jobs it creates.

# Build stage with dev dependencies
FROM base AS builder
WORKDIR /worker
COPY package.json package-lock.json* ./

# Install all dependencies for build with caching
RUN --mount=type=cache,target=/root/.npm,sharing=locked \
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

# NOTE: Docker CLI removed — execution is orchestrated through Kubernetes Jobs.

# Use the Playwright image's built-in pwuser (UID 1000) consistently for the
# worker and child execution processes. This keeps HOME/cache ownership aligned
# with the non-root runtime enforced by Compose/Kubernetes.

# Copy only necessary files with proper ownership
COPY --from=builder --chown=pwuser:pwuser /worker/package*.json ./

# Install production dependencies with caching and memory limits
RUN --mount=type=cache,target=/root/.npm,sharing=locked \
    npm ci --omit=dev --legacy-peer-deps --no-audit --no-fund --max-old-space-size=4096

COPY --from=builder --chown=pwuser:pwuser /worker/dist ./dist
COPY --from=builder --chown=pwuser:pwuser /worker/playwright.config.js ./

# Create directories for test execution with proper permissions
# Note: Container execution runs as 'pwuser' (UID 1000) from Playwright image
# We need /tmp directories writable by pwuser for inline script execution
# Using chmod 777 for /tmp paths since they're ephemeral and pwuser needs write access
RUN mkdir -p playwright-reports report \
    k6-reports \
    /home/pwuser/.npm \
    /home/pwuser/.cache \
    /root/.npm \
    /tmp/.npm \
    /tmp/supercheck \
    /tmp/playwright-tests \
    /tmp/playwright-videos \
    /tmp/playwright-reports && \
    chown -R pwuser:pwuser playwright-reports report k6-reports /worker /home/pwuser /tmp/supercheck /tmp/playwright-tests /tmp/playwright-videos /tmp/playwright-reports && \
    chmod -R 755 playwright-reports report k6-reports && \
    chmod -R 700 /home/pwuser/.npm /home/pwuser/.cache && \
    chmod -R 755 /tmp/supercheck && \
    chmod -R 777 /root/.npm /tmp/.npm /tmp/playwright-tests /tmp/playwright-videos /tmp/playwright-reports

# Set runtime home + npm cache to writable pwuser locations. Compose mounts
# matching tmpfs paths for these directories in hardened deployments.
ENV HOME=/home/pwuser
ENV npm_config_cache=/home/pwuser/.npm
ENV NPM_CONFIG_CACHE=/home/pwuser/.npm

# Set Playwright browser cache path to standard location - ALREADY SET in base image but good to be explicit if we wanted to override
# The base image sets PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
# We don't need to install browsers as they are already in the base image!

# Add health check with dynamic port support
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD node -e "const http = require('http'); const port = process.env.PORT || 8000; const req = http.request({hostname: 'localhost', port: port, path: '/health', timeout: 5000}, (res) => process.exit(res.statusCode === 200 ? 0 : 1)); req.on('error', () => process.exit(1)); req.end();"

# GVISOR-006: Run as non-root user by default.
# pwuser (UID 1000) is from the Playwright base image and has access to browsers.
USER 1000

# EXPOSE 8000 # disabled per user request

CMD ["node", "--max-http-header-size=16384", "dist/src/main.js"]
