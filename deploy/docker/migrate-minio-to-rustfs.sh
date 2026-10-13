#!/usr/bin/env bash
# Copy the bundled MinIO data into RustFS before upgrading to the RustFS release.
#
# Run this from the deploy/docker directory of your CURRENT (MinIO) checkout, with the
# old stack running, BEFORE you `git pull`:
#
#   ./migrate-minio-to-rustfs.sh          # asks before stopping app and worker
#   ./migrate-minio-to-rustfs.sh --yes    # no prompt
#
# What it does:
#   1. Stops app and worker so nothing writes during the copy (downtime starts here).
#   2. Starts a temporary RustFS on the same network, backed by the volume the new
#      release will use (<project>_rustfs-data).
#   3. Copies every bucket MinIO -> RustFS (copy, never sync) and verifies each one.
#   4. Backs up .env to .env.pre-rustfs, points S3_ENDPOINT at RustFS, and adds
#      AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY if your .env never had them.
#
# It never modifies or deletes the MinIO container or its minio-data volume, so you can
# roll back by restoring .env.pre-rustfs and the previous checkout.

set -euo pipefail

RUSTFS_IMAGE="ghcr.io/rustfs/rustfs:1.0.1"
RCLONE_IMAGE="rclone/rclone:1.70.3"

cd "$(dirname "${BASH_SOURCE[0]}")"
export KUBECONFIG_FILE="${KUBECONFIG_FILE:-/etc/rancher/k3s/supercheck-worker.kubeconfig}"

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; BLUE='\033[0;34m'; NC='\033[0m'
log()  { echo -e "${GREEN}[✓]${NC} $*"; }
warn() { echo -e "${YELLOW}[!]${NC} $*"; }
info() { echo -e "${BLUE}[i]${NC} $*"; }
die()  { echo -e "${RED}[✗]${NC} $*" >&2; exit 1; }

ASSUME_YES=false
[[ "${1:-}" == "--yes" ]] && ASSUME_YES=true

[[ -f .env ]] || die ".env not found in $(pwd). Run this from your existing deploy/docker directory."
env_get() {
  grep -E "^$1=" .env | tail -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//" || true
}

# Decide from the effective .env, not from the backup file: after a rollback (restoring
# .env.pre-rustfs) the backup still exists but .env points at MinIO again and must be migrated.
if [[ "$(env_get S3_ENDPOINT)" == *rustfs* ]]; then
  log ".env already points at RustFS, so this install is migrated. Continue with: git pull && docker compose up -d --wait --remove-orphans"
  exit 0
fi
MINIO_CID="$(docker compose ps -q minio 2>/dev/null || true)"
[[ -n "$MINIO_CID" ]] || die "No running 'minio' service found.
    Run this BEFORE 'git pull', with the old stack up:  docker compose up -d
    If you already pulled, check out your previous release first."

PROJECT="$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project"}}' "$MINIO_CID")"
NET="$(docker inspect -f '{{range $k, $v := .NetworkSettings.Networks}}{{println $k}}{{end}}' "$MINIO_CID" | head -n 1)"
[[ -n "$PROJECT" && -n "$NET" ]] || die "Could not determine the Compose project or network of the minio container."

OLD_AK="$(env_get AWS_ACCESS_KEY_ID)"; OLD_SK="$(env_get AWS_SECRET_ACCESS_KEY)"
KEYS_MISSING=false
if [[ -z "$OLD_AK" || -z "$OLD_SK" ]]; then
  KEYS_MISSING=true
  OLD_AK="minioadmin"; OLD_SK="minioadmin"
  warn ".env has no AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY, so MinIO ran on its minioadmin defaults."
  warn "New random keys will be generated for RustFS and added to .env."
fi
if [[ "$KEYS_MISSING" == true ]]; then
  NEW_AK="$(openssl rand -hex 16)"; NEW_SK="$(openssl rand -hex 32)"
else
  NEW_AK="$OLD_AK"; NEW_SK="$OLD_SK"
fi

info "Project: ${PROJECT}   Network: ${NET}"
if [[ "$ASSUME_YES" != true ]]; then
  read -r -p "This stops app and worker until you finish the upgrade. Continue? [y/N] " answer
  [[ "$answer" =~ ^[Yy]$ ]] || die "Cancelled. Nothing was changed."
fi

TMP_DIR="$(mktemp -d)"; chmod 700 "$TMP_DIR"
rm -f .env.migrating
RFS_NAME="${PROJECT}-rustfs-migrate"
cleanup() { docker rm -f "$RFS_NAME" >/dev/null 2>&1 || true; rm -rf "$TMP_DIR"; }
trap cleanup EXIT

docker compose stop app worker >/dev/null 2>&1 || true
# Verify instead of trusting the exit status: copying while writers are active loses data.
# A compose error would make `ps` print nothing, so ask Docker about the whole project instead.
RUNNING_APP="$(docker ps -q --filter "label=com.docker.compose.project=${PROJECT}" --filter "label=com.docker.compose.service=app" 2>/dev/null || true)"
RUNNING_WORKER="$(docker ps -q --filter "label=com.docker.compose.project=${PROJECT}" --filter "label=com.docker.compose.service=worker" 2>/dev/null || true)"
if [[ -n "$RUNNING_APP$RUNNING_WORKER" ]]; then
  die "app or worker is still running, so the copy could miss new writes. Stop them (docker compose stop app worker) and re-run; bring the stack back with: docker compose up -d"
fi
log "Stopped app and worker"

VOL="${PROJECT}_rustfs-data"
if ! docker volume inspect "$VOL" >/dev/null 2>&1; then
  docker volume create \
    --label "com.docker.compose.project=${PROJECT}" \
    --label "com.docker.compose.volume=rustfs-data" "$VOL" >/dev/null
fi

( umask 077
  printf 'RUSTFS_ACCESS_KEY=%s\nRUSTFS_SECRET_KEY=%s\n' "$NEW_AK" "$NEW_SK" > "$TMP_DIR/rustfs.env"
  cat > "$TMP_DIR/rclone.env" <<EOF
RCLONE_CONFIG_OLD_TYPE=s3
RCLONE_CONFIG_OLD_PROVIDER=Minio
RCLONE_CONFIG_OLD_ENDPOINT=http://minio:9000
RCLONE_CONFIG_OLD_ACCESS_KEY_ID=${OLD_AK}
RCLONE_CONFIG_OLD_SECRET_ACCESS_KEY=${OLD_SK}
RCLONE_CONFIG_NEW_TYPE=s3
RCLONE_CONFIG_NEW_PROVIDER=Other
RCLONE_CONFIG_NEW_ENDPOINT=http://rustfs:9000
RCLONE_CONFIG_NEW_ACCESS_KEY_ID=${NEW_AK}
RCLONE_CONFIG_NEW_SECRET_ACCESS_KEY=${NEW_SK}
EOF
)

docker rm -f "$RFS_NAME" >/dev/null 2>&1 || true
docker run -d --name "$RFS_NAME" --network "$NET" --network-alias rustfs \
  --env-file "$TMP_DIR/rustfs.env" -v "${VOL}:/data" "$RUSTFS_IMAGE" >/dev/null

for _ in $(seq 1 30); do
  docker exec "$RFS_NAME" curl -fsS http://127.0.0.1:9000/health >/dev/null 2>&1 && break
  sleep 1
done
docker exec "$RFS_NAME" curl -fsS http://127.0.0.1:9000/health >/dev/null 2>&1 \
  || die "RustFS did not become healthy. MinIO and your data are untouched; restart with: docker compose up -d"
log "RustFS is up"

info "Copying buckets (this can take a while for large stores)..."
set +e
docker run --rm --network "$NET" --env-file "$TMP_DIR/rclone.env" --entrypoint sh "$RCLONE_IMAGE" -c '
  set -eu
  listing=$(rclone lsd old: 2>/dev/null)
  buckets=$(echo "$listing" | awk "{print \$NF}")
  [ -n "$buckets" ] || exit 3
  for b in $buckets; do
    rclone mkdir "new:$b"
    rclone copy "old:$b" "new:$b" --checksum --transfers 8
    rclone check "old:$b" "new:$b" --one-way
    echo "verified $b"
  done
'
status=$?
set -e
case "$status" in
  0) log "Every bucket copied and verified" ;;
  3) warn "MinIO has no buckets, so nothing was copied."
     warn "If you expected data, stop here and check that .env matches the keys MinIO was started with."
     [[ "$ASSUME_YES" == true ]] || { read -r -p "Continue anyway with empty storage? [y/N] " a; [[ "$a" =~ ^[Yy]$ ]] || die "Stopped. .env unchanged; restart with: docker compose up -d"; } ;;
  *) die "Copy or verification FAILED. .env is unchanged and MinIO is untouched. Restart with: docker compose up -d" ;;
esac

docker rm -f "$RFS_NAME" >/dev/null 2>&1 || true

if [[ -f .env.pre-rustfs ]]; then
  chmod 600 .env.pre-rustfs
  mv .env.pre-rustfs "$(mktemp ".env.pre-rustfs.$(date +%Y%m%d%H%M%S).XXXXXX")"
  warn "An older .env.pre-rustfs (a previous attempt or a rollback) was kept under a timestamped name."
fi
install -m 600 .env .env.pre-rustfs
( umask 077
{
  grep -v -E '^(S3_ENDPOINT|COMPOSE_PROJECT_NAME)=' .env || [[ $? -eq 1 ]]
  echo "COMPOSE_PROJECT_NAME=${PROJECT}"
  echo "S3_ENDPOINT=http://rustfs:9000"
  if [[ "$KEYS_MISSING" == true ]]; then
    echo "AWS_ACCESS_KEY_ID=${NEW_AK}"
    echo "AWS_SECRET_ACCESS_KEY=${NEW_SK}"
  fi
} > .env.migrating
)
chmod 600 .env.migrating
mv .env.migrating .env
log ".env updated (backup: .env.pre-rustfs)"

echo ""
log "Migration complete. Next:"
echo "    git pull"
echo "    docker compose up -d --wait --remove-orphans"
echo "    curl --fail --silent --show-error http://localhost:3000/api/health"
echo ""
info "Your minio-data volume is untouched. Remove it only after you have checked a status page and a test report."
info "To roll back: restore .env.pre-rustfs over .env and check out the previous release."
