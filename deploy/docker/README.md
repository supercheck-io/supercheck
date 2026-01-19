# Docker Compose Configurations

Production-ready Docker Compose files for self-hosting Supercheck.

## Quick Start

```bash
git clone https://github.com/supercheck-io/supercheck.git
cd supercheck/deploy/docker

# Generate secure secrets
bash init-secrets.sh

# Edit .env with your OAuth credentials
nano .env

# Start (local testing)
docker compose up -d

# Or start (production with HTTPS)
docker compose -f docker-compose-secure.yml up -d
```

## Prerequisites

> **Modern Docker Compose Required**: Use `docker compose` (with space), not `docker-compose` (with hyphen).

```bash
docker compose version
# Should show: Docker Compose version v2.x.x or higher
```

**Install Docker:**
- **Mac/Windows**: [Docker Desktop](https://www.docker.com/products/docker-desktop/)
- **Linux**: `curl -fsSL https://get.docker.com | sh`

---

## Available Configurations

| File | Use Case |
|------|----------|
| `docker-compose.yml` | Local testing (HTTP, localhost:3000) |
| `docker-compose-secure.yml` | Production (HTTPS with Let's Encrypt) |
| `docker-compose-worker.yml` | Remote workers for multi-location |

---

## Environment Variables

Use `./init-secrets.sh` to generate secure defaults, then configure:

### Required

| Variable | Description |
|----------|-------------|
| `GITHUB_CLIENT_ID` | GitHub OAuth client ID |
| `GITHUB_CLIENT_SECRET` | GitHub OAuth client secret |

### Production (docker-compose-secure.yml)

| Variable | Description |
|----------|-------------|
| `APP_DOMAIN` | Your domain (e.g., `app.yourdomain.com`) |
| `ACME_EMAIL` | Email for Let's Encrypt |
| `STATUS_PAGE_DOMAIN` | Base domain for status pages |

### Optional

| Variable | Description | Default |
|----------|-------------|---------|
| `SMTP_HOST`, `SMTP_USER`, `SMTP_PASSWORD` | Email notifications | - |
| `OPENAI_API_KEY` | AI features | - |
| `WORKER_REPLICAS` | Number of workers | `1` |

---

## Scaling Workers

```bash
# Scale to 2 workers
WORKER_REPLICAS=2 docker compose up -d
```

---

## Backups

```bash
# Create backup
docker compose exec postgres pg_dump -U postgres supercheck > backup.sql

# Restore backup
docker compose exec -T postgres psql -U postgres supercheck < backup.sql
```

---

## Documentation

Full documentation: **[supercheck.io/docs/deployment](https://supercheck.io/docs/deployment)**
