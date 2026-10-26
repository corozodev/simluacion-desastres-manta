#!/usr/bin/env bash
set -euo pipefail
docker container inspect corodev-backend-previous >/dev/null
if docker container inspect corodev-backend >/dev/null 2>&1; then
  docker stop --time 10 corodev-backend >/dev/null
  docker rm corodev-backend >/dev/null
fi
docker rename corodev-backend-previous corodev-backend
docker start corodev-backend >/dev/null
echo "Previous image/configuration restarted; simulation begins again from its seed"
