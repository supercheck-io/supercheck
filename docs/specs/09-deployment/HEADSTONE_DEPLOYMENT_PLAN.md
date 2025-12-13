# SuperCheck Deployment Plan - Hetzner K3s Multi-Region Cluster

> **Date**: 2025-12-14  
> **Objective**: Deploy SuperCheck on Hetzner Cloud with K3s multi-region cluster using Terraform

## Executive Summary

Deploy SuperCheck on Hetzner Cloud using a multi-region K3s cluster with:
- **5 nodes** across 3 regions (EU, US, APAC)
- **vSwitch networking** for private cluster communication
- **Docker runtime** on worker nodes for container execution
- **KEDA autoscaling** for workers based on queue depth
- **External managed services** for PostgreSQL, Redis, and S3

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                     HETZNER VSWITCH NETWORK (10.0.0.0/8)                        │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                 │
│  EU-Central (fsn1)              US-East (ash)          Singapore (sin)         │
│  10.0.1.0/24                    10.0.2.0/24            10.0.3.0/24             │
│  ┌─────────────────┐           ┌─────────────┐        ┌─────────────┐          │
│  │ Master 10.0.1.10│           │ Worker      │        │ Worker      │          │
│  │ App    10.0.1.20│←─vSwitch─→│ 10.0.2.100  │←──────→│ 10.0.3.100  │          │
│  │ Worker 10.0.1.100│          └─────────────┘        └─────────────┘          │
│  └─────────────────┘                                                           │
│                                                                                 │
│  External Services: PostgreSQL (Neon/PlanetScale) • Redis (Redis Cloud) • S3 (R2)  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## Prerequisites Checklist

Before starting, ensure you have:

| Item | Required | Notes |
|------|----------|-------|
| Hetzner Cloud Account | ✅ | [Sign up](https://www.hetzner.com/cloud) |
| Hetzner API Token | ✅ | Create in Cloud Console → Security → API Tokens |
| SSH Key Pair | ✅ | `ssh-keygen -t ed25519 -C "your-email"` |
| Terraform v1.0+ | ✅ | [Install Guide](https://developer.hashicorp.com/terraform/downloads) |
| kubectl | ✅ | [Install Guide](https://kubernetes.io/docs/tasks/tools/) |
| PostgreSQL (Managed) | ✅ | [Neon](https://neon.tech) or [PlanetScale](https://planetscale.com) |
| Redis (Managed) | ✅ | [Redis Cloud](https://redis.com/cloud) |
| S3 Storage | ✅ | [Cloudflare R2](https://cloudflare.com/r2) recommended |

---

## Step-by-Step Deployment Guide

### Phase 1: Setup External Services (30-45 min)

#### Step 1.1: Setup PostgreSQL Database

**Option A: Neon (Recommended)**
1. Go to [Neon Console](https://console.neon.tech)
2. Create a new project `supercheck-production`
3. Create database `supercheck`
4. Copy connection string (use pooled connection):
   ```
   postgresql://user:password@ep-xxx.us-east-1.aws.neon.tech/supercheck?sslmode=require
   ```

**Option B: PlanetScale**
1. Go to [PlanetScale Console](https://app.planetscale.com)
2. Create database `supercheck`
3. Use port `6432` for built-in connection pooling

#### Step 1.2: Setup Redis

**Using Redis Cloud**
1. Go to [Redis Cloud Console](https://app.redislabs.com)
2. Create a new subscription (Essentials tier is fine)
3. Create a database named `supercheck`
4. Copy the public endpoint and password:
   ```
   redis://:password@redis-12345.c123.us-east-1-2.ec2.cloud.redislabs.com:12345
   ```

#### Step 1.3: Setup S3-Compatible Storage

**Using Cloudflare R2**
1. Go to [Cloudflare Dashboard](https://dash.cloudflare.com) → R2
2. Create buckets:
   - `supercheck-job-artifacts`
   - `supercheck-test-artifacts`
   - `supercheck-monitor-artifacts`
   - `supercheck-status-artifacts`
   - `supercheck-performance-artifacts`
3. Create R2 API Token (Object Read & Write)
4. Note your Account ID for endpoint URL

---

### Phase 2: Terraform Infrastructure Provisioning (20-30 min)

#### Step 2.1: Configure Terraform Variables

```bash
cd deploy/terraform/hetzner

# Copy example configuration
cp terraform.tfvars.example terraform.tfvars
```

#### Step 2.2: Edit terraform.tfvars

```hcl
# Required - Hetzner Cloud API Token
hcloud_token = "your-hetzner-api-token-here"

# Required - Your SSH public key
ssh_public_key = "ssh-ed25519 AAAA... your-email@example.com"

# Cluster configuration
cluster_name = "supercheck"
k3s_version = "v1.28.4+k3s2"

# Server type (2 vCPU / 4 GB RAM)
server_type = "cx22"

# Node counts
master_count      = 1   # Use 3 for HA
app_node_count    = 1
worker_count_eu   = 1
worker_count_us   = 1
worker_count_apac = 1

# IMPORTANT: Restrict SSH access to your IP
ssh_allowed_ips = ["YOUR_IP/32"]
```

> [!IMPORTANT]
> **Security**: Replace `YOUR_IP/32` with your actual IP address. Never use `0.0.0.0/0` in production!

#### Step 2.3: Initialize and Plan

```bash
# Initialize Terraform
terraform init

# Review the plan
terraform plan
```

#### Step 2.4: Apply Infrastructure

```bash
# Create infrastructure (takes ~5-10 minutes)
terraform apply

# Type 'yes' when prompted
```

#### Step 2.5: Verify Outputs

After successful apply, note the outputs:

```bash
# View all outputs
terraform output

# Key outputs:
# - master_public_ip
# - kubeconfig_command
# - node_label_commands
```

---

### Phase 3: K3s Cluster Configuration (15-20 min)

#### Step 3.1: Get Kubeconfig

```bash
# Run the kubeconfig command from terraform output
$(terraform output -raw kubeconfig_command)

# Set KUBECONFIG or merge with existing
export KUBECONFIG=~/.kube/supercheck-config

# Verify access
kubectl get nodes
```

#### Step 3.2: Wait for All Nodes to Join

```bash
# Wait for all 5 nodes to be Ready (may take 2-5 minutes)
kubectl get nodes -w

# Expected output:
# NAME                      STATUS   ROLES                  AGE
# supercheck-master-1       Ready    control-plane,master   5m
# supercheck-app-1          Ready    <none>                 3m
# supercheck-worker-eu-1    Ready    <none>                 3m
# supercheck-worker-us-1    Ready    <none>                 3m
# supercheck-worker-apac-1  Ready    <none>                 3m
```

#### Step 3.3: Label and Taint Nodes

```bash
# Run the label commands from terraform output
terraform output -raw node_label_commands | bash

# Or manually:
# Label app nodes
kubectl label nodes supercheck-app-1 workload=app

# Label and taint EU worker
kubectl label nodes supercheck-worker-eu-1 workload=worker region=eu-central
kubectl taint nodes supercheck-worker-eu-1 workload=worker:NoSchedule

# Label and taint US worker
kubectl label nodes supercheck-worker-us-1 workload=worker region=us-east
kubectl taint nodes supercheck-worker-us-1 workload=worker:NoSchedule

# Label and taint APAC worker
kubectl label nodes supercheck-worker-apac-1 workload=worker region=asia-pacific
kubectl taint nodes supercheck-worker-apac-1 workload=worker:NoSchedule
```

#### Step 3.4: Verify Labels

```bash
kubectl get nodes --show-labels | grep -E "workload|region"
```

---

### Phase 4: Deploy SuperCheck Application (15-20 min)

#### Step 4.1: Set Environment Variables

```bash
export HCLOUD_TOKEN="your-hetzner-token"
export DATABASE_URL="postgresql://user:pass@postgres.example.com:5432/supercheck?sslmode=require"
export REDIS_URL="redis://:password@redis.example.com:6379"
export BETTER_AUTH_SECRET="$(openssl rand -hex 32)"
export AWS_ACCESS_KEY_ID="your-r2-access-key"
export AWS_SECRET_ACCESS_KEY="your-r2-secret-key"
```

#### Step 4.2: Update ConfigMap

Edit `deploy/k8s/configmap.yaml`:

```yaml
data:
  NEXT_PUBLIC_APP_URL: "https://app.supercheck.io"
  APP_URL: "https://app.supercheck.io"
  BETTER_AUTH_URL: "https://app.supercheck.io"
  
  # Database
  DB_HOST: "ep-xxx.us-east-1.aws.neon.tech"
  DB_PORT: "5432"
  DB_NAME: "supercheck"
  DB_USER: "supercheck"
  
  # Redis
  REDIS_HOST: "redis-12345.c123.us-east-1-2.ec2.cloud.redislabs.com"
  REDIS_PORT: "6379"
  
  # S3 (Cloudflare R2)
  S3_ENDPOINT: "https://YOUR_ACCOUNT_ID.r2.cloudflarestorage.com"
  AWS_REGION: "auto"
```

#### Step 4.3: Update Secrets

Edit `deploy/k8s/secret.yaml`:

```yaml
stringData:
  DATABASE_URL: "postgresql://user:pass@ep-xxx.neon.tech/supercheck?sslmode=require"
  REDIS_URL: "redis://:password@redis-12345.cloud.redislabs.com:12345"
  REDIS_PASSWORD: "your-redis-password"
  
  AWS_ACCESS_KEY_ID: "your-r2-access-key"
  AWS_SECRET_ACCESS_KEY: "your-r2-secret-key"
  
  BETTER_AUTH_SECRET: "your-32-char-secret"
  VARIABLES_ENCRYPTION_KEY: "your-64-char-key"
  CREDENTIAL_ENCRYPTION_KEY: "your-64-char-key"
  SECRET_ENCRYPTION_KEY: "your-64-char-key"
  
  SMTP_PASSWORD: "your-smtp-password"
  OPENAI_API_KEY: "sk-your-openai-key"
```

#### Step 4.4: Run Deploy Script

```bash
cd deploy/k8s
chmod +x deploy.sh
./deploy.sh
```

#### Step 4.5: Monitor Deployment

```bash
# Watch pods come up
kubectl get pods -n supercheck -w

# Check app logs
kubectl logs -f deployment/supercheck-app -n supercheck

# Check worker logs
kubectl logs -f deployment/supercheck-worker-us -n supercheck
```

---

### Phase 5: DNS and Ingress Setup (10-15 min)

#### Step 5.1: Get Master Node IP

```bash
terraform output master_public_ip
# Example: 203.0.113.10
```

#### Step 5.2: Configure DNS

Create the following DNS records:

| Type | Name | Value | TTL |
|------|------|-------|-----|
| A | app.supercheck.io | MASTER_PUBLIC_IP | 300 |
| A | api.supercheck.io | MASTER_PUBLIC_IP | 300 |
| A | *.status.supercheck.io | MASTER_PUBLIC_IP | 300 |

#### Step 5.3: Apply Ingress

Edit `deploy/k8s/ingress.yaml` with your domain, then:

```bash
kubectl apply -f deploy/k8s/ingress.yaml
```

---

### Phase 6: Verification (10-15 min)

#### Step 6.1: Check All Pods Running

```bash
kubectl get pods -n supercheck -o wide

# Expected: All pods in Running state
# supercheck-app-xxx          2/2     Running
# supercheck-worker-us-xxx    1/1     Running
# supercheck-worker-eu-xxx    1/1     Running
# supercheck-worker-apac-xxx  1/1     Running
```

#### Step 6.2: Test Health Endpoints

```bash
# Test app health
curl -s https://app.supercheck.io/api/health | jq

# Expected: {"status":"ok","timestamp":"..."}
```

#### Step 6.3: Verify KEDA Scaling

```bash
# Check ScaledObjects
kubectl get scaledobject -n supercheck

# Check HPA created by KEDA
kubectl get hpa -n supercheck
```

#### Step 6.4: Test Worker Connectivity

```bash
# Exec into worker pod
kubectl exec -it deployment/supercheck-worker-us -n supercheck -- sh

# Test Docker socket
docker info

# Test Redis connectivity
redis-cli -u $REDIS_URL ping
```

---

## Troubleshooting Guide

### Issue: Pods Stuck in Pending

```bash
# Check what's preventing scheduling
kubectl describe pod <pod-name> -n supercheck

# Common causes:
# - Missing node labels → kubectl label nodes <node> workload=worker
# - Missing tolerations → Check deployment yaml
```

### Issue: Workers Can't Access Docker

```bash
# SSH to worker node
ssh root@<worker-ip>

# Check Docker socket
ls -la /var/run/docker.sock

# Should be: srw-rw---- 1 root docker
```

### Issue: KEDA Not Scaling

```bash
# Check KEDA operator logs
kubectl logs -f deployment/keda-operator -n keda

# Verify Redis connection
kubectl exec -it deployment/supercheck-worker-us -n supercheck -- \
  redis-cli -u $REDIS_URL ping
```

---

## Cost Estimation

| Resource | Type | Count | Monthly (EUR) |
|----------|------|-------|---------------|
| Master | CX22 | 1 | €4.50 |
| App | CX22 | 1 | €4.50 |
| Workers | CX22 | 3 | €13.50 |
| vSwitch | - | 1 | Free |
| **Total** | | | **~€25/month** |

Add managed services:
- PostgreSQL (Neon Pro): ~$19/month
- Redis (Redis Cloud): ~$7-15/month
- Storage (R2): ~$0 (generous free tier)

**Total estimated: ~€55-65/month**

---

## Files Review Status

All deployment files have been reviewed and are correct:

| File | Status | Notes |
|------|--------|-------|
| [main.tf](../../../deploy/terraform/hetzner/main.tf) | ✅ Correct | vSwitch, firewalls properly configured |
| [variables.tf](../../../deploy/terraform/hetzner/variables.tf) | ✅ Correct | All variables with sensible defaults |
| [master.tf](../../../deploy/terraform/hetzner/master.tf) | ✅ Correct | cloud-init installs KEDA, uses Traefik (default) |
| [workers.tf](../../../deploy/terraform/hetzner/workers.tf) | ✅ Correct | Docker runtime, multi-region |
| [outputs.tf](../../../deploy/terraform/hetzner/outputs.tf) | ✅ Correct | Label commands, kubeconfig |
| [app-deployment.yaml](../../../deploy/k8s/app-deployment.yaml) | ✅ Correct | Node affinity, security context |
| [worker-deployment.yaml](../../../deploy/k8s/worker-deployment.yaml) | ✅ Correct | Regional workers, Docker socket |
| [keda-scaledobject.yaml](../../../deploy/k8s/keda-scaledobject.yaml) | ✅ Correct | Queue-based scaling |
| [configmap.yaml](../../../deploy/k8s/configmap.yaml) | ✅ Updated | Domain set to supercheck.io |
| [secret.yaml](../../../deploy/k8s/secret.yaml) | ⚠️ Update Required | Replace placeholder secrets |
| [deploy.sh](../../../deploy/k8s/deploy.sh) | ✅ Correct | Automated deployment script |

---

## Security Checklist

- [ ] SSH access restricted to your IP only
- [ ] All secrets are real values (not placeholders)
- [ ] SSL/TLS enabled for all endpoints
- [ ] Database connection uses SSL
- [ ] Redis connection uses TLS
- [ ] Worker pods run as non-root
- [ ] Network policies applied (optional)

---

## Post-Deployment Tasks

1. **Run Database Migrations**
   ```bash
   kubectl exec -it deployment/supercheck-app -n supercheck -- npm run db:migrate
   ```

2. **Create Initial Admin User** (if needed)

3. **Setup Monitoring** (optional)
   - Deploy Prometheus/Grafana
   - Configure alerts

4. **Setup Backups**
   - Neon/PlanetScale handle database backups
   - Configure S3 lifecycle policies

---

## Quick Reference Commands

```bash
# View all SuperCheck resources
kubectl get all -n supercheck

# Scale workers manually
kubectl scale deployment supercheck-worker-us -n supercheck --replicas=3

# View worker logs
kubectl logs -f deployment/supercheck-worker-us -n supercheck

# Restart deployment
kubectl rollout restart deployment/supercheck-app -n supercheck

# Delete and redeploy
kubectl delete -k deploy/k8s/ && kubectl apply -k deploy/k8s/
```

---

## Related Documentation

- [VPS_SETUP_GUIDE.md](./VPS_SETUP_GUIDE.md) - Manual VPS setup
- [K3S_SCALING_GUIDE.md](./K3S_SCALING_GUIDE.md) - Scaling strategies
- [TERRAFORM_GUIDE.md](./TERRAFORM_GUIDE.md) - Terraform details
