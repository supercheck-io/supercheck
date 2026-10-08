# Install Supercheck

Use this runbook for a new single-server installation. Run commands on the target Linux host, in order. Use the Compose files and scripts from the same checkout.

## Inputs

- Linux server: Ubuntu 22.04+ or Debian 12+, at least 2 vCPU and 4 GB RAM.
- Docker Engine, Docker Compose v2, Git, and sudo access.
- Deployment: HTTP for evaluation, HTTPS for a public server.
- HTTP: a browser-reachable app URL, such as `http://SERVER_IP:3000`.
- HTTPS: app domain, Let's Encrypt email, and status-page domain. Point app and wildcard status-page DNS records to the server; allow inbound ports 80 and 443.

AI, SMTP, OAuth, and external telemetry are optional. Do not request their credentials to complete the base installation.

## 1. Prepare

```bash
docker compose version
git clone https://github.com/supercheck-io/supercheck.git
cd supercheck/deploy/docker
./init-secrets.sh
sudo bash setup-k3s.sh
```

If this checkout or `.env` already exists, inspect it and preserve its settings. Do not use `init-secrets.sh --force`, regenerate secrets, or delete volumes during installation or retries. Keep `.env` values out of logs and responses.

## 2. Configure

Edit `.env`, preserving the generated secrets. Set only the values for your deployment:

```dotenv
# HTTP
NEXT_PUBLIC_APP_URL=http://SERVER_IP:3000
```

```dotenv
# HTTPS
APP_DOMAIN=app.example.com
ACME_EMAIL=admin@example.com
STATUS_PAGE_DOMAIN=example.com
```

For HTTPS, reserve `STATUS_PAGE_DOMAIN` for default status pages. Custom status-page domains can be configured later.

## 3. Start

For HTTP:

```bash
KUBECONFIG_FILE=/etc/rancher/k3s/supercheck-worker.kubeconfig docker compose config -q
KUBECONFIG_FILE=/etc/rancher/k3s/supercheck-worker.kubeconfig docker compose up -d --wait --wait-timeout 300
```

For HTTPS:

```bash
KUBECONFIG_FILE=/etc/rancher/k3s/supercheck-worker.kubeconfig docker compose -f docker-compose-secure.yml config -q
KUBECONFIG_FILE=/etc/rancher/k3s/supercheck-worker.kubeconfig docker compose -f docker-compose-secure.yml up -d --wait --wait-timeout 300
```

The app applies database migrations at startup. No separate migration command is needed.

## 4. Verify

For HTTP:

```bash
docker compose ps
curl --fail --silent --show-error http://localhost:3000/api/health
```

For HTTPS:

```bash
docker compose -f docker-compose-secure.yml ps
curl --fail --silent --show-error https://app.example.com/api/health
```

The app and worker must be healthy. Open the configured app URL, create an account, and run a test. Report the app URL, service health, and whether a test completed. If signup or a test was not performed, report that verification as pending.

If startup fails, inspect `docker compose logs --tail=100 app worker` using the same Compose file. Fix the reported cause before retrying; do not reset data.

## Optional AI SRE

Configure one AI provider in `.env` using the [provider reference](https://supercheck.io/docs/app/deployment/self-hosted#optional-configuration). AI SRE and automatic alert triage are enabled by default. Automatic triage can incur provider charges; set `SRE_AUTOMATION_ENABLED=false` for manual investigations only, or `SRE_ENABLED=false` to disable AI SRE.

Apply `.env` changes with `docker compose up -d --force-recreate app worker`, using the HTTPS Compose file if applicable. Connectors and Private Agents can be added later through [AI SRE Setup](https://supercheck.io/docs/app/admin/ai-sre-setup).

For existing installations, use the [update instructions](https://supercheck.io/docs/app/deployment/self-hosted#updates).
