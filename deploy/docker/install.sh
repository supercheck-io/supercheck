#!/usr/bin/env bash
# Supercheck self-hosted installer (single server)
#
# Takes a fresh Ubuntu 22.04+/Debian 12+ server to a running, verified Supercheck.
#
#   curl -fsSL https://raw.githubusercontent.com/supercheck-io/supercheck/main/deploy/docker/install.sh -o install.sh
#   less install.sh                 # read it first
#   sudo bash install.sh            # guided; asks two questions at most
#
#   sudo bash install.sh --local --yes                                   # evaluation on this host, no prompts
#   sudo bash install.sh --domain app.example.com --email you@example.com --yes   # public HTTPS, no prompts
#   sudo bash install.sh --dry-run                                       # show the plan, change nothing
#
# This is a thin wrapper around init-secrets.sh and setup-k3s.sh, which remain the source of
# truth. Safe to re-run: it never regenerates secrets, never overwrites .env and skips finished steps.
#
# Network access: Docker apt repository (only if Docker is missing), GitHub (source, k3s, gVisor)
# and ghcr.io (images). Nothing is sent anywhere else and there is no telemetry.

set -Eeuo pipefail

# Keep in sync with the SUPERCHECK_VERSION default in docker-compose.yml (validate.sh enforces it).
SUPERCHECK_VERSION_DEFAULT="1.3.6"
REPO_URL="https://github.com/supercheck-io/supercheck.git"
MIN_COMPOSE="2.24.4"
KUBECONFIG_FILE="/etc/rancher/k3s/supercheck-worker.kubeconfig"
LOG_FILE="/var/log/supercheck-install.log"
TOTAL_STEPS=7

# ─── Options ────────────────────────────────────────────────────────────────

MODE=""            # local | public
DOMAIN=""
EMAIL=""
STATUS_DOMAIN=""
INSTALL_DIR="/opt/supercheck"
VERSION="$SUPERCHECK_VERSION_DEFAULT"
ASSUME_YES=false
DRY_RUN=false
PREWARM=true

usage() {
  cat <<'EOF'
Usage: sudo bash install.sh [options]

Setup:
  --local                 Evaluate on this server (HTTP on localhost, port 3000)
  --domain <host>         Public HTTPS install for this domain (needs --email)
  --email <address>       Email for Let's Encrypt certificate notices
  --status-domain <host>  Domain for status pages (default: same as --domain)

Behaviour:
  --yes, -y               Never prompt; fail with a clear message if a value is missing
  --dry-run               Run read-only checks and print the plan; change nothing
  --dir <path>            Where to put the source and .env (default: /opt/supercheck)
  --version <x.y.z>       Release to install (default: bundled with this script)
  --no-prewarm            Skip importing the worker image into the sandbox runtime
  --no-color              Disable colour (also honours NO_COLOR)
  --help, -h              Show this help

Examples:
  sudo bash install.sh
  sudo bash install.sh --local --yes
  sudo bash install.sh --domain app.example.com --email ops@example.com --yes
EOF
}

NO_COLOR_FLAG=false
while [[ $# -gt 0 ]]; do
  case "$1" in
    --local) MODE="local" ;;
    --domain) DOMAIN="${2:-}"; MODE="public"; shift ;;
    --email) EMAIL="${2:-}"; shift ;;
    --status-domain) STATUS_DOMAIN="${2:-}"; shift ;;
    --dir) INSTALL_DIR="${2:-}"; shift ;;
    --version) VERSION="${2:-}"; shift ;;
    --yes|-y) ASSUME_YES=true ;;
    --dry-run) DRY_RUN=true ;;
    --no-prewarm) PREWARM=false ;;
    --no-color) NO_COLOR_FLAG=true ;;
    --help|-h) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; echo "Run with --help for usage." >&2; exit 2 ;;
  esac
  shift
done

# ─── Output ─────────────────────────────────────────────────────────────────

IS_TTY=false
[[ -t 1 ]] && IS_TTY=true
if [[ "$IS_TTY" == true && -z "${NO_COLOR:-}" && "${TERM:-}" != "dumb" && "$NO_COLOR_FLAG" != true ]]; then
  BOLD=$'\033[1m'; DIM=$'\033[2m'; RED=$'\033[31m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; CYAN=$'\033[36m'; RESET=$'\033[0m'
else
  BOLD=""; DIM=""; RED=""; GREEN=""; YELLOW=""; CYAN=""; RESET=""
fi

ok()     { printf '  %s✓%s %s\n' "$GREEN" "$RESET" "$*"; }
warn()   { printf '  %s!%s %s\n' "$YELLOW" "$RESET" "$*"; }
note()   { printf '    %s%s%s\n' "$DIM" "$*" "$RESET"; }
fail()   { printf '  %s✗%s %s\n' "$RED" "$RESET" "$*" >&2; }
die()    { fail "$1"; shift; for l in "$@"; do printf '    %s\n' "$l" >&2; done; exit 1; }
header() { printf '\n%s[%s/%s]%s %s%s%s\n' "$CYAN" "$1" "$TOTAL_STEPS" "$RESET" "$BOLD" "$2" "$RESET"; }

SPIN_PID=""
spin_start() {
  [[ "$IS_TTY" == true ]] || return 0
  (
    while :; do
      for c in ⠋ ⠙ ⠹ ⠸ ⠼ ⠴ ⠦ ⠧ ⠇ ⠏; do printf '\r  %s%s%s %s' "$CYAN" "$c" "$RESET" "$1"; sleep 0.1; done
    done
  ) &
  SPIN_PID=$!
}
spin_stop() {
  if [[ -n "$SPIN_PID" ]]; then
    kill "$SPIN_PID" 2>/dev/null || true
    wait "$SPIN_PID" 2>/dev/null || true
    SPIN_PID=""
    printf '\r\033[K'
  fi
}

on_exit() {
  local rc=$?
  spin_stop
  if [[ $rc -ne 0 && "$DRY_RUN" != true && -f "$LOG_FILE" && "${SHOWN_LOG_TAIL:-false}" != true ]]; then
    printf '\n%sInstallation did not finish.%s Re-running is safe and resumes where it stopped.\n' "$RED" "$RESET" >&2
    printf 'Full log: %s\n' "$LOG_FILE" >&2
  fi
}
trap on_exit EXIT
trap 'spin_stop; printf "\n"; fail "Interrupted. Re-run the same command to resume; nothing is left half-written."; exit 130' INT TERM

# Run a step body in a subshell with `set -e` honoured, output going to the log.
# Usage: run_step "label" function [args...]
run_step() {
  local label="$1"; shift
  if [[ "$DRY_RUN" == true ]]; then
    note "would: $label"
    return 0
  fi
  local start=$SECONDS
  if [[ "$IS_TTY" != true ]]; then printf '  → %s\n' "$label"; fi
  spin_start "$label"
  ( set -Eeuo pipefail; "$@" ) >>"$LOG_FILE" 2>&1 &
  local pid=$!
  if wait "$pid"; then
    spin_stop
    ok "$label ${DIM}($((SECONDS - start))s)${RESET}"
  else
    spin_stop
    fail "$label"
    printf '\n    %sLast lines of the log:%s\n' "$DIM" "$RESET" >&2
    tail -n 15 "$LOG_FILE" | sed 's/^/    | /' >&2
    printf '\n    Full log: %s\n' "$LOG_FILE" >&2
    SHOWN_LOG_TAIL=true
    exit 1
  fi
}

# ─── Prompts (only with a terminal; every prompt has a flag) ────────────────

CAN_PROMPT=false
if [[ "$ASSUME_YES" != true && "$IS_TTY" == true ]] && ( : </dev/tty ) 2>/dev/null; then
  CAN_PROMPT=true
fi

ask() { # ask "Question" "default" -> echoes the answer
  local q="$1" def="${2:-}" ans=""
  if [[ -n "$def" ]]; then printf '  %s [%s]: ' "$q" "$def" >/dev/tty; else printf '  %s: ' "$q" >/dev/tty; fi
  read -r ans </dev/tty || true
  echo "${ans:-$def}"
}

confirm() { # confirm "Question" -> 0 if yes (default yes)
  [[ "$CAN_PROMPT" == true ]] || return 0
  local ans
  printf '  %s [Y/n]: ' "$1" >/dev/tty
  read -r ans </dev/tty || true
  [[ -z "$ans" || "$ans" =~ ^[Yy] ]]
}

# ─── Helpers ────────────────────────────────────────────────────────────────

version_ge() { [[ "$(printf '%s\n%s\n' "$2" "$1" | sort -V | head -n1)" == "$2" ]]; }

compose_version() { docker compose version --short 2>/dev/null | sed 's/^v//' || true; }

docker_ready() {
  command -v docker >/dev/null 2>&1 || return 1
  docker info >/dev/null 2>&1 || return 1
  local v; v="$(compose_version)"
  [[ -n "$v" ]] && version_ge "$v" "$MIN_COMPOSE"
}

port_in_use() { ss -ltnH "sport = :$1" 2>/dev/null | grep -q .; }

is_valid_domain() { [[ "$1" =~ ^([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$ ]]; }
is_valid_email() { [[ "$1" =~ ^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$ ]]; }

os_field() { sed -n "s/^$1=//p" /etc/os-release 2>/dev/null | head -n1 | tr -d '"'; }

compose_dir() { echo "${INSTALL_DIR}/deploy/docker"; }

dc() { ( cd "$(compose_dir)" && KUBECONFIG_FILE="$KUBECONFIG_FILE" docker compose "$@" ); }

# ─── Step bodies (run in subshells; failures abort the step) ────────────────

install_prerequisites() {
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -y -qq git bzip2 curl ca-certificates gnupg
  if ! docker_ready; then
    local id codename
    id="$(os_field ID)"
    codename="$(os_field VERSION_CODENAME)"
    install -m 0755 -d /etc/apt/keyrings
    curl -fsSL "https://download.docker.com/linux/${id}/gpg" | gpg --dearmor --yes -o /etc/apt/keyrings/docker.gpg
    chmod a+r /etc/apt/keyrings/docker.gpg
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/${id} ${codename} stable" \
      >/etc/apt/sources.list.d/docker.list
    apt-get update -qq
    apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
    systemctl enable --now docker
    for _ in $(seq 1 30); do docker info >/dev/null 2>&1 && break; sleep 1; done
    docker info >/dev/null
  fi
  if [[ -n "${SUDO_USER:-}" && "$SUDO_USER" != "root" ]]; then
    usermod -aG docker "$SUDO_USER" || true
  fi
}

fetch_source() {
  mkdir -p "$(dirname "$INSTALL_DIR")"
  git clone --quiet --depth 1 --branch "v${VERSION}" "$REPO_URL" "$INSTALL_DIR"
}

generate_config() {
  local dir; dir="$(compose_dir)"
  cd "$dir"
  bash ./init-secrets.sh
  chmod 600 .env
  if [[ "$MODE" == "public" ]]; then
    {
      echo ""
      echo "# ─── Set by install.sh ───"
      echo "COMPOSE_PROFILES=https"
      echo "APP_DOMAIN=${DOMAIN}"
      echo "ACME_EMAIL=${EMAIL}"
      echo "STATUS_PAGE_DOMAIN=${STATUS_DOMAIN:-$DOMAIN}"
    } >>.env
  fi
}

setup_sandbox() {
  cd "$(compose_dir)"
  bash ./setup-k3s.sh
}

pull_images() {
  dc pull --quiet
}

prewarm_worker_image() {
  local image="$1"
  if k3s ctr -n k8s.io images ls -q 2>/dev/null | grep -qxF "$image"; then
    return 0
  fi
  docker save "$image" | k3s ctr -n k8s.io images import -
}

start_stack() {
  dc up -d --wait --wait-timeout 300
}

# ─── Preflight (read-only; runs before anything is changed) ─────────────────

preflight() {
  local problems=0

  if [[ "$(uname -s)" != "Linux" ]]; then
    fail "This host is $(uname -s). Supercheck's execution sandbox needs the Linux kernel."
    note "Use a Linux server or VM (Ubuntu 22.04+ or Debian 12+). macOS, Windows, WSL2 and Docker Desktop are not supported."
    exit 1
  fi
  ok "Linux $(uname -m)"

  case "$(uname -m)" in
    x86_64|aarch64|arm64) ;;
    *) fail "Unsupported architecture $(uname -m) (need x86_64 or arm64)."; problems=1 ;;
  esac

  local os_id os_ver os_name min_ver=""
  os_id="$(os_field ID)"
  os_ver="$(os_field VERSION_ID)"; os_ver="${os_ver:-0}"
  os_name="$(os_field PRETTY_NAME)"
  case "$os_id" in
    ubuntu) min_ver="22.04" ;;
    debian) min_ver="12" ;;
  esac
  case "$os_id" in
    ubuntu|debian)
      if version_ge "$os_ver" "$min_ver"; then ok "$os_name"
      else fail "$os_name is too old (need ${os_id} ${min_ver}+)."; problems=1; fi ;;
    *) fail "${os_name:-Unknown OS} is not supported by this installer (Ubuntu 22.04+ or Debian 12+)."
       note "Other distributions: follow the manual steps in INSTALL.md."
       problems=1 ;;
  esac

  if [[ "$EUID" -ne 0 ]]; then
    fail "Root access is required (installs packages and the gVisor sandbox)."
    note "Run: sudo bash install.sh"
    problems=1
  fi

  local mem_kb cpus disk_gb
  mem_kb="$(awk '/^MemTotal:/ {print $2}' /proc/meminfo 2>/dev/null || echo 0)"
  cpus="$(nproc 2>/dev/null || echo 1)"
  disk_gb="$(df -Pk / | awk 'NR==2 {print int($4/1024/1024)}')"
  if [[ "$mem_kb" -lt 3500000 ]]; then warn "Memory is $((mem_kb / 1024)) MB; 4 GB or more is recommended. Test runs may be slow or fail."; else ok "Memory $((mem_kb / 1024)) MB"; fi
  if [[ "$cpus" -lt 2 ]]; then warn "Only ${cpus} CPU; 2 or more is recommended."; else ok "${cpus} CPUs"; fi
  if [[ "$disk_gb" -lt 10 ]]; then fail "Only ${disk_gb} GB free on /; at least 15 GB is needed (the worker image alone is 3.2 GB)."; problems=1
  elif [[ "$disk_gb" -lt 15 ]]; then warn "${disk_gb} GB free on /; 15 GB or more is recommended."
  else ok "${disk_gb} GB free disk"; fi

  if curl -fsS --max-time 8 -o /dev/null https://ghcr.io/v2/ 2>/dev/null || [[ "$(curl -s --max-time 8 -o /dev/null -w '%{http_code}' https://ghcr.io/v2/ 2>/dev/null)" == "401" ]]; then
    ok "Can reach ghcr.io and GitHub"
  else
    fail "Cannot reach ghcr.io. Check DNS, proxy and firewall egress."; problems=1
  fi

  if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
    local vols
    vols="$(docker volume ls -q 2>/dev/null || true)"
    if grep -Eq '(^|_)minio-data$' <<<"$vols" && ! grep -Eq '(^|_)rustfs-data$' <<<"$vols"; then
      fail "An existing MinIO storage volume was found. Installing now would start with empty storage."
      note "Run migrate-minio-to-rustfs.sh from your current checkout first (see 'Upgrading from MinIO' in the docs)."
      problems=1
    fi
  fi

  [[ "$problems" -eq 0 ]] || exit 1
}

check_ports() {
  local ports=(3000); [[ "$MODE" == "public" ]] && ports=(80 443 3000)
  for p in "${ports[@]}"; do
    if port_in_use "$p"; then
      # A re-run on an existing install legitimately finds our own stack listening.
      if [[ -f "$(compose_dir)/.env" ]]; then warn "Port $p is already in use (assuming the existing Supercheck stack)."
      else fail "Port $p is already in use by another process."; note "Find it with: ss -ltnp 'sport = :$p'"; exit 1; fi
    fi
  done
}

# ─── Main ───────────────────────────────────────────────────────────────────

printf '\n%s  Supercheck self-hosted installer%s\n' "$BOLD" "$RESET"
printf '%s  Version %s · about 10 minutes, mostly image downloads%s\n' "$DIM" "$VERSION" "$RESET"
[[ "$DRY_RUN" == true ]] && printf '%s  Dry run: read-only checks and a plan, nothing is changed.%s\n' "$YELLOW" "$RESET"

# Use the checkout this script lives in, if any; otherwise install into --dir.
SELF_DIR=""
if [[ -n "${BASH_SOURCE[0]:-}" && -f "${BASH_SOURCE[0]}" ]]; then SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; fi
if [[ -n "$SELF_DIR" && -f "$SELF_DIR/docker-compose.yml" && -f "$SELF_DIR/init-secrets.sh" ]]; then
  INSTALL_DIR="$(cd "$SELF_DIR/../.." && pwd)"
fi

if [[ "$DRY_RUN" != true ]]; then
  mkdir -p "$(dirname "$LOG_FILE")" 2>/dev/null || true
  : >>"$LOG_FILE" 2>/dev/null || { LOG_FILE="/tmp/supercheck-install.log"; : >>"$LOG_FILE"; }
  chmod 600 "$LOG_FILE" 2>/dev/null || true
  printf '\n=== install.sh %s (version %s) ===\n' "$(date -u +%FT%TZ)" "$VERSION" >>"$LOG_FILE"
fi

header 1 "Checking this server"
preflight

header 2 "Choosing your setup"
if [[ -z "$MODE" ]]; then
  if [[ "$CAN_PROMPT" == true ]]; then
    printf '\n    1) Try it on this server   %s(HTTP on localhost, fastest)%s\n' "$DIM" "$RESET" >/dev/tty
    printf '    2) Public server           %s(HTTPS with your domain)%s\n\n' "$DIM" "$RESET" >/dev/tty
    choice="$(ask "Choose" "1")"
    [[ "$choice" == "2" ]] && MODE="public" || MODE="local"
  else
    die "No setup chosen and no terminal to ask on." "Pass --local, or --domain <host> --email <address>."
  fi
fi

if [[ "$MODE" == "public" ]]; then
  # With a terminal, re-ask on a typo instead of aborting; flag values are validated strictly below.
  if [[ "$CAN_PROMPT" == true ]]; then
    for _ in 1 2 3; do
      [[ -n "$DOMAIN" ]] && is_valid_domain "$DOMAIN" && break
      [[ -n "$DOMAIN" ]] && fail "'$DOMAIN' is not a valid hostname (use a name like app.example.com, not an IP or URL)."
      DOMAIN="$(ask "Domain for Supercheck (for example app.example.com)")"
    done
    for _ in 1 2 3; do
      [[ -n "$EMAIL" ]] && is_valid_email "$EMAIL" && break
      [[ -n "$EMAIL" ]] && fail "'$EMAIL' is not a valid email address."
      EMAIL="$(ask "Email for Let's Encrypt notices")"
    done
  fi
  [[ -n "$DOMAIN" ]] || die "A domain is required for a public install." "Pass --domain app.example.com"
  is_valid_domain "$DOMAIN" || die "'$DOMAIN' is not a valid hostname." "Use a name like app.example.com, not an IP address or URL."
  [[ -n "$EMAIL" ]] || die "An email address is required for Let's Encrypt." "Pass --email you@example.com"
  is_valid_email "$EMAIL" || die "'$EMAIL' is not a valid email address."
  if [[ -n "$STATUS_DOMAIN" ]]; then is_valid_domain "$STATUS_DOMAIN" || die "'$STATUS_DOMAIN' is not a valid hostname."; fi
  if getent hosts "$DOMAIN" >/dev/null 2>&1; then
    ok "$DOMAIN resolves in DNS"
  else
    warn "$DOMAIN does not resolve yet. Point an A record at this server before certificates can be issued."
    if [[ "$CAN_PROMPT" == true ]]; then confirm "Continue anyway?" || die "Stopped. Create the DNS record, then re-run."; fi
  fi
  ok "Public HTTPS install for ${BOLD}${DOMAIN}${RESET}"
  note "Status pages use ${STATUS_DOMAIN:-$DOMAIN} subdomains, so also add a wildcard record (*.${STATUS_DOMAIN:-$DOMAIN})."
else
  ok "Local evaluation on this server"
fi

check_ports

if [[ -f "$(compose_dir)/.env" ]]; then
  note "An existing .env was found and will be kept; setup choices above are not applied to it."
fi

if [[ "$CAN_PROMPT" == true && "$DRY_RUN" != true ]]; then
  printf '\n  This will install Docker (if missing), k3s with the gVisor sandbox, and Supercheck %s.\n' "$VERSION"
  confirm "Continue?" || die "Cancelled. Nothing was changed."
fi

header 3 "Installing prerequisites"
if [[ "$DRY_RUN" == true ]]; then
  if docker_ready; then note "Docker and Compose >= $MIN_COMPOSE are present"; else note "would: install Docker, Compose, git and bzip2"; fi
elif docker_ready && command -v git >/dev/null 2>&1 && command -v bzip2 >/dev/null 2>&1 && command -v curl >/dev/null 2>&1; then
  ok "Docker $(docker version --format '{{.Server.Version}}' 2>/dev/null), Compose $(compose_version), git, bzip2"
else
  run_step "Installing Docker, Compose, git and bzip2" install_prerequisites
fi

header 4 "Preparing configuration"
if [[ -f "$(compose_dir)/init-secrets.sh" ]]; then
  ok "Source in ${INSTALL_DIR}"
elif [[ -e "$INSTALL_DIR" && -n "$(ls -A "$INSTALL_DIR" 2>/dev/null)" ]]; then
  die "${INSTALL_DIR} exists but is not a Supercheck checkout." "Choose another location with --dir, or remove it."
else
  if [[ "$DRY_RUN" != true ]] && ! git ls-remote --exit-code --tags "$REPO_URL" "refs/tags/v${VERSION}" >/dev/null 2>&1; then
    die "Release v${VERSION} was not found (or GitHub is unreachable)." "Releases: https://github.com/supercheck-io/supercheck/releases" "Omit --version to install the version bundled with this installer."
  fi
  run_step "Downloading Supercheck ${VERSION}" fetch_source
fi
if [[ -f "$(compose_dir)/.env" ]]; then
  ok "Keeping existing .env (secrets are never regenerated)"
else
  run_step "Generating secrets and configuration" generate_config
fi

header 5 "Setting up the isolated test sandbox"
if [[ "$DRY_RUN" != true ]] && command -v k3s >/dev/null 2>&1 && command -v runsc >/dev/null 2>&1 \
  && [[ -x /usr/local/bin/gvisor-bin/gvisor_sentry ]] && [[ -f "$KUBECONFIG_FILE" ]]; then
  ok "k3s and gVisor already installed"
else
  run_step "Installing k3s and gVisor (a few minutes)" setup_sandbox
fi

header 6 "Downloading images"
if [[ "$DRY_RUN" == true ]]; then
  note "would: pull app, worker and storage images, then import the worker image into the sandbox"
else
  run_step "Pulling Supercheck images" pull_images
  worker_image="$(dc config 2>/dev/null | awk '/^ *WORKER_IMAGE:/ {print $2; exit}')"
  last_seg="${worker_image##*/}"
  if [[ "$PREWARM" != true ]]; then
    note "Skipping image warm-up (--no-prewarm); the first test run will download it and may time out."
  elif [[ -z "$worker_image" ]]; then
    warn "Could not determine the worker image; skipping warm-up. The first test run may time out."
  elif [[ "$last_seg" != *:* || "$last_seg" == *:latest ]]; then
    note "Worker image uses a mutable tag, so it is pulled on every run; skipping warm-up."
  else
    run_step "Preparing the test runtime (3 GB, one time)" prewarm_worker_image "$worker_image"
  fi
fi

header 7 "Starting Supercheck"
run_step "Starting services and waiting until healthy" start_stack
HEALTHY=false
if [[ "$DRY_RUN" != true ]]; then
  health=""
  for _ in $(seq 1 30); do
    health="$(curl -fsS --max-time 5 http://127.0.0.1:3000/api/health 2>/dev/null || true)"
    [[ "$health" == '{"status":"ok"'* ]] && break
    sleep 2
  done
  if [[ "$health" == '{"status":"ok"'* ]]; then
    ok "Health check passed"
    HEALTHY=true
  elif [[ -n "$health" ]]; then
    warn "Running, but the health check reports a problem:"
    note "$health"
    note "Inspect with: cd $(compose_dir) && docker compose logs --tail=100 app worker"
  else
    die "The app did not answer on http://127.0.0.1:3000." "Inspect with: cd $(compose_dir) && docker compose logs --tail=100 app worker"
  fi
fi

# ─── Done ───────────────────────────────────────────────────────────────────

if [[ "$DRY_RUN" == true ]]; then
  printf '\n%sDry run finished. Nothing was changed.%s Re-run without --dry-run to install.\n\n' "$GREEN" "$RESET"
  exit 0
fi

if [[ "$MODE" == "public" ]]; then URL="https://${DOMAIN}"; else URL="http://localhost:3000"; fi
if [[ "$HEALTHY" == true ]]; then
  printf '\n%s  Supercheck is ready.%s %s(%ss)%s\n\n' "$GREEN$BOLD" "$RESET" "$DIM" "$SECONDS" "$RESET"
else
  printf '\n%s  Supercheck is running, but the health check reported a problem (see above).%s %s(%ss)%s\n\n' "$YELLOW$BOLD" "$RESET" "$DIM" "$SECONDS" "$RESET"
fi
printf '  Open        %s%s%s\n' "$BOLD" "$URL" "$RESET"
if [[ "$MODE" == "local" ]]; then
  note "Port 3000 listens on this server only. From your laptop: ssh -L 3000:localhost:3000 <user>@<this-server>"
else
  note "The certificate is issued on first visit and can take up to a minute. If the browser warns, wait and reload."
fi
printf '  Next        create your account, then add a test and run it\n'
printf '  Config      %s/.env  %s(keep a private backup; it holds your secrets)%s\n' "$(compose_dir)" "$DIM" "$RESET"
printf '  Logs        cd %s && docker compose logs -f app worker\n' "$(compose_dir)"
printf '  Stop/start  docker compose stop   /   KUBECONFIG_FILE=%s docker compose up -d\n' "$KUBECONFIG_FILE"
printf '  Install log %s\n' "$LOG_FILE"
printf '  Docs        https://supercheck.io/docs/app/deployment/self-hosted\n'
if [[ -n "${SUDO_USER:-}" && "$SUDO_USER" != "root" ]]; then
  note "${SUDO_USER} was added to the docker group; log out and back in to use docker without sudo."
fi
printf '\n'
