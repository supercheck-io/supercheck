# Terraform Infrastructure Guide

> **Version**: 2.0.0  
> **Last Updated**: 2025-12-09  
> **Status**: Production Ready

## Overview

Terraform configuration for provisioning Supercheck infrastructure on **Hetzner Cloud** with multi-region vSwitch networking.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                     HETZNER VSWITCH NETWORK (10.0.0.0/8)                         │
│                                                                                  │
│  EU-Central (fsn1)              US-East (ash)          Singapore (sin)          │
│  10.0.1.0/24                    10.0.2.0/24            10.0.3.0/24              │
│  ┌─────────────────┐           ┌─────────────┐        ┌─────────────┐          │
│  │ Master 10.0.1.10│           │ Worker      │        │ Worker      │          │
│  │ App    10.0.1.20│←─vSwitch─→│ 10.0.2.100  │←──────→│ 10.0.3.100  │          │
│  │ Worker 10.0.1.100│          └─────────────┘        └─────────────┘          │
│  └─────────────────┘                                                            │
│                                                                                  │
│  Firewall: SSH (22), K8s API (6443), HTTP (80), HTTPS (443)                    │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## Prerequisites

1. **Terraform**: v1.0+ ([Install Guide](https://developer.hashicorp.com/terraform/downloads))
2. **Hetzner Cloud Account**: [Sign up](https://console.hetzner.cloud/)
3. **API Token**: Create in Hetzner Cloud Console → Security → API Tokens
4. **SSH Key**: Public key for node access

---

## Quick Start

```bash
cd deploy/terraform/hetzner

# Configure
cp terraform.tfvars.example terraform.tfvars
vim terraform.tfvars  # Add Hetzner token and SSH key

# Deploy
terraform init
terraform apply

# Get kubeconfig
$(terraform output -raw kubeconfig_command)

# Label nodes
terraform output -raw node_label_commands | bash

# Deploy Supercheck
kubectl apply -k ../../k8s/
```

---

## Directory Structure

```
deploy/terraform/
├── .gitignore
└── hetzner/
    ├── main.tf              # Provider, vSwitch, firewalls
    ├── variables.tf         # Input variables
    ├── master.tf            # K3s server + cloud-init
    ├── workers.tf           # Regional workers with Docker
    ├── outputs.tf           # IPs, SSH commands
    ├── terraform.tfvars.example
    └── README.md
```

---

## Configuration Reference

### Input Variables

| Variable | Description | Default | Required |
|----------|-------------|---------|----------|
| `hcloud_token` | Hetzner Cloud API token | - | ✅ Yes |
| `ssh_public_key` | SSH public key content | - | ✅ Yes |
| `cluster_name` | Name prefix for resources | `supercheck` | No |
| `server_type` | Server size for all nodes | `cx22` | No |
| `master_count` | Number of master nodes | `1` | No |
| `app_node_count` | Number of app nodes | `1` | No |
| `worker_count_eu` | Workers in EU | `1` | No |
| `worker_count_us` | Workers in US | `1` | No |
| `worker_count_apac` | Workers in APAC | `1` | No |

### Hetzner Locations

| Code | Location | Region |
|------|----------|--------|
| `fsn1` | Falkenstein | Germany |
| `nbg1` | Nuremberg | Germany |
| `ash` | Ashburn | US East |
| `sin` | Singapore | Asia Pacific |

### Server Types

| Type | vCPU | RAM | Monthly | Use Case |
|------|------|-----|---------|----------|
| `cx22` | 2 | 4 GB | ~€4.50 | Default (all nodes) |
| `cx32` | 4 | 8 GB | ~€9 | Larger workers |
| `cx42` | 8 | 16 GB | ~€18 | Heavy workloads |

---

## Cost Estimation

### Starter Setup (5 nodes)

| Resource | Type | Count | Monthly (EUR) |
|----------|------|-------|---------------|
| Master | cx22 | 1 | €4.50 |
| App | cx22 | 1 | €4.50 |
| Workers | cx22 | 3 | €13.50 |
| vSwitch | - | 1 | Free |
| **Total** | | | **~€25/month** |

---

## Scaling

### Add More Workers

```bash
# Increase workers per region
terraform apply -var="worker_count_eu=3" -var="worker_count_us=2"
```

### Enable HA Masters

```bash
terraform apply -var="master_count=3"
```

### Upgrade Server Size

```hcl
# In terraform.tfvars
server_type = "cx32"  # 4 vCPU / 8 GB
```

---

## Outputs

After `terraform apply`:

```hcl
master_public_ip    = "203.0.113.10"
master_private_ip   = "10.0.1.10"
worker_eu_public_ips = ["203.0.113.100"]
worker_us_public_ips = ["203.0.113.101"]
worker_apac_public_ips = ["203.0.113.102"]

ssh_master = "ssh root@203.0.113.10"
kubeconfig_command = "ssh root@... 'cat /etc/rancher/k3s/k3s.yaml' | sed ... > ~/.kube/supercheck-config"
node_label_commands = "kubectl label nodes ..."
```

---

## Cleanup

```bash
terraform destroy
```

---

## Related Documentation

- [K3S_SCALING_GUIDE.md](./K3S_SCALING_GUIDE.md) - Scaling strategies
- [KUBERNETES_GUIDE.md](./KUBERNETES_GUIDE.md) - K8s deployment
- [VPS_SETUP_GUIDE.md](./VPS_SETUP_GUIDE.md) - Manual node setup
