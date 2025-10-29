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

# Function to run migrations
run_migrations() {
    log "Running database migrations..."
    
    # Log environment for debugging
    log "Environment check:"
    log "  DB_HOST: ${DB_HOST:-not set}"
    log "  DB_PORT: ${DB_PORT:-not set}"
    log "  DB_USER: ${DB_USER:-not set}"
    log "  DB_NAME: ${DB_NAME:-not set}"
    log "  DATABASE_URL: ${DATABASE_URL:-not set}"
    log "  Current directory: $(pwd)"
    
    # Run the simplified migration script
    if node scripts/db-migrate.js; then
        log_success "Database migrations completed successfully"
        return 0
    else
        log_error "Database migrations failed"
        return 1
    fi
}

# Function to start the Next.js server
start_server() {
    log "Starting Next.js server..."
    
    # Check if we're in production (standalone build) or development
    if [ -f "server.js" ]; then
        log "Running in production mode with standalone server"
        exec node server.js
    else
        log "Running in development mode"
        exec npm run dev
    fi
}

# Main execution
main() {
    log "Starting Supercheck App..."
    
    # Always run migrations first
    if ! run_migrations; then
        log_error "Failed to run migrations. Exiting."
        exit 1
    fi
    
    # Start the server
    start_server
}

# Execute main function
main "$@" 