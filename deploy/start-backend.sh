#!/usr/bin/env bash
# Run on the target Linux host after loading/pulling a verified image.
set -euo pipefail
if [[ $# -ne 2 ]]; then
  echo "Usage: $0 IMAGE_REFERENCE PRIVATE_ENV_FILE" >&2
  exit 2
fi
image=$1
config=$2
[[ -f "$config" ]] || { echo "Private environment file not found" >&2; exit 2; }
permissions=$(stat -c '%a' "$config")
[[ "$permissions" == 600 || "$permissions" == 400 ]] || { echo "Environment file must have mode 600 or 400" >&2; exit 2; }
if ! awk -F= '$1 == "API_KEY" && length(substr($0,9)) > 0 {found=1} END {exit !found}' "$config"; then
  echo "Environment file requires a nonempty API_KEY" >&2
  exit 2
fi
image_platform=$(docker image inspect --format '{{.Os}}/{{.Architecture}}' "$image")
daemon_platform=$(docker info --format '{{.OSType}}/{{.Architecture}}')
case "$daemon_platform" in
  linux/x86_64) daemon_platform=linux/amd64 ;;
  linux/aarch64) daemon_platform=linux/arm64 ;;
esac
[[ $image_platform == "$daemon_platform" ]] || { echo "Image platform differs from Docker host; build for the target architecture before starting" >&2; exit 2; }
docker network inspect corodev >/dev/null 2>&1 || docker network create corodev >/dev/null
if docker container inspect corodev-backend >/dev/null 2>&1; then
  echo "corodev-backend already exists; use deploy/rollout.sh for replacement" >&2
  exit 2
fi
logging=(--log-driver json-file --log-opt max-size=5m --log-opt max-file=3)
if [[ ${LOG_DRIVER:-json-file} == awslogs ]]; then
  : "${AWS_REGION:?Set the confirmed AWS region}" "${AWS_LOG_GROUP:?Set the pre-created log group}"
  logging=(--log-driver awslogs --log-opt "awslogs-region=$AWS_REGION" --log-opt "awslogs-group=$AWS_LOG_GROUP" --log-opt "awslogs-stream=backend" --log-opt awslogs-create-group=false)
fi
docker run -d --name corodev-backend --network corodev \
  --env-file "$config" --publish 127.0.0.1:8080:8080 \
  --restart unless-stopped --read-only --cap-drop ALL \
  --security-opt no-new-privileges:true --pids-limit 256 \
  --memory "${BACKEND_MEMORY:-1g}" --cpus "${BACKEND_CPUS:-2}" \
  --tmpfs /tmp:rw,noexec,nosuid,size=16m \
  "${logging[@]}" "$image" >/dev/null
for ((attempt=0; attempt<40; attempt++)); do
  if docker exec corodev-backend /usr/local/bin/healthcheck; then
    echo "Backend healthy on host loopback port 8080"
    exit 0
  fi
  sleep 1
done
echo "Backend did not become healthy; inspect Docker logs without publishing credentials" >&2
exit 1
