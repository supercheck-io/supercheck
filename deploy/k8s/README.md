# Supercheck Kubernetes Manifests

Production-ready manifests for Kubernetes deployment. Backing services (Postgres, Redis, S3/R2) are external by default.

## Docker Execution Strategy

Supercheck workers spawn Playwright and K6 containers. Choose the approach that matches your cluster:

### Option A: Host Docker Socket (K3s Self-Hosted - RECOMMENDED)

- Use `worker-deployment.yaml` (default)
- Requires K3s with `--docker` flag OR Docker installed on worker nodes
- Same approach as Docker Compose - best performance, shared image cache
- No privileged containers needed

### Option B: Docker-in-Docker Sidecar (Managed K8s)

- Use `worker-deployment-dind.yaml` instead
- Works on any Kubernetes cluster (EKS, GKE, AKS)
- Requires privileged containers
- Images re-pulled on pod restart (no persistent cache)

## Files

- `kustomization.yaml` — bundles all manifests under `supercheck` namespace
- `namespace.yaml` — creates `supercheck` namespace
- `serviceaccount.yaml` — dedicated SA for app/worker
- `configmap.yaml` — non-secret configuration (endpoints, domains, buckets)
- `secret.yaml` — sample secrets (replace with real values)
- `app-deployment.yaml` / `app-service.yaml` — Next.js app (port 3000)
- `worker-deployment.yaml` / `worker-service.yaml` — Worker with host Docker socket
- `worker-deployment-dind.yaml` — Alternative worker with DinD sidecar (for managed K8s)
- `ingress.yaml` — exposes the app host (Traefik class)
- `pdb-app.yaml` / `pdb-worker.yaml` — Pod disruption budgets
- `keda-scaledobject.yaml` — KEDA autoscaling configuration
- `cluster-autoscaler.yaml` — Cluster autoscaler for Hetzner Cloud

## Quick Start

### 1. Configure secrets and endpoints

Edit `configmap.yaml`:

```yaml
data:
  NEXT_PUBLIC_APP_URL: "https://app.supercheck.io"
  DB_HOST: "cluster.psdb.cloud"
  REDIS_HOST: "redis.cloud:12345"
  S3_ENDPOINT: "https://account.r2.cloudflarestorage.com"
```

Edit `secret.yaml`:

```yaml
stringData:
  DATABASE_URL: "postgresql://user:pass@host:5432/supercheck"
  REDIS_URL: "redis://:password@host:6379"
  BETTER_AUTH_SECRET: "your-32-char-secret"
  # ... other secrets
```

### 2. Choose worker deployment approach

For **K3s self-hosted** (recommended):

```bash
# Use default kustomization (includes worker-deployment.yaml)
kubectl apply -k .
```

For **managed K8s** (EKS, GKE, AKS):

```bash
# Edit kustomization.yaml to use worker-deployment-dind.yaml instead
# or apply DinD deployment separately after main deployment
kubectl apply -k .
kubectl apply -f worker-deployment-dind.yaml
```

### 3. Verify deployment

```bash
kubectl -n supercheck get pods
kubectl -n supercheck logs deploy/supercheck-worker-us -c worker
```

## Best Practices

1. **Managed Services**: Use managed Postgres/Redis/S3 (PlanetScale, Redis Cloud, Cloudflare R2)

2. **Secret Management**: Replace `secret.yaml` with ExternalSecrets or SealedSecrets for production

3. **Node Configuration** (K3s):

   - Install K3s with Docker runtime on worker nodes: `sh -s - agent --docker`
   - Label and taint worker nodes:
     ```bash
     kubectl label nodes worker-1 workload=worker region=us-east
     kubectl taint nodes worker-1 workload=worker:NoSchedule
     ```

4. **Resource Tuning**: Adjust requests/limits based on your workload

5. **Ingress**: Update annotations for your ingress controller if not using Traefik

## Helm (Alternative)

```bash
helm upgrade --install supercheck ./helm/supercheck \
  --namespace supercheck --create-namespace \
  -f my-values.yaml
```
