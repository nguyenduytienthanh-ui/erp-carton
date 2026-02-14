"""Seed WorkflowDefinition cho SalesOrder: DRAFT → SUBMITTED → APPROVED/REJECTED → POSTED; VOID."""
from django.core.management.base import BaseCommand
from core.models import WorkflowDefinition


class Command(BaseCommand):
    help = 'Seed workflow SalesOrder'

    def handle(self, *args, **options):
        wf, created = WorkflowDefinition.objects.get_or_create(
            entity_type='SalesOrder',
            defaults={
                'name': 'Sales Order',
                'description': 'DRAFT → SUBMITTED → APPROVED/REJECTED → POSTED; VOID',
                'states': [
                    {'code': 'DRAFT', 'name': 'Nháp', 'color': '#6B7280'},
                    {'code': 'SUBMITTED', 'name': 'Đã gửi', 'color': '#3B82F6'},
                    {'code': 'APPROVED', 'name': 'Đã duyệt', 'color': '#10B981'},
                    {'code': 'REJECTED', 'name': 'Từ chối', 'color': '#EF4444'},
                    {'code': 'POSTED', 'name': 'Đã vào sổ', 'color': '#059669'},
                    {'code': 'VOID', 'name': 'Hủy', 'color': '#9CA3AF'},
                ],
                'transitions': [
                    {'from': 'DRAFT', 'to': 'SUBMITTED', 'action': 'submit'},
                    {'from': 'SUBMITTED', 'to': 'APPROVED', 'action': 'approve'},
                    {'from': 'SUBMITTED', 'to': 'REJECTED', 'action': 'reject'},
                    {'from': 'REJECTED', 'to': 'DRAFT', 'action': 'reopen'},
                    {'from': 'APPROVED', 'to': 'POSTED', 'action': 'post'},
                    {'from': 'APPROVED', 'to': 'VOID', 'action': 'void'},
                    {'from': 'POSTED', 'to': 'VOID', 'action': 'void'},
                ],
                'initial_state': 'DRAFT',
                'final_states': ['APPROVED', 'REJECTED', 'POSTED', 'VOID'],
            },
        )
        self.stdout.write(self.style.SUCCESS(f'Workflow SalesOrder: {"created" if created else "already exists"}'))
