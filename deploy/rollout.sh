#!/usr/bin/env bash
# Stops the old in-memory simulation. Rollback restores the image, not world state.
set -euo pipefail
[[ $# -eq 2 ]] || { echo "Usage: $0 IMAGE_REFERENCE PRIVATE_ENV_FILE" >&2; exit 2; }
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
image=$1
config=$2
docker image inspect "$image" >/dev/null
[[ -f "$config" ]] || { echo "Private environment file not found" >&2; exit 2; }
if docker container inspect corodev-backend >/dev/null 2>&1; then
  if docker container inspect corodev-backend-previous >/dev/null 2>&1; then
    echo "Previous backup exists; review/remove it explicitly before another rollout" >&2
    exit 2
  fi
  docker stop --time 10 corodev-backend >/dev/null
  docker rename corodev-backend corodev-backend-previous
fi
if "$script_dir/start-backend.sh" "$image" "$config"; then
  echo "Rollout complete; keep corodev-backend-previous for image rollback"
  exit 0
fi
if docker container inspect corodev-backend >/dev/null 2>&1; then docker rm -f corodev-backend >/dev/null; fi
if docker container inspect corodev-backend-previous >/dev/null 2>&1; then
  docker rename corodev-backend-previous corodev-backend
  docker start corodev-backend >/dev/null
fi
echo "New container failed; previous container restarted where available" >&2
exit 1
