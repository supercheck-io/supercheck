# Deployment & Setup Documentation

This section covers deployment strategies, configuration, and setup instructions for SuperCheck.

## Deployment Options

| Method                           | Use Case                   | Infrastructure         | Complexity  |
| -------------------------------- | -------------------------- | ---------------------- | ----------- |
| **Docker Compose (Local)**       | Local development          | All services in Docker | Low         |
| **Docker Compose (Self-Hosted)** | Self-hosted production     | Single server/VPS      | Medium      |
| **Kubernetes**                   | Managed cloud deployment   | EKS, GKE, AKS, etc.    | Medium-High |
| **Terraform + K3s**              | Cost-optimized self-hosted | Hetzner Cloud          | High        |

## Recommended Stack

For production deployments, we recommend:

| Component    | Self-Hosted      | Cloud                 |
| ------------ | ---------------- | --------------------- |
| **Compute**  | Docker Compose   | Managed Kubernetes    |
| **Database** | Local PostgreSQL | PlanetScale (managed) |
| **Cache**    | Local Redis      | Redis Cloud (managed) |
| **Storage**  | Local MinIO      | Cloudflare R2         |

## Files

### Core Guides

- **[DOCKER_COMPOSE_GUIDE.md](DOCKER_COMPOSE_GUIDE.md)** - Docker Compose deployment for self-hosted and local development
- **[KUBERNETES_GUIDE.md](KUBERNETES_GUIDE.md)** - Kubernetes deployment for managed cloud services
- **[TERRAFORM_GUIDE.md](TERRAFORM_GUIDE.md)** - Infrastructure provisioning on Hetzner Cloud

### Configuration

- **[LOCAL.md](LOCAL.md)** - Local development environment setup
- **[SCALING_GUIDE.md](SCALING_GUIDE.md)** - Scaling strategies for Docker Compose and Kubernetes

### Infrastructure Setup

- **[VPS_SETUP_GUIDE.md](VPS_SETUP_GUIDE.md)** - Production-ready VPS setup with security hardening
- **[NODE_SETUP.md](NODE_SETUP.md)** - Kubernetes node labeling and configuration

### Reference

- **[DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md)** - Legacy comprehensive deployment guide

## Quick Start

### Local Development

```bash
# Start all services
docker-compose -f deploy/docker/docker-compose-local.yml up -d

# Access the app
open http://localhost:3000
```

### Self-Hosted Production

```bash
# Configure environment
cp deploy/docker/.env.example deploy/docker/.env
# Edit .env with your settings

# Deploy with external services
docker-compose -f deploy/docker/docker-compose-external.yml up -d
```

### Kubernetes (Managed)

```bash
# Configure secrets and settings
cd deploy/k8s
# Edit configmap.yaml and secret.yaml

# Deploy
kubectl apply -k .
```

## Environment Variables

See **[Environment Variables Specification](../08-operations/ENVIRONMENT_VARIABLES.md)** for a complete reference of all configuration options.

## Deploy Directory Structure

```
deploy/
├── docker/
│   ├── docker-compose.yml          # Production (all-in-one)
│   ├── docker-compose-local.yml    # Local development
│   ├── docker-compose-secure.yml   # Production + Traefik HTTPS
│   ├── docker-compose-external.yml # External services + Traefik
│   └── scripts/
│       └── setup-ngrok.sh          # ngrok tunnel setup
├── k8s/
│   ├── kustomization.yaml          # Kustomize config
│   ├── namespace.yaml              # Namespace definition
│   ├── configmap.yaml              # Configuration
│   ├── secret.yaml                 # Secrets template
│   ├── app-deployment.yaml         # App deployment
│   ├── worker-deployment.yaml      # Worker deployment
│   ├── ingress.yaml                # Ingress rules
│   └── keda-scaledobject.yaml      # KEDA autoscaling
└── terraform/
    ├── main.tf                     # Main configuration
    ├── variables.tf                # Input variables
    ├── outputs.tf                  # Output values
    └── modules/
        ├── k3s-cluster/            # K3s cluster module
        └── monitoring/             # Prometheus/Grafana
```

## External Services (Recommended)

For production, use managed services to reduce operational overhead:

| Service        | Provider                                        | Benefits                                      |
| -------------- | ----------------------------------------------- | --------------------------------------------- |
| **PostgreSQL** | [PlanetScale](https://planetscale.com/postgres) | Built-in PgBouncer, automated backups, PITR   |
| **Redis**      | [Redis Cloud](https://redis.com/cloud/)         | Managed HA, automatic failover                |
| **Storage**    | [Cloudflare R2](https://cloudflare.com/r2/)     | S3-compatible, zero egress fees, built-in CDN |

## Quick Links

- [Back to Specs](../README.md)
- [Environment Variables](../08-operations/ENVIRONMENT_VARIABLES.md)
- [Operations & Optimization](../08-operations)
- [Architecture Overview](../01-core/SUPERCHECK_ARCHITECTURE.md)
