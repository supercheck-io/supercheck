#!/usr/bin/env bash
# SuperCheck K3s + gVisor Setup Script
#
# Installs K3s with containerd and gVisor (runsc) runtime for secure
# sandboxed test execution. Replaces Docker-socket-based execution.
#
# Usage:
#   curl -sfL https://raw.githubusercontent.com/supercheck-io/supercheck/main/deploy/docker/setup-k3s.sh | bash
#   # or
#   chmod +x setup-k3s.sh && sudo ./setup-k3s.sh
#
# Prerequisites:
#   - Ubuntu 22.04+ or Debian 12+ (amd64)
#   - Root/sudo access
#   - Internet connectivity
#
# What this script does:
#   1. Installs K3s (single-node, containerd runtime)
#   2. Installs gVisor (runsc + containerd-shim-runsc-v1)
#   3. Configures containerd to use runsc handler
#   4. Creates gVisor RuntimeClass in Kubernetes
#   5. Creates supercheck-execution namespace with security policies
#   6. Labels the node for gVisor scheduling
#   7. Verifies gVisor works with a test pod

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
info "Starting SuperCheck K3s + gVisor setup..."

# ─── Step 1: Install K3s (containerd, no Docker) ─────────────────────────────

if command -v k3s &>/dev/null; then
  warn "K3s is already installed, skipping installation"
else
  log "Installing K3s with containerd runtime..."
  curl -sfL https://get.k3s.io | sh -s - \
    --write-kubeconfig-mode 644 \
    --disable traefik \
    --kubelet-arg="allowed-unsafe-sysctls=net.*"

  # Wait for K3s to be ready
  info "Waiting for K3s to be ready..."
  for i in $(seq 1 60); do
    if k3s kubectl get nodes &>/dev/null; then
      break
    fi
    sleep 2
  done

  if ! k3s kubectl get nodes &>/dev/null; then
    error "K3s failed to start within 120 seconds"
    exit 1
  fi
  log "K3s installed and running"
fi

# Set up kubectl alias
export KUBECONFIG=/etc/rancher/k3s/k3s.yaml

# ─── Step 2: Install gVisor (runsc) ──────────────────────────────────────────

if command -v runsc &>/dev/null; then
  warn "gVisor (runsc) is already installed: $(runsc --version 2>&1 | head -1)"
else
  log "Installing gVisor (runsc)..."

  # Install from gVisor release repository
  GVISOR_URL="https://storage.googleapis.com/gvisor/releases/release/latest/${GVISOR_ARCH}"

  curl -fsSL "${GVISOR_URL}/runsc" -o /usr/local/bin/runsc
  curl -fsSL "${GVISOR_URL}/containerd-shim-runsc-v1" -o /usr/local/bin/containerd-shim-runsc-v1

  chmod +x /usr/local/bin/runsc
  chmod +x /usr/local/bin/containerd-shim-runsc-v1

  log "gVisor installed: $(runsc --version 2>&1 | head -1)"
fi

# ─── Step 3: Configure containerd for gVisor ─────────────────────────────────

CONTAINERD_CONFIG_DIR="/var/lib/rancher/k3s/agent/etc/containerd"
CONTAINERD_TEMPLATE="${CONTAINERD_CONFIG_DIR}/config.toml.tmpl"

mkdir -p "$CONTAINERD_CONFIG_DIR"

if [[ -f "$CONTAINERD_TEMPLATE" ]] && grep -q "runsc" "$CONTAINERD_TEMPLATE"; then
  warn "containerd already configured for gVisor, skipping"
else
  log "Configuring containerd to use gVisor runtime..."

  cat > "$CONTAINERD_TEMPLATE" << 'TOML'
# K3s containerd configuration with gVisor runtime
# This is a template - K3s will merge it with defaults

version = 2

[plugins."io.containerd.grpc.v1.cri".containerd.runtimes.runsc]
  runtime_type = "io.containerd.runsc.v1"

[plugins."io.containerd.grpc.v1.cri".containerd.runtimes.runsc.options]
  TypeUrl = "io.containerd.runsc.v1.options"
TOML

  log "containerd config written to $CONTAINERD_TEMPLATE"
fi

# ─── Step 4: Restart K3s to pick up containerd changes ───────────────────────

log "Restarting K3s to apply containerd configuration..."
systemctl restart k3s

# Wait for K3s to be ready after restart
info "Waiting for K3s to be ready after restart..."
for i in $(seq 1 60); do
  if k3s kubectl get nodes 2>/dev/null | grep -q " Ready"; then
    break
  fi
  sleep 2
done

if ! k3s kubectl get nodes 2>/dev/null | grep -q " Ready"; then
  error "K3s failed to become ready after restart"
  exit 1
fi
log "K3s restarted successfully"

# ─── Step 5: Create gVisor RuntimeClass ───────────────────────────────────────

log "Creating gVisor RuntimeClass..."
k3s kubectl apply -f - <<'YAML'
apiVersion: node.k8s.io/v1
kind: RuntimeClass
metadata:
  name: gvisor
handler: runsc
overhead:
  podFixed:
    memory: "64Mi"
    cpu: "50m"
scheduling:
  nodeSelector:
    gvisor.io/enabled: "true"
YAML

# ─── Step 6: Create supercheck-execution namespace ────────────────────────────

log "Creating supercheck-execution namespace..."
k3s kubectl apply -f - <<'YAML'
apiVersion: v1
kind: Namespace
metadata:
  name: supercheck-execution
  labels:
    app.kubernetes.io/name: supercheck-execution
    pod-security.kubernetes.io/enforce: restricted
    pod-security.kubernetes.io/audit: restricted
    pod-security.kubernetes.io/warn: restricted
YAML

# ─── Step 7: Label the node for gVisor scheduling ────────────────────────────

NODE_NAME=$(k3s kubectl get nodes -o jsonpath='{.items[0].metadata.name}')
log "Labeling node '$NODE_NAME' for gVisor scheduling..."
k3s kubectl label node "$NODE_NAME" gvisor.io/enabled=true --overwrite
k3s kubectl label node "$NODE_NAME" workload=worker --overwrite

# ─── Step 8: Verify gVisor works ─────────────────────────────────────────────

log "Verifying gVisor sandbox with a test pod..."
k3s kubectl delete pod gvisor-test -n supercheck-execution --ignore-not-found 2>/dev/null

k3s kubectl apply -f - <<'YAML'
apiVersion: v1
kind: Pod
metadata:
  name: gvisor-test
  namespace: supercheck-execution
spec:
  runtimeClassName: gvisor
  restartPolicy: Never
  automountServiceAccountToken: false
  securityContext:
    runAsNonRoot: true
    runAsUser: 65534
    seccompProfile:
      type: RuntimeDefault
  containers:
    - name: test
      image: busybox:latest
      command: ["sh", "-c", "echo 'gVisor sandbox works!' && dmesg 2>&1 | head -1 || echo 'dmesg blocked (expected in gVisor)'"]
      securityContext:
        allowPrivilegeEscalation: false
        capabilities:
          drop: ["ALL"]
YAML

# Wait for test pod to complete
info "Waiting for test pod to complete..."
for i in $(seq 1 60); do
  STATUS=$(k3s kubectl get pod gvisor-test -n supercheck-execution -o jsonpath='{.status.phase}' 2>/dev/null || echo "Pending")
  if [[ "$STATUS" == "Succeeded" ]] || [[ "$STATUS" == "Failed" ]]; then
    break
  fi
  sleep 2
done

if [[ "$STATUS" == "Succeeded" ]]; then
  log "gVisor verification passed!"
  k3s kubectl logs gvisor-test -n supercheck-execution 2>/dev/null || true
else
  warn "gVisor test pod status: $STATUS"
  k3s kubectl describe pod gvisor-test -n supercheck-execution 2>/dev/null | tail -20
  error "gVisor verification failed - check the pod events above"
  exit 1
fi

# Clean up test pod
k3s kubectl delete pod gvisor-test -n supercheck-execution --ignore-not-found 2>/dev/null

# ─── Summary ──────────────────────────────────────────────────────────────────

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
log "SuperCheck K3s + gVisor setup complete!"
echo ""
info "K3s:       $(k3s --version 2>&1 | head -1)"
info "gVisor:    $(runsc --version 2>&1 | head -1)"
info "Node:      $NODE_NAME (gvisor.io/enabled=true)"
info "Namespace: supercheck-execution (restricted PSS)"
echo ""
info "Next steps:"
info "  1. Deploy SuperCheck with: kubectl apply -k deploy/k8s/overlays/self-hosted/"
info "  2. Or use Docker Compose for app + worker with K3s handling execution"
info ""
info "Kubeconfig: export KUBECONFIG=/etc/rancher/k3s/k3s.yaml"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
