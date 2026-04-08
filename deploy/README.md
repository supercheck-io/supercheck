# Supercheck Deployment

Self-host Supercheck on your own infrastructure.

> **Linux Required:** Supercheck uses K3s and gVisor for sandboxed test execution, which require the Linux kernel. Only Linux servers (Ubuntu 22.04+, Debian 12+) are supported. macOS, Windows, and WSL2 are not supported.

## Quick Deploy

[![Deploy on Coolify](https://img.shields.io/badge/Deploy%20on-Coolify-6B16ED?style=for-the-badge&logo=coolify&logoColor=white)](./coolify/README.md)

Coolify template deployment on [Coolify](https://coolify.io).

## Docker Compose

For manual deployment with Docker Compose:

```bash
git clone https://github.com/supercheck-io/supercheck.git
cd supercheck/deploy/docker

# Generate secrets and set up the execution sandbox
sudo bash init-secrets.sh
sudo bash setup-k3s.sh

# Start services
KUBECONFIG_FILE=/etc/rancher/k3s/supercheck-worker.kubeconfig docker compose up -d
```

If you use browser-based integrations such as Azure DevOps dashboard widgets or Grafana panels, set `CORS_ALLOWED_ORIGINS` on the App deployment, for example `https://dev.azure.com,https://*.visualstudio.com`. Leave it empty if you do not need browser-side API access.

See [docker/README.md](docker/README.md) for detailed configuration options.

## Platform Guides

| Platform | Guide |
|----------|-------|
| **Coolify** | [Deploy on Coolify](coolify/README.md) |

## Documentation

Full documentation: **[supercheck.io/docs/app/deployment](https://supercheck.io/docs/app/deployment)**
