import os
import re
from unittest import TestCase
from unittest.mock import patch

from django.core.management.base import CommandError

from core.management.commands.smoke_http import Command


class SmokeHttpCredentialResolutionTests(TestCase):
    def setUp(self):
        self.command = Command()

    def test_resolves_credential_from_env_name(self):
        with patch.dict(os.environ, {'ERP_SMOKE_USERNAME': 'sample-user'}, clear=False):
            self.assertEqual(
                self.command._resolve_credential(
                    raw_value='',
                    env_name='ERP_SMOKE_USERNAME',
                    option_name='username',
                ),
                'sample-user',
            )

    def test_missing_env_reports_name_only(self):
        with patch.dict(os.environ, {}, clear=True):
            with self.assertRaisesRegex(
                CommandError,
                re.escape('Missing required environment variable: ERP_SMOKE_PASSWORD'),
            ):
                self.command._resolve_credential(
                    raw_value='',
                    env_name='ERP_SMOKE_PASSWORD',
                    option_name='password',
                )

    def test_raw_and_env_options_conflict(self):
        with self.assertRaisesRegex(
            CommandError,
            re.escape('Use either --password or --password-env, not both.'),
        ):
            self.command._resolve_credential(
                raw_value='sample-password',
                env_name='ERP_SMOKE_PASSWORD',
                option_name='password',
            )
