# Install Supercheck

Use this runbook for a new single-server installation. Run commands on the target Linux host, in order. Use the Compose files and scripts from the same checkout.

## Fast path (recommended)

On Ubuntu 22.04+ or Debian 12+, install **1.3.7-canary.16** (includes RustFS) instead of following the manual steps below. It never prompts when `--yes` is given:

```bash
curl -fsSL https://raw.githubusercontent.com/supercheck-io/supercheck/main/deploy/docker/install.sh -o install.sh
sudo bash install.sh --version 1.3.7-canary.16 --local --yes                                              # HTTP evaluation
sudo bash install.sh --version 1.3.7-canary.16 --domain app.example.com --email admin@example.com --yes   # public HTTPS
```

Use `--dry-run` first to see the plan without changing the host. It exits 0 when installed and healthy, 1 on failure (log: `/var/log/supercheck/install.log`), 2 on bad usage and 3 when installed but the health check reports a problem. Re-running is safe: it keeps `.env` and skips finished steps. Report the printed URL and whether the health check passed. Use the manual runbook below for custom setups; the same Linux host requirements apply.

## Manual installation

The remaining steps are an alternative to the installer. Skip them after a successful guided installation.

### Inputs

- Linux server: Ubuntu 22.04+ or Debian 12+, at least 2 vCPU and 4 GB RAM. The execution sandbox needs the Linux kernel — macOS, Windows, WSL2, and Docker Desktop are not supported.
- Docker Engine, Docker Compose v2.24.4 or newer, Git, `bzip2`, and sudo access.
- Your user must be able to run `docker` without `sudo` (member of the `docker` group), because the Compose commands below are documented without `sudo`.
- Deployment: HTTP for evaluation, HTTPS for a public server.
- HTTP evaluation: use localhost on the server, or an SSH port forward.
- HTTPS: app domain, Let's Encrypt email, and status-page domain. Point app and wildcard status-page DNS records to the server; allow inbound ports 80 and 443.

AI, SMTP, OAuth, and external telemetry are optional. Do not request their credentials to complete the base installation.

## 0. Install Prerequisites

Skip what is already present. On a minimal Ubuntu or Debian host this installs Git, `bzip2`, Docker Engine, and the Compose plugin:

```bash
sudo apt-get update
sudo apt-get install -y git bzip2 ca-certificates curl gnupg

sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL "https://download.docker.com/linux/$(. /etc/os-release && echo "$ID")/gpg" \
  | sudo gpg --dearmor --yes -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
https://download.docker.com/linux/$(. /etc/os-release && echo "$ID") \
$(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io \
  docker-buildx-plugin docker-compose-plugin

# Compose commands are documented without sudo, so the user needs docker access.
sudo usermod -aG docker "$USER"   # takes effect in a new shell (or run: newgrp docker)
```

Group membership only applies to new shells. If you are driving this runbook from a single shell session (for example an agent), run the Docker commands below through `sg docker -c '<command>'` or start a new login shell, then confirm `docker ps` works without `sudo` before continuing.

Docker group membership is root-equivalent on the host, so add only users you trust.

`bzip2` is required by `setup-k3s.sh`, which extracts the gVisor release archive. Minimal Ubuntu cloud images ship `tar`, `gzip`, and `xz` but not `bzip2`.

## 1. Prepare

```bash
docker compose version
git clone --depth 1 https://github.com/supercheck-io/supercheck.git
cd supercheck/deploy/docker
./init-secrets.sh
sudo bash setup-k3s.sh
```

`--depth 1` is enough: updates pull published images, not newer git history. Drop it if you intend to work on the source.

If this checkout or `.env` already exists, inspect it and preserve its settings. Do not use `init-secrets.sh --force`, regenerate secrets, or delete volumes during installation or retries. Keep `.env` values out of logs and responses.

## 2. Configure

Edit `.env`, preserving generated secrets. For a public server:

```dotenv
COMPOSE_PROFILES=https
APP_DOMAIN=app.example.com
ACME_EMAIL=admin@example.com
STATUS_PAGE_DOMAIN=example.com
```

If `NEXT_PUBLIC_APP_URL` was set earlier, update it to the same HTTPS origin. For local HTTP evaluation, leave the profile and domain unset; port 3000 binds to loopback.

## 3. Start

Both modes use the main Compose file:

```bash
KUBECONFIG_FILE=/etc/rancher/k3s/supercheck-worker.kubeconfig docker compose config -q
KUBECONFIG_FILE=/etc/rancher/k3s/supercheck-worker.kubeconfig docker compose up -d --wait --wait-timeout 300
```

The app applies migrations at startup. No separate migration command is needed.

## 4. Verify

For HTTP:

```bash
docker compose ps
curl --fail --silent --show-error http://localhost:3000/api/health
```

For HTTPS:

```bash
docker compose ps
curl --fail --silent --show-error https://app.example.com/api/health
```

The app and worker must be healthy. Open the configured app URL, create an account, and run a test. Report the app URL, service health, and whether a test completed. If signup or a test was not performed, report that verification as pending.

If startup fails, inspect `docker compose logs --tail=100 app worker` with the configured profiles. Fix the reported cause before retrying; do not reset data.

## Optional AI SRE

Configure one AI provider in `.env` using the [provider reference](https://supercheck.io/docs/app/deployment/self-hosted#optional-configuration). AI SRE and automatic alert triage are enabled by default. Automatic triage can incur provider charges; set `SRE_AUTOMATION_ENABLED=false` for manual investigations only, or `SRE_ENABLED=false` to disable AI SRE.

Apply `.env` changes with `docker compose up -d --force-recreate app worker`, with the configured profiles. Connectors and Private Agents can be added later through [AI SRE Setup](https://supercheck.io/docs/app/admin/ai-sre-setup).

For existing installations, use the [update instructions](https://supercheck.io/docs/app/deployment/self-hosted#updates).

## Optional Private Agent

Register it in Organization Admin → Private Agents. Add `private-agent` to `COMPOSE_PROFILES` (for example `https,private-agent`), set `PRIVATE_AGENT_ID` and `PRIVATE_AGENT_TOKEN`, then run `docker compose up -d private-agent`. It uses the internal app origin and receives no database, Redis, or storage credentials. Stop it with `docker compose stop private-agent` before removing its profile; preserve its state volume. Remote or Cloud-connected agents use the [standalone agent setup](https://supercheck.io/docs/app/deployment/private-agent).
