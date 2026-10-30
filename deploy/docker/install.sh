#!/usr/bin/env bash
# Supercheck self-hosted installer (single server)
#
# Takes a fresh Ubuntu 22.04+/Debian 12+ server to a running, verified Supercheck.
#
#   curl -fsSL https://raw.githubusercontent.com/supercheck-io/supercheck/v1.4.0/deploy/docker/install.sh -o install.sh
#   less install.sh                 # read it first
#   sudo bash install.sh            # guided; asks only what it cannot detect
#
#   sudo bash install.sh --local --yes                                   # evaluation on this host, no prompts
#   sudo bash install.sh --domain app.example.com --email you@example.com --yes   # public HTTPS, no prompts
#   sudo bash install.sh --dry-run                                       # show the plan, change nothing
#   sudo bash install.sh --upgrade                                       # upgrade an existing install to this release
#
# This is a thin wrapper around init-secrets.sh and setup-k3s.sh, which remain the source of
# truth. Safe to re-run: it preserves secrets and keeps private backups when settings change.
#
# Exit codes: 0 installed and healthy, 1 failed, 2 bad usage, 3 installed but the health check reports a problem.
#
# Network access: Docker apt repository (only if Docker is missing), GitHub (source, k3s, gVisor)
# and ghcr.io (images). Nothing is sent anywhere else and there is no telemetry.

set -Eeuo pipefail

# Keep in sync with the SUPERCHECK_VERSION default in docker-compose.yml (validate.sh enforces it).
SUPERCHECK_VERSION_DEFAULT="1.4.0"
REPO_URL="https://github.com/supercheck-io/supercheck.git"
MIN_COMPOSE="2.24.4"
KUBECONFIG_FILE="/etc/rancher/k3s/supercheck-worker.kubeconfig"
LOG_FILE="/dev/null"
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
DOCKER_GROUP=false
IGNORE_MINIO=false
UPGRADE=false

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
  --upgrade               Upgrade an existing install to --version (default: this script's release):
                          dumps the database, updates the files, re-runs sandbox setup and restarts
  --no-prewarm            Skip importing the worker image into the sandbox runtime
  --docker-group          Add the invoking sudo user to the docker group (root-equivalent access)
  --ignore-minio          Do not stop for a leftover MinIO volume (start with empty storage)
  --no-color              Disable colour (also honours NO_COLOR)
  --help, -h              Show this help

Examples:
  sudo bash install.sh
  sudo bash install.sh --local --yes
  sudo bash install.sh --domain app.example.com --email ops@example.com --yes
  sudo bash install.sh --upgrade --version 1.4.0
EOF
}

NO_COLOR_FLAG=false
VERSION_SET=false
need_val() {
  if [[ $# -lt 2 || -z "$2" || "$2" == -* ]]; then
    echo "Option $1 needs a value. Run with --help for usage." >&2
    exit 2
  fi
}
while [[ $# -gt 0 ]]; do
  case "$1" in
    --local) MODE="local" ;;
    --domain) need_val "$@"; DOMAIN="$2"; MODE="public"; shift ;;
    --email) need_val "$@"; EMAIL="$2"; shift ;;
    --status-domain) need_val "$@"; STATUS_DOMAIN="$2"; shift ;;
    --dir) need_val "$@"; INSTALL_DIR="$2"; shift ;;
    --version) need_val "$@"; VERSION="${2#v}"; VERSION_SET=true; shift ;;
    --yes|-y) ASSUME_YES=true ;;
    --dry-run) DRY_RUN=true ;;
    --no-prewarm) PREWARM=false ;;
    --docker-group) DOCKER_GROUP=true ;;
    --ignore-minio) IGNORE_MINIO=true ;;
    --upgrade) UPGRADE=true ;;
    --no-color) NO_COLOR_FLAG=true ;;
    --help|-h) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; echo "Run with --help for usage." >&2; exit 2 ;;
  esac
  shift
done
if [[ "$UPGRADE" == true ]]; then
  if [[ -n "$MODE$EMAIL$STATUS_DOMAIN" ]]; then
    echo "--upgrade keeps the existing configuration; do not combine it with --local, --domain, --email or --status-domain." >&2; exit 2
  fi
  VERSION_SET=true # the target release is always explicit, even when it is this script's default
fi
if [[ "$VERSION_SET" == true && ! "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+([.-][0-9A-Za-z.-]+)?$ ]]; then
  echo "'$VERSION' is not a release number like 1.3.6." >&2; exit 2
fi
if [[ "$INSTALL_DIR" != /* ]]; then echo "--dir must be an absolute path." >&2; exit 2; fi
while [[ "$INSTALL_DIR" == */ && "$INSTALL_DIR" != "/" ]]; do INSTALL_DIR="${INSTALL_DIR%/}"; done
if [[ "$INSTALL_DIR" == "/" ]]; then echo "--dir cannot be /." >&2; exit 2; fi

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
die()    { fail "$1"; shift; for l in "$@"; do printf '    %s\n' "$l" >&2; done; SHOWN_LOG_TAIL=true; exit 1; }
header() { printf '\n%s[%s/%s]%s %s%s%s\n' "$CYAN" "$1" "$TOTAL_STEPS" "$RESET" "$BOLD" "$2" "$RESET"; }

SPIN_PID=""
STEP_PID=""
ATTEMPTED=false

kill_tree() { # kill_tree <pid>: TERM the process and all of its descendants
  local pid="$1" child
  for child in $(pgrep -P "$pid" 2>/dev/null || true); do kill_tree "$child"; done
  kill -TERM "$pid" 2>/dev/null || true
}
stop_step() {
  if [[ -n "$STEP_PID" ]]; then
    kill_tree "$STEP_PID"
    wait "$STEP_PID" 2>/dev/null || true
    STEP_PID=""
  fi
}

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
  stop_step
  # Only after changes began, and only for a real failure (1): usage errors (2), an unhealthy
  # but running stack (3) and interrupts (130) print their own message.
  if [[ $rc -ne 0 && $rc -ne 2 && $rc -ne 3 && $rc -ne 130 && "$ATTEMPTED" == true && "$DRY_RUN" != true && -f "$LOG_FILE" && "${SHOWN_LOG_TAIL:-false}" != true ]]; then
    printf '\n%sInstallation did not finish.%s Re-running is safe and resumes where it stopped.\n' "$RED" "$RESET" >&2
    printf 'Full log: %s\n' "$LOG_FILE" >&2
  fi
}
trap on_exit EXIT
trap 'spin_stop; stop_step; printf "\n"; fail "Interrupted. The running step was stopped; re-run the same command to resume."; exit 130' INT TERM

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
  STEP_PID=$!
  if wait "$STEP_PID"; then
    STEP_PID=""
    spin_stop
    ok "$label ${DIM}($((SECONDS - start))s)${RESET}"
  else
    STEP_PID=""
    spin_stop
    if [[ "${SOFT_STEP:-false}" == true ]]; then
      warn "$label did not complete (continuing; details in $LOG_FILE)"
      return 0
    fi
    fail "$label"
    printf '\n    %sLast lines of the log:%s\n' "$DIM" "$RESET" >&2
    tail -n 15 "$LOG_FILE" | sed 's/^/    | /' >&2
    printf '\n    Full log: %s\n' "$LOG_FILE" >&2
    SHOWN_LOG_TAIL=true
    exit 1
  fi
}

# ─── Prompts (only with a terminal; every prompt has a flag) ────────────────

# Prompts read /dev/tty, so piping stdout (| tee) must not disable them.
tty_readable() { ( : </dev/tty ) 2>/dev/null; }
detect_can_prompt() {
  CAN_PROMPT=false
  if [[ "$ASSUME_YES" != true ]] && tty_readable; then CAN_PROMPT=true; fi
}
detect_can_prompt

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

# Docker's data dir is where images and volumes land; fall back to / and use the nearest existing parent.
docker_data_path() {
  local d
  d="$(docker info -f '{{.DockerRootDir}}' 2>/dev/null || true)"
  d="${d:-/}"
  while [[ ! -e "$d" && "$d" != "/" ]]; do d="$(dirname "$d")"; done
  echo "$d"
}

resolve_a() { getent ahostsv4 "$1" 2>/dev/null | awk '{print $1}' | sort -u || true; }
public_ip() { curl -fsS --max-time 5 https://api.ipify.org 2>/dev/null; }

check_dns_target() { # warn when the domain's A record is not this server
  local ips mine
  ips="$(resolve_a "$1")"
  mine="$(public_ip)" || mine=""
  if [[ -z "$mine" || -z "$ips" ]]; then note "Could not compare $1 with this server's public IP; skipping that check."
  elif grep -Fxq "$mine" <<<"$ips"; then ok "$1 points to this server ($mine)"
  else warn "$1 resolves to $(tr '\n' ' ' <<<"$ips")but this server is $mine. Let's Encrypt will fail until the A record matches, unless a proxy (such as Cloudflare) forwards ACME requests here."; fi
}

ufw_allows_port() { # $1 = port; reads `ufw status verbose` on stdin. ufw is first-match, then the default.
  awk -v p="$1" '
    function covers(to,    n, parts, proto, i, part, r) {
      sub(/ on .*/, "", to); sub(/[[:space:]]+$/, "", to)
      if (to ~ /^Anywhere/) return 1
      proto = ""; if (match(to, /\/(tcp|udp)$/)) proto = substr(to, RSTART + 1)
      n = split(to, parts, ",")
      for (i = 1; i <= n; i++) {
        part = parts[i]
        if (match(part, /\/(tcp|udp)$/)) { if (substr(part, RSTART + 1) == "udp") continue; sub(/\/tcp$/, "", part) }
        else if (proto == "udp") continue
        if (part == p) return 1
        if (split(part, r, ":") == 2 && p + 0 >= r[1] + 0 && p + 0 <= r[2] + 0) return 1
      }
      return 0
    }
    /^Default:/ { def = ($0 ~ /allow \(incoming\)/) }
    !decided && match($0, / (ALLOW|DENY|REJECT|LIMIT)( IN)?[[:space:]]/) {
      # ACME and HTTPS need inbound TCP from anywhere: outbound/forwarded and source-restricted rules do not decide.
      # IPv4 only: an IPv6 rule says nothing about the A record that ACME validation connects to.
      if ($0 ~ / (ALLOW|DENY|REJECT|LIMIT) (OUT|FWD)/ || $0 ~ /\(v6\)/) next
      to = substr($0, 1, RSTART - 1); act = substr($0, RSTART + 1, RLENGTH - 1)
      from = substr($0, RSTART + RLENGTH); sub(/[[:space:]]*#.*/, "", from); sub(/^[[:space:]]+/, "", from)
      if (from !~ /^Anywhere/ || !covers(to)) next
      decided = 1; allowed = (act ~ /^(ALLOW|LIMIT)/)
    }
    END { exit !(decided ? allowed : def) }'
}

check_ufw() { # warn when an active ufw would block ACME and HTTPS
  command -v ufw >/dev/null 2>&1 || return 0
  local st; st="$(ufw status verbose 2>/dev/null || true)"
  grep -q '^Status: active' <<<"$st" || return 0
  # Expand app profiles ("Nginx Full") in place so rule order is kept. A stale profile or an IPv6
  # destination fails `ufw app info`; that must not abort the installer (set -e).
  local expanded="" line name info ports
  while IFS= read -r line; do
    name="$(awk '/ (ALLOW|DENY|REJECT|LIMIT)/ { to = $0; sub(/[[:space:]]+(ALLOW|DENY|REJECT|LIMIT).*/, "", to); sub(/ on .*/, "", to); sub(/[[:space:]]*\(v6\)$/, "", to); if (to ~ /^[A-Za-z][A-Za-z0-9 ._-]*$/ && to !~ /^Anywhere/) print to }' <<<"$line")"
    if [[ -n "$name" ]]; then
      info="$(ufw app info "$name" 2>/dev/null || true)"
      ports="$(awk '/^Ports?:/ { f = 1; sub(/^Ports?:[[:space:]]*/, "") } f && NF { gsub(/[[:space:]]/, ""); printf "%s%s", sep, $0; sep = "," }' <<<"$info")"
      [[ -n "$ports" ]] && line="${ports}${line#*"$name"}"
    fi
    expanded+="$line"$'\n'
  done <<<"$st"
  local p
  for p in 80 443; do
    ufw_allows_port "$p" <<<"$expanded" || warn "ufw is active and port $p is not allowed. Docker-published ports usually bypass ufw, so this may be harmless; if HTTPS fails, run: sudo ufw allow $p/tcp"
  done
}

check_public_https() { # cert issuance can lag, so this only warns
  if curl -fsS --max-time 10 -o /dev/null "https://$1/api/health" 2>/dev/null; then ok "HTTPS is answering on https://$1"
  else warn "https://$1 is not answering over HTTPS yet. Certificate issuance can take a few minutes; check DNS, ports 80/443, and: cd $(compose_dir) && sudo docker compose logs --tail=50 traefik"; fi
}

port_in_use() { ss -ltnH "sport = :$1" 2>/dev/null | grep -q .; }

is_valid_domain() { [[ "$1" =~ ^([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+([a-zA-Z]{2,}|[xX][nN]--[a-zA-Z0-9-]+)$ ]]; }
# Conservative on purpose: the value is written to .env, where $ # quotes and spaces would be misread.
is_valid_email() { [[ "$1" =~ ^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$ ]]; }

os_field() { sed -n "s/^$1=//p" /etc/os-release 2>/dev/null | head -n1 | tr -d '"'; }

COMPOSE_DIR=""
compose_dir() { echo "${COMPOSE_DIR:-${INSTALL_DIR}/deploy/docker}"; }

env_get() { sed -n "s/^$1=//p" "$(compose_dir)/.env" 2>/dev/null | tail -n1 | tr -d "\"'"; }

# Compose names volumes <project>_<volume>; the project is COMPOSE_PROJECT_NAME (shell, then .env) or "supercheck".
project_name() {
  local p="${COMPOSE_PROJECT_NAME:-}"
  [[ -n "$p" ]] || p="$(env_get COMPOSE_PROJECT_NAME)"
  p="${p:-supercheck}"
  printf '%s\n' "$p" | tr '[:upper:]' '[:lower:]'
}

# True when the directory has anything besides a bare .git (an interrupted clone leaves only that).
dir_has_content() {
  local f
  for f in "$1"/* "$1"/.[!.]* "$1"/..?*; do
    [[ -e "$f" || -L "$f" ]] || continue
    [[ "$(basename "$f")" == ".git" ]] && continue
    return 0
  done
  return 1
}

# True when the existing .env actually enables HTTPS (commented template lines do not count).
env_has_https() { [[ "$(env_get COMPOSE_PROFILES)" == *https* && -n "$(env_get APP_DOMAIN)" ]]; }

dc() { ( cd "$(compose_dir)" && KUBECONFIG_FILE="$KUBECONFIG_FILE" docker compose "$@" ); }

# Release of an existing install: the pinned SUPERCHECK_VERSION, else the checkout's Compose default.
installed_version() {
  local v
  v="$(env_get SUPERCHECK_VERSION || true)"
  [[ -n "$v" ]] || v="$(grep -o 'supercheck/app:[$]{SUPERCHECK_VERSION:-[^}]*}' "$(compose_dir)/docker-compose.yml" 2>/dev/null | head -n1 | sed 's/.*:-//; s/}$//' || true)"
  printf '%s\n' "$v"
}

# The installer clones into <dir>; deploy files live in <dir>/deploy/docker.
UPGRADE_TOP=""
ugit() { git -c safe.directory="$UPGRADE_TOP" -C "$UPGRADE_TOP" "$@"; }

# ─── Step bodies (run in subshells; failures abort the step) ────────────────

install_prerequisites() {
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -y -qq git bzip2 curl ca-certificates gnupg iproute2
  if command -v docker >/dev/null 2>&1 && ! docker info >/dev/null 2>&1; then
    systemctl enable --now docker 2>/dev/null || true
    for _ in $(seq 1 30); do docker info >/dev/null 2>&1 && break; sleep 1; done
  fi
  if ! docker_ready; then
    local id codename
    id="$(os_field ID)"
    codename="$(os_field VERSION_CODENAME)"
    install -m 0755 -d /etc/apt/keyrings
    local key
    key="$(mktemp)"
    curl -fsSL "https://download.docker.com/linux/${id}/gpg" -o "$key"
    # Docker's published apt signing key fingerprint; refuse anything else.
    if ! gpg --show-keys --with-colons "$key" | grep -q '^fpr:::::::::9DC858229FC7DD38854AE2D88D81803C0EBFCD88:'; then
      rm -f "$key"
      echo "Docker apt key fingerprint did not match the expected value; refusing to install it." >&2
      exit 1
    fi
    gpg --dearmor --yes -o /etc/apt/keyrings/docker.gpg < "$key"
    rm -f "$key"
    chmod a+r /etc/apt/keyrings/docker.gpg
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/${id} ${codename} stable" \
      >/etc/apt/sources.list.d/docker.list
    apt-get update -qq
    if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
      # Docker is already installed and running: only add or upgrade the Compose plugin.
      apt-get install -y -qq docker-compose-plugin
    else
      apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
    fi
    systemctl enable --now docker
    for _ in $(seq 1 30); do docker info >/dev/null 2>&1 && break; sleep 1; done
    docker info >/dev/null
  fi
  if [[ "$DOCKER_GROUP" == true && -n "${SUDO_USER:-}" && "$SUDO_USER" != "root" ]]; then
    usermod -aG docker "$SUDO_USER"
  fi
}

fetch_source() {
  local tmp
  mkdir -p "$(dirname "$INSTALL_DIR")"
  # An empty or .git-only directory is the leftover of an interrupted run; stale temp dirs too.
  rm -rf "${INSTALL_DIR}".tmp.*
  # Remove only our own leftover: empty, or a bare `git init` with no commits and no refs.
  if [[ -d "$INSTALL_DIR" ]] && ! dir_has_content "$INSTALL_DIR" \
    && ! git -C "$INSTALL_DIR" rev-parse -q --verify HEAD >/dev/null 2>&1 \
    && [[ -z "$(git -C "$INSTALL_DIR" for-each-ref 2>/dev/null)" ]] \
    && [[ "$(git -C "$INSTALL_DIR" remote get-url origin 2>/dev/null || echo "$REPO_URL")" == "$REPO_URL" ]]; then
    rm -rf "$INSTALL_DIR"
  fi
  # Build in a temp sibling and rename on success, so an interruption never leaves a
  # half-populated install directory that a re-run would refuse.
  tmp="$(mktemp -d "${INSTALL_DIR}.tmp.XXXXXX")"
  trap 'rm -rf "$tmp"' EXIT
  # Fetch the tag ref explicitly: `git clone --branch` would prefer a same-named branch.
  git -C "$tmp" init --quiet
  git -C "$tmp" remote add origin "$REPO_URL"
  git -C "$tmp" fetch --quiet --depth 1 origin "refs/tags/v${VERSION}:refs/tags/v${VERSION}"
  git -C "$tmp" checkout --quiet --detach "refs/tags/v${VERSION}"
  chmod 755 "$tmp"
  mv -T "$tmp" "$INSTALL_DIR"
  trap - EXIT
}

public_block() {
  echo ""
  echo "# ─── Set by install.sh ───"
  echo "COMPOSE_PROFILES=$1"
  echo "APP_DOMAIN=${DOMAIN}"
  echo "ACME_EMAIL=${EMAIL}"
  echo "STATUS_PAGE_DOMAIN=${2:-${STATUS_DOMAIN:-$DOMAIN}}"
}

generate_config() {
  cd "$(compose_dir)"
  # init-secrets.sh writes to .env.new (ENV_FILE override) and the finished file is moved into
  # place, so an interruption can never leave a partial .env that a re-run would keep.
  rm -f .env.new
  ( umask 077
    SUPERCHECK_ENV_FILE="$PWD/.env.new" bash ./init-secrets.sh
    [[ -s .env.new ]]
    if [[ "$MODE" == "public" ]]; then public_block "https" >>.env.new; fi
    chmod 600 .env.new
    mv .env.new .env
  )
}

# Turn an existing .env into a public HTTPS configuration without touching its secrets.
apply_public_config() {
  cd "$(compose_dir)"
  local profiles previous_domain
  previous_domain="$(env_get APP_DOMAIN)"
  profiles="$(env_get COMPOSE_PROFILES)"
  # Keep the operator's status-page domain unless --status-domain was given.
  local status
  status="${STATUS_DOMAIN:-$(env_get STATUS_PAGE_DOMAIN)}"
  status="${status:-$DOMAIN}"
  if [[ -z "$profiles" ]]; then profiles="https"; elif [[ "$profiles" != *https* ]]; then profiles="${profiles},https"; fi
  ( umask 077
    rm -f .env.new
    install -m 600 .env "$(mktemp ".env.bak-$(date +%Y%m%d%H%M%S).XXXXXX")"
    # Normalize known local and previous app origins, preserving custom origins.
    grep -v -E '^(COMPOSE_PROFILES|APP_DOMAIN|ACME_EMAIL|STATUS_PAGE_DOMAIN)=' .env >.env.new || [[ $? -eq 1 ]]
    rm -f .env.filtered
    local key value
    for key in NEXT_PUBLIC_APP_URL APP_URL BETTER_AUTH_URL; do
      value="$(env_get "$key")"
      if [[ "$value" =~ ^https?://(localhost|127(\.[0-9]+){1,3}|\[::1\])(:[0-9]+)?/?$ ]] || \
        { [[ -n "$previous_domain" ]] && [[ "$value" == "https://${previous_domain}" || "$value" == "https://${previous_domain}/" || "$value" == "http://${previous_domain}" || "$value" == "http://${previous_domain}/" ]]; }; then
        sed "/^${key}=/d" .env.new >.env.filtered
        mv .env.filtered .env.new
        printf '%s=https://%s\n' "$key" "$DOMAIN" >>.env.new
      fi
    done
    public_block "$profiles" "$status" >>.env.new
    # Refuse to replace a good .env with a truncated one: a known secret must have survived.
    grep -q '^BETTER_AUTH_SECRET=' .env.new || { echo "refusing to write .env: BETTER_AUTH_SECRET missing from the new file" >&2; exit 1; }
    chmod 600 .env.new
    mv .env.new .env
  )
}

# Explicitly starting fresh changes only the retired bundled storage endpoint and missing keys.
apply_fresh_storage_config() {
  [[ "$IGNORE_MINIO" == true && "$(env_get S3_ENDPOINT)" == "http://minio:9000" ]] || return 0
  cd "$(compose_dir)"
  ( umask 077
    install -m 600 .env "$(mktemp ".env.bak-$(date +%Y%m%d%H%M%S).XXXXXX")"
    rm -f .env.new .env.filtered
    grep -v '^S3_ENDPOINT=' .env >.env.new || [[ $? -eq 1 ]]
    printf 'S3_ENDPOINT=http://rustfs:9000\n' >>.env.new
    local key value
    for key in AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY; do
      if [[ -z "$(env_get "$key")" ]]; then
        value="$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')"
        sed "/^${key}=/d" .env.new >.env.filtered
        mv .env.filtered .env.new
        printf '%s=%s\n' "$key" "$value" >>.env.new
      fi
    done
    grep -q '^BETTER_AUTH_SECRET=' .env.new
    chmod 600 .env.new
    mv .env.new .env
  )
}

# Save an explicit standalone image choice so later Compose commands use it too.
persist_version() {
  [[ "$USING_THIS_CHECKOUT" != true ]] || return 0
  [[ "$VERSION_SET" == true || "${SOURCE_FETCHED:-false}" == true ]] || return 0
  local selected="${SUPERCHECK_VERSION:-$VERSION}"
  [[ "$VERSION_SET" != true ]] || selected="$VERSION"
  if [[ "$VERSION_SET" != true && -n "$(env_get SUPERCHECK_VERSION)" ]]; then return 0; fi
  [[ "$(env_get SUPERCHECK_VERSION)" != "$selected" ]] || return 0
  cd "$(compose_dir)"
  ( umask 077
    install -m 600 .env "$(mktemp ".env.bak-$(date +%Y%m%d%H%M%S).XXXXXX")"
    rm -f .env.new
    grep -v '^SUPERCHECK_VERSION=' .env >.env.new || [[ $? -eq 1 ]]
    printf 'SUPERCHECK_VERSION=%s\n' "$selected" >>.env.new
    grep -q '^BETTER_AUTH_SECRET=' .env.new
    chmod 600 .env.new
    mv .env.new .env
  )
}

check_release() {
  [[ "$DRY_RUN" != true && "$USING_THIS_CHECKOUT" != true ]] || return 0
  curl -fsSL --max-time 30 -o /dev/null "https://raw.githubusercontent.com/supercheck-io/supercheck/refs/tags/v${VERSION}/deploy/docker/docker-compose.yml" || \
    die "Release v${VERSION} was not found (or GitHub is unreachable)." "Releases: https://github.com/supercheck-io/supercheck/releases"
}

install_lookup_tools() {
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -y -qq curl ca-certificates
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
  local have
  have="$(k3s ctr -n k8s.io images ls -q 2>/dev/null || true)"
  if grep -qxF "$image" <<<"$have"; then
    return 0
  fi
  local platform
  platform="linux/$(dpkg --print-architecture)"
  # Prefer a single-platform archive (a containerd image store can emit an index with missing
  # blobs); with pipefail a truncated or failed import falls back to the plain archive.
  if ! { docker save --platform "$platform" "$image" | k3s ctr -n k8s.io images import --all-platforms -; }; then
    docker save "$image" | k3s ctr -n k8s.io images import --all-platforms -
  fi
}

# Each release's app and worker images take several GB in Docker and the sandbox; drop the old ones.
remove_release_images() {
  local repo="ghcr.io/supercheck-io/supercheck"
  k3s ctr -n k8s.io images rm "$repo/worker:$1" >/dev/null 2>&1 || true
  docker image rm "$repo/app:$1" "$repo/worker:$1" >/dev/null 2>&1 || true
}

start_stack() {
  dc up -d --wait --wait-timeout 300
}

# pg_dump is consistent while the app runs; written under a temporary name so a failure leaves no
# file that looks like a good backup.
backup_database() {
  local file="$1"
  dc up -d --wait --wait-timeout 120 postgres
  ( umask 077
    [[ ! -L "$(dirname "$file")" ]]
    install -d -m 700 "$(dirname "$file")"
    chmod 700 "$(dirname "$file")"
    dc exec -T postgres sh -c "pg_dump -Fc -U \"\$POSTGRES_USER\" \"\$POSTGRES_DB\"" >"$file.partial"
    [[ -s "$file.partial" ]]
    mv "$file.partial" "$file"
  )
}

# Check out the release tag in the existing clone, the same way fetch_source does for a new one.
upgrade_source() {
  cd "$(compose_dir)"
  ( umask 077; install -m 600 .env "$(mktemp ".env.bak-$(date +%Y%m%d%H%M%S).XXXXXX")" )
  ugit fetch --quiet --depth 1 origin "refs/tags/v${VERSION}:refs/tags/v${VERSION}"
  ugit checkout --quiet --detach "refs/tags/v${VERSION}"
}

# Read-only checks for --upgrade; they run before anything changes, so --dry-run reports them.
upgrade_preflight() {
  [[ -f "$(compose_dir)/.env" ]] || die "No existing installation was found in $(compose_dir)." \
    "Install first with: sudo bash install.sh   (or pass the install location with --dir)"
  local key
  for key in DB_PASSWORD REDIS_PASSWORD BETTER_AUTH_SECRET; do
    grep -Eq "^${key}=[^[:space:]]" "$(compose_dir)/.env" || die "$key is missing from $(compose_dir)/.env; this release will not start without it." \
      "Existing install? Restore the .env you installed with; never generate a new one (new installs run ./init-secrets.sh)."
  done
  command -v git >/dev/null 2>&1 || die "git is required to upgrade. Install it with: sudo apt-get install -y git"
  UPGRADE_TOP="$(cd "$(compose_dir)/../.." && pwd -P)"
  # Root runs git here, so the checkout must not be controlled by another user (hooks, config).
  if [[ -e "$UPGRADE_TOP/.git" && "$(stat -c %u "$UPGRADE_TOP/.git" 2>/dev/null || stat -f %u "$UPGRADE_TOP/.git")" != "$(id -u)" ]]; then
    die "$UPGRADE_TOP/.git is owned by another user, so the upgrade will not run git there as root." \
      "Use an installer-managed checkout, or follow the manual update steps as the checkout's owner."
  fi
  [[ "$(ugit rev-parse --show-toplevel 2>/dev/null || true)" == "$UPGRADE_TOP" ]] || die "$UPGRADE_TOP is not a git checkout, so it cannot be upgraded automatically." \
    "Follow the manual update steps: https://supercheck.io/docs/app/deployment/self-hosted#manual-update"
  local dirty
  dirty="$(ugit status --porcelain --untracked-files=no 2>/dev/null || true)"
  if [[ -n "$dirty" ]]; then
    die "Tracked files in $UPGRADE_TOP were changed locally; upgrading would overwrite them:" \
      "$(cut -c4- <<<"$dirty" | head -n 10 | tr '\n' ' ')" \
      "Move the change into .env (for example DB_BIND_ADDR, or COMPOSE_FILE with your own override file)," \
      "then restore the file with: sudo git -C $UPGRADE_TOP checkout -- <file>   and re-run."
  fi
  local current
  current="$(installed_version)"
  UPGRADE_FROM="$current"
  if [[ -n "$current" ]] && ! version_ge "$VERSION" "$current"; then
    die "This server runs ${current}; downgrading to ${VERSION} is not supported (database migrations only move forward)." \
      "To go back, restore a backup taken on ${VERSION} (sudo bash backup.sh --restore <dir>)."
  fi
  if [[ "$current" == "$VERSION" ]]; then ok "Already on ${VERSION}; files, sandbox and images will be re-applied"
  else ok "Upgrade ${current:-unknown version} → ${BOLD}${VERSION}${RESET}"; fi
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

  local mem_kb cpus disk_gb disk_path
  disk_path="$(docker_data_path)"
  mem_kb="$(awk '/^MemTotal:/ {print $2}' /proc/meminfo 2>/dev/null || echo 0)"
  cpus="$(nproc 2>/dev/null || echo 1)"
  disk_gb="$(df -Pk "$disk_path" | awk 'NR==2 {print int($4/1024/1024)}')"
  if [[ "$mem_kb" -lt 3500000 ]]; then warn "Memory is $((mem_kb / 1024)) MB; 4 GB or more is recommended. Test runs may be slow or fail."; else ok "Memory $((mem_kb / 1024)) MB"; fi
  if [[ "$cpus" -lt 2 ]]; then warn "Only ${cpus} CPU; 2 or more is recommended."; else ok "${cpus} CPUs"; fi
  if [[ "$disk_gb" -lt 10 ]]; then fail "Only ${disk_gb} GB free on ${disk_path}; at least 10 GB is needed and 15 GB is recommended (the worker image alone is 3.2 GB)."; problems=1
  elif [[ "$disk_gb" -lt 15 ]]; then warn "${disk_gb} GB free on ${disk_path}; 15 GB or more is recommended."
  else ok "${disk_gb} GB free disk"; fi

  if command -v curl >/dev/null 2>&1; then
    local host unreachable=""
    for host in github.com ghcr.io get.k3s.io download.docker.com; do
      curl -s --max-time 8 -o /dev/null "https://${host}" 2>/dev/null || unreachable="${unreachable} ${host}"
    done
    if [[ -z "$unreachable" ]]; then ok "Can reach GitHub, ghcr.io, k3s and Docker downloads"
    else fail "Cannot reach:${unreachable}. Check DNS, proxy and firewall egress."; problems=1; fi
  else
    note "curl is not installed yet; network checks run after prerequisites."
  fi

  if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
    local vols
    vols="$(docker volume ls -q 2>/dev/null || true)"
    local proj
    proj="$(project_name)"
    if [[ "$IGNORE_MINIO" != true ]] && grep -Fxq "${proj}_minio-data" <<<"$vols" && { [[ "$(env_get S3_ENDPOINT)" != "http://rustfs:9000" ]] || ! grep -Fxq "${proj}_rustfs-data" <<<"$vols"; }; then
      fail "An existing Supercheck MinIO storage volume was found. Installing now would start with empty storage."
      note "Run migrate-minio-to-rustfs.sh from your current checkout first: https://supercheck.io/docs/app/deployment/self-hosted#upgrading-from-minio-breaking"
      note "Starting fresh on purpose? Re-run with --ignore-minio."
      problems=1
    fi
    if [[ "$IGNORE_MINIO" == true ]]; then
      local minio_containers
      if ! minio_containers="$(docker ps -aq --filter "label=com.docker.compose.project=$proj" --filter label=com.docker.compose.service=minio)"; then
        fail "Cannot verify whether the project's old MinIO container remains. Check Docker and re-run."
        problems=1
      elif [[ -n "$minio_containers" ]]; then
        fail "Remove the old project's MinIO container before using --ignore-minio; keep its volume for recovery."
        problems=1
      fi
    fi
    if [[ ! -f "$(compose_dir)/.env" ]] && grep -Fxq -e "${proj}_postgres-data" -e "${proj}_rustfs-data" <<<"$vols"; then
      fail "Data from an earlier Supercheck install exists, but no .env was found to unlock it."
      note "A new .env would generate new passwords that cannot open the existing database."
      note "Restore your original .env into $(compose_dir), or remove the old volumes first if you are starting over:"
      note "  docker volume ls | grep supercheck"
      problems=1
    fi
  fi

  [[ "$problems" -eq 0 ]] || exit 1
}

check_ports() {
  # Compose also binds PostgreSQL and Redis on loopback; their host ports can be moved in .env.
  local db_port redis_port
  # env_get fails under pipefail before .env exists (first install).
  db_port="${DB_HOST_PORT:-$(env_get DB_HOST_PORT || true)}"; redis_port="${REDIS_HOST_PORT:-$(env_get REDIS_HOST_PORT || true)}"
  # Keep digits only, so a stray CR or space from .env cannot reach port_in_use.
  db_port="${db_port//[^0-9]/}"; redis_port="${redis_port//[^0-9]/}"
  local ports=(3000 9000 "${db_port:-5432}" "${redis_port:-6379}")
  [[ "$MODE" == "public" ]] && ports=(80 443 "${ports[@]}")
  for p in "${ports[@]}"; do
    if port_in_use "$p"; then
      # A re-run on a running install legitimately finds our own stack listening.
      if docker ps --filter "label=com.docker.compose.project=$(project_name)" --format '{{.Ports}}' 2>/dev/null | grep -Eq ":${p}->"; then note "Port $p is held by the existing Supercheck stack."
      else fail "Port $p is already in use by another process."; note "Find it with: ss -ltnp 'sport = :$p'"
        [[ "$p" == "${db_port:-5432}" || "$p" == "${redis_port:-6379}" ]] && note "Or move Supercheck's port with DB_HOST_PORT or REDIS_HOST_PORT in $(compose_dir)/.env."
        exit 1; fi
    fi
  done
}

# ─── Main ───────────────────────────────────────────────────────────────────

main() {
  printf '\n%s  Supercheck self-hosted installer%s\n' "$BOLD" "$RESET"
  printf '%s  Version %s · about 10 minutes, mostly image downloads%s\n' "$DIM" "$VERSION" "$RESET"
  [[ "$DRY_RUN" == true ]] && printf '%s  Dry run: read-only checks and a plan, nothing is changed.%s\n' "$YELLOW" "$RESET"

  # Use the checkout this script lives in, if any; otherwise install into --dir.
  SOURCE_FETCHED=false
  SELF_DIR=""
  if [[ -n "${BASH_SOURCE[0]:-}" && -f "${BASH_SOURCE[0]}" ]]; then SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; fi
  if [[ -n "$SELF_DIR" && -f "$SELF_DIR/docker-compose.yml" && -f "$SELF_DIR/init-secrets.sh" && -f "$SELF_DIR/setup-k3s.sh" ]]; then
    COMPOSE_DIR="$SELF_DIR"
    INSTALL_DIR="$SELF_DIR"
    USING_THIS_CHECKOUT=true
  else
    USING_THIS_CHECKOUT=false
  fi
  # An upgrade moves this checkout to the release tag, so the checkout's own version does not apply.
  [[ "$UPGRADE" == true ]] && USING_THIS_CHECKOUT=false

  if [[ "$DRY_RUN" != true && "$EUID" -eq 0 ]]; then
    LOG_DIR="/var/log/supercheck"
    [[ -L "$LOG_DIR" ]] && die "$LOG_DIR is a symlink; refusing to write the install log there."
    ( umask 077; install -d -m 700 "$LOG_DIR" )
    LOG_FILE="${LOG_DIR}/install.log"
    [[ -L "$LOG_FILE" ]] && die "$LOG_FILE is a symlink; refusing to write the install log there."
    ( umask 077; : >>"$LOG_FILE" )
    printf '\n=== install.sh %s (version %s) ===\n' "$(date -u +%FT%TZ)" "$VERSION" >>"$LOG_FILE"
  else
    LOG_FILE="/dev/null"
  fi

  if [[ "$USING_THIS_CHECKOUT" == true && ( "$VERSION_SET" == true || "$INSTALL_DIR" != "$SELF_DIR" ) ]]; then
    warn "Running from an existing checkout (${SELF_DIR}); --version and --dir are ignored and its images and files are used as they are."
  fi

  # One installer at a time: two runs would delete each other's partial downloads.
  if [[ "$DRY_RUN" != true && "$EUID" -eq 0 ]] && command -v flock >/dev/null 2>&1; then
    exec 9>/run/supercheck-install.lock
    flock -n 9 || die "Another install.sh is already running on this server." "Wait for it to finish, then re-run."
  fi

  header 1 "Checking this server"
  preflight
  if [[ "$UPGRADE" == true ]]; then
    upgrade_preflight
  elif [[ "$VERSION_SET" == true && "$USING_THIS_CHECKOUT" != true && -f "$(compose_dir)/.env" ]]; then
    # --version on an existing install used to change only the image tag and keep old files.
    current_version="$(installed_version)"
    if [[ -n "$current_version" && "$current_version" != "$VERSION" ]]; then
      if version_ge "$VERSION" "$current_version"; then
        die "This server runs ${current_version}. Changing the release needs the upgrade command:" \
          "sudo bash install.sh --upgrade --version ${VERSION}"
      fi
      die "This server runs ${current_version}; going back to ${VERSION} is not supported (database migrations only move forward)." \
        "To go back, restore a backup taken on ${VERSION} (sudo bash backup.sh --restore <dir>)."
    fi
  fi

  header 2 "Choosing your setup"
  USE_EXISTING=false
  if [[ -z "$MODE" && -f "$(compose_dir)/.env" ]]; then
    USE_EXISTING=true
    if env_has_https; then
      MODE="public"; DOMAIN="$(env_get APP_DOMAIN)"
      ok "Using your existing configuration: HTTPS for ${BOLD}${DOMAIN}${RESET}"
    else
      MODE="local"
      ok "Using your existing configuration: local HTTP"
    fi
  fi
  if [[ -z "$MODE" ]]; then
    if [[ "$CAN_PROMPT" == true ]]; then
      printf '\n    1) Try it on this server   %s(HTTP on localhost, fastest)%s\n' "$DIM" "$RESET" >/dev/tty
      printf '    2) Public server           %s(HTTPS with your domain)%s\n\n' "$DIM" "$RESET" >/dev/tty
      choice="$(ask "Choose" "1")"
      until [[ "$choice" == "1" || "$choice" == "2" ]]; do
        warn "Enter 1 or 2."
        choice="$(ask "Choose" "1")"
      done
      [[ "$choice" == "2" ]] && MODE="public" || MODE="local"
    else
      die "No setup chosen and no terminal to ask on." "Pass --local, or --domain <host> --email <address>, or use --yes with those flags to skip prompts."
    fi
  fi

  if [[ "$MODE" == "public" && "$USE_EXISTING" != true ]]; then
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
      check_dns_target "$DOMAIN"
    else
      warn "$DOMAIN does not resolve yet. Point an A record at this server before certificates can be issued."
      if [[ "$CAN_PROMPT" == true ]]; then confirm "Continue anyway?" || die "Stopped. Create the DNS record, then re-run."; fi
    fi
    check_ufw
    ok "Public HTTPS install for ${BOLD}${DOMAIN}${RESET}"
    note "Status pages use ${STATUS_DOMAIN:-$DOMAIN} subdomains: add a wildcard DNS record (*.${STATUS_DOMAIN:-$DOMAIN})."
    note "HTTPS for those subdomains needs a wildcard certificate (DNS-01); see 'Status page HTTPS' in the docs."
  elif [[ "$MODE" == "local" && "$USE_EXISTING" != true ]]; then
    ok "Local evaluation on this server"
  fi

  check_ports

  # An existing .env is never regenerated. A public request against a .env that is not yet
  # configured for that domain updates only the HTTPS keys (backup kept); anything else keeps it.
  NEED_PUBLIC_APPLY=false
  if [[ -f "$(compose_dir)/.env" && "$USE_EXISTING" != true ]]; then
    if [[ "$MODE" == "public" ]] && { ! env_has_https || [[ "$(env_get APP_DOMAIN)" != "$DOMAIN" || "$(env_get ACME_EMAIL)" != "$EMAIL" || ( -n "$STATUS_DOMAIN" && "$(env_get STATUS_PAGE_DOMAIN)" != "$STATUS_DOMAIN" ) ]]; }; then
      NEED_PUBLIC_APPLY=true
      note "An existing .env was found. Its secrets are kept; the HTTPS settings for ${DOMAIN} will be added (a backup is saved)."
    elif [[ "$MODE" == "local" ]] && env_has_https; then
      warn "The existing .env is configured for HTTPS (${BOLD}$(env_get APP_DOMAIN)${RESET}); --local is ignored and it is left as is."
    else
      note "An existing .env was found and will be kept."
    fi
  fi

  if [[ "$CAN_PROMPT" == true && "$DRY_RUN" != true ]]; then
    if [[ "$UPGRADE" == true ]]; then
      printf '\n  This will dump the database, update %s to %s, re-run the sandbox setup and restart Supercheck (a few minutes of downtime).\n' "$UPGRADE_TOP" "$VERSION"
    else
      printf '\n  This will install Docker (if missing), k3s with the gVisor sandbox, and Supercheck %s.\n' "$VERSION"
    fi
    confirm "Continue?" || die "Cancelled. Nothing was changed."
  fi

  if [[ "$USING_THIS_CHECKOUT" != true && ( "$VERSION_SET" == true || ! -f "$(compose_dir)/init-secrets.sh" ) ]]; then
    if [[ ! -f "$(compose_dir)/init-secrets.sh" && -d "$INSTALL_DIR" ]] && dir_has_content "$INSTALL_DIR"; then
      die "${INSTALL_DIR} exists but is not a Supercheck checkout." "Choose another location with --dir, or remove it."
    fi
    if [[ "$DRY_RUN" != true ]] && ! command -v curl >/dev/null 2>&1; then
      run_step "Installing release lookup tools" install_lookup_tools
    fi
    run_step "Checking release v${VERSION}" check_release
  fi

  ATTEMPTED=true
  header 3 "Installing prerequisites"
  if [[ "$DRY_RUN" == true ]]; then
    if docker_ready; then note "Docker and Compose >= $MIN_COMPOSE are present"; else note "would: install Docker, Compose, git and bzip2"; fi
  elif docker_ready && command -v git >/dev/null 2>&1 && command -v bzip2 >/dev/null 2>&1 && command -v curl >/dev/null 2>&1 && command -v ip >/dev/null 2>&1 && command -v ss >/dev/null 2>&1; then
    ok "Docker $(docker version --format '{{.Server.Version}}' 2>/dev/null), Compose $(compose_version), git, bzip2"
  else
    run_step "Installing Docker, Compose, git and bzip2" install_prerequisites
  fi

  check_ports

  header 4 "Preparing configuration"
  if [[ "$UPGRADE" == true ]]; then
    PRE_UPGRADE_DUMP="/var/backups/supercheck/pre-upgrade-$(date -u +%Y%m%dT%H%M%SZ).dump"
    # Never migrate without a dump: start PostgreSQL first if it is stopped.
    run_step "Dumping the database to ${PRE_UPGRADE_DUMP}" backup_database "$PRE_UPGRADE_DUMP"
    run_step "Updating deployment files to v${VERSION} (.env backup kept)" upgrade_source
  elif [[ -f "$(compose_dir)/init-secrets.sh" ]]; then
    ok "Source in $(compose_dir)"
  elif [[ -d "$INSTALL_DIR" ]] && dir_has_content "$INSTALL_DIR"; then
    die "${INSTALL_DIR} exists but is not a Supercheck checkout." "Choose another location with --dir, or remove it."
  else
    run_step "Downloading Supercheck ${VERSION}" fetch_source
    SOURCE_FETCHED=true
  fi
  # This installer targets the RustFS storage layout. A source tree that still defines a MinIO
  # service (an older release) would start a stack whose image can no longer be pulled.
  if [[ -f "$(compose_dir)/docker-compose.yml" ]] && grep -q '^  minio:' "$(compose_dir)/docker-compose.yml"; then
    die "This source tree is from a release that still bundles MinIO, whose image can no longer be pulled." \
      "Install a release that includes the RustFS storage change: see https://github.com/supercheck-io/supercheck/releases" \
      "then re-run with --version <that release>, or run install.sh from a checkout of its source."
  fi
  if [[ -f "$(compose_dir)/.env" ]]; then
    ok "Keeping existing .env (secrets are never regenerated)"
    if [[ "$NEED_PUBLIC_APPLY" == true ]]; then run_step "Applying HTTPS settings to .env" apply_public_config; fi
  else
    run_step "Generating secrets and configuration" generate_config
  fi

  if [[ "$IGNORE_MINIO" == true ]]; then
    run_step "Applying explicitly requested fresh storage settings" apply_fresh_storage_config
  fi
  run_step "Saving the image version" persist_version

  header 5 "Setting up the isolated test sandbox"
  # setup-k3s.sh is idempotent: it skips what is installed and re-runs its own gVisor
  # verification, so a previous run that failed verification is not silently accepted.
  run_step "Installing and verifying k3s and gVisor (a few minutes the first time)" setup_sandbox

  header 6 "Downloading images"
  if [[ "$DRY_RUN" == true ]]; then
    note "would: pull app, worker and storage images, then import the worker image into the sandbox"
  else
    if [[ "$VERSION_SET" == true && "$USING_THIS_CHECKOUT" != true ]]; then export SUPERCHECK_VERSION="$VERSION"; fi
    run_step "Pulling Supercheck images" pull_images
    compose_cfg="$(dc config 2>/dev/null || true)"
    worker_image="$(awk '/^ *WORKER_IMAGE:/ {print $2; exit}' <<<"$compose_cfg")"
    last_seg="${worker_image##*/}"
    if [[ "$PREWARM" != true ]]; then
      note "Skipping image warm-up (--no-prewarm); the first test run will download it and may time out."
    elif [[ -z "$worker_image" ]]; then
      warn "Could not determine the worker image; skipping warm-up. The first test run may time out."
    elif [[ "$last_seg" != *:* || "$last_seg" == *:latest ]]; then
      note "Worker image uses a mutable tag, so it is pulled on every run; skipping warm-up."
    else
      SOFT_STEP=true run_step "Preparing the test runtime (3 GB, one time)" prewarm_worker_image "$worker_image"
      ctr_images="$(k3s ctr -n k8s.io images ls -q 2>/dev/null || true)"
      if ! grep -qxF "$worker_image" <<<"$ctr_images"; then
        warn "The test runtime is not prepared; the first test run will download it and may time out. Re-run the installer to retry."
      fi
    fi
  fi

  header 7 "Starting Supercheck"
  run_step "Starting services and waiting until healthy" start_stack
  HEALTHY=false
  if [[ "$DRY_RUN" != true ]]; then
    health=""
    for _ in $(seq 1 30); do
      health="$(curl -sS --max-time 5 http://127.0.0.1:3000/api/health 2>/dev/null || true)"
      [[ "$health" == '{"status":"ok"'* ]] && break
      sleep 2
    done
    if [[ "$health" == '{"status":"ok"'* ]]; then
      ok "Health check passed"
      HEALTHY=true
      if [[ "$UPGRADE" == true && -n "${UPGRADE_FROM:-}" && "$UPGRADE_FROM" != "$VERSION" ]]; then
        SOFT_STEP=true run_step "Removing the images of ${UPGRADE_FROM}" remove_release_images "$UPGRADE_FROM"
      fi
    elif [[ -n "$health" ]]; then
      warn "Running, but the health check reports a problem:"
      note "$health"
      note "Inspect with: cd $(compose_dir) && sudo docker compose logs --tail=100 app worker"
    else
      die "The app did not answer on http://127.0.0.1:3000." "Inspect with: cd $(compose_dir) && sudo docker compose logs --tail=100 app worker"
    fi
  fi

  if [[ "$DRY_RUN" != true && "$MODE" == "public" && -n "$DOMAIN" ]]; then check_public_https "$DOMAIN"; fi

  # ─── Done ───────────────────────────────────────────────────────────────────

  if [[ "$DRY_RUN" == true ]]; then
    printf '\n%sDry run finished. Nothing was changed.%s Re-run without --dry-run to install.\n\n' "$GREEN" "$RESET"
    exit 0
  fi

  # Report what is actually configured, not what was requested.
  if env_has_https; then MODE="public"; DOMAIN="$(env_get APP_DOMAIN)"; else MODE="local"; fi
  if [[ "$MODE" == "public" ]]; then URL="https://${DOMAIN}"; else URL="http://localhost:3000"; fi
  if [[ "$HEALTHY" == true && "$UPGRADE" == true ]]; then
    printf '\n%s  Supercheck %s is ready.%s %s(%ss)%s\n\n' "$GREEN$BOLD" "$VERSION" "$RESET" "$DIM" "$SECONDS" "$RESET"
  elif [[ "$HEALTHY" == true ]]; then
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
  if [[ "$MODE" == "public" ]]; then
    warn "Sign-up is open to anyone who can reach ${URL}. Create your account first, then set SIGNUP_ENABLED=false in .env"
    note "(or restrict it with ALLOWED_EMAIL_DOMAINS) and run: cd $(compose_dir) && sudo docker compose up -d --force-recreate app"
  fi
  printf '  Config      %s/.env  %s(keep a private backup; it holds your secrets)%s\n' "$(compose_dir)" "$DIM" "$RESET"
  printf '  Logs        cd %s && sudo docker compose logs -f app worker\n' "$(compose_dir)"
  printf '  Stop/start  sudo docker compose stop   /   sudo docker compose up -d\n'
  printf '  Back up     cd %s && sudo bash backup.sh\n' "$(compose_dir)"
  printf '  Upgrade     download the new release'"'"'s install.sh, then: sudo bash install.sh --upgrade\n'
  [[ -z "${PRE_UPGRADE_DUMP:-}" ]] || printf '  DB dump     %s  %s(taken before the upgrade)%s\n' "$PRE_UPGRADE_DUMP" "$DIM" "$RESET"
  printf '  Install log %s\n' "$LOG_FILE"
  printf '  Docs        https://supercheck.io/docs/app/deployment/self-hosted\n'
  if [[ "$DOCKER_GROUP" == true && -n "${SUDO_USER:-}" && "$SUDO_USER" != "root" ]]; then
    note "${SUDO_USER} was added to the docker group (root-equivalent); log out and back in to use docker without sudo."
  fi
  printf '\n'
  [[ "$HEALTHY" == true ]] || exit 3
}

# Everything above only defines functions, so a truncated download cannot run a partial install.
main "$@"
