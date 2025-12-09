# Deployment & Setup Documentation

This section covers deployment strategies, configuration, and setup instructions for Supercheck.

## Deployment Options

| Method | Use Case | Infrastructure | Complexity |
|--------|----------|----------------|------------|
| **Docker Compose** | Local dev / Self-hosted | Single server/VPS | Low |
| **Terraform + K3s** | Multi-region production | Hetzner Cloud | Medium |
| **Kubernetes** | Managed cloud | EKS, GKE, AKS | Medium-High |

## Recommended Stack

### Self-Hosted (Hetzner)

| Component | Service | Cost |
|-----------|---------|------|
| **Compute** | K3s on Hetzner (5× CX22) | ~€25/mo |
| **Database** | Neon / PlanetScale | Free-$20/mo |
| **Cache** | Upstash Redis | Free-$10/mo |
| **Storage** | Cloudflare R2 | ~$0 (generous free tier) |
| **Total** | | **~€30-60/mo** |

### Cloud Managed

| Component | Service |
|-----------|---------|
| **Compute** | EKS / GKE / AKS |
| **Database** | RDS / Cloud SQL |
| **Cache** | ElastiCache / Memorystore |
| **Storage** | S3 / GCS |

---

## Files

### Core Guides

- **[DOCKER_COMPOSE_GUIDE.md](DOCKER_COMPOSE_GUIDE.md)** - Docker Compose for self-hosted and local dev
- **[K3S_SCALING_GUIDE.md](K3S_SCALING_GUIDE.md)** - K3s multi-region setup on Hetzner
- **[KUBERNETES_GUIDE.md](KUBERNETES_GUIDE.md)** - Managed Kubernetes deployment
- **[TERRAFORM_GUIDE.md](TERRAFORM_GUIDE.md)** - Hetzner infrastructure provisioning

### Infrastructure Setup

- **[VPS_SETUP_GUIDE.md](VPS_SETUP_GUIDE.md)** - Manual VPS setup with security hardening
- **[NODE_SETUP.md](NODE_SETUP.md)** - K8s node labeling and configuration

### Configuration

- **[LOCAL.md](LOCAL.md)** - Local development environment
- **[SCALING_GUIDE.md](SCALING_GUIDE.md)** - Scaling strategies

---

## Quick Start

### Option A: Terraform (Recommended for Production)

```bash
cd deploy/terraform/hetzner
cp terraform.tfvars.example terraform.tfvars
# Edit terraform.tfvars with Hetzner token + SSH key

terraform init && terraform apply
$(terraform output -raw kubeconfig_command)
kubectl apply -k ../../k8s/
```

### Option B: Docker Compose (Local/Single Server)

```bash
cd deploy/docker
cp .env.example .env
# Edit .env with your settings

docker-compose up -d
open http://localhost:3000
```

### Option C: Managed Kubernetes

```bash
cd deploy/k8s
# Edit configmap.yaml and secret.yaml
kubectl apply -k .
```

---

## Deploy Directory Structure

```
deploy/
├── docker/
│   ├── docker-compose.yml          # Production (all-in-one)
│   ├── docker-compose-local.yml    # Local development
│   ├── docker-compose-secure.yml   # With Traefik HTTPS
│   └── docker-compose-external.yml # External services
│
├── k8s/
│   ├── kustomization.yaml
│   ├── app-deployment.yaml
│   ├── worker-deployment.yaml
│   ├── keda-scaledobject.yaml
│   ├── scripts/
│   │   ├── setup-vps.sh
│   │   ├── setup-master.sh
│   │   ├── setup-worker.sh
│   │   └── setup-app-node.sh
│   └── ...
│
└── terraform/
    └── hetzner/
        ├── main.tf            # vSwitch, firewalls
        ├── variables.tf       # Input variables
        ├── master.tf          # K3s server
        ├── workers.tf         # Regional workers
        ├── outputs.tf         # IPs, commands
        └── terraform.tfvars.example
```

---

## External Services

| Service | Recommended Provider | Notes |
|---------|---------------------|-------|
| **PostgreSQL** | [Neon](https://neon.tech) | Free tier, autoscaling |
| **Redis** | [Upstash](https://upstash.com) | Serverless, pay-per-request |
| **Storage** | [Cloudflare R2](https://cloudflare.com/r2/) | S3-compatible, zero egress |

---

## Quick Links

- [Back to Specs](../README.md)
- [Environment Variables](../08-operations/ENVIRONMENT_VARIABLES.md)
- [Architecture Overview](../01-core/SUPERCHECK_ARCHITECTURE.md)
