import json
from io import StringIO
from unittest.mock import patch

from django.core.management import call_command
from django.test import TestCase

from core.release_readiness import get_release_hygiene_payload


class ReleaseHygieneTests(TestCase):
    @patch('core.release_readiness._run_git_command')
    def test_release_hygiene_payload_tracks_open_changes_and_artifacts(self, mock_run_git_command):
        def fake_run(args, cwd):
            key = tuple(args)
            if key == ('rev-parse', '--abbrev-ref', 'HEAD'):
                return {'ok': True, 'stdout': 'release/2026.03', 'stderr': ''}
            if key == ('rev-parse', 'HEAD'):
                return {'ok': True, 'stdout': 'abc123', 'stderr': ''}
            if key == ('describe', '--tags', '--abbrev=0'):
                return {'ok': True, 'stdout': 'v2026.03.22', 'stderr': ''}
            if key == ('status', '--short'):
                return {
                    'ok': True,
                    'stdout': '\n'.join([
                        ' M backend/core/views.py',
                        '?? backend/core/management/commands/performance_readiness.py',
                        '?? backend/finance/migrations/0008_budgetplan.py',
                        '?? backend-dev.log',
                    ]),
                    'stderr': '',
                }
            return {'ok': False, 'stdout': '', 'stderr': 'unexpected'}

        mock_run_git_command.side_effect = fake_run

        payload = get_release_hygiene_payload()

        self.assertEqual(payload['branch'], 'release/2026.03')
        self.assertEqual(payload['commit_sha'], 'abc123')
        self.assertEqual(payload['counts']['modified'], 1)
        self.assertEqual(payload['counts']['untracked'], 3)
        self.assertIn('backend/finance/migrations/0008_budgetplan.py', payload['migration_candidates'])
        self.assertIn('backend-dev.log', payload['artifact_candidates'])
        self.assertEqual(payload['status'], 'warning')

    @patch('core.release_readiness._run_git_command')
    def test_release_hygiene_command_supports_json_output(self, mock_run_git_command):
        mock_run_git_command.side_effect = lambda args, cwd: {
            ('rev-parse', '--abbrev-ref', 'HEAD'): {'ok': True, 'stdout': 'main', 'stderr': ''},
            ('rev-parse', 'HEAD'): {'ok': True, 'stdout': 'def456', 'stderr': ''},
            ('describe', '--tags', '--abbrev=0'): {'ok': False, 'stdout': '', 'stderr': ''},
            ('status', '--short'): {'ok': True, 'stdout': '', 'stderr': ''},
        }[tuple(args)]

        stdout = StringIO()
        call_command('release_hygiene', '--json', stdout=stdout)
        payload = json.loads(stdout.getvalue())

        self.assertEqual(payload['branch'], 'main')
        self.assertEqual(payload['status'], 'ok')
