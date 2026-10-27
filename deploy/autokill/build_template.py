"""Build the reviewed Scheduler/Lambda reconciler without account credentials."""
import argparse
import json
from pathlib import Path


def ref(name):
    return {"Ref": name}


def sub(value):
    return {"Fn::Sub": value}


def attr(name, key):
    return {"Fn::GetAtt": [name, key]}


def allow(actions, resources, **extra):
    return {"Effect": "Allow", "Action": actions, "Resource": resources, **extra}


def build():
    prefix = "${AWS::StackName}"
    iam_roles = [sub("arn:${AWS::Partition}:iam::${AWS::AccountId}:role/" + name) for name in (prefix + "-worker", prefix + "-scheduler", "deploy-cli-ec2-${TargetStackName}")]
    stacks = [ref("TargetStackArn"), sub("arn:${AWS::Partition}:cloudformation:${AWS::Region}:${AWS::AccountId}:stack/${AWS::StackName}/*")]
    buckets = [sub("arn:${AWS::Partition}:s3:::${WebBucket}"), sub("arn:${AWS::Partition}:s3:::${ArtifactBucket}")]
    objects = [sub("arn:${AWS::Partition}:s3:::${WebBucket}/*"), sub("arn:${AWS::Partition}:s3:::${ArtifactBucket}/*")]
    logs = [sub("arn:${AWS::Partition}:logs:${AWS::Region}:${AWS::AccountId}:log-group:/corodev/${TargetStackName}/backend:*"), sub("arn:${AWS::Partition}:logs:${AWS::Region}:${AWS::AccountId}:log-group:/aws/lambda/${AWS::StackName}-worker:*")]
    # CloudWatch tagging APIs require the group ARN without the trailing :*.
    log_groups = [sub("arn:${AWS::Partition}:logs:${AWS::Region}:${AWS::AccountId}:log-group:/corodev/${TargetStackName}/backend"), sub("arn:${AWS::Partition}:logs:${AWS::Region}:${AWS::AccountId}:log-group:/aws/lambda/${AWS::StackName}-worker")]
    policies = [
        allow(["cloudformation:DescribeStacks", "cloudformation:DeleteStack", "cloudformation:DescribeStackEvents", "cloudformation:ListStackResources"], stacks),
        allow(["ec2:DescribeInstances", "ec2:DescribeAddresses", "ec2:DescribeSecurityGroups", "ec2:DescribeNetworkInterfaces", "ec2:DescribeVolumes", "ec2:DescribeInstanceAttribute", "ec2:DescribeInstanceCreditSpecifications", "ec2:DescribeLaunchTemplates"], "*"),
        allow(["ssm:DescribeAssociation", "ssm:ListAssociations"], "*"),
        allow(["ec2:StopInstances", "ec2:TerminateInstances"], sub("arn:${AWS::Partition}:ec2:${AWS::Region}:${AWS::AccountId}:instance/${InstanceId}")),
        allow(["ec2:ReleaseAddress"], ref("ElasticIpAllocationArn")),
        allow(["ec2:DisassociateAddress"], [ref("ElasticIpAllocationArn"), ref("NetworkInterfaceArn")]),
        allow(["ec2:DeleteSecurityGroup"], sub("arn:${AWS::Partition}:ec2:${AWS::Region}:${AWS::AccountId}:security-group/${SecurityGroupId}")),
        allow(["s3:ListBucket", "s3:ListBucketVersions", "s3:ListBucketMultipartUploads", "s3:DeleteBucket", "s3:DeleteBucketPolicy", "s3:GetBucketPolicy", "s3:GetBucketLocation", "s3:GetBucketTagging"], buckets),
        allow(["s3:DeleteObject", "s3:DeleteObjectVersion", "s3:AbortMultipartUpload"], objects),
        allow(["cloudfront:GetDistribution", "cloudfront:GetDistributionConfig", "cloudfront:UpdateDistribution", "cloudfront:DeleteDistribution", "cloudfront:ListTagsForResource"], sub("arn:${AWS::Partition}:cloudfront::${AWS::AccountId}:distribution/${DistributionId}")),
        allow(["cloudfront:DescribeFunction", "cloudfront:GetFunction", "cloudfront:DeleteFunction", "cloudfront:ListTagsForResource"], sub("arn:${AWS::Partition}:cloudfront::${AWS::AccountId}:function/${TargetStackName}-spa")),
        allow(["cloudfront:GetOriginAccessControl", "cloudfront:GetOriginAccessControlConfig", "cloudfront:DeleteOriginAccessControl"], sub("arn:${AWS::Partition}:cloudfront::${AWS::AccountId}:origin-access-control/${OriginAccessControlId}")),
        allow(["iam:GetRole", "iam:DeleteRole", "iam:ListRolePolicies", "iam:GetRolePolicy", "iam:DeleteRolePolicy", "iam:ListAttachedRolePolicies", "iam:DetachRolePolicy", "iam:ListInstanceProfilesForRole", "iam:TagRole", "iam:UntagRole"], iam_roles),
        allow(["iam:GetInstanceProfile", "iam:RemoveRoleFromInstanceProfile", "iam:DeleteInstanceProfile"], sub("arn:${AWS::Partition}:iam::${AWS::AccountId}:instance-profile/deploy-cli-ec2-${TargetStackName}")),
        allow(["logs:CreateLogStream", "logs:PutLogEvents", "logs:DescribeLogStreams", "logs:DeleteLogGroup", "logs:DeleteDataProtectionPolicy"], logs),
        allow(["logs:ListTagsForResource"], log_groups),
        allow(["logs:DescribeLogGroups"], "*"),
        allow(["cloudwatch:DescribeAlarms", "cloudwatch:DeleteAlarms", "cloudwatch:ListTagsForResource"], ref("AlarmArn")),
        allow(["acm:DescribeCertificate", "acm:DeleteCertificate"], ref("CertificateArn")),
        allow(["lambda:GetFunction", "lambda:GetFunctionConfiguration", "lambda:DeleteFunction", "lambda:GetFunctionEventInvokeConfig", "lambda:DeleteFunctionEventInvokeConfig", "lambda:ListTags"], sub("arn:${AWS::Partition}:lambda:${AWS::Region}:${AWS::AccountId}:function:${AWS::StackName}-worker")),
        allow(["scheduler:GetSchedule", "scheduler:DeleteSchedule"], sub("arn:${AWS::Partition}:scheduler:${AWS::Region}:${AWS::AccountId}:schedule/${AWS::StackName}/*")),
        allow(["scheduler:GetScheduleGroup", "scheduler:DeleteScheduleGroup", "scheduler:ListTagsForResource"], sub("arn:${AWS::Partition}:scheduler:${AWS::Region}:${AWS::AccountId}:schedule-group/${AWS::StackName}")),
        allow(["sqs:DeleteQueue", "sqs:GetQueueAttributes", "sqs:ListQueueTags", "sqs:SendMessage"], sub("arn:${AWS::Partition}:sqs:${AWS::Region}:${AWS::AccountId}:${AWS::StackName}-failures")),
    ]
    destructive = sorted({action for statement in policies for action in statement["Action"]
                          if not action.split(":", 1)[1].startswith(("Get", "List", "Describe"))
                          and action not in ("logs:CreateLogStream", "logs:PutLogEvents", "sqs:SendMessage")})
    # Temporal Deny statements bound the scoped grants without duplicating every
    # ARN/condition pair and exceeding IAM's 10 KiB aggregate inline-policy cap.
    policies.extend([
        {"Effect": "Deny", "Action": destructive, "Resource": "*", "Condition": {"DateLessThan": {"aws:CurrentTime": ref("ExpiresAtUtc")}}},
        {"Effect": "Deny", "Action": "*", "Resource": "*", "Condition": {"DateGreaterThanEquals": {"aws:CurrentTime": ref("AuthorizationUntilUtc")}}},
    ])
    context = lambda why, must: {"com.aws.cloudformation.Context": {"why": why, "must": must}}
    resources = {
        "WorkerRole": {"Type": "AWS::IAM::Role", "DeletionPolicy": "Retain", "UpdateReplacePolicy": "Retain", "Metadata": context("Deletes the exact approved deployment. Retain until helper deletion completes, then the running worker revokes its own policy and attempts final role removal.", ["Scope destructive actions to recorded resources", "Do not invalidate the caller role during CloudFormation deletion", "All permissions expire even if final role removal is denied"]), "Properties": {
            "RoleName": sub(prefix + "-worker"), "AssumeRolePolicyDocument": {"Version": "2012-10-17", "Statement": [{"Effect": "Allow", "Principal": {"Service": "lambda.amazonaws.com"}, "Action": "sts:AssumeRole"}]},
            "Policies": [{"PolicyName": "ApprovedDeploymentExpiry", "PolicyDocument": {"Version": "2012-10-17", "Statement": policies}}]}},
        "WorkerLogs": {"Type": "AWS::Logs::LogGroup", "DependsOn": "WorkerRole", "Properties": {"LogGroupName": sub("/aws/lambda/" + prefix + "-worker"), "RetentionInDays": 7}},
        "Failures": {"Type": "AWS::SQS::Queue", "DependsOn": "WorkerRole", "Properties": {"QueueName": sub(prefix + "-failures"), "SqsManagedSseEnabled": True, "MessageRetentionPeriod": 1209600}},
        "Worker": {"Type": "AWS::Lambda::Function", "DependsOn": "WorkerLogs", "Metadata": context("Stateless bounded reconciler waits for CloudFront/CloudFormation across scheduled invocations, then removes retained versions and itself.", ["Never mutate before the immutable deadline", "Never accept resource IDs from invocation input", "Preserve the external account budget and shared network"]), "Properties": {
            "FunctionName": sub(prefix + "-worker"), "Runtime": "python3.13", "Handler": "index.handler", "Role": attr("WorkerRole", "Arn"), "MemorySize": 256, "Timeout": 300, "ReservedConcurrentExecutions": 1,
            "Code": {"ZipFile": Path(__file__).with_name("handler.py").read_text()},
            "Environment": {"Variables": {"AWS_ACCOUNT_ID": ref("AWS::AccountId"), "HELPER_STACK_ID": ref("AWS::StackId"), "WORKER_ROLE_NAME": ref("WorkerRole"), "TARGET_CONFIGURATION": {"Fn::Sub": json.dumps({"stack_name": "${TargetStackName}", "stack_arn": "${TargetStackArn}", "instance_id": "${InstanceId}", "buckets": ["${WebBucket}", "${ArtifactBucket}"], "certificate_arn": "${CertificateArn}", "web_domain": "${WebDomain}", "expires_at_utc": "${ExpiresAtUtc}"})}}}}},
        "WorkerRetries": {"Type": "AWS::Lambda::EventInvokeConfig", "Properties": {"FunctionName": ref("Worker"), "Qualifier": "$LATEST", "MaximumRetryAttempts": 2, "MaximumEventAgeInSeconds": 3600, "DestinationConfig": {"OnFailure": {"Destination": attr("Failures", "Arn")}}}},
        "Group": {"Type": "AWS::Scheduler::ScheduleGroup", "DependsOn": "WorkerRole", "Properties": {"Name": ref("AWS::StackName")}},
        "SchedulerRole": {"Type": "AWS::IAM::Role", "DependsOn": "WorkerRole", "Metadata": context("Scheduler may invoke only this reconciler or stop the recorded EC2 as a separate billing failsafe.", ["Restrict trust to the exact scheduler group and account"]), "Properties": {
            "RoleName": sub(prefix + "-scheduler"), "AssumeRolePolicyDocument": {"Version": "2012-10-17", "Statement": [{"Effect": "Allow", "Principal": {"Service": "scheduler.amazonaws.com"}, "Action": "sts:AssumeRole", "Condition": {"StringEquals": {"aws:SourceAccount": ref("AWS::AccountId")}, "ArnEquals": {"aws:SourceArn": sub("arn:${AWS::Partition}:scheduler:${AWS::Region}:${AWS::AccountId}:schedule-group/${AWS::StackName}")}}}]},
            "Policies": [{"PolicyName": "InvokeExpiryAndStopOnly", "PolicyDocument": {"Version": "2012-10-17", "Statement": [allow(["lambda:InvokeFunction"], attr("Worker", "Arn")), allow(["ec2:StopInstances"], sub("arn:${AWS::Partition}:ec2:${AWS::Region}:${AWS::AccountId}:instance/${InstanceId}")), allow(["sqs:SendMessage"], attr("Failures", "Arn"))]}}]}},
    }
    target = {"RoleArn": attr("SchedulerRole", "Arn"), "RetryPolicy": {"MaximumEventAgeInSeconds": 86400, "MaximumRetryAttempts": 24}, "DeadLetterConfig": {"Arn": attr("Failures", "Arn")}}
    resources["CleanupSchedule"] = {"Type": "AWS::Scheduler::Schedule", "Metadata": context("Runs once per minute starting at expiry until complete; no laptop or EC2 uptime dependency.", ["The first invocation is after the approved four-day deadline", "Deletion is irreversible and includes S3 historical versions"]), "Properties": {"Name": "cleanup", "GroupName": ref("Group"), "ScheduleExpression": "rate(1 minute)", "StartDate": ref("ScheduleAtUtc"), "EndDate": ref("AuthorizationUntilUtc"), "FlexibleTimeWindow": {"Mode": "OFF"}, "State": "ENABLED", "Target": {**target, "Arn": attr("Worker", "Arn"), "Input": '{"mode":"execute"}'}}}
    resources["StopSchedule"] = {"Type": "AWS::Scheduler::Schedule", "Properties": {"Name": "stop-instance", "GroupName": ref("Group"), "ScheduleExpression": sub("at(${ScheduleAtExpression})"), "ScheduleExpressionTimezone": "UTC", "FlexibleTimeWindow": {"Mode": "OFF"}, "State": "ENABLED", "Target": {**target, "Arn": "arn:aws:scheduler:::aws-sdk:ec2:stopInstances", "Input": {"Fn::Sub": '{"InstanceIds":["${InstanceId}"]}'}}}}
    parameters = {name: {"Type": "String"} for name in ("TargetStackName", "TargetStackArn", "InstanceId", "WebBucket", "ArtifactBucket", "CertificateArn", "WebDomain", "ExpiresAtUtc", "ScheduleAtUtc", "ScheduleAtExpression", "AuthorizationUntilUtc", "ElasticIpAllocationArn", "NetworkInterfaceArn", "SecurityGroupId", "DistributionId", "OriginAccessControlId", "AlarmArn")}
    parameters["TargetStackName"]["AllowedValues"] = ["corodev-phase2"]
    return {"AWSTemplateFormatVersion": "2010-09-09", "Description": "Owner-authorized four-day CoroDev expiration. Stop EC2, delete the exact stack, retained S3 versions and its dedicated ACM certificate, then remove this helper. Preserve the external budget and shared VPC/subnet.", "Metadata": {"AWSToolsMetrics": {"AWSAgentToolkit": "aws-cloudformation@3"}}, "Parameters": parameters, "Resources": resources, "Outputs": {"WorkerName": {"Value": ref("Worker")}, "ScheduleGroup": {"Value": ref("Group")}, "ExpiresAtUtc": {"Value": ref("ExpiresAtUtc")}}}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    args.output.write_text(json.dumps(build(), indent=2) + "\n")


if __name__ == "__main__":
    main()
