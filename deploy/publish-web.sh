#!/usr/bin/env bash
# Publish the complete Vite output, including public sprites. Existing hashed
# assets remain available to already-open clients. Credentials stay in AWS CLI.
set -euo pipefail
[[ $# -eq 4 ]] || { echo 'Usage: publish-web.sh DIST_DIRECTORY WEB_BUCKET CLOUDFRONT_ID REGION' >&2; exit 2; }
dist=$1
bucket=$2
distribution=$3
region=$4
aws_bin=${AWS_BIN:-aws}
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
python3 - "$dist" "$script_dir/../packages/visualization/catalog.json" <<'PY'
import hashlib,json,pathlib,sys
root=pathlib.Path(sys.argv[1])
if not (root/'index.html').is_file() or not list((root/'assets').glob('*.js')):
    raise SystemExit('Build the complete React production output before publishing.')
for asset in json.loads(pathlib.Path(sys.argv[2]).read_text())['assets']:
    path=root/'visualization'/asset['file']
    if not path.is_file() or hashlib.sha256(path.read_bytes()).hexdigest()!=asset['sha256']:
        raise SystemExit('A required public visualization asset is missing or differs from the source catalog.')
PY
"$aws_bin" s3 sync "$dist/assets/" "s3://$bucket/assets/" --region "$region" \
  --cache-control 'public,max-age=31536000,immutable' --only-show-errors
"$aws_bin" s3 sync "$dist/" "s3://$bucket/" --region "$region" \
  --exclude 'index.html' --exclude 'assets/*' \
  --cache-control 'public,max-age=3600,must-revalidate' --only-show-errors
# Index is last: every referenced chunk and public resource is present first.
"$aws_bin" s3 cp "$dist/index.html" "s3://$bucket/index.html" --region "$region" \
  --cache-control 'no-cache,no-store,must-revalidate' --content-type 'text/html; charset=utf-8' --only-show-errors
"$aws_bin" cloudfront create-invalidation --distribution-id "$distribution" --paths '/*' \
  --query 'Invalidation.Id' --output text
