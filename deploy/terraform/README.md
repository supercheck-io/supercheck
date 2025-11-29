# Supercheck Infrastructure on Hetzner Cloud

This directory contains Terraform configuration to deploy the Supercheck infrastructure on Hetzner Cloud.

## Architecture

The infrastructure consists of:
- **Single HA K3s Cluster**: Deployed in a single region (default: `fsn1`).
- **High Availability**: 3 Master nodes with embedded etcd.
- **Load Balancer**: Fronts the Kubernetes API server.
- **Compute**: Hetzner Cloud servers for Master (e.g., 2 vCPU / 4 GB) and Worker (e.g., 4 vCPU / 8 GB) nodes.
- **Node Affinity**: Nodes are labeled `workload=app` or `workload=worker` for proper scheduling.
- **Autoscaling**: KEDA installed for event-driven autoscaling.

## Prerequisites

1.  **Terraform**: [Install Terraform](https://developer.hashicorp.com/terraform/downloads) (v1.0+)
2.  **Hetzner Cloud Token**: Create an API token in the [Hetzner Cloud Console](https://console.hetzner.cloud/).
3.  **SSH Key**: Ensure you have an SSH public key (e.g., `~/.ssh/id_rsa.pub`).

## Quick Start

### 1. Initialize

Navigate to this directory and initialize Terraform:

```bash
cd deploy/terraform
terraform init
```

### 2. Configure Variables

Create a `terraform.tfvars` file (this file is gitignored, do not commit it):

```hcl
hcloud_token       = "your-hetzner-api-token"
ssh_public_key     = "ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQ... your@email.com"
environment        = "production"
location           = "fsn1" # Optional: fsn1, nbg1, hel1, ash, hil
master_count       = 3      # Must be odd for HA
worker_count       = 3
master_server_type = "cx21"  # Check availability in your location
worker_server_type = "cpx31" # Check availability in your location
```

> **Note:** Server availability varies by location. Use the Hetzner CLI to list available types in your desired location:
> ```bash
> hcloud server-type list
> ```


### 3. Plan and Apply

Review the changes:

```bash
terraform plan
```

Apply the configuration:

```bash
terraform apply
```

Type `yes` to confirm.

### 4. Access Cluster

After deployment, Terraform will output commands to retrieve the kubeconfig.

```bash
# Example output command
scp -i ~/.ssh/id_rsa root@<MASTER_IP>:~/.kube/config ~/.kube/config-supercheck
export KUBECONFIG=~/.kube/config-supercheck
```

Verify access:

```bash
kubectl get nodes
```

## Modules

- **k3s-cluster**: Provisions the servers, network, firewall, load balancer, and installs K3s in HA mode.
- **monitoring**: (Optional) Deploys Prometheus/Grafana.

## Security

- **Firewalls**: Restricted to necessary ports (22, 6443, 80, 443).
- **Private Networks**: Nodes communicate over private IPs.
- **Secrets**: Sensitive variables are marked as sensitive in Terraform.

## Scaling

- **Vertical**: Change `master_server_type` or `worker_server_type` in variables.
- **Horizontal**: Change `worker_count` in variables.
- **Autoscaling**: KEDA is installed by default to support application-level autoscaling.
