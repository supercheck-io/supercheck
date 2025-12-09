# Kubernetes Deployment Guide

> **Version**: 1.1.0  
> **Last Updated**: 2025-12-09  
> **Status**: Production Ready

## Overview

This guide covers Kubernetes deployment for Supercheck, designed for **managed Kubernetes services** (EKS, GKE, AKS, DigitalOcean, etc.) or self-managed K3s clusters.

> **Recommendation**: For production, use managed Kubernetes services to reduce operational overhead.

---

## Architecture

```
Kubernetes Cluster (K3s or Managed)
├── Namespace: supercheck
│
├── App Deployment
│   ├── Next.js Application (port 3000)
│   ├── Handles migrations on startup
│   └── Pod anti-affinity for HA
│
├── Worker Deployment(s)
│   ├── Regional workers (us-east, eu-central, asia-pacific)
│   ├── Docker access via:
│   │   ├── Option A: Host Docker socket (K3s - recommended)
│   │   └── Option B: DinD sidecar (managed K8s)
│   ├── KEDA autoscaling based on queue depth
│   └── Pod anti-affinity for HA
│
├── Ingress
│   ├── Main app routing
│   └── Status page routing (wildcard subdomain)
│
└── External Services (Managed)
    ├── PostgreSQL (PlanetScale, RDS, Cloud SQL)
    ├── Redis (Redis Cloud, ElastiCache, Memorystore)
    └── S3 Storage (Cloudflare R2, AWS S3, GCS)
```

---

## Prerequisites

### Required

- Kubernetes 1.28+ cluster
- `kubectl` configured with cluster access
- Managed external services:
  - PostgreSQL (PlanetScale recommended)
  - Redis (Redis Cloud recommended)
  - S3-compatible storage (Cloudflare R2 recommended)

### Optional

- KEDA for autoscaling (recommended)
- Ingress controller (Traefik, NGINX, etc.)
- Cert-manager for TLS certificates

---

## Quick Start

### 1. Configure Secrets

Edit `deploy/k8s/secret.yaml` with your credentials:

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: supercheck-secrets
  namespace: supercheck
type: Opaque
stringData:
  DATABASE_URL: "postgresql://user:pass@cluster.psdb.cloud:6432/supercheck?sslmode=require"
  REDIS_URL: "redis://:password@redis.cloud:12345"
  BETTER_AUTH_SECRET: "your-32-char-secret"
  SECRET_ENCRYPTION_KEY: "your-32-char-key"
  AWS_ACCESS_KEY_ID: "your-r2-access-key"
  AWS_SECRET_ACCESS_KEY: "your-r2-secret-key"
  OPENAI_API_KEY: "sk-your-openai-key"
  SMTP_PASSWORD: "your-smtp-password"
```

### 2. Configure Settings

Edit `deploy/k8s/configmap.yaml`:

```yaml
data:
  NEXT_PUBLIC_APP_URL: "https://app.supercheck.io"
  APP_URL: "https://app.supercheck.io"
  BETTER_AUTH_URL: "https://app.supercheck.io"
  STATUS_PAGE_DOMAIN: "status.supercheck.io"
  S3_ENDPOINT: "https://your-account.r2.cloudflarestorage.com"
  # ... other settings
```

### 3. Deploy

```bash
cd deploy/k8s
kubectl apply -k .

# Monitor deployment
kubectl -n supercheck get pods -w
```

---

## Manifest Files

### Directory Structure

```
deploy/k8s/
├── kustomization.yaml       # Bundles all manifests
├── namespace.yaml           # Creates supercheck namespace
├── configmap.yaml           # Non-secret configuration
├── secret.yaml              # Sensitive credentials (template)
├── serviceaccount.yaml      # Service account for pods
├── app-deployment.yaml      # Next.js app deployment
├── app-service.yaml         # App ClusterIP service
├── worker-deployment.yaml   # Regional workers (US, EU, APAC)
├── worker-service.yaml      # Worker service (metrics)
├── ingress.yaml             # Ingress rules
├── pdb-app.yaml             # Pod disruption budget (app)
├── pdb-worker.yaml          # Pod disruption budget (worker)
├── keda-scaledobject.yaml   # KEDA autoscaling (optional)
├── cluster-autoscaler.yaml  # Cluster autoscaler (optional)
└── deploy.sh                # Deployment script
```

### Key Components

#### App Deployment

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: supercheck-app
spec:
  replicas: 2
  selector:
    matchLabels:
      app: supercheck-app
  template:
    spec:
      containers:
        - name: app
          image: ghcr.io/supercheck-io/supercheck/app:latest
          ports:
            - containerPort: 3000
          resources:
            requests:
              cpu: "500m"
              memory: "1Gi"
            limits:
              cpu: "1"
              memory: "2Gi"
          livenessProbe:
            httpGet:
              path: /api/health
              port: 3000
          readinessProbe:
            httpGet:
              path: /api/health
              port: 3000
```

#### Worker Deployment

Workers need access to Docker to spawn Playwright and K6 containers. There are two approaches depending on your cluster:

**Option A: Host Docker Socket (K3s Self-Hosted - RECOMMENDED)**

For K3s clusters with Docker runtime installed on worker nodes, mount the host Docker socket.
This is the same approach used by Docker Compose and provides the best performance.

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: supercheck-worker-us
spec:
  replicas: 2
  template:
    spec:
      nodeSelector:
        workload: worker
        region: us-east

      tolerations:
        - key: workload
          operator: Equal
          value: worker
          effect: NoSchedule

      containers:
        - name: worker
          image: ghcr.io/supercheck-io/supercheck/worker:latest
          env:
            - name: WORKER_REGION
              value: "us-east"
            # Mount host Docker socket (same as Docker Compose)
            - name: DOCKER_HOST
              value: "unix:///var/run/docker.sock"
          volumeMounts:
            - name: docker-socket
              mountPath: /var/run/docker.sock
              readOnly: true
          resources:
            requests:
              cpu: "500m"
              memory: "1Gi"
            limits:
              cpu: "2000m"
              memory: "3Gi"
          securityContext:
            runAsNonRoot: true
            runAsUser: 1000

      volumes:
        - name: docker-socket
          hostPath:
            path: /var/run/docker.sock
            type: Socket
```

> **Benefits**: Shared image cache, no privileged containers, same as Docker Compose approach.
> **Requirements**: K3s with `--docker` flag OR Docker installed alongside K3s on worker nodes.

**Option B: Docker-in-Docker Sidecar (Managed K8s)**

For managed Kubernetes (EKS, GKE, AKS) where host Docker socket is not available:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: supercheck-worker-us
spec:
  replicas: 2
  template:
    spec:
      nodeSelector:
        workload: worker
        region: us-east

      containers:
        # Main worker container
        - name: worker
          image: ghcr.io/supercheck-io/supercheck/worker:latest
          env:
            - name: WORKER_REGION
              value: "us-east"
            # Connect to DinD sidecar via TCP
            - name: DOCKER_HOST
              value: "tcp://localhost:2375"
          resources:
            requests:
              cpu: "500m"
              memory: "1Gi"
            limits:
              cpu: "2000m"
              memory: "3Gi"

        # Docker-in-Docker sidecar
        - name: dind
          image: docker:24-dind
          securityContext:
            privileged: true
          env:
            - name: DOCKER_TLS_CERTDIR
              value: "" # Disable TLS for localhost
          args:
            - --storage-driver=overlay2
          resources:
            requests:
              cpu: "250m"
              memory: "512Mi"
            limits:
              cpu: "1000m"
              memory: "2Gi"
          volumeMounts:
            - name: dind-storage
              mountPath: /var/lib/docker

      volumes:
        - name: dind-storage
          emptyDir:
            sizeLimit: 10Gi
```

> **Trade-offs**: Works anywhere but requires privileged containers, images re-pulled on pod restart.
> **Use**: `worker-deployment-dind.yaml` instead of `worker-deployment.yaml`

````

---

## Configuration

### External Services

Configure endpoints in `configmap.yaml`:

```yaml
data:
  # PostgreSQL (PlanetScale)
  DB_HOST: "cluster.psdb.cloud"
  DB_PORT: "6432"  # Use pooler port

  # Redis (Redis Cloud)
  REDIS_HOST: "redis-xxxxx.c123.cloud.redislabs.com"
  REDIS_PORT: "12345"

  # S3 (Cloudflare R2)
  S3_ENDPOINT: "https://account-id.r2.cloudflarestorage.com"
  AWS_REGION: "auto"
````

### Ingress Configuration

For Traefik ingress controller:

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: supercheck-ingress
  annotations:
    traefik.ingress.kubernetes.io/router.entrypoints: websecure
    traefik.ingress.kubernetes.io/router.tls: "true"
spec:
  ingressClassName: traefik
  rules:
    # Main app
    - host: app.supercheck.io
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: supercheck-app
                port:
                  number: 3000

    # Status pages (wildcard)
    - host: "*.status.supercheck.io"
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: supercheck-app
                port:
                  number: 3000
```

---

## Autoscaling

### KEDA Installation

```bash
# Install KEDA
kubectl apply -f https://github.com/kedacore/keda/releases/download/v2.13.2/keda-2.13.2.yaml
```

### ScaledObject Configuration

Workers auto-scale based on Redis queue depth:

```yaml
apiVersion: keda.sh/v1alpha1
kind: ScaledObject
metadata:
  name: supercheck-worker-scaler
  namespace: supercheck
spec:
  scaleTargetRef:
    name: supercheck-worker
  minReplicaCount: 0 # Scale to zero when idle
  maxReplicaCount: 10
  triggers:
    - type: redis
      metadata:
        address: redis.cloud:12345
        listName: bull:playwright-global:wait
        listLength: "5" # Scale up when 5+ jobs waiting
      authenticationRef:
        name: redis-auth
```

### Scaling Behavior

- **Minimum**: 0 pods (scale to zero when idle)
- **Maximum**: 10 pods per region
- **Scale up**: When 5+ jobs waiting in queue
- **Scale down**: Conservative (50% max per minute)

---

## Regional Deployment

For multi-region monitoring, deploy workers with region-specific configuration:

### US East Worker

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: supercheck-worker-us-east
spec:
  template:
    spec:
      containers:
        - name: worker
          env:
            - name: WORKER_LOCATION
              value: "us-east"
      nodeSelector:
        topology.kubernetes.io/region: us-east-1
```

### EU Central Worker

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: supercheck-worker-eu-central
spec:
  template:
    spec:
      containers:
        - name: worker
          env:
            - name: WORKER_LOCATION
              value: "eu-central"
      nodeSelector:
        topology.kubernetes.io/region: eu-central-1
```

---

## High Availability

### Pod Anti-Affinity

Ensure pods spread across nodes:

```yaml
spec:
  template:
    spec:
      affinity:
        podAntiAffinity:
          preferredDuringSchedulingIgnoredDuringExecution:
            - weight: 100
              podAffinityTerm:
                labelSelector:
                  matchLabels:
                    app: supercheck-app
                topologyKey: kubernetes.io/hostname
```

### Pod Disruption Budget

```yaml
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: supercheck-app-pdb
spec:
  minAvailable: 1
  selector:
    matchLabels:
      app: supercheck-app
```

---

## Monitoring

### Health Checks

```bash
# Check pod status
kubectl -n supercheck get pods

# Check app logs
kubectl -n supercheck logs -f deployment/supercheck-app

# Check worker logs
kubectl -n supercheck logs -f deployment/supercheck-worker

# Check KEDA scaling
kubectl -n supercheck get scaledobject
kubectl -n supercheck describe scaledobject supercheck-worker-scaler
```

### Resource Monitoring

```bash
# Node resources
kubectl top nodes

# Pod resources
kubectl -n supercheck top pods

# Events
kubectl -n supercheck get events --sort-by='.lastTimestamp'
```

---

## Troubleshooting

### Common Issues

#### Pods Stuck in Pending

```bash
# Check events
kubectl -n supercheck describe pod <pod-name>

# Common causes:
# - Insufficient resources
# - Node selector not matching
# - PVC not bound
```

#### Worker Can't Execute Tests

```bash
# Check DinD sidecar is running
kubectl -n supercheck get pods -l app.kubernetes.io/component=worker

# Test Docker connectivity via DinD sidecar
kubectl -n supercheck exec -it <worker-pod> -c worker -- docker ps

# Check DinD sidecar logs
kubectl -n supercheck logs <worker-pod> -c dind

# Check worker logs for Docker errors
kubectl -n supercheck logs -f <worker-pod> -c worker | grep -i docker
```

#### Database Connection Issues

```bash
# Test from pod
kubectl -n supercheck exec -it <app-pod> -- \
  psql "$DATABASE_URL" -c "SELECT 1"

# Check secret
kubectl -n supercheck get secret supercheck-secrets -o yaml
```

---

## Security Considerations

### Secret Management

For production, replace `secret.yaml` with:

- **External Secrets Operator** - Sync from AWS Secrets Manager, HashiCorp Vault
- **Sealed Secrets** - Encrypt secrets for Git storage
- **SOPS** - Mozilla's secrets management

### Network Policies

Restrict pod communication:

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: supercheck-network-policy
spec:
  podSelector:
    matchLabels:
      app.kubernetes.io/name: supercheck
  policyTypes:
    - Ingress
    - Egress
  ingress:
    - from:
        - namespaceSelector:
            matchLabels:
              name: supercheck
  egress:
    - to:
        - namespaceSelector:
            matchLabels:
              name: supercheck
    - to: [] # Allow external (databases, S3)
```

---

## Related Documentation

- [Environment Variables](../08-operations/ENVIRONMENT_VARIABLES.md) - All configuration options
- [Docker Compose Guide](./DOCKER_COMPOSE_GUIDE.md) - Alternative deployment method
- [Terraform Infrastructure](./TERRAFORM_GUIDE.md) - Infrastructure as code
- [Scaling Guide](./SCALING_GUIDE.md) - Scaling strategies
