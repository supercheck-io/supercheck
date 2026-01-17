# Supercheck Deployment

This folder contains deployment configurations for self-hosting SuperCheck.

## Docker Compose (Self-Hosted)

The `docker/` folder contains Docker Compose configurations for running SuperCheck:

| File | Purpose |
|------|---------|
| `docker-compose.yml` | Main development setup with all services |
| `docker-compose-local.yml` | Local development with hot-reload |
| `docker-compose-external.yml` | Use external managed services (PostgreSQL, Redis, S3) |
| `docker-compose-secure.yml` | Production deployment with Traefik SSL |

## Platform Guides

Specific guides for deployment platforms:

| Platform | Guide |
|----------|-------|
| **Coolify** | [Deploy on Coolify](coolify/README.md) |
| **Dokploy** | [Deploy on Dokploy](dokploy/README.md) |

## Quick Start

```bash
# Clone the repository
git clone https://github.com/supercheck-io/supercheck.git
cd supercheck

# Copy environment file
cp .env.example .env

# Start all services
docker compose -f deploy/docker/docker-compose.yml up -d
```

> [!NOTE]
> **Modern Docker Compose required.** Use `docker compose` (not `docker-compose`). See the [docker/README.md](docker/README.md) for troubleshooting.
>
> The default configuration sets `SELF_HOSTED=true`, which enables unlimited features. If you are deploying manually or running locally without Docker Compose, ensure you set `SELF_HOSTED=true` in your environment variables.

## Documentation

Full deployment documentation is available at **[supercheck.io/docs/deployment](https://supercheck.io/docs/deployment)**

