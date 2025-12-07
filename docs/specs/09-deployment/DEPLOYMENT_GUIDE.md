# Supercheck Deployment Guide

Complete guide for deploying Supercheck using Kubernetes and Docker Compose, with best practices and proper architecture.

## 📋 Table of Contents

1. [Quick Start](#quick-start)
2. [Architecture Overview](#architecture-overview)
3. [External Services (Recommended)](#external-services-recommended)
4. [Kubernetes Deployment](#kubernetes-deployment)
5. [Docker Compose Deployment](#docker-compose-deployment)
6. [Node Configuration](#node-configuration)
7. [Scaling & Monitoring](#scaling--monitoring)
8. [Troubleshooting](#troubleshooting)

---

## External Services (Recommended)

For production deployments, we recommend using managed external services for databases and object storage. This eliminates infrastructure management overhead and provides built-in high availability.

### Recommended Stack

| Service            | Provider                                                 | Benefits                                                         |
| ------------------ | -------------------------------------------------------- | ---------------------------------------------------------------- |
| **PostgreSQL**     | [PlanetScale](https://planetscale.com/postgres)          | Built-in PgBouncer (port 6432), automated backups, PITR, 3-AZ HA |
| **Redis**          | [Redis Cloud](https://redis.com/cloud/)                  | Managed HA, automatic failover, no infrastructure to manage      |
| **Object Storage** | [Cloudflare R2](https://www.cloudflare.com/products/r2/) | S3-compatible, zero egress fees, global edge network             |

### Connection Configuration

```bash
# PlanetScale PostgreSQL (use port 6432 for connection pooling)
DATABASE_URL="postgresql://user:pass@your-cluster.us-east-2.psdb.cloud:6432/supercheck?sslmode=require"

# Redis Cloud
REDIS_URL="redis://:password@redis-xxxxx.c123.us-east-2-1.ec2.cloud.redislabs.com:12345"

# Cloudflare R2
S3_ENDPOINT="https://your-account-id.r2.cloudflarestorage.com"
AWS_ACCESS_KEY_ID="your-r2-access-key"
AWS_SECRET_ACCESS_KEY="your-r2-secret-key"
```

### Why External Services?

- **No PgBouncer needed**: PlanetScale includes built-in connection pooling on port 6432
- **No Redis Sentinel/Cluster setup**: Redis Cloud provides managed HA
- **No S3 lifecycle policies to configure**: R2 handles storage management
- **No backup scripts to maintain**: PlanetScale provides automated backups with PITR
- **Focus on application code**, not infrastructure

---

## Quick Start

### Kubernetes (Production Recommended)

```bash
# Set required environment variables
export HCLOUD_TOKEN="your-hetzner-token"
export DATABASE_URL="postgresql://user:pass@postgres:5432/supercheck"
export REDIS_URL="redis://:password@redis:6379"
export BETTER_AUTH_SECRET="your-32-char-hex-secret"
export AWS_ACCESS_KEY_ID="your-access-key"
export AWS_SECRET_ACCESS_KEY="your-secret-key"

# Deploy to K3s cluster
cd deploy/k8s
./deploy.sh
```

### Docker Compose (Development)

```bash
# Local development
docker-compose -f docker/docker-compose-local.yml up -d

# Production with external services
docker-compose -f docker/docker-compose.yml up -d
```

---

## Architecture Overview

### Kubernetes Architecture

```
K3s HA Cluster (Hetzner Cloud)
├── Load Balancer (API Access)
│
├── Master Nodes (3x - HA Control Plane)
│   ├── K3s Server (Embedded etcd)
│   ├── App Workloads (workload=app)
│   └── Pod Anti-Affinity
│
├── Worker Nodes (Scalable)
│   ├── Worker Workloads (workload=worker)
│   ├── Playwright/K6 Executors
│   ├── KEDA Auto-scaling
│   └── Pod Anti-Affinity
│
└── Database Layer (Managed Services)
    ├── PostgreSQL (RDS or managed)
    ├── Redis (ElastiCache or managed)
    └── MinIO/S3 (R2 or S3)
```

### Key Features

| Feature                | Implementation              | Benefit                        |
| ---------------------- | --------------------------- | ------------------------------ |
| **Workload Isolation** | Node labels + Taints        | Prevent app/worker contention  |
| **High Availability**  | Pod anti-affinity           | Survive node failures          |
| **Auto-scaling**       | KEDA + Job queue depth      | Cost efficiency, handle spikes |
| **Cluster Scaling**    | Hetzner autoscaler          | Automatic node provisioning    |
| **Health Checks**      | Liveness + readiness probes | Self-healing pods              |
| **Resource Limits**    | CPU/memory constraints      | Prevent resource exhaustion    |
| **Security**           | Pod security policies, RBAC | Defense in depth               |

---

## Infrastructure Provisioning (Terraform)

For a production-grade setup on Hetzner Cloud, we use Terraform to provision the infrastructure.

### Prerequisites

- Terraform v1.0+
- Hetzner Cloud API Token
- SSH Public Key

### Setup

1. **Initialize Terraform**

   ```bash
   cd deploy/terraform
   terraform init
   ```

2. **Configure Variables**
   Create `deploy/terraform/terraform.tfvars`:

   ```hcl
   hcloud_token       = "your-token"
   ssh_public_key     = "ssh-rsa ..."
   environment        = "production"
   node_count_per_region = 3
   ```

3. **Deploy**

   ```bash
   terraform apply
   ```

4. **Get Kubeconfig**
   Follow the output commands to retrieve and merge kubeconfigs.

For detailed instructions, see [deploy/terraform/README.md](terraform/README.md).

---

## Kubernetes Deployment

### Prerequisites

- K3s 1.28+ cluster running
- 3+ nodes (2 app, 2+ worker, or use 1 node cluster for testing)
- `kubectl` configured
- Hetzner Cloud token (optional, for autoscaling)
- External databases (PostgreSQL, Redis, S3) or use managed services

### Files Updated

#### Deployments

**`app-deployment.yaml`**

- ✅ Added `nodeSelector: workload=app` for node affinity
- ✅ Added `tolerations` for app taint
- ✅ Added `podAntiAffinity` for HA (preferred, spread across nodes)
- ✅ Updated health checks to use `/api/health` endpoint
- ✅ Added proper `periodSeconds` and `failureThreshold`

**`worker-deployment.yaml`**

- ✅ 3 Regional deployments (`us`, `eu`, `apac`)
- ✅ Node affinity: `workload=worker` AND `region={us-east|eu-central|asia-pacific}`
- ✅ Pod anti-affinity for high availability
- ✅ Docker socket volume mount for executors

### Node Tagging for Location-Based Queues

To ensure workers run on the correct nodes and process the correct queues, you must label your worker nodes with the appropriate region.

**1. List Nodes:**

```bash
kubectl get nodes
```

**2. Label Nodes:**
Assign specific nodes to regions. For example, if you have 3 worker nodes:

```bash
# Worker 1 -> US East
kubectl label node <node-1> workload=worker region=us-east

# Worker 2 -> EU Central
kubectl label node <node-2> workload=worker region=eu-central

# Worker 3 -> Asia Pacific
kubectl label node <node-3> workload=worker region=asia-pacific
```

**3. Verify Labels:**

```bash
kubectl get nodes --show-labels
```

This ensures that `supercheck-worker-us` only runs on nodes labeled `region=us-east`, effectively routing US-based jobs to those specific nodes.

#### Scaling & Autoscaling

**`keda-scaledobject.yaml`**

- ✅ Updated Redis addresses to use service DNS name `supercheck-redis:6379`
- ✅ Fixed authentication reference to use `TriggerAuthentication`
- ✅ Configured proper scaling thresholds (5 jobs per pod for regional, 10 for global)
- ✅ Advanced HPA behavior for aggressive scale-up, conservative scale-down

**`cluster-autoscaler.yaml`** (NEW)

- ✅ Hetzner Cloud support for automatic node provisioning
- ✅ RBAC configuration for autoscaler
- ✅ Proper resource limits (100m CPU, 600Mi memory)
- ✅ Configured for worker node scaling (cx41)

#### Configuration & Setup

**`NODE_SETUP.md`** (NEW)

- Step-by-step guide for labeling nodes
- Tainting nodes for workload isolation
- Installing required components (KEDA, Cluster Autoscaler)
- Troubleshooting common issues
- Resource planning for different node sizes

### Deployment Steps

1. **Label and Taint Nodes**

   ```bash
   kubectl label nodes k3s-app-1 workload=app
   kubectl label nodes k3s-worker-1 workload=worker

   kubectl taint nodes k3s-app-1 workload=app:NoSchedule
   kubectl taint nodes k3s-worker-1 workload=worker:NoSchedule
   ```

2. **Install Prerequisites**

   ```bash
   # KEDA for auto-scaling
   kubectl apply -f https://github.com/kedacore/keda/releases/download/v2.13.2/keda-2.13.2.yaml

   # Cluster Autoscaler (if using Hetzner)
   kubectl apply -f deploy/k8s/cluster-autoscaler.yaml
   ```

3. **Deploy Supercheck**

   ```bash
   cd deploy/k8s
   ./deploy.sh
   ```

4. **Monitor Deployment**
   ```bash
   kubectl get pods -n supercheck -w
   kubectl logs -f deployment/supercheck-app -n supercheck
   ```

---

## Docker Compose Deployment

### Files Updated

**`docker-compose-local.yml`**

- ✅ Added `WORKER_LOCATION: local` environment variable
- ✅ Proper Docker socket mounting for worker (`/var/run/docker.sock:ro`)
- ✅ Security constraints: `no-new-privileges`, `cap_drop: ALL`
- ✅ Health checks for all services
- ✅ Proper resource limits for local development

**`docker-compose.yml`**

- ✅ Added `WORKER_LOCATION` environment variable (parametrized)
- ✅ Read-only Docker socket mount for security
- ✅ Proper restart policies and health checks
- ✅ Resource reservations and limits
- ✅ Support for external managed services (PostgreSQL, Redis, S3)

### Usage

#### Local Development

```bash
# Start development environment
docker-compose -f deploy/docker/docker-compose-local.yml up -d

# Scale workers for load testing
WORKER_REPLICAS=2 docker-compose -f deploy/docker/docker-compose-local.yml up -d

# View logs
docker-compose -f deploy/docker/docker-compose-local.yml logs -f worker
```

#### Production

```bash
# Set environment variables
export DATABASE_URL="postgresql://user:pass@postgres.example.com:5432/supercheck"
export REDIS_URL="redis://:password@redis.example.com:6379"
export WORKER_LOCATION="us-east"
export WORKER_REPLICAS="4"

# Deploy
docker-compose -f deploy/docker/docker-compose.yml up -d

# Scale
WORKER_REPLICAS=8 docker-compose -f deploy/docker/docker-compose.yml up -d
```

---

## Node Configuration

### Labeling & Tainting Strategy

```
┌─────────────────────────────────────────┐
│          Node Labeling Strategy         │
├─────────────────────────────────────────┤
│                                         │
│  Labels:           Taints:              │
│  ├─ workload=app   └─ workload=app:NoS │
│  ├─ workload=worker  └─ workload=worker│
│  └─ workload=database  └─ workload=db  │
│                                         │
│  Benefits:                              │
│  • Workload isolation                   │
│  • Prevent bad scheduling               │
│  • Enable pod affinity rules            │
│  • Support multi-tenancy                │
│                                         │
└─────────────────────────────────────────┘
```

### Pod Placement Rules

```yaml
# App Pods
- MUST run on nodes with label workload=app
- MUST tolerate taint workload=app:NoSchedule
- PREFER to spread across different nodes
- Cannot run on worker or database nodes

# Worker Pods
- MUST run on nodes with label workload=worker
- MUST tolerate taint workload=worker:NoSchedule
- PREFER to spread across different nodes
- Cannot run on app or database nodes

# Database Pods
- MUST run on nodes with label workload=database
- MUST tolerate taint workload=database:NoSchedule
- Should use StatefulSet (if self-hosted)
```

---

## Scaling & Monitoring

### Horizontal Pod Autoscaling (KEDA)

Workers auto-scale based on Redis queue depth:

```bash
# Watch KEDA scaling
kubectl get hpa -n supercheck -w

# Check ScaledObject status
kubectl describe scaledobject scaler-worker-us -n supercheck
```

**Scaling Behavior:**

- Minimum replicas: 0 (scale to zero when idle)
- Maximum replicas: 10 per region
- Trigger: 5+ pending jobs per queue
- Aggressive scale-up: Double capacity every 15 seconds if needed
- Conservative scale-down: Max 50% reduction per minute

### Vertical Pod Autoscaling (Manual)

Adjust resource limits in deployment manifests:

```yaml
resources:
  requests:
    cpu: "500m" # Guaranteed minimum
    memory: "1Gi"
  limits:
    cpu: "2" # Hard maximum
    memory: "4Gi"
```

### Monitoring Endpoints

```bash
# App metrics
curl http://localhost:3000/metrics

# Worker metrics
curl http://localhost:8000/metrics

# KEDA metrics
kubectl top pods -n keda

# Node metrics
kubectl top nodes
```

---

## Troubleshooting

### Common Issues

#### 1. Pods Stuck in Pending

```bash
# Check what's preventing scheduling
kubectl describe pod <pod-name> -n supercheck

# Likely causes:
# - Missing node labels
# - Node tainted but pod doesn't tolerate it
# - Insufficient resources
# - Wrong affinity rules
```

**Solution:**

```bash
# Verify node labels
kubectl get nodes --show-labels

# Add missing labels
kubectl label nodes k3s-worker-1 workload=worker
```

#### 2. Worker Can't Access Docker

```bash
# Test Docker socket in pod
kubectl exec -it <worker-pod> -n supercheck -- docker ps

# Check host socket
ssh worker-node
ls -la /var/run/docker.sock
```

**Solution:**

```bash
# Ensure Docker is installed on worker nodes
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh

# Set socket permissions
sudo chmod 666 /var/run/docker.sock
```

#### 3. KEDA Not Scaling

```bash
# Check KEDA logs
kubectl logs -f deployment/keda-operator -n keda

# Verify Redis connection
kubectl exec -it <worker-pod> -n supercheck -- \
  redis-cli -u redis://:password@redis:6379 ping
```

**Solution:**

- Verify Redis credentials in ConfigMap/Secret
- Check Redis service DNS name in KEDA triggers
- Ensure Redis is accessible from cluster

#### 4. Out of Memory (OOM) Kills

```bash
# Check node memory
kubectl top nodes

# Check pod memory usage
kubectl top pods -n supercheck

# Check resource limits
kubectl describe pod <pod-name> -n supercheck
```

**Solution:**

- Increase node size (recommend Hetzner CX33: 4 vCPU, 8GB)
- Scale horizontally with more worker replicas instead of increasing resources per worker
- Implement resource quotas per namespace
- Use KEDA to scale more workers instead of higher limits

---

## Best Practices Implemented

### Security ✅

- [x] Non-root containers (runAsUser: 1000)
- [x] Read-only root filesystem (where possible)
- [x] Dropped capabilities (drop: ALL)
- [x] No privilege escalation (allowPrivilegeEscalation: false)
- [x] Proper RBAC for cluster autoscaler
- [x] Secrets not exposed in env vars (when possible)
- [x] Network policies (can be added)

### Reliability ✅

- [x] Health checks (liveness + readiness probes)
- [x] Resource limits to prevent OOM kills
- [x] Pod disruption budgets for graceful termination
- [x] Rolling updates with zero downtime
- [x] Proper retry policies and timeouts
- [x] Anti-affinity rules for high availability

### Scalability ✅

- [x] Horizontal pod autoscaling (KEDA)
- [x] Cluster autoscaling (Hetzner)
- [x] Pod anti-affinity for distribution
- [x] Resource requests/limits for proper scheduling
- [x] Stateless app design for easy scaling

### Operational Excellence ✅

- [x] Proper logging (structured JSON logs)
- [x] Metrics endpoints for Prometheus
- [x] Deployment automation script
- [x] Comprehensive documentation
- [x] Clear configuration via ConfigMaps
- [x] Secrets management via Kubernetes Secrets

### Cost Optimization ✅

- [x] Scale-to-zero for worker pods
- [x] Resource requests match actual usage
- [x] Auto-scaling reduces idle costs
- [x] Right-sizing for different workloads

---

## References

- [Supercheck Architecture](../docs/specs/01-core/SUPERCHECK_ARCHITECTURE.md)
- [Kubernetes Node Affinity](https://kubernetes.io/docs/concepts/scheduling-eviction/assign-pod-node/#affinity-and-anti-affinity)
- [KEDA Scaler](https://keda.sh/docs/2.0/scalers/redis-lists/)
- [Hetzner Cloud K3s](https://docs.hetzner.cloud/cloud/kubernetes/getting-started/create-cluster)
- [Docker Compose Best Practices](https://docs.docker.com/compose/production/)

---

## Support

For issues or questions:

1. Check [NODE_SETUP.md](./k8s/NODE_SETUP.md) for detailed node configuration
2. Review deployment logs: `kubectl logs -f deployment/supercheck-app -n supercheck`
3. Check KEDA status: `kubectl describe scaledobject scaler-worker-us -n supercheck`
4. Review the Supercheck specs: `docs/specs/` directory
