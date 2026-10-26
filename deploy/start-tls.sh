#!/usr/bin/env bash
set -euo pipefail
: "${API_DOMAIN:?Set an authorized DNS name resolving to this host}" "${TLS_EMAIL:?Set the certificate contact email}"
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
docker network inspect corodev >/dev/null
docker run -d --name corodev-tls --network corodev --restart unless-stopped \
  --cap-drop ALL --cap-add NET_BIND_SERVICE --security-opt no-new-privileges:true \
  --publish 80:80 --publish 443:443 --publish 443:443/udp \
  --env API_DOMAIN --env TLS_EMAIL \
  --mount "type=bind,src=$script_dir/Caddyfile,dst=/etc/caddy/Caddyfile,readonly" \
  --mount type=volume,src=corodev-caddy-data,dst=/data \
  --mount type=volume,src=corodev-caddy-config,dst=/config \
  --log-driver json-file --log-opt max-size=5m --log-opt max-file=3 \
  caddy:2-alpine@sha256:eb4d35b7452d1ab6171fbdbe8d9275b2301dad6dad92115d91e19fb9b24d510f >/dev/null
echo "TLS proxy started; verify certificate issuance and external HTTPS before publishing the URL"
