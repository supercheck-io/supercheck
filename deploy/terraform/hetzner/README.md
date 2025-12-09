# Hetzner Terraform Deployment

Provisions a multi-region K3s cluster on Hetzner Cloud with vSwitch networking.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                     HETZNER VSWITCH NETWORK (10.0.0.0/8)                         │
│                                                                                  │
│  EU-Central (fsn1)              US-East (ash)          Singapore (sin)          │
│  10.0.1.0/24                    10.0.2.0/24            10.0.3.0/24              │
│  ┌─────────────────┐           ┌─────────────┐        ┌─────────────┐          │
│  │ Master          │           │ Worker      │        │ Worker      │          │
│  │ 10.0.1.10       │←─vSwitch─→│ 10.0.2.100  │←──────→│ 10.0.3.100  │          │
│  ├─────────────────┤           └─────────────┘        └─────────────┘          │
│  │ App 10.0.1.20   │                                                            │
│  ├─────────────────┤                                                            │
│  │ Worker 10.0.1.100│                                                           │
│  └─────────────────┘                                                            │
└─────────────────────────────────────────────────────────────────────────────────┘
```

## Prerequisites

- [Terraform](https://www.terraform.io/downloads) >= 1.0
- [Hetzner Cloud Account](https://console.hetzner.cloud/)
- API Token from Hetzner Cloud Console

## Quick Start

```bash
# 1. Copy and edit variables
cp terraform.tfvars.example terraform.tfvars
vim terraform.tfvars

# 2. Initialize Terraform
terraform init

# 3. Preview changes
terraform plan

# 4. Apply (creates all resources)
terraform apply

# 5. Get kubeconfig
$(terraform output -raw kubeconfig_command)
export KUBECONFIG=~/.kube/supercheck-config

# 6. Wait for nodes and label them
kubectl get nodes -w
# Once all nodes are Ready, run:
terraform output -raw node_label_commands | bash

# 7. Deploy Supercheck
kubectl apply -k ../../k8s/
```

## Files

| File | Purpose |
|------|---------|
| `main.tf` | Provider, vSwitch network, firewalls, SSH key |
| `variables.tf` | Input variables with defaults |
| `master.tf` | K3s server with cloud-init (installs Ingress, KEDA) |
| `workers.tf` | Regional workers with Docker |
| `outputs.tf` | IPs, SSH commands, labeling commands |
| `terraform.tfvars.example` | Example configuration |

## Node Joining

Workers auto-join the cluster via cloud-init. If a worker fails to join:

```bash
# SSH to the worker
ssh root@<worker-ip>

# Check cloud-init logs
cat /var/log/cloud-init-output.log

# Get token from master
TOKEN=$(ssh root@<master-ip> 'cat /var/lib/rancher/k3s/server/node-token')

# Manually join
curl -sfL https://get.k3s.io | K3S_URL="https://<master-private-ip>:6443" \
  K3S_TOKEN="$TOKEN" sh -s - agent --docker
```

## Scaling

```bash
# Add more workers
terraform apply -var="worker_count_eu=3" -var="worker_count_us=2"

# Enable HA masters
terraform apply -var="master_count=3"
```

## Cleanup

```bash
terraform destroy
```
