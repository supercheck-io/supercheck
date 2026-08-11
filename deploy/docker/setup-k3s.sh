#!/usr/bin/env bash
# Supercheck K3s + gVisor Setup Script
#
# Installs K3s with containerd and gVisor (runsc) runtime for secure
# sandboxed test execution. Replaces Docker-socket-based execution.
#
# Usage:
#   curl -fsSL -o setup-k3s.sh https://raw.githubusercontent.com/supercheck-io/supercheck/main/deploy/docker/setup-k3s.sh
#   sudo bash setup-k3s.sh
#   # or
#   chmod +x setup-k3s.sh && sudo ./setup-k3s.sh
#
# Prerequisites:
#   - Ubuntu 22.04+ or Debian 12+ (amd64/arm64)
#   - Root/sudo access
#   - Internet connectivity
#
# What this script does:
#   1. Installs K3s (single-node, containerd runtime)
#   2. Installs gVisor (runsc + containerd-shim-runsc-v1)
#   3. Configures containerd to use runsc handler
#   4. Creates gVisor RuntimeClass in Kubernetes
#   5. Creates supercheck-execution namespace, LimitRange, ResourceQuota, and NetworkPolicy
#   6. Creates restricted worker RBAC and a Docker-friendly kubeconfig
#   7. Labels the node for gVisor scheduling
#   8. Verifies gVisor works with a test pod

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

OS=$(uname -s)
if [[ "$OS" != "Linux" ]]; then
  error "This script requires Linux. K3s and gVisor do not support $OS."
  error "Supercheck's sandboxed execution requires a Linux server (Ubuntu 22.04+, Debian 12+)."
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

if ! command -v sha512sum &>/dev/null; then
  error "sha512sum is required to verify gVisor downloads"
  exit 1
fi

HOST_IP=$(ip route get 1.1.1.1 2>/dev/null | awk '{for (i = 1; i <= NF; i++) if ($i == "src") {print $(i+1); exit}}')
if [[ -z "$HOST_IP" ]]; then
  error "Failed to detect host IP address for Kubernetes API access"
  exit 1
fi

info "Architecture: $ARCH"
info "Host IP: $HOST_IP"
info "Starting Supercheck K3s + gVisor setup..."

# ─── Configuration ────────────────────────────────────────────────────────────

# Pin K3s to a vetted version and use the official gVisor release channel format.
K3S_VERSION="v1.32.10+k3s1"
GVISOR_RELEASE="${GVISOR_RELEASE:-latest}"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

# ─── Step 1: Install K3s (containerd, no Docker) ─────────────────────────────

if command -v k3s &>/dev/null; then
  warn "K3s is already installed, skipping installation"
else
  log "Installing K3s ${K3S_VERSION} with containerd runtime..."
  curl -fsSL https://get.k3s.io -o "${TMP_DIR}/install-k3s.sh"
  chmod 0755 "${TMP_DIR}/install-k3s.sh"
  INSTALL_K3S_VERSION="${K3S_VERSION}" sh "${TMP_DIR}/install-k3s.sh" \
    --write-kubeconfig-mode 644 \
    --tls-san "${HOST_IP}" \
    --disable traefik

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
  log "Installing gVisor (runsc) release ${GVISOR_RELEASE}..."

  # Install from gVisor release repository
  GVISOR_URL="https://storage.googleapis.com/gvisor/releases/release/${GVISOR_RELEASE}/${GVISOR_ARCH}"

  curl -fsSL "${GVISOR_URL}/runsc" -o "${TMP_DIR}/runsc"
  curl -fsSL "${GVISOR_URL}/runsc.sha512" -o "${TMP_DIR}/runsc.sha512"
  curl -fsSL "${GVISOR_URL}/containerd-shim-runsc-v1" -o "${TMP_DIR}/containerd-shim-runsc-v1"
  curl -fsSL "${GVISOR_URL}/containerd-shim-runsc-v1.sha512" -o "${TMP_DIR}/containerd-shim-runsc-v1.sha512"

  (
    cd "$TMP_DIR"
    sha512sum -c runsc.sha512
    sha512sum -c containerd-shim-runsc-v1.sha512
  )

  install -m 0755 "${TMP_DIR}/runsc" /usr/local/bin/runsc
  install -m 0755 "${TMP_DIR}/containerd-shim-runsc-v1" /usr/local/bin/containerd-shim-runsc-v1

  log "gVisor installed: $(runsc --version 2>&1 | head -1)"
fi

# ─── Step 3: Configure containerd for gVisor ─────────────────────────────────

CONTAINERD_CONFIG_DIR="/var/lib/rancher/k3s/agent/etc/containerd"
CONTAINERD_TEMPLATE="${CONTAINERD_CONFIG_DIR}/config-v3.toml.tmpl"

mkdir -p "$CONTAINERD_CONFIG_DIR"

if [[ -f "$CONTAINERD_TEMPLATE" ]] && grep -q "runsc" "$CONTAINERD_TEMPLATE"; then
  warn "containerd already configured for gVisor, skipping"
else
  log "Configuring containerd to use gVisor runtime..."

  # K3s 1.32+ runs containerd 2.x.  The supported customization path is a
  # config-v3 template that extends K3s' built-in base template instead of
  # copying the full rendered config into this script.  That keeps us aligned
  # with upstream defaults (registry, snapshotter, CNI, pause image, etc.)
  # while still adding the runsc runtime handler we need for gVisor.
  #
  # The shim binary is installed to /usr/local/bin.  To ensure containerd
  # discovers it regardless of its own PATH, we also symlink it into /usr/bin.
  if [[ -f /usr/local/bin/containerd-shim-runsc-v1 ]] && [[ ! -e /usr/bin/containerd-shim-runsc-v1 ]]; then
    ln -s /usr/local/bin/containerd-shim-runsc-v1 /usr/bin/containerd-shim-runsc-v1
  fi

  cat > "$CONTAINERD_TEMPLATE" << 'TOML'
{{ template "base" . }}

[plugins.'io.containerd.cri.v1.runtime'.containerd.runtimes.runsc]
  runtime_type = "io.containerd.runsc.v1"
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
  tolerations:
    - key: workload
      operator: Equal
      value: worker
      effect: NoSchedule
YAML

# ─── Step 6: Create execution namespace + guardrails ─────────────────────────

log "Creating supercheck-execution namespace, LimitRange, ResourceQuota, and NetworkPolicy..."
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
---
# Zero-permission ServiceAccount mounted by execution Jobs. The worker creates
# the per-run payload Secrets; this SA only runs the Job pod itself.
apiVersion: v1
kind: ServiceAccount
metadata:
  name: execution-runner
  namespace: supercheck-execution
  labels:
    app.kubernetes.io/part-of: supercheck
automountServiceAccountToken: false
---
apiVersion: v1
kind: ResourceQuota
metadata:
  name: execution-limits
  namespace: supercheck-execution
  labels:
    app.kubernetes.io/part-of: supercheck
spec:
  hard:
    requests.cpu: "4"
    requests.memory: "8Gi"
    limits.cpu: "8"
    limits.memory: "16Gi"
    count/jobs.batch: "10"
    pods: "10"
---
apiVersion: v1
kind: LimitRange
metadata:
  name: execution-guardrails
  namespace: supercheck-execution
  labels:
    app.kubernetes.io/part-of: supercheck
spec:
  limits:
    - type: Container
      min:
        cpu: "100m"
        memory: "128Mi"
      defaultRequest:
        cpu: "250m"
        memory: "768Mi"
      default:
        cpu: "1500m"
        memory: "2Gi"
      max:
        cpu: "4"
        memory: "9Gi"
---
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: execution-egress
  namespace: supercheck-execution
  labels:
    app.kubernetes.io/part-of: supercheck
spec:
  podSelector: {}
  policyTypes:
    - Ingress
    - Egress
  ingress: []
  egress:
    - ports:
        - protocol: UDP
          port: 53
        - protocol: TCP
          port: 53
    - to:
        - ipBlock:
            cidr: 0.0.0.0/0
            except:
              - 169.254.169.254/32
              - 100.100.100.200/32
              - 169.254.0.0/16
              - 10.0.0.0/8
              - 172.16.0.0/12
              - 192.168.0.0/16
      ports:
        - protocol: TCP
YAML

# ─── Step 7: Create restricted worker RBAC + kubeconfig ──────────────────────

log "Creating restricted worker RBAC for external Docker Compose workers..."
k3s kubectl apply -f - <<'YAML'
apiVersion: v1
kind: Namespace
metadata:
  name: supercheck-workers
  labels:
    app.kubernetes.io/name: supercheck-workers
    pod-security.kubernetes.io/enforce: restricted
    pod-security.kubernetes.io/audit: restricted
    pod-security.kubernetes.io/warn: restricted
---
apiVersion: v1
kind: ServiceAccount
metadata:
  name: supercheck-worker
  namespace: supercheck-workers
  labels:
    app.kubernetes.io/name: supercheck-worker
automountServiceAccountToken: false
---
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: execution-manager
  namespace: supercheck-execution
  labels:
    app.kubernetes.io/part-of: supercheck
rules:
  - apiGroups: ["batch"]
    resources: ["jobs"]
    verbs: ["create", "get", "list", "watch", "delete", "deletecollection"]
  - apiGroups: [""]
    resources: ["pods"]
    verbs: ["get", "list", "watch", "delete"]
  - apiGroups: [""]
    resources: ["pods/log"]
    verbs: ["get"]
  - apiGroups: [""]
    resources: ["pods/exec"]
    verbs: ["get", "create"]
  # Ephemeral, Job-owned payload/runtime Secrets. The execution pod only mounts
  # these objects; the zero-permission execution-runner SA cannot read them.
  - apiGroups: [""]
    resources: ["secrets"]
    verbs: ["create"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: worker-execution-manager
  namespace: supercheck-execution
  labels:
    app.kubernetes.io/part-of: supercheck
subjects:
  - kind: ServiceAccount
    name: supercheck-worker
    namespace: supercheck-workers
roleRef:
  kind: Role
  name: execution-manager
  apiGroup: rbac.authorization.k8s.io
---
apiVersion: v1
kind: Secret
metadata:
  name: supercheck-worker-token
  namespace: supercheck-workers
  annotations:
    kubernetes.io/service-account.name: supercheck-worker
type: kubernetes.io/service-account-token
YAML

WORKER_KUBECONFIG="/etc/rancher/k3s/supercheck-worker.kubeconfig"
API_SERVER=$(k3s kubectl config view --raw -o jsonpath='{.clusters[0].cluster.server}')
API_PORT="${API_SERVER##*:}"
API_SERVER="https://${HOST_IP}:${API_PORT}"
CA_DATA=$(k3s kubectl config view --raw -o jsonpath='{.clusters[0].cluster.certificate-authority-data}')
TOKEN=""

info "Waiting for worker service-account token..."
for i in $(seq 1 30); do
  TOKEN=$(k3s kubectl get secret supercheck-worker-token -n supercheck-workers -o jsonpath='{.data.token}' 2>/dev/null | base64 -d || true)
  if [[ -n "$TOKEN" ]]; then
    break
  fi
  sleep 1
done

if [[ -z "$TOKEN" ]]; then
  error "Failed to retrieve service-account token for supercheck-worker"
  exit 1
fi

cat > "$WORKER_KUBECONFIG" <<EOF
apiVersion: v1
kind: Config
clusters:
  - name: supercheck-k3s
    cluster:
      certificate-authority-data: ${CA_DATA}
      server: ${API_SERVER}
contexts:
  - name: supercheck-worker@supercheck-k3s
    context:
      cluster: supercheck-k3s
      user: supercheck-worker
      namespace: supercheck-execution
current-context: supercheck-worker@supercheck-k3s
users:
  - name: supercheck-worker
    user:
      token: ${TOKEN}
EOF

chmod 0640 "$WORKER_KUBECONFIG"
# The worker container runs as UID 1000 (pwuser). The kubeconfig is bind-mounted
# read-only, so the file must be group- or world-readable. Mode 0640 lets the
# host admin restrict access to a specific group while still allowing the
# non-root container to read the file.
# If the deployer adds UID 1000 to the owning group, 0640 is sufficient.
# For simpler setups (Coolify/Dokploy), 0644 also works.
chown root:1000 "$WORKER_KUBECONFIG" 2>/dev/null || chmod 0644 "$WORKER_KUBECONFIG"
log "Restricted worker kubeconfig written to $WORKER_KUBECONFIG (readable by UID 1000)"

# ─── Step 8: Label the node for gVisor scheduling ────────────────────────────

NODE_NAME=$(k3s kubectl get nodes -o jsonpath='{.items[0].metadata.name}')
log "Labeling node '$NODE_NAME' for gVisor scheduling..."
k3s kubectl label node "$NODE_NAME" gvisor.io/enabled=true --overwrite

# ─── Step 9: Verify gVisor works ─────────────────────────────────────────────

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
      image: busybox:1.37.0
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
log "Supercheck K3s + gVisor setup complete!"
echo ""
info "K3s:       $(k3s --version 2>&1 | head -1)"
info "gVisor:    $(runsc --version 2>&1 | head -1)"
info "Node:      $NODE_NAME (gvisor.io/enabled=true)"
info "Execution NS: supercheck-execution (restricted PSS, limit range, quota, egress policy)"
echo ""
info "Next steps:"
info "  1. Follow the deployment guide: https://supercheck.io/docs/app/deployment/self-hosted"
info "  2. Or run Docker Compose with K3s-backed execution using:"
info "     KUBECONFIG_FILE=${WORKER_KUBECONFIG} docker compose -f docker-compose-secure.yml up -d"
info ""
info "Admin kubeconfig:   export KUBECONFIG=/etc/rancher/k3s/k3s.yaml"
info "Worker kubeconfig:  ${WORKER_KUBECONFIG}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
