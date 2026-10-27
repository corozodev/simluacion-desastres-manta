#!/usr/bin/env bash
# Owner-authorized EC2 release. Keeps the old containers and persistent data.
set -euo pipefail
[[ $# -eq 2 ]] || { echo 'Usage: rollout-phase5.sh IMAGE PRIVATE_ENV_FILE' >&2; exit 2; }
image=$1
config=$2
: "${AWS_REGION:?}" "${AWS_LOG_GROUP:?}"
[[ -f "$config" && $(stat -c '%a' "$config") == 600 ]]
docker image inspect "$image" >/dev/null
for name in corodev-backend-before-phase5 corodev-flood-lab-before-phase5; do
  if docker container inspect "$name" >/dev/null 2>&1; then
    echo 'A previous phase5 rollback container already exists; inspect it first.' >&2
    exit 2
  fi
done
rollback() {
  for name in corodev-flood-lab corodev-backend; do
    if docker container inspect "$name" >/dev/null 2>&1; then
      docker stop --time 10 "$name" >/dev/null || true
      docker container rm "$name" >/dev/null || true
    fi
  done
  docker rename corodev-backend-before-phase5 corodev-backend
  docker start corodev-backend >/dev/null
  docker rename corodev-flood-lab-before-phase5 corodev-flood-lab
  docker start corodev-flood-lab >/dev/null
  echo 'Release failed; previous containers restored.' >&2
}
docker stop --time 10 corodev-flood-lab >/dev/null
docker stop --time 10 corodev-backend >/dev/null
docker rename corodev-backend corodev-backend-before-phase5
docker rename corodev-flood-lab corodev-flood-lab-before-phase5
trap rollback ERR
logging=(--log-driver awslogs --log-opt "awslogs-region=$AWS_REGION" --log-opt "awslogs-group=$AWS_LOG_GROUP" --log-opt awslogs-create-group=false)
docker run -d --name corodev-backend --network corodev --env-file "$config" \
  --publish 127.0.0.1:8080:8080 --restart unless-stopped --read-only \
  --cap-drop ALL --security-opt no-new-privileges:true --pids-limit 256 \
  --memory "${BACKEND_MEMORY:-4g}" --cpus "${BACKEND_CPUS:-2}" \
  --tmpfs /tmp:rw,noexec,nosuid,size=16m "${logging[@]}" --log-opt awslogs-stream=backend "$image" >/dev/null
docker run -d --name corodev-flood-lab --network container:corodev-backend \
  --restart unless-stopped --read-only --cap-drop ALL --security-opt no-new-privileges:true \
  --pids-limit 256 --memory 768m --cpus 0.5 --cpu-shares 256 \
  --env GOMAXPROCS=1 --env GOMEMLIMIT=640MiB --tmpfs /tmp:rw,noexec,nosuid,size=16m --no-healthcheck \
  --mount type=bind,src=/var/lib/corodev/flood,dst=/var/lib/corodev \
  "${logging[@]}" --log-opt awslogs-stream=flood-lab \
  --entrypoint /usr/local/bin/corodev-flood-lab "$image" \
  -listen 127.0.0.1:8082 -origin https://sistemamanta.lexinnovate.com -data-dir data \
  -incident-dir /var/lib/corodev/incidents -reference-cache /var/lib/corodev/reference.json \
  -reference-online -operator-session-url http://127.0.0.1:8080/admin/session >/dev/null
healthy=false
for ((attempt=0; attempt<45; attempt++)); do
  if docker exec corodev-backend /usr/local/bin/healthcheck >/dev/null 2>&1 && \
    curl --fail --silent http://127.0.0.1:8080/lab/catalog >/dev/null; then
    healthy=true
    break
  fi
  sleep 1
done
[[ "$healthy" == true ]]
trap - ERR
echo 'Phase5 backend and independent laboratory healthy; rollback containers retained.'
