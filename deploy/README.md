# Supercheck Deployment

Self-host Supercheck on a Linux server (Ubuntu 22.04+ or Debian 12+). macOS, Windows, WSL2 and Docker Desktop are not supported: the test sandbox needs the Linux kernel.

**Start here:** [Self-Hosted guide](https://supercheck.io/docs/app/deployment/self-hosted). It covers the one-command installer, upgrades, backups and restore, status-page HTTPS and troubleshooting.

```bash
curl -fsSL https://raw.githubusercontent.com/supercheck-io/supercheck/v1.4.0/deploy/docker/install.sh -o install.sh
sudo bash install.sh --version 1.4.0
```

## In this directory

| Path | Purpose |
|------|---------|
| [docker/INSTALL.md](docker/INSTALL.md) | Advanced manual install, step by step, for hosts where the installer does not fit |
| [docker/README.md](docker/README.md) | Compose files and environment variable reference |
| `docker/install.sh` | Installer and upgrader (`--help` lists every option) |
| `docker/backup.sh` | Backup and restore of the bundled database, storage and `.env` |
| [docker/aisre-lab](docker/aisre-lab/README.md) | Optional AI SRE integration lab for connector development |

More: [Multi-Server](https://supercheck.io/docs/app/deployment/multi-server) workers and the [Private Agent](https://supercheck.io/docs/app/deployment/private-agent).
