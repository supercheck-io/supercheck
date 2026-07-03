---
name: kubernetes-deployment
description: "Use when: deploying SuperCheck on Kubernetes, working with Kustomize overlays, configuring KEDA autoscaling, Redis Sentinel HA, gVisor sandboxing, RBAC, NetworkPolicies, Pod Security Standards, upgrading K8s versions, troubleshooting pods, or working with any file in supercheck-ee/deploy/k8s/. Covers production multi-region, staging, self-hosted K3s, and local Docker Desktop deployments."
---

# SuperCheck Kubernetes Deployment

## Architecture

SuperCheck uses **Kustomize base + overlays** across three namespaces:

| Namespace | Purpose | PSS Level |
|-----------|---------|-----------|
| `supercheck` | App + Redis Sentinel (3-node HA) | restricted |
| `supercheck-workers` | Regional worker control planes | restricted |
| `supercheck-execution` | Ephemeral per-run gVisor pods | restricted |

All manifests in `supercheck-ee/deploy/k8s/`.

## Overlay Strategy

| Overlay | Use Case | App | Workers | Tags |
|---------|----------|-----|---------|------|
| `production` | Multi-region HA | 2 | 3 (US/EU/APAC) | Pinned |
| `staging` | Cost-optimized testing | 1 | 2 (US/EU) | `latest` |
| `self-hosted` | Single-node K3s | 1 | 1 (us) | Pinned |
| `local` | Docker Desktop dev | 1 | 1 (local) | Pinned |

### Key Differences

- **Production:** Full HA, KEDA, Redis Sentinel, NodeLocal DNS, Tailscale mesh, node taints
- **Staging:** `latest` tags, reduced replicas, same security model
- **Self-Hosted:** No KEDA, reduced quotas, single worker processes all queues
- **Local:** Embedded Postgres/MinIO, relaxed PSS (baseline for infra), no NetworkPolicies

## Deployment Scripts

| Script | Purpose |
|--------|---------|
| `deploy.sh` | Production (KEDA, Redis, Infisical, Kustomize) |
| `deploy-local.sh` | Local Docker Desktop with embedded infra |
| `start-local.sh` | Resume paused local workloads |
| `stop-local.sh` | Pause local workloads (preserves data) |

```bash
cd supercheck-ee/deploy/k8s
./deploy.sh          # Production
./deploy-local.sh    # Local
```

Safety: scripts verify kube context before running. Use `--force-context` to override.

## Version Management

### Three Places Per Overlay

Every version change requires updating **three** locations:

1. **`images` section** in kustomization.yaml:
   ```yaml
   images:
     - name: ghcr.io/supercheck-io/supercheck/app
       newTag: "1.3.3"
     - name: ghcr.io/supercheck-io/supercheck/worker
       newTag: "1.3.3"
   ```

2. **`WORKER_IMAGE` env** in overlay patch:
   ```yaml
   env:
     - name: WORKER_IMAGE
       value: "ghcr.io/supercheck-io/supercheck/worker:1.3.3"
   ```

3. **Base manifests** (hardcoded fallback):
   - `base/app-deployment.yaml` — app image
   - `base/worker-shared-spec.yaml` — worker image + WORKER_IMAGE env
   - `base/image-prepull.yaml` — DaemonSet image

**Critical:** `WORKER_IMAGE` must match the deployed tag. Mismatches cause execution pods to use the wrong version.

### Version Bump Checklist

**Base:**
- `base/kustomization.yaml` — 2 image entries
- `base/app-deployment.yaml` — app image
- `base/worker-shared-spec.yaml` — worker image + WORKER_IMAGE env
- `base/image-prepull.yaml` — prepull image

**Overlays:**
- `overlays/production/kustomization.yaml` — 2 tags + WORKER_IMAGE
- `overlays/self-hosted/kustomization.yaml` — 2 tags + WORKER_IMAGE
- `overlays/local/kustomization.yaml` — 2 tags + WORKER_IMAGE

**Docs:**
- `supercheck-ee/deploy/DEPLOYMENT_GUIDE.md` — "Current Version"
- `supercheck-ee/deploy/k8s/overlays/local/README.md` — version table + examples

**Skip:** `overlays/staging/` uses `latest`.

## RBAC & Security

### Service Account Tokens

- `automountServiceAccountToken: false` — no auto-mount
- Explicit **projected volume** with `expirationSeconds: 3600`
- Kubelet auto-rotates at ~80% expiry (best practice since K8s 1.24)

### Execution RBAC

Worker permissions in `supercheck-execution` namespace:

```yaml
- apiGroups: ["batch"]
  resources: ["jobs"]
  verbs: ["create", "get", "list", "watch", "delete"]
- apiGroups: [""]
  resources: ["pods/exec"]
  verbs: ["get", "create"]  # BOTH required
```

**Critical:** `pods/exec` needs both `get` AND `create`. Missing `get` → 403 on WebSocket upgrade → exec polling silently fails → jobs timeout after 5 min despite tests passing.

### Pod Security Standards

All namespaces: `restricted` profile
- `runAsNonRoot: true`, capabilities `DROP ALL`
- `seccompProfile: RuntimeDefault`
- No privilege escalation

### NetworkPolicies

| Namespace | Default | Egress |
|-----------|---------|--------|
| `supercheck` | Deny | All (external services) |
| `supercheck-workers` | Deny | DNS, Redis, PostgreSQL, K8s API, external HTTPS |
| `supercheck-execution` | Deny | DNS + external IPs only (blocks RFC1918, metadata, K8s API — SSRF protection) |

**Note:** K8s API in worker NetworkPolicy must use `ipBlock` (not namespaceSelector) — kube-proxy DNAT makes API invisible to namespace selectors.

## KEDA Autoscaling

Per-region ScaledObjects watch Redis queue depth:

| Queue | Trigger | Scope |
|-------|---------|-------|
| `k6-{region}`, `monitor-{region}` | listLength > 5 | Regional |
| `playwright-global`, `k6-global` | listLength > 10 | All workers |

**Scaling:** Up: +100% per 15s (aggressive). Down: -50% per 60s, 5-min stabilization.
**Limits:** Min 1 → Max 5 replicas per region.

Set `enableTLS: "true"` in TriggerAuthentication for managed Redis.

## Redis Sentinel HA

- 3-node StatefulSet: 1 master + 2 replicas, automatic failover
- 3 Sentinel pods: quorum=2, ~30s failover time
- AOF + RDB persistence, max 1.5GB memory, LRU eviction
- Role updater sidecar keeps K8s Service label-synced to active master
- BullMQ auto-reconnects on failover

### PodDisruptionBudgets

- **Production:** App: `minAvailable: 1`, Workers: `maxUnavailable: 1`, Redis: `minAvailable: 1`, Sentinel: `minAvailable: 2`
- **Non-production:** `minAvailable: 0` / `maxUnavailable: 0`

## Resource Limits

### Production

| Component | Requests | Limits |
|-----------|----------|--------|
| App | 250m / 512Mi | 1 CPU / 1.5GB |
| Worker | 300m / 768Mi | 1.5 CPU / 3GB |
| Redis (×3) | 250m / 512Mi | 1 CPU / 2GB |

### Execution Namespace

- LimitRange: max 1.5 CPU, 2GB per pod
- ResourceQuota: 16 CPU / 32GB requests, 24 CPU / 48GB limits (production)

## Worker Pattern

### Multi-Region (Production)

Three Deployments with node targeting:

```yaml
nodeSelector:
  workload: worker
  region: us-east  # eu-central, asia-pacific
tolerations:
  - key: workload
    value: worker
    effect: NoSchedule
```

Each sets `WORKER_LOCATION` and processes regional + global queues.

### Single-Node (Self-Hosted/Local)

One worker with `WORKER_LOCATION=local` processes ALL queues.

## Health Checks

| Probe | App | Worker |
|-------|-----|--------|
| Readiness | `/api/health`, 30s delay | `/health/ready`, 30s delay |
| Liveness | `/api/health/live`, 60s delay | `/health/live`, 60s delay |

PreStop hook: 15s sleep before SIGTERM (drains in-flight jobs).

## Zero-Downtime Upgrades

```yaml
strategy:
  type: RollingUpdate
  rollingUpdate:
    maxSurge: 1
    maxUnavailable: 0
```

```bash
# Apply updated overlay
kubectl apply -k supercheck-ee/deploy/k8s/overlays/production

# Monitor
kubectl rollout status deployment/supercheck-app -n supercheck

# Rollback
kubectl rollout undo deployment/supercheck-app -n supercheck
```

## Secret Management

### Infisical (Production)

Secrets Operator syncs every 60s via Machine Identity. Pod annotation `secrets.infisical.com/auto-reload: "true"` triggers restart on change.

### Manual (Local/Self-Hosted)

| Secret | Contents |
|--------|----------|
| `supercheck-secret` | All app/worker env vars |
| `redis-secret` | Auto-generated Redis password |
| `keda-redis-config` | Redis address for KEDA |

## Multi-Region Networking

### Tailscale (Production)

- WireGuard mesh for secure internal networking
- Worker NetworkPolicy allows Tailscale CIDR for K8s API

### NodeLocal DNS (Production)

- DaemonSet deployed for local DNS caching
- Workers use `dnsPolicy: None` with `EXECUTION_DNS_NAMESERVERS` pointing to the local DNS cache IP

## gVisor Execution

Each test creates a per-run K8s Job:
- `runtimeClassName: gvisor` — syscall interception
- Node selector: `gvisor.io/enabled: true`
- Strict NetworkPolicy (SSRF protection)
- Auto-cleaned after completion

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| Jobs timeout 5 min (tests pass inside) | Missing 'get' on pods/exec RBAC | Add both `get` and `create` to execution-rbac.yaml |
| Worker can't reach K8s API | NetworkPolicy blocks API IP | Use `ipBlock` with correct CIDR |
| Pods stuck Pending | Node selector/taint mismatch or quota exhausted | `kubectl describe pod`, verify node labels |
| KEDA not scaling | Missing Redis password in TriggerAuth | Verify `redis-secret` in `supercheck-workers` |
| Sentinel failover loop | < 2 sentinel pods | Check PDB, ensure 3 pods running |
| Execution pod OOMKilled | Exceeds 2GB limit | Increase `CONTAINER_MEMORY_LIMIT_MB` + LimitRange |

## File Reference

| Path | Purpose |
|------|---------|
| `base/kustomization.yaml` | Base resources + default image tags |
| `base/app-deployment.yaml` | App Deployment |
| `base/worker-shared-spec.yaml` | DRY worker spec (all regions) |
| `base/execution-rbac.yaml` | Worker SA + Role for execution |
| `base/execution-namespace.yaml` | Execution NS with LimitRange/ResourceQuota |
| `base/gvisor-runtimeclass.yaml` | RuntimeClass for gVisor |
| `base/network-policy*.yaml` | NetworkPolicies per namespace |
| `base/keda-scaledobject.yaml` | KEDA autoscaling triggers |
| `base/image-prepull.yaml` | DaemonSet to pre-pull worker images |
| `base/redis-statefulset.yaml` | Redis Sentinel HA |
| `overlays/*/kustomization.yaml` | Per-environment overrides |
| `deploy.sh` | Production orchestrator |
| `deploy-local.sh` | Local orchestrator |
| `supercheck-ee/deploy/DEPLOYMENT_GUIDE.md` | Full Hetzner/K3s setup guide |
| `supercheck-ee/deploy/INFRASTRUCTURE_ARCHITECTURE.md` | Architecture diagrams |
