#!/usr/bin/env bash
#
# Validate the self-hosted Docker deployment assets.
#
# Runs a shell syntax check on every deploy script and interpolates each
# Compose file with safe placeholder values. This catches the classes of bugs
# that only surface at deploy time (broken interpolation, malformed YAML,
# missing required variables) without needing a running Docker daemon.
#
# Usage:
#   ./deploy/docker/validate.sh                      # validate everything
#   ./deploy/docker/validate.sh docker-compose.yml   # validate specific files
#
# Requires: bash, Python 3, and the Docker Compose v2 plugin (`docker compose`).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Placeholder values so required (${VAR:?}) interpolation resolves. These are
# never used to start containers; `docker compose config` only parses.
export DATABASE_URL="postgresql://user:pass@localhost:5432/supercheck"
export REDIS_HOST="localhost"
export REDIS_PORT="6379"
export REDIS_PASSWORD="placeholder-redis-password"
export DB_PASSWORD="placeholder-db-password"
export BETTER_AUTH_SECRET="placeholder-auth-secret"
export S3_ENDPOINT="http://localhost:9000"
export AWS_ACCESS_KEY_ID="placeholder-access-key"
export AWS_SECRET_ACCESS_KEY="placeholder-secret-key"
export AWS_REGION="us-east-1"
export WORKER_LOCATION="us-east"
export PRIVATE_AGENT_ID="placeholder-agent"
export PRIVATE_AGENT_TOKEN="placeholder-token"
export SUPERCHECK_API_URL="http://localhost:3000"
export SECRET_ENCRYPTION_KEY="0000000000000000000000000000000000000000000000000000000000000000"

fail=0

echo "==> Shell syntax check (bash -n)"
for script in ./*.sh; do
  if bash -n "$script"; then
    echo "  ok   $script"
  else
    echo "  FAIL $script"
    fail=1
  fi
done

echo "==> Installer regression checks"
python3 ./install.spec.py

if ! docker compose version >/dev/null 2>&1; then
  echo "ERROR: the Docker Compose v2 plugin ('docker compose') is required" >&2
  exit 1
fi

if [ "$#" -gt 0 ]; then
  files=("$@")
else
  files=(./docker-compose*.yml)
fi

echo "==> Compose interpolation (docker compose config)"
for file in "${files[@]}"; do
  if docker compose -f "$file" config -q >/dev/null 2>&1; then
    echo "  ok   $file"
  else
    echo "  FAIL $file"
    # Re-run without -q so the interpolation error is printed. `|| true` keeps
    # the failure local so every file is still reported.
    docker compose -f "$file" config >/dev/null || true
    fail=1
  fi
done

echo "==> Opt-in DNS-01 override merges onto the main file"
# --no-env-resolution: the credentials file (traefik-dns.env) exists only on servers that opt in.
if APP_DOMAIN=app.example.com ACME_EMAIL=ops@example.com ACME_DNS_PROVIDER=cloudflare \
  docker compose --profile https -f docker-compose.yml -f compose.dns01.yml config --no-env-resolution -q >/dev/null 2>&1; then
  echo "  ok   compose.dns01.yml"
else
  echo "  FAIL compose.dns01.yml"
  fail=1
fi

echo "==> Compose routing regression checks"
python3 ./compose.spec.py

echo "==> install.sh default version matches docker-compose.yml"
compose_ver="$(grep -o 'supercheck/app:[$]{SUPERCHECK_VERSION:-[^}]*}' docker-compose.yml | head -n1 | sed 's/.*:-//; s/}$//' || true)"
installer_ver="$(sed -n 's/^SUPERCHECK_VERSION_DEFAULT="\(.*\)"/\1/p' install.sh | head -n1 || true)"
if [ -n "$compose_ver" ] && [ "$compose_ver" = "$installer_ver" ]; then
  echo "  ok   $installer_ver"
else
  echo "  FAIL install.sh says '$installer_ver', docker-compose.yml says '$compose_ver'"
  fail=1
fi

echo "==> documented downloads and clones use the v$installer_ver tag"
for doc in README.md INSTALL.md ../README.md install.sh setup-k3s.sh ../../docs/content/docs/app/deployment/*.mdx; do
  stale="$(grep -o 'githubusercontent\.com/supercheck-io/supercheck/[^/]*/deploy/docker/[A-Za-z0-9._-]*' "$doc" | grep -v "/supercheck/v$installer_ver/deploy/docker/" || true)"
  clone="$(grep -E 'git clone .*supercheck-io/supercheck' "$doc" | grep -Fv -- "--branch v$installer_ver" || true)"
  if [ -n "$stale" ]; then
    echo "  FAIL $doc fetches ${stale%%$'\n'*}"
    fail=1
  elif [ -n "$clone" ]; then
    echo "  FAIL $doc clones without --branch v$installer_ver"
    fail=1
  else
    echo "  ok   $doc"
  fi
done

if [ "$fail" -ne 0 ]; then
  echo "Deployment validation failed" >&2
  exit 1
fi

echo "All deployment assets validated"
