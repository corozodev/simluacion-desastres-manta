#!/usr/bin/env bash
# Authorized replacement on the existing EC2 host. Persistent flood data stays
# outside images. The previous backend image is removed after both services start.
set -euo pipefail
[[ $# -eq 2 ]] || { echo "Usage: $0 IMAGE PRIVATE_ENV_FILE" >&2; exit 2; }
image=$1
config=$2
: "${AWS_REGION:?}" "${AWS_LOG_GROUP:?}"
old_image=$(docker inspect --format '{{.Image}}' corodev-backend)
docker image inspect "$image" >/dev/null
[[ -f "$config" && $(stat -c '%a' "$config") == 600 ]]
install -d -m 700 -o 65532 -g 65532 /var/lib/corodev/flood
if docker container inspect corodev-flood-lab >/dev/null 2>&1; then
  docker stop --time 10 corodev-flood-lab >/dev/null
  docker rm corodev-flood-lab >/dev/null
fi
docker stop --time 10 corodev-backend >/dev/null
docker rm corodev-backend >/dev/null
docker run -d --name corodev-backend --network corodev --env-file "$config" \
  --publish 127.0.0.1:8080:8080 --restart unless-stopped --read-only \
  --cap-drop ALL --security-opt no-new-privileges:true --pids-limit 256 \
  --memory 1g --cpus 2 --tmpfs /tmp:rw,noexec,nosuid,size=16m \
  --log-driver awslogs --log-opt "awslogs-region=$AWS_REGION" \
  --log-opt "awslogs-group=$AWS_LOG_GROUP" --log-opt awslogs-stream=backend \
  --log-opt awslogs-create-group=false "$image" >/dev/null
docker run -d --name corodev-flood-lab --network container:corodev-backend \
  --restart unless-stopped --read-only --cap-drop ALL \
  --security-opt no-new-privileges:true --pids-limit 256 --memory 768m \
  --cpus 1 --cpu-shares 256 --env GOMAXPROCS=1 --env GOMEMLIMIT=640MiB \
  --tmpfs /tmp:rw,noexec,nosuid,size=16m --no-healthcheck \
  --mount type=bind,src=/var/lib/corodev/flood,dst=/var/lib/corodev \
  --log-driver awslogs --log-opt "awslogs-region=$AWS_REGION" \
  --log-opt "awslogs-group=$AWS_LOG_GROUP" --log-opt awslogs-stream=flood-lab \
  --log-opt awslogs-create-group=false --entrypoint /usr/local/bin/corodev-flood-lab \
  "$image" -listen 127.0.0.1:8082 -origin https://sistemamanta.lexinnovate.com \
  -data-dir data -incident-dir /var/lib/corodev/incidents \
  -reference-cache /var/lib/corodev/reference.json -reference-online \
  -operator-session-url http://127.0.0.1:8080/admin/session >/dev/null
[[ $(docker inspect --format '{{.State.Running}}' corodev-backend) == true ]]
[[ $(docker inspect --format '{{.State.Running}}' corodev-flood-lab) == true ]]
new_image=$(docker inspect --format '{{.Image}}' corodev-backend)
if [[ "$old_image" != "$new_image" ]]; then docker image rm "$old_image"; fi
echo "Phase 4 deployed; old backend image removed; persistent incident directory retained."
