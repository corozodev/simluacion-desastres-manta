"""Reconcile expiration of one exact CoroDev deployment; never runs early."""
import datetime as dt
import json
import logging
import os
import time

import boto3
from botocore.config import Config
from botocore.exceptions import ClientError

LOGGER = logging.getLogger(__name__)
LOGGER.setLevel(logging.INFO)
SDK_CONFIG = Config(retries={"mode": "standard", "total_max_attempts": 4}, connect_timeout=5, read_timeout=15)
CLIENTS = {}


def client(service, region=None):
    key = (service, region or os.environ["AWS_REGION"])
    if key not in CLIENTS:
        CLIENTS[key] = boto3.client(service, region_name=key[1], config=SDK_CONFIG)
    return CLIENTS[key]


def now():
    return dt.datetime.now(dt.timezone.utc)


def configuration():
    config = json.loads(os.environ["TARGET_CONFIGURATION"])
    account = os.environ["AWS_ACCOUNT_ID"]
    region = os.environ["AWS_REGION"]
    expected = f"arn:aws:cloudformation:{region}:{account}:stack/{config['stack_name']}/"
    if not config["stack_arn"].startswith(expected):
        raise ValueError("Unexpected target stack scope")
    if config["stack_name"] != "corodev-phase2" or len(config["buckets"]) != 2:
        raise ValueError("Only the approved CoroDev deployment is supported")
    if not all(name.startswith(config["stack_name"] + "-") for name in config["buckets"]):
        raise ValueError("Unexpected bucket scope")
    if not config["certificate_arn"].startswith(f"arn:aws:acm:us-east-1:{account}:certificate/"):
        raise ValueError("Unexpected certificate scope")
    return config


def stack_status(arn):
    try:
        return client("cloudformation").describe_stacks(StackName=arn)["Stacks"][0]["StackStatus"]
    except ClientError as error:
        # CloudFormation does not model a distinct StackNotFound exception.
        if error.response["Error"]["Code"] == "ValidationError" and "does not exist" in error.response["Error"]["Message"]:
            return "DELETE_COMPLETE"
        raise


def stop_instance(instance_id):
    ec2 = client("ec2")
    try:
        reservations = ec2.describe_instances(InstanceIds=[instance_id])["Reservations"]
        states = [i["State"]["Name"] for r in reservations for i in r["Instances"]]
        if any(state in ("running", "pending") for state in states):
            ec2.stop_instances(InstanceIds=[instance_id])
    except ClientError as error:
        # EC2 exposes these idempotent absence/state errors through ClientError.
        if error.response["Error"]["Code"] not in ("InvalidInstanceID.NotFound", "IncorrectInstanceState"):
            raise


def empty_and_delete_bucket(bucket, account, context):
    s3 = client("s3")
    try:
        for page in s3.get_paginator("list_multipart_uploads").paginate(Bucket=bucket, ExpectedBucketOwner=account):
            for upload in page.get("Uploads", []):
                s3.abort_multipart_upload(Bucket=bucket, Key=upload["Key"], UploadId=upload["UploadId"], ExpectedBucketOwner=account)
        # Include every historical version and delete marker, not just current objects.
        for page in s3.get_paginator("list_object_versions").paginate(Bucket=bucket, ExpectedBucketOwner=account):
            objects = [{"Key": item["Key"], "VersionId": item["VersionId"]} for group in ("Versions", "DeleteMarkers") for item in page.get(group, [])]
            for offset in range(0, len(objects), 1000):
                result = s3.delete_objects(Bucket=bucket, Delete={"Objects": objects[offset:offset + 1000], "Quiet": True}, ExpectedBucketOwner=account)
                if result.get("Errors"):
                    raise RuntimeError("S3 rejected deletion of one or more approved versions")
            if context.get_remaining_time_in_millis() < 15000:
                return False
        for page in s3.get_paginator("list_objects_v2").paginate(Bucket=bucket, ExpectedBucketOwner=account):
            objects = [{"Key": item["Key"]} for item in page.get("Contents", [])]
            if objects:
                result = s3.delete_objects(Bucket=bucket, Delete={"Objects": objects, "Quiet": True}, ExpectedBucketOwner=account)
                if result.get("Errors"):
                    raise RuntimeError("S3 rejected deletion of approved current objects")
        s3.delete_bucket(Bucket=bucket, ExpectedBucketOwner=account)
        return True
    except ClientError as error:
        if error.response["Error"]["Code"] in ("NoSuchBucket", "404"):
            return True
        if error.response["Error"]["Code"] == "BucketNotEmpty":
            return False
        raise


def delete_certificate(config):
    acm = client("acm", "us-east-1")
    try:
        certificate = acm.describe_certificate(CertificateArn=config["certificate_arn"])["Certificate"]
        if certificate.get("InUseBy"):
            return False
        if sorted(certificate["SubjectAlternativeNames"]) != [config["web_domain"]]:
            raise ValueError("Certificate identity changed; refusing deletion")
        acm.delete_certificate(CertificateArn=config["certificate_arn"])
        return True
    except acm.exceptions.ResourceNotFoundException:
        return True
    except acm.exceptions.ResourceInUseException:
        return False


def handler(event, context):
    config = configuration()
    expiry = dt.datetime.fromisoformat(config["expires_at_utc"].replace("Z", "+00:00"))
    status = stack_status(config["stack_arn"])
    plan = {"target_stack": config["stack_name"], "expires_at_utc": config["expires_at_utc"], "status": status, "buckets": config["buckets"], "instance_id": config["instance_id"]}
    # The event never supplies resource IDs, deadlines, or a bypass flag.
    if event.get("mode") == "plan":
        return {**plan, "dry_run": True, "eligible": now() >= expiry}
    if event.get("mode") != "execute":
        raise ValueError("Expected plan or execute mode")
    if now() < expiry:
        return {"phase": "waiting_for_deadline", "expires_at_utc": config["expires_at_utc"]}
    if status != "DELETE_COMPLETE":
        stop_instance(config["instance_id"])
        if status != "DELETE_IN_PROGRESS":
            client("cloudformation").delete_stack(StackName=config["stack_arn"])
        LOGGER.info(json.dumps({"event": "autokill_stack_deletion", "status": status, "stack": config["stack_name"]}))
        return {"phase": "deleting_stack"}
    for bucket in config["buckets"]:
        if not empty_and_delete_bucket(bucket, os.environ["AWS_ACCOUNT_ID"], context):
            return {"phase": "emptying_retained_buckets"}
    if not delete_certificate(config):
        return {"phase": "waiting_for_certificate_detachment"}
    LOGGER.info(json.dumps({"event": "autokill_project_deleted", "stack": config["stack_name"]}))
    # Delete the helper only after all project resources and retained data are gone.
    helper = os.environ["HELPER_STACK_ID"]
    client("cloudformation").delete_stack(StackName=helper)
    # Retain the caller role while CloudFormation deletes the helper. Removing
    # it in that operation invalidates CloudFormation's temporary credentials.
    # An invocation already in flight survives deletion of its Lambda function.
    while context.get_remaining_time_in_millis() > 15000:
        if stack_status(helper) == "DELETE_COMPLETE":
            iam = client("iam")
            role = os.environ["WORKER_ROLE_NAME"]
            iam.delete_role_policy(RoleName=role, PolicyName="ApprovedDeploymentExpiry")
            try:
                iam.delete_role(RoleName=role)
                return {"phase": "deleted", "role_cleanup": "deleted"}
            except ClientError as error:
                if error.response["Error"]["Code"] not in ("AccessDenied", "AccessDeniedException", "InvalidClientTokenId", "NoSuchEntity"):
                    raise
                # If revocation propagates before the final request, only an
                # inert, policy-free IAM role remains; it has no usage charges.
                return {"phase": "deleted", "role_cleanup": "inert_or_already_deleted"}
        time.sleep(3)
    return {"phase": "deleting_helper", "role_cleanup": "check_if_provider_delays_exceed_function_timeout"}
