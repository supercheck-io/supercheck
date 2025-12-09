# Supercheck Kubernetes Manifests

Production-ready manifests for K3s multi-region deployment with Hetzner vSwitch networking.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                     HETZNER VSWITCH NETWORK (10.0.0.0/8)                         │
│                                                                                  │
│  EU-Central (fsn1)              US-East (ash)          Singapore (sin)          │
│  10.0.1.0/24                    10.0.2.0/24            10.0.3.0/24              │
│  ┌─────────────────┐           ┌─────────────┐        ┌─────────────┐          │
│  │ Master + App    │           │ Worker      │        │ Worker      │          │
│  │ 10.0.1.10-20    │←─vSwitch─→│ 10.0.2.100  │←──────→│ 10.0.3.100  │          │
│  ├─────────────────┤           └─────────────┘        └─────────────┘          │
│  │ Worker          │                                                            │
│  │ 10.0.1.100      │                                                            │
│  └─────────────────┘                                                            │
│                                                                                  │
│  External Services: PostgreSQL (managed) • Redis (managed) • S3/R2 (managed)   │
└─────────────────────────────────────────────────────────────────────────────────┘
```

## Node Requirements

| Region | Nodes | Size | Purpose |
|--------|-------|------|---------|
| EU Central | 1 | 2 vCPU / 4 GB | Master (control plane + ingress) |
| EU Central | 1 | 2 vCPU / 4 GB | App (Next.js) |
| EU Central | 1 | 2 vCPU / 4 GB | Worker (eu-central queue) |
| US East | 1 | 2 vCPU / 4 GB | Worker (us-east queue) |
| Asia Pacific | 1 | 2 vCPU / 4 GB | Worker (asia-pacific queue) |
| **Total** | **5** | | **~€25/month on Hetzner CX22** |

## Deployment Options

### Option A: Terraform (Recommended)

Fully automated infrastructure provisioning:

```bash
cd deploy/terraform/hetzner
cp terraform.tfvars.example terraform.tfvars
vim terraform.tfvars  # Add your Hetzner token and SSH key

terraform init
terraform apply

# Get kubeconfig and deploy
$(terraform output -raw kubeconfig_command)
kubectl apply -k ../../k8s/
```

### Option B: Manual Setup with Scripts

See [scripts/README.md](scripts/) for manual setup using bash scripts.

### 1. Provision VPS Nodes

Create 5 VPS instances (2 vCPU / 4 GB each) in 3 regions:
- EU Central: master, app, worker
- US East: worker
- Asia Pacific: worker

### 2. Setup VPN Mesh (Tailscale)

On **each node**:
```bash
# Copy scripts
scp deploy/k8s/scripts/*.sh user@node:/home/user/

# Run base setup
ssh user@node
sudo ./setup-vps.sh

# Authenticate Tailscale (use same account for all)
sudo tailscale up
tailscale ip -4  # Note this IP
```

### 3. Setup Master Node (EU)

```bash
./setup-master.sh --public-ip YOUR_PUBLIC_IP
```

Save the node token from the output.

### 4. Setup Worker Nodes

On each worker node:
```bash
./setup-worker.sh \
  --master-ip MASTER_TAILSCALE_IP \
  --token "K10xxx..." \
  --region us-east  # or eu-central, asia-pacific
```

### 5. Label Nodes (from master)

```bash
# Worker nodes
kubectl label nodes k3s-worker-us workload=worker region=us-east
kubectl label nodes k3s-worker-eu workload=worker region=eu-central
kubectl label nodes k3s-worker-apac workload=worker region=asia-pacific

# Add taints
kubectl taint nodes k3s-worker-us workload=worker:NoSchedule
kubectl taint nodes k3s-worker-eu workload=worker:NoSchedule
kubectl taint nodes k3s-worker-apac workload=worker:NoSchedule

# App node
kubectl label nodes k3s-app-eu workload=app
```

### 6. Configure Secrets

Edit `secret.yaml` with your managed service credentials:
```yaml
stringData:
  DATABASE_URL: "postgresql://user:pass@host:5432/supercheck"
  REDIS_URL: "redis://:password@redis.cloud:6379"
  BETTER_AUTH_SECRET: "your-32-char-secret"
  AWS_ACCESS_KEY_ID: "your-r2-key"
  # ...
```

### 7. Deploy

```bash
kubectl apply -k .
kubectl -n supercheck get pods -o wide
```

## Docker Execution Strategy

Workers need Docker to spawn Playwright/K6 containers:

| Approach | When to Use |
|----------|-------------|
| **Host Docker Socket** (default) | K3s with `--docker` flag (recommended) |
| **DinD Sidecar** | Managed K8s (EKS, GKE, AKS) |

For DinD, use `worker-deployment-dind.yaml` instead.

## Autoscaling

KEDA scales workers based on Redis queue depth:

```yaml
minReplicaCount: 1   # Always 1 worker per region
maxReplicaCount: 5   # Max 5 (needs 5 nodes per region)
triggers:
  - queue: bull:playwright-global:wait
    threshold: 10 jobs
```

## Monitoring

```bash
# Check pods
kubectl -n supercheck get pods -o wide

# Worker logs
kubectl -n supercheck logs -f deploy/supercheck-worker-us -c worker

# KEDA status
kubectl -n supercheck get scaledobjects

# Node resources
kubectl top nodes
```

## Troubleshooting

### Worker Can't Execute Tests
```bash
# Verify Docker socket on worker node
ssh worker-node "ls -la /var/run/docker.sock"

# Test from worker pod
kubectl -n supercheck exec -it deploy/supercheck-worker-us -- docker info
```

### Pods Stuck in Pending
```bash
# Check node labels match
kubectl describe pod -n supercheck <pod-name>

# Verify node has correct label
kubectl get nodes --show-labels | grep workload
```

### Cross-Region Connectivity
```bash
# Test Tailscale mesh
tailscale ping <other-node-tailscale-ip>

# Check flannel interface
ip addr show tailscale0
```

