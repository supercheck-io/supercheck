# Self-host Supercheck

Install on an Ubuntu 22.04+ or Debian 12+ server with sudo access and `curl` (at least 2 vCPU, 4 GB RAM, and 15 GB free disk):

```bash
curl -fsSL https://raw.githubusercontent.com/supercheck-io/supercheck/main/deploy/docker/install.sh -o install.sh && sudo bash install.sh --version 1.3.7-canary.16
```

This installs **1.3.7-canary.16**, which includes RustFS. Choose local evaluation or public HTTPS and follow the prompts. The installer installs Docker and Compose, generates secrets, prepares the execution sandbox, starts the services, and checks health. Open the printed URL to create your account and run a test.

For HTTPS, point your domain at the server and allow inbound ports 80 and 443. macOS, Windows, WSL2, and Docker Desktop are not supported.

See the [self-hosting guide](https://supercheck.io/docs/app/deployment/self-hosted) for optional configuration and maintenance. Use `bash install.sh --help` for flags or [INSTALL.md](./INSTALL.md) for custom and agent-assisted installations. The references below describe the files managed by the installer.

Run maintenance commands from your installation's `deploy/docker` directory. Examples below assume your user can read `.env` and access Docker. For installer-managed, root-owned installations, use `sudo docker compose`, `sudo env KUBECONFIG_FILE=... docker compose` for commands with that prefix, and `sudoedit .env`; download and run migration scripts with `sudo` too.

## Available Configurations

| File | Use Case |
|------|----------|
| `docker-compose.yml` | Bundled stack; optional `https` and `private-agent` profiles |
| `docker-compose-secure.yml` | Compatibility entry point for existing HTTPS installations |
| `docker-compose-external.yml` | Connect to managed external PostgreSQL, Redis, and S3 services |
| `docker-compose-worker.yml` | Remote regional worker |
| `docker-compose-private-agent.yml` | Standalone agent for remote networks or Supercheck Cloud |
| `docker-compose-local.yml` | Source-based local development |
| `docker-compose-aisre-lab.yml` | Optional AI SRE integration lab with OSS telemetry and webhook capture |

The optional [AI SRE integration lab](./aisre-lab/README.md) is for connector development and testing; it is not needed for installation.

Execution workers use the worker readiness endpoint (`/health/ready`) for healthchecks. A worker is marked unhealthy when it cannot reach required dependencies such as PostgreSQL, Redis, or its queues. Private agents disable healthchecks by design because agent mode runs no HTTP server.

---

## Environment Variables

Use `./init-secrets.sh` to generate secure defaults, then configure:

### Base (all deployments)

| Variable | Description |
|----------|-------------|
| `SUPERCHECK_VERSION` | App/worker image tag for prebuilt Compose variants, including the sandbox image (default in this checkout: `1.3.7-canary.16`); set explicitly in `.env` when upgrading |
| `SELF_HOSTED` | Self-hosted mode toggle (default: `true`) |
| `SIGNUP_ENABLED` | Toggle open email/password signup (default: `true`) |
| `ALLOWED_EMAIL_DOMAINS` | Optional comma-separated signup allowlist (default: empty = allow all) |
| `STATUS_PAGE_HIDE_BRANDING` | Hide the `Powered by Supercheck` footer on all public status and incident pages when set to `true` (default: `false`) |
| `STATUS_PAGE_DELIVERY_RETENTION_DAYS` | Days to keep delivered, failed, and skipped status-page notification delivery rows (default: `30`; valid range `1`–`3650`) |
| `NEXT_PUBLIC_APP_URL` | Browser-reachable app origin, including scheme and port, with no trailing slash (bundled stack: derived as `https://${APP_DOMAIN}` when set, otherwise `http://localhost:3000`; external-services variant requires an explicit value) |

OAuth (`GITHUB_*` / `GOOGLE_*`) is optional in self-hosted mode.

The default HTTP setup binds the app to loopback (`127.0.0.1:3000`). Use an SSH port forward for remote evaluation; use HTTPS for a public server.

### HTTPS Profile

Set `COMPOSE_PROFILES=https`, `APP_DOMAIN`, and `ACME_EMAIL` in `.env`. App and authentication URLs derive from `APP_DOMAIN`; update any existing `NEXT_PUBLIC_APP_URL` override to the same HTTPS origin. Point DNS at the server and open ports 80 and 443. Run the same `docker compose up -d` command.

`STATUS_PAGE_DOMAIN` reserves the default status-page namespace (`[uuid].STATUS_PAGE_DOMAIN`). In the HTTPS Compose variants, Supercheck derives the custom-domain target shown in Settings from it, usually `cname.STATUS_PAGE_DOMAIN`. In self-hosted deployments, that target must already point to your app, usually through an A/AAAA record or a wildcard record that already covers it. Keep customer-facing custom domains outside the `STATUS_PAGE_DOMAIN` namespace (for example, `status.example.net`) and point their CNAME to the exact target shown in Settings (for example, `cname.example.com`). The Compose HTTPS variants include a lower-priority Traefik catch-all router so verified custom domains route to the app automatically, but TLS for those hostnames still requires your own certificate workflow. If you use Cloudflare, keep the custom CNAME on DNS-only until verification and origin HTTPS are working.

When you are running the app locally on `http://localhost:3000`, Supercheck keeps status-page preview links on `http://localhost:3000/status/[subdomain]`. It does not send local development traffic to the public `STATUS_PAGE_DOMAIN`.

### Optional

| Variable | Description | Default |
|----------|-------------|---------|
| `CORS_ALLOWED_ORIGINS` | App-side: comma-separated additional trusted origins for browser integrations | Empty |
| `DEVICE_AUTH_ENABLED` | Let `supercheck login` sign in through the browser (device authorization). When `false` the CLI asks users to create a token in the dashboard instead. Needs Redis and database migration 0032 | `false` |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | Optional GitHub social sign-in | - |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Optional Google social sign-in | - |
| `SMTP_HOST`, `SMTP_FROM_EMAIL` (+ optional `SMTP_USER`/`SMTP_PASSWORD`) | Email notifications (disabled if SMTP_HOST not set) | - |
| `AI_PROVIDER` | AI provider (`openai`, `azure`, `anthropic`, `gemini`, `google-vertex`, `bedrock`, `openrouter`, `deepseek`) | `openai` |
| `AI_MODEL` | AI model name | `gpt-6-luna` |
| `OPENAI_API_KEY` | AI features (for default OpenAI provider) | - |
| `DEEPSEEK_API_KEY` | API key required when `AI_PROVIDER=deepseek` | - |
| `WORKER_REPLICAS` | Number of worker containers (worker-side scaling knob) | `1` |
| `RUNNING_CAPACITY` | App-side gate: max concurrent test runs (set equal to `WORKER_REPLICAS`) | `1` |
| `QUEUED_CAPACITY` | App-side gate: max queued test runs before new submissions are rejected | `10` |
| `WORKER_LOCATION` | Worker queue mode (`local` for single-server self-hosted, or any enabled Super Admin location code) | `local` |
| `WORKER_QUEUES` | Comma list of queue consumers: `monitor`, `k6`, `global-playwright`, `global-k6`. Empty starts all for self-hosted, development and private-agent deployments. Cloud production (`SELF_HOSTED=false`, `NODE_ENV=production`, non-agent) requires an explicit list; use `monitor` for a monitoring-only worker | all for self-hosted |

OpenAI GPT-6 Luna is the default. To opt into DeepSeek V4.1 Flash, set `AI_PROVIDER=deepseek`, `AI_MODEL=deepseek-flash`, and `DEEPSEEK_API_KEY`. This sends AI prompts, code, requirement text, and supplied evidence to DeepSeek's hosted API; review data handling and China-related residency requirements first. Provider selection applies to the entire installation.

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

For manual installation, first install Docker Engine and Compose v2.24.4+ using the [manual runbook](./INSTALL.md#0-install-prerequisites), including these Ubuntu/Debian prerequisites:

```bash
sudo apt-get update
sudo apt-get install -y git bzip2 ca-certificates curl gnupg
```

`bzip2` is required to extract the gVisor archive. Then run the bootstrap script once on your host before starting the workers:

```bash
sudo bash setup-k3s.sh
```

It prepares the isolated environment required for Playwright and k6 test execution, including resource limits and network restrictions. The installer also imports the roughly 3 GB worker image into the sandbox runtime. With manual installation, the first test run downloads that image into the cluster and may be slow or time out.

> **Linux host required:** Docker Engine on a Linux server (Ubuntu 22.04+, Debian 12+) is the only supported target. macOS, Windows, and WSL2 are not supported because the execution sandbox requires the Linux kernel.

---

## Upgrading

Back up your data and `.env` first (see [Backups](#backups)). Run commands from your installation's `deploy/docker` directory, using the same Compose file and profiles as installation; custom variants need their corresponding `-f` flag.

Before starting upgraded workers, make the restricted worker kubeconfig readable by the worker's `pwuser` group (GID 1001). Run this on each Docker host that runs workers, including remote worker hosts; replace the path if `KUBECONFIG_FILE` is configured differently. Do not apply this to the admin `/etc/rancher/k3s/k3s.yaml`:

```bash
sudo chgrp 1001 /etc/rancher/k3s/supercheck-worker.kubeconfig
sudo chmod 0440 /etc/rancher/k3s/supercheck-worker.kubeconfig
```

**Upgrading from bundled MinIO (releases before `1.3.7-canary.16`):** MinIO and RustFS disk formats are incompatible. Stop remote workers, then download and run the migration script from your **current MinIO checkout**, with the old stack running, **before updating the checkout**:

```bash
sudo curl -fsSL https://raw.githubusercontent.com/supercheck-io/supercheck/main/deploy/docker/migrate-minio-to-rustfs.sh -o migrate-minio-to-rustfs.sh && \
sudo bash migrate-minio-to-rustfs.sh && sudo rm -- migrate-minio-to-rustfs.sh
```

Continue only after migration succeeds. The script stops local app/worker, copies and verifies storage, and preserves `.env.pre-rustfs` and `minio-data` for recovery. Follow the [migration guide](https://supercheck.io/docs/app/deployment/self-hosted#upgrading-from-minio-breaking), then start the new checkout with `docker compose up -d --wait --wait-timeout 300 --remove-orphans` (with `KUBECONFIG_FILE` set as below) to remove the old MinIO container and free port 9000. Verify a status page and test report before deleting the old storage volume.

Update the deployment files to the target release when required by its release notes. Set `SUPERCHECK_VERSION=<new release>` in `.env` (without the Git tag's leading `v`), then run:

```bash
docker compose pull && \
KUBECONFIG_FILE=/etc/rancher/k3s/supercheck-worker.kubeconfig \
docker compose up -d --wait --wait-timeout 300
```

`pull` alone downloads the currently selected tag; it does not select a newer release. Migrations run automatically at app startup. Preserve existing secrets and data volumes; `restart` does not reload `.env` changes.

> **Upgrading from pre-1.3.3 releases:** Supercheck introduced the current isolated execution sandbox in `1.3.3`. Before upgrading an older deployment, back up your database and run `sudo bash setup-k3s.sh` to install the execution sandbox. See the [deployment guide](https://supercheck.io/docs/app/deployment/self-hosted) for details.

---

## Backups

Back up PostgreSQL, the `rustfs-data` volume (including reports, uploaded assets, and documents), `.env`, and the `traefik-letsencrypt` certificate volume when using HTTPS. For external services, use their backup tools. Keep backups private and off the server; `.env` contains the database password, `BETTER_AUTH_SECRET`, and `SECRET_ENCRYPTION_KEY`, which must be preserved to read encrypted data.

```bash
# Create a private database export without a TTY
install -m 600 /dev/null "$HOME/supercheck-backup.sql" && \
  sudo docker compose exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' > "$HOME/supercheck-backup.sql"

# Restore into an empty database with the matching database role available
sudo docker compose exec -T postgres sh -c 'psql --set ON_ERROR_STOP=on -U "$POSTGRES_USER" "$POSTGRES_DB"' < "$HOME/supercheck-backup.sql"
```

Stop app/worker and remote workers before restoring; do not restore over a populated database. The SQL export does not include storage files, `.env`, or certificates. Use consistent volume snapshots or stop the services that write to a volume before copying it, and verify backups with a restore in an isolated installation.

---

## Documentation

Full documentation: **[supercheck.io/docs/app/deployment](https://supercheck.io/docs/app/deployment)**

## AI SRE

Configure an AI provider to use AI SRE. Investigations and Copilot are enabled by default; automatic alert triage is opt-in. Migrations run when the app starts.

Automatic alert triage is off by default, so investigations are manual. Set `SRE_AUTOMATION_ENABLED=true` to opt in (it can incur AI-provider charges), or `SRE_ENABLED=false` to disable AI SRE. After changing `.env`, run `docker compose up -d --force-recreate app worker` with the configured profiles.

### Private Agent Profile

For a colocated agent, register it in Organization Admin → Private Agents, set its `PRIVATE_AGENT_ID` and `PRIVATE_AGENT_TOKEN`, and add `private-agent` to `COMPOSE_PROFILES` (for example `https,private-agent`). Run `docker compose up -d private-agent`. It uses the app's internal origin and an isolated Docker network, with no database, Redis, or S3 credentials.

Stop it with `docker compose stop private-agent` before removing the profile. Recreate it after `.env` changes, preserving `private-agent-state`. Use the standalone file only when the agent runs on another network or connects to Cloud.
