#!/usr/bin/env bash
# Read-only identity verification; explicitly choose the region/account first.
set -euo pipefail
: "${AWS_REGION:?Set the region authorized by the competition}" "${EXPECTED_AWS_ACCOUNT_ID:?Set the authorized 12-digit account ID}"
command -v aws >/dev/null || { echo "AWS CLI is not installed" >&2; exit 2; }
[[ $EXPECTED_AWS_ACCOUNT_ID =~ ^[0-9]{12}$ ]] || { echo "Invalid expected account ID" >&2; exit 2; }
identity=$(aws sts get-caller-identity --region "$AWS_REGION" --query '[Account,Arn]' --output text)
read -r actual principal_arn <<< "$identity"
[[ $actual == "$EXPECTED_AWS_ACCOUNT_ID" ]] || { echo "Authenticated account differs from expected account; no changes made" >&2; exit 2; }
[[ $principal_arn != *:root ]] || { echo "Root identity is forbidden for this deployment; use an IAM identity or temporary role. No changes made" >&2; exit 2; }
echo "AWS identity matches the expected account"
echo "Region was supplied by the operator; authorization, IAM permissions and Budget still require verification"
