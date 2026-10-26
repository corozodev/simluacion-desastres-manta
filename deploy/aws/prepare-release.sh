#!/usr/bin/env bash
# Local packaging only; no AWS API is invoked.
set -euo pipefail
[[ $# -eq 2 ]] || { echo "Usage: $0 EXISTING_IMAGE OUTPUT_DIRECTORY" >&2; exit 2; }
image=$1
destination=$2
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
image_platform=$(docker image inspect --format '{{.Os}}/{{.Architecture}}' "$image")
[[ $image_platform == linux/amd64 ]] || { echo "The EC2 template requires a linux/amd64 image; rebuild with --platform linux/amd64" >&2; exit 2; }
# Refuse an existing directory so a later tar of this bundle cannot include stale
# files, credentials or artifacts from a previous release.
mkdir -m 700 "$destination"
mkdir -m 700 "$destination/deploy"
docker save "$image" | gzip > "$destination/backend-image.tar.gz"
cp "$script_dir"/../{start-backend,rollout,rollback,start-tls}.sh "$script_dir/../Caddyfile" "$destination/deploy/"
printf '%s\n' "$image" > "$destination/image-reference.txt"
printf '%s\n' "$image_platform" > "$destination/image-platform.txt"
(cd "$destination" && sha256sum backend-image.tar.gz image-reference.txt image-platform.txt deploy/* > SHA256SUMS)
echo "Release bundle prepared locally; no secrets included"
