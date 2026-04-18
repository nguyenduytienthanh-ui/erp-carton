from django.test import TestCase

from core.models import AuditLog, UserSession


class CoreModelIndexTests(TestCase):
    def test_audit_log_declares_release_readiness_indexes(self):
        index_names = {index.name for index in AuditLog._meta.indexes if index.name}
        self.assertIn('auditlog_created_desc_idx', index_names)
        self.assertIn('auditlog_type_created_idx', index_names)

    def test_user_session_declares_active_session_indexes(self):
        index_names = {index.name for index in UserSession._meta.indexes if index.name}
        self.assertIn('usersession_active_last_idx', index_names)
        self.assertIn('usersession_user_active_idx', index_names)
