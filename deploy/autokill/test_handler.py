import datetime as dt
import importlib.util
import json
import os
import sys
import types
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch


class ApiError(Exception):
    def __init__(self, code, message='test error'):
        self.response = {'Error': {'Code': code, 'Message': message}}


# AWS supplies boto3 in Lambda. Tests isolate destructive clients completely.
modules = {'boto3': types.ModuleType('boto3'), 'botocore': types.ModuleType('botocore'), 'botocore.config': types.ModuleType('botocore.config'), 'botocore.exceptions': types.ModuleType('botocore.exceptions')}
modules['boto3'].client = MagicMock()
modules['botocore.config'].Config = MagicMock()
modules['botocore.exceptions'].ClientError = ApiError
with patch.dict(sys.modules, modules):
    spec = importlib.util.spec_from_file_location('expiry_handler', Path(__file__).with_name('handler.py'))
    handler = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(handler)


class ExpiryTests(unittest.TestCase):
    def setUp(self):
        self.config = {'stack_name': 'corodev-phase2', 'stack_arn': 'arn:aws:cloudformation:us-east-2:123456789012:stack/corodev-phase2/approved', 'instance_id': 'i-approved', 'buckets': ['corodev-phase2-webbucket-approved', 'corodev-phase2-artifactbucket-approved'], 'certificate_arn': 'arn:aws:acm:us-east-1:123456789012:certificate/approved', 'web_domain': 'sistemamanta.lexinnovate.com', 'expires_at_utc': '2026-10-31T06:45:51Z'}
        self.env = patch.dict(os.environ, {'AWS_REGION': 'us-east-2', 'AWS_ACCOUNT_ID': '123456789012', 'TARGET_CONFIGURATION': json.dumps(self.config), 'HELPER_STACK_ID': 'arn:aws:cloudformation:us-east-2:123456789012:stack/corodev-expiry/approved', 'WORKER_ROLE_NAME': 'expiry-worker'})
        self.env.start(); self.addCleanup(self.env.stop)
        self.clients = {name: MagicMock() for name in ('cloudformation', 'ec2', 's3', 'acm', 'iam')}
        for value in self.clients.values():
            value.exceptions.ResourceNotFoundException = type('Missing', (Exception,), {})
            value.exceptions.ResourceInUseException = type('Used', (Exception,), {})
        self.clients['cloudformation'].describe_stacks.return_value = {'Stacks': [{'StackStatus': 'CREATE_COMPLETE'}]}
        self.clients['ec2'].describe_instances.return_value = {'Reservations': [{'Instances': [{'State': {'Name': 'running'}}]}]}
        self.clients['acm'].describe_certificate.return_value = {'Certificate': {'InUseBy': [], 'SubjectAlternativeNames': [self.config['web_domain']]}}
        self.clients['s3'].delete_objects.return_value = {}
        self.clients['s3'].get_paginator.return_value.paginate.return_value = []
        self.factory = patch.object(handler, 'client', side_effect=lambda name, region=None: self.clients[name]); self.factory.start(); self.addCleanup(self.factory.stop)
        self.clock = patch.object(handler, 'now', return_value=dt.datetime(2026, 11, 1, tzinfo=dt.timezone.utc)); self.clock.start(); self.addCleanup(self.clock.stop)
        self.context = MagicMock(); self.context.get_remaining_time_in_millis.return_value = 90000

    def invoke(self, mode='execute', **extra):
        return handler.handler({'mode': mode, **extra}, self.context)

    def test_early_execute_never_mutates_resources(self):
        handler.now.return_value = dt.datetime(2026, 10, 30, tzinfo=dt.timezone.utc)
        self.assertEqual(self.invoke()['phase'], 'waiting_for_deadline')
        self.clients['ec2'].stop_instances.assert_not_called()
        self.clients['cloudformation'].delete_stack.assert_not_called()
        self.clients['s3'].delete_bucket.assert_not_called()

    def test_plan_is_read_only_even_after_expiry(self):
        self.assertTrue(self.invoke('plan')['dry_run'])
        self.clients['cloudformation'].delete_stack.assert_not_called()
        self.clients['ec2'].stop_instances.assert_not_called()

    def test_input_cannot_redirect_or_advance_expiration(self):
        self.invoke(stack_arn='another-stack', expires_at_utc='2000-01-01T00:00:00Z', instance_id='another-instance')
        self.clients['ec2'].stop_instances.assert_called_once_with(InstanceIds=['i-approved'])
        self.clients['cloudformation'].delete_stack.assert_called_once_with(StackName=self.config['stack_arn'])

    def test_invalid_resource_scope_is_rejected(self):
        self.config['buckets'][0] = 'unrelated-data'
        os.environ['TARGET_CONFIGURATION'] = json.dumps(self.config)
        with self.assertRaises(ValueError): self.invoke()
        self.clients['cloudformation'].delete_stack.assert_not_called()

    def test_in_progress_deletion_is_not_started_again(self):
        self.clients['cloudformation'].describe_stacks.return_value['Stacks'][0]['StackStatus'] = 'DELETE_IN_PROGRESS'
        self.assertEqual(self.invoke()['phase'], 'deleting_stack')
        self.clients['cloudformation'].delete_stack.assert_not_called()

    def test_finished_stack_removes_versions_markers_uploads_and_helper(self):
        self.clients['cloudformation'].describe_stacks.return_value['Stacks'][0]['StackStatus'] = 'DELETE_COMPLETE'
        pages = {'list_multipart_uploads': [{'Uploads': [{'Key': 'partial', 'UploadId': 'part-1'}]}], 'list_object_versions': [{'Versions': [{'Key': 'index.html', 'VersionId': 'old'}], 'DeleteMarkers': [{'Key': 'index.html', 'VersionId': 'marker'}]}], 'list_objects_v2': []}
        self.clients['s3'].get_paginator.side_effect = lambda name: types.SimpleNamespace(paginate=lambda **kwargs: pages[name])
        self.assertEqual(self.invoke()['phase'], 'deleted')
        calls = self.clients['s3'].delete_objects.call_args_list
        self.assertEqual(calls[0].kwargs['Delete']['Objects'], [{'Key': 'index.html', 'VersionId': 'old'}, {'Key': 'index.html', 'VersionId': 'marker'}])
        self.assertEqual(len(calls), 2)
        self.assertEqual(self.clients['s3'].delete_bucket.call_count, 2)
        self.clients['acm'].delete_certificate.assert_called_once_with(CertificateArn=self.config['certificate_arn'])
        self.clients['cloudformation'].delete_stack.assert_called_once_with(StackName=os.environ['HELPER_STACK_ID'])

    def test_shared_certificate_is_preserved_and_retried(self):
        self.clients['cloudformation'].describe_stacks.return_value['Stacks'][0]['StackStatus'] = 'DELETE_COMPLETE'
        self.clients['acm'].describe_certificate.return_value['Certificate']['InUseBy'] = ['another-distribution']
        self.assertEqual(self.invoke()['phase'], 'waiting_for_certificate_detachment')
        self.clients['acm'].delete_certificate.assert_not_called()
        self.clients['cloudformation'].delete_stack.assert_not_called()

    def test_partial_s3_errors_never_report_success(self):
        self.clients['cloudformation'].describe_stacks.return_value['Stacks'][0]['StackStatus'] = 'DELETE_COMPLETE'
        self.clients['s3'].get_paginator.return_value.paginate.return_value = [{'Versions': [{'Key': 'object', 'VersionId': 'version'}]}]
        self.clients['s3'].delete_objects.return_value = {'Errors': [{'Code': 'AccessDenied'}]}
        with self.assertRaises(RuntimeError): self.invoke()
        self.clients['s3'].delete_bucket.assert_not_called()
        self.clients['cloudformation'].delete_stack.assert_not_called()

    def test_time_budget_keeps_helper_for_next_poll(self):
        self.clients['cloudformation'].describe_stacks.return_value['Stacks'][0]['StackStatus'] = 'DELETE_COMPLETE'
        self.clients['s3'].get_paginator.return_value.paginate.return_value = [{'Versions': []}]
        self.context.get_remaining_time_in_millis.return_value = 1000
        self.assertEqual(self.invoke()['phase'], 'emptying_retained_buckets')
        self.clients['cloudformation'].delete_stack.assert_not_called()

    def test_unknown_aws_failure_is_not_swallowed(self):
        self.clients['cloudformation'].describe_stacks.side_effect = ApiError('AccessDenied', 'Not authorized')
        with self.assertRaises(ApiError): self.invoke()

    def test_final_role_revocation_precedes_best_effort_removal(self):
        self.clients['cloudformation'].describe_stacks.return_value['Stacks'][0]['StackStatus'] = 'DELETE_COMPLETE'
        self.clients['iam'].delete_role.side_effect = ApiError('AccessDenied', 'Revocation propagated')
        self.assertEqual(self.invoke()['role_cleanup'], 'inert_or_already_deleted')
        self.assertEqual([call[0] for call in self.clients['iam'].mock_calls], ['delete_role_policy', 'delete_role'])

    def test_slow_helper_deletion_keeps_role_available_to_cloudformation(self):
        self.clients['cloudformation'].describe_stacks.return_value['Stacks'][0]['StackStatus'] = 'DELETE_COMPLETE'
        self.context.get_remaining_time_in_millis.return_value = 14000
        self.assertEqual(self.invoke()['phase'], 'deleting_helper')
        self.clients['iam'].delete_role_policy.assert_not_called()


if __name__ == '__main__':
    unittest.main()
