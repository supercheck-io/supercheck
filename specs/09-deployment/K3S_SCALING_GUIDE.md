# K3s Cluster Scaling Guide

> **Version**: 1.0.0  
> **Last Updated**: 2025-12-03  
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

### Production K3s Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                            K3s Cluster                                       │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────────────┐  ┌─────────────────────┐  ┌─────────────────────┐  │
│  │   Master Node(s)    │  │   App Node Pool     │  │  Worker Node Pool   │  │
│  │   (Control Plane)   │  │   (Next.js App)     │  │  (Test Execution)   │  │
│  ├─────────────────────┤  ├─────────────────────┤  ├─────────────────────┤  │
│  │ • K3s Server        │  │ • App Pods (2+)     │  │ • Worker Pods       │  │
│  │ • API Server        │  │ • Ingress           │  │ • Docker Runtime    │  │
│  │ • etcd/SQLite       │  │ • Cert-Manager      │  │ • KEDA Scaling      │  │
│  │ • Controller Mgr    │  │                     │  │                     │  │
│  └─────────────────────┘  └─────────────────────┘  └─────────────────────┘  │
│                                                                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                         External Services (Managed)                          │
├─────────────────────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐        │
│  │ PostgreSQL  │  │    Redis    │  │  S3/R2      │  │   SMTP      │        │
│  │ (PlanetScale│  │ (Redis Cloud│  │ (Cloudflare │  │ (Resend/    │        │
│  │  or Neon)   │  │  or Upstash)│  │     R2)     │  │  SendGrid)  │        │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘        │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Node Types and Sizing

| Node Type  | Role           | Recommended Size   | Count | Labels/Taints                                          |
| ---------- | -------------- | ------------------ | ----- | ------------------------------------------------------ |
| **Master** | Control plane  | 4 vCPU / 8 GB      | 1-3   | `node-role.kubernetes.io/master`                       |
| **App**    | Next.js app    | 2 vCPU / 4 GB      | 2+    | `workload=app`                                         |
| **Worker** | Test execution | 4-8 vCPU / 8-16 GB | 2+    | `workload=worker`, taint: `workload=worker:NoSchedule` |

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

### Master Node Installation

```bash
# Install first master node
curl -sfL https://get.k3s.io | sh -s - server \
  --cluster-init \
  --tls-san YOUR_EXTERNAL_IP \
  --tls-san app.supercheck.io \
  --disable traefik \
  --disable servicelb \
  --write-kubeconfig-mode 644 \
  --kube-apiserver-arg="enable-admission-plugins=NodeRestriction,PodSecurityPolicy" \
  --kubelet-arg="max-pods=110"

# Get join token
sudo cat /var/lib/rancher/k3s/server/node-token

# Copy kubeconfig
mkdir -p ~/.kube
sudo cp /etc/rancher/k3s/k3s.yaml ~/.kube/config
sudo chown $(id -u):$(id -g) ~/.kube/config
```

### App Node Installation

```bash
# Install app node (standard containerd)
curl -sfL https://get.k3s.io | K3S_URL=https://MASTER_IP:6443 K3S_TOKEN=TOKEN sh -s - agent

# Label app node
kubectl label nodes app-node-1 workload=app
kubectl taint nodes app-node-1 workload=app:NoSchedule
```

### Worker Node Installation (with Docker)

```bash
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
  "live-restore": true,
  "default-ulimits": {
    "nofile": {
      "Name": "nofile",
      "Hard": 65536,
      "Soft": 65536
    }
  }
}
EOF
sudo systemctl restart docker

# Install K3s with Docker runtime
curl -sfL https://get.k3s.io | K3S_URL=https://MASTER_IP:6443 K3S_TOKEN=TOKEN sh -s - agent --docker

# Verify Docker is being used
docker ps | grep k3s

# Label and taint worker node
kubectl label nodes worker-node-1 workload=worker region=us-east
kubectl taint nodes worker-node-1 workload=worker:NoSchedule
```

### Install Required Components

```bash
# Install NGINX Ingress Controller
kubectl apply -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/controller-v1.9.0/deploy/static/provider/cloud/deploy.yaml

# Install cert-manager
kubectl apply -f https://github.com/cert-manager/cert-manager/releases/download/v1.13.0/cert-manager.yaml

# Install KEDA
kubectl apply -f https://github.com/kedacore/keda/releases/download/v2.13.0/keda-2.13.0.yaml

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

### Scaling Reference

| Cluster Size   | Worker Nodes | Worker Pods | Concurrent Tests | Queue Capacity |
| -------------- | ------------ | ----------- | ---------------- | -------------- |
| **Small**      | 2 × 4 vCPU   | 4 pods      | 8 tests          | 50             |
| **Medium**     | 4 × 4 vCPU   | 8 pods      | 16 tests         | 100            |
| **Large**      | 8 × 8 vCPU   | 16 pods     | 32 tests         | 200            |
| **Enterprise** | 16 × 8 vCPU  | 32 pods     | 64 tests         | 500            |

---

## Related Documentation

- [VPS_SETUP_GUIDE.md](./VPS_SETUP_GUIDE.md) - Node provisioning
- [KUBERNETES_GUIDE.md](./KUBERNETES_GUIDE.md) - K8s deployment basics
- [NODE_SETUP.md](./NODE_SETUP.md) - K3s node configuration
- [ENVIRONMENT_VARIABLES.md](../08-operations/ENVIRONMENT_VARIABLES.md) - Configuration reference
