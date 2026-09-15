# Supercheck Deployment

Self-host Supercheck on your own infrastructure.

> **Linux Required:** Supercheck uses K3s and gVisor for sandboxed test execution, which require the Linux kernel. Only Linux servers (Ubuntu 22.04+, Debian 12+) are supported. macOS, Windows, and WSL2 are not supported.

## Docker Compose

Deploy with Docker Compose:

```bash
git clone https://github.com/supercheck-io/supercheck.git
cd supercheck/deploy/docker

# Generate secrets and set up the execution sandbox
./init-secrets.sh
sudo bash setup-k3s.sh

# Start services
KUBECONFIG_FILE=/etc/rancher/k3s/supercheck-worker.kubeconfig docker compose up -d

# HTTPS
KUBECONFIG_FILE=/etc/rancher/k3s/supercheck-worker.kubeconfig docker compose -f docker-compose-secure.yml up -d
```

If you use browser-based integrations such as Azure DevOps dashboard widgets or Grafana panels, set `CORS_ALLOWED_ORIGINS` on the App deployment, for example `https://dev.azure.com,https://*.visualstudio.com`. Leave it empty if you do not need browser-side API access.

See [docker/README.md](docker/README.md) for detailed configuration options, including multi-region workers, external managed services, the outbound-only private agent, and the optional AI SRE integration lab.

## Documentation

Full documentation: **[supercheck.io/docs/app/deployment](https://supercheck.io/docs/app/deployment)**
