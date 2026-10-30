#!/usr/bin/env bash
# Back up or restore a Supercheck installation that uses the bundled PostgreSQL and RustFS.
#
#   sudo bash backup.sh                         # back up to /var/backups/supercheck/<UTC timestamp>
#   sudo bash backup.sh --out /mnt/backups      # back up under another directory
#   sudo bash backup.sh --restore <backup-dir>  # replace this installation's data with a backup
#
# A backup directory holds database.dump (pg_dump custom format), rustfs-data.tar.gz (reports,
# artifacts, status-page assets, documents), env (a copy of .env: it holds every secret, keep it
# private) and, for HTTPS, traefik-letsencrypt.tar.gz and traefik-dns.env (DNS-01 credentials). Services that write data are stopped while it
# is copied, so the database and storage match, and are started again afterwards, also on failure.
#
# Restore needs the same Supercheck release as the backup, stops everything, replaces .env (the old
# one is kept as .env.pre-restore-*), the storage volumes and the database, then starts the stack.
# It asks for confirmation unless --yes is given. Stop remote workers first.
#
# External PostgreSQL or S3 (docker-compose-external.yml) are not covered: use the provider's backups.

set -Eeuo pipefail

OUT="/var/backups/supercheck"
RESTORE_FROM=""
ASSUME_YES=false

usage() {
  sed -n '2,17p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --out) [[ -n "${2:-}" ]] || { echo "--out needs a directory" >&2; exit 2; }; OUT="$2"; shift ;;
    --restore) [[ -n "${2:-}" ]] || { echo "--restore needs a backup directory" >&2; exit 2; }; RESTORE_FROM="$2"; shift ;;
    --yes|-y) ASSUME_YES=true ;;
    --help|-h) usage; exit 0 ;;
    *) echo "Unknown option: $1 (see --help)" >&2; exit 2 ;;
  esac
  shift
done

die() { echo "Error: $1" >&2; shift; for l in "$@"; do echo "  $l" >&2; done; exit 1; }
say() { echo "==> $*"; }

[[ "$EUID" -eq 0 ]] || die "Run as root: sudo bash backup.sh"
cd "$(dirname "${BASH_SOURCE[0]}")"
[[ -f docker-compose.yml && -f .env ]] || die "No installation found in $PWD (docker-compose.yml and .env are needed)."

dc() { docker compose "$@"; }

release_of() { # SUPERCHECK_VERSION in an env file, else this checkout's Compose default
  local v
  v="$(sed -n 's/^SUPERCHECK_VERSION=//p' "$1" 2>/dev/null | tail -n1 | tr -d "\"'" || true)"
  [[ -n "$v" ]] || v="$(grep -o 'supercheck/app:[$]{SUPERCHECK_VERSION:-[^}]*}' docker-compose.yml | head -n1 | sed 's/.*:-//; s/}$//' || true)"
  printf '%s\n' "$v"
}

# Compose may run under a custom project name (COMPOSE_PROJECT_NAME), so find volumes by label.
PROJECT="$(dc config | sed -n 's/^name: *//p' | head -n1 | tr -d "\"'" || true)"
[[ -n "$PROJECT" ]] || die "docker compose config failed (see the error above); check .env with: sudo docker compose config -q"
volume_of() {
  docker volume ls -q --filter "label=com.docker.compose.project=$PROJECT" --filter "label=com.docker.compose.volume=$1" | head -n1
}

POSTGRES_ID="$(dc ps -aq postgres 2>/dev/null || true)"
[[ -n "$POSTGRES_ID" ]] || die "The postgres container does not exist. Install and start Supercheck first."
# tar runs in the PostgreSQL image, which is already on this server.
HELPER_IMAGE="$(docker inspect -f '{{.Config.Image}}' "$POSTGRES_ID")"
helper() { docker run --rm --network none --entrypoint "$1" "${@:2}"; }

DATA_SERVICES=(app worker monitor-control private-agent rustfs)
STOPPED=()
restart_stopped() {
  if [[ ${#STOPPED[@]} -gt 0 ]]; then
    say "Starting ${STOPPED[*]}"
    local rc=0
    dc start "${STOPPED[@]}" || { rc=$?; echo "Could not start ${STOPPED[*]}; run: sudo docker compose up -d" >&2; }
    STOPPED=()
    return "$rc"
  fi
}

backup() {
  local dest final running svc name vol
  [[ -n "$(dc ps --status running -q postgres)" ]] || die "PostgreSQL is not running. Start the stack first: sudo docker compose up -d"
  # Root writes secrets here: refuse symlinks and directories other users control.
  [[ ! -L "$OUT" ]] || die "$OUT is a symlink; choose a real directory with --out."
  ( umask 077; install -d -m 700 "$OUT" )
  [[ "$(stat -c %u "$OUT" 2>/dev/null || stat -f %u "$OUT")" == "$(id -u)" ]] || die "$OUT is owned by another user; choose a directory owned by root."
  chmod 700 "$OUT"
  final="$OUT/$(date -u +%Y%m%dT%H%M%SZ)"
  # Written under .partial and renamed at the end, so an interrupted run never looks complete.
  dest="$final.partial"
  ( umask 077; install -d -m 700 "$dest" )

  running="$(dc ps --status running --services)"
  for svc in "${DATA_SERVICES[@]}"; do
    if grep -Fxq "$svc" <<<"$running"; then STOPPED+=("$svc"); fi
  done
  trap restart_stopped EXIT
  if [[ ${#STOPPED[@]} -gt 0 ]]; then
    say "Stopping ${STOPPED[*]} while data is copied"
    dc stop "${STOPPED[@]}"
  fi

  say "Copying .env"
  install -m 600 .env "$dest/env"
  if [[ -f traefik-dns.env ]]; then install -m 600 traefik-dns.env "$dest/traefik-dns.env"; fi
  say "Dumping the database"
  ( umask 077; dc exec -T postgres sh -c "pg_dump -Fc -U \"\$POSTGRES_USER\" \"\$POSTGRES_DB\"" >"$dest/database.dump" )
  [[ -s "$dest/database.dump" ]] || die "The database dump is empty."
  for name in rustfs-data traefik-letsencrypt; do
    vol="$(volume_of "$name")"
    if [[ -z "$vol" && "$name" == rustfs-data ]]; then die "The rustfs-data volume was not found for project $PROJECT."; fi
    [[ -n "$vol" ]] || continue
    say "Archiving the $name volume"
    helper tar -v "$vol:/data:ro" -v "$dest:/backup" "$HELPER_IMAGE" --numeric-owner -czf "/backup/$name.tar.gz" -C /data .
    chmod 600 "$dest/$name.tar.gz"
  done
  printf 'release=%s\nproject=%s\ncreated=%s\n' "$(release_of .env)" "$PROJECT" "$(date -u +%FT%TZ)" >"$dest/manifest"
  chmod 600 "$dest/manifest"

  trap - EXIT
  restart_stopped || { mv "$dest" "$final"; die "Backup written to $final, but the stopped services did not start."; }
  mv "$dest" "$final"
  say "Backup written to $final ($(du -sh "$final" | cut -f1))"
  echo "Copy it off this server and keep it private: env holds the secrets needed to read the data."
}

restore() {
  local src="$1" backup_release current_release answer stamp name vol
  [[ -d "$src" && -s "$src/database.dump" && -s "$src/rustfs-data.tar.gz" && -f "$src/manifest" ]] || \
    die "$src is not a complete backup (manifest, database.dump and rustfs-data.tar.gz are required)."
  src="$(cd "$src" && pwd)"
  backup_release="$(sed -n 's/^release=//p' "$src/manifest" 2>/dev/null || true)"
  current_release="$(release_of .env)"
  if [[ -n "$backup_release" && "$backup_release" != "$current_release" ]]; then
    die "The backup was taken on Supercheck ${backup_release}, but this installation runs ${current_release}." \
      "Restore onto the same release: install ${backup_release} (install.sh --version, or --upgrade for a newer one), then re-run."
  fi
  [[ -f "$src/env" ]] || echo "Warning: the backup has no env file; the current .env must hold the secrets that encrypted this data." >&2

  # Check everything before anything is changed: archives readable, dump parseable, volumes present.
  local names=() vols=() i
  for name in rustfs-data traefik-letsencrypt; do
    [[ -s "$src/$name.tar.gz" ]] || continue
    vol="$(volume_of "$name")"
    if [[ -z "$vol" && "$name" == rustfs-data ]]; then
      die "The rustfs-data volume was not found; start Supercheck once (sudo docker compose up -d), then re-run."
    fi
    if [[ -z "$vol" ]]; then echo "Warning: the backup has $name.tar.gz but this installation has no $name volume (HTTPS profile off); it is skipped." >&2; continue; fi
    helper tar -v "$src:/backup:ro" "$HELPER_IMAGE" -tzf "/backup/$name.tar.gz" >/dev/null || die "$src/$name.tar.gz is damaged."
    names+=("$name"); vols+=("$vol")
  done
  helper pg_restore -v "$src:/backup:ro" "$HELPER_IMAGE" -l /backup/database.dump >/dev/null || die "$src/database.dump is damaged."

  echo "This replaces the database, storage and .env of project '$PROJECT' in $PWD"
  echo "with the backup in $src (release ${backup_release:-unknown}). Current data is deleted."
  if [[ "$ASSUME_YES" != true ]]; then
    ( : </dev/tty ) 2>/dev/null || die "No terminal to confirm on. Re-run with --yes to restore without a prompt."
    printf 'Type "restore" to continue: ' >/dev/tty
    read -r answer </dev/tty || true
    [[ "$answer" == "restore" ]] || die "Cancelled. Nothing was changed."
  fi

  say "Stopping all services"
  dc stop
  # Past this point data is being replaced; if a step fails, say what state things are in.
  trap 'echo "Restore failed part-way: data may be half-replaced. Fix the error above and re-run: sudo bash backup.sh --restore $src --yes (the previous .env, if replaced, is .env.pre-restore-*)." >&2' ERR
  if [[ -f "$src/env" ]]; then
    stamp="$(date -u +%Y%m%dT%H%M%SZ)"
    say "Restoring .env (previous file kept as .env.pre-restore-$stamp)"
    install -m 600 .env ".env.pre-restore-$stamp"
    install -m 600 "$src/env" .env
  fi
  if [[ -f "$src/traefik-dns.env" ]]; then install -m 600 "$src/traefik-dns.env" traefik-dns.env; fi
  for i in "${!names[@]}"; do
    name="${names[$i]}" vol="${vols[$i]}"
    say "Restoring the $name volume"
    helper sh -v "$vol:/data" -v "$src:/backup:ro" "$HELPER_IMAGE" -c \
      "find /data -mindepth 1 -delete && tar --numeric-owner -xzf '/backup/$name.tar.gz' -C /data"
  done

  say "Restoring the database"
  dc up -d --wait --wait-timeout 120 postgres
  # The role password lives in the volume; align it with the restored .env (local socket, no password).
  printf '%s\n' "ALTER ROLE CURRENT_USER PASSWORD :'pw';" | \
    dc exec -T postgres sh -c "psql -q -v ON_ERROR_STOP=1 -U \"\$POSTGRES_USER\" -d postgres -v pw=\"\$POSTGRES_PASSWORD\""
  printf '%s\n' 'DROP DATABASE IF EXISTS :"db" WITH (FORCE);' 'CREATE DATABASE :"db";' | \
    dc exec -T postgres sh -c "psql -q -v ON_ERROR_STOP=1 -U \"\$POSTGRES_USER\" -d postgres -v db=\"\$POSTGRES_DB\""
  dc exec -T postgres sh -c "pg_restore --exit-on-error --no-owner -U \"\$POSTGRES_USER\" -d \"\$POSTGRES_DB\"" <"$src/database.dump"

  say "Starting Supercheck"
  dc up -d --wait --wait-timeout 300
  if curl -fsS --max-time 10 http://127.0.0.1:3000/api/health >/dev/null 2>&1; then
    say "Restore finished; the health check passed."
    echo "Queued jobs in Redis were not restored; runs queued before the backup will not resume."
  else
    echo "Restore finished, but http://127.0.0.1:3000/api/health did not answer yet. Check: sudo docker compose logs --tail=100 app" >&2
  fi
}

if [[ -n "$RESTORE_FROM" ]]; then restore "$RESTORE_FROM"; else backup; fi
