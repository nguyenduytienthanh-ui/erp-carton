from io import StringIO

from django.core.management import call_command
from django.test import TestCase


class PreflightCommandTest(TestCase):
    def test_preflight_command_runs_and_reports_status(self):
        stdout = StringIO()
        call_command('preflight_check', stdout=stdout)
        output = stdout.getvalue()
        self.assertIn('Preflight status:', output)
        self.assertIn('database:', output)
        self.assertIn('jwt_sessions:', output)
        self.assertIn('email:', output)
        self.assertIn('audit_controls:', output)

    def test_preflight_command_supports_json_output(self):
        stdout = StringIO()
        call_command('preflight_check', '--json', stdout=stdout)
        output = stdout.getvalue()
        self.assertIn('"overall_status"', output)
        self.assertIn('"database"', output)
        self.assertIn('"jwt_sessions"', output)
        self.assertIn('"audit_controls"', output)
