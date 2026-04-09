# Docker Compose Configurations

Production-ready Docker Compose files for self-hosting Supercheck.

## Quick Start

```bash
git clone https://github.com/supercheck-io/supercheck.git
cd supercheck/deploy/docker

# Generate secrets and set up the execution sandbox
sudo bash init-secrets.sh
sudo bash setup-k3s.sh

# Edit .env for optional integrations (SMTP, AI, OAuth)
nano .env

# Start self-hosted stack
KUBECONFIG_FILE=/etc/rancher/k3s/supercheck-worker.kubeconfig docker compose up -d

# Or start with HTTPS
KUBECONFIG_FILE=/etc/rancher/k3s/supercheck-worker.kubeconfig docker compose -f docker-compose-secure.yml up -d
```

## Prerequisites

> **Modern Docker Compose Required**: Use `docker compose` (with space), not `docker-compose` (with hyphen).

```bash
docker compose version
# Should show: Docker Compose version v2.x.x or higher
```

**Install Docker (Linux only):**
```bash
curl -fsSL https://get.docker.com | sh
```

> **Linux Required:** Supercheck uses K3s and gVisor for sandboxed test execution, which require the Linux kernel. Only Linux servers (Ubuntu 22.04+, Debian 12+) are supported. macOS, Windows, and WSL2 are not supported.

---

## Available Configurations

| File | Use Case |
|------|----------|
| `docker-compose.yml` | Self-hosted deployment (HTTP, localhost:3000) |
| `docker-compose-secure.yml` | Production with HTTPS |
| `docker-compose-worker.yml` | Remote regional worker |
| `docker-compose-local.yml` | Source-based local development |

---

## Environment Variables

Use `./init-secrets.sh` to generate secure defaults, then configure:

### Base (all deployments)

| Variable | Description |
|----------|-------------|
| `SELF_HOSTED` | Self-hosted mode toggle (default: `true`) |
| `SIGNUP_ENABLED` | Toggle open email/password signup (default: `true`) |
| `ALLOWED_EMAIL_DOMAINS` | Optional comma-separated signup allowlist (default: empty = allow all) |
| `STATUS_PAGE_HIDE_BRANDING` | Hide the `Powered by Supercheck` footer on all public status and incident pages when set to `true` (default: `false`) |

OAuth (`GITHUB_*` / `GOOGLE_*`) is optional in self-hosted mode.

### Production (docker-compose-secure.yml)

| Variable | Description |
|----------|-------------|
| `APP_DOMAIN` | Your domain (e.g., `app.yourdomain.com`) |
| `ACME_EMAIL` | Email for Let's Encrypt |
| `STATUS_PAGE_DOMAIN` | Base hostname for status pages and CNAME target for custom domains (e.g., `yourdomain.com`) |

`STATUS_PAGE_DOMAIN` reserves the default status-page namespace (`[uuid].STATUS_PAGE_DOMAIN`) and is also the CNAME target shown for custom-domain setup. CNAME verification accepts `STATUS_PAGE_DOMAIN`, `cname.STATUS_PAGE_DOMAIN`, and `ingress.STATUS_PAGE_DOMAIN` as valid targets. The HTTPS Compose variants also include a lower-priority Traefik catch-all router so verified custom domains outside the reserved namespace are forwarded to the app automatically. When fronting custom domains with Cloudflare, keep the record on DNS-only until the origin serves HTTPS for that hostname.

### Optional

| Variable | Description | Default |
|----------|-------------|---------|
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | Optional GitHub social sign-in | - |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Optional Google social sign-in | - |
| `SMTP_HOST`, `SMTP_FROM_EMAIL` (+ optional `SMTP_USER`/`SMTP_PASSWORD`) | Email notifications (disabled if SMTP_HOST not set) | - |
| `AI_PROVIDER` | AI provider (`openai`, `azure`, `anthropic`, `gemini`, `google-vertex`, `bedrock`, `openrouter`) | `openai` |
| `AI_MODEL` | AI model name | `gpt-4o-mini` |
| `OPENAI_API_KEY` | AI features (for default OpenAI provider) | - |
| `WORKER_REPLICAS` | Number of worker containers (worker-side scaling knob) | `1` |
| `RUNNING_CAPACITY` | App-side gate: max concurrent test runs (set equal to `WORKER_REPLICAS`) | `1` |
| `QUEUED_CAPACITY` | App-side gate: max queued test runs before new submissions are rejected | `10` |
| `WORKER_LOCATION` | Worker queue mode (`local` for single-server self-hosted, or any enabled Super Admin location code) | `local` |

---

## Scaling Workers

```bash
# Scale to 2 worker replicas (2 concurrent executions)
WORKER_REPLICAS=2 RUNNING_CAPACITY=2 QUEUED_CAPACITY=20 \
KUBECONFIG_FILE=/etc/rancher/k3s/supercheck-worker.kubeconfig \
docker compose up -d
```

`RUNNING_CAPACITY` and `QUEUED_CAPACITY` are **App-side** settings. The App uses them to gate how many runs can be in `running` and `queued` states before submissions are throttled or rejected. Keep `RUNNING_CAPACITY` aligned with total worker replicas so the gate matches actual execution throughput.

For single-server deployments, keep `WORKER_LOCATION=local` so one worker processes all regional queues.

---

## Execution Sandbox

Production self-hosted deployments use [gVisor](https://gvisor.dev) for sandboxed test execution. Each Playwright and k6 run executes in an isolated environment.

### Installation

Run the bootstrap script on your host:

```bash
sudo bash setup-k3s.sh
```

This installs the execution sandbox, creates the `supercheck-execution` namespace with appropriate resource limits and network policies, and writes a restricted worker kubeconfig to `/etc/rancher/k3s/supercheck-worker.kubeconfig`.

> **Linux host required:** Docker Engine on a Linux server (Ubuntu 22.04+, Debian 12+) is the only supported target. macOS, Windows, and WSL2 are not supported because K3s and gVisor require the Linux kernel.

---

## Upgrading

```bash
docker compose pull && \
KUBECONFIG_FILE=/etc/rancher/k3s/supercheck-worker.kubeconfig \
docker compose up -d
```

> **Upgrading to 1.3.3 from earlier versions:** This release replaces Docker socket-based execution with K3s + gVisor. Before upgrading, back up your database and run `sudo bash setup-k3s.sh` to install the execution sandbox. See the [deployment guide](https://supercheck.io/docs/app/deployment/self-hosted) for details.

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

Full documentation: **[supercheck.io/docs/app/deployment](https://supercheck.io/docs/app/deployment)**
