# Self-host Supercheck

Install on an Ubuntu 22.04+ or Debian 12+ server with sudo access and `curl` (at least 2 vCPU, 4 GB RAM, and 15 GB free disk):

```bash
curl -fsSL https://raw.githubusercontent.com/supercheck-io/supercheck/v1.5.0/deploy/docker/install.sh -o install.sh && sudo bash install.sh --version 1.5.0
```

This installs **1.5.0**, which includes RustFS. Choose local evaluation or public HTTPS and follow the prompts. The installer installs Docker and Compose, generates secrets, prepares the execution sandbox, starts the services, and checks health. Open the printed URL to create your account and run a test.

For HTTPS, point your domain at the server and allow inbound ports 80 and 443. macOS, Windows, WSL2, and Docker Desktop are not supported.

The [self-hosting guide](https://supercheck.io/docs/app/deployment/self-hosted) is the canonical reference for installing, upgrading (`sudo bash install.sh --upgrade`), backups (`sudo bash backup.sh`), status-page HTTPS and troubleshooting. Use `bash install.sh --help` for flags, or [INSTALL.md](./INSTALL.md) for a manual installation. This file describes the Compose files and environment variables.

Run maintenance commands from your installation's `deploy/docker` directory as `sudo docker compose ...`, and edit `.env` with `sudoedit .env`.

## Available Configurations

| File | Use Case |
|------|----------|
| `docker-compose.yml` | Bundled stack; optional `https`, `private-agent` and `monitor-control` profiles |
| `docker-compose-secure.yml` | Compatibility entry point for existing HTTPS installations |
| `docker-compose-external.yml` | Connect to managed external PostgreSQL, Redis, and S3 services |
| `docker-compose-worker.yml` | Remote regional worker |
| `docker-compose-private-agent.yml` | Standalone agent for remote networks or Supercheck Cloud |
| `docker-compose-local.yml` | Source-based local development |
| `docker-compose-aisre-lab.yml` | Optional AI SRE integration lab with OSS telemetry and webhook capture |
| `compose.dns01.yml` | Opt-in override: wildcard certificate for status pages via ACME DNS-01 (enable with `COMPOSE_FILE`) |

The optional [AI SRE integration lab](./aisre-lab/README.md) is for connector development and testing; it is not needed for installation.

Bundled Redis keeps BullMQ queue data in the `redis-data` named volume with append-only persistence (`appendfsync everysec`). Container restarts and recreation preserve this volume; `docker compose down -v` deletes it. An abrupt host or storage failure can lose approximately one second of acknowledged writes. This single-node setup does not provide replication or backups; use managed Redis when stronger recovery guarantees are required. Redis may replay an interrupted job, so test scripts with external side effects should tolerate retries.

Execution workers use the worker readiness endpoint (`/health/ready`) for healthchecks. A worker is marked unhealthy when it cannot reach required dependencies such as PostgreSQL, Redis, or its queues. Private agents disable healthchecks by design because agent mode runs no HTTP server.

---

## Environment Variables

Use `./init-secrets.sh` to generate secure defaults, then configure:

### Base (all deployments)

| Variable | Description |
|----------|-------------|
| `SUPERCHECK_VERSION` | App/worker image tag for prebuilt Compose variants, including the sandbox image (default in this checkout: `1.5.0`); set explicitly in `.env` when upgrading |
| `SELF_HOSTED` | Self-hosted mode toggle (default: `true`) |
| `SIGNUP_ENABLED` | Toggle open email/password signup (default: `true`) |
| `ALLOWED_EMAIL_DOMAINS` | Optional comma-separated signup allowlist (default: empty = allow all) |
| `STATUS_PAGE_HIDE_BRANDING` | Hide the `Powered by Supercheck` footer on all public status and incident pages when set to `true` (default: `false`) |
| `STATUS_PAGE_DELIVERY_RETENTION_DAYS` | Days to keep delivered, failed, and skipped status-page notification delivery rows (default: `30`; valid range `1`–`3650`) |
| `NEXT_PUBLIC_APP_URL` | Browser-reachable app origin, including scheme and port, with no trailing slash (bundled stack: derived as `https://${APP_DOMAIN}` when set, otherwise `http://localhost:3000`; external-services variant requires an explicit value) |
| `DATABASE_URL` | PostgreSQL connection. For an external server that requires TLS, add `?sslmode=require` (or `verify-full`): app, worker and migrations then verify the server certificate against the system CAs, so a private CA must be trusted in those containers. `sslmode=disable` turns TLS off |

OAuth (`GITHUB_*` / `GOOGLE_*`) is optional in self-hosted mode.

The default HTTP setup binds the app to loopback (`127.0.0.1:3000`). Use an SSH port forward for remote evaluation; use HTTPS for a public server.

### HTTPS Profile

Set `COMPOSE_PROFILES=https`, `APP_DOMAIN`, and `ACME_EMAIL` in `.env`. App and authentication URLs derive from `APP_DOMAIN`; update any existing `NEXT_PUBLIC_APP_URL` override to the same HTTPS origin. Point DNS at the server and open ports 80 and 443. Run the same `sudo docker compose up -d` command.

`STATUS_PAGE_DOMAIN` reserves the default status-page namespace (`[uuid].STATUS_PAGE_DOMAIN`). In the HTTPS Compose variants, Supercheck derives the custom-domain target shown in Settings from it, usually `cname.STATUS_PAGE_DOMAIN`. In self-hosted deployments, that target must already point to your app, usually through an A/AAAA record or a wildcard record that already covers it. Keep customer-facing custom domains outside the `STATUS_PAGE_DOMAIN` namespace (for example, `status.example.net`) and point their CNAME to the exact target shown in Settings (for example, `cname.example.com`). The Compose HTTPS variants include a lower-priority Traefik catch-all router so verified custom domains route to the app automatically, but TLS for those hostnames still requires your own certificate workflow. Status-page subdomains need a wildcard certificate, which the default HTTP-01 challenge cannot issue: enable `compose.dns01.yml` as described in [Status page HTTPS](https://supercheck.io/docs/app/deployment/self-hosted#status-page-https). If you use Cloudflare, keep the custom CNAME on DNS-only until verification and origin HTTPS are working.

When you are running the app locally on `http://localhost:3000`, Supercheck keeps status-page preview links on `http://localhost:3000/status/[subdomain]`. It does not send local development traffic to the public `STATUS_PAGE_DOMAIN`.

### Optional

| Variable | Description | Default |
|----------|-------------|---------|
| `CORS_ALLOWED_ORIGINS` | App-side: comma-separated additional trusted origins for browser integrations | Empty |
| `DEVICE_AUTH_ENABLED` | Let `supercheck login` sign in through the browser (device authorization). When `false` the CLI asks users to create a token in the dashboard instead. Needs Redis and database migration 0032 | `false` |
| `MCP_SERVER_ENABLED` | Remote MCP server sign-in (OAuth 2.1 for MCP clients). Off by default; needs migration 0036 and `BETTER_AUTH_URL` set to the public HTTPS URL | `false` |
| `MCP_ALLOWED_ORIGINS` | Comma-separated exact browser origins (no wildcards) allowed to call `/api/mcp`, for browser-based MCP clients. The app's own origin is always allowed; `CORS_ALLOWED_ORIGINS` does not apply to MCP, so list any browser client origin here | Empty |
| `REPORTS_ORIGIN` | Optional separate cookieless origin for report documents, for example `https://reports.example.net` (scheme and host, no path). Unset serves reports from the app origin. When set, the app serves report HTML only on that host via short-lived signed URLs, so you must also route that hostname to the app with TLS. Use a different registrable domain than the app, or host-only session cookies | Empty |
| `MCP_DYNAMIC_CLIENT_REGISTRATION` | With the MCP server on, accept self-registering clients. `false` accepts only clients that identify themselves with a Client ID Metadata Document | `true` |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | Optional GitHub social sign-in | - |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Optional Google social sign-in | - |
| `SMTP_HOST`, `SMTP_FROM_EMAIL` (+ optional `SMTP_USER`/`SMTP_PASSWORD`) | Email notifications (disabled if SMTP_HOST not set) | - |
| `AI_PROVIDER` | AI provider (`openai`, `azure`, `anthropic`, `gemini`, `google-vertex`, `bedrock`, `openrouter`, `deepseek`) | `openai` |
| `AI_MODEL` | AI model name | `gpt-6-luna` |
| `OPENAI_API_KEY` | AI features (for default OpenAI provider) | - |
| `DEEPSEEK_API_KEY` | API key required when `AI_PROVIDER=deepseek` | - |
| `MISSING_CYCLE_CLOSURE_ENABLED` | App-side: close each multi-region monitor run at a deadline and count silent regions as failed. Run the `monitor-control` profile first; see [missing-region detection](https://supercheck.io/docs/app/deployment/multi-server#missing-region-detection-optional) | `false` |
| `MISSING_CYCLE_DEADLINE_SECONDS` | App-side: seconds a run waits before silent regions count as failed (two check timeouts are added) | `300` |
| `COMPOSE_PROFILES` | Optional profiles started by `docker compose up`: `https`, `private-agent`, `monitor-control` | - |
| `COMPOSE_FILE` | Compose files to combine, for example `docker-compose.yml:compose.dns01.yml` | `docker-compose.yml` |
| `ACME_DNS_PROVIDER` | DNS provider code for `compose.dns01.yml`; its credentials go in `traefik-dns.env` | - |
| `DB_BIND_ADDR`, `REDIS_BIND_ADDR`, `RUSTFS_BIND_ADDR` | Host address PostgreSQL, Redis and RustFS publish on. Set to a private address only for [Multi-Server](https://supercheck.io/docs/app/deployment/multi-server) workers | `127.0.0.1` |
| `DB_HOST_PORT`, `REDIS_HOST_PORT` | Host port for PostgreSQL and Redis when the default is taken | `5432`, `6379` |
| `WORKER_REPLICAS` | Number of worker containers (worker-side scaling knob) | `1` |
| `RUNNING_CAPACITY` | App-side gate: max concurrent test runs (set equal to `WORKER_REPLICAS`) | `1` |
| `QUEUED_CAPACITY` | App-side gate: max queued test runs before new submissions are rejected | `10` |
| `WORKER_LOCATION` | Worker queue mode (`local` for single-server self-hosted, or any enabled Super Admin location code) | `local` |
| `WORKER_QUEUES` | Comma list of queue consumers: `monitor`, `k6`, `global-playwright`, `global-k6`. Empty starts all for self-hosted, development and private-agent deployments. Cloud production (`SELF_HOSTED=false`, `NODE_ENV=production`, non-agent) requires an explicit list; use `monitor` for a monitoring-only worker | all for self-hosted |

OpenAI GPT-6 Luna is the default. To opt into DeepSeek V4.1 Flash, set `AI_PROVIDER=deepseek`, `AI_MODEL=deepseek-flash`, and `DEEPSEEK_API_KEY`. This sends AI prompts, code, requirement text, and supplied evidence to DeepSeek's hosted API; review data handling and China-related residency requirements first. Provider selection applies to the entire installation.

---

## Scaling Workers

Set the values in `.env`, then apply them:

```dotenv
WORKER_REPLICAS=2
RUNNING_CAPACITY=2
QUEUED_CAPACITY=20
```

```bash
sudo docker compose up -d
```

`RUNNING_CAPACITY` and `QUEUED_CAPACITY` are **App-side** settings. The App uses them to gate how many runs can be in `running` and `queued` states before submissions are throttled or rejected. Keep `RUNNING_CAPACITY` aligned with total worker replicas so the gate matches actual execution throughput.

For single-server deployments, keep `WORKER_LOCATION=local` so one worker processes all regional queues.

---

## Execution Sandbox

Production self-hosted deployments use [gVisor](https://gvisor.dev) for sandboxed test execution. Each Playwright and k6 run executes in an isolated environment.

`setup-k3s.sh` installs k3s and gVisor and verifies the sandbox with a test pod; the installer runs it for you. For a manual installation, see [INSTALL.md](./INSTALL.md).

> **Linux host required:** Docker Engine on a Linux server (Ubuntu 22.04+, Debian 12+) is the only supported target. macOS, Windows, and WSL2 are not supported because the execution sandbox requires the Linux kernel.

---

## Upgrading and backups

Run `sudo bash backup.sh` for a backup and `sudo bash install.sh --upgrade` (with the new release's installer) to upgrade. See [Upgrade](https://supercheck.io/docs/app/deployment/self-hosted#upgrade), [Backups](https://supercheck.io/docs/app/deployment/self-hosted#backups) and, for releases before `1.4.0`, [Upgrading from MinIO](https://supercheck.io/docs/app/deployment/self-hosted#upgrading-from-minio-breaking). With external services (`docker-compose-external.yml`), use the providers' backup tools.

---

## Documentation

Full documentation: **[supercheck.io/docs/app/deployment](https://supercheck.io/docs/app/deployment)**

## AI SRE

Configure an AI provider to use AI SRE. Investigations and Copilot are enabled by default; automatic alert triage is opt-in. Migrations run when the app starts.

Automatic alert triage is off by default, so investigations are manual. Set `SRE_AUTOMATION_ENABLED=true` to opt in (it can incur AI-provider charges), or `SRE_ENABLED=false` to disable AI SRE. After changing `.env`, run `sudo docker compose up -d --force-recreate app worker` with the configured profiles.

### Private Agent Profile

For a colocated agent, register it in **Settings → Organization → Private Agents**, set its `PRIVATE_AGENT_ID` and `PRIVATE_AGENT_TOKEN`, and add `private-agent` to `COMPOSE_PROFILES` (for example `https,private-agent`). Run `sudo docker compose up -d private-agent`. It uses the app's internal origin and an isolated Docker network, with no database, Redis, or S3 credentials.

Stop it with `sudo docker compose stop private-agent` before removing the profile. Recreate it after `.env` changes, preserving `private-agent-state`. Use the standalone file only when the agent runs on another network or connects to Cloud.
