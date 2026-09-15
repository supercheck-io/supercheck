#!/usr/bin/env bash

set -Eeuo pipefail

readonly APP_IMAGE_REPOSITORY="ghcr.io/supercheck-io/supercheck/app"
readonly WORKER_IMAGE_REPOSITORY="ghcr.io/supercheck-io/supercheck/worker"
readonly COMPOSE_FILE="docker-compose-secure.yml"
readonly HEALTH_TIMEOUT_SECONDS=360

if (( BASH_VERSINFO[0] < 4 )); then
  echo "Bash 4 or newer is required on the demo host" >&2
  exit 69
fi

if (( $# != 4 )); then
  echo "Usage: deploy-demo.sh <image-tag> <app-digest> <worker-digest> <deploy-directory>" >&2
  exit 64
fi

readonly IMAGE_TAG="$1"
readonly APP_DIGEST="$2"
readonly WORKER_DIGEST="$3"
readonly DEPLOY_DIRECTORY="$4"
readonly EXPECTED_APP_IMAGE="${APP_IMAGE_REPOSITORY}:${IMAGE_TAG}"
readonly EXPECTED_WORKER_IMAGE="${WORKER_IMAGE_REPOSITORY}:${IMAGE_TAG}"

if [[ ! "$IMAGE_TAG" =~ ^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$ || "$IMAGE_TAG" == "latest" ]]; then
  echo "Refusing invalid OCI image tag: ${IMAGE_TAG}" >&2
  exit 64
fi

for digest in "$APP_DIGEST" "$WORKER_DIGEST"; do
  if [[ ! "$digest" =~ ^sha256:[0-9a-f]{64}$ ]]; then
    echo "Refusing invalid image digest: ${digest}" >&2
    exit 64
  fi
done

if [[ "$DEPLOY_DIRECTORY" != /* ]]; then
  echo "The demo deployment directory must be an absolute path" >&2
  exit 64
fi

for command_name in docker flock awk grep mktemp stat; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "Required command is unavailable on the demo host: ${command_name}" >&2
    exit 69
  fi
done

cd -- "$DEPLOY_DIRECTORY"

if [[ ! -f "$COMPOSE_FILE" ]]; then
  echo "Compose file not found: ${DEPLOY_DIRECTORY}/${COMPOSE_FILE}" >&2
  exit 66
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "Docker Compose v2 is required on the demo host" >&2
  exit 69
fi

# GitHub concurrency prevents ordinary overlap. The host lock also protects
# against manual deployments or a second automation system racing this update.
exec 9>"${DEPLOY_DIRECTORY}/.supercheck-demo-deploy.lock"
if ! flock -n 9; then
  echo "Another demo deployment is already running" >&2
  exit 75
fi

export SUPERCHECK_VERSION="$IMAGE_TAG"

mapfile -t configured_images < <(docker compose -f "$COMPOSE_FILE" config --images)
if ! printf '%s\n' "${configured_images[@]}" | grep -Fxq "$EXPECTED_APP_IMAGE"; then
  echo "Compose does not resolve app to ${EXPECTED_APP_IMAGE}" >&2
  exit 78
fi
if ! printf '%s\n' "${configured_images[@]}" | grep -Fxq "$EXPECTED_WORKER_IMAGE"; then
  echo "Compose does not resolve worker to ${EXPECTED_WORKER_IMAGE}" >&2
  exit 78
fi

current_image_for_service() {
  local service_name="$1"
  local -a container_ids=()

  mapfile -t container_ids < <(docker compose -f "$COMPOSE_FILE" ps -q --all "$service_name")
  if (( ${#container_ids[@]} == 0 )); then
    return 0
  fi

  docker inspect --format '{{.Config.Image}}' "${container_ids[0]}" 2>/dev/null || true
}

version_from_image() {
  local image_reference="$1"
  local repository="$2"
  local version=""

  if [[ "$image_reference" == "${repository}:"* ]]; then
    version="${image_reference#"${repository}:"}"
    if [[ "$version" =~ ^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$ ]]; then
      printf '%s\n' "$version"
    fi
  fi
}

PREVIOUS_APP_IMAGE="$(current_image_for_service app)"
PREVIOUS_WORKER_IMAGE="$(current_image_for_service worker)"
readonly PREVIOUS_APP_IMAGE PREVIOUS_WORKER_IMAGE

PREVIOUS_APP_VERSION="$(version_from_image "$PREVIOUS_APP_IMAGE" "$APP_IMAGE_REPOSITORY")"
PREVIOUS_WORKER_VERSION="$(version_from_image "$PREVIOUS_WORKER_IMAGE" "$WORKER_IMAGE_REPOSITORY")"
readonly PREVIOUS_APP_VERSION PREVIOUS_WORKER_VERSION

ROLLBACK_VERSION=""
if [[ -n "$PREVIOUS_APP_VERSION" && "$PREVIOUS_APP_VERSION" == "$PREVIOUS_WORKER_VERSION" ]]; then
  ROLLBACK_VERSION="$PREVIOUS_APP_VERSION"
fi
readonly ROLLBACK_VERSION

print_diagnostics() {
  local service_name container_id state health image
  local -a container_ids=()

  docker compose -f "$COMPOSE_FILE" ps --all || true
  for service_name in app worker; do
    mapfile -t container_ids < <(docker compose -f "$COMPOSE_FILE" ps -q --all "$service_name")
    for container_id in "${container_ids[@]}"; do
      state="$(docker inspect --format '{{.State.Status}}' "$container_id" 2>/dev/null || true)"
      health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}not-configured{{end}}' "$container_id" 2>/dev/null || true)"
      image="$(docker inspect --format '{{.Config.Image}}' "$container_id" 2>/dev/null || true)"
      echo "${service_name} ${container_id:0:12}: state=${state:-unknown} health=${health:-unknown} image=${image:-unknown}"
    done
  done
}

wait_for_release() {
  local deadline=$((SECONDS + HEALTH_TIMEOUT_SECONDS))
  local all_healthy service_name container_id state image expected_image execution_image
  local -a container_ids=()

  while (( SECONDS < deadline )); do
    all_healthy=true

    for service_name in app worker; do
      if [[ "$service_name" == "app" ]]; then
        expected_image="$EXPECTED_APP_IMAGE"
      else
        expected_image="$EXPECTED_WORKER_IMAGE"
      fi

      mapfile -t container_ids < <(docker compose -f "$COMPOSE_FILE" ps -q --all "$service_name")
      if (( ${#container_ids[@]} == 0 )); then
        all_healthy=false
        continue
      fi

      for container_id in "${container_ids[@]}"; do
        image="$(docker inspect --format '{{.Config.Image}}' "$container_id")"
        if [[ "$image" != "$expected_image" ]]; then
          echo "${service_name} is running unexpected image ${image}" >&2
          return 1
        fi

        if [[ "$service_name" == "worker" ]]; then
          execution_image="$(
            docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$container_id" |
              awk -F= '$1 == "WORKER_IMAGE" { sub(/^[^=]*=/, ""); print; exit }'
          )"
          if [[ "$execution_image" != "$EXPECTED_WORKER_IMAGE" ]]; then
            echo "worker is configured to launch unexpected image ${execution_image:-none}" >&2
            return 1
          fi
        fi

        state="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container_id")"
        case "$state" in
          healthy)
            ;;
          unhealthy | exited | dead)
            echo "${service_name} container ${container_id:0:12} entered ${state}" >&2
            return 1
            ;;
          *)
            all_healthy=false
            ;;
        esac
      done
    done

    if [[ "$all_healthy" == true ]]; then
      return 0
    fi
    sleep 5
  done

  echo "App and worker did not become healthy within ${HEALTH_TIMEOUT_SECONDS} seconds" >&2
  return 1
}

rollback_release() {
  if [[ -z "$ROLLBACK_VERSION" || "$ROLLBACK_VERSION" == "$IMAGE_TAG" ]]; then
    echo "No distinct, consistent previous app/worker version is available for automatic rollback" >&2
    return 1
  fi

  echo "Rolling the demo back to ${ROLLBACK_VERSION}" >&2
  export SUPERCHECK_VERSION="$ROLLBACK_VERSION"
  compose_up_app_worker missing
}

compose_up_app_worker() {
  local pull_mode="$1"

  # Prefer an explicit pull mode so worker's pull_policy: always cannot replace
  # digest-pinned local tags. Fall back for hosts on older Compose builds.
  if docker compose up --help 2>/dev/null | grep -q -- '--pull'; then
    docker compose -f "$COMPOSE_FILE" up -d --pull "$pull_mode" app worker </dev/null
  else
    docker compose -f "$COMPOSE_FILE" up -d app worker </dev/null
  fi
}

# Pull the exact build digest, then retag for Compose. Proves the digest exists
# without `docker buildx imagetools`, which failed on the demo host immediately
# after a successful image pull (SSH exit 255, no digest diagnostics).
pull_exact_digest() {
  local repository="$1"
  local tag="$2"
  local digest="$3"
  local tagged_ref="${repository}:${tag}"
  local digest_ref="${repository}@${digest}"

  echo "Pulling ${digest_ref}"
  if ! docker pull "$digest_ref" </dev/null; then
    echo "Failed to pull exact digest ${digest_ref}" >&2
    return 1
  fi

  if ! docker tag "$digest_ref" "$tagged_ref" </dev/null; then
    echo "Failed to tag ${digest_ref} as ${tagged_ref}" >&2
    return 1
  fi
}

persist_release_version() {
  local env_file=".env"
  local temporary_file
  local original_mode="600"

  umask 077
  temporary_file="$(mktemp "${DEPLOY_DIRECTORY}/.env.release.XXXXXX")"
  trap 'rm -f -- "$temporary_file"' RETURN

  if [[ -f "$env_file" ]]; then
    original_mode="$(stat -c '%a' "$env_file")"
    awk -v version="$IMAGE_TAG" '
      BEGIN { updated = 0 }
      /^[[:space:]]*SUPERCHECK_VERSION=/ {
        if (!updated) {
          print "SUPERCHECK_VERSION=" version
          updated = 1
        }
        next
      }
      { print }
      END {
        if (!updated) print "SUPERCHECK_VERSION=" version
      }
    ' "$env_file" >"$temporary_file"
  else
    printf 'SUPERCHECK_VERSION=%s\n' "$IMAGE_TAG" >"$temporary_file"
  fi

  chmod "$original_mode" "$temporary_file"
  mv -f -- "$temporary_file" "$env_file"
  trap - RETURN
}

echo "Deploying ${EXPECTED_APP_IMAGE}@${APP_DIGEST}"
echo "Deploying ${EXPECTED_WORKER_IMAGE}@${WORKER_DIGEST}"

trap 'echo "Demo deploy failed near ${BASH_SOURCE[0]}:${LINENO} (exit $?)" >&2' ERR

pull_exact_digest "$APP_IMAGE_REPOSITORY" "$IMAGE_TAG" "$APP_DIGEST"
pull_exact_digest "$WORKER_IMAGE_REPOSITORY" "$IMAGE_TAG" "$WORKER_DIGEST"

# --pull never keeps Compose from re-fetching mutable tags after digest pin.
if ! compose_up_app_worker never; then
  echo "Docker Compose failed to apply the demo release" >&2
  print_diagnostics
  rollback_release || true
  exit 1
fi

if ! wait_for_release; then
  print_diagnostics
  rollback_release || true
  exit 1
fi

if ! persist_release_version; then
  echo "The release is healthy, but its durable version could not be recorded" >&2
  rollback_release || true
  exit 1
fi

echo "Demo app and worker are healthy on image tag ${IMAGE_TAG}"
