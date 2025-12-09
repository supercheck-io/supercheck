# K3s Cluster Scaling Guide

> **Version**: 1.1.0  
> **Last Updated**: 2025-12-09  
> **Status**: Production Ready

This guide provides comprehensive instructions for scaling Supercheck on K3s clusters, including container runtime decisions, external services, security hardening, and production best practices.

---

## Table of Contents

1. [Container Runtime Decision](#1-container-runtime-decision)
2. [Architecture Overview](#2-architecture-overview)
3. [External Services](#3-external-services)
4. [K3s Cluster Setup](#4-k3s-cluster-setup)
5. [Node Scaling Strategy](#5-node-scaling-strategy)
6. [Pod Autoscaling with KEDA](#6-pod-autoscaling-with-keda)
7. [Cluster Autoscaling](#7-cluster-autoscaling)
8. [Resource Management](#8-resource-management)
9. [Security Hardening](#9-security-hardening)
10. [Monitoring & Observability](#10-monitoring--observability)
11. [Disaster Recovery](#11-disaster-recovery)
12. [Troubleshooting](#12-troubleshooting)

---

## 1. Container Runtime Decision

### The Challenge

Supercheck workers spawn **Playwright and K6 containers** to execute tests. This requires access to a container runtime API.

### Options Comparison

| Approach                       | Description                      | Pros                                                                                                         | Cons                                                                |
| ------------------------------ | -------------------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| **K3s + Docker Runtime**       | Install K3s with `--docker` flag | ✅ Same as Docker Compose<br>✅ Shared image cache<br>✅ No privileged containers<br>✅ Simple configuration | ⚠️ Docker overhead<br>⚠️ Deprecated in upstream K8s                 |
| **K3s + containerd + DinD**    | Use DinD sidecar in worker pods  | ✅ Works with any K8s<br>✅ Per-pod isolation                                                                | ❌ Privileged containers<br>❌ No image cache<br>❌ Higher overhead |
| **K3s + containerd + nerdctl** | Use containerd CLI directly      | ✅ Native performance<br>✅ Shared cache                                                                     | ❌ Requires code changes<br>❌ Different API                        |
| **Sysbox Runtime**             | Enhanced container runtime       | ✅ DinD without privileged<br>✅ Better isolation                                                            | ⚠️ Additional setup<br>⚠️ Less mature                               |

### Recommendation: K3s with Docker Runtime

For Supercheck, we **recommend K3s with Docker runtime** on worker nodes:

```bash
# Install K3s with Docker runtime on worker nodes
curl -sfL https://get.k3s.io | K3S_URL=https://MASTER_IP:6443 K3S_TOKEN=TOKEN sh -s - agent --docker
```

**Why Docker Runtime?**

1. **Identical to Docker Compose** - Same socket, same API, same behavior
2. **Shared image cache** - Images persist across pod restarts
3. **No privileged containers** - Workers don't need elevated permissions
4. **Proven stability** - Docker is battle-tested for browser automation
5. **Simpler debugging** - Use familiar Docker commands on nodes

### When to Use DinD Instead

Use the DinD sidecar approach (`worker-deployment-dind.yaml`) when:

- Running on managed Kubernetes (EKS, GKE, AKS)
- Unable to install Docker on nodes
- Requiring strict pod isolation
- Running on shared/multi-tenant clusters

---

## 2. Architecture Overview

### Multi-Region K3s Architecture

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                  SINGLE K3S CLUSTER (Tailscale VPN Mesh)                         │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  EU CENTRAL (Primary)           US EAST              ASIA PACIFIC               │
│  ┌─────────────────────┐       ┌─────────────────┐  ┌─────────────────┐         │
│  │ Master Node         │       │ Worker Node     │  │ Worker Node     │         │
│  │ (2 vCPU / 4 GB)     │──VPN──│ (2 vCPU / 4 GB) │──│ (2 vCPU / 4 GB) │         │
│  │ • K3s Server        │       │ • K3s Agent     │  │ • K3s Agent     │         │
│  │ • Ingress           │       │ • Docker        │  │ • Docker        │         │
│  │ • KEDA              │       │ • Worker Pod    │  │ • Worker Pod    │         │
│  └─────────────────────┘       └─────────────────┘  └─────────────────┘         │
│  ┌─────────────────────┐                                                        │
│  │ App Node            │                                                        │
│  │ (2 vCPU / 4 GB)     │                                                        │
│  │ • K3s Agent         │                                                        │
│  │ • App Pod (Next.js) │                                                        │
│  └─────────────────────┘                                                        │
│  ┌─────────────────────┐                                                        │
│  │ Worker Node         │                                                        │
│  │ (2 vCPU / 4 GB)     │                                                        │
│  │ • K3s Agent         │                                                        │
│  │ • Docker            │                                                        │
│  │ • Worker Pod        │                                                        │
│  └─────────────────────┘                                                        │
│                                                                                  │
├─────────────────────────────────────────────────────────────────────────────────┤
│                         External Services (Managed)                              │
├─────────────────────────────────────────────────────────────────────────────────┤
│  PostgreSQL (Neon/PlanetScale) • Redis (Upstash) • S3 (Cloudflare R2)          │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### Node Types and Sizing (2 vCPU / 4 GB Nodes)

| Node Type  | Role           | Size            | Count | Region       | Labels/Taints                    |
| ---------- | -------------- | --------------- | ----- | ------------ | -------------------------------- |
| **Master** | Control plane  | 2 vCPU / 4 GB   | 1     | EU Central   | `node-role.kubernetes.io/master` |
| **App**    | Next.js app    | 2 vCPU / 4 GB   | 1     | EU Central   | `workload=app`                   |
| **Worker** | Test execution | 2 vCPU / 4 GB   | 1     | EU Central   | `workload=worker, region=eu-central`, taint: `workload=worker:NoSchedule` |
| **Worker** | Test execution | 2 vCPU / 4 GB   | 1     | US East      | `workload=worker, region=us-east`, taint: `workload=worker:NoSchedule` |
| **Worker** | Test execution | 2 vCPU / 4 GB   | 1     | Asia Pacific | `workload=worker, region=asia-pacific`, taint: `workload=worker:NoSchedule` |

**Total: 5 nodes (~€25/month on Hetzner CX22)**

---

## 3. External Services

### Why External Services?

For production K3s clusters, we **strongly recommend managed external services**:

- **Reduced operational overhead** - No database administration
- **Built-in HA and backups** - Automatic failover and point-in-time recovery
- **Better performance** - Optimized infrastructure
- **Simpler scaling** - Click to scale, not cluster reconfiguration

### Recommended Services

#### PostgreSQL

| Provider                      | Tier         | Features                                  | Cost    |
| ----------------------------- | ------------ | ----------------------------------------- | ------- |
| **PlanetScale** (Recommended) | Scaler       | Serverless, branching, auto-scaling       | $29+/mo |
| **Neon**                      | Pro          | Serverless, branching, generous free tier | $19+/mo |
| **Supabase**                  | Pro          | Postgres + extras, good DX                | $25+/mo |
| **AWS RDS**                   | db.t3.medium | Managed, Multi-AZ available               | $50+/mo |

```yaml
# ConfigMap settings for PlanetScale
data:
  DB_HOST: "aws.connect.psdb.cloud"
  DB_PORT: "3306" # PlanetScale uses MySQL protocol
  DB_SSL: "true"
```

#### Redis

| Provider                  | Tier           | Features                      | Cost            |
| ------------------------- | -------------- | ----------------------------- | --------------- |
| **Upstash** (Recommended) | Pay-per-use    | Serverless, global, REST API  | $0.20/100K cmds |
| **Redis Cloud**           | Essentials     | Managed Redis, good free tier | $7+/mo          |
| **AWS ElastiCache**       | cache.t3.micro | Managed, VPC integration      | $12+/mo         |

```yaml
# ConfigMap settings for Upstash
data:
  REDIS_HOST: "global-redis.upstash.io"
  REDIS_PORT: "6379"
  REDIS_TLS: "true"
```

#### S3-Compatible Storage

| Provider                        | Features                      | Cost                  |
| ------------------------------- | ----------------------------- | --------------------- |
| **Cloudflare R2** (Recommended) | No egress fees, S3-compatible | $0.015/GB/mo          |
| **Backblaze B2**                | Cheap storage, S3-compatible  | $0.005/GB/mo          |
| **AWS S3**                      | Full-featured, integrations   | $0.023/GB/mo + egress |

```yaml
# ConfigMap settings for Cloudflare R2
data:
  S3_ENDPOINT: "https://ACCOUNT_ID.r2.cloudflarestorage.com"
  AWS_REGION: "auto"
  S3_FORCE_PATH_STYLE: "true"
```

#### SMTP

| Provider                 | Features                    | Cost                  |
| ------------------------ | --------------------------- | --------------------- |
| **Resend** (Recommended) | Developer-friendly, good DX | 3K free, $20+/mo      |
| **SendGrid**             | Proven, high volume         | 100/day free, $15+/mo |
| **AWS SES**              | Cheap, AWS integration      | $0.10/1K emails       |

### Service Configuration

Create a comprehensive secret:

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: supercheck-secret
  namespace: supercheck
type: Opaque
stringData:
  # PostgreSQL (PlanetScale)
  DATABASE_URL: "mysql://user:pass@aws.connect.psdb.cloud/supercheck?sslaccept=strict"

  # Redis (Upstash)
  REDIS_URL: "rediss://:token@global-redis.upstash.io:6379"

  # S3 (Cloudflare R2)
  AWS_ACCESS_KEY_ID: "your-r2-access-key"
  AWS_SECRET_ACCESS_KEY: "your-r2-secret-key"

  # Authentication
  BETTER_AUTH_SECRET: "your-32-char-secret"
  SECRET_ENCRYPTION_KEY: "your-32-char-key"

  # SMTP (Resend)
  SMTP_PASSWORD: "re_your_resend_api_key"

  # AI (OpenAI)
  OPENAI_API_KEY: "sk-your-openai-key"
```

---

## 4. K3s Cluster Setup

### Prerequisites: Hetzner vSwitch Network

For multi-region clusters, use Hetzner vSwitch for private networking:

1. Create a network in Hetzner Cloud Console (10.0.0.0/8)
2. Create subnets for each region:
   - EU: 10.0.1.0/24
   - US: 10.0.2.0/24
   - APAC: 10.0.3.0/24
3. Attach all servers to the network

### Deployment Options

| Method | Complexity | Best For |
|--------|------------|----------|
| **Terraform** | Easiest | Production |
| **Scripts** | Medium | Customization |
| **Manual** | Most control | Learning |

### Option A: Terraform (Recommended)

```bash
cd deploy/terraform/hetzner
cp terraform.tfvars.example terraform.tfvars
vim terraform.tfvars  # Add Hetzner token and SSH key

terraform init
terraform apply
```

### Option B: Setup Scripts

We provide automated setup scripts in `deploy/k8s/scripts/`:

| Script | Purpose |
|--------|---------|
| `setup-vps.sh` | Base VPS setup (firewall, sysctl, Tailscale) |
| `setup-master.sh` | K3s master node with Ingress, KEDA |
| `setup-worker.sh` | K3s worker node with Docker |
| `setup-app-node.sh` | K3s app node (no Docker) |

### Master Node Installation

```bash
# Using setup script (after attaching to vSwitch)
./setup-master.sh --public-ip YOUR_PUBLIC_IP

# Or manually with auto-detected IPs:
curl -sfL https://get.k3s.io | sh -s - server \
  --cluster-init \
  --tls-san $(curl -s ifconfig.me) \
  --tls-san app.supercheck.io \
  --disable traefik \
  --disable servicelb \
  --node-ip $(ip -4 addr show eth0 | grep -oP '(?<=inet\s)10\.\d+\.\d+\.\d+' | head -1) \
  --flannel-iface eth0 \
  --write-kubeconfig-mode 644

# Get join token
sudo cat /var/lib/rancher/k3s/server/node-token

# Copy kubeconfig
mkdir -p ~/.kube
sudo cp /etc/rancher/k3s/k3s.yaml ~/.kube/config
sudo chown $(id -u):$(id -g) ~/.kube/config
```

### App Node Installation

```bash
# Using setup script
./setup-app-node.sh --master-ip 10.0.1.10 --token YOUR_TOKEN

# Or manually:
curl -sfL https://get.k3s.io | K3S_URL=https://10.0.1.10:6443 \
  K3S_TOKEN=TOKEN sh -s - agent \
  --node-ip $(ip -4 addr show eth0 | grep -oP '(?<=inet\s)10\.\d+\.\d+\.\d+' | head -1) \
  --flannel-iface eth0

# Label app node (from master)
kubectl label nodes k3s-app workload=app
```

# Get join token
sudo cat /var/lib/rancher/k3s/server/node-token

# Copy kubeconfig
mkdir -p ~/.kube
sudo cp /etc/rancher/k3s/k3s.yaml ~/.kube/config
sudo chown $(id -u):$(id -g) ~/.kube/config
```

### App Node Installation

```bash
# Run setup script
./setup-app-node.sh --master-ip MASTER_TAILSCALE_IP --token YOUR_TOKEN

# Or manually:
curl -sfL https://get.k3s.io | K3S_URL=https://MASTER_TAILSCALE_IP:6443 \
  K3S_TOKEN=TOKEN sh -s - agent \
  --flannel-iface tailscale0 \
  --node-ip $(tailscale ip -4)

# Label app node (from master)
kubectl label nodes k3s-app-eu workload=app
```

### Worker Node Installation (with Docker)

```bash
# Run setup script
./setup-worker.sh --master-ip MASTER_TAILSCALE_IP --token YOUR_TOKEN --region us-east

# Or manually:
# Install Docker first
curl -fsSL https://get.docker.com | sh
sudo systemctl enable docker
sudo systemctl start docker

# Configure Docker for production
sudo tee /etc/docker/daemon.json <<EOF
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "10m",
    "max-file": "3"
  },
  "storage-driver": "overlay2",
  "live-restore": true
}
EOF
sudo systemctl restart docker

# Install K3s with Docker runtime
curl -sfL https://get.k3s.io | K3S_URL=https://MASTER_TAILSCALE_IP:6443 \
  K3S_TOKEN=TOKEN sh -s - agent \
  --docker \
  --flannel-iface tailscale0 \
  --node-ip $(tailscale ip -4)

# Label and taint worker node (from master)
kubectl label nodes k3s-worker-us workload=worker region=us-east
kubectl taint nodes k3s-worker-us workload=worker:NoSchedule
```

### Install Required Components

```bash
# Install NGINX Ingress Controller
kubectl apply -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/controller-v1.9.0/deploy/static/provider/baremetal/deploy.yaml

# Install cert-manager
kubectl apply -f https://github.com/cert-manager/cert-manager/releases/download/v1.13.0/cert-manager.yaml

# Install KEDA
kubectl apply --server-side -f https://github.com/kedacore/keda/releases/download/v2.13.0/keda-2.13.0.yaml

# Install metrics-server (if not included)
kubectl apply -f https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml
```

---

## 5. Node Scaling Strategy

### Horizontal Pod Autoscaling

Workers scale based on queue depth, not CPU/memory:

```
Queue Depth → KEDA → Scale Pods → (If nodes full) → Cluster Autoscaler → Add Nodes
```

### Node Pool Sizing

| Workload           | Pods per Node | Node Size      | Rationale                               |
| ------------------ | ------------- | -------------- | --------------------------------------- |
| **App**            | 2-4 pods      | 2 vCPU / 4 GB  | Low resource, high availability         |
| **Worker**         | 2-4 pods      | 4 vCPU / 8 GB  | Each pod needs 2 vCPU + Docker overhead |
| **Worker (heavy)** | 2 pods        | 8 vCPU / 16 GB | Memory-intensive Playwright tests       |

### Scaling Thresholds

```yaml
# KEDA ScaledObject for workers
apiVersion: keda.sh/v1alpha1
kind: ScaledObject
metadata:
  name: worker-scaler
spec:
  scaleTargetRef:
    name: supercheck-worker-us
  minReplicaCount: 1 # Always keep 1 worker
  maxReplicaCount: 10 # Max 10 workers per region
  cooldownPeriod: 300 # 5 min cooldown before scale down

  triggers:
    - type: redis
      metadata:
        address: redis.upstash.io:6379
        listName: bull:playwright-global:wait
        listLength: "5" # Scale up when 5+ jobs waiting
        enableTLS: "true"
      authenticationRef:
        name: redis-auth
```

---

## 6. Pod Autoscaling with KEDA

### KEDA Installation

```bash
# Install KEDA
kubectl apply -f https://github.com/kedacore/keda/releases/download/v2.13.0/keda-2.13.0.yaml

# Verify installation
kubectl get pods -n keda
```

### Redis Authentication

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: redis-auth
  namespace: supercheck
type: Opaque
stringData:
  password: "your-redis-password"

---
apiVersion: keda.sh/v1alpha1
kind: TriggerAuthentication
metadata:
  name: redis-auth
  namespace: supercheck
spec:
  secretTargetRef:
    - parameter: password
      name: redis-auth
      key: password
```

### ScaledObjects for All Queues

```yaml
# Playwright Global Workers
apiVersion: keda.sh/v1alpha1
kind: ScaledObject
metadata:
  name: scaler-worker-us
  namespace: supercheck
spec:
  scaleTargetRef:
    name: supercheck-worker-us
  minReplicaCount: 1
  maxReplicaCount: 10
  cooldownPeriod: 300
  pollingInterval: 15

  triggers:
    # Playwright queue
    - type: redis
      metadata:
        address: redis.cloud:6379
        listName: bull:playwright-global:wait
        listLength: "5"
        enableTLS: "true"
      authenticationRef:
        name: redis-auth

    # K6 regional queue
    - type: redis
      metadata:
        address: redis.cloud:6379
        listName: bull:k6-us-east:wait
        listLength: "3"
        enableTLS: "true"
      authenticationRef:
        name: redis-auth

    # Monitor regional queue
    - type: redis
      metadata:
        address: redis.cloud:6379
        listName: bull:monitor-us-east:wait
        listLength: "10"
        enableTLS: "true"
      authenticationRef:
        name: redis-auth

---
# Similar ScaledObjects for EU and APAC workers...
```

### Scaling Behavior

```yaml
apiVersion: keda.sh/v1alpha1
kind: ScaledObject
spec:
  advanced:
    horizontalPodAutoscalerConfig:
      behavior:
        scaleUp:
          stabilizationWindowSeconds: 0 # Scale up immediately
          policies:
            - type: Pods
              value: 4 # Add up to 4 pods
              periodSeconds: 15
        scaleDown:
          stabilizationWindowSeconds: 300 # Wait 5 min before scale down
          policies:
            - type: Percent
              value: 25 # Remove 25% at a time
              periodSeconds: 60
```

---

## 7. Cluster Autoscaling

### Hetzner Cloud Cluster Autoscaler

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: cluster-autoscaler
  namespace: kube-system
spec:
  replicas: 1
  selector:
    matchLabels:
      app: cluster-autoscaler
  template:
    metadata:
      labels:
        app: cluster-autoscaler
    spec:
      serviceAccountName: cluster-autoscaler
      containers:
        - name: cluster-autoscaler
          image: registry.k8s.io/autoscaling/cluster-autoscaler:v1.28.0
          command:
            - ./cluster-autoscaler
            - --cloud-provider=hetzner
            - --nodes=1:10:worker-pool # Min 1, Max 10 worker nodes
            - --scale-down-delay-after-add=10m
            - --scale-down-unneeded-time=5m
            - --skip-nodes-with-local-storage=false
          env:
            - name: HCLOUD_TOKEN
              valueFrom:
                secretKeyRef:
                  name: hcloud-token
                  key: token
            - name: HCLOUD_NETWORK
              value: "supercheck-network"
          resources:
            requests:
              cpu: 100m
              memory: 300Mi
            limits:
              cpu: 100m
              memory: 300Mi
```

### Node Pool Configuration

```bash
# Create worker node pool with autoscaling
hcloud server create \
  --name worker-pool-template \
  --type cx41 \
  --image ubuntu-24.04 \
  --ssh-key admin \
  --network supercheck-network \
  --label pool=worker \
  --label autoscale=true

# The cluster autoscaler will create nodes based on this template
```

---

## 8. Resource Management

### Pod Resource Limits

```yaml
# Worker pods
resources:
  requests:
    cpu: "500m"
    memory: "1Gi"
  limits:
    cpu: "2000m"
    memory: "3Gi"

# App pods
resources:
  requests:
    cpu: "250m"
    memory: "512Mi"
  limits:
    cpu: "1000m"
    memory: "2Gi"
```

### Resource Quotas

```yaml
apiVersion: v1
kind: ResourceQuota
metadata:
  name: supercheck-quota
  namespace: supercheck
spec:
  hard:
    requests.cpu: "20"
    requests.memory: 40Gi
    limits.cpu: "40"
    limits.memory: 80Gi
    pods: "50"
    services: "10"
    persistentvolumeclaims: "10"
```

### Limit Ranges

```yaml
apiVersion: v1
kind: LimitRange
metadata:
  name: supercheck-limits
  namespace: supercheck
spec:
  limits:
    - type: Pod
      max:
        cpu: "4"
        memory: 8Gi
      min:
        cpu: "100m"
        memory: 128Mi
    - type: Container
      default:
        cpu: "500m"
        memory: 512Mi
      defaultRequest:
        cpu: "250m"
        memory: 256Mi
      max:
        cpu: "2"
        memory: 4Gi
      min:
        cpu: "50m"
        memory: 64Mi
```

### Priority Classes

```yaml
apiVersion: scheduling.k8s.io/v1
kind: PriorityClass
metadata:
  name: supercheck-critical
value: 1000000
globalDefault: false
description: "Critical Supercheck components"

---
apiVersion: scheduling.k8s.io/v1
kind: PriorityClass
metadata:
  name: supercheck-worker
value: 100000
globalDefault: false
description: "Supercheck worker pods"
```

---

## 9. Security Hardening

### Network Policies

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: worker-network-policy
  namespace: supercheck
spec:
  podSelector:
    matchLabels:
      app.kubernetes.io/component: worker
  policyTypes:
    - Ingress
    - Egress
  ingress:
    # Allow health checks from anywhere in cluster
    - from: []
      ports:
        - protocol: TCP
          port: 8000
  egress:
    # Allow DNS
    - to: []
      ports:
        - protocol: UDP
          port: 53
    # Allow external services (Redis, PostgreSQL, S3)
    - to:
        - ipBlock:
            cidr: 0.0.0.0/0
            except:
              - 10.0.0.0/8
              - 172.16.0.0/12
              - 192.168.0.0/16
      ports:
        - protocol: TCP
          port: 443
        - protocol: TCP
          port: 6379
        - protocol: TCP
          port: 5432
        - protocol: TCP
          port: 3306
```

### Pod Security Standards

```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: supercheck
  labels:
    pod-security.kubernetes.io/enforce: restricted
    pod-security.kubernetes.io/audit: restricted
    pod-security.kubernetes.io/warn: restricted
```

### RBAC

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: supercheck-role
  namespace: supercheck
rules:
  - apiGroups: [""]
    resources: ["pods", "pods/log"]
    verbs: ["get", "list", "watch"]
  - apiGroups: [""]
    resources: ["configmaps", "secrets"]
    verbs: ["get", "list"]

---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: supercheck-binding
  namespace: supercheck
subjects:
  - kind: ServiceAccount
    name: supercheck
    namespace: supercheck
roleRef:
  kind: Role
  name: supercheck-role
  apiGroup: rbac.authorization.k8s.io
```

### Secret Management

For production, use external secret management:

```yaml
# ExternalSecrets with AWS Secrets Manager
apiVersion: external-secrets.io/v1beta1
kind: ExternalSecret
metadata:
  name: supercheck-secret
  namespace: supercheck
spec:
  refreshInterval: 1h
  secretStoreRef:
    name: aws-secrets-manager
    kind: ClusterSecretStore
  target:
    name: supercheck-secret
  data:
    - secretKey: DATABASE_URL
      remoteRef:
        key: supercheck/production
        property: DATABASE_URL
    - secretKey: REDIS_URL
      remoteRef:
        key: supercheck/production
        property: REDIS_URL
```

---

## 10. Monitoring & Observability

### Prometheus & Grafana Stack

```bash
# Install kube-prometheus-stack
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
helm install monitoring prometheus-community/kube-prometheus-stack \
  --namespace monitoring \
  --create-namespace \
  --set grafana.adminPassword=admin
```

### ServiceMonitor for Workers

```yaml
apiVersion: monitoring.coreos.com/v1
kind: ServiceMonitor
metadata:
  name: supercheck-workers
  namespace: monitoring
spec:
  selector:
    matchLabels:
      app.kubernetes.io/name: supercheck
      app.kubernetes.io/component: worker
  namespaceSelector:
    matchNames:
      - supercheck
  endpoints:
    - port: http
      path: /metrics
      interval: 30s
```

### Key Metrics to Monitor

| Metric                                     | Alert Threshold | Description            |
| ------------------------------------------ | --------------- | ---------------------- |
| `bull_queue_waiting`                       | > 50            | Jobs waiting in queue  |
| `container_spawn_duration_seconds`         | > 30s           | Slow container startup |
| `test_execution_duration_seconds`          | > 120s          | Slow test execution    |
| `container_memory_usage_bytes`             | > 2GB           | High memory usage      |
| `kube_pod_container_status_restarts_total` | > 5/hour        | Frequent restarts      |

### Alerting Rules

```yaml
apiVersion: monitoring.coreos.com/v1
kind: PrometheusRule
metadata:
  name: supercheck-alerts
  namespace: monitoring
spec:
  groups:
    - name: supercheck
      rules:
        - alert: HighQueueDepth
          expr: sum(bull_queue_waiting) > 100
          for: 5m
          labels:
            severity: warning
          annotations:
            summary: "High queue depth detected"
            description: "Queue has {{ $value }} waiting jobs"

        - alert: WorkerDown
          expr: up{job="supercheck-worker"} == 0
          for: 2m
          labels:
            severity: critical
          annotations:
            summary: "Worker pod is down"

        - alert: SlowContainerSpawn
          expr: histogram_quantile(0.95, container_spawn_duration_seconds_bucket) > 30
          for: 5m
          labels:
            severity: warning
          annotations:
            summary: "Slow container spawn times"
```

### Log Aggregation

```bash
# Install Loki stack
helm repo add grafana https://grafana.github.io/helm-charts
helm install loki grafana/loki-stack \
  --namespace monitoring \
  --set promtail.enabled=true \
  --set loki.persistence.enabled=true \
  --set loki.persistence.size=10Gi
```

---

## 11. Disaster Recovery

### Backup Strategy

```yaml
# Velero backup schedule
apiVersion: velero.io/v1
kind: Schedule
metadata:
  name: supercheck-daily
  namespace: velero
spec:
  schedule: "0 2 * * *" # 2 AM daily
  template:
    includedNamespaces:
      - supercheck
    excludedResources:
      - pods
      - events
    storageLocation: default
    ttl: 720h # 30 days
```

### etcd Backup (for K3s)

```bash
#!/bin/bash
# /etc/cron.daily/k3s-backup.sh

BACKUP_DIR="/var/backups/k3s"
DATE=$(date +%Y%m%d-%H%M%S)

# Create backup
k3s etcd-snapshot save --name "snapshot-${DATE}"

# Upload to S3
aws s3 cp /var/lib/rancher/k3s/server/db/snapshots/snapshot-${DATE} \
  s3://supercheck-backups/k3s/

# Clean old backups (keep 7 days)
find $BACKUP_DIR -mtime +7 -delete
```

### Recovery Procedures

```bash
# Restore from etcd snapshot
k3s server --cluster-reset --cluster-reset-restore-path=/path/to/snapshot

# Restore namespace from Velero
velero restore create --from-backup supercheck-daily-20231201
```

---

## 12. Troubleshooting

### Common Issues

#### Workers Not Spawning Containers

```bash
# Check Docker socket on worker nodes
ssh worker-node-1 "ls -la /var/run/docker.sock"

# Verify Docker is running
ssh worker-node-1 "docker info"

# Check worker pod logs
kubectl logs -n supercheck deploy/supercheck-worker-us -c worker

# Test Docker from worker pod
kubectl exec -it -n supercheck deploy/supercheck-worker-us -- docker info
```

#### KEDA Not Scaling

```bash
# Check KEDA operator logs
kubectl logs -n keda deploy/keda-operator

# Check ScaledObject status
kubectl describe scaledobject -n supercheck worker-scaler

# Verify Redis connection
kubectl run redis-test --rm -it --image=redis -- redis-cli -h redis.cloud -p 6379 LLEN bull:playwright-global:wait
```

#### High Memory Usage

```bash
# Check node memory
kubectl top nodes

# Check pod memory
kubectl top pods -n supercheck

# Describe node for memory pressure
kubectl describe node worker-node-1 | grep -A5 Conditions

# Check Docker container memory on node
ssh worker-node-1 "docker stats --no-stream"
```

#### Network Issues

```bash
# Test external service connectivity
kubectl run test --rm -it --image=busybox -- wget -qO- https://api.openai.com/v1/models

# Check DNS resolution
kubectl run test --rm -it --image=busybox -- nslookup redis.cloud

# Check network policies
kubectl get networkpolicies -n supercheck
```

### Debug Commands

```bash
# Get all resources in namespace
kubectl get all -n supercheck

# Check events
kubectl get events -n supercheck --sort-by='.lastTimestamp'

# Describe failing pod
kubectl describe pod -n supercheck <pod-name>

# Get logs with previous container
kubectl logs -n supercheck <pod-name> --previous

# Exec into worker pod
kubectl exec -it -n supercheck deploy/supercheck-worker-us -- /bin/sh

# Port forward for debugging
kubectl port-forward -n supercheck svc/supercheck-app 3000:3000
```

---

## Quick Reference

### Scaling Commands

```bash
# Manual scale workers
kubectl scale deploy -n supercheck supercheck-worker-us --replicas=5

# Check HPA status
kubectl get hpa -n supercheck

# Check KEDA ScaledObjects
kubectl get scaledobjects -n supercheck

# View current replicas
kubectl get deploy -n supercheck
```

### Health Checks

```bash
# Check all pods healthy
kubectl get pods -n supercheck -o wide

# Check endpoints
kubectl get endpoints -n supercheck

# Test app health
curl -s http://app.supercheck.io/api/health | jq

# Test worker health
kubectl port-forward -n supercheck svc/supercheck-worker 8000:8000
curl -s http://localhost:8000/health | jq
```

### Scaling Reference (2 vCPU / 4 GB Nodes)

| Cluster Size   | Total Nodes    | Worker Pods | Concurrent Tests | Est. Cost/mo |
| -------------- | -------------- | ----------- | ---------------- | ------------ |
| **Starter**    | 5 (3 regions)  | 3 pods      | 3 tests          | ~€25        |
| **Small**      | 8 (3 regions)  | 6 pods      | 6 tests          | ~€40        |
| **Medium**     | 12 (3 regions) | 9 pods      | 9 tests          | ~€60        |
| **Large**      | 18 (3 regions) | 15 pods     | 15 tests         | ~€90        |

---

## Related Documentation

- [VPS_SETUP_GUIDE.md](./VPS_SETUP_GUIDE.md) - Node provisioning
- [KUBERNETES_GUIDE.md](./KUBERNETES_GUIDE.md) - K8s deployment basics
- [NODE_SETUP.md](./NODE_SETUP.md) - K3s node configuration
- [ENVIRONMENT_VARIABLES.md](../08-operations/ENVIRONMENT_VARIABLES.md) - Configuration reference
