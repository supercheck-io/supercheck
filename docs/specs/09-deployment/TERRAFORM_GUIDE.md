# Terraform Infrastructure Guide

> **Version**: 1.0.0  
> **Last Updated**: 2025-12-03  
> **Status**: Production Ready

## Overview

Terraform configuration for provisioning Supercheck infrastructure on **Hetzner Cloud**. This creates a K3s Kubernetes cluster with proper node configuration for running Supercheck workloads.

> **Note**: For most deployments, we recommend using **managed Kubernetes services** (EKS, GKE, AKS) instead of self-managed K3s. This Terraform is provided for users who prefer Hetzner Cloud for cost optimization.

---

## Architecture

```
Hetzner Cloud Infrastructure
├── Private Network (10.0.0.0/16)
│   └── Subnet for cluster communication
│
├── Load Balancer
│   └── Kubernetes API (port 6443)
│
├── Master Nodes (3x for HA)
│   ├── K3s Server with embedded etcd
│   ├── Control plane workloads
│   └── Server type: cx21 (2 vCPU / 4 GB)
│
├── Worker Nodes (3x default)
│   ├── Supercheck workloads
│   ├── Docker-in-Docker for test execution
│   └── Server type: cpx31 (4 vCPU / 8 GB)
│
└── Firewall Rules
    ├── SSH (22) - Restricted
    ├── K8s API (6443)
    ├── HTTP (80)
    └── HTTPS (443)
```

---

## Prerequisites

1. **Terraform**: v1.0+ ([Install Guide](https://developer.hashicorp.com/terraform/downloads))
2. **Hetzner Cloud Account**: [Sign up](https://console.hetzner.cloud/)
3. **API Token**: Create in Hetzner Cloud Console
4. **SSH Key**: Public key for node access

---

## Quick Start

### 1. Initialize

```bash
cd deploy/terraform
terraform init
```

### 2. Configure Variables

Create `terraform.tfvars`:

```hcl
# Required
hcloud_token   = "your-hetzner-api-token"
ssh_public_key = "ssh-rsa AAAAB3NzaC1yc2E... your@email.com"

# Optional (defaults shown)
environment        = "production"
location           = "fsn1"          # fsn1, nbg1, hel1, ash, hil
master_count       = 3               # Must be odd for HA
worker_count       = 3
master_server_type = "cx21"          # 2 vCPU / 4 GB
worker_server_type = "cpx31"         # 4 vCPU / 8 GB
k3s_version        = "v1.29.0+k3s1"
enable_monitoring  = false
```

### 3. Plan & Apply

```bash
# Review changes
terraform plan

# Apply configuration
terraform apply

# Type 'yes' to confirm
```

### 4. Get Kubeconfig

```bash
# Output will show command like:
scp -i ~/.ssh/id_rsa root@<MASTER_IP>:~/.kube/config ~/.kube/config-supercheck

# Set KUBECONFIG
export KUBECONFIG=~/.kube/config-supercheck

# Verify
kubectl get nodes
```

---

## Directory Structure

```
deploy/terraform/
├── main.tf              # Main configuration
├── variables.tf         # Input variables
├── outputs.tf           # Output values
├── versions.tf          # Provider versions
├── terraform.tfvars     # Your configuration (gitignored)
└── modules/
    ├── k3s-cluster/
    │   ├── main.tf
    │   ├── variables.tf
    │   ├── outputs.tf
    │   ├── cloud-init-master.sh
    │   └── cloud-init-worker.sh
    └── monitoring/
        ├── main.tf
        └── variables.tf
```

---

## Configuration Reference

### Input Variables

| Variable             | Description               | Default        | Required |
| -------------------- | ------------------------- | -------------- | -------- |
| `hcloud_token`       | Hetzner Cloud API token   | -              | ✅ Yes   |
| `ssh_public_key`     | SSH public key content    | -              | ✅ Yes   |
| `environment`        | Environment name          | `production`   | No       |
| `location`           | Hetzner datacenter        | `fsn1`         | No       |
| `master_count`       | Number of master nodes    | `3`            | No       |
| `worker_count`       | Number of worker nodes    | `3`            | No       |
| `master_server_type` | Master node size          | `cx21`         | No       |
| `worker_server_type` | Worker node size          | `cpx31`        | No       |
| `k3s_version`        | K3s version               | `v1.29.0+k3s1` | No       |
| `enable_monitoring`  | Deploy Prometheus/Grafana | `false`        | No       |
| `tags`               | Additional resource tags  | `{}`           | No       |

### Hetzner Locations

| Code   | Location    | Region  |
| ------ | ----------- | ------- |
| `fsn1` | Falkenstein | Germany |
| `nbg1` | Nuremberg   | Germany |
| `hel1` | Helsinki    | Finland |
| `ash`  | Ashburn     | US East |
| `hil`  | Hillsboro   | US West |

### Server Types

| Type    | vCPU | RAM   | Disk   | Use Case         |
| ------- | ---- | ----- | ------ | ---------------- |
| `cx21`  | 2    | 4 GB  | 40 GB  | Master nodes     |
| `cx31`  | 2    | 8 GB  | 80 GB  | Small workers    |
| `cpx31` | 4    | 8 GB  | 160 GB | Standard workers |
| `cpx41` | 8    | 16 GB | 240 GB | Large workers    |
| `cpx51` | 16   | 32 GB | 360 GB | Heavy workloads  |

---

## Outputs

After `terraform apply`, you'll see:

```hcl
Outputs:

master_ips = [
  "203.0.113.10",
  "203.0.113.11",
  "203.0.113.12"
]

worker_ips = [
  "203.0.113.20",
  "203.0.113.21",
  "203.0.113.22"
]

load_balancer_ip = "203.0.113.100"

kubeconfig_command = "scp -i ~/.ssh/id_rsa root@203.0.113.10:~/.kube/config ~/.kube/config-supercheck"
```

---

## Post-Deployment

### 1. Access Cluster

```bash
# Get kubeconfig
scp -i ~/.ssh/id_rsa root@<MASTER_IP>:~/.kube/config ~/.kube/config-supercheck
export KUBECONFIG=~/.kube/config-supercheck

# Verify nodes
kubectl get nodes
```

### 2. Label Nodes

```bash
# Label worker nodes for Supercheck
kubectl label nodes k3s-worker-0 workload=worker
kubectl label nodes k3s-worker-1 workload=worker
kubectl label nodes k3s-worker-2 workload=worker

# Optional: Label for regional deployment
kubectl label nodes k3s-worker-0 region=us-east
kubectl label nodes k3s-worker-1 region=eu-central
kubectl label nodes k3s-worker-2 region=asia-pacific
```

### 3. Install KEDA (Optional)

```bash
kubectl apply -f https://github.com/kedacore/keda/releases/download/v2.13.2/keda-2.13.2.yaml
```

### 4. Deploy Supercheck

```bash
cd deploy/k8s
kubectl apply -k .
```

---

## Scaling

### Vertical Scaling

Change server types in `terraform.tfvars`:

```hcl
# Upgrade workers to larger instances
worker_server_type = "cpx41"  # 8 vCPU / 16 GB
```

Apply changes:

```bash
terraform apply
```

> **Warning**: This will recreate nodes. Ensure proper pod disruption budgets.

### Horizontal Scaling

Add more worker nodes:

```hcl
worker_count = 6  # Increase from 3 to 6
```

Apply changes:

```bash
terraform apply
```

---

## Cost Estimation

### Minimum Production Setup

| Resource      | Type  | Count | Monthly Cost (EUR) |
| ------------- | ----- | ----- | ------------------ |
| Master Nodes  | cx21  | 3     | ~€18               |
| Worker Nodes  | cpx31 | 3     | ~€36               |
| Load Balancer | lb11  | 1     | ~€6                |
| **Total**     |       |       | **~€60/month**     |

### Recommended Setup

| Resource      | Type  | Count | Monthly Cost (EUR) |
| ------------- | ----- | ----- | ------------------ |
| Master Nodes  | cx21  | 3     | ~€18               |
| Worker Nodes  | cpx41 | 4     | ~€96               |
| Load Balancer | lb11  | 1     | ~€6                |
| **Total**     |       |       | **~€120/month**    |

> **Note**: Add costs for managed databases (PlanetScale, Redis Cloud) and storage (Cloudflare R2).

---

## Maintenance

### Update K3s Version

```hcl
k3s_version = "v1.30.0+k3s1"
```

```bash
terraform apply
```

### Rotate Nodes

Force node replacement:

```bash
terraform taint module.k3s_cluster.hcloud_server.worker[0]
terraform apply
```

### Destroy Infrastructure

```bash
# Destroy everything
terraform destroy

# Type 'yes' to confirm
```

---

## Security

### Firewall Rules

The Terraform creates firewall rules that:

- Allow SSH (22) from anywhere (restrict in production)
- Allow Kubernetes API (6443) from anywhere
- Allow HTTP (80) and HTTPS (443)
- Allow internal cluster communication

### Recommendations

1. **Restrict SSH access** to your IP addresses
2. **Use bastion host** for production access
3. **Enable audit logging** in K3s
4. **Rotate API tokens** regularly

---

## Troubleshooting

### SSH Connection Issues

```bash
# Check server status
hcloud server list

# Test SSH
ssh -v root@<SERVER_IP>
```

### K3s Not Starting

```bash
# SSH to master
ssh root@<MASTER_IP>

# Check K3s service
systemctl status k3s

# View logs
journalctl -u k3s -f
```

### Node Not Joining

```bash
# Check worker logs
ssh root@<WORKER_IP>
journalctl -u k3s-agent -f

# Verify network connectivity
ping <MASTER_PRIVATE_IP>
```

### Terraform State Issues

```bash
# Refresh state
terraform refresh

# Import existing resource
terraform import hcloud_server.worker[0] <SERVER_ID>
```

---

## Alternatives

For production deployments, consider these managed alternatives:

| Provider         | Service    | Pros                         | Cons             |
| ---------------- | ---------- | ---------------------------- | ---------------- |
| **AWS**          | EKS        | Mature, well-integrated      | Higher cost      |
| **GCP**          | GKE        | Excellent Kubernetes support | Learning curve   |
| **Azure**        | AKS        | Enterprise features          | Complexity       |
| **DigitalOcean** | DOKS       | Simple, affordable           | Limited features |
| **Hetzner**      | K3s (this) | Very affordable              | Self-managed     |

---

## Related Documentation

- [Kubernetes Guide](./KUBERNETES_GUIDE.md) - Deploy Supercheck to cluster
- [Environment Variables](../08-operations/ENVIRONMENT_VARIABLES.md) - Configuration reference
- [Scaling Guide](./SCALING_GUIDE.md) - Scaling strategies
