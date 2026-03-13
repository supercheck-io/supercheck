#!/usr/bin/env bash
# SuperCheck gVisor Setup Script for Docker
#
# Installs gVisor (runsc) as a Docker runtime for secure sandboxed
# test execution. The worker container runs under gVisor, so all
# child processes (Playwright, k6, monitors) inherit the sandbox.
#
# Usage:
#   curl -sfL https://raw.githubusercontent.com/supercheck-io/supercheck/main/deploy/docker/setup-gvisor.sh | sudo bash
#   # or
#   chmod +x setup-gvisor.sh && sudo ./setup-gvisor.sh
#
# Prerequisites:
#   - Ubuntu 22.04+ or Debian 12+ (amd64/arm64)
#   - Docker Engine installed (not Docker Desktop — see note below)
#   - Root/sudo access
#   - Internet connectivity
#
# Docker Desktop note:
#   Docker Desktop runs containers inside a Linux VM. To use gVisor
#   with Docker Desktop, you must install runsc inside that VM.
#   See: https://dev.to/rimelek/using-gvisors-container-runtime-in-docker-desktop-374m
#
# What this script does:
#   1. Installs gVisor (runsc) binary
#   2. Registers runsc as a Docker runtime
#   3. Restarts Docker to apply changes
#   4. Verifies gVisor works with a test container

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log()   { echo -e "${GREEN}[✓]${NC} $*"; }
warn()  { echo -e "${YELLOW}[!]${NC} $*"; }
error() { echo -e "${RED}[✗]${NC} $*" >&2; }
info()  { echo -e "${BLUE}[i]${NC} $*"; }

# ─── Preflight checks ────────────────────────────────────────────────────────

if [[ $EUID -ne 0 ]]; then
  error "This script must be run as root (use sudo)"
  exit 1
fi

if ! command -v docker &>/dev/null; then
  error "Docker is not installed. Install Docker Engine first:"
  error "  https://docs.docker.com/engine/install/"
  exit 1
fi

ARCH=$(uname -m)
if [[ "$ARCH" != "x86_64" ]] && [[ "$ARCH" != "aarch64" ]]; then
  error "Unsupported architecture: $ARCH (only x86_64 and aarch64 are supported)"
  exit 1
fi

# Map arch for gVisor downloads
if [[ "$ARCH" == "x86_64" ]]; then
  GVISOR_ARCH="x86_64"
elif [[ "$ARCH" == "aarch64" ]]; then
  GVISOR_ARCH="aarch64"
fi

info "Architecture: $ARCH"
info "Docker: $(docker --version)"
info "Starting SuperCheck gVisor setup for Docker..."

# ─── Step 1: Install gVisor (runsc) ──────────────────────────────────────────

if command -v runsc &>/dev/null; then
  warn "gVisor (runsc) is already installed: $(runsc --version 2>&1 | head -1)"
else
  log "Installing gVisor (runsc)..."

  GVISOR_URL="https://storage.googleapis.com/gvisor/releases/release/latest/${GVISOR_ARCH}"

  curl -fsSL "${GVISOR_URL}/runsc" -o /usr/local/bin/runsc
  chmod +x /usr/local/bin/runsc

  log "gVisor installed: $(runsc --version 2>&1 | head -1)"
fi

# ─── Step 2: Register runsc as a Docker runtime ──────────────────────────────

DAEMON_JSON="/etc/docker/daemon.json"

if [[ -f "$DAEMON_JSON" ]] && grep -q '"runsc"' "$DAEMON_JSON"; then
  warn "Docker daemon.json already has runsc runtime configured, skipping"
else
  log "Registering runsc as a Docker runtime..."

  # Use runsc install which handles daemon.json configuration
  runsc install

  log "runsc registered as Docker runtime"
fi

# ─── Step 3: Restart Docker ──────────────────────────────────────────────────

log "Restarting Docker to apply runtime configuration..."
systemctl restart docker

# Wait for Docker to be ready
info "Waiting for Docker to be ready..."
for i in $(seq 1 30); do
  if docker info &>/dev/null; then
    break
  fi
  sleep 2
done

if ! docker info &>/dev/null; then
  error "Docker failed to restart within 60 seconds"
  exit 1
fi
log "Docker restarted successfully"

# ─── Step 4: Verify gVisor works ─────────────────────────────────────────────

log "Verifying gVisor sandbox with a test container..."

# Remove any leftover test container
docker rm -f gvisor-test 2>/dev/null || true

TEST_OUTPUT=$(docker run --rm --name gvisor-test --runtime=runsc busybox:latest \
  sh -c "echo 'gVisor sandbox works!' && dmesg 2>&1 | head -1 || echo 'dmesg blocked (expected in gVisor)'" 2>&1)

if echo "$TEST_OUTPUT" | grep -q "gVisor sandbox works!"; then
  log "gVisor verification passed!"
  info "Test output: $TEST_OUTPUT"
else
  error "gVisor verification failed. Output:"
  echo "$TEST_OUTPUT"
  exit 1
fi

# ─── Step 5: Verify runtime: runsc works in Compose syntax ───────────────────

log "Verifying Docker runtime is available..."
if docker info 2>/dev/null | grep -q "runsc"; then
  log "runsc runtime is registered with Docker"
else
  warn "runsc runtime not visible in 'docker info' — this may be normal on some Docker versions"
fi

# ─── Summary ──────────────────────────────────────────────────────────────────

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
log "SuperCheck gVisor setup for Docker complete!"
echo ""
info "Docker:  $(docker --version)"
info "gVisor:  $(runsc --version 2>&1 | head -1)"
echo ""
info "Your Docker Compose worker service can now use:"
info "  runtime: runsc"
echo ""
info "Next steps:"
info "  1. Start SuperCheck with: docker compose -f docker-compose.yml up -d"
info "  2. All worker child processes will run inside the gVisor sandbox"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
