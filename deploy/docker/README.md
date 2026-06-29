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
| `docker-compose-aisre-lab.yml` | Optional AI SRE integration lab with OSS telemetry and webhook capture |

## Optional AI SRE Integration Lab

The AI SRE lab is an opt-in Docker Compose overlay for testing read-only connectors, webhook delivery, alert fire/recovery behavior, and seeded live evals without connecting to customer production systems.

```bash
cd supercheck/deploy/docker

# Start Supercheck plus the full OSS lab profile.
KUBECONFIG_FILE=/etc/rancher/k3s/supercheck-worker.kubeconfig \
docker compose -f docker-compose.yml -f docker-compose-aisre-lab.yml \
  --profile aisre-lab up -d

# Trigger deterministic demo signals.
curl http://127.0.0.1:18080/checkout
curl http://127.0.0.1:18080/checkout/slow
curl http://127.0.0.1:18080/checkout/error

# Inspect captured Alertmanager or Supercheck webhook payloads.
curl http://127.0.0.1:18081/payloads
```

Lab endpoints bind to `127.0.0.1` by default:

| Endpoint | Default URL |
| --- | --- |
| Demo service | `http://127.0.0.1:18080` |
| Webhook capture | `http://127.0.0.1:18081` |
| Grafana | `http://127.0.0.1:13000` |
| Prometheus | `http://127.0.0.1:19090` |
| Alertmanager | `http://127.0.0.1:19093` |
| Loki | `http://127.0.0.1:13100` |
| Tempo | `http://127.0.0.1:13200` |

Use the `core`, `logs`, and `traces` profiles when you want only part of the lab:

```bash
# Metrics, alerts, Grafana, demo service, and webhook capture only.
docker compose -f docker-compose.yml -f docker-compose-aisre-lab.yml --profile core up -d

# Add logs or traces independently.
docker compose -f docker-compose.yml -f docker-compose-aisre-lab.yml --profile logs up -d
docker compose -f docker-compose.yml -f docker-compose-aisre-lab.yml --profile traces up -d
```

Keep this lab behind a firewall on shared hosts. It is not a production observability stack.

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
| `STATUS_PAGE_DOMAIN` | Reserved hostname namespace for default status page URLs (e.g., `yourdomain.com`) |

`STATUS_PAGE_DOMAIN` reserves the default status-page namespace (`[uuid].STATUS_PAGE_DOMAIN`). In the HTTPS Compose variants, Supercheck derives the custom-domain target shown in Settings from it, usually `cname.STATUS_PAGE_DOMAIN`. In self-hosted deployments, that target must already point to your app, usually through an A/AAAA record or a wildcard record that already covers it. Keep customer-facing custom domains outside the `STATUS_PAGE_DOMAIN` namespace (for example, `status.example.net`) and point their CNAME to the exact target shown in Settings (for example, `cname.example.com`). The Compose HTTPS variants include a lower-priority Traefik catch-all router so verified custom domains route to the app automatically, but TLS for those hostnames still requires your own certificate workflow. If you use Cloudflare, keep the custom CNAME on DNS-only until verification and origin HTTPS are working.

When you are running the app locally on `http://localhost:3000`, Supercheck keeps status-page preview links on `http://localhost:3000/status/[subdomain]`. It does not send local development traffic to the public `STATUS_PAGE_DOMAIN`.

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

> **Upgrading from pre-1.3.3 releases:** Supercheck moved from Docker socket-based execution to K3s + gVisor in `1.3.3`. Before upgrading an older deployment, back up your database and run `sudo bash setup-k3s.sh` to install the execution sandbox. See the [deployment guide](https://supercheck.io/docs/app/deployment/self-hosted) for details.

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
