# Supercheck Deployment

Self-host Supercheck on your own infrastructure.

## Quick Deploy

[![Deploy on Coolify](https://img.shields.io/badge/Deploy%20on-Coolify-6B16ED?style=for-the-badge&logo=coolify&logoColor=white)](./coolify/README.md)

One-click deployment on [Coolify](https://coolify.io) — the easiest way to self-host.

## Docker Compose

For manual deployment with Docker Compose:

```bash
git clone https://github.com/supercheck-io/supercheck.git
cd supercheck/deploy/docker

# Generate secure secrets
bash init-secrets.sh

# Start services
docker compose up -d
```

See [docker/README.md](docker/README.md) for detailed configuration options.

## Platform Guides

| Platform | Guide |
|----------|-------|
| **Coolify** | [Deploy on Coolify](coolify/README.md) |
| **Dokploy** | [Deploy on Dokploy](dokploy/README.md) |

## Documentation

Full documentation: **[supercheck.io/docs/deployment](https://supercheck.io/docs/deployment)**
