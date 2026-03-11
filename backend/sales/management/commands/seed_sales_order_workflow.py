"""Seed WorkflowDefinition cho SalesOrder: DRAFT → SUBMITTED → APPROVED/REJECTED → POSTED; VOID."""
from django.core.management.base import BaseCommand
from core.models import WorkflowDefinition


class Command(BaseCommand):
    help = 'Seed workflow SalesOrder'

    EXPECTED_STATES = [
        {'code': 'DRAFT', 'name': 'Draft', 'color': '#6B7280'},
        {'code': 'SUBMITTED', 'name': 'Submitted', 'color': '#3B82F6'},
        {'code': 'APPROVED', 'name': 'Approved', 'color': '#10B981'},
        {'code': 'REJECTED', 'name': 'Rejected', 'color': '#EF4444'},
        {'code': 'POSTED', 'name': 'Posted', 'color': '#059669'},
        {'code': 'VOID', 'name': 'Void', 'color': '#9CA3AF'},
    ]

    EXPECTED_TRANSITIONS = [
        {'from': 'DRAFT', 'to': 'SUBMITTED', 'action': 'submit'},
        {'from': 'SUBMITTED', 'to': 'APPROVED', 'action': 'approve'},
        {'from': 'SUBMITTED', 'to': 'REJECTED', 'action': 'reject'},
        {'from': 'REJECTED', 'to': 'DRAFT', 'action': 'reopen'},
        {'from': 'APPROVED', 'to': 'POSTED', 'action': 'post'},
        {'from': 'DRAFT', 'to': 'VOID', 'action': 'void'},
        {'from': 'SUBMITTED', 'to': 'VOID', 'action': 'void'},
        {'from': 'APPROVED', 'to': 'VOID', 'action': 'void'},
        {'from': 'POSTED', 'to': 'VOID', 'action': 'void'},
    ]

    def handle(self, *args, **options):
        wf, created = WorkflowDefinition.objects.update_or_create(
            entity_type='SalesOrder',
            defaults={
                'name': 'Sales Order',
                'description': 'DRAFT > SUBMITTED > APPROVED/REJECTED > POSTED; VOID',
                'states': self.EXPECTED_STATES,
                'transitions': self.EXPECTED_TRANSITIONS,
                'initial_state': 'DRAFT',
                'final_states': ['POSTED', 'VOID'],
                'is_active': True,
            },
        )
        verb = 'created' if created else 'updated'
        self.stdout.write(self.style.SUCCESS(f'Workflow SalesOrder: {verb}'))
