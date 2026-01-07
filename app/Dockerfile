# Use platform-agnostic base image with pinned LTS version for reproducible builds
# Node 22.x LTS for compatibility with @noble/hashes and other modern packages
FROM node:22-slim AS base

# Install system dependencies in base stage for better layer caching
RUN apt-get update && apt-get install -y \
    postgresql-client \
    bash \
    ca-certificates \
    cron \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install all dependencies (including dev) needed for building
FROM base AS deps-all
WORKDIR /app

# Copy package files
COPY package.json package-lock.json* ./

# Install all dependencies with better caching
RUN --mount=type=cache,target=/root/.npm \
    npm ci --legacy-peer-deps --no-audit --no-fund

# Install production dependencies only for runtime
FROM base AS deps-prod
WORKDIR /app

# Copy package files
COPY package.json package-lock.json* ./

# Install production dependencies with better caching
RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev --legacy-peer-deps --no-audit --no-fund

# Rebuild the source code only when needed
FROM base AS builder
WORKDIR /app
COPY --from=deps-all /app/node_modules ./node_modules
COPY . .

# Accept build arguments for NEXT_PUBLIC variables

# Build the Next.js application
ENV NODE_OPTIONS="--max-old-space-size=4096"
ENV NODE_ENV=production

# Set NEXT_PUBLIC environment variables from build args

# Build with standalone output and static optimization
# Use a build-time placeholder secret that will be overridden at runtime
ENV BETTER_AUTH_SECRET=build-time-placeholder-will-be-overridden-at-runtime
# Use --webpack flag because Next.js 16 defaults to Turbopack, but ARM64 cross-compilation
# uses WASM fallback which doesn't support turbo.createProject
RUN npm run build -- --webpack

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

# Create user
RUN groupadd --system --gid 1001 nodejs && \
    useradd --system --uid 1001 --gid nodejs nextjs

# Create necessary directories with proper permissions
RUN mkdir -p /home/nextjs/.npm && \
    chown -R nextjs:nodejs /home/nextjs && \
    chown -R nextjs:nodejs /app

# Copy standalone build first (includes server.js and minimal node_modules)
# Note: Next.js standalone output mirrors the WORKDIR structure, so server.js is in .next/standalone/app/
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone/app ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

# Copy additional production dependencies needed for migrations/scripts
# These are merged with standalone's node_modules (standalone doesn't include all deps)
COPY --from=deps-prod --chown=nextjs:nodejs /app/node_modules ./node_modules

# Copy package.json for scripts that may need it (like npm run commands in dev fallback)
COPY --from=builder --chown=nextjs:nodejs /app/package.json ./package.json

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
