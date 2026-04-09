---
name: docker-compose-deployment
description: "Use when: deploying SuperCheck with Docker Compose, configuring self-hosted deployment, troubleshooting Docker services, scaling workers, setting up HTTPS/TLS, managing environment variables, upgrading versions, or working with any file in deploy/docker/. Covers all Docker Compose variants (standard, secure, external, remote worker, local dev), K3s/gVisor sandbox setup, security hardening, and operational runbooks."
---

# SuperCheck Docker Compose Deployment

## Deployment Variants

SuperCheck ships **five** Docker Compose files in `deploy/docker/`:

| File | Use Case | Services Included |
|------|----------|-------------------|
| `docker-compose.yml` | **Self-hosted base** — complete stack, single server | App, Worker, Postgres 18, Redis 8, MinIO |
| `docker-compose-secure.yml` | **Production HTTPS** — Traefik + Let's Encrypt TLS (2 app replicas) | Same as base + Traefik v3 |
| `docker-compose-external.yml` | **Managed services** — external DB/Redis/S3 | Traefik + App + Worker |
| `docker-compose-worker.yml` | **Remote regional worker** — multi-location | Worker only |
| `docker-compose-local.yml` | **Local development** — builds from source | Full stack (source build) |

### Decision Guide

- **Single server, no TLS** → `docker-compose.yml`
- **Single server, HTTPS** → `docker-compose-secure.yml` (requires DNS + port 80)
- **Using Neon/Supabase/RDS + managed Redis/S3** → `docker-compose-external.yml`
- **Add workers in other regions** → `docker-compose-worker.yml` per remote server
- **Local dev iteration** → `docker-compose-local.yml`

## Prerequisites

1. **Linux host** (Ubuntu 22.04+, Debian 12+) — amd64 or arm64
2. **Docker Engine 24+** with Compose V2
3. **K3s + gVisor** for test execution sandbox:
   ```bash
   cd deploy/docker && sudo bash setup-k3s.sh
   ```
4. **Secrets** — generate `.env`:
   ```bash
   sudo bash init-secrets.sh
   ```

## Version Management

All compose files use `SUPERCHECK_VERSION` with a fallback default:

```yaml
image: ghcr.io/supercheck-io/supercheck/app:${SUPERCHECK_VERSION:-1.3.3}
image: ghcr.io/supercheck-io/supercheck/worker:${SUPERCHECK_VERSION:-1.3.3}
```

### Upgrading

```bash
SUPERCHECK_VERSION=1.4.0 docker compose up -d
# Or persist: echo 'SUPERCHECK_VERSION=1.4.0' >> .env
```

### Version Bump Checklist

When releasing a new version, update these files:

**supercheck repo:**
- `app/package.json`, `worker/package.json` — `"version"` field
- `app/package-lock.json`, `worker/package-lock.json` — root version entries (lines 3, 9)
- `app/src/components/app-sidebar.tsx` — `badge:` value
- `deploy/docker/docker-compose.yml` — 3 image refs
- `deploy/docker/docker-compose-worker.yml` — 2 image refs
- `deploy/docker/docker-compose-secure.yml` — 3 image refs
- `deploy/docker/docker-compose-external.yml` — 3 image refs
- `CHANGELOG.md` — release header

**Do NOT change:** `docker-compose-local.yml` (builds from source), `coolify/supercheck.yaml` (defaults to `latest` via `${SUPERCHECK_VERSION:-latest}`), `docs/package.json` (separate versioning)

## Environment Variables

### Core — Required for All Deployments

| Variable | Default | Description |
|----------|---------|-------------|
| `SELF_HOSTED` | `true` | Enables unlimited features without billing |
| `KUBECONFIG_FILE` | `/etc/rancher/k3s/supercheck-worker.kubeconfig` | K3s kubeconfig for worker |
| `DATABASE_URL` | `postgresql://postgres:postgres@postgres:5432/supercheck` | PostgreSQL connection |
| `BETTER_AUTH_SECRET` | *(generated)* | 16-byte hex auth secret (32 hex digits) |
| `SECRET_ENCRYPTION_KEY` | *(generated)* | 16-byte hex encryption key (32 hex digits) |
| `NEXT_PUBLIC_APP_URL` | `http://localhost:3000` | Browser-facing app URL |

### Redis

**App** uses `REDIS_URL=redis://:password@redis:6379`

**Remote worker** (`docker-compose-worker.yml`) uses individual vars — NOT `REDIS_URL`:
```
REDIS_HOST=main-server.com
REDIS_PORT=6379
REDIS_PASSWORD=password
```

### HTTPS (docker-compose-secure.yml)

| Variable | Description |
|----------|-------------|
| `APP_DOMAIN` | Your domain (e.g., `app.yourdomain.com`) |
| `ACME_EMAIL` | Email for Let's Encrypt notifications |

**Cloudflare users:** SSL/TLS mode must be "Full (Strict)" to avoid redirect loops.

### Capacity & Scaling

| Variable | Default | Description |
|----------|---------|-------------|
| `RUNNING_CAPACITY` | `1` | Max concurrent runs (**App-side gate**, not worker setting) |
| `QUEUED_CAPACITY` | `10` | Max queued runs before rejection |
| `WORKER_REPLICAS` | `1` | Worker container replicas |
| `WORKER_LOCATION` | `local` | Queue region code (`local` = all queues) |

**Rule:** `RUNNING_CAPACITY` = total `WORKER_REPLICAS` across all locations. Each worker replica handles exactly 1 concurrent execution.

### Execution

| Variable | Default | Description |
|----------|---------|-------------|
| `CONTAINER_CPU_LIMIT` | `1.5` | CPU for gVisor execution pods |
| `CONTAINER_MEMORY_LIMIT_MB` | `2048` | Memory for execution pods |
| `TEST_EXECUTION_TIMEOUT_MS` | `300000` | 5 min per-test timeout |
| `PLAYWRIGHT_WORKERS` | `1` | Parallel workers (1 per 2GB RAM) |

### Optional Features

| Variable | Description |
|----------|-------------|
| `AI_PROVIDER` | `openai`, `azure`, `anthropic`, `gemini`, `bedrock`, `openrouter` |
| `AI_MODEL` | Model ID (e.g., `gpt-4o-mini`) |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_FROM_EMAIL` | Email notifications |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | GitHub OAuth |
| `SIGNUP_ENABLED` | `true` — disable to block registration |
| `ALLOWED_EMAIL_DOMAINS` | Comma-separated allowlist (empty = all) |
| `STATUS_PAGE_DOMAIN` | Base domain for status pages and CNAME target for custom domains |
| `STATUS_PAGE_HIDE_BRANDING` | `true` or `1` — hide footer branding |

`STATUS_PAGE_DOMAIN` reserves the default status-page namespace (`[uuid].STATUS_PAGE_DOMAIN`) and is the CNAME target shown for custom-domain setup. CNAME verification accepts `STATUS_PAGE_DOMAIN`, `cname.STATUS_PAGE_DOMAIN`, and `ingress.STATUS_PAGE_DOMAIN` as valid targets. The HTTPS Compose variants also define a lower-priority catch-all Traefik router so verified custom domains outside that namespace route to the app without extra manual host entries. If Cloudflare fronts the custom hostname, leave it on DNS-only until the origin serves HTTPS for that hostname.

## Service Architecture

### Startup Order

```
PostgreSQL (healthy) ──┐
Redis (healthy) ───────┤──→ App (runs Drizzle migrations) ──→ Worker (K8s init)
MinIO (healthy) ───────┘
```

### Health Checks

| Service | Endpoint | Interval | Start Period |
|---------|----------|----------|--------------|
| App | `GET /api/health` | 30s | 120s |
| Worker | `GET /health` | 30s | 60s |
| PostgreSQL | `pg_isready` | 10s | 30s |
| Redis | `redis-cli ping` | 10s | — |
| MinIO | `mc ready local` | 10s | — |

### Resource Limits

| Service | CPU | Memory |
|---------|-----|--------|
| App | 1.0 | 2G |
| Worker | 1.8 | 3G |
| PostgreSQL | 0.5 | 1G |
| Redis | 0.25 | 256M |
| MinIO | 0.5 | 1G |

## Security Hardening

### Worker Container (GVISOR-006)

- `read_only: true` — read-only root filesystem
- `user: "1000:1000"` — non-root (pwuser)
- `cap_drop: [ALL]` — no capabilities
- `security_opt: [no-new-privileges:true]`
- Writable tmpfs only: `/tmp` (2G), `/home/pwuser/.cache` (256M), `/home/pwuser/.npm` (256M)

### gVisor Sandbox

Each test execution runs in a per-run K8s Job with `runtimeClassName: gvisor`:
- Kernel-level syscall interception
- `supercheck-execution` namespace with NetworkPolicy (deny all except DNS)
- LimitRange: max 1.5 CPU, 2GB per pod
- ResourceQuota: max 4 CPU, 16GB for namespace

### Network Isolation

- PostgreSQL, Redis, MinIO bind to `127.0.0.1` only
- Only Traefik (secure variant) binds to `0.0.0.0`

## Scaling

### Single-Server

```bash
WORKER_REPLICAS=4 RUNNING_CAPACITY=4 QUEUED_CAPACITY=20 docker compose up -d
```

### Multi-Location

```bash
# Main server
WORKER_LOCATION=local WORKER_REPLICAS=2 docker compose up -d

# US-East remote (worker only)
WORKER_LOCATION=us-east WORKER_REPLICAS=2 docker compose -f docker-compose-worker.yml up -d

# EU-West remote (worker only)
WORKER_LOCATION=eu-west WORKER_REPLICAS=2 docker compose -f docker-compose-worker.yml up -d

# Main server: RUNNING_CAPACITY = 2+2+2 = 6
```

## Demo Server (Docker Compose Production)

The Docker Compose production deployment runs on a **dedicated Hetzner server** as the demo site (demo.supercheck.dev).

### Server Details

| Property | Value |
|----------|-------|
| **Server IP** | `88.198.125.135` |
| **SSH Access** | `ssh root@88.198.125.135` |
| **Compose File** | `docker-compose-secure.yml` |
| **Project Path** | `/root/supercheck/deploy/docker/` |
| **Environment File** | `/root/supercheck/deploy/docker/.env` |
| **Domain** | `demo.supercheck.dev` |

### Deployment Commands

**Always SSH into the demo server for Docker Compose deployments:**

```bash
# Check current running versions
ssh root@88.198.125.135 "docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}'"

# Update version (supports semver, canary, rc tags — e.g. 1.3.3, 1.3.3-canary.1, 1.4.0-rc.2)
ssh root@88.198.125.135 "sed -i 's/SUPERCHECK_VERSION=.*/SUPERCHECK_VERSION=<new_version>/' /root/supercheck/deploy/docker/.env"

# Pull new images and redeploy
ssh root@88.198.125.135 "cd /root/supercheck/deploy/docker && docker compose -f docker-compose-secure.yml pull app worker && docker compose -f docker-compose-secure.yml up -d app worker"

# Verify deployment
ssh root@88.198.125.135 "docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}'"

# View logs (tail 30 lines of both services)
ssh root@88.198.125.135 "cd /root/supercheck/deploy/docker && docker compose -f docker-compose-secure.yml logs --tail=30 app worker"
```

### Version Upgrade Procedure

1. Update `.env` on the server: `SUPERCHECK_VERSION=<new_version>` (supports stable, canary, rc tags)
2. Pull images: `docker compose -f docker-compose-secure.yml pull app worker`
3. Redeploy: `docker compose -f docker-compose-secure.yml up -d app worker`
4. Verify: `docker ps` — confirm all containers show new version and `(healthy)`
5. Check logs: `docker compose -f docker-compose-secure.yml logs --tail=30 app worker` — confirm no errors

**Note on version tags:** Canary and RC releases follow the pattern `<version>-canary.<n>` and `<version>-rc.<n>` (e.g. `1.3.3-canary.1`). These are deployable like stable releases. When bumping compose file defaults locally, also update the `${SUPERCHECK_VERSION:-...}` fallback in all 4 compose files.

**Important:** Do NOT run Docker Compose locally. The demo/production Docker Compose environment is on this server.

## Operations

**On the demo server** (`ssh root@88.198.125.135`):

```bash
cd /root/supercheck/deploy/docker

docker compose -f docker-compose-secure.yml up -d        # Start all
docker compose -f docker-compose-secure.yml stop          # Stop (preserves data)
docker compose -f docker-compose-secure.yml down -v       # Full teardown (DATA LOSS)
docker compose -f docker-compose-secure.yml logs -f app   # App logs
docker compose -f docker-compose-secure.yml logs -f worker # Worker logs
docker compose -f docker-compose-secure.yml exec postgres pg_dump -U postgres supercheck > backup.sql  # Backup
```

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| "DATABASE_URL required" | Missing `.env` | Run `sudo bash init-secrets.sh` |
| "supercheck-execution namespace not found" | K3s not installed | Run `sudo bash setup-k3s.sh` |
| Jobs timeout after 5 min | Invalid kubeconfig path | Verify `/etc/rancher/k3s/supercheck-worker.kubeconfig` |
| gVisor exec fails silently | Missing 'get' on pods/exec RBAC | Re-run `setup-k3s.sh` (needs both 'get' AND 'create') |
| HTTPS redirect loop (Cloudflare) | SSL mode mismatch | Set Cloudflare SSL/TLS to "Full (Strict)" |
| First email only in multi-address alerts | Old worker image | Upgrade to 1.3.3+ |

## File Reference

| File | Purpose |
|------|---------|
| `deploy/docker/docker-compose.yml` | Base self-hosted stack |
| `deploy/docker/docker-compose-secure.yml` | HTTPS with Traefik |
| `deploy/docker/docker-compose-external.yml` | External managed services |
| `deploy/docker/docker-compose-worker.yml` | Remote regional worker |
| `deploy/docker/docker-compose-local.yml` | Local dev (source build) |
| `deploy/docker/init-secrets.sh` | Generate secure `.env` |
| `deploy/docker/setup-k3s.sh` | Install K3s + gVisor sandbox |
| `deploy/coolify/supercheck.yaml` | Coolify one-click template |
