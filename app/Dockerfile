# Use platform-agnostic base image with LTS version for better availability
FROM node:20-slim AS base

# Install system dependencies in base stage for better layer caching
RUN apt-get update && apt-get install -y \
    postgresql-client \
    bash \
    ca-certificates \
    cron \
    curl \
    && rm -rf /var/lib/apt/lists/* \
    && apt-get clean

# Install dependencies only when needed
FROM base AS deps
WORKDIR /app

# Copy package files
COPY package.json package-lock.json* ./

# Install production dependencies with better caching
RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev --legacy-peer-deps --no-audit --no-fund

# Rebuild the source code only when needed
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Accept build arguments for NEXT_PUBLIC variables

# Install dev dependencies for build with caching
RUN --mount=type=cache,target=/root/.npm \
    npm ci --legacy-peer-deps --no-audit --no-fund

# Build the Next.js application
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_OPTIONS="--max-old-space-size=4096"
ENV NODE_ENV=production

# Set NEXT_PUBLIC environment variables from build args

# Build with standalone output and static optimization
# Use a build-time placeholder secret that will be overridden at runtime
ENV BETTER_AUTH_SECRET=build-time-placeholder-will-be-overridden-at-runtime
RUN npm run build

# Clear the build-time secret for security
ENV BETTER_AUTH_SECRET=

# Production image, copy all the files and run next
FROM base AS runner
WORKDIR /app

# Add OCI labels to link package to repository
LABEL org.opencontainers.image.source=https://github.com/supercheck-io/supercheck
LABEL org.opencontainers.image.title="Supercheck App"
LABEL org.opencontainers.image.description="Next.js frontend service for Supercheck - A comprehensive automation & monitoring platform for modern apps. Includes dashboard, job scheduling, test execution, and monitoring capabilities with multi-tenant support."

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Create user
RUN groupadd --system --gid 1001 nodejs && \
    useradd --system --uid 1001 --gid nodejs nextjs

# Create necessary directories with proper permissions
RUN mkdir -p /home/nextjs/.npm && \
    chown -R nextjs:nodejs /home/nextjs && \
    chown -R nextjs:nodejs /app

# Copy only necessary files for execution with proper ownership
COPY --from=deps --chown=nextjs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

# Copy standalone build
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Copy migration files, scripts, and bootstrap admin script
COPY --from=builder --chown=nextjs:nodejs /app/src/db ./src/db
COPY --from=builder --chown=nextjs:nodejs /app/src/lib ./src/lib
COPY --from=builder --chown=nextjs:nodejs /app/src/utils ./src/utils
COPY --from=builder --chown=nextjs:nodejs /app/src/types ./src/types
COPY --from=builder --chown=nextjs:nodejs /app/scripts ./scripts
COPY --from=builder --chown=nextjs:nodejs /app/drizzle.config.ts ./drizzle.config.ts
COPY --from=builder --chown=nextjs:nodejs /app/drizzle.config.json ./drizzle.config.json
COPY --from=builder --chown=nextjs:nodejs /app/tsconfig.json ./tsconfig.json

# Make scripts executable
RUN chmod +x ./scripts/start.sh ./scripts/db-migrate.js

# Verify critical files are copied correctly
RUN echo "=== Verifying Scripts ===" && ls -la ./scripts/ && \
    echo "=== Verifying DB Migrations ===" && ls -la ./src/db/migrations/ && \
    echo "=== Verifying DB Files ===" && ls -la ./src/db/ && \
    echo "=== Verification Complete ==="

# Set npm to not use cache and set proper environment
RUN mkdir -p /tmp/.npm && \
    chown -R nextjs:nodejs /tmp/.npm && \
    chown -R nextjs:nodejs /app

USER nextjs

# Set npm to not use cache and use tmp directory
ENV NPM_CONFIG_CACHE=/tmp/.npm
ENV NPM_CONFIG_NO_CACHE=true

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# Use the simplified start script which handles migrations and startup
CMD ["./scripts/start.sh"]
