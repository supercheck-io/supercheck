#!/bin/bash

# Simple and Robust Startup Script for Supercheck App
# Uses the new db-migrate.js script for reliable database setup

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
log() {
    echo -e "${BLUE}[STARTUP]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Report configuration presence without ever writing credentials, connection
# strings, hostnames, or account identifiers to application logs.
log_env_presence() {
    local variable_name="$1"

    if [[ -n "${!variable_name:-}" ]]; then
        log "  ${variable_name}: configured"
    else
        log "  ${variable_name}: not set"
    fi
}

# Function to run migrations (includes seeding as part of migration)
run_migrations() {
    log "Running database migrations..."
    
    # Log presence only. Values such as DATABASE_URL may contain credentials.
    log "Environment check:"
    log_env_presence "DB_HOST"
    log_env_presence "DB_PORT"
    log_env_presence "DB_USER"
    log_env_presence "DB_NAME"
    log_env_presence "DATABASE_URL"
    log "  Current directory: $(pwd)"
    
    # Run the migration script (now includes seeding and verification)
    if node scripts/db-migrate.js; then
        log_success "Database migrations and seeding completed successfully"
        return 0
    else
        log_error "Database migrations failed"
        return 1
    fi
}

# Function to start the Next.js server
start_server() {
    log "Starting Next.js server..."

    # The production image must contain a standalone build. Never fall back to
    # the development server when an image is incomplete.
    if [ -f "server.js" ]; then
        log "Running in production mode with standalone server"
        exec node server.js
    elif [ -f "/app/server.js" ]; then
        log "Running in production mode with standalone server (from /app)"
        exec node /app/server.js
    else
        log_error "server.js not found. The standalone production build is incomplete."
        log_error "Current directory: $(pwd)"
        exit 1
    fi
}

# Main execution
main() {
    log "Starting Supercheck App..."
    
    # Run migrations (includes seeding and verification)
    # Migration script will fail if plan_limits are not seeded
    if ! run_migrations; then
        log_error "Failed to run migrations. Exiting."
        exit 1
    fi

    # Bootstrap super admin if configured
    log "Checking for super admin configuration..."
    node scripts/bootstrap-admin.js
    
    # Start the server
    start_server
}

# Execute main function
main "$@"
